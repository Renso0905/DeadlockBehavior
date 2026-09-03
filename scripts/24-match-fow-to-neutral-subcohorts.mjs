import {
    readFileSync,
    writeFileSync
} from 'node:fs';

import {
    resolve
} from 'node:path';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


const fowPath =
    resolve(
        'output',
        replayName,
        'neutral_fow_direct_positions.json'
    );


const refinementPath =
    resolve(
        'output',
        replayName,
        'neutral_camp_membership_refinement.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'fow_neutral_subcohort_matching.json'
    );


// ============================================================
// LOAD
// ============================================================

const fowData =
    JSON.parse(
        readFileSync(
            fowPath,
            'utf8'
        )
    );


const refinement =
    JSON.parse(
        readFileSync(
            refinementPath,
            'utf8'
        )
    );


// ============================================================
// SMALL ANCHORS
//
// We know:
// - 4 Small FOW markers
// - 4 Small neutral groups
//
// Use these to calibrate:
//     FOW minimap XY -> replay world XY
//
// We test all 4! assignments and fit independent linear
// transforms:
//
// worldX = ax * fowX + bx
// worldY = ay * fowY + by
//
// Choose the assignment with lowest total residual.
// ============================================================

const smallMarkers =
    fowData.markers.filter(
        marker =>
            marker.campTier ===
            'SMALL'
    );


const smallGroups =
    refinement.groups.filter(
        group =>
            group.baseClassification ===
            'SMALL_CAMP_CANDIDATE'
    );


if (
    smallMarkers.length !== 4
    ||
    smallGroups.length !== 4
) {

    throw new Error(
        `Expected 4 Small markers and 4 Small groups; got ${smallMarkers.length} / ${smallGroups.length}`
    );
}


const calibration =
    findBestCalibration(
        smallMarkers,
        smallGroups
    );


// ============================================================
// BUILD CREATION SUBCOHORTS
//
// This is important.
//
// Our old geometric method produced:
//   22 Medium blobs
//
// But two blobs contain TWO creation subcohorts.
//
// So:
//
//   20 x 1
// +  2 x 2
// = 24 Medium creation subcohorts
//
// We test those against the 24 FOW class-35 markers.
// ============================================================

const neutralSubcohorts =
    [];


for (
    const group
    of refinement.groups
) {

    if (
        group.baseClassification ===
        'SINNER_NEUTRAL_CANDIDATE'
    ) {

        continue;
    }


    const tier =
        tierFromClassification(
            group.baseClassification
        );


    for (
        let index = 0;
        index < group.creationSubcohorts.length;
        index++
    ) {

        const subcohort =
            group.creationSubcohorts[
                index
            ];


        neutralSubcohorts.push({

            subcohortId:
                `${group.groupId}_C${index + 1}`,

            sourceGroupId:
                group.groupId,

            tier,

            sourceGroupMemberCount:
                group.memberCount,

            sourceGroupComposition:
                group.unitTypeCounts,

            sourceGroupStatus:
                group.status,

            creationSubcohortIndex:
                index + 1,

            createTimeMin:
                subcohort.minCreateTime,

            createTimeMax:
                subcohort.maxCreateTime,

            memberCount:
                subcohort.memberCount,

            entityIndexes:
                subcohort.entityIndexes,

            centroid:
                subcohort.centroid
        });
    }
}


// ============================================================
// TRANSFORM FOW MARKERS
// ============================================================

const transformedMarkers =
    fowData.markers.map(
        marker => {

            const p =
                marker.preferredPosition;


            return {

                name:
                    marker.name,

                eClass:
                    marker.eClass,

                reportedTier:
                    marker.campTier,

                fowPosition:
                    p
                        ? {
                            x: p.x,
                            y: p.y
                        }
                        : null,

                estimatedWorldPosition:
                    p
                        ? transformFow(
                            p.x,
                            p.y,
                            calibration
                        )
                        : null,

                visibleCount:
                    marker.visibleCount,

                hiddenCount:
                    marker.hiddenCount
            };
        }
    );


// ============================================================
// MATCH BY TIER
//
// For each tier, solve a minimum-distance assignment.
//
// Small: 4 markers / 4 cohorts
// Medium: 24 markers / 24 cohorts
// Large: 12 markers / 12 cohorts
//
// Hungarian algorithm below.
// ============================================================

const tierResults =
    {};


for (
    const tier
    of [
        'SMALL',
        'MEDIUM',
        'LARGE'
    ]
) {

    const markers =
        transformedMarkers.filter(
            marker =>
                marker.reportedTier ===
                tier
        );


    const cohorts =
        neutralSubcohorts.filter(
            cohort =>
                cohort.tier ===
                tier
        );


    const costMatrix =
        markers.map(
            marker =>
                cohorts.map(
                    cohort =>
                        distanceXY(
                            marker
                                .estimatedWorldPosition,

                            cohort.centroid
                        )
                )
        );


    const assignment =
        hungarian(
            costMatrix
        );


    const matches =
        assignment.map(
            (
                cohortIndex,
                markerIndex
            ) => {

                const marker =
                    markers[
                        markerIndex
                    ];


                const cohort =
                    cohorts[
                        cohortIndex
                    ];


                const distance =
                    costMatrix[
                        markerIndex
                    ][
                        cohortIndex
                    ];


                return {

                    markerName:
                        marker.name,

                    markerFowPosition:
                        marker.fowPosition,

                    markerEstimatedWorldPosition:
                        marker
                            .estimatedWorldPosition,

                    subcohortId:
                        cohort.subcohortId,

                    sourceGroupId:
                        cohort.sourceGroupId,

                    creationSubcohortIndex:
                        cohort
                            .creationSubcohortIndex,

                    cohortCentroid:
                        cohort.centroid,

                    cohortMemberCount:
                        cohort.memberCount,

                    cohortEntityIndexes:
                        cohort.entityIndexes,

                    sourceGroupMemberCount:
                        cohort
                            .sourceGroupMemberCount,

                    sourceGroupComposition:
                        cohort
                            .sourceGroupComposition,

                    sourceGroupStatus:
                        cohort.sourceGroupStatus,

                    distanceXY:
                        distance
                };
            }
        );


    tierResults[
        tier
    ] = {

        markerCount:
            markers.length,

        subcohortCount:
            cohorts.length,

        equalCounts:
            markers.length ===
            cohorts.length,

        distanceStatistics:
            summarize(
                matches.map(
                    match =>
                        match.distanceXY
                )
            ),

        matches:
            matches.sort(
                (
                    a,
                    b
                ) =>
                    a.distanceXY -
                    b.distanceXY
            )
    };
}


// ============================================================
// SPECIFIC SIX-UNIT BLOBS
// ============================================================

const sixUnitMediumGroups =
    refinement.groups

        .filter(
            group =>
                group.baseClassification ===
                    'MEDIUM_CAMP_CANDIDATE'
                &&
                group.memberCount === 6
        )

        .map(
            group => {

                const matches =
                    tierResults
                        .MEDIUM
                        .matches

                        .filter(
                            match =>
                                match.sourceGroupId ===
                                group.groupId
                        );


                return {

                    groupId:
                        group.groupId,

                    originalComposition:
                        group.unitTypeCounts,

                    creationSubcohortCount:
                        group.creationSubcohortCount,

                    creationSubcohorts:
                        group.creationSubcohorts,

                    fowMatches:
                        matches
                };
            }
        );


// ============================================================
// MARKERS THAT MATCH SAME OLD GEOMETRIC BLOB
//
// This directly tells us whether an old radius-based group
// corresponds to multiple FOW locations.
// ============================================================

const matchesBySourceGroup =
    {};


for (
    const match
    of tierResults.MEDIUM.matches
) {

    if (
        !matchesBySourceGroup[
            match.sourceGroupId
        ]
    ) {

        matchesBySourceGroup[
            match.sourceGroupId
        ] =
            [];
    }


    matchesBySourceGroup[
        match.sourceGroupId
    ]
    .push(
        match
    );
}


const multiMarkerMediumGroups =
    Object.entries(
        matchesBySourceGroup
    )

        .filter(
            (
                [
                    ,
                    matches
                ]
            ) =>
                matches.length >
                1
        )

        .map(
            (
                [
                    groupId,
                    matches
                ]
            ) => ({

                groupId,

                markerCount:
                    matches.length,

                markerNames:
                    matches.map(
                        match =>
                            match.markerName
                    ),

                matches
            })
        );


// ============================================================
// OUTPUT
// ============================================================

const output = {

    replay:
        replayName,

    method:
        'FOW minimap coordinate calibration from Small camps + minimum-distance tier-matched assignment to neutral creation subcohorts',

    calibration,

    counts: {

        fowMarkers: {
            SMALL:
                transformedMarkers.filter(
                    marker =>
                        marker.reportedTier ===
                        'SMALL'
                ).length,

            MEDIUM:
                transformedMarkers.filter(
                    marker =>
                        marker.reportedTier ===
                        'MEDIUM'
                ).length,

            LARGE:
                transformedMarkers.filter(
                    marker =>
                        marker.reportedTier ===
                        'LARGE'
                ).length
        },

        neutralCreationSubcohorts: {

            SMALL:
                neutralSubcohorts.filter(
                    cohort =>
                        cohort.tier ===
                        'SMALL'
                ).length,

            MEDIUM:
                neutralSubcohorts.filter(
                    cohort =>
                        cohort.tier ===
                        'MEDIUM'
                ).length,

            LARGE:
                neutralSubcohorts.filter(
                    cohort =>
                        cohort.tier ===
                        'LARGE'
                ).length
        }
    },

    tierResults,

    sixUnitMediumGroups,

    multiMarkerMediumGroups,

    transformedMarkers,

    neutralSubcohorts
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
// CONSOLE
// ============================================================

console.log('');
console.log(
    '===================================='
);
console.log(
    'FOW ↔ NEUTRAL SUBCOHORT MATCHING'
);
console.log(
    '===================================='
);
console.log('');


// ============================================================
// CALIBRATION
// ============================================================

console.log(
    'FOW -> WORLD CALIBRATION'
);

console.log(
    '------------------------'
);


console.log(
    `worldX = ${calibration.ax.toFixed(6)} * fowX + ${calibration.bx.toFixed(3)}`
);

console.log(
    `worldY = ${calibration.ay.toFixed(6)} * fowY + ${calibration.by.toFixed(3)}`
);

console.log(
    `Small-anchor RMSE: ${calibration.rmse.toFixed(3)}`
);


console.log('');


// ============================================================
// COUNTS
// ============================================================

for (
    const tier
    of [
        'SMALL',
        'MEDIUM',
        'LARGE'
    ]
) {

    const result =
        tierResults[
            tier
        ];


    console.log(
        `${tier}:`
    );


    console.log(
        `  FOW markers: ${result.markerCount}`
    );


    console.log(
        `  creation subcohorts: ${result.subcohortCount}`
    );


    console.log(
        `  equal counts: ${result.equalCounts}`
    );


    if (
        result
            .distanceStatistics
            .count
    ) {

        console.log(
            `  median match distance: ${result.distanceStatistics.median.toFixed(1)}`
        );


        console.log(
            `  max match distance: ${result.distanceStatistics.max.toFixed(1)}`
        );
    }


    console.log('');
}


// ============================================================
// MEDIUM MATCHES
// ============================================================

console.log(
    'MEDIUM FOW MATCHES'
);

console.log(
    '------------------'
);


for (
    const match
    of tierResults
        .MEDIUM
        .matches
) {

    console.log(

        `${match.markerName}`

        +

        ` -> ${match.subcohortId}`

        +

        ` [${match.cohortEntityIndexes.join(', ')}]`

        +

        ` dist=${match.distanceXY.toFixed(1)}`
    );
}


// ============================================================
// SIX UNIT BLOBS
// ============================================================

console.log('');
console.log(
    'SIX-UNIT MEDIUM BLOBS'
);

console.log(
    '---------------------'
);


for (
    const group
    of sixUnitMediumGroups
) {

    console.log('');

    console.log(
        `${group.groupId}`
    );


    console.log(
        `  composition: ${JSON.stringify(group.originalComposition)}`
    );


    console.log(
        `  creation subcohorts: ${group.creationSubcohortCount}`
    );


    for (
        const match
        of group.fowMatches
    ) {

        console.log(

            `  ${match.subcohortId}`

            +

            ` -> ${match.markerName}`

            +

            ` dist=${match.distanceXY.toFixed(1)}`
        );
    }
}


// ============================================================
// OLD BLOBS WITH MULTIPLE FOW MARKERS
// ============================================================

console.log('');
console.log(
    'OLD MEDIUM BLOBS MATCHING MULTIPLE FOW MARKERS'
);

console.log(
    '----------------------------------------------'
);


if (
    !multiMarkerMediumGroups.length
) {

    console.log(
        'None'
    );

} else {

    for (
        const group
        of multiMarkerMediumGroups
    ) {

        console.log(
            `${group.groupId}: ${group.markerNames.join(' | ')}`
        );
    }
}


console.log('');
console.log(
    `Output:\n${outputPath}`
);
console.log('');


// ============================================================
// CALIBRATION SEARCH
// ============================================================

function findBestCalibration(
    markers,
    groups
) {

    const permutations =
        permute(
            groups
        );


    let best =
        null;


    for (
        const permutation
        of permutations
    ) {

        const fowXs =
            markers.map(
                marker =>
                    marker
                        .preferredPosition
                        .x
            );


        const fowYs =
            markers.map(
                marker =>
                    marker
                        .preferredPosition
                        .y
            );


        const worldXs =
            permutation.map(
                group =>
                    group.centroid.x
            );


        const worldYs =
            permutation.map(
                group =>
                    group.centroid.y
            );


        const xFit =
            linearFit(
                fowXs,
                worldXs
            );


        const yFit =
            linearFit(
                fowYs,
                worldYs
            );


        let squaredError =
            0;


        const anchors =
            [];


        for (
            let i = 0;
            i < markers.length;
            i++
        ) {

            const estimatedX =
                xFit.slope *
                fowXs[i]
                +
                xFit.intercept;


            const estimatedY =
                yFit.slope *
                fowYs[i]
                +
                yFit.intercept;


            const actualX =
                worldXs[i];


            const actualY =
                worldYs[i];


            const distance =
                Math.hypot(

                    estimatedX -
                    actualX,

                    estimatedY -
                    actualY
                );


            squaredError +=
                distance *
                distance;


            anchors.push({

                markerName:
                    markers[i].name,

                fowPosition: {
                    x: fowXs[i],
                    y: fowYs[i]
                },

                matchedGroupId:
                    permutation[i]
                        .groupId,

                actualWorldPosition: {
                    x: actualX,
                    y: actualY
                },

                estimatedWorldPosition: {
                    x: estimatedX,
                    y: estimatedY
                },

                residualDistance:
                    distance
            });
        }


        const rmse =
            Math.sqrt(
                squaredError /
                markers.length
            );


        if (
            !best
            ||
            rmse <
            best.rmse
        ) {

            best = {

                ax:
                    xFit.slope,

                bx:
                    xFit.intercept,

                ay:
                    yFit.slope,

                by:
                    yFit.intercept,

                rmse,

                anchors
            };
        }
    }


    return best;
}


// ============================================================
// TRANSFORM
// ============================================================

function transformFow(
    x,
    y,
    calibration
) {

    return {

        x:
            calibration.ax *
            x
            +
            calibration.bx,

        y:
            calibration.ay *
            y
            +
            calibration.by
    };
}


// ============================================================
// LINEAR FIT
// ============================================================

function linearFit(
    xs,
    ys
) {

    const meanX =
        average(
            xs
        );


    const meanY =
        average(
            ys
        );


    let numerator =
        0;


    let denominator =
        0;


    for (
        let i = 0;
        i < xs.length;
        i++
    ) {

        numerator +=

            (
                xs[i] -
                meanX
            )

            *

            (
                ys[i] -
                meanY
            );


        denominator +=

            (
                xs[i] -
                meanX
            )

            ** 2;
    }


    const slope =
        numerator /
        denominator;


    const intercept =
        meanY -
        slope *
        meanX;


    return {
        slope,
        intercept
    };
}


// ============================================================
// PERMUTATIONS
// ============================================================

function permute(
    values
) {

    if (
        values.length <=
        1
    ) {

        return [
            [...values]
        ];
    }


    const output =
        [];


    for (
        let i = 0;
        i < values.length;
        i++
    ) {

        const head =
            values[i];


        const rest =
            [
                ...values.slice(
                    0,
                    i
                ),

                ...values.slice(
                    i + 1
                )
            ];


        for (
            const tail
            of permute(
                rest
            )
        ) {

            output.push(
                [
                    head,
                    ...tail
                ]
            );
        }
    }


    return output;
}


// ============================================================
// HUNGARIAN ALGORITHM
//
// Returns:
// assignment[rowIndex] = columnIndex
//
// Cost matrix must be square.
//
// In our case it should be:
// 4x4
// 24x24
// 12x12
// ============================================================

function hungarian(
    cost
) {

    const n =
        cost.length;


    if (
        n === 0
    ) {

        return [];
    }


    const m =
        cost[0].length;


    if (
        n !== m
    ) {

        throw new Error(
            `Hungarian matrix must be square; got ${n}x${m}`
        );
    }


    const u =
        Array(
            n + 1
        ).fill(
            0
        );


    const v =
        Array(
            m + 1
        ).fill(
            0
        );


    const p =
        Array(
            m + 1
        ).fill(
            0
        );


    const way =
        Array(
            m + 1
        ).fill(
            0
        );


    for (
        let i = 1;
        i <= n;
        i++
    ) {

        p[0] =
            i;


        let j0 =
            0;


        const minv =
            Array(
                m + 1
            ).fill(
                Infinity
            );


        const used =
            Array(
                m + 1
            ).fill(
                false
            );


        do {

            used[j0] =
                true;


            const i0 =
                p[j0];


            let delta =
                Infinity;


            let j1 =
                0;


            for (
                let j = 1;
                j <= m;
                j++
            ) {

                if (
                    used[j]
                ) {

                    continue;
                }


                const cur =

                    cost[
                        i0 - 1
                    ][
                        j - 1
                    ]

                    -
                    u[i0]

                    -
                    v[j];


                if (
                    cur <
                    minv[j]
                ) {

                    minv[j] =
                        cur;

                    way[j] =
                        j0;
                }


                if (
                    minv[j] <
                    delta
                ) {

                    delta =
                        minv[j];

                    j1 =
                        j;
                }
            }


            for (
                let j = 0;
                j <= m;
                j++
            ) {

                if (
                    used[j]
                ) {

                    u[
                        p[j]
                    ] +=
                        delta;

                    v[j] -=
                        delta;

                } else {

                    minv[j] -=
                        delta;
                }
            }


            j0 =
                j1;


        } while (
            p[j0] !== 0
        );


        do {

            const j1 =
                way[j0];


            p[j0] =
                p[j1];


            j0 =
                j1;


        } while (
            j0 !== 0
        );
    }


    const assignment =
        Array(
            n
        ).fill(
            -1
        );


    for (
        let j = 1;
        j <= m;
        j++
    ) {

        if (
            p[j] !== 0
        ) {

            assignment[
                p[j] - 1
            ] =
                j - 1;
        }
    }


    return assignment;
}


// ============================================================
// CLASSIFICATION
// ============================================================

function tierFromClassification(
    classification
) {

    if (
        classification ===
        'SMALL_CAMP_CANDIDATE'
    ) {

        return 'SMALL';
    }


    if (
        classification ===
        'MEDIUM_CAMP_CANDIDATE'
    ) {

        return 'MEDIUM';
    }


    if (
        classification ===
        'LARGE_CAMP_CANDIDATE'
    ) {

        return 'LARGE';
    }


    return null;
}


// ============================================================
// DISTANCE
// ============================================================

function distanceXY(
    a,
    b
) {

    if (
        !a
        ||
        !b
    ) {

        return Infinity;
    }


    return Math.hypot(

        a.x -
        b.x,

        a.y -
        b.y
    );
}


// ============================================================
// STATS
// ============================================================

function summarize(
    values
) {

    const sorted =
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
        !sorted.length
    ) {

        return {
            count: 0,
            min: null,
            median: null,
            max: null,
            mean: null
        };
    }


    return {

        count:
            sorted.length,

        min:
            sorted[0],

        median:
            percentile(
                sorted,
                0.5
            ),

        max:
            sorted.at(-1),

        mean:
            average(
                sorted
            )
    };
}


function percentile(
    sorted,
    p
) {

    const index =
        (
            sorted.length -
            1
        )
        *
        p;


    const low =
        Math.floor(
            index
        );


    const high =
        Math.ceil(
            index
        );


    if (
        low ===
        high
    ) {

        return sorted[
            low
        ];
    }


    const fraction =
        index -
        low;


    return (
        sorted[low]
        *
        (
            1 -
            fraction
        )
    )
    +
    (
        sorted[high]
        *
        fraction
    );
}


function average(
    values
) {

    return values.reduce(
        (
            sum,
            value
        ) =>
            sum +
            value,
        0
    )
    /
    values.length;
}