import {
    createReadStream,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
} from 'node:fs';

import {
    dirname,
    resolve
} from 'node:path';

import {
    Parser,
    InterceptorStage,
    EntityOperation
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


const TICK_RATE =
    64;


const ENTITY_INDEX_MASK =
    0x3fff;


const MATCH_CLOCK_OFFSET_SECONDS =
    30;


// A Rejuvenator entity should appear essentially at the
// corresponding Mid Boss destruction.
//
// We use a generous 2 second window only to identify the
// corresponding BossKilled message empirically.
const BOSS_TO_REJUV_PAIR_WINDOW_TICKS =
    2 *
    TICK_RATE;


// Diagnostic lifecycle windows.
//
// These are NOT canonical classification boundaries.
// We only want to see the temporal structure.
const LIFECYCLE_WINDOWS_SECONDS =
    [
        1,
        2,
        4,
        8,
        16,
        30
    ];


// Exact damage-origin signal discovered by Script 36.
const EXACT_ORIGIN_DISTANCE =
    0.25;


const EXACT_ORIGIN_TICK_WINDOW =
    0;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const damageDiagnosticPath =
    resolve(
        'output',
        replayName,
        'breakable_damage_origin_diagnostic.json'
    );


const attributionPath =
    resolve(
        'output',
        replayName,
        'breakable_action_attribution_v1.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_midboss_rejuv_diagnostic.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        replayPath,
        damageDiagnosticPath,
        attributionPath
    ]
) {

    if (
        !existsSync(
            path
        )
    ) {

        throw new Error(
            `Missing required input:\n${path}`
        );
    }
}


// ============================================================
// LOAD INPUTS
// ============================================================

const damageDiagnostic =
    JSON.parse(
        readFileSync(
            damageDiagnosticPath,
            'utf8'
        )
    );


const attribution =
    JSON.parse(
        readFileSync(
            attributionPath,
            'utf8'
        )
    );


// ============================================================
// PLAYER IDENTITY
// ============================================================

const playerByPawnIndex =
    new Map();


const playerByControllerIndex =
    new Map();


for (
    const row
    of attribution.playerSummaries
    ??
    []
) {

    const player =
        {

            playerName:
                row.playerName
                ??
                null,

            heroId:
                toFiniteNumber(
                    row.heroId
                ),

            team:
                toFiniteNumber(
                    row.team
                ),

            pawnEntityIndex:
                toFiniteNumber(
                    row.pawnEntityIndex
                ),

            controllerEntityIndex:
                toFiniteNumber(
                    row.controllerEntityIndex
                )
        };


    if (
        player.pawnEntityIndex !==
        null
    ) {

        playerByPawnIndex.set(
            player.pawnEntityIndex,
            player
        );
    }


    if (
        player.controllerEntityIndex !==
        null
    ) {

        playerByControllerIndex.set(
            player.controllerEntityIndex,
            player
        );
    }
}


// ============================================================
// SOURCE BREAK ROWS
// ============================================================

const breakRows =
    Array.isArray(
        damageDiagnostic.breakRows
    )
        ? damageDiagnostic.breakRows
        : [];


if (
    breakRows.length ===
    0
) {

    throw new Error(
        'Script 36 contains no breakRows.'
    );
}


// ============================================================
// EXACT DAMAGE-ORIGIN MATCHES
//
// We derive them from all Script 36 rows rather than relying
// only on the diagnosticOnly output.
// ============================================================

const exactOriginMatches =
    new Map();


for (
    const row
    of breakRows
) {

    if (
        row.attributionStatus ===
        'ATTRIBUTED'
    ) {

        continue;
    }


    const candidates =
        (
            row.candidates
            ??
            []
        )
        .filter(
            candidate =>
                Math.abs(
                    candidate.tickDelta
                )
                <=
                EXACT_ORIGIN_TICK_WINDOW
                &&
                candidate.originDistance <=
                    EXACT_ORIGIN_DISTANCE
        );


    if (
        candidates.length ===
        0
    ) {

        continue;
    }


    const players =
        uniquePlayers(
            candidates
        );


    if (
        players.length !==
        1
    ) {

        continue;
    }


    exactOriginMatches.set(
        row.breakKey,
        {

            player:
                players[0],

            candidates
        }
    );
}


// ============================================================
// SAME-IMPACT CLUSTERS FROM SCRIPT 36
// ============================================================

const sourceClusters =
    damageDiagnostic
        ?.unresolvedStructure
        ?.sameImpactClusters
    ??
    [];


if (
    sourceClusters.length ===
    0
) {

    throw new Error(
        'Script 36 contains no same-impact clusters.'
    );
}


// ============================================================
// CAPTURED REPLAY EVENTS
// ============================================================

const bossKilledEvents =
    [];


const rejuvStatusEvents =
    [];


const midBossSpawnedEvents =
    [];


const gameOverEvents =
    [];


const rejuvPickupEntities =
    [];


const seenRejuvPickupEntityIndexes =
    new Set();


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// MESSAGE EVENTS
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        const tick =
            toFiniteNumber(
                demoPacket.tick
            );


        if (
            tick ===
            null
        ) {

            return;
        }


        const typeCode =
            getMessageTypeCode(
                messagePacket
            );


        const data =
            messagePacket.data
            ??
            {};


        // ====================================================
        // BOSS KILLED
        // ====================================================

        if (
            typeCode ===
            'k_EUserMsg_BossKilled'
        ) {

            const rawKiller =
                toFiniteNumber(
                    data.entityKiller
                );


            bossKilledEvents.push({

                tick,

                matchTimeSeconds:
                    tickToMatchTime(
                        tick
                    ),

                clock:
                    formatClock(
                        tickToMatchTime(
                            tick
                        )
                    ),

                objectiveTeam:
                    toFiniteNumber(
                        data.objectiveTeam
                    ),

                objectiveMaskChange:
                    toFiniteNumber(
                        data.objectiveMaskChange
                    ),

                entityKilled:
                    serializeValue(
                        data.entityKilled
                    ),

                entityKilledIndex:
                    decodeEntityIndex(
                        data.entityKilled
                    ),

                entityKilledClass:
                    toFiniteNumber(
                        data.entityKilledClass
                    ),

                entityKiller:
                    serializeValue(
                        data.entityKiller
                    ),

                entityKillerIndex:
                    decodeEntityIndex(
                        rawKiller
                    ),

                killerPlayer:
                    resolvePlayerHandle(
                        rawKiller
                    ),

                gametime:
                    toFiniteNumber(
                        data.gametime
                    ),

                bossesRemaining:
                    toFiniteNumber(
                        data.bossesRemaining
                    ),

                entityPosition:
                    normalizePosition(
                        data.entityPosition
                    )
            });


            return;
        }


        // ====================================================
        // REJUV STATUS
        // ====================================================

        if (
            typeCode ===
            'k_EUserMsg_RejuvStatus'
        ) {

            const rawPawn =
                toFiniteNumber(
                    data.playerPawn
                );


            rejuvStatusEvents.push({

                tick,

                matchTimeSeconds:
                    tickToMatchTime(
                        tick
                    ),

                clock:
                    formatClock(
                        tickToMatchTime(
                            tick
                        )
                    ),

                eventType:
                    toFiniteNumber(
                        data.eventType
                    ),

                killingTeam:
                    toFiniteNumber(
                        data.killingTeam
                    ),

                userTeam:
                    toFiniteNumber(
                        data.userTeam
                    ),

                playerPawn:
                    serializeValue(
                        data.playerPawn
                    ),

                playerPawnIndex:
                    decodeEntityIndex(
                        rawPawn
                    ),

                player:
                    resolvePlayerHandle(
                        rawPawn
                    )
            });


            return;
        }


        // ====================================================
        // MID BOSS SPAWNED
        // ====================================================

        if (
            typeCode ===
            'k_EUserMsg_MidBossSpawned'
        ) {

            midBossSpawnedEvents.push({

                tick,

                matchTimeSeconds:
                    tickToMatchTime(
                        tick
                    ),

                clock:
                    formatClock(
                        tickToMatchTime(
                            tick
                        )
                    ),

                data:
                    jsonSafe(
                        data
                    )
            });


            return;
        }


        // ====================================================
        // GAME OVER
        // ====================================================

        if (
            typeCode ===
            'k_EUserMsg_GameOver'
        ) {

            gameOverEvents.push({

                tick,

                matchTimeSeconds:
                    tickToMatchTime(
                        tick
                    ),

                clock:
                    formatClock(
                        tickToMatchTime(
                            tick
                        )
                    ),

                data:
                    jsonSafe(
                        data
                    )
            });
        }
    }
);


// ============================================================
// REJUVENATOR ENTITY CREATION
//
// There are exactly three unique CCitadelItemPickupRejuv
// entities in this replay.
//
// First appearance of each persistent entity is much safer than
// treating every CREATE as a gameplay spawn.
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.ENTITY_PACKET,

    (
        demoPacket,
        messagePacket,
        events
    ) => {

        const tick =
            toFiniteNumber(
                demoPacket.tick
            );


        if (
            tick ===
            null
        ) {

            return;
        }


        for (
            const event
            of events
        ) {

            const entity =
                event.entity;


            if (
                !entity
                ||
                entity.class?.name !==
                    'CCitadelItemPickupRejuv'
            ) {

                continue;
            }


            if (
                event.operation !==
                EntityOperation.CREATE
            ) {

                continue;
            }


            const entityIndex =
                toFiniteNumber(
                    entity.index
                );


            if (
                entityIndex ===
                null
                ||
                seenRejuvPickupEntityIndexes.has(
                    entityIndex
                )
            ) {

                continue;
            }


            seenRejuvPickupEntityIndexes.add(
                entityIndex
            );


            rejuvPickupEntities.push({

                entityIndex,

                tick,

                matchTimeSeconds:
                    tickToMatchTime(
                        tick
                    ),

                clock:
                    formatClock(
                        tickToMatchTime(
                            tick
                        )
                    ),

                worldPosition:
                    getWorldPosition(
                        entity
                    ),

                createTime:
                    toFiniteNumber(
                        safeGetField(
                            entity,
                            'm_flCreateTime'
                        )
                    ),

                team:
                    toFiniteNumber(
                        safeGetField(
                            entity,
                            'm_iTeamNum'
                        )
                    ),

                ownerHandle:
                    serializeValue(
                        safeGetField(
                            entity,
                            'm_hOwnerEntity'
                        )
                    )
            });
        }
    }
);


// ============================================================
// RUN
// ============================================================

console.log('');

console.log(
    '==========================================='
);

console.log(
    'BREAKABLE MIDBOSS / REJUV DIAGNOSTIC'
);

console.log(
    '==========================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Same-impact unresolved clusters: ${sourceClusters.length}`
);

console.log(
    `Exact unresolved damage-origin matches: ${exactOriginMatches.size}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// SORT CAPTURED EVENTS
// ============================================================

bossKilledEvents.sort(
    byTick
);


rejuvStatusEvents.sort(
    byTick
);


midBossSpawnedEvents.sort(
    byTick
);


rejuvPickupEntities.sort(
    byTick
);


gameOverEvents.sort(
    byTick
);


// ============================================================
// IDENTIFY MID BOSS KILL CANDIDATES
//
// Rather than assuming entityKilledClass semantics:
//
// 1. Find each unique Rejuvenator pickup first appearance.
// 2. Find the nearest BossKilled event.
// 3. If it falls within ±2 seconds, treat that BossKilled event
//    as a MID_BOSS_KILL_CANDIDATE.
//
// This is empirical linkage, not class-name guessing.
// ============================================================

const rejuvToBossPairs =
    [];


for (
    const pickup
    of rejuvPickupEntities
) {

    const nearest =
        nearestEvent(
            bossKilledEvents,
            pickup.tick
        );


    const deltaTicks =
        nearest
            ? pickup.tick -
                nearest.tick
            : null;


    const validPair =
        nearest
        &&
        Math.abs(
            deltaTicks
        )
        <=
        BOSS_TO_REJUV_PAIR_WINDOW_TICKS;


    rejuvToBossPairs.push({

        rejuvPickup:
            pickup,

        nearestBossKilled:
            nearest,

        deltaTicks,

        deltaSeconds:
            deltaTicks ===
                null
                ? null
                : deltaTicks /
                    TICK_RATE,

        validPair:
            Boolean(
                validPair
            )
    });
}


const midBossKillCandidateMap =
    new Map();


for (
    const pair
    of rejuvToBossPairs
) {

    if (
        !pair.validPair
        ||
        !pair.nearestBossKilled
    ) {

        continue;
    }


    midBossKillCandidateMap.set(
        pair.nearestBossKilled.tick,
        {

            ...pair.nearestBossKilled,

            pairedRejuvPickup:
                pair.rejuvPickup,

            pickupDeltaTicks:
                pair.deltaTicks,

            pickupDeltaSeconds:
                pair.deltaSeconds
        }
    );
}


const midBossKillCandidates =
    [
        ...midBossKillCandidateMap.values()
    ]
    .sort(
        byTick
    );


// ============================================================
// CLUSTER CORRELATION
// ============================================================

const clusterCorrelations =
    sourceClusters

        .map(
            cluster => {

                const tick =
                    toFiniteNumber(
                        cluster.tick
                    );


                const resources =
                    cluster.resources
                    ??
                    [];


                const resourceBreakKeys =
                    resources

                        .map(
                            row =>
                                row.breakKey
                        )

                        .filter(
                            Boolean
                        );


                const exactRows =
                    resourceBreakKeys

                        .filter(
                            breakKey =>
                                exactOriginMatches.has(
                                    breakKey
                                )
                        );


                const exactPlayers =
                    uniquePlayersFromObjects(
                        exactRows.map(
                            breakKey =>
                                exactOriginMatches.get(
                                    breakKey
                                )
                                    ?.player
                        )
                    );


                const nearestMidBossKill =
                    nearestEvent(
                        midBossKillCandidates,
                        tick
                    );


                const nearestRejuvPickup =
                    nearestEvent(
                        rejuvPickupEntities,
                        tick
                    );


                const nearestRejuvStatus =
                    nearestEvent(
                        rejuvStatusEvents,
                        tick
                    );


                const nearestBossKilled =
                    nearestEvent(
                        bossKilledEvents,
                        tick
                    );


                const nearestGameOver =
                    nearestEvent(
                        gameOverEvents,
                        tick
                    );


                const extent =
                    resourceExtent(
                        resources
                    );


                const midBossDelta =
                    eventDelta(
                        tick,
                        nearestMidBossKill
                    );


                const rejuvPickupDelta =
                    eventDelta(
                        tick,
                        nearestRejuvPickup
                    );


                const rejuvStatusDelta =
                    eventDelta(
                        tick,
                        nearestRejuvStatus
                    );


                return {

                    clusterKey:
                        cluster.key,

                    tick,

                    matchTimeSeconds:
                        tickToMatchTime(
                            tick
                        ),

                    clock:
                        cluster.clock
                        ??
                        formatClock(
                            tickToMatchTime(
                                tick
                            )
                        ),

                    breakCount:
                        toFiniteNumber(
                            cluster.breakCount
                        )
                        ??
                        resources.length,

                    impactPosition:
                        normalizePosition(
                            cluster.impactPosition
                        ),

                    debrisDamageValues:
                        cluster.debrisDamageValues
                        ??
                        [],

                    resourceTypeCounts:
                        countBy(
                            resources,
                            row =>
                                row.resourceType
                                ??
                                'UNKNOWN'
                        ),

                    extent,

                    resourceBreakKeys,

                    exactPlayerDamageOrigin:
                        {

                            breakCount:
                                exactRows.length,

                            breakKeys:
                                exactRows,

                            uniquePlayers:
                                exactPlayers,

                            uniquePlayerCount:
                                exactPlayers.length
                        },

                    nearestMidBossKillCandidate:
                        summarizeNearbyEvent(
                            tick,
                            nearestMidBossKill
                        ),

                    nearestRejuvPickup:
                        summarizeNearbyEvent(
                            tick,
                            nearestRejuvPickup
                        ),

                    nearestRejuvStatus:
                        summarizeNearbyEvent(
                            tick,
                            nearestRejuvStatus
                        ),

                    nearestBossKilledAnyType:
                        summarizeNearbyEvent(
                            tick,
                            nearestBossKilled
                        ),

                    nearestGameOver:
                        summarizeNearbyEvent(
                            tick,
                            nearestGameOver
                        ),

                    lifecycleFlags:
                        {

                            afterMidBossKill:
                                lifecycleFlags(
                                    midBossDelta
                                ),

                            afterRejuvPickup:
                                lifecycleFlags(
                                    rejuvPickupDelta
                                ),

                            aroundRejuvStatus:
                                symmetricLifecycleFlags(
                                    rejuvStatusDelta
                                )
                        }
                };
            }
        )

        .sort(
            (
                a,
                b
            ) =>
                b.breakCount -
                a.breakCount
        );


// ============================================================
// MID BOSS LIFECYCLE WINDOWS
// ============================================================

const lifecycleCycles =
    [];


for (
    const kill
    of midBossKillCandidates
) {

    const pairedPickup =
        kill.pairedRejuvPickup
        ??
        null;


    const nearbyClusters =
        clusterCorrelations

            .filter(
                cluster => {

                    const deltaSeconds =
                        (
                            cluster.tick -
                            kill.tick
                        )
                        /
                        TICK_RATE;


                    return (
                        deltaSeconds >=
                            -2
                        &&
                        deltaSeconds <=
                            30
                    );
                }
            )

            .map(
                cluster => ({

                    clusterKey:
                        cluster.clusterKey,

                    tick:
                        cluster.tick,

                    clock:
                        cluster.clock,

                    secondsAfterKill:
                        (
                            cluster.tick -
                            kill.tick
                        )
                        /
                        TICK_RATE,

                    secondsAfterRejuvPickup:
                        pairedPickup
                            ? (
                                cluster.tick -
                                pairedPickup.tick
                            )
                            /
                            TICK_RATE
                            : null,

                    breakCount:
                        cluster.breakCount,

                    debrisDamageValues:
                        cluster.debrisDamageValues,

                    exactPlayerDamageOriginBreaks:
                        cluster
                            .exactPlayerDamageOrigin
                            .breakCount,

                    exactOriginPlayers:
                        cluster
                            .exactPlayerDamageOrigin
                            .uniquePlayers
                })
            );


    const nearbyRejuvStatuses =
        rejuvStatusEvents

            .filter(
                event => {

                    const deltaSeconds =
                        (
                            event.tick -
                            kill.tick
                        )
                        /
                        TICK_RATE;


                    return (
                        deltaSeconds >=
                            -2
                        &&
                        deltaSeconds <=
                            30
                    );
                }
            )

            .map(
                event => ({

                    ...event,

                    secondsAfterKill:
                        (
                            event.tick -
                            kill.tick
                        )
                        /
                        TICK_RATE
                })
            );


    lifecycleCycles.push({

        midBossKillCandidate:
            kill,

        pairedRejuvPickup:
            pairedPickup,

        nearbyClusterCount:
            nearbyClusters.length,

        nearbyBreakCount:
            nearbyClusters.reduce(
                (
                    total,
                    row
                ) =>
                    total +
                    row.breakCount,
                0
            ),

        nearbyClusters,

        nearbyRejuvStatuses
    });
}


// ============================================================
// WINDOW SUMMARIES
// ============================================================

const midBossWindowSummary =
    {};


for (
    const seconds
    of LIFECYCLE_WINDOWS_SECONDS
) {

    const clusters =
        clusterCorrelations.filter(
            cluster => {

                const delta =
                    cluster
                        ?.nearestMidBossKillCandidate
                        ?.deltaSeconds;


                return (
                    Number.isFinite(
                        delta
                    )
                    &&
                    delta >=
                        0
                    &&
                    delta <=
                        seconds
                );
            }
        );


    midBossWindowSummary[
        `${seconds}s`
    ] =
        {

            clusters:
                clusters.length,

            breaks:
                clusters.reduce(
                    (
                        total,
                        row
                    ) =>
                        total +
                        row.breakCount,
                    0
                ),

            exactPlayerOriginBreaks:
                clusters.reduce(
                    (
                        total,
                        row
                    ) =>
                        total +
                        row
                            .exactPlayerDamageOrigin
                            .breakCount,
                    0
                )
        };
}


// ============================================================
// REJUV STATUS WINDOW SUMMARY
// ============================================================

const rejuvStatusWindowSummary =
    {};


for (
    const seconds
    of LIFECYCLE_WINDOWS_SECONDS
) {

    const clusters =
        clusterCorrelations.filter(
            cluster => {

                const delta =
                    cluster
                        ?.nearestRejuvStatus
                        ?.deltaSeconds;


                return (
                    Number.isFinite(
                        delta
                    )
                    &&
                    Math.abs(
                        delta
                    )
                    <=
                        seconds
                );
            }
        );


    rejuvStatusWindowSummary[
        `${seconds}s`
    ] =
        {

            clusters:
                clusters.length,

            breaks:
                clusters.reduce(
                    (
                        total,
                        row
                    ) =>
                        total +
                        row.breakCount,
                    0
                )
        };
}


// ============================================================
// DAMAGE SIGNATURE CORRELATION
// ============================================================

const damageSignatureMap =
    new Map();


for (
    const cluster
    of clusterCorrelations
) {

    const values =
        cluster.debrisDamageValues.length >
            0

            ? cluster.debrisDamageValues

            : [
                null
            ];


    for (
        const value
        of values
    ) {

        const key =
            value ===
                null

                ? 'NULL'

                : String(
                    roundNumber(
                        value,
                        3
                    )
                );


        if (
            !damageSignatureMap.has(
                key
            )
        ) {

            damageSignatureMap.set(
                key,
                {

                    damage:
                        value,

                    clusters:
                        0,

                    breaks:
                        0,

                    exactPlayerDamageOriginBreaks:
                        0,

                    within30SecondsAfterMidBossKillClusters:
                        0,

                    within30SecondsAfterMidBossKillBreaks:
                        0,

                    clocks:
                        []
                }
            );
        }


        const row =
            damageSignatureMap.get(
                key
            );


        row.clusters++;


        row.breaks +=
            cluster.breakCount;


        row.exactPlayerDamageOriginBreaks +=
            cluster
                .exactPlayerDamageOrigin
                .breakCount;


        const delta =
            cluster
                ?.nearestMidBossKillCandidate
                ?.deltaSeconds;


        if (
            Number.isFinite(
                delta
            )
            &&
            delta >=
                0
            &&
            delta <=
                30
        ) {

            row
                .within30SecondsAfterMidBossKillClusters++;


            row
                .within30SecondsAfterMidBossKillBreaks +=
                cluster.breakCount;
        }


        row.clocks.push(
            cluster.clock
        );
    }
}


const damageSignatureSummary =
    [
        ...damageSignatureMap.values()
    ]

        .sort(
            (
                a,
                b
            ) =>
                b.breaks -
                a.breaks
        );


// ============================================================
// EXACT ORIGIN MATCH SUMMARY
// ============================================================

const exactOriginRows =
    [];


for (
    const [
        breakKey,
        match
    ]
    of exactOriginMatches
) {

    const sourceRow =
        breakRows.find(
            row =>
                row.breakKey ===
                breakKey
        );


    exactOriginRows.push({

        breakKey,

        breakTick:
            sourceRow
                ?.breakTick
            ??
            null,

        breakClock:
            sourceRow
                ?.breakClock
            ??
            null,

        resourceType:
            sourceRow
                ?.resourceType
            ??
            null,

        previousAttributionMethod:
            sourceRow
                ?.attributionMethod
            ??
            null,

        player:
            match.player,

        candidateCount:
            match.candidates.length,

        candidates:
            match.candidates
    });
}


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BREAKABLE_MIDBOSS_REJUV_DIAGNOSTIC',

        purpose:
            [

                'Validate whether large unresolved same-impact breakable clusters are associated with the Mid Boss / Rejuvenator lifecycle.',

                'Do not automatically attribute lifecycle-related break destruction to a player.',

                'Retain Script 36 exact-tick/exact-origin player damage matches as a separate candidate player-attribution channel.',

                'Identify Mid Boss kill messages empirically by pairing BossKilled events with first appearance of the three unique CCitadelItemPickupRejuv entities.'
            ],

        sourceCounts:
            {

                totalBreaks:
                    breakRows.length,

                sameImpactClusters:
                    sourceClusters.length,

                breaksInsideSameImpactClusters:
                    damageDiagnostic
                        ?.unresolvedStructure
                        ?.breaksInsideSameImpactClusters
                    ??
                    null,

                exactUnresolvedDamageOriginMatches:
                    exactOriginMatches.size,

                knownPlayers:
                    playerByPawnIndex.size
            },

        capturedReplayEvents:
            {

                bossKilled:
                    bossKilledEvents.length,

                rejuvStatus:
                    rejuvStatusEvents.length,

                midBossSpawned:
                    midBossSpawnedEvents.length,

                rejuvPickupEntities:
                    rejuvPickupEntities.length,

                gameOver:
                    gameOverEvents.length
            },

        rejuvPickupEntities,

        bossKilledEvents,

        rejuvStatusEvents,

        midBossSpawnedEvents,

        gameOverEvents,

        rejuvToBossPairs,

        midBossKillCandidates,

        lifecycleCycles,

        midBossWindowSummary,

        rejuvStatusWindowSummary,

        damageSignatureSummary,

        exactOriginMatches:
            exactOriginRows,

        clusterCorrelations
    };


// ============================================================
// WRITE
// ============================================================

mkdirSync(
    dirname(
        outputPath
    ),
    {
        recursive: true
    }
);


writeFileSync(

    outputPath,

    JSON.stringify(
        output,
        null,
        2
    ),

    'utf8'
);


// ============================================================
// CONSOLE SUMMARY
// ============================================================

console.log(
    'CAPTURED EVENTS'
);

console.log(
    '---------------'
);

console.log(
    `BossKilled messages: ${bossKilledEvents.length}`
);

console.log(
    `RejuvStatus messages: ${rejuvStatusEvents.length}`
);

console.log(
    `MidBossSpawned messages: ${midBossSpawnedEvents.length}`
);

console.log(
    `Unique Rejuv pickup entities: ${rejuvPickupEntities.length}`
);

console.log(
    `GameOver messages: ${gameOverEvents.length}`
);

console.log('');


console.log(
    'REJUV PICKUP → BOSS KILL PAIRS'
);

console.log(
    '------------------------------'
);


for (
    const pair
    of rejuvToBossPairs
) {

    console.log(
        `Rejuv ${
            pair.rejuvPickup.clock
        }  nearest BossKilled=${
            pair.nearestBossKilled
                ?.clock
            ??
            'NONE'
        }  delta=${
            formatSignedSeconds(
                pair.deltaSeconds
            )
        }  ${
            pair.validPair
                ? 'PAIR'
                : 'NO_PAIR'
        }`
    );
}


console.log('');


console.log(
    'MID BOSS KILL CANDIDATES'
);

console.log(
    '------------------------'
);


for (
    const event
    of midBossKillCandidates
) {

    console.log(
        `${
            event.clock
        }  tick=${
            event.tick
        }  killedClass=${
            event.entityKilledClass
        }  position=${
            formatPosition(
                event.entityPosition
            )
        }  rejuvDelta=${
            formatSignedSeconds(
                event.pickupDeltaSeconds
            )
        }`
    );
}


console.log('');


console.log(
    'LARGEST SAME-IMPACT CLUSTERS'
);

console.log(
    '----------------------------'
);


for (
    const cluster
    of clusterCorrelations.slice(
        0,
        20
    )
) {

    console.log(
        `${
            String(
                cluster.clock
            ).padEnd(
                8
            )
        } breaks=${
            String(
                cluster.breakCount
            ).padStart(
                3
            )
        } damage=${
            String(
                cluster
                    .debrisDamageValues
                    .map(
                        value =>
                            roundNumber(
                                value,
                                3
                            )
                    )
                    .join(
                        ','
                    )
            ).padStart(
                12
            )
        } exactPlayer=${
            String(
                cluster
                    .exactPlayerDamageOrigin
                    .breakCount
            ).padStart(
                2
            )
        } midBossΔ=${
            String(
                formatSignedSeconds(
                    cluster
                        ?.nearestMidBossKillCandidate
                        ?.deltaSeconds
                )
            ).padStart(
                9
            )
        } rejuvStatusΔ=${
            String(
                formatSignedSeconds(
                    cluster
                        ?.nearestRejuvStatus
                        ?.deltaSeconds
                )
            ).padStart(
                9
            )
        }`
    );
}


console.log('');


console.log(
    'MID BOSS WINDOW SUMMARY'
);

console.log(
    '-----------------------'
);


for (
    const [
        window,
        summary
    ]
    of Object.entries(
        midBossWindowSummary
    )
) {

    console.log(
        `${window.padStart(
            4
        )}  clusters=${
            String(
                summary.clusters
            ).padStart(
                3
            )
        }  breaks=${
            String(
                summary.breaks
            ).padStart(
                3
            )
        }  exactPlayer=${
            String(
                summary.exactPlayerOriginBreaks
            ).padStart(
                3
            )
        }`
    );
}


console.log('');


console.log(
    'TOP DAMAGE SIGNATURES'
);

console.log(
    '---------------------'
);


for (
    const row
    of damageSignatureSummary.slice(
        0,
        15
    )
) {

    console.log(
        `damage=${
            String(
                roundNumber(
                    row.damage,
                    3
                )
            ).padStart(
                10
            )
        }  clusters=${
            String(
                row.clusters
            ).padStart(
                3
            )
        }  breaks=${
            String(
                row.breaks
            ).padStart(
                3
            )
        }  within30sMidBoss=${
            String(
                row
                    .within30SecondsAfterMidBossKillBreaks
            ).padStart(
                3
            )
        }  exactPlayer=${
            String(
                row
                    .exactPlayerDamageOriginBreaks
            ).padStart(
                3
            )
        }`
    );
}


console.log('');


console.log(
    'EXACT DAMAGE-ORIGIN CHANNEL'
);

console.log(
    '---------------------------'
);

console.log(
    `Unresolved exact-tick/exact-origin matches: ${exactOriginRows.length}`
);


console.log(
    `Previous NONE_V1: ${
        exactOriginRows.filter(
            row =>
                row.previousAttributionMethod ===
                'NONE_V1'
        ).length
    }`
);


console.log(
    `Previous ambiguous bullet: ${
        exactOriginRows.filter(
            row =>
                row.previousAttributionMethod ===
                'BULLET_RAY_MULTIPLE_PLAYERS'
        ).length
    }`
);


console.log('');


console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// NEAREST EVENT
// ============================================================

function nearestEvent(
    events,
    targetTick
) {

    if (
        !Array.isArray(
            events
        )
        ||
        events.length ===
            0
        ||
        !Number.isFinite(
            targetTick
        )
    ) {

        return null;
    }


    let best =
        null;


    let bestDistance =
        Infinity;


    for (
        const event
        of events
    ) {

        const distance =
            Math.abs(
                event.tick -
                targetTick
            );


        if (
            distance <
            bestDistance
        ) {

            bestDistance =
                distance;


            best =
                event;
        }
    }


    return best;
}


// ============================================================
// EVENT DELTA
//
// Positive means:
//     target cluster happened AFTER event.
// ============================================================

function eventDelta(
    targetTick,
    event
) {

    if (
        !event
        ||
        !Number.isFinite(
            targetTick
        )
        ||
        !Number.isFinite(
            event.tick
        )
    ) {

        return null;
    }


    return (
        targetTick -
        event.tick
    )
    /
    TICK_RATE;
}


// ============================================================
// EVENT SUMMARY
// ============================================================

function summarizeNearbyEvent(
    targetTick,
    event
) {

    if (
        !event
    ) {

        return null;
    }


    return {

        tick:
            event.tick,

        clock:
            event.clock
            ??
            formatClock(
                event.matchTimeSeconds
            ),

        deltaTicks:
            targetTick -
            event.tick,

        deltaSeconds:
            (
                targetTick -
                event.tick
            )
            /
            TICK_RATE,

        event
    };
}


// ============================================================
// DIRECTIONAL LIFECYCLE FLAGS
// ============================================================

function lifecycleFlags(
    deltaSeconds
) {

    const output =
        {};


    for (
        const seconds
        of LIFECYCLE_WINDOWS_SECONDS
    ) {

        output[
            `within${seconds}sAfter`
        ] =
            (
                Number.isFinite(
                    deltaSeconds
                )
                &&
                deltaSeconds >=
                    0
                &&
                deltaSeconds <=
                    seconds
            );
    }


    return output;
}


// ============================================================
// SYMMETRIC LIFECYCLE FLAGS
// ============================================================

function symmetricLifecycleFlags(
    deltaSeconds
) {

    const output =
        {};


    for (
        const seconds
        of LIFECYCLE_WINDOWS_SECONDS
    ) {

        output[
            `within${seconds}s`
        ] =
            (
                Number.isFinite(
                    deltaSeconds
                )
                &&
                Math.abs(
                    deltaSeconds
                )
                <=
                    seconds
            );
    }


    return output;
}


// ============================================================
// PLAYER HANDLE RESOLUTION
// ============================================================

function resolvePlayerHandle(
    value
) {

    const numeric =
        toFiniteNumber(
            value
        );


    if (
        numeric ===
        null
    ) {

        return null;
    }


    if (
        playerByPawnIndex.has(
            numeric
        )
    ) {

        return playerByPawnIndex.get(
            numeric
        );
    }


    if (
        playerByControllerIndex.has(
            numeric
        )
    ) {

        return playerByControllerIndex.get(
            numeric
        );
    }


    const decoded =
        decodeEntityIndex(
            numeric
        );


    if (
        decoded !==
            null
        &&
        playerByPawnIndex.has(
            decoded
        )
    ) {

        return playerByPawnIndex.get(
            decoded
        );
    }


    if (
        decoded !==
            null
        &&
        playerByControllerIndex.has(
            decoded
        )
    ) {

        return playerByControllerIndex.get(
            decoded
        );
    }


    return null;
}


// ============================================================
// ENTITY INDEX FROM HANDLE
// ============================================================

function decodeEntityIndex(
    value
) {

    const number =
        toFiniteNumber(
            value
        );


    if (
        number ===
        null
    ) {

        return null;
    }


    return (
        Math.trunc(
            number
        )
        &
        ENTITY_INDEX_MASK
    );
}


// ============================================================
// UNIQUE PLAYERS FROM CANDIDATES
// ============================================================

function uniquePlayers(
    candidates
) {

    return uniquePlayersFromObjects(
        candidates.map(
            candidate =>
                candidate.player
        )
    );
}


// ============================================================
// UNIQUE PLAYER OBJECTS
// ============================================================

function uniquePlayersFromObjects(
    players
) {

    const map =
        new Map();


    for (
        const player
        of players
    ) {

        if (
            !player
        ) {

            continue;
        }


        const key =
            player.pawnEntityIndex !==
                null
                &&
                player.pawnEntityIndex !==
                    undefined

                ? `pawn:${player.pawnEntityIndex}`

                : `name:${player.playerName}`;


        if (
            !map.has(
                key
            )
        ) {

            map.set(
                key,
                player
            );
        }
    }


    return [
        ...map.values()
    ];
}


// ============================================================
// RESOURCE EXTENT
// ============================================================

function resourceExtent(
    resources
) {

    const positions =
        resources

            .map(
                row =>
                    normalizePosition(
                        row.position
                    )
            )

            .filter(
                Boolean
            );


    if (
        positions.length ===
        0
    ) {

        return {

            count:
                0,

            minX:
                null,

            maxX:
                null,

            minY:
                null,

            maxY:
                null,

            minZ:
                null,

            maxZ:
                null,

            widthX:
                null,

            widthY:
                null,

            heightZ:
                null,

            centroid:
                null
        };
    }


    const xs =
        positions.map(
            position =>
                position.x
        );


    const ys =
        positions.map(
            position =>
                position.y
        );


    const zs =
        positions.map(
            position =>
                position.z
        );


    const minX =
        Math.min(
            ...xs
        );


    const maxX =
        Math.max(
            ...xs
        );


    const minY =
        Math.min(
            ...ys
        );


    const maxY =
        Math.max(
            ...ys
        );


    const minZ =
        Math.min(
            ...zs
        );


    const maxZ =
        Math.max(
            ...zs
        );


    return {

        count:
            positions.length,

        minX,

        maxX,

        minY,

        maxY,

        minZ,

        maxZ,

        widthX:
            maxX -
            minX,

        widthY:
            maxY -
            minY,

        heightZ:
            maxZ -
            minZ,

        centroid:
            {

                x:
                    mean(
                        xs
                    ),

                y:
                    mean(
                        ys
                    ),

                z:
                    mean(
                        zs
                    )
            }
    };
}


// ============================================================
// ENTITY WORLD POSITION
// ============================================================

function getWorldPosition(
    entity
) {

    const cellX =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_cellX'
            )
        );


    const cellY =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_cellY'
            )
        );


    const cellZ =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_cellZ'
            )
        );


    const vecX =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_vecX'
            )
        );


    const vecY =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_vecY'
            )
        );


    const vecZ =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_vecZ'
            )
        );


    if (
        cellX ===
            null
        ||
        cellY ===
            null
        ||
        vecX ===
            null
        ||
        vecY ===
            null
    ) {

        return null;
    }


    return {

        x:
            cellX *
            512
            -
            16384
            +
            vecX,

        y:
            cellY *
            512
            -
            16384
            +
            vecY,

        z:
            cellZ !==
                null
                &&
                vecZ !==
                    null

                ? cellZ *
                    512
                    -
                    16384
                    +
                    vecZ

                : null
    };
}


// ============================================================
// SAFE ENTITY FIELD
// ============================================================

function safeGetField(
    entity,
    field
) {

    try {

        return entity.getField(
            field
        );

    } catch {

        return undefined;
    }
}


// ============================================================
// MESSAGE TYPE
// ============================================================

function getMessageTypeCode(
    messagePacket
) {

    return (
        messagePacket
            ?.type
            ?._code
        ??
        messagePacket
            ?.type
            ?.code
        ??
        null
    );
}


// ============================================================
// NORMALIZE POSITION
// ============================================================

function normalizePosition(
    value
) {

    if (
        !value
        ||
        typeof value !==
        'object'
    ) {

        return null;
    }


    const x =
        toFiniteNumber(
            value.x
        );


    const y =
        toFiniteNumber(
            value.y
        );


    const z =
        toFiniteNumber(
            value.z
        );


    if (
        x ===
        null
        ||
        y ===
        null
    ) {

        return null;
    }


    return {

        x,

        y,

        z:
            z
            ??
            0
    };
}


// ============================================================
// COUNT BY
// ============================================================

function countBy(
    rows,
    selector
) {

    const map =
        new Map();


    for (
        const row
        of rows
    ) {

        const raw =
            selector(
                row
            );


        const key =
            raw ===
                null
                ||
                raw ===
                undefined

                ? 'NULL'

                : String(
                    raw
                );


        map.set(

            key,

            (
                map.get(
                    key
                )
                ??
                0
            )
            +
            1
        );
    }


    return Object.fromEntries(
        [
            ...map.entries()
        ]
        .sort(
            (
                a,
                b
            ) =>
                b[1] -
                a[1]
        )
    );
}


// ============================================================
// MEAN
// ============================================================

function mean(
    values
) {

    if (
        values.length ===
        0
    ) {

        return null;
    }


    return (
        values.reduce(
            (
                total,
                value
            ) =>
                total +
                value,
            0
        )
        /
        values.length
    );
}


// ============================================================
// MATCH CLOCK
// ============================================================

function tickToMatchTime(
    tick
) {

    return (
        tick /
        TICK_RATE
    )
    -
    MATCH_CLOCK_OFFSET_SECONDS;
}


// ============================================================
// CLOCK FORMAT
// ============================================================

function formatClock(
    seconds
) {

    if (
        !Number.isFinite(
            seconds
        )
    ) {

        return null;
    }


    const negative =
        seconds <
        0;


    const absolute =
        Math.abs(
            seconds
        );


    const minutes =
        Math.floor(
            absolute /
            60
        );


    const remainder =
        Math.floor(
            absolute %
            60
        );


    return (
        negative
            ? '-'
            : ''
    )
    +
    `${minutes}:${String(
        remainder
    ).padStart(
        2,
        '0'
    )}`;
}


// ============================================================
// FORMAT POSITION
// ============================================================

function formatPosition(
    position
) {

    if (
        !position
    ) {

        return 'NULL';
    }


    return (
        `(${
            position.x.toFixed(
                1
            )
        }, ${
            position.y.toFixed(
                1
            )
        }, ${
            (
                position.z
                ??
                0
            ).toFixed(
                1
            )
        })`
    );
}


// ============================================================
// SIGNED SECONDS
// ============================================================

function formatSignedSeconds(
    value
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return 'n/a';
    }


    const prefix =
        value >
        0

            ? '+'

            : '';


    return (
        prefix +
        value.toFixed(
            3
        ) +
        's'
    );
}


// ============================================================
// ROUND
// ============================================================

function roundNumber(
    value,
    decimals
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return null;
    }


    const factor =
        10 **
        decimals;


    return (
        Math.round(
            value *
            factor
        )
        /
        factor
    );
}


// ============================================================
// SORT BY TICK
// ============================================================

function byTick(
    a,
    b
) {

    return (
        a.tick -
        b.tick
    );
}


// ============================================================
// NUMBER
// ============================================================

function toFiniteNumber(
    value
) {

    if (
        value ===
        null
        ||
        value ===
        undefined
        ||
        value ===
        ''
    ) {

        return null;
    }


    const number =
        Number(
            value
        );


    return Number.isFinite(
        number
    )

        ? number

        : null;
}


// ============================================================
// SERIALIZE SIMPLE VALUE
// ============================================================

function serializeValue(
    value
) {

    if (
        value ===
        null
        ||
        value ===
        undefined
    ) {

        return null;
    }


    if (
        typeof value ===
        'bigint'
    ) {

        return value.toString();
    }


    if (
        typeof value ===
        'string'
        ||
        typeof value ===
        'number'
        ||
        typeof value ===
        'boolean'
    ) {

        return value;
    }


    return String(
        value
    );
}


// ============================================================
// JSON-SAFE STRUCTURE
// ============================================================

function jsonSafe(
    value
) {

    if (
        value ===
        null
        ||
        value ===
        undefined
    ) {

        return value;
    }


    if (
        typeof value ===
        'bigint'
    ) {

        return value.toString();
    }


    if (
        value instanceof
        Uint8Array
    ) {

        return {

            type:
                'Uint8Array',

            byteLength:
                value.byteLength
        };
    }


    if (
        Array.isArray(
            value
        )
    ) {

        return value.map(
            jsonSafe
        );
    }


    if (
        typeof value ===
        'object'
    ) {

        const output =
            {};


        for (
            const [
                key,
                child
            ]
            of Object.entries(
                value
            )
        ) {

            output[
                key
            ] =
                jsonSafe(
                    child
                );
        }


        return output;
    }


    return value;
}