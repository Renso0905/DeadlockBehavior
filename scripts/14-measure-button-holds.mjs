import {
    createReadStream,
    readFileSync,
    writeFileSync
} from 'node:fs';

import {
    resolve
} from 'node:path';

import {
    Parser,
    InterceptorStage
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';

const TICK_RATE =
    64;

const MATCH_OFFSET =
    30;


const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const previousSummaryPath =
    resolve(
        'output',
        replayName,
        'usercmd_button_summary.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'button_hold_summary.json'
    );


// ============================================================
// PLAYER SLOT NAMES
// ============================================================

const previousSummary =
    JSON.parse(
        readFileSync(
            previousSummaryPath,
            'utf8'
        )
    );


const playerBySlot =
    new Map();


for (
    const player
    of previousSummary.playerSlots
) {

    playerBySlot.set(
        player.playerSlot,
        {
            playerName:
                player.playerName,

            heroId:
                player.heroId,

            team:
                player.team
        }
    );
}


// ============================================================
// STATE
// ============================================================

const parser =
    new Parser();


const slots =
    new Map();


let commandsDecoded =
    0;

let decodeErrors =
    0;


// ============================================================
// READ COMMANDS
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        if (
            messagePacket.type?._code !==
            'svc_UserCmds'
        ) {
            return;
        }


        for (
            const command
            of (
                messagePacket.data
                    ?.commands
                ?? []
            )
        ) {

            try {

                const decoded =
                    decodeCitadelUserCmd(
                        command.data
                    );


                if (!decoded) {
                    continue;
                }


                commandsDecoded++;


                const playerSlot =
                    command.playerSlot;


                const slot =
                    getSlot(
                        playerSlot
                    );


                const currentMask =
                    decoded.buttonstate1;


                const reportedChangedMask =
                    decoded.buttonstate2;


                // --------------------------------------------
                // First command establishes initial state.
                // Do NOT call existing held buttons "presses."
                // --------------------------------------------

                if (
                    slot.previousMask ===
                    null
                ) {

                    slot.previousMask =
                        currentMask;

                    slot.previousTick =
                        demoPacket.tick;


                    // Track buttons already held when capture starts.

                    for (
                        let bit = 0;
                        bit < 64;
                        bit++
                    ) {

                        const mask =
                            1n <<
                            BigInt(bit);


                        if (
                            (
                                currentMask &
                                mask
                            )
                            !==
                            0n
                        ) {

                            slot.initiallyHeld.add(
                                bit
                            );
                        }
                    }


                    return;
                }


                // --------------------------------------------
                // DERIVE CHANGES FROM CURRENT STATE
                // --------------------------------------------

                const changedMask =
                    slot.previousMask
                    ^
                    currentMask;


                // --------------------------------------------
                // TEST WHETHER buttonstate2 REALLY IS
                // THE CHANGE MASK
                // --------------------------------------------

                slot.changeMaskComparisons++;


                if (
                    changedMask ===
                    reportedChangedMask
                ) {

                    slot.changeMaskExactMatches++;
                }


                if (
                    reportedChangedMask !==
                    0n
                ) {

                    slot.nonzeroReportedChanges++;
                }


                if (
                    changedMask !==
                    0n
                ) {

                    slot.nonzeroDerivedChanges++;
                }


                const intersection =
                    changedMask
                    &
                    reportedChangedMask;


                if (
                    changedMask !==
                    0n
                    &&
                    intersection ===
                    changedMask
                ) {

                    slot.derivedContainedInReported++;
                }


                // --------------------------------------------
                // PROCESS EVERY CHANGED BIT
                // --------------------------------------------

                for (
                    let bit = 0;
                    bit < 64;
                    bit++
                ) {

                    const mask =
                        1n <<
                        BigInt(bit);


                    if (
                        (
                            changedMask &
                            mask
                        )
                        ===
                        0n
                    ) {
                        continue;
                    }


                    const nowPressed =
                        (
                            currentMask &
                            mask
                        )
                        !==
                        0n;


                    const stats =
                        getBitStats(
                            slot,
                            bit
                        );


                    if (
                        nowPressed
                    ) {

                        stats.presses++;


                        stats.activeStartTick =
                            demoPacket.tick;


                        if (
                            stats.pressSamples.length <
                            25
                        ) {

                            stats.pressSamples.push({

                                demoTick:
                                    demoPacket.tick,

                                serverTick:
                                    command
                                        .serverTickExecuted,

                                matchTimeSeconds:
                                    tickToMatchTime(
                                        demoPacket.tick
                                    ),

                                matchClock:
                                    formatClock(
                                        tickToMatchTime(
                                            demoPacket.tick
                                        )
                                    )
                            });
                        }


                    } else {

                        stats.releases++;


                        if (
                            stats.activeStartTick !==
                            null
                        ) {

                            const durationTicks =
                                demoPacket.tick
                                -
                                stats.activeStartTick;


                            const durationSeconds =
                                durationTicks
                                /
                                TICK_RATE;


                            if (
                                durationSeconds >= 0
                                &&
                                durationSeconds < 30
                            ) {

                                stats.durations.push(
                                    durationSeconds
                                );
                            }


                            stats.activeStartTick =
                                null;
                        }
                    }
                }


                slot.previousMask =
                    currentMask;

                slot.previousTick =
                    demoPacket.tick;


            } catch {

                decodeErrors++;
            }
        }
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');
console.log(
    'Measuring per-button hold durations...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// FORMAT
// ============================================================

const playerResults =
    [...slots.values()]
        .map(
            formatSlot
        )
        .sort(
            (a, b) =>
                a.playerSlot -
                b.playerSlot
        );


const globalBits =
    buildGlobalBits(
        playerResults
    );


const result = {

    replay:
        replayName,

    tickRate:
        TICK_RATE,

    matchClockOffsetSeconds:
        MATCH_OFFSET,

    commandsDecoded,

    decodeErrors,

    interpretation: {

        buttonstate1:
            'treated as current/held button mask',

        buttonstate2:
            'tested against derived XOR change mask',

        timingResolutionSeconds:
            1 / TICK_RATE,

        subtickData:
            'not present in this replay'
    },

    playerSlots:
        playerResults,

    globalBits
};


writeFileSync(

    outputPath,

    JSON.stringify(
        result,
        null,
        2
    ),

    'utf8'
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');
console.log(
    '===================================='
);
console.log(
    'BUTTON HOLD ANALYSIS'
);
console.log(
    '===================================='
);
console.log('');

console.log(
    `Decoded commands: ${commandsDecoded}`
);

console.log(
    `Decode errors: ${decodeErrors}`
);

console.log('');


for (
    const player
    of playerResults
) {

    console.log(
        `slot ${player.playerSlot}` +
        (
            player.playerName
                ? ` (${player.playerName})`
                : ''
        )
    );


    console.log(
        `  buttonstate2 exact-change match: ` +
        `${(
            player.changeMaskValidation
                .exactMatchRate
            *
            100
        ).toFixed(2)}%`
    );


    for (
        const bit
        of player.bits
            .filter(
                item =>
                    item.presses > 0
            )
            .slice(
                0,
                20
            )
    ) {

        console.log(
            `  bit ${bit.bit}` +
            ` (${bit.hex})` +
            ` presses=${bit.presses}` +
            ` mean=${formatDuration(bit.meanSeconds)}` +
            ` median=${formatDuration(bit.medianSeconds)}`
        );
    }


    console.log('');
}


console.log('');
console.log(
    'GLOBAL BITS WITH COMPLETED HOLDS'
);
console.log('');


for (
    const bit
    of globalBits
        .filter(
            item =>
                item.durationCount >
                0
        )
) {

    console.log(
        `bit ${bit.bit}` +
        ` ${bit.hex}` +
        ` holds=${bit.durationCount}` +
        ` mean=${formatDuration(bit.meanSeconds)}` +
        ` median=${formatDuration(bit.medianSeconds)}`
    );
}


console.log('');
console.log(
    `Output:\n${outputPath}`
);
console.log('');


await parser.dispose();


// ============================================================
// SLOT STATE
// ============================================================

function getSlot(
    playerSlot
) {

    if (
        !slots.has(
            playerSlot
        )
    ) {

        const identity =
            playerBySlot.get(
                playerSlot
            )
            ?? {};


        slots.set(
            playerSlot,
            {

                playerSlot,

                playerName:
                    identity.playerName
                    ?? null,

                heroId:
                    identity.heroId
                    ?? null,

                team:
                    identity.team
                    ?? null,

                previousMask:
                    null,

                previousTick:
                    null,

                initiallyHeld:
                    new Set(),

                bits:
                    new Map(),

                changeMaskComparisons:
                    0,

                changeMaskExactMatches:
                    0,

                nonzeroReportedChanges:
                    0,

                nonzeroDerivedChanges:
                    0,

                derivedContainedInReported:
                    0
            }
        );
    }


    return slots.get(
        playerSlot
    );
}


function getBitStats(
    slot,
    bit
) {

    if (
        !slot.bits.has(
            bit
        )
    ) {

        slot.bits.set(
            bit,
            {

                bit,

                presses:
                    0,

                releases:
                    0,

                activeStartTick:
                    null,

                durations:
                    [],

                pressSamples:
                    []
            }
        );
    }


    return slot.bits.get(
        bit
    );
}


// ============================================================
// FORMATTING
// ============================================================

function formatSlot(
    slot
) {

    const bits =
        [...slot.bits.values()]
            .map(
                formatBit
            )
            .sort(
                (a, b) =>
                    b.presses -
                    a.presses
            );


    return {

        playerSlot:
            slot.playerSlot,

        playerName:
            slot.playerName,

        heroId:
            slot.heroId,

        team:
            slot.team,

        initiallyHeldBits:
            [...slot.initiallyHeld]
                .sort(
                    (a, b) =>
                        a - b
                ),

        changeMaskValidation: {

            comparisons:
                slot.changeMaskComparisons,

            exactMatches:
                slot.changeMaskExactMatches,

            exactMatchRate:
                slot.changeMaskComparisons > 0

                    ? slot.changeMaskExactMatches
                      /
                      slot.changeMaskComparisons

                    : null,

            nonzeroReportedChanges:
                slot.nonzeroReportedChanges,

            nonzeroDerivedChanges:
                slot.nonzeroDerivedChanges,

            derivedContainedInReported:
                slot.derivedContainedInReported
        },

        bits
    };
}


function formatBit(
    stats
) {

    const durations =
        [...stats.durations]
            .sort(
                (a, b) =>
                    a - b
            );


    return {

        bit:
            stats.bit,

        mask:
            (
                1n <<
                BigInt(
                    stats.bit
                )
            )
            .toString(),

        hex:
            '0x' +
            (
                1n <<
                BigInt(
                    stats.bit
                )
            )
            .toString(16),

        presses:
            stats.presses,

        releases:
            stats.releases,

        durationCount:
            durations.length,

        meanSeconds:
            mean(
                durations
            ),

        minSeconds:
            durations.length
                ? durations[0]
                : null,

        p25Seconds:
            percentile(
                durations,
                0.25
            ),

        medianSeconds:
            percentile(
                durations,
                0.50
            ),

        p75Seconds:
            percentile(
                durations,
                0.75
            ),

        p90Seconds:
            percentile(
                durations,
                0.90
            ),

        maxSeconds:
            durations.length
                ? durations.at(-1)
                : null,

        durationBuckets:
            bucketDurations(
                durations
            ),

        pressSamples:
            stats.pressSamples
    };
}


// ============================================================
// GLOBAL AGGREGATION
// ============================================================

function buildGlobalBits(
    players
) {

    const map =
        new Map();


    for (
        const player
        of players
    ) {

        for (
            const bit
            of player.bits
        ) {

            if (
                !map.has(
                    bit.bit
                )
            ) {

                map.set(
                    bit.bit,
                    {

                        bit:
                            bit.bit,

                        hex:
                            bit.hex,

                        presses:
                            0,

                        releases:
                            0,

                        durationCount:
                            0,

                        weightedMean:
                            0,

                        playerCount:
                            0,

                        players:
                            []
                    }
                );
            }


            const target =
                map.get(
                    bit.bit
                );


            target.presses +=
                bit.presses;

            target.releases +=
                bit.releases;

            target.playerCount++;


            if (
                bit.durationCount >
                0
                &&
                Number.isFinite(
                    bit.meanSeconds
                )
            ) {

                target.durationCount +=
                    bit.durationCount;

                target.weightedMean +=
                    bit.meanSeconds
                    *
                    bit.durationCount;
            }


            target.players.push({

                playerSlot:
                    player.playerSlot,

                playerName:
                    player.playerName,

                presses:
                    bit.presses,

                medianSeconds:
                    bit.medianSeconds,

                p90Seconds:
                    bit.p90Seconds
            });
        }
    }


    return [...map.values()]
        .map(
            item => ({

                bit:
                    item.bit,

                hex:
                    item.hex,

                presses:
                    item.presses,

                releases:
                    item.releases,

                durationCount:
                    item.durationCount,

                meanSeconds:
                    item.durationCount > 0

                        ? item.weightedMean
                          /
                          item.durationCount

                        : null,

                // Global median requires all raw durations.
                // We intentionally avoid storing millions of
                // values twice, so per-player medians remain
                // available above.

                medianSeconds:
                    medianOfPlayerMedians(
                        item.players
                    ),

                playerCount:
                    item.playerCount,

                players:
                    item.players
            })
        )
        .sort(
            (a, b) =>
                b.presses -
                a.presses
        );
}


// ============================================================
// HISTOGRAM
// ============================================================

function bucketDurations(
    durations
) {

    const buckets = {

        lt_0_05:
            0,

        '0_05_to_0_10':
            0,

        '0_10_to_0_20':
            0,

        '0_20_to_0_30':
            0,

        '0_30_to_0_40':
            0,

        '0_40_to_0_50':
            0,

        '0_50_to_0_75':
            0,

        '0_75_to_1_00':
            0,

        '1_00_to_2_00':
            0,

        gte_2_00:
            0
    };


    for (
        const value
        of durations
    ) {

        if (
            value < 0.05
        ) {

            buckets.lt_0_05++;

        } else if (
            value < 0.10
        ) {

            buckets[
                '0_05_to_0_10'
            ]++;

        } else if (
            value < 0.20
        ) {

            buckets[
                '0_10_to_0_20'
            ]++;

        } else if (
            value < 0.30
        ) {

            buckets[
                '0_20_to_0_30'
            ]++;

        } else if (
            value < 0.40
        ) {

            buckets[
                '0_30_to_0_40'
            ]++;

        } else if (
            value < 0.50
        ) {

            buckets[
                '0_40_to_0_50'
            ]++;

        } else if (
            value < 0.75
        ) {

            buckets[
                '0_50_to_0_75'
            ]++;

        } else if (
            value < 1.00
        ) {

            buckets[
                '0_75_to_1_00'
            ]++;

        } else if (
            value < 2.00
        ) {

            buckets[
                '1_00_to_2_00'
            ]++;

        } else {

            buckets.gte_2_00++;
        }
    }


    return buckets;
}


// ============================================================
// PROTOBUF DECODER
// ============================================================

function decodeCitadelUserCmd(
    input
) {

    if (
        !(
            input instanceof
            Uint8Array
        )
        &&
        !Buffer.isBuffer(
            input
        )
    ) {

        return null;
    }


    const outer =
        readProtoFields(
            Buffer.from(
                input
            )
        );


    const base =
        outer.find(
            field =>
                field.number === 1
                &&
                field.wireType === 2
        );


    if (!base) {
        return null;
    }


    const baseFields =
        readProtoFields(
            base.value
        );


    const buttonField =
        baseFields.find(
            field =>
                field.number === 3
                &&
                field.wireType === 2
        );


    if (!buttonField) {

        return {

            buttonstate1:
                0n,

            buttonstate2:
                0n,

            buttonstate3:
                0n
        };
    }


    const fields =
        readProtoFields(
            buttonField.value
        );


    return {

        buttonstate1:
            getVarint(
                fields,
                1
            )
            ?? 0n,

        buttonstate2:
            getVarint(
                fields,
                2
            )
            ?? 0n,

        buttonstate3:
            getVarint(
                fields,
                3
            )
            ?? 0n
    };
}


// ============================================================
// GENERIC PROTOBUF READER
// ============================================================

function readProtoFields(
    buffer
) {

    const fields =
        [];


    let offset =
        0;


    while (
        offset <
        buffer.length
    ) {

        const key =
            readVarint(
                buffer,
                offset
            );


        offset =
            key.offset;


        const raw =
            Number(
                key.value
            );


        const number =
            raw >>> 3;


        const wireType =
            raw & 7;


        if (
            wireType === 0
        ) {

            const item =
                readVarint(
                    buffer,
                    offset
                );


            offset =
                item.offset;


            fields.push({

                number,
                wireType,

                value:
                    item.value
            });


            continue;
        }


        if (
            wireType === 1
        ) {

            if (
                offset + 8 >
                buffer.length
            ) {

                throw new Error(
                    'Invalid fixed64'
                );
            }


            fields.push({

                number,
                wireType,

                value:
                    buffer.subarray(
                        offset,
                        offset + 8
                    )
            });


            offset +=
                8;


            continue;
        }


        if (
            wireType === 2
        ) {

            const lengthInfo =
                readVarint(
                    buffer,
                    offset
                );


            offset =
                lengthInfo.offset;


            const length =
                Number(
                    lengthInfo.value
                );


            if (
                !Number.isSafeInteger(
                    length
                )
                ||
                length < 0
                ||
                offset + length >
                buffer.length
            ) {

                throw new Error(
                    'Invalid length'
                );
            }


            fields.push({

                number,
                wireType,

                value:
                    buffer.subarray(
                        offset,
                        offset + length
                    )
            });


            offset +=
                length;


            continue;
        }


        if (
            wireType === 5
        ) {

            if (
                offset + 4 >
                buffer.length
            ) {

                throw new Error(
                    'Invalid fixed32'
                );
            }


            fields.push({

                number,
                wireType,

                value:
                    buffer.readUInt32LE(
                        offset
                    )
            });


            offset +=
                4;


            continue;
        }


        throw new Error(
            `Unsupported wire type ${wireType}`
        );
    }


    return fields;
}


function readVarint(
    buffer,
    start
) {

    let value =
        0n;

    let shift =
        0n;

    let offset =
        start;


    while (
        offset <
        buffer.length
    ) {

        const byte =
            BigInt(
                buffer[offset]
            );


        offset++;


        value |=
            (
                byte &
                0x7fn
            )
            <<
            shift;


        if (
            (
                byte &
                0x80n
            )
            ===
            0n
        ) {

            return {
                value,
                offset
            };
        }


        shift +=
            7n;


        if (
            shift >
            70n
        ) {

            throw new Error(
                'Invalid varint'
            );
        }
    }


    throw new Error(
        'Unexpected end of varint'
    );
}


function getVarint(
    fields,
    number
) {

    const field =
        fields.find(
            item =>
                item.number ===
                number
                &&
                item.wireType === 0
        );


    return field
        ? field.value
        : null;
}


// ============================================================
// MATH
// ============================================================

function mean(
    values
) {

    if (!values.length) {
        return null;
    }


    return (
        values.reduce(
            (
                sum,
                value
            ) =>
                sum + value,
            0
        )
        /
        values.length
    );
}


function percentile(
    sorted,
    p
) {

    if (
        !sorted.length
    ) {
        return null;
    }


    const index =
        (
            sorted.length -
            1
        )
        *
        p;


    const lower =
        Math.floor(
            index
        );


    const upper =
        Math.ceil(
            index
        );


    if (
        lower === upper
    ) {

        return sorted[
            lower
        ];
    }


    const fraction =
        index -
        lower;


    return (
        sorted[lower]
        *
        (
            1 -
            fraction
        )
    )
    +
    (
        sorted[upper]
        *
        fraction
    );
}


function medianOfPlayerMedians(
    players
) {

    const values =
        players

            .map(
                item =>
                    item.medianSeconds
            )

            .filter(
                Number.isFinite
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    a - b
            );


    return percentile(
        values,
        0.5
    );
}


// ============================================================
// TIME
// ============================================================

function tickToMatchTime(
    tick
) {

    return (
        tick /
        TICK_RATE
    )
    -
    MATCH_OFFSET;
}


function formatClock(
    seconds
) {

    const negative =
        seconds < 0;


    const absolute =
        Math.abs(
            Math.floor(
                seconds
            )
        );


    const minutes =
        Math.floor(
            absolute /
            60
        );


    const secs =
        absolute %
        60;


    return (
        negative
            ? '-'
            : ''
    )
    +
    `${minutes}:`
    +
    String(
        secs
    ).padStart(
        2,
        '0'
    );
}


function formatDuration(
    value
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return '—';
    }


    return (
        value.toFixed(3)
        +
        's'
    );
}