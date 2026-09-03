import {
    createReadStream,
    readFileSync,
    createWriteStream,
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


// Deadlock current melee VData:
//
// Light melee:
// released within ~0.26 sec
//
// Heavy melee:
// hold reaches ~0.55 sec

const LIGHT_MAX_SECONDS =
    0.26;

const HEAVY_REQUIRED_SECONDS =
    0.55;


// Deadlock:
// IN_WEAPON1 = 4294967296

const MELEE_MASK =
    4294967296n;


const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );

const identityPath =
    resolve(
        'output',
        replayName,
        'usercmd_button_summary.json'
    );

const outputEventsPath =
    resolve(
        'output',
        replayName,
        'melee_events.jsonl'
    );

const outputSummaryPath =
    resolve(
        'output',
        replayName,
        'melee_summary.json'
    );


// ============================================================
// PLAYER IDENTITIES
// ============================================================

const previous =
    JSON.parse(
        readFileSync(
            identityPath,
            'utf8'
        )
    );


const identities =
    new Map();


for (
    const player
    of previous.playerSlots
) {

    identities.set(
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
// PARSER
// ============================================================

const parser =
    new Parser();


const output =
    createWriteStream(
        outputEventsPath,
        {
            encoding:
                'utf8'
        }
    );


// ============================================================
// STATE
// ============================================================

const slots =
    new Map();


let commandsDecoded =
    0;

let decodeErrors =
    0;

let meleePresses =
    0;

let completedMelees =
    0;

let lightMelees =
    0;

let heavyMelees =
    0;

let ambiguousMelees =
    0;


const summaryByPlayer =
    new Map();


// ============================================================
// USER COMMANDS
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


                const state =
                    getSlotState(
                        playerSlot
                    );


                const meleeDown =
                    (
                        decoded.buttonstate1
                        &
                        MELEE_MASK
                    )
                    !==
                    0n;


                // First observed command:
                // establish state only.

                if (
                    state.previousDown ===
                    null
                ) {

                    state.previousDown =
                        meleeDown;

                    return;
                }


                // =================================================
                // PRESS
                // =================================================

                if (
                    meleeDown
                    &&
                    !state.previousDown
                ) {

                    meleePresses++;


                    state.pressTick =
                        demoPacket.tick;


                    state.pressServerTick =
                        command
                            .serverTickExecuted;


                    state.pressMatchTime =
                        tickToMatchTime(
                            demoPacket.tick
                        );
                }


                // =================================================
                // RELEASE
                // =================================================

                if (
                    !meleeDown
                    &&
                    state.previousDown
                    &&
                    state.pressTick !==
                    null
                ) {

                    const releaseTick =
                        demoPacket.tick;


                    const releaseMatchTime =
                        tickToMatchTime(
                            releaseTick
                        );


                    const holdTicks =
                        releaseTick
                        -
                        state.pressTick;


                    const holdSeconds =
                        holdTicks
                        /
                        TICK_RATE;


                    const classification =
                        classifyMelee(
                            holdSeconds
                        );


                    // ---------------------------------------------
                    // Estimated point at which attack resolves
                    // from the input contingency.
                    //
                    // Light:
                    // action occurs on release.
                    //
                    // Heavy:
                    // game has had enough hold duration to trigger
                    // after ~0.55 sec.
                    //
                    // Ambiguous:
                    // preserve release time only.
                    // ---------------------------------------------

                    let estimatedActionMatchTime =
                        releaseMatchTime;


                    if (
                        classification ===
                        'HEAVY'
                    ) {

                        estimatedActionMatchTime =
                            state.pressMatchTime
                            +
                            HEAVY_REQUIRED_SECONDS;
                    }


                    const identity =
                        identities.get(
                            playerSlot
                        )
                        ?? {};


                    const event = {

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

                        input:
                            'IN_WEAPON1',

                        inputMask:
                            MELEE_MASK
                                .toString(),

                        classification,

                        pressTick:
                            state.pressTick,

                        releaseTick,

                        pressServerTick:
                            state.pressServerTick,

                        releaseServerTick:
                            command
                                .serverTickExecuted,

                        pressMatchTimeSeconds:
                            state.pressMatchTime,

                        pressMatchClock:
                            formatClock(
                                state.pressMatchTime
                            ),

                        releaseMatchTimeSeconds:
                            releaseMatchTime,

                        releaseMatchClock:
                            formatClock(
                                releaseMatchTime
                            ),

                        holdTicks,

                        holdSeconds,

                        estimatedActionMatchTimeSeconds:
                            estimatedActionMatchTime,

                        estimatedActionMatchClock:
                            formatClock(
                                estimatedActionMatchTime
                            ),

                        thresholds: {

                            lightMaxSeconds:
                                LIGHT_MAX_SECONDS,

                            heavyRequiredSeconds:
                                HEAVY_REQUIRED_SECONDS
                        }
                    };


                    output.write(
                        JSON.stringify(event)
                        +
                        '\n'
                    );


                    completedMelees++;


                    const playerStats =
                        getPlayerStats(
                            playerSlot
                        );


                    playerStats.total++;


                    if (
                        classification ===
                        'LIGHT'
                    ) {

                        lightMelees++;

                        playerStats.light++;

                    } else if (
                        classification ===
                        'HEAVY'
                    ) {

                        heavyMelees++;

                        playerStats.heavy++;

                    } else {

                        ambiguousMelees++;

                        playerStats.ambiguous++;
                    }


                    playerStats.holdSeconds.push(
                        holdSeconds
                    );


                    if (
                        playerStats.samples.length <
                        30
                    ) {

                        playerStats.samples.push({

                            classification,

                            pressMatchTimeSeconds:
                                state.pressMatchTime,

                            pressMatchClock:
                                formatClock(
                                    state.pressMatchTime
                                ),

                            holdSeconds
                        });
                    }


                    state.pressTick =
                        null;

                    state.pressServerTick =
                        null;

                    state.pressMatchTime =
                        null;
                }


                state.previousDown =
                    meleeDown;


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
    'Extracting light/heavy melee inputs...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


output.end();


await new Promise(
    finish => {

        output.on(
            'finish',
            finish
        );
    }
);


// ============================================================
// SUMMARY
// ============================================================

const players =
    [...summaryByPlayer.values()]
        .map(
            formatPlayerStats
        )
        .sort(
            (
                a,
                b
            ) =>
                a.playerSlot
                -
                b.playerSlot
        );


const summary = {

    replay:
        replayName,

    tickRate:
        TICK_RATE,

    matchClockOffsetSeconds:
        MATCH_OFFSET,

    meleeInput: {

        enum:
            'IN_WEAPON1',

        bit:
            32,

        mask:
            MELEE_MASK.toString(),

        hex:
            '0x100000000'
    },

    classificationThresholds: {

        lightMaxHoldSeconds:
            LIGHT_MAX_SECONDS,

        heavyRequiredHoldSeconds:
            HEAVY_REQUIRED_SECONDS,

        ambiguousRange:
            '(0.26, 0.55)'
    },

    commandsDecoded,

    decodeErrors,

    meleePresses,

    completedMelees,

    classifications: {

        light:
            lightMelees,

        heavy:
            heavyMelees,

        ambiguous:
            ambiguousMelees
    },

    players
};


writeFileSync(

    outputSummaryPath,

    JSON.stringify(
        summary,
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
    'MELEE INPUT EXTRACTION'
);
console.log(
    '===================================='
);
console.log('');

console.log(
    `Commands decoded: ${commandsDecoded}`
);

console.log(
    `Decode errors: ${decodeErrors}`
);

console.log('');

console.log(
    `Completed melee inputs: ${completedMelees}`
);

console.log(
    `Light: ${lightMelees}`
);

console.log(
    `Heavy: ${heavyMelees}`
);

console.log(
    `Ambiguous/charge: ${ambiguousMelees}`
);

console.log('');


for (
    const player
    of players
) {

    console.log(
        `${player.playerName ?? `slot ${player.playerSlot}`}`
    );

    console.log(
        `  total=${player.total}` +
        ` light=${player.light}` +
        ` heavy=${player.heavy}` +
        ` ambiguous=${player.ambiguous}`
    );
}


console.log('');

console.log(
    `Events:\n${outputEventsPath}`
);

console.log('');

console.log(
    `Summary:\n${outputSummaryPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// STATE HELPERS
// ============================================================

function getSlotState(
    playerSlot
) {

    if (
        !slots.has(
            playerSlot
        )
    ) {

        slots.set(
            playerSlot,
            {

                previousDown:
                    null,

                pressTick:
                    null,

                pressServerTick:
                    null,

                pressMatchTime:
                    null
            }
        );
    }


    return slots.get(
        playerSlot
    );
}


function getPlayerStats(
    playerSlot
) {

    if (
        !summaryByPlayer.has(
            playerSlot
        )
    ) {

        const identity =
            identities.get(
                playerSlot
            )
            ?? {};


        summaryByPlayer.set(
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

                total:
                    0,

                light:
                    0,

                heavy:
                    0,

                ambiguous:
                    0,

                holdSeconds:
                    [],

                samples:
                    []
            }
        );
    }


    return summaryByPlayer.get(
        playerSlot
    );
}


function formatPlayerStats(
    stats
) {

    const durations =
        [...stats.holdSeconds]
            .sort(
                (
                    a,
                    b
                ) =>
                    a - b
            );


    return {

        playerSlot:
            stats.playerSlot,

        playerName:
            stats.playerName,

        heroId:
            stats.heroId,

        team:
            stats.team,

        total:
            stats.total,

        light:
            stats.light,

        heavy:
            stats.heavy,

        ambiguous:
            stats.ambiguous,

        lightPercent:
            stats.total
                ? (
                    stats.light
                    /
                    stats.total
                )
                *
                100
                : null,

        heavyPercent:
            stats.total
                ? (
                    stats.heavy
                    /
                    stats.total
                )
                *
                100
                : null,

        ambiguousPercent:
            stats.total
                ? (
                    stats.ambiguous
                    /
                    stats.total
                )
                *
                100
                : null,

        medianHoldSeconds:
            percentile(
                durations,
                0.5
            ),

        p90HoldSeconds:
            percentile(
                durations,
                0.9
            ),

        samples:
            stats.samples
    };
}


// ============================================================
// CLASSIFICATION
// ============================================================

function classifyMelee(
    seconds
) {

    if (
        seconds <=
        LIGHT_MAX_SECONDS
    ) {

        return 'LIGHT';
    }


    if (
        seconds >=
        HEAVY_REQUIRED_SECONDS
    ) {

        return 'HEAVY';
    }


    return 'AMBIGUOUS_CHARGE';
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
                field.number ===
                1
                &&
                field.wireType ===
                2
        );


    if (!base) {
        return null;
    }


    const baseFields =
        readProtoFields(
            base.value
        );


    const buttons =
        baseFields.find(
            field =>
                field.number ===
                3
                &&
                field.wireType ===
                2
        );


    if (!buttons) {

        return {
            buttonstate1:
                0n
        };
    }


    const fields =
        readProtoFields(
            buttons.value
        );


    return {

        buttonstate1:
            getVarint(
                fields,
                1
            )
            ??
            0n
    };
}


// ============================================================
// GENERIC PROTOBUF
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
                item.wireType ===
                0
        );


    return field
        ? field.value
        : null;
}


// ============================================================
// TIME / MATH
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