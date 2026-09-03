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


// ------------------------------------------------------------
// CANONICAL BREAKABLE SUBCLASS MAPPING
//
// Established by Script 29 + independent current map counts.
//
// 3986897915:
//     518 total
//     500 normal-map
//     18 Mid-Boss room
//     = CRATE
//
// 3719077267:
//     173 total
//     165 normal-map
//     8 Mid-Boss room
//     = GOLDEN STATUE
// ------------------------------------------------------------

const SUBCLASS_CRATE =
    '3986897915';


const SUBCLASS_GOLDEN_STATUE =
    '3719077267';


// ------------------------------------------------------------
// TEMPORAL WINDOWS
//
// Reward entities should appear essentially immediately after
// the resource is broken.
//
// STRICT:
//     allows tiny packet-order differences.
//
// RELAXED:
//     catches slightly delayed networking/relevance.
// ------------------------------------------------------------

const STRICT_MIN_DELTA_TICKS =
    -1;


const STRICT_MAX_DELTA_TICKS =
    4;


const RELAXED_MIN_DELTA_TICKS =
    -4;


const RELAXED_MAX_DELTA_TICKS =
    64;


// ------------------------------------------------------------
// SPATIAL WINDOWS
//
// Breakable damage positions in Script 28 could differ from
// entity origins by >100 units.
//
// 350 gives enough room for spawned pickup physics while still
// being local enough to be meaningful.
// ------------------------------------------------------------

const STRICT_MAX_DISTANCE =
    300;


const RELAXED_MAX_DISTANCE =
    450;


// ------------------------------------------------------------
// CURRENT PUBLIC DROP RATES
//
// BENCHMARK ONLY.
//
// These are NOT used to decide which entity is a reward.
// They are shown afterward as an external validation target.
//
// Crates:
//     60% souls
//
// Golden Statues:
//     50% permanent buff
// ------------------------------------------------------------

const EXPECTED_CRATE_DROP_RATE =
    0.60;


const EXPECTED_STATUE_DROP_RATE =
    0.50;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const respawnValidationPath =
    resolve(
        'output',
        replayName,
        'breakable_respawn_validation.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_drop_discovery.json'
    );


// ============================================================
// REQUIRE SCRIPT 29
// ============================================================

if (
    !existsSync(
        respawnValidationPath
    )
) {

    throw new Error(
        `Missing Script 29 output:\n${respawnValidationPath}`
    );
}


const respawnValidation =
    JSON.parse(
        readFileSync(
            respawnValidationPath,
            'utf8'
        )
    );


// ============================================================
// LOAD CONFIRMED BREAK EVENTS
// ============================================================

const rawBreakRows =
    Array.isArray(
        respawnValidation
            .breakRespawnCandidates
    )

        ? respawnValidation
            .breakRespawnCandidates

        : [];


if (
    rawBreakRows.length ===
    0
) {

    throw new Error(
        'No breakRespawnCandidates found in Script 29 output.'
    );
}


// ============================================================
// NORMALIZE BREAK EVENTS
// ============================================================

const breaks =
    rawBreakRows

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

                    breakNumberForSlot:
                        row.breakNumberForSlot
                        ??
                        null,

                    breakTick:
                        Number(
                            row.breakTick
                        ),

                    breakMatchTimeSeconds:
                        row.breakMatchTimeSeconds
                        ??
                        null,

                    breakClock:
                        row.breakClock
                        ??
                        null,

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
        )

        .sort(
            (
                a,
                b
            ) =>
                a.breakTick -
                b.breakTick
        );


// ============================================================
// BREAK INDEXES
// ============================================================

const breakByKey =
    new Map(
        breaks.map(
            row =>
                [
                    row.breakKey,
                    row
                ]
        )
    );


const breaksByType =
    groupBy(
        breaks,
        row =>
            row.resourceType
    );


// ============================================================
// EXPECTED COUNTS
// ============================================================

const crateBreakCount =
    (
        breaksByType.get(
            'CRATE'
        )
        ??
        []
    ).length;


const statueBreakCount =
    (
        breaksByType.get(
            'GOLDEN_STATUE'
        )
        ??
        []
    ).length;


// ============================================================
// STORAGE
// ============================================================

const allCreateClassCounts =
    new Map();


const nearbyClassCounts =
    new Map();


const primaryAssociations =
    [];


const allRelaxedAssociations =
    [];


const candidateEntitySnapshots =
    [];


let totalEntityCreates =
    0;


let positionedEntityCreates =
    0;


let createsInsideTemporalWindow =
    0;


let firstDemoTick =
    null;


let lastDemoTick =
    null;


// ============================================================
// CLASSES WE ALREADY SUSPECT
//
// These are NOT hard-coded as correct.
//
// They only receive richer field snapshots in the output.
// ============================================================

const knownCandidateClasses =
    new Set(
        [

            'CCitadel_Pickup_Gold',

            'CCitadel_Pickup_Modifier',

            'CCitadel_Pickup_AssignedGold',

            'CCitadel_Pickup_Health',

            'CItemXP',

            'CCitadelItemPunchableNeutralGold'
        ]
    );


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// DEMO TICKS
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
// ENTITY CREATE CORRELATION
//
// For every CREATE:
//
// 1. Does it occur within ~1 sec of a confirmed break?
// 2. Does it appear spatially near that break?
// 3. Which break is the best match?
//
// We do this for ALL entity classes so we don't accidentally
// miss an unexpected reward class.
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


        // ----------------------------------------------------
        // QUICK GLOBAL TEMPORAL REJECTION
        // ----------------------------------------------------

        if (
            tick <
            breaks[0].breakTick
            +
            RELAXED_MIN_DELTA_TICKS
            ||
            tick >
            breaks[
                breaks.length -
                1
            ].breakTick
            +
            RELAXED_MAX_DELTA_TICKS
        ) {

            return;
        }


        for (
            const event
            of events
        ) {

            if (
                event.operation !==
                EntityOperation.CREATE
            ) {

                continue;
            }


            totalEntityCreates++;


            const entity =
                event.entity;


            const className =
                entity
                    ?.class
                    ?.name
                ??
                'UNKNOWN';


            incrementCounter(
                allCreateClassCounts,
                className
            );


            // ------------------------------------------------
            // The resource prop itself is not a reward.
            // ------------------------------------------------

            if (
                className ===
                'CCitadel_BreakableProp'
            ) {

                continue;
            }


            const position =
                getWorldPosition(
                    entity
                );


            if (
                !position
            ) {

                continue;
            }


            positionedEntityCreates++;


            // ------------------------------------------------
            // FIND TEMPORALLY COMPATIBLE BREAKS
            // ------------------------------------------------

            const temporalCandidates =
                findBreaksInTickWindow(
                    tick,
                    breaks,
                    RELAXED_MIN_DELTA_TICKS,
                    RELAXED_MAX_DELTA_TICKS
                );


            if (
                temporalCandidates.length ===
                0
            ) {

                continue;
            }


            createsInsideTemporalWindow++;


            // ------------------------------------------------
            // SPATIAL FILTER
            // ------------------------------------------------

            const compatible =
                [];


            for (
                const breakEvent
                of temporalCandidates
            ) {

                const distance =
                    distance3D(
                        position,
                        breakEvent.position
                    );


                if (
                    !Number.isFinite(
                        distance
                    )
                    ||
                    distance >
                    RELAXED_MAX_DISTANCE
                ) {

                    continue;
                }


                const deltaTicks =
                    tick -
                    breakEvent.breakTick;


                const strict =
                    (
                        deltaTicks >=
                        STRICT_MIN_DELTA_TICKS
                        &&
                        deltaTicks <=
                        STRICT_MAX_DELTA_TICKS
                        &&
                        distance <=
                        STRICT_MAX_DISTANCE
                    );


                // --------------------------------------------
                // Matching score:
                //
                // Spatial distance dominates.
                // Each tick of delay adds a modest penalty.
                // --------------------------------------------

                const score =
                    distance
                    +
                    Math.abs(
                        deltaTicks
                    )
                    *
                    12;


                compatible.push({

                    breakKey:
                        breakEvent.breakKey,

                    resourceEntityIndex:
                        breakEvent.entityIndex,

                    resourceType:
                        breakEvent.resourceType,

                    resourceSubclassId:
                        breakEvent.subclassId,

                    breakTick:
                        breakEvent.breakTick,

                    createTick:
                        tick,

                    deltaTicks,

                    deltaSeconds:
                        deltaTicks /
                        TICK_RATE,

                    distance,

                    strict,

                    score
                });
            }


            if (
                compatible.length ===
                0
            ) {

                continue;
            }


            // ------------------------------------------------
            // BEST BREAK MATCH
            // ------------------------------------------------

            compatible.sort(
                (
                    a,
                    b
                ) =>
                    a.score -
                    b.score
            );


            const best =
                compatible[0];


            const entityIndex =
                getEntityIndex(
                    entity
                );


            const rewardLike =
                looksRewardLike(
                    className
                );


            const fieldSnapshot =
                rewardLike

                    ? snapshotEntityFields(
                        entity
                    )

                    : null;


            const association =
                {

                    createKey:
                        `${className}|${entityIndex}|${tick}`,

                    className,

                    entityIndex,

                    createTick:
                        tick,

                    createMatchTimeSeconds:
                        tickToMatchTime(
                            tick
                        ),

                    createClock:
                        formatClock(
                            tickToMatchTime(
                                tick
                            )
                        ),

                    createPosition:
                        position,

                    resourceBreakKey:
                        best.breakKey,

                    resourceType:
                        best.resourceType,

                    resourceSubclassId:
                        best.resourceSubclassId,

                    resourceEntityIndex:
                        best.resourceEntityIndex,

                    breakTick:
                        best.breakTick,

                    deltaTicks:
                        best.deltaTicks,

                    deltaSeconds:
                        best.deltaSeconds,

                    distance:
                        best.distance,

                    strict:
                        best.strict,

                    ambiguousCandidateCount:
                        compatible.length,

                    secondBestScoreGap:
                        compatible.length >
                        1

                            ? compatible[1].score -
                              compatible[0].score

                            : null,

                    fields:
                        fieldSnapshot
                };


            primaryAssociations.push(
                association
            );


            incrementNearbyClassCounter(
                nearbyClassCounts,
                className,
                best.resourceType,
                best.strict
            );


            // ------------------------------------------------
            // PRESERVE ALL RELAXED MATCHES
            //
            // Useful if several breakables are destroyed by an
            // AoE simultaneously.
            // ------------------------------------------------

            for (
                const match
                of compatible
            ) {

                allRelaxedAssociations.push({

                    className,

                    entityIndex,

                    createTick:
                        tick,

                    createPosition:
                        position,

                    ...match
                });
            }


            // ------------------------------------------------
            // RICH SAMPLES FOR REWARD-LIKE CLASSES
            // ------------------------------------------------

            if (
                rewardLike
                &&
                candidateEntitySnapshots.length <
                1000
            ) {

                candidateEntitySnapshots.push(
                    association
                );
            }
        }
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');

console.log(
    '===================================='
);

console.log(
    'BREAKABLE DROP DISCOVERY'
);

console.log(
    '===================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Confirmed breaks loaded: ${breaks.length}`
);

console.log(
    `  Crates: ${crateBreakCount}`
);

console.log(
    `  Golden Statues: ${statueBreakCount}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// BREAK-LEVEL ASSOCIATIONS
// ============================================================

const primaryByBreak =
    groupBy(
        primaryAssociations,
        row =>
            row.resourceBreakKey
    );


const breakResults =
    breaks.map(
        breakEvent => {

            const associations =
                primaryByBreak.get(
                    breakEvent.breakKey
                )
                ??
                [];


            const strictAssociations =
                associations.filter(
                    row =>
                        row.strict
                );


            const rewardLikeAssociations =
                associations.filter(
                    row =>
                        looksRewardLike(
                            row.className
                        )
                );


            const strictRewardLike =
                strictAssociations.filter(
                    row =>
                        looksRewardLike(
                            row.className
                        )
                );


            return {

                ...breakEvent,

                associatedCreateCount:
                    associations.length,

                strictAssociatedCreateCount:
                    strictAssociations.length,

                rewardLikeCreateCount:
                    rewardLikeAssociations.length,

                strictRewardLikeCreateCount:
                    strictRewardLike.length,

                strictClassNames:
                    [
                        ...new Set(
                            strictAssociations
                                .map(
                                    row =>
                                        row.className
                                )
                        )
                    ],

                rewardLikeClassNames:
                    [
                        ...new Set(
                            rewardLikeAssociations
                                .map(
                                    row =>
                                        row.className
                                )
                        )
                    ],

                strictRewardLikeClassNames:
                    [
                        ...new Set(
                            strictRewardLike
                                .map(
                                    row =>
                                        row.className
                                )
                        )
                    ]
            };
        }
    );


// ============================================================
// CLASS SUMMARIES
// ============================================================

const classNames =
    [
        ...new Set(
            primaryAssociations.map(
                row =>
                    row.className
            )
        )
    ];


const classSummaries =
    [];


for (
    const className
    of classNames
) {

    const rows =
        primaryAssociations.filter(
            row =>
                row.className ===
                className
        );


    const crateRows =
        rows.filter(
            row =>
                row.resourceType ===
                'CRATE'
        );


    const statueRows =
        rows.filter(
            row =>
                row.resourceType ===
                'GOLDEN_STATUE'
        );


    const strictCrateRows =
        crateRows.filter(
            row =>
                row.strict
        );


    const strictStatueRows =
        statueRows.filter(
            row =>
                row.strict
        );


    const crateBreakKeys =
        new Set(
            crateRows.map(
                row =>
                    row.resourceBreakKey
            )
        );


    const statueBreakKeys =
        new Set(
            statueRows.map(
                row =>
                    row.resourceBreakKey
            )
        );


    const strictCrateBreakKeys =
        new Set(
            strictCrateRows.map(
                row =>
                    row.resourceBreakKey
            )
        );


    const strictStatueBreakKeys =
        new Set(
            strictStatueRows.map(
                row =>
                    row.resourceBreakKey
            )
        );


    classSummaries.push({

        className,

        rewardLike:
            looksRewardLike(
                className
            ),

        totalPrimaryAssociations:
            rows.length,

        CRATE: {

            associations:
                crateRows.length,

            uniqueBreaks:
                crateBreakKeys.size,

            breakAssociationRate:
                crateBreakCount >
                0

                    ? crateBreakKeys.size /
                      crateBreakCount

                    : null,

            strictAssociations:
                strictCrateRows.length,

            strictUniqueBreaks:
                strictCrateBreakKeys.size,

            strictBreakAssociationRate:
                crateBreakCount >
                0

                    ? strictCrateBreakKeys.size /
                      crateBreakCount

                    : null,

            distance:
                summarizeNumbers(
                    crateRows.map(
                        row =>
                            row.distance
                    )
                ),

            deltaSeconds:
                summarizeNumbers(
                    crateRows.map(
                        row =>
                            row.deltaSeconds
                    )
                )
        },

        GOLDEN_STATUE: {

            associations:
                statueRows.length,

            uniqueBreaks:
                statueBreakKeys.size,

            breakAssociationRate:
                statueBreakCount >
                0

                    ? statueBreakKeys.size /
                      statueBreakCount

                    : null,

            strictAssociations:
                strictStatueRows.length,

            strictUniqueBreaks:
                strictStatueBreakKeys.size,

            strictBreakAssociationRate:
                statueBreakCount >
                0

                    ? strictStatueBreakKeys.size /
                      statueBreakCount

                    : null,

            distance:
                summarizeNumbers(
                    statueRows.map(
                        row =>
                            row.distance
                    )
                ),

            deltaSeconds:
                summarizeNumbers(
                    statueRows.map(
                        row =>
                            row.deltaSeconds
                    )
                )
        }
    });
}


// ============================================================
// SORT CLASS SUMMARIES
//
// Reward-looking classes first.
//
// Then by number of strict associations.
// ============================================================

classSummaries.sort(
    (
        a,
        b
    ) => {

        if (
            a.rewardLike !==
            b.rewardLike
        ) {

            return a.rewardLike
                ? -1
                : 1;
        }


        const strictA =
            a.CRATE.strictAssociations
            +
            a.GOLDEN_STATUE.strictAssociations;


        const strictB =
            b.CRATE.strictAssociations
            +
            b.GOLDEN_STATUE.strictAssociations;


        return strictB -
            strictA;
    }
);


// ============================================================
// TARGET CANDIDATE TESTS
// ============================================================

const goldPickupSummary =
    classSummaries.find(
        row =>
            row.className ===
            'CCitadel_Pickup_Gold'
    )
    ??
    null;


const modifierPickupSummary =
    classSummaries.find(
        row =>
            row.className ===
            'CCitadel_Pickup_Modifier'
    )
    ??
    null;


// ============================================================
// DIRECT BREAK DROP CLASSIFICATION
//
// This is intentionally conservative.
//
// A crate is marked OBSERVED_SOUL_DROP only when a nearby
// CCitadel_Pickup_Gold CREATE is found.
//
// A statue is marked OBSERVED_MODIFIER_DROP only when a nearby
// CCitadel_Pickup_Modifier CREATE is found.
//
// Everything else remains NO_MATCH_FOUND.
//
// This does NOT claim a failed roll yet; missing telemetry/PVS
// remains possible until the correlation looks strong.
// ============================================================

const canonicalDropObservations =
    [];


for (
    const breakEvent
    of breaks
) {

    const rows =
        primaryByBreak.get(
            breakEvent.breakKey
        )
        ??
        [];


    if (
        breakEvent.resourceType ===
        'CRATE'
    ) {

        const goldMatches =
            rows

                .filter(
                    row =>
                        row.className ===
                            'CCitadel_Pickup_Gold'
                )

                .sort(
                    compareAssociationQuality
                );


        canonicalDropObservations.push({

            breakKey:
                breakEvent.breakKey,

            resourceType:
                breakEvent.resourceType,

            resourceEntityIndex:
                breakEvent.entityIndex,

            breakTick:
                breakEvent.breakTick,

            breakMatchTimeSeconds:
                breakEvent.breakMatchTimeSeconds,

            breakClock:
                breakEvent.breakClock,

            position:
                breakEvent.position,

            observedDrop:
                goldMatches.length >
                0

                    ? 'SOUL_PICKUP_ENTITY'

                    : 'NO_MATCH_FOUND',

            matchedClass:
                goldMatches[0]
                    ?.className
                ??
                null,

            matchedEntityIndex:
                goldMatches[0]
                    ?.entityIndex
                ??
                null,

            strict:
                goldMatches[0]
                    ?.strict
                ??
                null,

            deltaSeconds:
                goldMatches[0]
                    ?.deltaSeconds
                ??
                null,

            distance:
                goldMatches[0]
                    ?.distance
                ??
                null
        });


        continue;
    }


    if (
        breakEvent.resourceType ===
        'GOLDEN_STATUE'
    ) {

        const modifierMatches =
            rows

                .filter(
                    row =>
                        row.className ===
                            'CCitadel_Pickup_Modifier'
                )

                .sort(
                    compareAssociationQuality
                );


        canonicalDropObservations.push({

            breakKey:
                breakEvent.breakKey,

            resourceType:
                breakEvent.resourceType,

            resourceEntityIndex:
                breakEvent.entityIndex,

            breakTick:
                breakEvent.breakTick,

            breakMatchTimeSeconds:
                breakEvent.breakMatchTimeSeconds,

            breakClock:
                breakEvent.breakClock,

            position:
                breakEvent.position,

            observedDrop:
                modifierMatches.length >
                0

                    ? 'PERMANENT_MODIFIER_PICKUP_ENTITY'

                    : 'NO_MATCH_FOUND',

            matchedClass:
                modifierMatches[0]
                    ?.className
                ??
                null,

            matchedEntityIndex:
                modifierMatches[0]
                    ?.entityIndex
                ??
                null,

            strict:
                modifierMatches[0]
                    ?.strict
                ??
                null,

            deltaSeconds:
                modifierMatches[0]
                    ?.deltaSeconds
                ??
                null,

            distance:
                modifierMatches[0]
                    ?.distance
                ??
                null
        });
    }
}


// ============================================================
// OBSERVED DROP RATES
// ============================================================

const crateDropRows =
    canonicalDropObservations.filter(
        row =>
            row.resourceType ===
            'CRATE'
    );


const statueDropRows =
    canonicalDropObservations.filter(
        row =>
            row.resourceType ===
            'GOLDEN_STATUE'
    );


const crateObservedGoldDrops =
    crateDropRows.filter(
        row =>
            row.observedDrop ===
            'SOUL_PICKUP_ENTITY'
    );


const statueObservedModifierDrops =
    statueDropRows.filter(
        row =>
            row.observedDrop ===
            'PERMANENT_MODIFIER_PICKUP_ENTITY'
    );


const observedCrateDropRate =
    crateDropRows.length >
    0

        ? crateObservedGoldDrops.length /
          crateDropRows.length

        : null;


const observedStatueDropRate =
    statueDropRows.length >
    0

        ? statueObservedModifierDrops.length /
          statueDropRows.length

        : null;


// ============================================================
// TOP NEARBY CLASSES
// ============================================================

const allNearbyClassSummary =
    classSummaries

        .map(
            row => ({

                className:
                    row.className,

                rewardLike:
                    row.rewardLike,

                crateStrict:
                    row.CRATE
                        .strictAssociations,

                statueStrict:
                    row.GOLDEN_STATUE
                        .strictAssociations,

                crateRelaxed:
                    row.CRATE
                        .associations,

                statueRelaxed:
                    row.GOLDEN_STATUE
                        .associations
            })
        )

        .sort(
            (
                a,
                b
            ) =>
                (
                    b.crateStrict
                    +
                    b.statueStrict
                )
                -
                (
                    a.crateStrict
                    +
                    a.statueStrict
                )
        )

        .slice(
            0,
            50
        );


// ============================================================
// LIKELY REWARD CLASSES
// ============================================================

const likelyRewardClasses =
    classSummaries.filter(
        row =>
            row.rewardLike
    );


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        method:
            [
                'Load 1,261 confirmed breakable destruction events from Script 29',
                'Observe every non-breakable entity CREATE in the replay',
                'Find CREATEs immediately after and spatially near each confirmed break',
                'Assign each created entity to its best-matching break using temporal and spatial proximity',
                'Compare nearby entity classes between CRATE and GOLDEN_STATUE breaks',
                'Test CCitadel_Pickup_Gold and CCitadel_Pickup_Modifier as empirical reward candidates'
            ],

        canonicalBreakableMapping:
            {

                [SUBCLASS_CRATE]:
                    'CRATE',

                [SUBCLASS_GOLDEN_STATUE]:
                    'GOLDEN_STATUE'
            },

        matchingWindows:
            {

                strict: {

                    minDeltaTicks:
                        STRICT_MIN_DELTA_TICKS,

                    maxDeltaTicks:
                        STRICT_MAX_DELTA_TICKS,

                    minDeltaSeconds:
                        STRICT_MIN_DELTA_TICKS /
                        TICK_RATE,

                    maxDeltaSeconds:
                        STRICT_MAX_DELTA_TICKS /
                        TICK_RATE,

                    maxDistance:
                        STRICT_MAX_DISTANCE
                },

                relaxed: {

                    minDeltaTicks:
                        RELAXED_MIN_DELTA_TICKS,

                    maxDeltaTicks:
                        RELAXED_MAX_DELTA_TICKS,

                    minDeltaSeconds:
                        RELAXED_MIN_DELTA_TICKS /
                        TICK_RATE,

                    maxDeltaSeconds:
                        RELAXED_MAX_DELTA_TICKS /
                        TICK_RATE,

                    maxDistance:
                        RELAXED_MAX_DISTANCE
                }
            },

        confirmedBreaks:
            {

                total:
                    breaks.length,

                crates:
                    crateBreakCount,

                goldenStatues:
                    statueBreakCount
            },

        entityCreateScan:
            {

                totalEntityCreates,

                positionedEntityCreates,

                createsInsideTemporalWindow,

                primaryNearbyAssociations:
                    primaryAssociations.length,

                relaxedAssociationCount:
                    allRelaxedAssociations.length
            },

        externalBenchmarks:
            {

                note:
                    'Current public mechanics used only as a validation benchmark, not as the matching rule.',

                crateSoulDropChance:
                    EXPECTED_CRATE_DROP_RATE,

                goldenStatueBuffDropChance:
                    EXPECTED_STATUE_DROP_RATE
            },

        candidateTests:
            {

                CCitadel_Pickup_Gold:
                    goldPickupSummary,

                CCitadel_Pickup_Modifier:
                    modifierPickupSummary
            },

        observedDropRates:
            {

                crates: {

                    breakCount:
                        crateDropRows.length,

                    observedGoldPickupEntityCount:
                        crateObservedGoldDrops.length,

                    observedRate:
                        observedCrateDropRate,

                    expectedPublicRate:
                        EXPECTED_CRATE_DROP_RATE,

                    difference:
                        Number.isFinite(
                            observedCrateDropRate
                        )

                            ? observedCrateDropRate -
                              EXPECTED_CRATE_DROP_RATE

                            : null
                },

                goldenStatues: {

                    breakCount:
                        statueDropRows.length,

                    observedModifierPickupEntityCount:
                        statueObservedModifierDrops.length,

                    observedRate:
                        observedStatueDropRate,

                    expectedPublicRate:
                        EXPECTED_STATUE_DROP_RATE,

                    difference:
                        Number.isFinite(
                            observedStatueDropRate
                        )

                            ? observedStatueDropRate -
                              EXPECTED_STATUE_DROP_RATE

                            : null
                }
            },

        likelyRewardClasses,

        allNearbyClassSummary,

        classSummaries,

        canonicalDropObservations,

        candidateEntitySnapshots,

        primaryAssociations:
            primaryAssociations.filter(
                row =>
                    looksRewardLike(
                        row.className
                    )
            )
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
    'ENTITY CREATE SCAN'
);

console.log(
    '------------------'
);

console.log(
    `Total CREATE operations: ${totalEntityCreates}`
);

console.log(
    `Positioned CREATEs: ${positionedEntityCreates}`
);

console.log(
    `Primary nearby associations: ${primaryAssociations.length}`
);

console.log('');


console.log(
    'KNOWN PICKUP CANDIDATES'
);

console.log(
    '-----------------------'
);


printCandidate(
    'CCitadel_Pickup_Gold',
    goldPickupSummary
);


printCandidate(
    'CCitadel_Pickup_Modifier',
    modifierPickupSummary
);


console.log('');

console.log(
    'OBSERVED DROP RATES'
);

console.log(
    '-------------------'
);


console.log(
    `Crate -> CCitadel_Pickup_Gold: ${
        crateObservedGoldDrops.length
    }/${
        crateDropRows.length
    } = ${
        formatPercent(
            observedCrateDropRate
        )
    }`
);


console.log(
    `Public benchmark: ${
        formatPercent(
            EXPECTED_CRATE_DROP_RATE
        )
    }`
);


console.log('');


console.log(
    `Golden Statue -> CCitadel_Pickup_Modifier: ${
        statueObservedModifierDrops.length
    }/${
        statueDropRows.length
    } = ${
        formatPercent(
            observedStatueDropRate
        )
    }`
);


console.log(
    `Public benchmark: ${
        formatPercent(
            EXPECTED_STATUE_DROP_RATE
        )
    }`
);


console.log('');

console.log(
    'TOP NEARBY CREATE CLASSES'
);

console.log(
    '-------------------------'
);


for (
    const row
    of allNearbyClassSummary
        .slice(
            0,
            20
        )
) {

    console.log(
        `${
            row.className.padEnd(
                42
            )
        } crate=${
            String(
                row.crateStrict
            ).padStart(
                4
            )
        } statue=${
            String(
                row.statueStrict
            ).padStart(
                4
            )
        }`
    );
}


console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


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
// FIND BREAKS IN TICK WINDOW
//
// We know every break in advance from Script 29.
// Binary search prevents scanning 1,261 breaks for every CREATE.
// ============================================================

function findBreaksInTickWindow(
    createTick,
    sortedBreaks,
    minDelta,
    maxDelta
) {

    // createTick - breakTick = delta
    //
    // Therefore:
    //
    // createTick - maxDelta <= breakTick
    // createTick - minDelta >= breakTick

    const earliestBreakTick =
        createTick -
        maxDelta;


    const latestBreakTick =
        createTick -
        minDelta;


    const startIndex =
        lowerBoundBreakTick(
            sortedBreaks,
            earliestBreakTick
        );


    const matches =
        [];


    for (
        let i =
            startIndex;

        i <
        sortedBreaks.length;

        i++
    ) {

        const row =
            sortedBreaks[i];


        if (
            row.breakTick >
            latestBreakTick
        ) {

            break;
        }


        matches.push(
            row
        );
    }


    return matches;
}


// ============================================================
// LOWER BOUND
// ============================================================

function lowerBoundBreakTick(
    sortedBreaks,
    targetTick
) {

    let low =
        0;


    let high =
        sortedBreaks.length;


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
            sortedBreaks[
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
// REWARD-LIKE CLASS
// ============================================================

function looksRewardLike(
    className
) {

    if (
        knownCandidateClasses.has(
            className
        )
    ) {

        return true;
    }


    return (
        /pickup/i.test(
            className
        )
        ||
        /gold/i.test(
            className
        )
        ||
        /modifier/i.test(
            className
        )
        ||
        /buff/i.test(
            className
        )
        ||
        /powerup/i.test(
            className
        )
        ||
        /^CItemXP$/i.test(
            className
        )
    );
}


// ============================================================
// ENTITY FIELD SNAPSHOT
//
// Only used for reward-looking CREATEs.
//
// We take all currently present flattened fields rather than
// guessing field names ahead of time.
// ============================================================

function snapshotEntityFields(
    entity
) {

    const output =
        {};


    try {

        if (
            typeof entity.fieldEntries ===
            'function'
        ) {

            for (
                const [
                    name,
                    value
                ]
                of entity.fieldEntries()
            ) {

                output[
                    name
                ] =
                    serializeFieldValue(
                        value
                    );
            }


            return output;
        }

    } catch {
        // Fall through.
    }


    // --------------------------------------------------------
    // Minimal fallback
    // --------------------------------------------------------

    const fallbackFields =
        [

            'm_nSubclassID',

            'm_hOwnerEntity',

            'm_hOwner',

            'm_nOwnerId',

            'm_iTeamNum',

            'm_flCreateTime',

            'CBodyComponent.m_hModel',

            'm_nEntityId',

            'm_nValue',

            'm_iValue',

            'm_flValue',

            'm_nAmount',

            'm_iAmount',

            'm_nGold',

            'm_iGold',

            'm_nSouls',

            'm_iSouls',

            'm_nSoulValue',

            'm_iSoulValue'
        ];


    for (
        const field
        of fallbackFields
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

            output[
                field
            ] =
                serializeFieldValue(
                    value
                );
        }
    }


    return output;
}


// ============================================================
// SERIALIZE FIELD VALUE
// ============================================================

function serializeFieldValue(
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
        'number'
        ||
        typeof value ===
        'string'
        ||
        typeof value ===
        'boolean'
    ) {

        return value;
    }


    if (
        value instanceof Uint8Array
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

        return value
            .slice(
                0,
                50
            )
            .map(
                serializeFieldValue
            );
    }


    if (
        typeof value ===
        'object'
    ) {

        const result =
            {};


        let count =
            0;


        for (
            const [
                key,
                child
            ]
            of Object.entries(
                value
            )
        ) {

            if (
                count >=
                50
            ) {

                break;
            }


            result[
                key
            ] =
                serializeFieldValue(
                    child
                );


            count++;
        }


        return result;
    }


    return String(
        value
    );
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
        const value
        of candidates
    ) {

        const number =
            toFiniteNumber(
                value
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
// FIELD READ
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


// ============================================================
// WORLD POSITION
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
// POSITION NORMALIZATION
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


    const offset =
        Number(
            respawnValidation
                ?.timing
                ?.matchClockOffsetSeconds
        );


    const usableOffset =
        Number.isFinite(
            offset
        )

            ? offset

            : 30;


    return (
        tick /
        TICK_RATE
    )
    -
    usableOffset;
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
// ASSOCIATION QUALITY
// ============================================================

function compareAssociationQuality(
    a,
    b
) {

    if (
        a.strict !==
        b.strict
    ) {

        return a.strict
            ? -1
            : 1;
    }


    if (
        Math.abs(
            a.deltaTicks
        )
        !==
        Math.abs(
            b.deltaTicks
        )
    ) {

        return (
            Math.abs(
                a.deltaTicks
            )
            -
            Math.abs(
                b.deltaTicks
            )
        );
    }


    return a.distance -
        b.distance;
}


// ============================================================
// COUNTERS
// ============================================================

function incrementCounter(
    map,
    key
) {

    const normalized =
        String(
            key
        );


    map.set(

        normalized,

        (
            map.get(
                normalized
            )
            ??
            0
        )
        +
        1
    );
}


function incrementNearbyClassCounter(
    map,
    className,
    resourceType,
    strict
) {

    if (
        !map.has(
            className
        )
    ) {

        map.set(
            className,
            {

                CRATE:
                    {
                        relaxed: 0,
                        strict: 0
                    },

                GOLDEN_STATUE:
                    {
                        relaxed: 0,
                        strict: 0
                    },

                UNKNOWN:
                    {
                        relaxed: 0,
                        strict: 0
                    }
            }
        );
    }


    const record =
        map.get(
            className
        );


    const target =
        record[
            resourceType
        ]
        ??
        record.UNKNOWN;


    target.relaxed++;


    if (
        strict
    ) {

        target.strict++;
    }
}


// ============================================================
// GROUP BY
// ============================================================

function groupBy(
    array,
    selector
) {

    const map =
        new Map();


    for (
        const item
        of array
    ) {

        const key =
            selector(
                item
            );


        if (
            !map.has(
                key
            )
        ) {

            map.set(
                key,
                []
            );
        }


        map.get(
            key
        ).push(
            item
        );
    }


    return map;
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
                    a - b
            );


    if (
        clean.length ===
        0
    ) {

        return {

            count: 0,

            min: null,

            p10: null,

            p25: null,

            median: null,

            p75: null,

            p90: null,

            max: null,

            mean: null
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
// CONSOLE CANDIDATE
// ============================================================

function printCandidate(
    name,
    summary
) {

    console.log('');


    if (
        !summary
    ) {

        console.log(
            `${name}: no nearby associations found`
        );

        return;
    }


    console.log(
        name
    );


    console.log(
        `  crate strict: ${
            summary
                .CRATE
                .strictUniqueBreaks
        } breaks (${
            formatPercent(
                summary
                    .CRATE
                    .strictBreakAssociationRate
            )
        })`
    );


    console.log(
        `  statue strict: ${
            summary
                .GOLDEN_STATUE
                .strictUniqueBreaks
        } breaks (${
            formatPercent(
                summary
                    .GOLDEN_STATUE
                    .strictBreakAssociationRate
            )
        })`
    );


    console.log(
        `  crate relaxed: ${
            summary
                .CRATE
                .uniqueBreaks
        } breaks`
    );


    console.log(
        `  statue relaxed: ${
            summary
                .GOLDEN_STATUE
                .uniqueBreaks
        } breaks`
    );
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