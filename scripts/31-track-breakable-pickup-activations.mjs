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


// ============================================================
// CANONICAL BREAKABLE TYPES
// ============================================================

const SUBCLASS_CRATE =
    '3986897915';


const SUBCLASS_GOLDEN_STATUE =
    '3719077267';


// ============================================================
// CANONICAL REWARD ENTITY CLASSES
//
// Script 30 established:
//
// CCitadel_Pickup_Gold
//     -> CRATE only
//
// CCitadel_Pickup_Modifier
//     -> GOLDEN_STATUE only
// ============================================================

const GOLD_PICKUP_CLASS =
    'CCitadel_Pickup_Gold';


const MODIFIER_PICKUP_CLASS =
    'CCitadel_Pickup_Modifier';


const PICKUP_CLASSES =
    new Set(
        [
            GOLD_PICKUP_CLASS,
            MODIFIER_PICKUP_CLASS
        ]
    );


// ============================================================
// MATCHING WINDOWS
//
// Reward activation should occur at or shortly after the break.
//
// We permit up to one second because:
// - packet ordering may differ
// - pooled pickup networking may lag slightly
//
// Spatial matching remains tight.
// ============================================================

const MATCH_MIN_DELTA_TICKS =
    -1;


const MATCH_MAX_DELTA_TICKS =
    64;


const MATCH_MAX_DISTANCE =
    160;


// A very high-confidence subset.
const STRICT_MAX_DELTA_TICKS =
    4;


const STRICT_MAX_DISTANCE =
    128;


// A relocation this large is considered meaningful evidence
// that the pooled pickup entity has been reused elsewhere.
const POSITION_JUMP_THRESHOLD =
    32;


// ============================================================
// INVALID SOURCE HANDLES
// ============================================================

const INVALID_HANDLES =
    new Set(
        [
            null,
            undefined,
            0,
            16777215,
            4294967295,
            '16777215',
            '4294967295'
        ]
    );


// ============================================================
// PUBLIC BENCHMARKS
//
// Used only for comparison after telemetry reconstruction.
// ============================================================

const EXPECTED_CRATE_SOUL_DROP_RATE =
    0.60;


const EXPECTED_STATUE_BUFF_DROP_RATE =
    0.50;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const breakPath =
    resolve(
        'output',
        replayName,
        'breakable_respawn_validation.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_pickup_activation_validation.json'
    );


// ============================================================
// INPUT
// ============================================================

if (
    !existsSync(
        breakPath
    )
) {

    throw new Error(
        `Missing Script 29 output:\n${breakPath}`
    );
}


const breakData =
    JSON.parse(
        readFileSync(
            breakPath,
            'utf8'
        )
    );


const matchClockOffsetSeconds =
    Number.isFinite(
        Number(
            breakData
                ?.timing
                ?.matchClockOffsetSeconds
        )
    )

        ? Number(
            breakData
                .timing
                .matchClockOffsetSeconds
        )

        : 30;


// ============================================================
// NORMALIZE BREAK EVENTS
// ============================================================

const breaks =
    (
        Array.isArray(
            breakData
                .breakRespawnCandidates
        )

            ? breakData
                .breakRespawnCandidates

            : []
    )

        .map(
            row => {

                const subclassId =
                    row.subclassId ===
                    null
                    ||
                    row.subclassId ===
                    undefined

                        ? null

                        : String(
                            row.subclassId
                        );


                return {

                    breakKey:
                        `${row.entityIndex}|${row.breakTick}`,

                    entityIndex:
                        Number(
                            row.entityIndex
                        ),

                    subclassId,

                    resourceType:
                        classifyResourceType(
                            subclassId
                        ),

                    breakTick:
                        Number(
                            row.breakTick
                        ),

                    breakMatchTimeSeconds:
                        row.breakMatchTimeSeconds
                        ??
                        tickToMatchTime(
                            Number(
                                row.breakTick
                            )
                        ),

                    breakClock:
                        row.breakClock
                        ??
                        formatClock(
                            row.breakMatchTimeSeconds
                        ),

                    position:
                        normalizePosition(
                            row.position
                        )
                };
            }
        )

        .filter(
            row =>
                Number.isFinite(
                    row.breakTick
                )
                &&
                row.position
                &&
                row.resourceType !==
                    'UNKNOWN'
        )

        .sort(
            (
                a,
                b
            ) =>
                a.breakTick -
                b.breakTick
        );


if (
    breaks.length ===
    0
) {

    throw new Error(
        'No usable break events found.'
    );
}


// ============================================================
// BREAK COUNTS
// ============================================================

const crateBreaks =
    breaks.filter(
        row =>
            row.resourceType ===
            'CRATE'
    );


const statueBreaks =
    breaks.filter(
        row =>
            row.resourceType ===
            'GOLDEN_STATUE'
    );


// ============================================================
// STORAGE
// ============================================================

// Last known state for every pooled pickup entity.
const pickupStates =
    new Map();


// Pickup entity -> current matched resource drop.
const currentDropByPickup =
    new Map();


// breakKey -> reconstructed drop.
const dropByBreak =
    new Map();


// Every activation-like transition whether matched or not.
const activationCandidates =
    [];


// Collector/vacuum observations.
const collectionEvents =
    [];


// Player/controller resolution.
const playersByPawnIndex =
    new Map();


const playersByControllerIndex =
    new Map();


// Lifecycle operation counts.
const lifecycleCounts =
    {
        [GOLD_PICKUP_CLASS]: {
            CREATE: 0,
            UPDATE: 0,
            LEAVE: 0,
            DELETE: 0,
            OTHER: 0
        },

        [MODIFIER_PICKUP_CLASS]: {
            CREATE: 0,
            UPDATE: 0,
            LEAVE: 0,
            DELETE: 0,
            OTHER: 0
        }
    };


const uniquePickupEntities =
    {
        [GOLD_PICKUP_CLASS]:
            new Set(),

        [MODIFIER_PICKUP_CLASS]:
            new Set()
    };


let firstDemoTick =
    null;


let lastDemoTick =
    null;


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// DEMO TICK TRACKING
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    demoPacket => {

        const tick =
            Number(
                demoPacket.tick
            );


        if (
            !Number.isFinite(
                tick
            )
        ) {

            return;
        }


        if (
            firstDemoTick ===
            null
        ) {

            firstDemoTick =
                tick;
        }


        lastDemoTick =
            tick;
    }
);


// ============================================================
// ENTITY TRACKING
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.ENTITY_PACKET,

    (
        demoPacket,
        messagePacket,
        events
    ) => {

        const tick =
            Number(
                demoPacket.tick
            );


        if (
            !Number.isFinite(
                tick
            )
        ) {

            return;
        }


        // ====================================================
        // PASS 1:
        // refresh player/controller relationships first
        // ====================================================

        for (
            const event
            of events
        ) {

            const entity =
                event.entity;


            const className =
                entity
                    ?.class
                    ?.name;


            if (
                className ===
                'CCitadelPlayerController'
            ) {

                updatePlayerController(
                    entity,
                    tick
                );
            }
        }


        // ====================================================
        // PASS 2:
        // pickup state changes
        // ====================================================

        for (
            const event
            of events
        ) {

            const entity =
                event.entity;


            const className =
                entity
                    ?.class
                    ?.name;


            if (
                !PICKUP_CLASSES.has(
                    className
                )
            ) {

                continue;
            }


            const entityIndex =
                getEntityIndex(
                    entity
                );


            if (
                entityIndex ===
                null
            ) {

                continue;
            }


            uniquePickupEntities[
                className
            ].add(
                entityIndex
            );


            countLifecycleOperation(
                className,
                event.operation
            );


            const pickupKey =
                `${className}|${entityIndex}`;


            // LEAVE / DELETE can occur when the object leaves
            // network relevance.
            //
            // Do not interpret either as pickup collection.
            if (
                event.operation ===
                    EntityOperation.LEAVE
                ||
                event.operation ===
                    EntityOperation.DELETE
            ) {

                continue;
            }


            const current =
                snapshotPickup(
                    entity,
                    className,
                    entityIndex,
                    tick
                );


            if (
                !current
            ) {

                continue;
            }


            const previous =
                pickupStates.get(
                    pickupKey
                )
                ??
                null;


            // =================================================
            // DETECT REUSE / ACTIVATION SIGNALS
            // =================================================

            const signals =
                detectActivationSignals(
                    previous,
                    current,
                    event.operation
                );


            // =================================================
            // FIND NEARBY BREAK OF CORRECT TYPE
            // =================================================

            const expectedResourceType =
                className ===
                    GOLD_PICKUP_CLASS

                    ? 'CRATE'

                    : 'GOLDEN_STATUE';


            const breakMatch =
                findBestBreakMatch(
                    tick,
                    current.position,
                    expectedResourceType
                );


            // =================================================
            // RECONSTRUCT DROP
            //
            // We require BOTH:
            //
            // 1. activation/reuse evidence from pickup state
            // 2. a temporally/spatially matching break
            //
            // This prevents an already-active pickup sitting in
            // the same area from being counted again.
            // =================================================

            const activationLike =
                (
                    signals.operationCreate
                    ||
                    signals.becameActive
                    ||
                    signals.positionJump
                    ||
                    signals.createTimeChanged
                    ||
                    signals.rewardChanged
                    ||
                    signals.subclassChanged
                );


            if (
                activationLike
                &&
                breakMatch
            ) {

                const activationRecord =
                    {

                        pickupKey,

                        pickupClass:
                            className,

                        pickupEntityIndex:
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

                        position:
                            current.position,

                        signals,

                        currentState:
                            current,

                        matchedBreakKey:
                            breakMatch.breakEvent.breakKey,

                        matchedResourceType:
                            breakMatch.breakEvent.resourceType,

                        matchedResourceEntityIndex:
                            breakMatch.breakEvent.entityIndex,

                        breakTick:
                            breakMatch.breakEvent.breakTick,

                        deltaTicks:
                            breakMatch.deltaTicks,

                        deltaSeconds:
                            breakMatch.deltaTicks /
                            TICK_RATE,

                        distance:
                            breakMatch.distance,

                        strict:
                            breakMatch.strict
                    };


                activationCandidates.push(
                    activationRecord
                );


                const breakKey =
                    breakMatch
                        .breakEvent
                        .breakKey;


                // ---------------------------------------------
                // One reward entity per resource break.
                //
                // If multiple candidate updates occur, keep the
                // highest-quality match.
                // ---------------------------------------------

                const existing =
                    dropByBreak.get(
                        breakKey
                    );


                const reconstructed =
                    buildDropRecord(
                        breakMatch.breakEvent,
                        current,
                        signals,
                        breakMatch
                    );


                if (
                    !existing
                    ||
                    compareDropQuality(
                        reconstructed,
                        existing
                    )
                    <
                    0
                ) {

                    dropByBreak.set(
                        breakKey,
                        reconstructed
                    );
                }


                currentDropByPickup.set(
                    pickupKey,
                    breakKey
                );
            }


            // =================================================
            // COLLECTION / VACUUM TARGET
            // =================================================

            const currentVacuum =
                normalizeHandle(
                    current.vacuumTarget
                );


            const previousVacuum =
                normalizeHandle(
                    previous
                        ?.vacuumTarget
                );


            const vacuumBecameValid =
                (
                    isValidHandle(
                        currentVacuum
                    )
                    &&
                    currentVacuum !==
                        previousVacuum
                );


            if (
                vacuumBecameValid
            ) {

                const currentBreakKey =
                    currentDropByPickup.get(
                        pickupKey
                    )
                    ??
                    null;


                const player =
                    resolvePlayerFromHandle(
                        currentVacuum
                    );


                const collectionRecord =
                    {

                        pickupKey,

                        pickupClass:
                            className,

                        pickupEntityIndex:
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

                        vacuumTargetHandle:
                            currentVacuum,

                        resolvedTarget:
                            player,

                        breakKey:
                            currentBreakKey
                    };


                collectionEvents.push(
                    collectionRecord
                );


                if (
                    currentBreakKey
                    &&
                    dropByBreak.has(
                        currentBreakKey
                    )
                ) {

                    const drop =
                        dropByBreak.get(
                            currentBreakKey
                        );


                    if (
                        !drop.collection
                    ) {

                        drop.collection =
                            collectionRecord;
                    }
                }
            }


            // =================================================
            // DEACTIVATION
            // =================================================

            const becameInactive =
                (
                    previous
                    &&
                    previous.active ===
                        true
                    &&
                    current.active ===
                        false
                );


            if (
                becameInactive
            ) {

                const currentBreakKey =
                    currentDropByPickup.get(
                        pickupKey
                    );


                if (
                    currentBreakKey
                    &&
                    dropByBreak.has(
                        currentBreakKey
                    )
                ) {

                    const drop =
                        dropByBreak.get(
                            currentBreakKey
                        );


                    if (
                        !drop.deactivation
                    ) {

                        drop.deactivation =
                            {

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

                                secondsAfterBreak:
                                    (
                                        tick -
                                        drop.breakTick
                                    )
                                    /
                                    TICK_RATE
                            };
                    }
                }
            }


            pickupStates.set(
                pickupKey,
                current
            );
        }
    }
);


// ============================================================
// RUN
// ============================================================

console.log('');

console.log(
    '========================================'
);

console.log(
    'BREAKABLE PICKUP ACTIVATION VALIDATION'
);

console.log(
    '========================================'
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Breaks loaded: ${breaks.length}`
);

console.log(
    `  Crates: ${crateBreaks.length}`
);

console.log(
    `  Golden Statues: ${statueBreaks.length}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// BUILD FINAL BREAK-LEVEL TABLE
// ============================================================

const breakResults =
    breaks.map(
        breakEvent => {

            const drop =
                dropByBreak.get(
                    breakEvent.breakKey
                )
                ??
                null;


            return {

                ...breakEvent,

                rewardObserved:
                    drop !==
                    null,

                reward:
                    drop
            };
        }
    );


// ============================================================
// SPLIT DROPS
// ============================================================

const reconstructedDrops =
    [...dropByBreak.values()]
        .sort(
            (
                a,
                b
            ) =>
                a.breakTick -
                b.breakTick
        );


const crateDrops =
    reconstructedDrops.filter(
        row =>
            row.resourceType ===
            'CRATE'
    );


const statueDrops =
    reconstructedDrops.filter(
        row =>
            row.resourceType ===
            'GOLDEN_STATUE'
    );


// ============================================================
// STRICT DROPS
// ============================================================

const strictCrateDrops =
    crateDrops.filter(
        row =>
            row.strict
    );


const strictStatueDrops =
    statueDrops.filter(
        row =>
            row.strict
    );


// ============================================================
// GOLD REWARD VALUES
// ============================================================

const goldRewardValues =
    crateDrops

        .map(
            row =>
                toFiniteNumber(
                    row.goldReward
                )
        )

        .filter(
            Number.isFinite
        );


// ============================================================
// GOLD VALUE BY MATCH MINUTE
// ============================================================

const goldRewardsByMinuteMap =
    new Map();


for (
    const drop
    of crateDrops
) {

    const reward =
        toFiniteNumber(
            drop.goldReward
        );


    if (
        !Number.isFinite(
            reward
        )
    ) {

        continue;
    }


    const minute =
        Math.floor(
            Math.max(
                0,
                drop.breakMatchTimeSeconds
            )
            /
            60
        );


    if (
        !goldRewardsByMinuteMap.has(
            minute
        )
    ) {

        goldRewardsByMinuteMap.set(
            minute,
            []
        );
    }


    goldRewardsByMinuteMap.get(
        minute
    ).push(
        reward
    );
}


const goldRewardsByMinute =
    [...goldRewardsByMinuteMap.entries()]

        .map(
            (
                [
                    minute,
                    values
                ]
            ) => ({

                minute,

                sampleCount:
                    values.length,

                reward:
                    summarizeNumbers(
                        values
                    )
            })
        )

        .sort(
            (
                a,
                b
            ) =>
                a.minute -
                b.minute
        );


// ============================================================
// MODIFIER SUBCLASS DISTRIBUTION
//
// m_nSubclassID appears to vary across modifier pickups.
//
// We do NOT assign semantic buff names yet.
// ============================================================

const modifierSubclassCounts =
    countBy(
        statueDrops,
        row =>
            row.modifierSubclassId
    );


// ============================================================
// SIGNAL DISTRIBUTION
// ============================================================

const activationSignalCounts =
    {

        operationCreate:
            0,

        becameActive:
            0,

        positionJump:
            0,

        createTimeChanged:
            0,

        rewardChanged:
            0,

        subclassChanged:
            0
    };


for (
    const candidate
    of activationCandidates
) {

    for (
        const key
        of Object.keys(
            activationSignalCounts
        )
    ) {

        if (
            candidate
                .signals[
                    key
                ]
        ) {

            activationSignalCounts[
                key
            ]++;
        }
    }
}


// ============================================================
// COLLECTION SUMMARY
// ============================================================

const dropsWithCollection =
    reconstructedDrops.filter(
        row =>
            row.collection
    );


const dropsWithResolvedPlayer =
    dropsWithCollection.filter(
        row =>
            row
                .collection
                ?.resolvedTarget
                ?.playerName
    );


const collectionByPlayer =
    {};


for (
    const drop
    of dropsWithResolvedPlayer
) {

    const playerName =
        drop
            .collection
            .resolvedTarget
            .playerName;


    if (
        !collectionByPlayer[
            playerName
        ]
    ) {

        collectionByPlayer[
            playerName
        ] =
            {

                total:
                    0,

                crateGold:
                    0,

                goldenStatueModifier:
                    0,

                knownGoldReward:
                    0
            };
    }


    const record =
        collectionByPlayer[
            playerName
        ];


    record.total++;


    if (
        drop.resourceType ===
        'CRATE'
    ) {

        record.crateGold++;


        const reward =
            toFiniteNumber(
                drop.goldReward
            );


        if (
            Number.isFinite(
                reward
            )
        ) {

            record.knownGoldReward +=
                reward;
        }
    }


    if (
        drop.resourceType ===
        'GOLDEN_STATUE'
    ) {

        record.goldenStatueModifier++;
    }
}


// ============================================================
// OBSERVED DROP RATES
// ============================================================

const crateDropRate =
    crateBreaks.length >
    0

        ? crateDrops.length /
          crateBreaks.length

        : null;


const statueDropRate =
    statueBreaks.length >
    0

        ? statueDrops.length /
          statueBreaks.length

        : null;


const strictCrateDropRate =
    crateBreaks.length >
    0

        ? strictCrateDrops.length /
          crateBreaks.length

        : null;


const strictStatueDropRate =
    statueBreaks.length >
    0

        ? strictStatueDrops.length /
          statueBreaks.length

        : null;


// ============================================================
// MATCH QUALITY
// ============================================================

const dropDistanceSummary =
    summarizeNumbers(
        reconstructedDrops.map(
            row =>
                row.distance
        )
    );


const dropDeltaSummary =
    summarizeNumbers(
        reconstructedDrops.map(
            row =>
                row.deltaSeconds
        )
    );


// ============================================================
// UNIQUE PICKUP COUNTS
// ============================================================

const uniquePickupSummary =
    {

        [GOLD_PICKUP_CLASS]:
            uniquePickupEntities[
                GOLD_PICKUP_CLASS
            ].size,

        [MODIFIER_PICKUP_CLASS]:
            uniquePickupEntities[
                MODIFIER_PICKUP_CLASS
            ].size
    };


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        method:
            [
                'Load confirmed CRATE and GOLDEN_STATUE break events from Script 29.',
                'Track pooled CCitadel_Pickup_Gold and CCitadel_Pickup_Modifier entities across CREATE and UPDATE operations.',
                'Detect reward reuse through active-state transitions, position jumps, create-time changes, gold reward changes, and modifier subclass changes.',
                'Require an activation-like pickup transition plus a temporally and spatially matching break.',
                'Track m_hVacuumTarget transitions to identify the player a pickup moves toward when resolvable.',
                'Treat pickup CREATE as only one possible activation signal, not the canonical drop definition.'
            ],

        canonicalMapping:
            {

                breakables: {

                    [SUBCLASS_CRATE]:
                        'CRATE',

                    [SUBCLASS_GOLDEN_STATUE]:
                        'GOLDEN_STATUE'
                },

                rewards: {

                    [GOLD_PICKUP_CLASS]:
                        'CRATE_SOUL_REWARD',

                    [MODIFIER_PICKUP_CLASS]:
                        'GOLDEN_STATUE_PERMANENT_MODIFIER'
                }
            },

        timing:
            {

                tickRate:
                    TICK_RATE,

                matchClockOffsetSeconds,

                firstDemoTick,

                lastDemoTick,

                matchDurationSeconds:
                    Number.isFinite(
                        lastDemoTick
                    )

                        ? tickToMatchTime(
                            lastDemoTick
                        )

                        : null
            },

        matching:
            {

                minDeltaTicks:
                    MATCH_MIN_DELTA_TICKS,

                maxDeltaTicks:
                    MATCH_MAX_DELTA_TICKS,

                maxDeltaSeconds:
                    MATCH_MAX_DELTA_TICKS /
                    TICK_RATE,

                maxDistance:
                    MATCH_MAX_DISTANCE,

                strictMaxDeltaTicks:
                    STRICT_MAX_DELTA_TICKS,

                strictMaxDistance:
                    STRICT_MAX_DISTANCE,

                positionJumpThreshold:
                    POSITION_JUMP_THRESHOLD
            },

        pickupLifecycle:
            {

                uniqueEntities:
                    uniquePickupSummary,

                operationCounts:
                    lifecycleCounts,

                activationCandidateCount:
                    activationCandidates.length,

                activationSignalCounts
            },

        breaks:
            {

                total:
                    breaks.length,

                crates:
                    crateBreaks.length,

                goldenStatues:
                    statueBreaks.length
            },

        reconstructedRewards:
            {

                total:
                    reconstructedDrops.length,

                cratesWithSoulReward:
                    crateDrops.length,

                statuesWithModifierReward:
                    statueDrops.length,

                strictCrateRewards:
                    strictCrateDrops.length,

                strictStatueRewards:
                    strictStatueDrops.length,

                crateObservedDropRate:
                    crateDropRate,

                statueObservedDropRate:
                    statueDropRate,

                strictCrateObservedDropRate:
                    strictCrateDropRate,

                strictStatueObservedDropRate:
                    strictStatueDropRate,

                publicBenchmarks:
                    {

                        crateSoulDropRate:
                            EXPECTED_CRATE_SOUL_DROP_RATE,

                        statueModifierDropRate:
                            EXPECTED_STATUE_BUFF_DROP_RATE
                    },

                differenceFromBenchmark:
                    {

                        crate:
                            Number.isFinite(
                                crateDropRate
                            )

                                ? crateDropRate -
                                  EXPECTED_CRATE_SOUL_DROP_RATE

                                : null,

                        goldenStatue:
                            Number.isFinite(
                                statueDropRate
                            )

                                ? statueDropRate -
                                  EXPECTED_STATUE_BUFF_DROP_RATE

                                : null
                    },

                matchDistance:
                    dropDistanceSummary,

                matchDeltaSeconds:
                    dropDeltaSummary
            },

        goldRewards:
            {

                knownValueCount:
                    goldRewardValues.length,

                valueSummary:
                    summarizeNumbers(
                        goldRewardValues
                    ),

                byMatchMinute:
                    goldRewardsByMinute
            },

        modifierRewards:
            {

                observedCount:
                    statueDrops.length,

                subclassCounts:
                    modifierSubclassCounts,

                note:
                    'Modifier m_nSubclassID values are preserved but not yet assigned semantic buff names.'
            },

        collection:
            {

                vacuumEvents:
                    collectionEvents.length,

                dropsWithVacuumTarget:
                    dropsWithCollection.length,

                dropsWithResolvedPlayer:
                    dropsWithResolvedPlayer.length,

                byPlayer:
                    collectionByPlayer
            },

        reconstructedDrops,

        breakResults,

        collectionEvents,

        activationCandidates
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
// CONSOLE OUTPUT
// ============================================================

console.log(
    'PICKUP ENTITY POOLS'
);

console.log(
    '-------------------'
);

console.log(
    `${GOLD_PICKUP_CLASS}: ${
        uniquePickupSummary[
            GOLD_PICKUP_CLASS
        ]
    } unique entity slots`
);

console.log(
    `${MODIFIER_PICKUP_CLASS}: ${
        uniquePickupSummary[
            MODIFIER_PICKUP_CLASS
        ]
    } unique entity slots`
);

console.log('');


console.log(
    'RECONSTRUCTED DROPS'
);

console.log(
    '-------------------'
);

console.log(
    `Crate soul rewards: ${
        crateDrops.length
    }/${
        crateBreaks.length
    } = ${
        formatPercent(
            crateDropRate
        )
    }`
);

console.log(
    `Benchmark: ${
        formatPercent(
            EXPECTED_CRATE_SOUL_DROP_RATE
        )
    }`
);

console.log('');


console.log(
    `Golden Statue modifiers: ${
        statueDrops.length
    }/${
        statueBreaks.length
    } = ${
        formatPercent(
            statueDropRate
        )
    }`
);

console.log(
    `Benchmark: ${
        formatPercent(
            EXPECTED_STATUE_BUFF_DROP_RATE
        )
    }`
);

console.log('');


console.log(
    'GOLD REWARD VALUES'
);

console.log(
    '------------------'
);

console.log(
    `Known values: ${goldRewardValues.length}`
);


const goldSummary =
    summarizeNumbers(
        goldRewardValues
    );


if (
    goldSummary.count >
    0
) {

    console.log(
        `Min: ${goldSummary.min}`
    );

    console.log(
        `Median: ${goldSummary.median}`
    );

    console.log(
        `Max: ${goldSummary.max}`
    );

    console.log(
        `Mean: ${goldSummary.mean.toFixed(3)}`
    );
}


console.log('');


console.log(
    'MODIFIER SUBCLASSES'
);

console.log(
    '-------------------'
);


for (
    const [
        subclass,
        count
    ]
    of Object.entries(
        modifierSubclassCounts
    )
) {

    console.log(
        `${subclass}: ${count}`
    );
}


console.log('');


console.log(
    'COLLECTION / VACUUM'
);

console.log(
    '-------------------'
);

console.log(
    `Vacuum-target events: ${collectionEvents.length}`
);

console.log(
    `Drops with vacuum target: ${dropsWithCollection.length}`
);

console.log(
    `Drops resolved to player: ${dropsWithResolvedPlayer.length}`
);


if (
    dropsWithResolvedPlayer.length >
    0
) {

    console.log('');


    for (
        const [
            playerName,
            record
        ]
        of Object.entries(
            collectionByPlayer
        )
        .sort(
            (
                a,
                b
            ) =>
                b[1].total -
                a[1].total
        )
    ) {

        console.log(
            `${
                playerName
            }: ${
                record.total
            } rewards | ${
                record.crateGold
            } crate | ${
                record.goldenStatueModifier
            } statue | ${
                record.knownGoldReward
            } known souls`
        );
    }
}


console.log('');

console.log(
    'MATCH QUALITY'
);

console.log(
    '-------------'
);


if (
    dropDistanceSummary.count >
    0
) {

    console.log(
        `Distance median: ${
            dropDistanceSummary.median.toFixed(
                3
            )
        }`
    );

    console.log(
        `Distance max: ${
            dropDistanceSummary.max.toFixed(
                3
            )
        }`
    );
}


if (
    dropDeltaSummary.count >
    0
) {

    console.log(
        `Time delta median: ${
            dropDeltaSummary.median.toFixed(
                6
            )
        }s`
    );

    console.log(
        `Time delta max: ${
            dropDeltaSummary.max.toFixed(
                6
            )
        }s`
    );
}


console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// BUILD DROP RECORD
// ============================================================

function buildDropRecord(
    breakEvent,
    pickup,
    signals,
    match
) {

    return {

        breakKey:
            breakEvent.breakKey,

        resourceType:
            breakEvent.resourceType,

        resourceSubclassId:
            breakEvent.subclassId,

        resourceEntityIndex:
            breakEvent.entityIndex,

        breakTick:
            breakEvent.breakTick,

        breakMatchTimeSeconds:
            breakEvent.breakMatchTimeSeconds,

        breakClock:
            breakEvent.breakClock,

        breakPosition:
            breakEvent.position,

        pickupClass:
            pickup.className,

        pickupEntityIndex:
            pickup.entityIndex,

        activationTick:
            pickup.tick,

        activationMatchTimeSeconds:
            pickup.matchTimeSeconds,

        activationClock:
            pickup.clock,

        pickupPosition:
            pickup.position,

        active:
            pickup.active,

        interactive:
            pickup.interactive,

        createTime:
            pickup.createTime,

        goldReward:
            pickup.goldReward,

        modifierSubclassId:
            pickup.className ===
                MODIFIER_PICKUP_CLASS

                ? pickup.subclassId

                : null,

        pickupSubclassId:
            pickup.subclassId,

        vacuumTarget:
            pickup.vacuumTarget,

        signals,

        deltaTicks:
            match.deltaTicks,

        deltaSeconds:
            match.deltaTicks /
            TICK_RATE,

        distance:
            match.distance,

        strict:
            match.strict,

        collection:
            null,

        deactivation:
            null
    };
}


// ============================================================
// DROP QUALITY
//
// Lower score is better.
// ============================================================

function compareDropQuality(
    a,
    b
) {

    return dropQualityScore(
        a
    )
    -
    dropQualityScore(
        b
    );
}


function dropQualityScore(
    row
) {

    let score =
        0;


    if (
        !row.strict
    ) {

        score +=
            1000;
    }


    score +=
        Math.abs(
            row.deltaTicks
        )
        *
        10;


    score +=
        row.distance;


    if (
        row.signals.becameActive
    ) {

        score -=
            100;
    }


    if (
        row.signals.rewardChanged
    ) {

        score -=
            75;
    }


    if (
        row.signals.subclassChanged
    ) {

        score -=
            75;
    }


    if (
        row.signals.positionJump
    ) {

        score -=
            50;
    }


    return score;
}


// ============================================================
// PICKUP SNAPSHOT
// ============================================================

function snapshotPickup(
    entity,
    className,
    entityIndex,
    tick
) {

    const position =
        getWorldPosition(
            entity
        );


    if (
        !position
    ) {

        return null;
    }


    return {

        className,

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

        position,

        active:
            toNullableBoolean(
                safeGetField(
                    entity,
                    'm_bActive'
                )
            ),

        interactive:
            toNullableBoolean(
                safeGetField(
                    entity,
                    'm_bInteractive'
                )
            ),

        vacuumTarget:
            normalizeHandle(
                safeGetField(
                    entity,
                    'm_hVacuumTarget'
                )
            ),

        goldReward:
            toFiniteNumber(
                safeGetField(
                    entity,
                    'm_iGoldReward'
                )
            ),

        subclassId:
            normalizeId(
                safeGetField(
                    entity,
                    'm_nSubclassID'
                )
            ),

        createTime:
            toFiniteNumber(
                safeGetField(
                    entity,
                    'm_flCreateTime'
                )
            )
    };
}


// ============================================================
// ACTIVATION SIGNALS
// ============================================================

function detectActivationSignals(
    previous,
    current,
    operation
) {

    const operationCreate =
        operation ===
        EntityOperation.CREATE;


    const becameActive =
        (
            previous
            &&
            previous.active ===
                false
            &&
            current.active ===
                true
        );


    const jumpDistance =
        (
            previous
            ?.position
            &&
            current.position
        )

            ? distance3D(
                previous.position,
                current.position
            )

            : null;


    const positionJump =
        Number.isFinite(
            jumpDistance
        )
        &&
        jumpDistance >=
            POSITION_JUMP_THRESHOLD;


    const createTimeChanged =
        (
            previous
            &&
            Number.isFinite(
                previous.createTime
            )
            &&
            Number.isFinite(
                current.createTime
            )
            &&
            previous.createTime !==
                current.createTime
        );


    const rewardChanged =
        (
            current.className ===
                GOLD_PICKUP_CLASS
            &&
            previous
            &&
            Number.isFinite(
                previous.goldReward
            )
            &&
            Number.isFinite(
                current.goldReward
            )
            &&
            previous.goldReward !==
                current.goldReward
        );


    const subclassChanged =
        (
            current.className ===
                MODIFIER_PICKUP_CLASS
            &&
            previous
            &&
            previous.subclassId !==
                null
            &&
            current.subclassId !==
                null
            &&
            previous.subclassId !==
                current.subclassId
        );


    return {

        operationCreate,

        becameActive,

        positionJump,

        positionJumpDistance:
            jumpDistance,

        createTimeChanged,

        rewardChanged,

        subclassChanged
    };
}


// ============================================================
// FIND BEST BREAK
// ============================================================

function findBestBreakMatch(
    pickupTick,
    pickupPosition,
    expectedResourceType
) {

    if (
        !pickupPosition
    ) {

        return null;
    }


    const earliestBreakTick =
        pickupTick -
        MATCH_MAX_DELTA_TICKS;


    const latestBreakTick =
        pickupTick -
        MATCH_MIN_DELTA_TICKS;


    const startIndex =
        lowerBoundBreakTick(
            earliestBreakTick
        );


    let best =
        null;


    for (
        let i =
            startIndex;

        i <
            breaks.length;

        i++
    ) {

        const breakEvent =
            breaks[i];


        if (
            breakEvent.breakTick >
            latestBreakTick
        ) {

            break;
        }


        if (
            breakEvent.resourceType !==
            expectedResourceType
        ) {

            continue;
        }


        const deltaTicks =
            pickupTick -
            breakEvent.breakTick;


        if (
            deltaTicks <
                MATCH_MIN_DELTA_TICKS
            ||
            deltaTicks >
                MATCH_MAX_DELTA_TICKS
        ) {

            continue;
        }


        const distance =
            distance3D(
                pickupPosition,
                breakEvent.position
            );


        if (
            !Number.isFinite(
                distance
            )
            ||
            distance >
                MATCH_MAX_DISTANCE
        ) {

            continue;
        }


        const strict =
            (
                deltaTicks >=
                    MATCH_MIN_DELTA_TICKS
                &&
                deltaTicks <=
                    STRICT_MAX_DELTA_TICKS
                &&
                distance <=
                    STRICT_MAX_DISTANCE
            );


        const score =
            distance
            +
            Math.abs(
                deltaTicks
            )
            *
            12;


        if (
            !best
            ||
            score <
                best.score
        ) {

            best =
                {

                    breakEvent,

                    deltaTicks,

                    distance,

                    strict,

                    score
                };
        }
    }


    return best;
}


// ============================================================
// LOWER BOUND
// ============================================================

function lowerBoundBreakTick(
    targetTick
) {

    let low =
        0;


    let high =
        breaks.length;


    while (
        low <
        high
    ) {

        const middle =
            Math.floor(
                (
                    low +
                    high
                )
                /
                2
            );


        if (
            breaks[
                middle
            ].breakTick <
            targetTick
        ) {

            low =
                middle +
                1;

        } else {

            high =
                middle;
        }
    }


    return low;
}


// ============================================================
// PLAYER CONTROLLER
// ============================================================

function updatePlayerController(
    entity,
    tick
) {

    const controllerIndex =
        getEntityIndex(
            entity
        );


    if (
        controllerIndex ===
        null
    ) {

        return;
    }


    const playerName =
        firstNonNullField(
            entity,
            [
                'm_sPlayerName',
                'm_iszPlayerName',
                'm_playerName'
            ]
        );


    const heroId =
        toFiniteNumber(
            firstNonNullField(
                entity,
                [
                    'm_nHeroID',
                    'm_nHeroId',
                    'm_eHeroID'
                ]
            )
        );


    const team =
        toFiniteNumber(
            safeGetField(
                entity,
                'm_iTeamNum'
            )
        );


    const pawnHandle =
        normalizeHandle(
            firstNonNullField(
                entity,
                [
                    'm_hPawn',
                    'm_hHeroPawn',
                    'm_hPlayerPawn'
                ]
            )
        );


    let pawnEntityIndex =
        null;


    if (
        isValidHandle(
            pawnHandle
        )
    ) {

        const pawn =
            safeResolveEntityHandle(
                pawnHandle
            );


        pawnEntityIndex =
            getEntityIndex(
                pawn
            );
    }


    const player =
        {

            controllerEntityIndex:
                controllerIndex,

            pawnEntityIndex,

            pawnHandle,

            playerName:
                playerName ===
                    null
                    ||
                    playerName ===
                    undefined

                    ? null

                    : String(
                        playerName
                    ),

            heroId,

            team,

            lastSeenTick:
                tick
        };


    playersByControllerIndex.set(
        controllerIndex,
        player
    );


    if (
        pawnEntityIndex !==
        null
    ) {

        playersByPawnIndex.set(
            pawnEntityIndex,
            player
        );
    }
}


// ============================================================
// RESOLVE PLAYER FROM VACUUM TARGET
// ============================================================

function resolvePlayerFromHandle(
    handle
) {

    if (
        !isValidHandle(
            handle
        )
    ) {

        return null;
    }


    const entity =
        safeResolveEntityHandle(
            handle
        );


    if (
        !entity
    ) {

        return {

            targetHandle:
                handle,

            resolved:
                false
        };
    }


    const entityIndex =
        getEntityIndex(
            entity
        );


    const className =
        entity
            ?.class
            ?.name
        ??
        null;


    // --------------------------------------------------------
    // Direct pawn match.
    // --------------------------------------------------------

    if (
        entityIndex !==
        null
        &&
        playersByPawnIndex.has(
            entityIndex
        )
    ) {

        return {

            targetHandle:
                handle,

            targetEntityIndex:
                entityIndex,

            targetClass:
                className,

            resolved:
                true,

            ...playersByPawnIndex.get(
                entityIndex
            )
        };
    }


    // --------------------------------------------------------
    // Direct controller.
    // --------------------------------------------------------

    if (
        entityIndex !==
        null
        &&
        playersByControllerIndex.has(
            entityIndex
        )
    ) {

        return {

            targetHandle:
                handle,

            targetEntityIndex:
                entityIndex,

            targetClass:
                className,

            resolved:
                true,

            ...playersByControllerIndex.get(
                entityIndex
            )
        };
    }


    // --------------------------------------------------------
    // Pawn may itself expose a controller handle.
    // --------------------------------------------------------

    const controllerHandle =
        normalizeHandle(
            firstNonNullField(
                entity,
                [
                    'm_hController',
                    'm_hPlayerController'
                ]
            )
        );


    if (
        isValidHandle(
            controllerHandle
        )
    ) {

        const controller =
            safeResolveEntityHandle(
                controllerHandle
            );


        const controllerIndex =
            getEntityIndex(
                controller
            );


        if (
            controllerIndex !==
            null
            &&
            playersByControllerIndex.has(
                controllerIndex
            )
        ) {

            return {

                targetHandle:
                    handle,

                targetEntityIndex:
                    entityIndex,

                targetClass:
                    className,

                resolved:
                    true,

                ...playersByControllerIndex.get(
                    controllerIndex
                )
            };
        }
    }


    return {

        targetHandle:
            handle,

        targetEntityIndex:
            entityIndex,

        targetClass:
            className,

        resolved:
            false
    };
}


// ============================================================
// RESOURCE TYPE
// ============================================================

function classifyResourceType(
    subclassId
) {

    if (
        subclassId ===
        SUBCLASS_CRATE
    ) {

        return 'CRATE';
    }


    if (
        subclassId ===
        SUBCLASS_GOLDEN_STATUE
    ) {

        return 'GOLDEN_STATUE';
    }


    return 'UNKNOWN';
}


// ============================================================
// LIFECYCLE COUNTER
// ============================================================

function countLifecycleOperation(
    className,
    operation
) {

    const record =
        lifecycleCounts[
            className
        ];


    if (
        operation ===
        EntityOperation.CREATE
    ) {

        record.CREATE++;

        return;
    }


    if (
        operation ===
        EntityOperation.UPDATE
    ) {

        record.UPDATE++;

        return;
    }


    if (
        operation ===
        EntityOperation.LEAVE
    ) {

        record.LEAVE++;

        return;
    }


    if (
        operation ===
        EntityOperation.DELETE
    ) {

        record.DELETE++;

        return;
    }


    record.OTHER++;
}


// ============================================================
// ENTITY HANDLE RESOLUTION
// ============================================================

function safeResolveEntityHandle(
    handle
) {

    if (
        !isValidHandle(
            handle
        )
    ) {

        return null;
    }


    try {

        return (
            parser
                .getDemo()
                .getEntityByHandle(
                    handle
                )
            ??
            null
        );

    } catch {

        return null;
    }
}


// ============================================================
// ENTITY INDEX
// ============================================================

function getEntityIndex(
    entity
) {

    if (
        !entity
    ) {

        return null;
    }


    const candidates =
        [

            entity.index,

            entity.entityIndex,

            entity.entIndex,

            entity.id
        ];


    for (
        const candidate
        of candidates
    ) {

        const number =
            toFiniteNumber(
                candidate
            );


        if (
            number !==
            null
        ) {

            return number;
        }
    }


    if (
        typeof entity.getIndex ===
        'function'
    ) {

        try {

            const number =
                toFiniteNumber(
                    entity.getIndex()
                );


            if (
                number !==
                null
            ) {

                return number;
            }

        } catch {
            // Ignore.
        }
    }


    return null;
}


// ============================================================
// FIELD
// ============================================================

function safeGetField(
    entity,
    field
) {

    try {

        const value =
            entity.getField(
                field
            );


        return value ===
            undefined

            ? null

            : value;

    } catch {

        return null;
    }
}


function firstNonNullField(
    entity,
    fields
) {

    for (
        const field
        of fields
    ) {

        const value =
            safeGetField(
                entity,
                field
            );


        if (
            value !==
            null
            &&
            value !==
            undefined
        ) {

            return value;
        }
    }


    return null;
}


// ============================================================
// POSITION
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
        cellZ ===
        null
        ||
        vecX ===
        null
        ||
        vecY ===
        null
        ||
        vecZ ===
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
            cellZ *
            512
            -
            16384
            +
            vecZ
    };
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
// DISTANCE
// ============================================================

function distance3D(
    a,
    b
) {

    if (
        !a
        ||
        !b
    ) {

        return null;
    }


    const dx =
        a.x -
        b.x;


    const dy =
        a.y -
        b.y;


    const dz =
        (
            a.z
            ??
            0
        )
        -
        (
            b.z
            ??
            0
        );


    return Math.sqrt(
        dx *
        dx
        +
        dy *
        dy
        +
        dz *
        dz
    );
}


// ============================================================
// HANDLES
// ============================================================

function normalizeHandle(
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

        const number =
            Number(
                value
            );


        return Number.isSafeInteger(
            number
        )

            ? number

            : value.toString();
    }


    const numeric =
        Number(
            value
        );


    if (
        Number.isFinite(
            numeric
        )
    ) {

        return numeric;
    }


    return String(
        value
    );
}


function isValidHandle(
    handle
) {

    return !INVALID_HANDLES.has(
        handle
    );
}


// ============================================================
// ID
// ============================================================

function normalizeId(
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


    return String(
        value
    );
}


// ============================================================
// BOOL
// ============================================================

function toNullableBoolean(
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
        value ===
        true
        ||
        value ===
        false
    ) {

        return value;
    }


    if (
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
        0
        ||
        value ===
        '0'
    ) {

        return false;
    }


    return Boolean(
        value
    );
}


// ============================================================
// TIME
// ============================================================

function tickToMatchTime(
    tick
) {

    if (
        !Number.isFinite(
            tick
        )
    ) {

        return null;
    }


    return (
        tick /
        TICK_RATE
    )
    -
    matchClockOffsetSeconds;
}


// ============================================================
// CLOCK
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


    const secs =
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
    `${minutes}:`
    +
    String(
        secs
    ).padStart(
        2,
        '0'
    );
}


// ============================================================
// COUNT BY
// ============================================================

function countBy(
    array,
    selector
) {

    const result =
        {};


    for (
        const item
        of array
    ) {

        const raw =
            selector(
                item
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


        result[
            key
        ] =
            (
                result[
                    key
                ]
                ??
                0
            )
            +
            1;
    }


    return Object.fromEntries(
        Object.entries(
            result
        )
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

            max:
                null,

            mean:
                null
        };
    }


    const sum =
        clean.reduce(
            (
                total,
                value
            ) =>
                total +
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

        max:
            clean[
                clean.length -
                1
            ],

        mean:
            sum /
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
        0
    ) {

        return null;
    }


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
// PERCENT
// ============================================================

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
        2
    )
    +
    '%';
}