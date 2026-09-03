import {
    createReadStream,
    createWriteStream,
    readFileSync,
    writeFileSync,
    mkdirSync
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

const outputDir =
    resolve(
        'output',
        replayName
    );

mkdirSync(
    outputDir,
    { recursive: true }
);


const playerSummary =
    JSON.parse(
        readFileSync(
            resolve(
                outputDir,
                'player_state_summary.json'
            ),
            'utf8'
        )
    );


const clockOffset =
    playerSummary.matchClockOffsetSeconds
    ?? 0;


const eventsPath =
    resolve(
        outputDir,
        'player_anim_events.jsonl'
    );

const summaryPath =
    resolve(
        outputDir,
        'player_anim_event_summary.json'
    );


// ============================================================
// DEADLOCK MESSAGE
//
// citadel_gameevents.proto:
//
// GE_PlayerAnimEvent = 451
//
// message CMsgPlayerAnimEvent {
//     fixed32 player = 1;
//     uint32 event = 2;
//     int32 data = 3;
// }
// ============================================================

const PLAYER_ANIM_EVENT_CODE =
    451;


// ============================================================
// TRACKING
// ============================================================

const parser =
    new Parser();


const output =
    createWriteStream(
        eventsPath,
        {
            encoding:
                'utf8'
        }
    );


let totalAnimEvents =
    0;

let unresolvedPlayers =
    0;


const byEvent =
    new Map();


const nearbyPacketTypes =
    new Map();


// ============================================================
// INTERCEPT MESSAGE PACKETS
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        const typeCode =
            getTypeCode(
                messagePacket.type
            );

        const typeName =
            getTypeName(
                messagePacket.type
            );


        // Helpful diagnostic in case packet numbering
        // differs from what the proto indicates.

        if (
            Number.isFinite(typeCode)
            &&
            typeCode >= 445
            &&
            typeCode <= 465
        ) {

            const key =
                `${typeCode}|${typeName}`;

            nearbyPacketTypes.set(
                key,
                (
                    nearbyPacketTypes.get(key)
                    ?? 0
                )
                +
                1
            );
        }


        const looksLikeAnimEvent =
            typeCode ===
            PLAYER_ANIM_EVENT_CODE
            ||
            typeName
                .toLowerCase()
                .includes(
                    'playeranimevent'
                );


        if (
            !looksLikeAnimEvent
        ) {
            return;
        }


        const payload =
            messagePacket.data
            ?? {};


        // Proto should decode as:
        //
        // payload.player
        // payload.event
        // payload.data
        //
        // Alternatives are included defensively.

        const playerHandle =
            firstDefined(
                payload.player,
                payload.m_hPlayer,
                payload.playerHandle
            );


        const eventCode =
            firstDefined(
                payload.event,
                payload.m_iEvent
            );


        const eventData =
            firstDefined(
                payload.data,
                payload.m_nData
            );


        const tick =
            demoPacket.tick;


        const demoSeconds =
            tick / 64;


        const matchTimeSeconds =
            demoSeconds -
            clockOffset;


        const player =
            resolvePlayer(
                playerHandle
            );


        if (
            !player.name
        ) {
            unresolvedPlayers++;
        }


        const record = {

            tick,

            demoSeconds,

            matchTimeSeconds,

            matchClock:
                formatClock(
                    matchTimeSeconds
                ),

            packetTypeCode:
                typeCode,

            packetTypeName:
                typeName,

            playerHandle:
                playerHandle
                ?? null,

            playerEntityIndex:
                player.entityIndex,

            playerEntityClass:
                player.entityClass,

            playerName:
                player.name,

            team:
                player.team,

            heroId:
                player.heroId,

            event:
                eventCode
                ?? null,

            data:
                eventData
                ?? null,

            raw:
                safePlainObject(
                    payload
                )
        };


        output.write(
            JSON.stringify(record)
            +
            '\n'
        );


        totalAnimEvents++;


        // ====================================================
        // SUMMARY COUNTS
        // ====================================================

        const eventKey =
            String(
                eventCode
                ?? 'unknown'
            );


        if (
            !byEvent.has(
                eventKey
            )
        ) {

            byEvent.set(
                eventKey,
                {
                    event:
                        eventCode
                        ?? null,

                    count:
                        0,

                    dataValues:
                        new Map(),

                    players:
                        new Map(),

                    samples:
                        []
                }
            );
        }


        const stats =
            byEvent.get(
                eventKey
            );


        stats.count++;


        const dataKey =
            String(
                eventData
                ?? 'null'
            );


        stats.dataValues.set(
            dataKey,
            (
                stats.dataValues.get(
                    dataKey
                )
                ?? 0
            )
            +
            1
        );


        const playerName =
            player.name
            ?? 'UNRESOLVED';


        stats.players.set(
            playerName,
            (
                stats.players.get(
                    playerName
                )
                ?? 0
            )
            +
            1
        );


        if (
            stats.samples.length <
            20
        ) {

            stats.samples.push({

                matchTimeSeconds,

                matchClock:
                    formatClock(
                        matchTimeSeconds
                    ),

                playerName:
                    player.name,

                playerHandle,

                event:
                    eventCode,

                data:
                    eventData
            });
        }
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');
console.log(
    'Parsing player animation events...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


output.end();


await new Promise(
    resolveFinish => {

        output.on(
            'finish',
            resolveFinish
        );
    }
);


// ============================================================
// BUILD SUMMARY
// ============================================================

const eventResults =
    [...byEvent.values()]
        .map(
            item => ({

                event:
                    item.event,

                count:
                    item.count,

                dataValues:
                    [...item.dataValues.entries()]
                        .map(
                            (
                                [
                                    value,
                                    count
                                ]
                            ) => ({

                                value:
                                    value === 'null'
                                        ? null
                                        : maybeNumber(
                                            value
                                        ),

                                count
                            })
                        )
                        .sort(
                            (a, b) =>
                                b.count -
                                a.count
                        ),

                players:
                    [...item.players.entries()]
                        .map(
                            (
                                [
                                    playerName,
                                    count
                                ]
                            ) => ({

                                playerName,

                                count
                            })
                        )
                        .sort(
                            (a, b) =>
                                b.count -
                                a.count
                        ),

                samples:
                    item.samples
            })
        )
        .sort(
            (a, b) =>
                b.count -
                a.count
        );


const nearbyResults =
    [...nearbyPacketTypes.entries()]
        .map(
            (
                [
                    key,
                    count
                ]
            ) => {

                const separator =
                    key.indexOf('|');


                return {

                    code:
                        Number(
                            key.slice(
                                0,
                                separator
                            )
                        ),

                    name:
                        key.slice(
                            separator + 1
                        ),

                    count
                };
            }
        )
        .sort(
            (a, b) =>
                a.code -
                b.code
        );


const summary = {

    replay:
        replayName,

    targetPacketCode:
        PLAYER_ANIM_EVENT_CODE,

    matchClockOffsetSeconds:
        clockOffset,

    totalAnimEvents,

    unresolvedPlayers,

    distinctEventCodes:
        eventResults.length,

    events:
        eventResults,

    nearbyPacketTypes:
        nearbyResults,

    note:
        'No melee classification has been applied yet. This file is for discovering which event/data combinations correspond to player actions.'
};


writeFileSync(

    summaryPath,

    JSON.stringify(
        summary,
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
    'PLAYER ANIMATION EVENT DISCOVERY'
);
console.log(
    '===================================='
);
console.log('');

console.log(
    `Total animation events: ${totalAnimEvents}`
);

console.log(
    `Distinct event codes: ${eventResults.length}`
);

console.log(
    `Unresolved players: ${unresolvedPlayers}`
);

console.log('');


for (
    const event
    of eventResults
) {

    console.log(
        `event=${event.event} count=${event.count}`
    );


    const topData =
        event.dataValues
            .slice(
                0,
                10
            )
            .map(
                item =>
                    `${item.value}:${item.count}`
            )
            .join(', ');


    console.log(
        `  data: ${topData}`
    );


    const topPlayers =
        event.players
            .slice(
                0,
                5
            )
            .map(
                item =>
                    `${item.playerName}:${item.count}`
            )
            .join(', ');


    console.log(
        `  players: ${topPlayers}`
    );

    console.log('');
}


console.log(
    `Events:\n${eventsPath}`
);

console.log('');

console.log(
    `Summary:\n${summaryPath}`
);


await parser.dispose();


// ============================================================
// PLAYER RESOLUTION
// ============================================================

function resolvePlayer(
    handle
) {

    const empty = {

        entityIndex:
            null,

        entityClass:
            null,

        name:
            null,

        team:
            null,

        heroId:
            null
    };


    if (
        !Number.isFinite(
            Number(handle)
        )
    ) {
        return empty;
    }


    const numericHandle =
        Number(handle);


    const demo =
        parser.getDemo();


    let entity =
        demo.getEntityByHandle(
            numericHandle
        );


    // Source 2 handles store the entity index
    // in the low 15 bits.
    //
    // This is also useful if getEntityByHandle()
    // fails for an animation event.

    const entityIndex =
        numericHandle %
        32768;


    if (!entity) {

        entity =
            demo.getEntity(
                entityIndex
            );
    }


    if (!entity) {

        return {
            ...empty,
            entityIndex
        };
    }


    const className =
        entity.class?.name
        ?? null;


    let pawn =
        null;

    let controller =
        null;


    if (
        className ===
        'CCitadelPlayerPawn'
    ) {

        pawn =
            entity;


        const controllerHandle =
            firstDefined(

                pawn.getField(
                    'm_hController'
                ),

                pawn.getField(
                    'm_hDefaultController'
                )
            );


        if (
            Number.isFinite(
                Number(
                    controllerHandle
                )
            )
        ) {

            controller =
                demo.getEntityByHandle(
                    Number(
                        controllerHandle
                    )
                );
        }
    }


    if (
        className ===
        'CCitadelPlayerController'
    ) {

        controller =
            entity;
    }


    // Fallback:
    // find the controller whose pawn handle/index
    // points at this animation-event entity.

    if (
        !controller
        &&
        pawn
    ) {

        const controllers =
            demo.getEntitiesByClassName(
                'CCitadelPlayerController'
            );


        for (
            const candidate
            of controllers
        ) {

            const pawnHandle =
                firstDefined(

                    candidate.getField(
                        'm_hPawn'
                    ),

                    candidate.getField(
                        'm_hHeroPawn'
                    )
                );


            if (
                !Number.isFinite(
                    Number(
                        pawnHandle
                    )
                )
            ) {
                continue;
            }


            const candidateIndex =
                Number(
                    pawnHandle
                )
                %
                32768;


            if (
                candidateIndex ===
                entity.index
            ) {

                controller =
                    candidate;

                break;
            }
        }
    }


    const name =
        controller
            ?.getField(
                'm_iszPlayerName'
            )
        ?? null;


    const team =
        controller
            ?.getField(
                'm_iTeamNum'
            )
        ??
        pawn
            ?.getField(
                'm_iTeamNum'
            )
        ?? null;


    const heroId =
        pawn
            ?.getField(
                'm_nHeroID'
            )
        ??
        controller
            ?.getField(
                'm_nHeroID'
            )
        ?? null;


    return {

        entityIndex:
            entity.index
            ?? entityIndex,

        entityClass:
            className,

        name,

        team,

        heroId
    };
}


// ============================================================
// TYPE HELPERS
// ============================================================

function getTypeCode(
    type
) {

    if (
        Number.isFinite(
            type?.code
        )
    ) {

        return type.code;
    }


    if (
        Number.isFinite(type)
    ) {

        return type;
    }


    return null;
}


function getTypeName(
    type
) {

    if (
        typeof type?.name ===
        'string'
    ) {

        return type.name;
    }


    if (
        typeof type ===
        'string'
    ) {

        return type;
    }


    return '';
}


// ============================================================
// GENERAL HELPERS
// ============================================================

function firstDefined(
    ...values
) {

    for (
        const value
        of values
    ) {

        if (
            value !== undefined
            &&
            value !== null
        ) {

            return value;
        }
    }


    return null;
}


function formatClock(
    seconds
) {

    const negative =
        seconds < 0;


    const absolute =
        Math.abs(
            Math.floor(seconds)
        );


    const minutes =
        Math.floor(
            absolute / 60
        );


    const secs =
        absolute % 60;


    return (
        negative
            ? '-'
            : ''
    )
    +
    `${minutes}:`
    +
    String(secs)
        .padStart(
            2,
            '0'
        );
}


function maybeNumber(
    value
) {

    const number =
        Number(value);


    return Number.isFinite(number)
        ? number
        : value;
}


function safePlainObject(
    value
) {

    try {

        return JSON.parse(
            JSON.stringify(value)
        );

    } catch {

        return {
            serializationError:
                true
        };
    }
}