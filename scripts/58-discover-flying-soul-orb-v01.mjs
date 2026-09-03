import {
    createReadStream,
    createWriteStream,
    existsSync,
    mkdirSync,
    writeFileSync
} from 'node:fs';

import {
    dirname,
    resolve
} from 'node:path';

import {
    createInterface
} from 'node:readline';

import {
    Parser,
    InterceptorStage
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


// ============================================================
// DEATH-LOCAL DISCOVERY WINDOW
//
// We know AssignedGold appears exactly at the Trooper death.
//
// The flying orb should originate from the same death event,
// but may initialize/move over the next few ticks.
// ============================================================

const MIN_TICK_DELTA =
    -2;


const MAX_TICK_DELTA =
    16;


// ============================================================
// SPATIAL SEARCH
// ============================================================

const MAX_LOCAL_DISTANCE_3D =
    800;


// ============================================================
// ISOLATED-DEATH SUBSET
//
// Wave Troopers often die nearly simultaneously.
//
// Candidate discovery becomes much cleaner when we separately
// score deaths without another soul-producing Trooper death
// immediately adjacent in time and space.
// ============================================================

const ISOLATION_TICK_RADIUS =
    12;


const ISOLATION_DISTANCE_3D =
    600;


// ============================================================
// SAMPLE / OUTPUT LIMITS
// ============================================================

const MAX_SAMPLES_PER_CLASS =
    30;


const MAX_TOP_CLASSES =
    60;


const MAX_TOP_MESSAGES =
    40;


const MAX_CHANGED_FIELDS =
    60;


const MAX_FIELD_NAMES =
    120;


const MAX_SAMPLE_OUTPUT_CLASSES =
    20;


// ============================================================
// KNOWN CLASSES TO EXCLUDE FROM ORB RANKING
//
// These are still counted in the full diagnostics.
// ============================================================

const KNOWN_NON_FLYING_ORB_CLASSES =
    new Set([

        'CNPC_Trooper',

        'CCitadel_Pickup_AssignedGold',

        'CCitadel_Pickup_Health',

        'CCitadelPlayerPawn',

        'CCitadelPlayerController',

        'CCitadel_BreakableProp',

        'CCitadel_Pickup_Gold',

        'CCitadel_Pickup_Modifier',

        'CCitadelItemPickupIdol',

        'CCitadelItemPunchableNeutralGold',

        'CCitadel_Ability_GoldenIdol'
    ]);


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const deathStreamPath =
    resolve(
        'output',
        replayName,
        'trooper_ground_soul_one_to_one_v01.jsonl'
    );


const rangeSummaryPath =
    resolve(
        'output',
        replayName,
        'trooper_ground_soul_range_validation_v01.json'
    );


const summaryPath =
    resolve(
        'output',
        replayName,
        'trooper_flying_soul_orb_discovery_v01.json'
    );


const samplePath =
    resolve(
        'output',
        replayName,
        'trooper_flying_soul_orb_candidate_samples_v01.jsonl'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        replayPath,
        deathStreamPath,
        rangeSummaryPath
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
// LOAD RANGE VALIDATION
// ============================================================

const rangeSummary =
    JSON.parse(
        await import(
            'node:fs/promises'
        )
        .then(
            fs =>
                fs.readFile(
                    rangeSummaryPath,
                    'utf8'
                )
        )
    );


if (
    rangeSummary
        ?.validation
        ?.pass !==
    true
) {

    throw new Error(
        'Script 57 range validation did not PASS.'
    );
}


// ============================================================
// LOAD VALIDATED GROUND-SOUL DEATHS
// ============================================================

console.log('');

console.log(
    'Loading validated soul-producing Trooper deaths...'
);


const rawDeaths =
    await loadJsonl(
        deathStreamPath
    );


const deaths =
    rawDeaths

        .map(
            normalizeDeath
        )

        .filter(
            row =>
                row
                &&
                row.groundSoulMatched
        );


console.log(
    `Validated ground-soul deaths: ${deaths.length}`
);


// ============================================================
// DEATH INDEX
// ============================================================

for (
    let i =
        0;

    i <
        deaths.length;

    i++
) {

    deaths[
        i
    ].deathIndexLocal =
        i;
}


// ============================================================
// IDENTIFY ISOLATED DEATHS
// ============================================================

console.log(
    'Identifying isolated deaths...'
);


for (
    let i =
        0;

    i <
        deaths.length;

    i++
) {

    const death =
        deaths[
            i
        ];


    let nearbyDeathCount =
        0;


    for (
        let j =
            0;

        j <
            deaths.length;

        j++
    ) {

        if (
            i ===
            j
        ) {

            continue;
        }


        const other =
            deaths[
                j
            ];


        const tickDelta =
            Math.abs(
                other.tick -
                death.tick
            );


        if (
            tickDelta >
            ISOLATION_TICK_RADIUS
        ) {

            continue;
        }


        if (
            !death.position
            ||
            !other.position
        ) {

            continue;
        }


        const distance =
            getDistance3D(
                death.position,
                other.position
            );


        if (
            distance <=
            ISOLATION_DISTANCE_3D
        ) {

            nearbyDeathCount++;
        }
    }


    death.nearbyValidatedDeathCount =
        nearbyDeathCount;


    death.isolated =
        nearbyDeathCount ===
        0;
}


const isolatedDeaths =
    deaths.filter(
        row =>
            row.isolated
    );


console.log(
    `Isolated validated deaths: ${isolatedDeaths.length}`
);


// ============================================================
// BUILD TICK -> DEATH WINDOW LOOKUP
// ============================================================

const deathIndexesByTick =
    new Map();


for (
    let deathIndex =
        0;

    deathIndex <
        deaths.length;

    deathIndex++
) {

    const death =
        deaths[
            deathIndex
        ];


    for (
        let tick =
            death.tick +
            MIN_TICK_DELTA;

        tick <=
            death.tick +
            MAX_TICK_DELTA;

        tick++
    ) {

        if (
            !deathIndexesByTick.has(
                tick
            )
        ) {

            deathIndexesByTick.set(
                tick,
                []
            );
        }


        deathIndexesByTick
            .get(
                tick
            )
            .push(
                deathIndex
            );
    }
}


// ============================================================
// ENTITY CLASS STATS
// ============================================================

const classStats =
    new Map();


function getClassStats(
    className
) {

    if (
        !classStats.has(
            className
        )
    ) {

        classStats.set(
            className,
            {

                className,

                eventAssociations:
                    0,

                temporalDeaths:
                    new Set(),

                spatialDeaths:
                    new Set(),

                exactSpatialDeaths:
                    new Set(),

                isolatedTemporalDeaths:
                    new Set(),

                isolatedSpatialDeaths:
                    new Set(),

                isolatedExactSpatialDeaths:
                    new Set(),

                bestSpatialByDeath:
                    new Map(),

                entityIndexesByDeath:
                    new Map(),

                operationCounts:
                    new Map(),

                changedFieldCounts:
                    new Map(),

                discoveredFieldNames:
                    new Set(),

                samples:
                    []
            }
        );
    }


    return classStats.get(
        className
    );
}


// ============================================================
// MESSAGE STATS
// ============================================================

const messageStats =
    new Map();


function getMessageStats(
    messageType
) {

    if (
        !messageStats.has(
            messageType
        )
    ) {

        messageStats.set(
            messageType,
            {

                messageType,

                packetCount:
                    0,

                deaths:
                    new Set(),

                exactDeaths:
                    new Set(),

                isolatedDeaths:
                    new Set(),

                isolatedExactDeaths:
                    new Set(),

                tickDeltas:
                    []
            }
        );
    }


    return messageStats.get(
        messageType
    );
}


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// ENTITY PACKETS
// ============================================================

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


        const nearbyDeathIndexes =
            deathIndexesByTick.get(
                tick
            );


        if (
            !nearbyDeathIndexes
            ||
            nearbyDeathIndexes.length ===
                0
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
                !className
            ) {

                continue;
            }


            const entityIndex =
                getEntityIndex(
                    entity
                );


            const operation =
                decodeOperation(
                    event.operation
                );


            const position =
                getBestPosition(
                    entity
                );


            const changedFields =
                extractChangedFields(
                    safeGetChanges(
                        event
                    )
                );


            const stats =
                getClassStats(
                    className
                );


            increment(
                stats.operationCounts,
                operation
            );


            for (
                const fieldName
                of changedFields
            ) {

                increment(
                    stats.changedFieldCounts,
                    fieldName
                );
            }


            if (
                stats.discoveredFieldNames.size <
                MAX_FIELD_NAMES
            ) {

                for (
                    const [
                        fieldName
                    ]
                    of getFieldEntries(
                        entity
                    )
                ) {

                    stats
                        .discoveredFieldNames
                        .add(
                            fieldName
                        );


                    if (
                        stats.discoveredFieldNames.size >=
                        MAX_FIELD_NAMES
                    ) {

                        break;
                    }
                }
            }


            for (
                const deathIndex
                of nearbyDeathIndexes
            ) {

                const death =
                    deaths[
                        deathIndex
                    ];


                const tickDelta =
                    tick -
                    death.tick;


                if (
                    tickDelta <
                        MIN_TICK_DELTA
                    ||
                    tickDelta >
                        MAX_TICK_DELTA
                ) {

                    continue;
                }


                stats.eventAssociations++;


                stats
                    .temporalDeaths
                    .add(
                        deathIndex
                    );


                if (
                    death.isolated
                ) {

                    stats
                        .isolatedTemporalDeaths
                        .add(
                            deathIndex
                        );
                }


                let distance3D =
                    null;


                let distanceXY =
                    null;


                let verticalDelta =
                    null;


                let spatialLocal =
                    false;


                if (
                    position
                    &&
                    death.position
                ) {

                    distance3D =
                        getDistance3D(
                            death.position,
                            position
                        );


                    distanceXY =
                        getDistanceXY(
                            death.position,
                            position
                        );


                    verticalDelta =
                        position.z -
                        death.position.z;


                    spatialLocal =
                        distance3D <=
                        MAX_LOCAL_DISTANCE_3D;
                }


                if (
                    spatialLocal
                ) {

                    stats
                        .spatialDeaths
                        .add(
                            deathIndex
                        );


                    if (
                        tickDelta ===
                        0
                    ) {

                        stats
                            .exactSpatialDeaths
                            .add(
                                deathIndex
                            );
                    }


                    if (
                        death.isolated
                    ) {

                        stats
                            .isolatedSpatialDeaths
                            .add(
                                deathIndex
                            );


                        if (
                            tickDelta ===
                            0
                        ) {

                            stats
                                .isolatedExactSpatialDeaths
                                .add(
                                    deathIndex
                                );
                        }
                    }


                    const score =
                        Math.abs(
                            tickDelta
                        )
                        *
                        100000
                        +
                        distance3D;


                    const currentBest =
                        stats
                            .bestSpatialByDeath
                            .get(
                                deathIndex
                            );


                    if (
                        !currentBest
                        ||
                        score <
                            currentBest.score
                    ) {

                        stats
                            .bestSpatialByDeath
                            .set(
                                deathIndex,
                                {

                                    score,

                                    tick,

                                    tickDelta,

                                    distance3D,

                                    distanceXY,

                                    verticalDelta,

                                    entityIndex,

                                    operation,

                                    position
                                }
                            );
                    }


                    if (
                        entityIndex !==
                        null
                    ) {

                        if (
                            !stats
                                .entityIndexesByDeath
                                .has(
                                    deathIndex
                                )
                        ) {

                            stats
                                .entityIndexesByDeath
                                .set(
                                    deathIndex,
                                    new Set()
                                );
                        }


                        stats
                            .entityIndexesByDeath
                            .get(
                                deathIndex
                            )
                            .add(
                                entityIndex
                            );
                    }
                }


                if (
                    stats.samples.length <
                        MAX_SAMPLES_PER_CLASS
                    &&
                    (
                        spatialLocal
                        ||
                        tickDelta ===
                            0
                    )
                ) {

                    stats.samples.push({

                        deathIndex,

                        deathKey:
                            death.deathKey,

                        deathClock:
                            death.clock,

                        deathTick:
                            death.tick,

                        deathPosition:
                            death.position,

                        isolatedDeath:
                            death.isolated,

                        tick,

                        tickDelta,

                        entityIndex,

                        className,

                        operation,

                        position,

                        distance3D,

                        distanceXY,

                        verticalDelta,

                        changedFields,

                        interestingFields:
                            getInterestingFields(
                                entity
                            )
                    });
                }
            }
        }
    }
);


// ============================================================
// MESSAGE PACKETS
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
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


        const nearbyDeathIndexes =
            deathIndexesByTick.get(
                tick
            );


        if (
            !nearbyDeathIndexes
            ||
            nearbyDeathIndexes.length ===
                0
        ) {

            return;
        }


        const messageType =
            decodeMessageType(
                messagePacket?.type
            );


        if (
            !messageType
        ) {

            return;
        }


        const stats =
            getMessageStats(
                messageType
            );


        stats.packetCount++;


        for (
            const deathIndex
            of nearbyDeathIndexes
        ) {

            const death =
                deaths[
                    deathIndex
                ];


            const tickDelta =
                tick -
                death.tick;


            if (
                tickDelta <
                    MIN_TICK_DELTA
                ||
                tickDelta >
                    MAX_TICK_DELTA
            ) {

                continue;
            }


            stats
                .deaths
                .add(
                    deathIndex
                );


            if (
                tickDelta ===
                0
            ) {

                stats
                    .exactDeaths
                    .add(
                        deathIndex
                    );
            }


            if (
                death.isolated
            ) {

                stats
                    .isolatedDeaths
                    .add(
                        deathIndex
                    );


                if (
                    tickDelta ===
                    0
                ) {

                    stats
                        .isolatedExactDeaths
                        .add(
                            deathIndex
                        );
                }
            }


            if (
                stats.tickDeltas.length <
                10000
            ) {

                stats.tickDeltas.push(
                    tickDelta
                );
            }
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
    'FLYING SOUL ORB DISCOVERY V0.1'
);

console.log(
    '========================================'
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Anchor deaths: ${deaths.length}`
);

console.log(
    `Isolated anchor deaths: ${isolatedDeaths.length}`
);

console.log(
    `Tick window: ${MIN_TICK_DELTA} .. +${MAX_TICK_DELTA}`
);

console.log(
    `Spatial radius: ${MAX_LOCAL_DISTANCE_3D}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// BUILD CLASS SUMMARIES
// ============================================================

const classSummaries =
    [];


for (
    const stats
    of classStats.values()
) {

    const spatialBest =
        [
            ...stats
                .bestSpatialByDeath
                .values()
        ];


    const isolatedBest =
        [
            ...stats
                .bestSpatialByDeath
                .entries()
        ]

        .filter(
            (
                [
                    deathIndex
                ]
            ) =>
                deaths[
                    deathIndex
                ]?.isolated
        )

        .map(
            (
                [
                    ,
                    value
                ]
            ) =>
                value
        );


    const uniqueEntityCounts =
        [
            ...stats
                .entityIndexesByDeath
                .values()
        ]
        .map(
            set =>
                set.size
        );


    const isolatedSpatialRate =
        rate(
            stats
                .isolatedSpatialDeaths
                .size,
            isolatedDeaths.length
        );


    const isolatedExactSpatialRate =
        rate(
            stats
                .isolatedExactSpatialDeaths
                .size,
            isolatedDeaths.length
        );


    const isolatedTemporalRate =
        rate(
            stats
                .isolatedTemporalDeaths
                .size,
            isolatedDeaths.length
        );


    const allSpatialRate =
        rate(
            stats
                .spatialDeaths
                .size,
            deaths.length
        );


    const oneEntityPerDeathRate =
        rate(
            uniqueEntityCounts.filter(
                value =>
                    value ===
                    1
            ).length,
            uniqueEntityCounts.length
        );


    const medianDistance =
        summarizeNumbers(
            isolatedBest.map(
                row =>
                    row.distance3D
            )
        ).median;


    const medianTickDelta =
        summarizeNumbers(
            isolatedBest.map(
                row =>
                    row.tickDelta
            )
        ).median;


    // ========================================================
    // DISCOVERY SCORE
    //
    // This is ranking-only, not a probability.
    //
    // True death-spawned orb candidates should:
    // - appear around many isolated deaths
    // - be spatially local
    // - often appear exactly on the death tick
    // - usually have one logical entity per death
    // ========================================================

    const score =
        (
            isolatedSpatialRate
            ??
            0
        )
        *
        100
        +
        (
            isolatedExactSpatialRate
            ??
            0
        )
        *
        40
        +
        (
            isolatedTemporalRate
            ??
            0
        )
        *
        10
        +
        (
            oneEntityPerDeathRate
            ??
            0
        )
        *
        10
        -
        (
            Number.isFinite(
                medianDistance
            )
                ? medianDistance /
                    1000
                : 0
        );


    classSummaries.push({

        className:
            stats.className,

        excludedKnownClass:
            KNOWN_NON_FLYING_ORB_CLASSES.has(
                stats.className
            ),

        discoveryScore:
            score,

        support:
            {

                temporalDeaths:
                    stats
                        .temporalDeaths
                        .size,

                temporalRate:
                    rate(
                        stats
                            .temporalDeaths
                            .size,
                        deaths.length
                    ),

                spatialDeaths:
                    stats
                        .spatialDeaths
                        .size,

                spatialRate:
                    allSpatialRate,

                exactSpatialDeaths:
                    stats
                        .exactSpatialDeaths
                        .size,

                exactSpatialRate:
                    rate(
                        stats
                            .exactSpatialDeaths
                            .size,
                        deaths.length
                    ),

                isolatedTemporalDeaths:
                    stats
                        .isolatedTemporalDeaths
                        .size,

                isolatedTemporalRate,

                isolatedSpatialDeaths:
                    stats
                        .isolatedSpatialDeaths
                        .size,

                isolatedSpatialRate,

                isolatedExactSpatialDeaths:
                    stats
                        .isolatedExactSpatialDeaths
                        .size,

                isolatedExactSpatialRate
            },

        geometry:
            {

                allBestSpatial:
                    {

                        tickDelta:
                            summarizeNumbers(
                                spatialBest.map(
                                    row =>
                                        row.tickDelta
                                )
                            ),

                        distance3D:
                            summarizeNumbers(
                                spatialBest.map(
                                    row =>
                                        row.distance3D
                                )
                            ),

                        distanceXY:
                            summarizeNumbers(
                                spatialBest.map(
                                    row =>
                                        row.distanceXY
                                )
                            ),

                        verticalDelta:
                            summarizeNumbers(
                                spatialBest.map(
                                    row =>
                                        row.verticalDelta
                                )
                            )
                    },

                isolatedBestSpatial:
                    {

                        tickDelta:
                            summarizeNumbers(
                                isolatedBest.map(
                                    row =>
                                        row.tickDelta
                                )
                            ),

                        distance3D:
                            summarizeNumbers(
                                isolatedBest.map(
                                    row =>
                                        row.distance3D
                                )
                            ),

                        distanceXY:
                            summarizeNumbers(
                                isolatedBest.map(
                                    row =>
                                        row.distanceXY
                                )
                            ),

                        verticalDelta:
                            summarizeNumbers(
                                isolatedBest.map(
                                    row =>
                                        row.verticalDelta
                                )
                            )
                    }
            },

        entityMultiplicity:
            {

                deathsWithSpatialEntityIds:
                    uniqueEntityCounts.length,

                oneEntityPerDeathRate,

                uniqueEntitiesPerDeath:
                    summarizeNumbers(
                        uniqueEntityCounts
                    )
            },

        eventAssociations:
            stats.eventAssociations,

        operations:
            mapToSortedObject(
                stats.operationCounts
            ),

        changedFields:
            mapToSortedObjectLimited(
                stats.changedFieldCounts,
                MAX_CHANGED_FIELDS
            ),

        discoveredFieldNames:
            [
                ...stats.discoveredFieldNames
            ]
            .sort(),

        samples:
            stats.samples
    });
}


// ============================================================
// SORT CANDIDATES
// ============================================================

classSummaries.sort(
    (
        a,
        b
    ) =>
        b.discoveryScore -
        a.discoveryScore
);


// ============================================================
// UNKNOWN CANDIDATES
// ============================================================

const candidateClasses =
    classSummaries

        .filter(
            row =>
                !row.excludedKnownClass
        )

        .filter(
            row =>
                row.support
                    .isolatedTemporalDeaths >
                0
        )

        .slice(
            0,
            MAX_TOP_CLASSES
        );


// ============================================================
// MESSAGE SUMMARIES
// ============================================================

const messageSummaries =
    [];


for (
    const stats
    of messageStats.values()
) {

    messageSummaries.push({

        messageType:
            stats.messageType,

        packetCount:
            stats.packetCount,

        deathSupport:
            stats.deaths.size,

        deathSupportRate:
            rate(
                stats.deaths.size,
                deaths.length
            ),

        exactDeathSupport:
            stats.exactDeaths.size,

        exactDeathSupportRate:
            rate(
                stats.exactDeaths.size,
                deaths.length
            ),

        isolatedDeathSupport:
            stats.isolatedDeaths.size,

        isolatedDeathSupportRate:
            rate(
                stats.isolatedDeaths.size,
                isolatedDeaths.length
            ),

        isolatedExactSupport:
            stats.isolatedExactDeaths.size,

        isolatedExactSupportRate:
            rate(
                stats.isolatedExactDeaths.size,
                isolatedDeaths.length
            ),

        tickDelta:
            summarizeNumbers(
                stats.tickDeltas
            )
    });
}


messageSummaries.sort(
    (
        a,
        b
    ) =>
        (
            b.isolatedExactSupportRate
            ??
            0
        )
        -
        (
            a.isolatedExactSupportRate
            ??
            0
        )
        ||
        (
            b.isolatedDeathSupportRate
            ??
            0
        )
        -
        (
            a.isolatedDeathSupportRate
            ??
            0
        )
);


// ============================================================
// WRITE TOP-CANDIDATE SAMPLE STREAM
// ============================================================

mkdirSync(
    dirname(
        samplePath
    ),
    {
        recursive: true
    }
);


const sampleWriter =
    createWriteStream(
        samplePath,
        {
            encoding:
                'utf8'
        }
    );


for (
    const candidate
    of candidateClasses.slice(
        0,
        MAX_SAMPLE_OUTPUT_CLASSES
    )
) {

    for (
        const sample
        of candidate.samples
    ) {

        sampleWriter.write(
            JSON.stringify({

                candidateClass:
                    candidate.className,

                discoveryScore:
                    candidate.discoveryScore,

                ...sample
            })
            +
            '\n'
        );
    }
}


await finishWriter(
    sampleWriter
);


// ============================================================
// SANITY CHECK: KNOWN ASSIGNED GOLD
//
// The discovery machinery should rediscover the already-known
// ground soul as a high-support local class.
//
// This validates the anchor/window logic.
// ============================================================

const assignedGoldDiagnostic =
    classSummaries.find(
        row =>
            row.className ===
            'CCitadel_Pickup_AssignedGold'
    )
    ??
    null;


// ============================================================
// VALIDATION
// ============================================================

const validation =
    {

        rangeValidationPassed:
            {

                actual:
                    rangeSummary
                        ?.validation
                        ?.pass,

                expected:
                    true,

                pass:
                    rangeSummary
                        ?.validation
                        ?.pass ===
                    true
            },

        validatedGroundSoulDeaths:
            {

                actual:
                    deaths.length,

                expected:
                    replayName ===
                        'test'
                        ? 1388
                        : '>0',

                pass:
                    replayName ===
                        'test'

                        ? deaths.length ===
                            1388

                        : deaths.length >
                            0
            },

        isolatedDeathsObserved:
            {

                actual:
                    isolatedDeaths.length,

                expected:
                    '>0',

                pass:
                    isolatedDeaths.length >
                    0
            },

        entityClassesObserved:
            {

                actual:
                    classSummaries.length,

                expected:
                    '>0',

                pass:
                    classSummaries.length >
                    0
            },

        assignedGoldRediscovered:
            {

                actual:
                    assignedGoldDiagnostic
                        ?.support
                        ?.spatialDeaths
                    ??
                    0,

                expected:
                    '>0',

                pass:
                    (
                        assignedGoldDiagnostic
                            ?.support
                            ?.spatialDeaths
                        ??
                        0
                    ) >
                    0
            },

        nonKnownCandidateClassesObserved:
            {

                actual:
                    candidateClasses.length,

                expected:
                    '>0',

                pass:
                    candidateClasses.length >
                    0
            }
    };


const validationPass =
    Object
        .values(
            validation
        )
        .every(
            row =>
                row.pass
        );


// ============================================================
// SUMMARY
// ============================================================

const summary =
    {

        replay:
            replayName,

        version:
            'TROOPER_FLYING_SOUL_ORB_DISCOVERY_V01',

        canonical:
            false,

        status:
            validationPass
                ? 'TARGETED_DISCOVERY_COMPLETE'
                : 'DIAGNOSTIC_ONLY',

        anchorSet:
            {

                validatedGroundSoulDeaths:
                    deaths.length,

                isolatedDeaths:
                    isolatedDeaths.length,

                definition:
                    'Trooper deaths with a one-to-one CCitadel_Pickup_AssignedGold ground-soul match.',

                reason:
                    'These are high-confidence ordinary soul-producing deaths and therefore the cleanest available anchors for discovering the separate flying deniable Soul Orb.'
            },

        searchWindow:
            {

                minTickDelta:
                    MIN_TICK_DELTA,

                maxTickDelta:
                    MAX_TICK_DELTA,

                maxLocalDistance3D:
                    MAX_LOCAL_DISTANCE_3D,

                isolationTickRadius:
                    ISOLATION_TICK_RADIUS,

                isolationDistance3D:
                    ISOLATION_DISTANCE_3D
            },

        knownGroundSoulSanityCheck:
            assignedGoldDiagnostic,

        topCandidateClasses:
            candidateClasses,

        allObservedClasses:
            classSummaries,

        topMessageTypes:
            messageSummaries.slice(
                0,
                MAX_TOP_MESSAGES
            ),

        interpretationGuide:
            {

                strongestEntitySignature:
                    [

                        'High isolatedSpatialRate.',

                        'High isolatedExactSpatialRate or very tight +1/+few tick distribution.',

                        'Small median initial distance from Trooper death.',

                        'Approximately one candidate entity per isolated Trooper death.',

                        'Lifecycle fields suggesting movement, ownership, targetability, health, active state, or destruction.'
                    ],

                important:
                    'CREATE is not treated as authoritative spawn because pooled/PVS recreations have already been demonstrated elsewhere in the replay.',

                ifNoEntityCandidateEmerges:
                    'The flying soul may be represented primarily through particles, user messages, or a non-obvious existing entity. Use the death-local message ranking as the next lead.',

                nextStep:
                    'Take the strongest candidate class and reconstruct its lifecycle through spawn, flight, secure, deny, and expiry.'
            },

        validation:
            {

                pass:
                    validationPass,

                checks:
                    validation
            },

        outputs:
            {

                summary:
                    summaryPath,

                candidateSamples:
                    samplePath
            }
    };


// ============================================================
// WRITE SUMMARY
// ============================================================

mkdirSync(
    dirname(
        summaryPath
    ),
    {
        recursive: true
    }
);


writeFileSync(

    summaryPath,

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
    '========================================'
);

console.log(
    'FLYING SOUL ORB DISCOVERY RESULTS'
);

console.log(
    '========================================'
);

console.log('');

console.log(
    `Anchor deaths: ${deaths.length}`
);

console.log(
    `Isolated deaths: ${isolatedDeaths.length}`
);

console.log(
    `Entity classes near anchors: ${classSummaries.length}`
);

console.log('');

console.log(
    'KNOWN GROUND SOUL SANITY CHECK'
);

console.log(
    '------------------------------'
);


if (
    assignedGoldDiagnostic
) {

    console.log(
        `CCitadel_Pickup_AssignedGold spatial support: ${
            formatPercent(
                assignedGoldDiagnostic
                    .support
                    .spatialRate
            )
        }`
    );

    console.log(
        `Isolated spatial support: ${
            formatPercent(
                assignedGoldDiagnostic
                    .support
                    .isolatedSpatialRate
            )
        }`
    );

} else {

    console.log(
        'AssignedGold was not rediscovered.'
    );
}


console.log('');

console.log(
    'TOP UNKNOWN ENTITY CANDIDATES'
);

console.log(
    '-----------------------------'
);


for (
    const candidate
    of candidateClasses.slice(
        0,
        25
    )
) {

    console.log(
        `${
            candidate.className.padEnd(
                48
            )
        } score=${
            candidate.discoveryScore.toFixed(
                2
            ).padStart(
                7
            )
        } isoSpatial=${
            formatPercent(
                candidate
                    .support
                    .isolatedSpatialRate
            ).padStart(
                7
            )
        } isoExact=${
            formatPercent(
                candidate
                    .support
                    .isolatedExactSpatialRate
            ).padStart(
                7
            )
        } medDist=${
            formatNumber(
                candidate
                    .geometry
                    .isolatedBestSpatial
                    .distance3D
                    .median
            ).padStart(
                8
            )
        } medTick=${
            formatNumber(
                candidate
                    .geometry
                    .isolatedBestSpatial
                    .tickDelta
                    .median
            ).padStart(
                6
            )
        }`
    );
}


console.log('');

console.log(
    'TOP DEATH-LOCAL MESSAGE TYPES'
);

console.log(
    '-----------------------------'
);


for (
    const message
    of messageSummaries.slice(
        0,
        20
    )
) {

    console.log(
        `${
            message.messageType.padEnd(
                52
            )
        } iso=${
            formatPercent(
                message.isolatedDeathSupportRate
            ).padStart(
                7
            )
        } exact=${
            formatPercent(
                message.isolatedExactSupportRate
            ).padStart(
                7
            )
        }`
    );
}


console.log('');

console.log(
    'VALIDATION'
);

console.log(
    '----------'
);


for (
    const [
        key,
        check
    ]
    of Object.entries(
        validation
    )
) {

    console.log(
        `${
            check.pass
                ? 'PASS'
                : 'FAIL'
        }  ${
            key.padEnd(
                36
            )
        } actual=${
            JSON.stringify(
                check.actual
            )
        } expected=${
            JSON.stringify(
                check.expected
            )
        }`
    );
}


console.log('');

console.log(
    `OVERALL: ${
        validationPass
            ? 'PASS'
            : 'FAIL'
    }`
);

console.log('');

console.log(
    `Summary:\n${summaryPath}`
);

console.log('');

console.log(
    `Candidate samples:\n${samplePath}`
);

console.log('');


// ============================================================
// NORMALIZE DEATH
// ============================================================

function normalizeDeath(
    row
) {

    const tick =
        finite(
            row
                ?.timing
                ?.tick
        );


    const timeSeconds =
        finite(
            row
                ?.timing
                ?.timeSeconds
        );


    const position =
        normalizePosition(
            row
                ?.trooper
                ?.position
        );


    if (
        tick ===
            null
        ||
        timeSeconds ===
            null
        ||
        !position
    ) {

        return null;
    }


    const groundSoulMatched =
        row
            ?.match
            ?.status ===
            'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
        ||
        Boolean(
            row.groundSoul
        );


    return {

        sourceDeathIndex:
            finite(
                row.deathIndex
            ),

        deathKey:
            row.deathKey
            ??
            null,

        entityIndex:
            finite(
                row
                    ?.trooper
                    ?.entityIndex
            ),

        tick,

        timeSeconds,

        clock:
            row
                ?.timing
                ?.clock
            ??
            null,

        team:
            finite(
                row
                    ?.trooper
                    ?.team
            ),

        lane:
            finite(
                row
                    ?.trooper
                    ?.lane
            ),

        baseType:
            row
                ?.trooper
                ?.baseType
            ??
            'UNKNOWN',

        variantLabel:
            row
                ?.trooper
                ?.variantLabel
            ??
            'UNKNOWN',

        position,

        groundSoulMatched,

        isolated:
            false,

        nearbyValidatedDeathCount:
            null
    };
}


// ============================================================
// SAFE CHANGES
// ============================================================

function safeGetChanges(
    event
) {

    try {

        if (
            typeof event.getChanges ===
            'function'
        ) {

            return event.getChanges();
        }

    } catch {

        return null;
    }


    return null;
}


// ============================================================
// EXTRACT CHANGE FIELD NAMES
// ============================================================

function extractChangedFields(
    raw
) {

    if (
        raw ===
            null
        ||
        raw ===
            undefined
    ) {

        return [];
    }


    if (
        raw instanceof Map
    ) {

        return [
            ...raw.keys()
        ]
        .map(
            value =>
                String(
                    value
                )
        );
    }


    if (
        Array.isArray(
            raw
        )
    ) {

        const result =
            [];


        for (
            const row
            of raw
        ) {

            if (
                Array.isArray(
                    row
                )
                &&
                row.length >
                    0
            ) {

                result.push(
                    String(
                        row[
                            0
                        ]
                    )
                );


                continue;
            }


            if (
                row
                &&
                typeof row ===
                    'object'
            ) {

                const name =
                    row.fieldName
                    ??
                    row.name
                    ??
                    row.key
                    ??
                    row.path
                    ??
                    null;


                if (
                    name
                ) {

                    result.push(
                        String(
                            name
                        )
                    );
                }
            }
        }


        return [
            ...new Set(
                result
            )
        ];
    }


    if (
        typeof raw ===
        'object'
    ) {

        return Object.keys(
            raw
        );
    }


    return [];
}


// ============================================================
// FIELD ENTRIES
// ============================================================

function getFieldEntries(
    entity
) {

    try {

        if (
            typeof entity.fieldEntries ===
            'function'
        ) {

            return [
                ...entity.fieldEntries()
            ]
            .map(
                row => {

                    if (
                        Array.isArray(
                            row
                        )
                    ) {

                        return [
                            String(
                                row[
                                    0
                                ]
                            ),
                            row[
                                1
                            ]
                        ];
                    }


                    if (
                        row
                        &&
                        typeof row ===
                            'object'
                    ) {

                        return [

                            String(
                                row.name
                                ??
                                row.key
                                ??
                                row.fieldName
                                ??
                                row.path
                                ??
                                'UNKNOWN'
                            ),

                            row.value
                        ];
                    }


                    return [
                        String(
                            row
                        ),
                        null
                    ];
                }
            );
        }

    } catch {

        // Ignore.
    }


    return [];
}


// ============================================================
// INTERESTING GENERIC FIELDS
// ============================================================

function getInterestingFields(
    entity
) {

    const fieldNames =
        [

            'm_bActive',
            'm_bInteractive',

            'm_iTeamNum',

            'm_nSubclassID',

            'm_iHealth',
            'm_iMaxHealth',

            'm_hOwner',
            'm_hOwnerEntity',
            'm_hTarget',
            'm_hTargetEntity',
            'm_hVacuumTarget',

            'm_flCreateTime',

            'm_flCapsuleRadius',

            'm_vecVelocity',
            'm_vecAbsVelocity',

            'm_vInitialVelocity',
            'm_vInitialVacuumVel',

            'm_vVacuumStartPos'
        ];


    const result =
        {};


    for (
        const fieldName
        of fieldNames
    ) {

        const value =
            safeGetField(
                entity,
                fieldName
            );


        if (
            value ===
                undefined
        ) {

            continue;
        }


        result[
            fieldName
        ] =
            serializeValue(
                value
            );
    }


    return result;
}


// ============================================================
// POSITION
// ============================================================

function getBestPosition(
    entity
) {

    // ========================================================
    // CELL-BASED POSITION
    // ========================================================

    const cellPosition =
        getCellWorldPosition(
            entity
        );


    if (
        cellPosition
    ) {

        return cellPosition;
    }


    // ========================================================
    // VECTOR-BASED FALLBACKS
    // ========================================================

    const vectorFields =
        [

            'CGameSceneNode.m_vecOrigin',

            'CBodyComponent.m_vecAbsOrigin',

            'm_vecAbsOrigin',

            'm_vecOrigin'
        ];


    for (
        const fieldName
        of vectorFields
    ) {

        const position =
            normalizeVector(
                safeGetField(
                    entity,
                    fieldName
                )
            );


        if (
            position
        ) {

            return position;
        }
    }


    return null;
}


// ============================================================
// CELL WORLD POSITION
// ============================================================

function getCellWorldPosition(
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
// VECTOR NORMALIZATION
// ============================================================

function normalizeVector(
    value
) {

    if (
        !value
    ) {

        return null;
    }


    if (
        Array.isArray(
            value
        )
        &&
        value.length >=
            2
    ) {

        const x =
            finite(
                value[
                    0
                ]
            );


        const y =
            finite(
                value[
                    1
                ]
            );


        const z =
            finite(
                value[
                    2
                ]
            )
            ??
            0;


        if (
            x !==
                null
            &&
            y !==
                null
        ) {

            return {
                x,
                y,
                z
            };
        }
    }


    if (
        typeof value ===
        'object'
    ) {

        const x =
            finite(
                value.x
                ??
                value.X
                ??
                value[
                    0
                ]
            );


        const y =
            finite(
                value.y
                ??
                value.Y
                ??
                value[
                    1
                ]
            );


        const z =
            finite(
                value.z
                ??
                value.Z
                ??
                value[
                    2
                ]
            )
            ??
            0;


        if (
            x !==
                null
            &&
            y !==
                null
        ) {

            return {
                x,
                y,
                z
            };
        }
    }


    return null;
}


// ============================================================
// FIELD ACCESS
// ============================================================

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

        // Missing field.
    }


    return undefined;
}


// ============================================================
// ENTITY CLASS
// ============================================================

function getEntityClassName(
    entity
) {

    try {

        if (
            typeof entity.getClassName ===
            'function'
        ) {

            const value =
                entity.getClassName();


            if (
                value
            ) {

                return String(
                    value
                );
            }
        }

    } catch {

        // Fall through.
    }


    return (
        entity.className
        ??
        entity
            ?.class
            ?.name
        ??
        entity
            ?._className
        ??
        null
    );
}


// ============================================================
// ENTITY INDEX
// ============================================================

function getEntityIndex(
    entity
) {

    const direct =
        finite(
            entity?.index
            ??
            entity?.entityIndex
        );


    if (
        direct !==
        null
    ) {

        return direct;
    }


    try {

        if (
            typeof entity.getIndex ===
            'function'
        ) {

            return finite(
                entity.getIndex()
            );
        }

    } catch {

        // Fall through.
    }


    return null;
}


// ============================================================
// OPERATION
// ============================================================

function decodeOperation(
    operation
) {

    const code =
        operation
            ?._code
        ??
        operation
            ?.code
        ??
        operation;


    const text =
        String(
            code
            ??
            'UNKNOWN'
        )
        .toUpperCase();


    if (
        text.includes(
            'CREATE'
        )
    ) {

        return 'CREATE';
    }


    if (
        text.includes(
            'UPDATE'
        )
    ) {

        return 'UPDATE';
    }


    if (
        text.includes(
            'LEAVE'
        )
    ) {

        return 'LEAVE';
    }


    if (
        text.includes(
            'DELETE'
        )
    ) {

        return 'DELETE';
    }


    return text;
}


// ============================================================
// MESSAGE TYPE
// ============================================================

function decodeMessageType(
    type
) {

    if (
        type ===
            null
        ||
        type ===
            undefined
    ) {

        return null;
    }


    const code =
        type
            ?._code
        ??
        type
            ?.code
        ??
        null;


    const id =
        type
            ?._id
        ??
        type
            ?.id
        ??
        null;


    if (
        code !==
            null
        &&
        code !==
            undefined
    ) {

        return String(
            code
        );
    }


    if (
        id !==
            null
        &&
        id !==
            undefined
    ) {

        return `MESSAGE_ID_${id}`;
    }


    return String(
        type
    );
}


// ============================================================
// DEATH POSITION
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


// ============================================================
// DISTANCE
// ============================================================

function getDistance3D(
    a,
    b
) {

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


function getDistanceXY(
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
// LOAD JSONL
// ============================================================

async function loadJsonl(
    path
) {

    const rows =
        [];


    const reader =
        createInterface({

            input:
                createReadStream(
                    path,
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
        of reader
    ) {

        if (
            !line.trim()
        ) {

            continue;
        }


        try {

            rows.push(
                JSON.parse(
                    line
                )
            );

        } catch {

            // Ignore malformed line.
        }
    }


    return rows;
}


// ============================================================
// COUNTERS
// ============================================================

function increment(
    map,
    key
) {

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


function mapToSortedObject(
    map
) {

    return Object.fromEntries(
        [
            ...map.entries()
        ]
        .sort(
            (
                a,
                b
            ) =>
                b[
                    1
                ]
                -
                a[
                    1
                ]
        )
    );
}


function mapToSortedObjectLimited(
    map,
    limit
) {

    return Object.fromEntries(
        [
            ...map.entries()
        ]
        .sort(
            (
                a,
                b
            ) =>
                b[
                    1
                ]
                -
                a[
                    1
                ]
        )
        .slice(
            0,
            limit
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
            clean[
                0
            ],

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


function percentile(
    sorted,
    proportion
) {

    if (
        sorted.length ===
        1
    ) {

        return sorted[
            0
        ];
    }


    const position =
        (
            sorted.length -
            1
        )
        *
        proportion;


    const lower =
        Math.floor(
            position
        );


    const upper =
        Math.ceil(
            position
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
        position -
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
// VALUES
// ============================================================

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


    if (
        Array.isArray(
            value
        )
    ) {

        return value.map(
            serializeValue
        );
    }


    if (
        typeof value ===
        'object'
    ) {

        const result =
            {};


        for (
            const [
                key,
                nestedValue
            ]
            of Object.entries(
                value
            )
        ) {

            result[
                key
            ] =
                serializeValue(
                    nestedValue
                );
        }


        return result;
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


    return numerator /
        denominator;
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
        2
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


// ============================================================
// WRITER
// ============================================================

function finishWriter(
    writer
) {

    return new Promise(
        (
            resolvePromise,
            rejectPromise
        ) => {

            writer.on(
                'error',
                rejectPromise
            );


            writer.end(
                resolvePromise
            );
        }
    );
}