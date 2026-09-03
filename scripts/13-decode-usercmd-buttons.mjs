import {
    createReadStream,
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

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );

const outputPath =
    resolve(
        'output',
        replayName,
        'usercmd_button_summary.json'
    );


const parser =
    new Parser();


// ============================================================
// TRACKING
// ============================================================

let commandsDecoded =
    0;

let decodeErrors =
    0;


const slots =
    new Map();


// Used to pair subtick PRESS -> RELEASE events.

const activePresses =
    new Map();


// ============================================================
// INTERCEPT svc_UserCmds
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


        const commands =
            messagePacket.data?.commands
            ?? [];


        for (
            const command
            of commands
        ) {

            try {

                const decoded =
                    decodeCitadelUserCmd(
                        command.data
                    );


                if (!decoded?.base) {
                    continue;
                }


                commandsDecoded++;


                const playerSlot =
                    command.playerSlot;


                const slot =
                    getSlot(
                        playerSlot
                    );


                slot.commands++;


                // --------------------------------------------
                // TICKS
                // --------------------------------------------

                slot.firstDemoTick ??=
                    demoPacket.tick;

                slot.lastDemoTick =
                    demoPacket.tick;


                slot.firstServerTick ??=
                    command.serverTickExecuted;

                slot.lastServerTick =
                    command.serverTickExecuted;


                // --------------------------------------------
                // PAWN HANDLE
                // --------------------------------------------

                if (
                    decoded.base.pawnEntityHandle !==
                    null
                ) {

                    const handle =
                        decoded.base
                            .pawnEntityHandle;


                    slot.pawnHandles.set(
                        handle,
                        (
                            slot.pawnHandles.get(
                                handle
                            )
                            ?? 0
                        )
                        +
                        1
                    );


                    if (!slot.playerName) {

                        const identity =
                            tryResolvePawn(
                                handle
                            );


                        if (identity) {

                            slot.playerName =
                                identity.playerName;

                            slot.heroId =
                                identity.heroId;

                            slot.team =
                                identity.team;
                        }
                    }
                }


                // --------------------------------------------
                // BUTTON STATES
                // --------------------------------------------

                const buttons =
                    decoded.base.buttons;


                if (buttons) {

                    addMask(
                        slot.buttonState1,
                        buttons.buttonstate1
                    );

                    addMask(
                        slot.buttonState2,
                        buttons.buttonstate2
                    );

                    addMask(
                        slot.buttonState3,
                        buttons.buttonstate3
                    );


                    countBits(
                        slot.bits1,
                        buttons.buttonstate1
                    );

                    countBits(
                        slot.bits2,
                        buttons.buttonstate2
                    );

                    countBits(
                        slot.bits3,
                        buttons.buttonstate3
                    );
                }


                // --------------------------------------------
                // SUBTICK BUTTON TRANSITIONS
                // --------------------------------------------

                for (
                    const move
                    of decoded.base.subtickMoves
                ) {

                    if (
                        move.button === null
                    ) {
                        continue;
                    }


                    const key =
                        move.button.toString();


                    if (
                        !slot.subtickButtons.has(
                            key
                        )
                    ) {

                        slot.subtickButtons.set(
                            key,
                            createSubtickStats(
                                move.button
                            )
                        );
                    }


                    const stats =
                        slot.subtickButtons.get(
                            key
                        );


                    stats.total++;


                    if (
                        move.pressed === true
                    ) {

                        stats.pressed++;

                    } else {

                        stats.released++;
                    }


                    // ----------------------------------------
                    // Absolute event time
                    //
                    // Demo tick is relative to replay start.
                    // "when" is fractional position in tick.
                    // ----------------------------------------

                    const when =
                        Number.isFinite(
                            move.when
                        )
                            ? move.when
                            : 0;


                    const eventTick =
                        demoPacket.tick
                        +
                        when;


                    // ----------------------------------------
                    // PRESS / RELEASE DURATION
                    // ----------------------------------------

                    const pressKey =
                        `${playerSlot}|${key}`;


                    if (
                        move.pressed === true
                    ) {

                        if (
                            !activePresses.has(
                                pressKey
                            )
                        ) {

                            activePresses.set(
                                pressKey,
                                eventTick
                            );
                        }

                    } else {

                        const start =
                            activePresses.get(
                                pressKey
                            );


                        if (
                            Number.isFinite(
                                start
                            )
                        ) {

                            const durationTicks =
                                eventTick -
                                start;


                            const durationSeconds =
                                durationTicks / 64;


                            if (
                                durationSeconds >= 0
                                &&
                                durationSeconds < 60
                            ) {

                                addDuration(
                                    stats,
                                    durationSeconds
                                );
                            }


                            activePresses.delete(
                                pressKey
                            );
                        }
                    }


                    // ----------------------------------------
                    // SAMPLE EVENTS
                    // ----------------------------------------

                    if (
                        stats.samples.length <
                        20
                    ) {

                        stats.samples.push({

                            demoTick:
                                demoPacket.tick,

                            serverTickExecuted:
                                command
                                    .serverTickExecuted,

                            when,

                            pressed:
                                move.pressed,

                            button:
                                key,

                            buttonHex:
                                toHex(
                                    move.button
                                )
                        });
                    }
                }

            } catch (error) {

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
    'Decoding Deadlock user-command buttons...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// BUILD SUMMARY
// ============================================================

const slotResults =
    [...slots.values()]
        .map(
            formatSlot
        )
        .sort(
            (a, b) =>
                a.playerSlot -
                b.playerSlot
        );


const globalSubtick =
    combineSubtickStats(
        slotResults
    );


const summary = {

    replay:
        replayName,

    tickRate:
        64,

    commandsDecoded,

    decodeErrors,

    note: [
        'buttonstate1/buttonstate2/buttonstate3 are kept raw for now.',
        'Do not assign action names to bits yet.',
        'Subtick durations are paired from pressed=true to pressed=false events.'
    ],

    playerSlots:
        slotResults,

    globalSubtickButtons:
        globalSubtick
};


writeFileSync(

    outputPath,

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
    'USERCMD BUTTON DECODER'
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
    const slot
    of slotResults
) {

    console.log(
        `slot ${slot.playerSlot}` +
        (
            slot.playerName
                ? ` (${slot.playerName})`
                : ''
        )
    );


    console.log(
        `  commands: ${slot.commands}`
    );


    console.log(
        `  distinct subtick buttons: ${slot.subtickButtons.length}`
    );


    for (
        const button
        of slot.subtickButtons.slice(
            0,
            15
        )
    ) {

        console.log(
            `    ${button.buttonHex}` +
            ` press=${button.pressed}` +
            ` release=${button.released}` +
            ` durations=${button.durationCount}`
        );
    }


    console.log('');
}


console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// DEADLOCK USER COMMAND DECODER
// ============================================================

function decodeCitadelUserCmd(
    input
) {

    if (
        !(input instanceof Uint8Array)
        &&
        !Buffer.isBuffer(input)
    ) {

        return null;
    }


    const outer =
        readProtoFields(
            Buffer.from(input)
        );


    // CCitadelUserCmdPB:
    //
    // field 1 = CBaseUserCmdPB base

    const baseField =
        outer.find(
            field =>
                field.number === 1
                &&
                field.wireType === 2
        );


    if (!baseField) {
        return null;
    }


    return {

        base:
            decodeBaseUserCmd(
                baseField.value
            )
    };
}


// ============================================================
// CBaseUserCmdPB
// ============================================================

function decodeBaseUserCmd(
    buffer
) {

    const fields =
        readProtoFields(
            buffer
        );


    const buttonsField =
        fields.find(
            field =>
                field.number === 3
                &&
                field.wireType === 2
        );


    const subtickFields =
        fields.filter(
            field =>
                field.number === 18
                &&
                field.wireType === 2
        );


    const pawnField =
        fields.find(
            field =>
                field.number === 14
                &&
                field.wireType === 0
        );


    return {

        pawnEntityHandle:
            pawnField
                ? Number(
                    pawnField.value
                )
                : null,

        buttons:
            buttonsField
                ? decodeButtons(
                    buttonsField.value
                )
                : null,

        subtickMoves:
            subtickFields.map(
                field =>
                    decodeSubtickMove(
                        field.value
                    )
            )
    };
}


// ============================================================
// CInButtonStatePB
// ============================================================

function decodeButtons(
    buffer
) {

    const fields =
        readProtoFields(
            buffer
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
// CSubtickMoveStep
// ============================================================

function decodeSubtickMove(
    buffer
) {

    const fields =
        readProtoFields(
            buffer
        );


    const button =
        getVarint(
            fields,
            1
        );


    const pressedRaw =
        getVarint(
            fields,
            2
        );


    const whenField =
        fields.find(
            field =>
                field.number === 3
                &&
                field.wireType === 5
        );


    return {

        button:
            button
            ?? null,

        pressed:
            pressedRaw !== null
                ? pressedRaw !== 0n
                : false,

        when:
            whenField
                ? whenField.value
                : 0
    };
}


// ============================================================
// GENERIC PROTOBUF WIRE DECODER
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


        const rawKey =
            Number(
                key.value
            );


        const number =
            rawKey >>> 3;


        const wireType =
            rawKey & 7;


        // --------------------------------------------
        // VARINT
        // --------------------------------------------

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


        // --------------------------------------------
        // FIXED 64
        // --------------------------------------------

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


            const value =
                buffer.subarray(
                    offset,
                    offset + 8
                );


            offset +=
                8;


            fields.push({

                number,

                wireType,

                value
            });


            continue;
        }


        // --------------------------------------------
        // LENGTH DELIMITED
        // --------------------------------------------

        if (
            wireType === 2
        ) {

            const lengthValue =
                readVarint(
                    buffer,
                    offset
                );


            offset =
                lengthValue.offset;


            const length =
                Number(
                    lengthValue.value
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
                    'Invalid length-delimited field'
                );
            }


            const value =
                buffer.subarray(
                    offset,
                    offset + length
                );


            offset +=
                length;


            fields.push({

                number,

                wireType,

                value
            });


            continue;
        }


        // --------------------------------------------
        // FIXED 32
        // --------------------------------------------

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


            const value =
                buffer.readFloatLE(
                    offset
                );


            offset +=
                4;


            fields.push({

                number,

                wireType,

                value
            });


            continue;
        }


        throw new Error(
            `Unsupported protobuf wire type ${wireType}`
        );
    }


    return fields;
}


// ============================================================
// VARINT
// ============================================================

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
                byte & 0x7fn
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
                'Invalid protobuf varint'
            );
        }
    }


    throw new Error(
        'Unexpected end of varint'
    );
}


// ============================================================
// FIELD HELPER
// ============================================================

function getVarint(
    fields,
    number
) {

    const field =
        fields.find(
            item =>
                item.number === number
                &&
                item.wireType === 0
        );


    return field
        ? field.value
        : null;
}


// ============================================================
// SLOT
// ============================================================

function getSlot(
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

                playerSlot,

                playerName:
                    null,

                heroId:
                    null,

                team:
                    null,

                commands:
                    0,

                firstDemoTick:
                    null,

                lastDemoTick:
                    null,

                firstServerTick:
                    null,

                lastServerTick:
                    null,

                pawnHandles:
                    new Map(),

                buttonState1:
                    new Map(),

                buttonState2:
                    new Map(),

                buttonState3:
                    new Map(),

                bits1:
                    new Array(64)
                        .fill(0),

                bits2:
                    new Array(64)
                        .fill(0),

                bits3:
                    new Array(64)
                        .fill(0),

                subtickButtons:
                    new Map()
            }
        );
    }


    return slots.get(
        playerSlot
    );
}


// ============================================================
// BUTTON MASKS
// ============================================================

function addMask(
    map,
    mask
) {

    const key =
        mask.toString();


    map.set(
        key,
        (
            map.get(key)
            ?? 0
        )
        +
        1
    );
}


function countBits(
    counts,
    mask
) {

    for (
        let bit = 0;
        bit < 64;
        bit++
    ) {

        const value =
            1n <<
            BigInt(bit);


        if (
            (
                mask &
                value
            )
            !==
            0n
        ) {

            counts[bit]++;
        }
    }
}


// ============================================================
// SUBTICK
// ============================================================

function createSubtickStats(
    button
) {

    return {

        button,

        total:
            0,

        pressed:
            0,

        released:
            0,

        durationCount:
            0,

        durationSum:
            0,

        durationMin:
            null,

        durationMax:
            null,

        durationBuckets: {

            lt005:
                0,

            '005_015':
                0,

            '015_030':
                0,

            '030_050':
                0,

            '050_100':
                0,

            '100_300':
                0,

            gte300:
                0
        },

        samples:
            []
    };
}


function addDuration(
    stats,
    seconds
) {

    stats.durationCount++;

    stats.durationSum +=
        seconds;


    stats.durationMin =
        stats.durationMin === null
            ? seconds
            : Math.min(
                stats.durationMin,
                seconds
            );


    stats.durationMax =
        stats.durationMax === null
            ? seconds
            : Math.max(
                stats.durationMax,
                seconds
            );


    if (
        seconds <
        0.05
    ) {

        stats.durationBuckets.lt005++;

    } else if (
        seconds <
        0.15
    ) {

        stats.durationBuckets['005_015']++;

    } else if (
        seconds <
        0.30
    ) {

        stats.durationBuckets['015_030']++;

    } else if (
        seconds <
        0.50
    ) {

        stats.durationBuckets['030_050']++;

    } else if (
        seconds <
        1.00
    ) {

        stats.durationBuckets['050_100']++;

    } else if (
        seconds <
        3.00
    ) {

        stats.durationBuckets['100_300']++;

    } else {

        stats.durationBuckets.gte300++;
    }
}


// ============================================================
// IDENTITY RESOLUTION
// ============================================================

function tryResolvePawn(
    handle
) {

    try {

        const demo =
            parser.getDemo();


        const pawn =
            demo.getEntityByHandle(
                handle
            );


        if (!pawn) {
            return null;
        }


        const className =
            pawn.class?.name;


        if (
            className !==
            'CCitadelPlayerPawn'
        ) {
            return null;
        }


        const controllerHandle =
            pawn.getField(
                'm_hController'
            )
            ??
            pawn.getField(
                'm_hDefaultController'
            );


        if (
            !Number.isFinite(
                Number(
                    controllerHandle
                )
            )
        ) {
            return null;
        }


        const controller =
            demo.getEntityByHandle(
                Number(
                    controllerHandle
                )
            );


        if (!controller) {
            return null;
        }


        return {

            playerName:
                controller.getField(
                    'm_iszPlayerName'
                )
                ?? null,

            heroId:
                pawn.getField(
                    'm_nHeroID'
                )
                ??
                controller.getField(
                    'm_nHeroID'
                )
                ??
                null,

            team:
                controller.getField(
                    'm_iTeamNum'
                )
                ??
                pawn.getField(
                    'm_iTeamNum'
                )
                ??
                null
        };


    } catch {

        return null;
    }
}


// ============================================================
// FORMAT
// ============================================================

function formatSlot(
    slot
) {

    return {

        playerSlot:
            slot.playerSlot,

        playerName:
            slot.playerName,

        heroId:
            slot.heroId,

        team:
            slot.team,

        commands:
            slot.commands,

        firstDemoTick:
            slot.firstDemoTick,

        lastDemoTick:
            slot.lastDemoTick,

        firstServerTick:
            slot.firstServerTick,

        lastServerTick:
            slot.lastServerTick,

        pawnHandles:
            topMap(
                slot.pawnHandles,
                20,
                true
            ),

        buttonState1TopMasks:
            topMap(
                slot.buttonState1,
                30,
                true
            ),

        buttonState2TopMasks:
            topMap(
                slot.buttonState2,
                30,
                true
            ),

        buttonState3TopMasks:
            topMap(
                slot.buttonState3,
                30,
                true
            ),

        buttonState1Bits:
            formatBits(
                slot.bits1
            ),

        buttonState2Bits:
            formatBits(
                slot.bits2
            ),

        buttonState3Bits:
            formatBits(
                slot.bits3
            ),

        subtickButtons:
            [...slot.subtickButtons.values()]
                .map(
                    formatSubtick
                )
                .sort(
                    (a, b) =>
                        b.total -
                        a.total
                )
    };
}


function topMap(
    map,
    limit,
    includeHex
) {

    return [...map.entries()]
        .map(
            (
                [
                    value,
                    count
                ]
            ) => {

                const bigint =
                    BigInt(value);


                return {

                    value,

                    ...(includeHex
                        ? {
                            hex:
                                toHex(
                                    bigint
                                )
                        }
                        : {}),

                    count
                };
            }
        )
        .sort(
            (a, b) =>
                b.count -
                a.count
        )
        .slice(
            0,
            limit
        );
}


function formatBits(
    counts
) {

    return counts
        .map(
            (
                count,
                bit
            ) => ({

                bit,

                mask:
                    (
                        1n <<
                        BigInt(bit)
                    )
                    .toString(),

                hex:
                    toHex(
                        1n <<
                        BigInt(bit)
                    ),

                count
            })
        )
        .filter(
            item =>
                item.count > 0
        )
        .sort(
            (a, b) =>
                b.count -
                a.count
        );
}


function formatSubtick(
    stats
) {

    return {

        button:
            stats.button.toString(),

        buttonHex:
            toHex(
                stats.button
            ),

        bit:
            singleBitIndex(
                stats.button
            ),

        total:
            stats.total,

        pressed:
            stats.pressed,

        released:
            stats.released,

        durationCount:
            stats.durationCount,

        meanDurationSeconds:
            stats.durationCount > 0
                ? stats.durationSum /
                  stats.durationCount
                : null,

        minDurationSeconds:
            stats.durationMin,

        maxDurationSeconds:
            stats.durationMax,

        durationBuckets:
            stats.durationBuckets,

        samples:
            stats.samples
    };
}


// ============================================================
// GLOBAL SUBTICK SUMMARY
// ============================================================

function combineSubtickStats(
    formattedSlots
) {

    const combined =
        new Map();


    for (
        const slot
        of formattedSlots
    ) {

        for (
            const button
            of slot.subtickButtons
        ) {

            if (
                !combined.has(
                    button.button
                )
            ) {

                combined.set(
                    button.button,
                    {

                        button:
                            button.button,

                        buttonHex:
                            button.buttonHex,

                        bit:
                            button.bit,

                        total:
                            0,

                        pressed:
                            0,

                        released:
                            0,

                        durationCount:
                            0,

                        weightedDuration:
                            0,

                        players:
                            []
                    }
                );
            }


            const item =
                combined.get(
                    button.button
                );


            item.total +=
                button.total;

            item.pressed +=
                button.pressed;

            item.released +=
                button.released;


            if (
                button.durationCount >
                0
            ) {

                item.durationCount +=
                    button.durationCount;

                item.weightedDuration +=
                    button.meanDurationSeconds
                    *
                    button.durationCount;
            }


            item.players.push({

                playerSlot:
                    slot.playerSlot,

                playerName:
                    slot.playerName,

                total:
                    button.total
            });
        }
    }


    return [...combined.values()]
        .map(
            item => ({

                button:
                    item.button,

                buttonHex:
                    item.buttonHex,

                bit:
                    item.bit,

                total:
                    item.total,

                pressed:
                    item.pressed,

                released:
                    item.released,

                meanDurationSeconds:
                    item.durationCount > 0
                        ? item.weightedDuration /
                          item.durationCount
                        : null,

                players:
                    item.players
            })
        )
        .sort(
            (a, b) =>
                b.total -
                a.total
        );
}


// ============================================================
// SMALL HELPERS
// ============================================================

function toHex(
    value
) {

    return (
        '0x'
        +
        value
            .toString(16)
    );
}


function singleBitIndex(
    value
) {

    if (
        value <= 0n
        ||
        (
            value &
            (
                value -
                1n
            )
        )
        !==
        0n
    ) {

        return null;
    }


    let bit =
        0;

    let current =
        value;


    while (
        current >
        1n
    ) {

        current >>=
            1n;

        bit++;
    }


    return bit;
}