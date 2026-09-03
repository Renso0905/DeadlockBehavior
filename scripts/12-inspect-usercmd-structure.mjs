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
        'usercmd_structure_diagnostic.json'
    );


const parser =
    new Parser();


// ============================================================
// TRACKING
// ============================================================

let userCmdPackets =
    0;

let commandsSeen =
    0;


const byPlayerSlot =
    new Map();


const samples =
    [];


const MAX_SAMPLES =
    60;

const MAX_PER_SLOT =
    5;


const sampleCountBySlot =
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


        userCmdPackets++;


        const commands =
            messagePacket.data
                ?.commands
            ?? [];


        for (
            const command
            of commands
        ) {

            commandsSeen++;


            const playerSlot =
                firstDefined(

                    command.playerSlot,

                    command.player_slot
                );


            const cmdNumber =
                firstDefined(

                    command.cmdNumber,

                    command.cmd_number
                );


            const serverTickExecuted =
                firstDefined(

                    command.serverTickExecuted,

                    command.server_tick_executed
                );


            const clientTick =
                firstDefined(

                    command.clientTick,

                    command.client_tick
                );


            // =================================================
            // SLOT COUNTS
            // =================================================

            const slotKey =
                String(
                    playerSlot
                    ?? 'unknown'
                );


            if (
                !byPlayerSlot.has(
                    slotKey
                )
            ) {

                byPlayerSlot.set(
                    slotKey,
                    {
                        playerSlot:
                            playerSlot
                            ?? null,

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

                        dataLengths:
                            new Map(),

                        commandKeys:
                            new Set()
                    }
                );
            }


            const stats =
                byPlayerSlot.get(
                    slotKey
                );


            stats.commands++;


            for (
                const key
                of Object.keys(
                    command
                )
            ) {

                stats.commandKeys.add(
                    key
                );
            }


            if (
                stats.firstDemoTick ===
                null
            ) {

                stats.firstDemoTick =
                    demoPacket.tick;
            }


            stats.lastDemoTick =
                demoPacket.tick;


            if (
                Number.isFinite(
                    serverTickExecuted
                )
            ) {

                if (
                    stats.firstServerTick ===
                    null
                ) {

                    stats.firstServerTick =
                        serverTickExecuted;
                }


                stats.lastServerTick =
                    serverTickExecuted;
            }


            const dataInfo =
                describeBytes(
                    command.data
                );


            const lengthKey =
                String(
                    dataInfo.length
                    ?? 'unknown'
                );


            stats.dataLengths.set(
                lengthKey,
                (
                    stats.dataLengths.get(
                        lengthKey
                    )
                    ?? 0
                )
                +
                1
            );


            // =================================================
            // SAVE A FEW EXAMPLES PER PLAYER SLOT
            // =================================================

            const slotSamples =
                sampleCountBySlot.get(
                    slotKey
                )
                ?? 0;


            if (
                samples.length <
                MAX_SAMPLES
                &&
                slotSamples <
                MAX_PER_SLOT
            ) {

                sampleCountBySlot.set(
                    slotKey,
                    slotSamples + 1
                );


                samples.push({

                    demoTick:
                        demoPacket.tick,

                    playerSlot:
                        playerSlot
                        ?? null,

                    cmdNumber:
                        cmdNumber
                        ?? null,

                    serverTickExecuted:
                        serverTickExecuted
                        ?? null,

                    clientTick:
                        clientTick
                        ?? null,

                    commandKeys:
                        Object.keys(
                            command
                        ),

                    data:
                        dataInfo,

                    deltaData:
                        describeBytes(
                            command.deltaData
                            ??
                            command.delta_data
                        )
                });
            }
        }
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');
console.log(
    'Inspecting svc_UserCmds structure...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// FORMAT SLOT SUMMARY
// ============================================================

const slots =
    [...byPlayerSlot.values()]
        .map(
            stats => ({

                playerSlot:
                    stats.playerSlot,

                commands:
                    stats.commands,

                firstDemoTick:
                    stats.firstDemoTick,

                lastDemoTick:
                    stats.lastDemoTick,

                firstServerTick:
                    stats.firstServerTick,

                lastServerTick:
                    stats.lastServerTick,

                commandKeys:
                    [...stats.commandKeys]
                        .sort(),

                mostCommonDataLengths:
                    [...stats.dataLengths.entries()]
                        .map(
                            (
                                [
                                    length,
                                    count
                                ]
                            ) => ({

                                length:
                                    length ===
                                    'unknown'
                                        ? null
                                        : Number(
                                            length
                                        ),

                                count
                            })
                        )
                        .sort(
                            (a, b) =>
                                b.count -
                                a.count
                        )
                        .slice(
                            0,
                            20
                        )
            })
        )
        .sort(
            (a, b) => {

                if (
                    a.playerSlot ===
                    null
                ) {
                    return 1;
                }


                if (
                    b.playerSlot ===
                    null
                ) {
                    return -1;
                }


                return (
                    a.playerSlot -
                    b.playerSlot
                );
            }
        );


// ============================================================
// OUTPUT
// ============================================================

const result = {

    replay:
        replayName,

    userCmdPackets,

    commandsSeen,

    playerSlotsObserved:
        slots.length,

    slots,

    samples
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


console.log('');
console.log(
    '===================================='
);
console.log(
    'USERCMD STRUCTURE DIAGNOSTIC'
);
console.log(
    '===================================='
);
console.log('');

console.log(
    `svc_UserCmds packets: ${userCmdPackets}`
);

console.log(
    `commands inside packets: ${commandsSeen}`
);

console.log(
    `player slots observed: ${slots.length}`
);

console.log('');


for (
    const slot
    of slots
) {

    console.log(
        `slot ${slot.playerSlot}: ${slot.commands} commands`
    );

    console.log(
        `  keys: ${slot.commandKeys.join(', ')}`
    );

    console.log(
        `  common data lengths: ${
            slot.mostCommonDataLengths
                .slice(
                    0,
                    5
                )
                .map(
                    x =>
                        `${x.length}:${x.count}`
                )
                .join(', ')
        }`
    );

    console.log('');
}


console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// HELPERS
// ============================================================

function firstDefined(
    ...values
) {

    for (
        const value
        of values
    ) {

        if (
            value !==
            undefined
            &&
            value !==
            null
        ) {

            return value;
        }
    }


    return null;
}


function describeBytes(
    value
) {

    if (
        value ===
        undefined
        ||
        value ===
        null
    ) {

        return {

            type:
                null,

            length:
                null,

            hexPrefix:
                null
        };
    }


    if (
        Buffer.isBuffer(
            value
        )
        ||
        value instanceof
        Uint8Array
    ) {

        const buffer =
            Buffer.from(
                value
            );


        return {

            type:
                value.constructor
                    ?.name
                ?? 'Uint8Array',

            length:
                buffer.length,

            hexPrefix:
                buffer
                    .subarray(
                        0,
                        80
                    )
                    .toString(
                        'hex'
                    )
        };
    }


    if (
        typeof value ===
        'string'
    ) {

        return {

            type:
                'string',

            length:
                value.length,

            prefix:
                value.slice(
                    0,
                    120
                )
        };
    }


    if (
        Array.isArray(
            value
        )
    ) {

        return {

            type:
                'array',

            length:
                value.length,

            prefix:
                value.slice(
                    0,
                    20
                )
        };
    }


    if (
        typeof value ===
        'object'
    ) {

        return {

            type:
                value.constructor
                    ?.name
                ?? 'object',

            keys:
                Object.keys(
                    value
                ),

            value:
                safeObject(
                    value
                )
        };
    }


    return {

        type:
            typeof value,

        value:
            String(value)
    };
}


function safeObject(
    value
) {

    try {

        return JSON.parse(
            JSON.stringify(
                value,
                (
                    key,
                    item
                ) => {

                    if (
                        typeof item ===
                        'bigint'
                    ) {

                        return item
                            .toString();
                    }


                    if (
                        item instanceof
                        Uint8Array
                    ) {

                        return {

                            type:
                                'Uint8Array',

                            length:
                                item.length
                        };
                    }


                    return item;
                }
            )
        );

    } catch {

        return {
            serializationError:
                true
        };
    }
}