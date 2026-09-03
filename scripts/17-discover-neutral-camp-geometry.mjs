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

const SAMPLE_EVERY_TICKS =
    16;

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );

const outputPath =
    resolve(
        'output',
        replayName,
        'neutral_camp_geometry.json'
    );


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// NEUTRAL SLOT STORAGE
// ============================================================

const slots =
    new Map();

let sampledTicks =
    0;

let observations =
    0;


// ============================================================
// SAMPLE REPLAY STATE
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    demoPacket => {

        const tick =
            demoPacket.tick;


        if (
            !Number.isFinite(tick)
            ||
            tick % SAMPLE_EVERY_TICKS !== 0
        ) {

            return;
        }


        sampledTicks++;


        const demo =
            parser.getDemo();


        const neutrals =
            demo.getEntitiesByClassName(
                'CNPC_TrooperNeutral'
            );


        for (
            const neutral
            of neutrals
        ) {

            observations++;


            const entityIndex =
                Number(
                    neutral.index
                );


            if (
                !Number.isFinite(
                    entityIndex
                )
            ) {

                continue;
            }


            const subclassId =
                numberField(
                    neutral,
                    'm_nSubclassID'
                );


            const health =
                numberField(
                    neutral,
                    'm_iHealth'
                );


            const lifeState =
                numberField(
                    neutral,
                    'm_lifeState'
                );


            const npcState =
                numberField(
                    neutral,
                    'm_NPCState'
                );


            const position =
                worldPosition(
                    neutral
                );


            if (
                !slots.has(
                    entityIndex
                )
            ) {

                slots.set(
                    entityIndex,
                    {

                        entityIndex,

                        subclassCounts:
                            new Map(),

                        firstObservedTick:
                            tick,

                        lastObservedTick:
                            tick,

                        firstPosition:
                            position,

                        alivePositions:
                            [],

                        idlePositions:
                            [],

                        observations:
                            0
                    }
                );
            }


            const slot =
                slots.get(
                    entityIndex
                );


            slot.observations++;

            slot.lastObservedTick =
                tick;


            if (
                Number.isFinite(
                    subclassId
                )
            ) {

                const key =
                    String(
                        subclassId
                    );


                slot.subclassCounts.set(

                    key,

                    (
                        slot.subclassCounts.get(
                            key
                        )
                        ??
                        0
                    )
                    +
                    1
                );
            }


            if (
                !position
            ) {

                continue;
            }


            if (
                !slot.firstPosition
            ) {

                slot.firstPosition =
                    position;
            }


            const alive =
                (
                    Number.isFinite(
                        health
                    )
                        ? health > 0
                        : lifeState === 0
                );


            if (
                alive
            ) {

                slot.alivePositions.push(
                    position
                );
            }


            // NPCState 2 was repeatedly observed as the
            // normal/idle live neutral state in our earlier
            // resource extraction.
            //
            // These observations are preferable for estimating
            // the camp's fixed spawn slot because aggroed
            // neutrals can move around.

            if (
                alive
                &&
                npcState === 2
            ) {

                slot.idlePositions.push(
                    position
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
    'Reading neutral geometry directly from replay...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// CANONICAL SLOTS
// ============================================================

const canonicalSlots =
    [...slots.values()]

        .map(
            formatSlot
        )

        .filter(
            slot =>
                slot.position
        )

        .sort(
            (
                a,
                b
            ) =>
                a.entityIndex
                -
                b.entityIndex
        );


console.log(
    `Unique neutral entity indexes: ${slots.size}`
);

console.log(
    `Canonical neutral slots with positions: ${canonicalSlots.length}`
);


// ============================================================
// PAIRWISE DISTANCES
// ============================================================

const pairDistances =
    [];


for (
    let i = 0;
    i < canonicalSlots.length;
    i++
) {

    for (
        let j = i + 1;
        j < canonicalSlots.length;
        j++
    ) {

        const a =
            canonicalSlots[i];

        const b =
            canonicalSlots[j];


        pairDistances.push({

            entityA:
                a.entityIndex,

            entityB:
                b.entityIndex,

            subclassA:
                a.subclassId,

            subclassB:
                b.subclassId,

            distanceXY:
                distanceXY(
                    a.position,
                    b.position
                ),

            distanceXYZ:
                distanceXYZ(
                    a.position,
                    b.position
                )
        });
    }
}


// ============================================================
// NEAREST NEIGHBORS
// ============================================================

const nearestNeighbors =
    [];


for (
    const slot
    of canonicalSlots
) {

    const nearest =
        canonicalSlots

            .filter(
                other =>
                    other.entityIndex
                    !==
                    slot.entityIndex
            )

            .map(
                other => ({

                    entityIndex:
                        other.entityIndex,

                    subclassId:
                        other.subclassId,

                    distanceXY:
                        distanceXY(
                            slot.position,
                            other.position
                        ),

                    distanceXYZ:
                        distanceXYZ(
                            slot.position,
                            other.position
                        )
                })
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    a.distanceXY
                    -
                    b.distanceXY
            )

            .slice(
                0,
                12
            );


    nearestNeighbors.push({

        entityIndex:
            slot.entityIndex,

        subclassId:
            slot.subclassId,

        unitType:
            slot.unitType,

        position:
            slot.position,

        nearest
    });
}


// ============================================================
// NEAREST-NEIGHBOR STATISTICS
// ============================================================

const firstNeighborDistances =
    neighborRankDistances(
        nearestNeighbors,
        0
    );

const secondNeighborDistances =
    neighborRankDistances(
        nearestNeighbors,
        1
    );

const thirdNeighborDistances =
    neighborRankDistances(
        nearestNeighbors,
        2
    );


// ============================================================
// DISTANCE HISTOGRAM
// ============================================================

const histogram =
    buildHistogram(

        pairDistances.map(
            row =>
                row.distanceXY
        ),

        50,

        5000
    );


// ============================================================
// TEST CLUSTER RADII
// ============================================================

const thresholds =
    [
        100,
        125,
        150,
        175,
        200,
        225,
        250,
        275,
        300,
        325,
        350,
        375,
        400,
        450,
        500,
        550,
        600,
        650,
        700,
        800,
        900,
        1000
    ];


const thresholdResults =
    thresholds.map(
        threshold => {

            const clusters =
                connectedComponents(
                    canonicalSlots,
                    threshold
                );


            return {

                threshold,

                clusterCount:
                    clusters.length,

                singletonCount:
                    clusters.filter(
                        cluster =>
                            cluster.length === 1
                    ).length,

                sizeDistribution:
                    countValues(
                        clusters.map(
                            cluster =>
                                cluster.length
                        )
                    ),

                clusters:
                    clusters.map(
                        (
                            cluster,
                            index
                        ) => ({

                            candidateClusterId:
                                index + 1,

                            size:
                                cluster.length,

                            entityIndexes:
                                cluster.map(
                                    slot =>
                                        slot.entityIndex
                                ),

                            subclassIds:
                                cluster.map(
                                    slot =>
                                        slot.subclassId
                                ),

                            unitTypes:
                                cluster.map(
                                    slot =>
                                        slot.unitType
                                ),

                            centroid:
                                centroid(
                                    cluster.map(
                                        slot =>
                                            slot.position
                                    )
                                )
                        })
                    )
            };
        }
    );


// ============================================================
// SUBCLASS SUMMARY
// ============================================================

const subclassSummary =
    countValues(
        canonicalSlots.map(
            slot =>
                slot.subclassId
        )
    );


const unitTypeSummary =
    countValues(
        canonicalSlots.map(
            slot =>
                slot.unitType
        )
    );


// ============================================================
// OUTPUT
// ============================================================

const output = {

    replay:
        replayName,

    source:
        'direct replay entity sampling',

    sourceClass:
        'CNPC_TrooperNeutral',

    sampleEveryTicks:
        SAMPLE_EVERY_TICKS,

    sampledTicks,

    totalNeutralObservations:
        observations,

    uniqueNeutralEntityIndexes:
        slots.size,

    canonicalSlotCount:
        canonicalSlots.length,

    expectedSlotCountFromPriorLogicalInstanceAnalysis:
        146,

    subclassSummary,

    unitTypeSummary,

    slots:
        canonicalSlots,

    nearestNeighbors,

    nearestNeighborStatistics: {

        first:
            summarize(
                firstNeighborDistances
            ),

        second:
            summarize(
                secondNeighborDistances
            ),

        third:
            summarize(
                thirdNeighborDistances
            )
    },

    pairwiseDistanceHistogram:
        histogram,

    testedClusterThresholds:
        thresholdResults,

    note: [
        'Canonical position prefers alive NPCState=2 observations.',
        'If none exist, it falls back to alive observations, then first observed position.',
        'Clusters remain diagnostic until geometry and spawn/respawn behavior agree.'
    ]
};


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

console.log('');
console.log(
    '===================================='
);
console.log(
    'NEUTRAL CAMP GEOMETRY'
);
console.log(
    '===================================='
);
console.log('');

console.log(
    `Sampled replay ticks: ${sampledTicks}`
);

console.log(
    `Neutral observations: ${observations}`
);

console.log(
    `Unique neutral indexes: ${slots.size}`
);

console.log(
    `Canonical slots: ${canonicalSlots.length}`
);


if (
    canonicalSlots.length !==
    146
) {

    console.log('');
    console.log(
        `WARNING: expected 146 slots from prior logical-instance analysis, found ${canonicalSlots.length}.`
    );
}


console.log('');
console.log(
    'Subclass counts:'
);


for (
    const [
        key,
        value
    ]
    of Object.entries(
        subclassSummary
    )
) {

    console.log(
        `  ${key}: ${value}`
    );
}


console.log('');
console.log(
    'Unit-type counts:'
);


for (
    const [
        key,
        value
    ]
    of Object.entries(
        unitTypeSummary
    )
) {

    console.log(
        `  ${key}: ${value}`
    );
}


console.log('');
console.log(
    'Nearest-neighbor XY distances:'
);

console.log(
    `  1st median: ${
        formatNumber(
            summarize(
                firstNeighborDistances
            ).median
        )
    }`
);

console.log(
    `  2nd median: ${
        formatNumber(
            summarize(
                secondNeighborDistances
            ).median
        )
    }`
);

console.log(
    `  3rd median: ${
        formatNumber(
            summarize(
                thirdNeighborDistances
            ).median
        )
    }`
);


console.log('');
console.log(
    'Threshold diagnostics:'
);


for (
    const row
    of thresholdResults
) {

    console.log(
        `  radius ${row.threshold}` +
        ` -> ${row.clusterCount} clusters` +
        `, ${row.singletonCount} singletons` +
        `, sizes ${JSON.stringify(row.sizeDistribution)}`
    );
}


console.log('');
console.log(
    `Output:\n${outputPath}`
);
console.log('');


await parser.dispose();


// ============================================================
// FORMAT SLOT
// ============================================================

function formatSlot(
    slot
) {

    const subclassId =
        dominantMapKey(
            slot.subclassCounts
        );


    let positionSource =
        null;

    let position =
        null;


    if (
        slot.idlePositions.length
    ) {

        position =
            medianPosition(
                slot.idlePositions
            );

        positionSource =
            'idle_alive_median';

    } else if (
        slot.alivePositions.length
    ) {

        position =
            medianPosition(
                slot.alivePositions
            );

        positionSource =
            'alive_median';

    } else {

        position =
            slot.firstPosition;

        positionSource =
            'first_observed';
    }


    return {

        entityIndex:
            slot.entityIndex,

        subclassId,

        unitType:
            classifySubclass(
                subclassId
            ),

        position,

        positionSource,

        observationCount:
            slot.observations,

        idlePositionSamples:
            slot.idlePositions.length,

        alivePositionSamples:
            slot.alivePositions.length,

        firstObservedTick:
            slot.firstObservedTick,

        lastObservedTick:
            slot.lastObservedTick
    };
}


// ============================================================
// FIELD HELPERS
// ============================================================

function numberField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    const value =
        entity.getField(
            field
        );


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
// WORLD POSITION
// ============================================================

function worldPosition(
    entity
) {

    const cellX =
        numberField(
            entity,
            'CBodyComponent.m_cellX'
        );

    const cellY =
        numberField(
            entity,
            'CBodyComponent.m_cellY'
        );

    const cellZ =
        numberField(
            entity,
            'CBodyComponent.m_cellZ'
        );

    const vecX =
        numberField(
            entity,
            'CBodyComponent.m_vecX'
        );

    const vecY =
        numberField(
            entity,
            'CBodyComponent.m_vecY'
        );

    const vecZ =
        numberField(
            entity,
            'CBodyComponent.m_vecZ'
        );


    if (
        ![
            cellX,
            cellY,
            cellZ,
            vecX,
            vecY,
            vecZ
        ]
        .every(
            Number.isFinite
        )
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
// SUBCLASS LABELS
// ============================================================

function classifySubclass(
    subclass
) {

    const value =
        String(
            subclass
        );


    if (
        value ===
        '1250952856'
    ) {

        return 'SMALL_UNIT';
    }


    if (
        value ===
        '941701082'
    ) {

        return 'MEDIUM_UNIT';
    }


    if (
        value ===
        '3392417854'
    ) {

        return 'LARGE_UNIT';
    }


    return 'UNKNOWN_UNIT';
}


// ============================================================
// CONNECTED COMPONENTS
// ============================================================

function connectedComponents(
    slots,
    threshold
) {

    const unvisited =
        new Set(
            slots.map(
                slot =>
                    slot.entityIndex
            )
        );


    const byIndex =
        new Map(
            slots.map(
                slot => [
                    slot.entityIndex,
                    slot
                ]
            )
        );


    const clusters =
        [];


    while (
        unvisited.size
    ) {

        const start =
            unvisited
                .values()
                .next()
                .value;


        unvisited.delete(
            start
        );


        const queue =
            [start];

        const cluster =
            [];


        while (
            queue.length
        ) {

            const currentIndex =
                queue.shift();


            const current =
                byIndex.get(
                    currentIndex
                );


            cluster.push(
                current
            );


            for (
                const otherIndex
                of [...unvisited]
            ) {

                const other =
                    byIndex.get(
                        otherIndex
                    );


                if (
                    distanceXY(
                        current.position,
                        other.position
                    )
                    <=
                    threshold
                ) {

                    unvisited.delete(
                        otherIndex
                    );

                    queue.push(
                        otherIndex
                    );
                }
            }
        }


        clusters.push(
            cluster
        );
    }


    return clusters.sort(
        (
            a,
            b
        ) =>
            b.length -
            a.length
            ||
            a[0].entityIndex -
            b[0].entityIndex
    );
}


// ============================================================
// DISTANCE
// ============================================================

function distanceXY(
    a,
    b
) {

    return Math.hypot(

        a.x - b.x,

        a.y - b.y
    );
}


function distanceXYZ(
    a,
    b
) {

    return Math.hypot(

        a.x - b.x,

        a.y - b.y,

        a.z - b.z
    );
}


// ============================================================
// POSITION MATH
// ============================================================

function medianPosition(
    values
) {

    return {

        x:
            median(
                values.map(
                    value =>
                        value.x
                )
            ),

        y:
            median(
                values.map(
                    value =>
                        value.y
                )
            ),

        z:
            median(
                values.map(
                    value =>
                        value.z
                )
            )
    };
}


function centroid(
    positions
) {

    return {

        x:
            mean(
                positions.map(
                    position =>
                        position.x
                )
            ),

        y:
            mean(
                positions.map(
                    position =>
                        position.y
                )
            ),

        z:
            mean(
                positions.map(
                    position =>
                        position.z
                )
            )
    };
}


// ============================================================
// NEIGHBOR HELPERS
// ============================================================

function neighborRankDistances(
    rows,
    rank
) {

    return rows

        .map(
            row =>
                row.nearest[
                    rank
                ]
                ?.distanceXY
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
}


// ============================================================
// HISTOGRAM
// ============================================================

function buildHistogram(
    values,
    bucketSize,
    maximum
) {

    const buckets =
        [];


    for (
        let start = 0;
        start < maximum;
        start += bucketSize
    ) {

        buckets.push({

            min:
                start,

            max:
                start +
                bucketSize,

            count:
                0
        });
    }


    let aboveMaximum =
        0;


    for (
        const value
        of values
    ) {

        if (
            value >=
            maximum
        ) {

            aboveMaximum++;

            continue;
        }


        const index =
            Math.floor(
                value /
                bucketSize
            );


        buckets[
            index
        ].count++;
    }


    return {

        bucketSize,

        maximum,

        buckets,

        aboveMaximum
    };
}


// ============================================================
// STATS
// ============================================================

function summarize(
    values
) {

    if (
        !values.length
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


    const sorted =
        [...values]
            .sort(
                (
                    a,
                    b
                ) =>
                    a - b
            );


    return {

        count:
            sorted.length,

        min:
            sorted[0],

        p10:
            percentile(
                sorted,
                0.10
            ),

        p25:
            percentile(
                sorted,
                0.25
            ),

        median:
            percentile(
                sorted,
                0.50
            ),

        p75:
            percentile(
                sorted,
                0.75
            ),

        p90:
            percentile(
                sorted,
                0.90
            ),

        max:
            sorted.at(-1),

        mean:
            mean(
                sorted
            )
    };
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


function median(
    values
) {

    const sorted =
        [...values]
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
        sorted,
        0.5
    );
}


function mean(
    values
) {

    if (
        !values.length
    ) {

        return null;
    }


    return values.reduce(
        (
            sum,
            value
        ) =>
            sum + value,
        0
    )
    /
    values.length;
}


// ============================================================
// MAP HELPERS
// ============================================================

function dominantMapKey(
    map
) {

    if (
        !map.size
    ) {

        return null;
    }


    return [...map.entries()]

        .sort(
            (
                a,
                b
            ) =>
                b[1] -
                a[1]
        )[0][0];
}


function countValues(
    values
) {

    const result =
        {};


    for (
        const value
        of values
    ) {

        const key =
            String(
                value
            );


        result[key] =
            (
                result[key]
                ??
                0
            )
            +
            1;
    }


    return result;
}


function formatNumber(
    value
) {

    return Number.isFinite(
        value
    )
        ? value.toFixed(1)
        : '—';
}