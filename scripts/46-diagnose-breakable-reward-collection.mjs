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

import readline from 'node:readline';

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


const MATCH_CLOCK_OFFSET_SECONDS =
    30;


// Player state is sampled every ~0.25 seconds.
//
// We interpolate only when the surrounding samples are close
// enough to the collection event.
const MAX_BRACKET_GAP_SECONDS =
    0.50;


// Thresholds are diagnostic only.
//
// We do NOT yet know the actual pickup collection radius.
const DISTANCE_THRESHOLDS =
    [
        16,
        32,
        48,
        64,
        96,
        128,
        160,
        192,
        256,
        384
    ];


// Joint horizontal / vertical diagnostics.
const XY_THRESHOLDS =
    [
        16,
        32,
        48,
        64,
        96,
        128,
        160,
        192,
        256
    ];


const Z_THRESHOLDS =
    [
        16,
        32,
        64,
        96
    ];


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const breakableCatalogPath =
    resolve(
        'output',
        replayName,
        'breakable_catalog_v1.json'
    );


const playerStatePath =
    resolve(
        'output',
        replayName,
        'player_state.jsonl'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_reward_collection_diagnostic.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        replayPath,
        breakableCatalogPath,
        playerStatePath
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
// LOAD BREAKABLE CATALOG
// ============================================================

const catalog =
    JSON.parse(
        readFileSync(
            breakableCatalogPath,
            'utf8'
        )
    );


if (
    catalog
        ?.validation
        ?.pass !==
    true
) {

    throw new Error(
        'breakable_catalog_v1.json is not validation PASS.'
    );
}


// ============================================================
// SUCCESSFUL REWARD EVENTS
// ============================================================

const rewardEvents =
    [];


for (
    const breakEvent
    of catalog.breakEvents
    ??
    []
) {

    const reward =
        breakEvent.rewardOutcome
        ??
        {};


    if (
        reward.dropped !==
        true
    ) {

        continue;
    }


    const pickupEntityIndex =
        finite(
            reward.pickupEntityIndex
        );


    if (
        pickupEntityIndex ===
        null
    ) {

        continue;
    }


    rewardEvents.push({

        breakKey:
            breakEvent.breakKey,

        breakableEntityIndex:
            finite(
                breakEvent.entityIndex
            ),

        breakableType:
            breakEvent.type
            ??
            'UNKNOWN',

        breakTick:
            finite(
                breakEvent.breakTick
            ),

        breakTimeSeconds:
            finite(
                breakEvent.breakMatchTimeSeconds
            ),

        breakClock:
            breakEvent.breakClock
            ??
            null,

        breakablePosition:
            normalizePosition(
                breakEvent.worldPosition
            ),

        canonicalBreaker:
            breakEvent.canonicalBreaker
            ??
            null,

        rewardType:
            reward.rewardType
            ??
            null,

        pickupClass:
            reward.pickupClass
            ??
            null,

        pickupEntityIndex,

        goldReward:
            finite(
                reward.goldReward
            ),

        modifierSubclassId:
            serialize(
                reward.modifierSubclassId
            )
    });
}


rewardEvents.sort(
    (
        a,
        b
    ) =>
        a.breakTick -
        b.breakTick
);


// ============================================================
// EXPECTED REWARD COUNTS
// ============================================================

const crateRewardEvents =
    rewardEvents.filter(
        event =>
            event.rewardType ===
            'SOULS'
    );


const statueRewardEvents =
    rewardEvents.filter(
        event =>
            event.rewardType ===
            'PERMANENT_MODIFIER'
    );


// ============================================================
// TARGET PICKUP ENTITY INDEXES
// ============================================================

const targetPickupIndexes =
    new Set(
        rewardEvents.map(
            event =>
                event.pickupEntityIndex
        )
    );


// ============================================================
// PICKUP ENTITY LIFECYCLE STATE
// ============================================================

const pickupState =
    new Map();


const activationEvents =
    [];


const deactivationEvents =
    [];


let goldEntityEvents =
    0;


let modifierEntityEvents =
    0;


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


parser.registerPostInterceptor(

    InterceptorStage.ENTITY_PACKET,

    (
        demoPacket,
        messagePacket,
        events
    ) => {

        const tick =
            finite(
                demoPacket?.tick
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
            ??
            []
        ) {

            const entity =
                event.entity;


            if (
                !entity
            ) {

                continue;
            }


            const className =
                getEntityClassName(
                    entity
                );


            if (
                className !==
                    'CCitadel_Pickup_Gold'
                &&
                className !==
                    'CCitadel_Pickup_Modifier'
            ) {

                continue;
            }


            if (
                className ===
                'CCitadel_Pickup_Gold'
            ) {

                goldEntityEvents++;

            } else {

                modifierEntityEvents++;
            }


            const entityIndex =
                getEntityIndex(
                    entity
                );


            if (
                entityIndex ===
                null
                ||
                !targetPickupIndexes.has(
                    entityIndex
                )
            ) {

                continue;
            }


            const active =
                booleanValue(
                    safeGetField(
                        entity,
                        'm_bActive'
                    )
                );


            const interactive =
                booleanValue(
                    safeGetField(
                        entity,
                        'm_bInteractive'
                    )
                );


            const position =
                getWorldPosition(
                    entity
                );


            const current =
                {

                    entityIndex,

                    className,

                    active,

                    interactive,

                    position,

                    goldReward:
                        finite(
                            safeGetField(
                                entity,
                                'm_iGoldReward'
                            )
                        ),

                    subclassId:
                        serialize(
                            safeGetField(
                                entity,
                                'm_nSubclassID'
                            )
                        ),

                    tick,

                    timeSeconds:
                        tickToMatchTime(
                            tick
                        )
                };


            const previous =
                pickupState.get(
                    entityIndex
                )
                ??
                null;


            // =================================================
            // ACTIVATION
            // =================================================

            if (
                active ===
                    true
                &&
                (
                    !previous
                    ||
                    previous.active !==
                        true
                )
            ) {

                activationEvents.push({

                    ...current,

                    transition:
                        'ACTIVE'
                });
            }


            // =================================================
            // DEACTIVATION
            // =================================================

            if (
                previous
                &&
                previous.active ===
                    true
                &&
                active ===
                    false
            ) {

                deactivationEvents.push({

                    entityIndex,

                    className,

                    tick,

                    timeSeconds:
                        tickToMatchTime(
                            tick
                        ),

                    clock:
                        formatClock(
                            tickToMatchTime(
                                tick
                            )
                        ),

                    // Position immediately before the pickup
                    // became inactive is generally what we care
                    // about.
                    position:
                        previous.position
                        ??
                        position,

                    previousInteractive:
                        previous.interactive,

                    currentInteractive:
                        interactive,

                    goldReward:
                        previous.goldReward
                        ??
                        current.goldReward,

                    subclassId:
                        previous.subclassId
                        ??
                        current.subclassId
                });
            }


            pickupState.set(
                entityIndex,
                current
            );
        }
    }
);


// ============================================================
// RUN REPLAY PARSER
// ============================================================

console.log('');

console.log(
    '========================================'
);

console.log(
    'BREAKABLE REWARD COLLECTION DIAGNOSTIC'
);

console.log(
    '========================================'
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Successful reward spawns: ${rewardEvents.length}`
);

console.log(
    `  crate soul pickups: ${crateRewardEvents.length}`
);

console.log(
    `  statue modifier pickups: ${statueRewardEvents.length}`
);

console.log(
    `Unique pooled pickup entities: ${targetPickupIndexes.size}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// SORT PICKUP EVENTS
// ============================================================

activationEvents.sort(
    byTick
);


deactivationEvents.sort(
    byTick
);


// ============================================================
// INDEX DEACTIVATIONS BY POOLED PICKUP ENTITY
// ============================================================

const deactivationsByEntity =
    new Map();


for (
    const event
    of deactivationEvents
) {

    if (
        !deactivationsByEntity.has(
            event.entityIndex
        )
    ) {

        deactivationsByEntity.set(
            event.entityIndex,
            []
        );
    }


    deactivationsByEntity
        .get(
            event.entityIndex
        )
        .push(
            event
        );
}


// ============================================================
// REWARD EVENTS BY POOLED ENTITY
// ============================================================

const rewardsByPickupEntity =
    new Map();


for (
    const reward
    of rewardEvents
) {

    if (
        !rewardsByPickupEntity.has(
            reward.pickupEntityIndex
        )
    ) {

        rewardsByPickupEntity.set(
            reward.pickupEntityIndex,
            []
        );
    }


    rewardsByPickupEntity
        .get(
            reward.pickupEntityIndex
        )
        .push(
            reward
        );
}


for (
    const rows
    of rewardsByPickupEntity.values()
) {

    rows.sort(
        (
            a,
            b
        ) =>
            a.breakTick -
            b.breakTick
    );
}


// ============================================================
// LINK EACH REWARD SPAWN TO FIRST SUBSEQUENT DEACTIVATION
//
// Important:
//
// Because pickup entities are pooled, the valid deactivation
// must occur before that same pooled entity is used for the
// next reward spawn.
// ============================================================

const rewardLifecycleRows =
    [];


for (
    const [
        entityIndex,
        rewards
    ]
    of rewardsByPickupEntity.entries()
) {

    const deactivations =
        deactivationsByEntity.get(
            entityIndex
        )
        ??
        [];


    for (
        let index =
            0;

        index <
            rewards.length;

        index++
    ) {

        const reward =
            rewards[index];


        const nextReward =
            rewards[
                index +
                1
            ]
            ??
            null;


        const deactivation =
            deactivations.find(
                event =>
                    event.tick >=
                        reward.breakTick
                    &&
                    (
                        !nextReward
                        ||
                        event.tick <
                            nextReward.breakTick
                    )
            )
            ??
            null;


        rewardLifecycleRows.push({

            ...reward,

            collectionTransition:
                deactivation,

            collectedOrDeactivated:
                Boolean(
                    deactivation
                ),

            secondsUntilDeactivation:
                deactivation
                    ? deactivation.timeSeconds -
                        reward.breakTimeSeconds
                    : null
        });
    }
}


rewardLifecycleRows.sort(
    (
        a,
        b
    ) =>
        a.breakTick -
        b.breakTick
);


// ============================================================
// LOAD PLAYER POSITION TIMELINES
// ============================================================

const playerTimelines =
    new Map();


let playerRowsRead =
    0;


let playerRowsUsed =
    0;


const playerReader =
    readline.createInterface({

        input:
            createReadStream(
                playerStatePath,
                {
                    encoding:
                        'utf8'
                }
            ),

        crlfDelay:
            Infinity
    });


for await (
    const line
    of playerReader
) {

    if (
        !line.trim()
    ) {

        continue;
    }


    playerRowsRead++;


    let row;


    try {

        row =
            JSON.parse(
                line
            );

    } catch {

        continue;
    }


    const playerName =
        row
            ?.controller
            ?.playerName;


    const time =
        finite(
            row.matchTimeSeconds
        );


    const position =
        normalizePosition(
            row
                ?.pawn
                ?.positionWorld
        );


    const alive =
        row
            ?.controller
            ?.alive ===
        true;


    const positionValid =
        row
            ?.pawn
            ?.positionValidForMovement ===
        true;


    if (
        typeof playerName !==
            'string'
        ||
        !playerName.trim()
        ||
        time ===
            null
        ||
        time <
            0
        ||
        !position
        ||
        !alive
        ||
        !positionValid
    ) {

        continue;
    }


    playerRowsUsed++;


    if (
        !playerTimelines.has(
            playerName
        )
    ) {

        playerTimelines.set(
            playerName,
            []
        );
    }


    playerTimelines
        .get(
            playerName
        )
        .push({

            time,

            position,

            netWorth:
                finite(
                    row
                        ?.controller
                        ?.netWorth
                )
        });
}


// ============================================================
// SORT PLAYER TIMELINES
// ============================================================

for (
    const timeline
    of playerTimelines.values()
) {

    timeline.sort(
        (
            a,
            b
        ) =>
            a.time -
            b.time
    );
}


// ============================================================
// ADD PLAYER GEOMETRY TO DEACTIVATION EVENTS
// ============================================================

const collectionRows =
    [];


for (
    const reward
    of rewardLifecycleRows
) {

    const transition =
        reward.collectionTransition;


    if (
        !transition
        ||
        !transition.position
    ) {

        collectionRows.push({

            ...reward,

            playerGeometry:
                null,

            nearestPlayer:
                null,

            candidatePlayers:
                []
        });


        continue;
    }


    const players =
        [];


    for (
        const [
            playerName,
            timeline
        ]
        of playerTimelines.entries()
    ) {

        const interpolated =
            interpolatePlayerState(
                timeline,
                transition.timeSeconds
            );


        if (
            !interpolated
        ) {

            continue;
        }


        const dxy =
            distanceXY(
                interpolated.position,
                transition.position
            );


        const dz =
            Math.abs(
                interpolated.position.z -
                transition.position.z
            );


        const d3 =
            Math.sqrt(
                dxy *
                dxy
                +
                dz *
                dz
            );


        players.push({

            playerName,

            distance3D:
                d3,

            distanceXY:
                dxy,

            verticalDistance:
                dz,

            interpolatedPosition:
                interpolated.position,

            beforeTime:
                interpolated.before.time,

            afterTime:
                interpolated.after.time,

            interpolationFraction:
                interpolated.fraction,

            netWorthBefore:
                interpolated.before.netWorth,

            netWorthAfter:
                interpolated.after.netWorth,

            netWorthDelta:
                (
                    interpolated.before.netWorth !==
                        null
                    &&
                    interpolated.after.netWorth !==
                        null
                )
                    ? interpolated.after.netWorth -
                        interpolated.before.netWorth
                    : null
        });
    }


    players.sort(
        (
            a,
            b
        ) =>
            a.distance3D -
            b.distance3D
    );


    collectionRows.push({

        ...reward,

        playerGeometry:
            {

                playerCount:
                    players.length
            },

        nearestPlayer:
            players[0]
            ??
            null,

        secondNearestPlayer:
            players[1]
            ??
            null,

        candidatePlayers:
            players.slice(
                0,
                5
            )
    });
}


// ============================================================
// DISTANCE DISTRIBUTION
// ============================================================

const rowsWithTransition =
    collectionRows.filter(
        row =>
            row.collectionTransition
            &&
            row.nearestPlayer
    );


const nearestDistances =
    rowsWithTransition.map(
        row =>
            row.nearestPlayer.distance3D
    );


const nearestXY =
    rowsWithTransition.map(
        row =>
            row.nearestPlayer.distanceXY
    );


const nearestZ =
    rowsWithTransition.map(
        row =>
            row.nearestPlayer.verticalDistance
    );


// ============================================================
// 3D THRESHOLD MATRIX
// ============================================================

const distanceThresholds =
    [];


for (
    const threshold
    of DISTANCE_THRESHOLDS
) {

    let anyPlayer =
        0;


    let uniquePlayer =
        0;


    let multiplePlayers =
        0;


    let crateUnique =
        0;


    let statueUnique =
        0;


    for (
        const row
        of rowsWithTransition
    ) {

        const candidates =
            row.candidatePlayers.filter(
                player =>
                    player.distance3D <=
                    threshold
            );


        if (
            candidates.length >
            0
        ) {

            anyPlayer++;
        }


        if (
            candidates.length ===
            1
        ) {

            uniquePlayer++;


            if (
                row.rewardType ===
                'SOULS'
            ) {

                crateUnique++;
            }


            if (
                row.rewardType ===
                'PERMANENT_MODIFIER'
            ) {

                statueUnique++;
            }
        }


        if (
            candidates.length >
            1
        ) {

            multiplePlayers++;
        }
    }


    distanceThresholds.push({

        threshold,

        rows:
            rowsWithTransition.length,

        anyPlayer,

        uniquePlayer,

        multiplePlayers,

        uniqueRate:
            rate(
                uniquePlayer,
                rowsWithTransition.length
            ),

        ambiguousRate:
            rate(
                multiplePlayers,
                rowsWithTransition.length
            ),

        crateUnique,

        statueUnique
    });
}


// ============================================================
// XY × Z MATRIX
// ============================================================

const jointThresholds =
    [];


for (
    const xyThreshold
    of XY_THRESHOLDS
) {

    for (
        const zThreshold
        of Z_THRESHOLDS
    ) {

        let anyPlayer =
            0;


        let uniquePlayer =
            0;


        let multiplePlayers =
            0;


        for (
            const row
            of rowsWithTransition
        ) {

            const candidates =
                row.candidatePlayers.filter(
                    player =>
                        player.distanceXY <=
                            xyThreshold
                        &&
                        player.verticalDistance <=
                            zThreshold
                );


            if (
                candidates.length >
                0
            ) {

                anyPlayer++;
            }


            if (
                candidates.length ===
                1
            ) {

                uniquePlayer++;
            }


            if (
                candidates.length >
                1
            ) {

                multiplePlayers++;
            }
        }


        jointThresholds.push({

            xyThreshold,

            zThreshold,

            rows:
                rowsWithTransition.length,

            anyPlayer,

            uniquePlayer,

            multiplePlayers,

            uniqueRate:
                rate(
                    uniquePlayer,
                    rowsWithTransition.length
                ),

            ambiguousRate:
                rate(
                    multiplePlayers,
                    rowsWithTransition.length
                )
        });
    }
}


// ============================================================
// BREAKER / NEAREST-COLLECTOR RELATIONSHIP
//
// Diagnostic only.
//
// We explicitly expect these to sometimes differ.
// ============================================================

let rowsWithKnownBreakerAndNearest =
    0;


let nearestSameAsBreaker =
    0;


let nearestDifferentFromBreaker =
    0;


for (
    const row
    of rowsWithTransition
) {

    const breaker =
        row
            ?.canonicalBreaker
            ?.player
            ?.playerName;


    const nearest =
        row
            ?.nearestPlayer
            ?.playerName;


    if (
        !breaker
        ||
        !nearest
    ) {

        continue;
    }


    rowsWithKnownBreakerAndNearest++;


    if (
        breaker ===
        nearest
    ) {

        nearestSameAsBreaker++;

    } else {

        nearestDifferentFromBreaker++;
    }
}


// ============================================================
// CRATE NET-WORTH DIAGNOSTIC
//
// Not canonical.
//
// Net worth can change from other simultaneous sources.
// ============================================================

const crateNearestRows =
    rowsWithTransition.filter(
        row =>
            row.rewardType ===
            'SOULS'
            &&
            row.nearestPlayer
            &&
            row.goldReward !==
            null
    );


let crateNearestWithNetWorthDelta =
    0;


let crateNearestDeltaAtLeastReward =
    0;


for (
    const row
    of crateNearestRows
) {

    const delta =
        row
            .nearestPlayer
            .netWorthDelta;


    if (
        delta ===
        null
    ) {

        continue;
    }


    crateNearestWithNetWorthDelta++;


    if (
        delta >=
        row.goldReward
    ) {

        crateNearestDeltaAtLeastReward++;
    }
}


// ============================================================
// TIME-TO-COLLECTION DISTRIBUTION
// ============================================================

const collectedRows =
    collectionRows.filter(
        row =>
            row.collectedOrDeactivated
            &&
            Number.isFinite(
                row.secondsUntilDeactivation
            )
    );


const crateCollectionTimes =
    collectedRows
        .filter(
            row =>
                row.rewardType ===
                'SOULS'
        )
        .map(
            row =>
                row.secondsUntilDeactivation
        );


const statueCollectionTimes =
    collectedRows
        .filter(
            row =>
                row.rewardType ===
                'PERMANENT_MODIFIER'
        )
        .map(
            row =>
                row.secondsUntilDeactivation
        );


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BREAKABLE_REWARD_COLLECTION_DIAGNOSTIC',

        canonical:
            false,

        purpose:
            [

                'Separate breakable destruction from reward acquisition.',

                'Detect active-to-inactive transitions of pooled crate-soul and Golden-Statue modifier pickup entities.',

                'Associate each successful reward spawn with the first deactivation of that pooled entity before its next reuse.',

                'Estimate player position at the deactivation timestamp by interpolating the 0.25-second player-state samples.',

                'Measure whether reward deactivation occurs with exactly one player physically overlapping the pickup.',

                'Do not assume breaker equals collector.'
            ],

        sourceCounts:
            {

                successfulRewardEvents:
                    rewardEvents.length,

                crateSoulRewardEvents:
                    crateRewardEvents.length,

                statueModifierRewardEvents:
                    statueRewardEvents.length,

                uniquePickupEntities:
                    targetPickupIndexes.size,

                goldEntityEvents,

                modifierEntityEvents,

                activationTransitions:
                    activationEvents.length,

                deactivationTransitions:
                    deactivationEvents.length,

                rewardRowsWithDeactivation:
                    collectedRows.length,

                rewardRowsWithoutDeactivation:
                    rewardLifecycleRows.length -
                    collectedRows.length,

                playerRowsRead,

                playerRowsUsed,

                players:
                    playerTimelines.size
            },

        nearestPlayerGeometry:
            {

                rows:
                    rowsWithTransition.length,

                distance3D:
                    summarizeNumbers(
                        nearestDistances
                    ),

                distanceXY:
                    summarizeNumbers(
                        nearestXY
                    ),

                verticalDistance:
                    summarizeNumbers(
                        nearestZ
                    )
            },

        distanceThresholds,

        jointThresholds,

        breakerCollectorDiagnostic:
            {

                rowsWithKnownBreakerAndNearest,

                nearestSameAsBreaker,

                nearestDifferentFromBreaker,

                sameRate:
                    rate(
                        nearestSameAsBreaker,
                        rowsWithKnownBreakerAndNearest
                    ),

                differentRate:
                    rate(
                        nearestDifferentFromBreaker,
                        rowsWithKnownBreakerAndNearest
                    )
            },

        crateNetWorthDiagnostic:
            {

                rows:
                    crateNearestRows.length,

                withBracketNetWorthDelta:
                    crateNearestWithNetWorthDelta,

                deltaAtLeastGoldReward:
                    crateNearestDeltaAtLeastReward,

                rate:
                    rate(
                        crateNearestDeltaAtLeastReward,
                        crateNearestWithNetWorthDelta
                    ),

                caution:
                    'Net worth changes can include simultaneous lane/camp/combat income and are not treated as collector attribution.'
            },

        collectionTiming:
            {

                crate:
                    summarizeNumbers(
                        crateCollectionTimes
                    ),

                goldenStatue:
                    summarizeNumbers(
                        statueCollectionTimes
                    )
            },

        rewardRows:
            collectionRows,

        rawLifecycle:
            {

                activations:
                    activationEvents,

                deactivations:
                    deactivationEvents
            }
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
// CONSOLE
// ============================================================

console.log(
    'PICKUP LIFECYCLE'
);

console.log(
    '----------------'
);

console.log(
    `Reward events: ${rewardEvents.length}`
);

console.log(
    `Activation transitions: ${activationEvents.length}`
);

console.log(
    `Deactivation transitions: ${deactivationEvents.length}`
);

console.log(
    `Rewards linked to deactivation: ${collectedRows.length}/${rewardLifecycleRows.length}`
);

console.log('');

console.log(
    'NEAREST PLAYER AT DEACTIVATION'
);

console.log(
    '------------------------------'
);


printNumberSummary(
    '3D',
    summarizeNumbers(
        nearestDistances
    )
);


printNumberSummary(
    'XY',
    summarizeNumbers(
        nearestXY
    )
);


printNumberSummary(
    '|Z|',
    summarizeNumbers(
        nearestZ
    )
);


console.log('');

console.log(
    '3D THRESHOLDS'
);

console.log(
    '-------------'
);


for (
    const row
    of distanceThresholds
) {

    console.log(
        `<= ${
            String(
                row.threshold
            ).padStart(
                3
            )
        }  any=${
            String(
                row.anyPlayer
            ).padStart(
                4
            )
        }  unique=${
            String(
                row.uniquePlayer
            ).padStart(
                4
            )
        }  multiple=${
            String(
                row.multiplePlayers
            ).padStart(
                3
            )
        }`
    );
}


console.log('');

console.log(
    'BREAKER vs NEAREST PLAYER'
);

console.log(
    '-------------------------'
);

console.log(
    `Comparable rows: ${rowsWithKnownBreakerAndNearest}`
);

console.log(
    `Same: ${nearestSameAsBreaker}`
);

console.log(
    `Different: ${nearestDifferentFromBreaker}`
);

console.log(
    `Different rate: ${formatPercent(
        rate(
            nearestDifferentFromBreaker,
            rowsWithKnownBreakerAndNearest
        )
    )}`
);

console.log('');

console.log(
    'COLLECTION TIMING'
);

console.log(
    '-----------------'
);


printNumberSummary(
    'Crate',
    summarizeNumbers(
        crateCollectionTimes
    )
);


printNumberSummary(
    'Statue',
    summarizeNumbers(
        statueCollectionTimes
    )
);


console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


// ============================================================
// PLAYER INTERPOLATION
// ============================================================

function interpolatePlayerState(
    timeline,
    targetTime
) {

    if (
        !timeline
        ||
        timeline.length <
            1
    ) {

        return null;
    }


    const index =
        lowerBound(
            timeline,
            targetTime
        );


    let before =
        null;


    let after =
        null;


    if (
        index <
        timeline.length
    ) {

        after =
            timeline[index];
    }


    if (
        index >
        0
    ) {

        before =
            timeline[
                index -
                1
            ];
    }


    // Exact sample.
    if (
        after
        &&
        Math.abs(
            after.time -
            targetTime
        )
        <
        0.000001
    ) {

        return {

            position:
                after.position,

            before:
                after,

            after,

            fraction:
                0
        };
    }


    if (
        !before
        ||
        !after
    ) {

        return null;
    }


    const beforeGap =
        targetTime -
        before.time;


    const afterGap =
        after.time -
        targetTime;


    if (
        beforeGap <
            0
        ||
        afterGap <
            0
        ||
        beforeGap >
            MAX_BRACKET_GAP_SECONDS
        ||
        afterGap >
            MAX_BRACKET_GAP_SECONDS
    ) {

        return null;
    }


    const span =
        after.time -
        before.time;


    if (
        span <=
        0
    ) {

        return null;
    }


    const fraction =
        (
            targetTime -
            before.time
        )
        /
        span;


    return {

        position:
            {

                x:
                    lerp(
                        before.position.x,
                        after.position.x,
                        fraction
                    ),

                y:
                    lerp(
                        before.position.y,
                        after.position.y,
                        fraction
                    ),

                z:
                    lerp(
                        before.position.z,
                        after.position.z,
                        fraction
                    )
            },

        before,

        after,

        fraction
    };
}


// ============================================================
// BINARY SEARCH
// ============================================================

function lowerBound(
    timeline,
    targetTime
) {

    let low =
        0;


    let high =
        timeline.length;


    while (
        low <
        high
    ) {

        const mid =
            Math.floor(
                (
                    low +
                    high
                )
                /
                2
            );


        if (
            timeline[mid].time <
            targetTime
        ) {

            low =
                mid +
                1;

        } else {

            high =
                mid;
        }
    }


    return low;
}


// ============================================================
// ENTITY HELPERS
// ============================================================

function getEntityClassName(
    entity
) {

    return (
        entity
            ?.class
            ?.name
        ??
        entity.className
        ??
        null
    );
}


function getEntityIndex(
    entity
) {

    return finite(
        entity?.index
        ??
        entity?.entityIndex
    );
}


function safeGetField(
    entity,
    fieldName
) {

    try {

        if (
            typeof entity.getField ===
            'function'
        ) {

            return entity.getField(
                fieldName
            );
        }

    } catch {

        // Ignore absent fields.
    }


    return null;
}


// ============================================================
// ENTITY WORLD POSITION
// ============================================================

function getWorldPosition(
    entity
) {

    const cellX =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_cellX'
            )
        );


    const cellY =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_cellY'
            )
        );


    const cellZ =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_cellZ'
            )
        );


    const vecX =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_vecX'
            )
        );


    const vecY =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_vecY'
            )
        );


    const vecZ =
        finite(
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
            (
                cellZ !==
                    null
                &&
                vecZ !==
                    null
            )

                ? (
                    cellZ *
                    512
                    -
                    16384
                    +
                    vecZ
                )

                : 0
    };
}


// ============================================================
// DISTANCES
// ============================================================

function distanceXY(
    a,
    b
) {

    const dx =
        a.x -
        b.x;


    const dy =
        a.y -
        b.y;


    return Math.sqrt(
        dx *
        dx
        +
        dy *
        dy
    );
}


// ============================================================
// NUMBER SUMMARY
// ============================================================

function summarizeNumbers(
    values
) {

    const clean =
        values
            .filter(
                Number.isFinite
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    a -
                    b
            );


    if (
        clean.length ===
        0
    ) {

        return {

            count:
                0,

            min:
                null,

            p10:
                null,

            p25:
                null,

            median:
                null,

            p75:
                null,

            p90:
                null,

            p95:
                null,

            max:
                null,

            mean:
                null
        };
    }


    const total =
        clean.reduce(
            (
                sum,
                value
            ) =>
                sum +
                value,
            0
        );


    return {

        count:
            clean.length,

        min:
            clean[0],

        p10:
            percentile(
                clean,
                0.10
            ),

        p25:
            percentile(
                clean,
                0.25
            ),

        median:
            percentile(
                clean,
                0.50
            ),

        p75:
            percentile(
                clean,
                0.75
            ),

        p90:
            percentile(
                clean,
                0.90
            ),

        p95:
            percentile(
                clean,
                0.95
            ),

        max:
            clean[
                clean.length -
                1
            ],

        mean:
            total /
            clean.length
    };
}


// ============================================================
// PERCENTILE
// ============================================================

function percentile(
    sorted,
    proportion
) {

    if (
        sorted.length ===
        1
    ) {

        return sorted[0];
    }


    const index =
        (
            sorted.length -
            1
        )
        *
        proportion;


    const lower =
        Math.floor(
            index
        );


    const upper =
        Math.ceil(
            index
        );


    if (
        lower ===
        upper
    ) {

        return sorted[
            lower
        ];
    }


    const weight =
        index -
        lower;


    return (
        sorted[
            lower
        ]
        *
        (
            1 -
            weight
        )
        +
        sorted[
            upper
        ]
        *
        weight
    );
}


// ============================================================
// CONSOLE SUMMARY
// ============================================================

function printNumberSummary(
    label,
    summary
) {

    console.log(
        `${
            label.padEnd(
                8
            )
        } n=${
            String(
                summary.count
            ).padStart(
                4
            )
        } median=${
            formatNumber(
                summary.median
            ).padStart(
                8
            )
        } p90=${
            formatNumber(
                summary.p90
            ).padStart(
                8
            )
        } max=${
            formatNumber(
                summary.max
            ).padStart(
                8
            )
        }`
    );
}


// ============================================================
// HELPERS
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


function booleanValue(
    value
) {

    if (
        value ===
        true
        ||
        value ===
        1
        ||
        value ===
        '1'
    ) {

        return true;
    }


    if (
        value ===
        false
        ||
        value ===
        0
        ||
        value ===
        '0'
    ) {

        return false;
    }


    return null;
}


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
        finite(
            value.x
        );


    const y =
        finite(
            value.y
        );


    const z =
        finite(
            value.z
        )
        ??
        0;


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

        z
    };
}


function lerp(
    a,
    b,
    t
) {

    return (
        a +
        (
            b -
            a
        )
        *
        t
    );
}


function finite(
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


function serialize(
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


function rate(
    numerator,
    denominator
) {

    if (
        !Number.isFinite(
            numerator
        )
        ||
        !Number.isFinite(
            denominator
        )
        ||
        denominator ===
            0
    ) {

        return null;
    }


    return (
        numerator /
        denominator
    );
}


function formatPercent(
    value
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return 'n/a';
    }


    return (
        value *
        100
    ).toFixed(
        1
    )
    +
    '%';
}


function formatNumber(
    value
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return 'n/a';
    }


    return value.toFixed(
        2
    );
}


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


    const absolute =
        Math.abs(
            seconds
        );


    const minutes =
        Math.floor(
            absolute /
            60
        );


    const secs =
        Math.floor(
            absolute %
            60
        );


    return (
        seconds <
            0
            ? '-'
            : ''
    )
    +
    `${minutes}:${
        String(
            secs
        ).padStart(
            2,
            '0'
        )
    }`;
}