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


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


// ============================================================
// DOCUMENTED RANGE TARGET
//
// Deadlock internal coordinates are Source/Hammer units.
// Approx. 39.37 hu = 1 meter.
//
// Current documented Trooper soul-drop eligibility range:
// 45 meters.
// ============================================================

const HU_PER_METER =
    39.37;


const DOCUMENTED_RANGE_METERS =
    45;


const DOCUMENTED_RANGE_HU =
    DOCUMENTED_RANGE_METERS *
    HU_PER_METER;


// ============================================================
// PLAYER-STATE RECONSTRUCTION
//
// player_state is sampled every 0.25 seconds.
//
// Primary estimate:
// linearly interpolate between the immediately surrounding
// samples when both are alive + movement-valid.
//
// Fallback:
// nearest valid sample within 0.15 sec.
// ============================================================

const MAX_INTERPOLATION_GAP_SECONDS =
    0.30;


const MAX_NEAREST_SAMPLE_DELTA_SECONDS =
    0.15;


// ============================================================
// TEMPORAL ENVELOPE
//
// Used only to diagnose apparent range violations.
//
// This does NOT replace the synchronous estimate.
// ============================================================

const ENVELOPE_SECONDS =
    0.50;


// ============================================================
// THRESHOLD SEARCH
// ============================================================

const THRESHOLD_MIN =
    1200;


const THRESHOLD_MAX =
    2600;


const THRESHOLD_STEP =
    10;


// ============================================================
// OUTPUT
// ============================================================

const deathStreamPath =
    resolve(
        'output',
        replayName,
        'trooper_ground_soul_one_to_one_v01.jsonl'
    );


const playerStatePath =
    resolve(
        'output',
        replayName,
        'player_state.jsonl'
    );


const summaryPath =
    resolve(
        'output',
        replayName,
        'trooper_ground_soul_range_validation_v01.json'
    );


const outlierPath =
    resolve(
        'output',
        replayName,
        'trooper_ground_soul_range_outliers_v01.jsonl'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        deathStreamPath,
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
// LOAD DEATHS
// ============================================================

console.log('');

console.log(
    'Loading Trooper ground-soul death stream...'
);


const deathRows =
    await loadJsonl(
        deathStreamPath
    );


const deaths =
    deathRows
        .map(
            normalizeDeath
        )
        .filter(
            Boolean
        );


console.log(
    `Deaths loaded: ${deaths.length}`
);


// ============================================================
// LOAD PLAYER TIMELINES
// ============================================================

console.log(
    'Loading player-state timelines...'
);


const timelines =
    new Map();


let playerStateRows =
    0;


const playerReader =
    createInterface({

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


    playerStateRows++;


    let row;


    try {

        row =
            JSON.parse(
                line
            );

    } catch {

        continue;
    }


    const timeSeconds =
        finite(
            row?.matchTimeSeconds
        );


    const playerName =
        row
            ?.controller
            ?.playerName
        ??
        null;


    const team =
        finite(
            row
                ?.controller
                ?.team
        );


    if (
        timeSeconds ===
            null
        ||
        !playerName
        ||
        team ===
            null
    ) {

        continue;
    }


    const timelineKey =
        `${playerName}|${team}`;


    if (
        !timelines.has(
            timelineKey
        )
    ) {

        timelines.set(
            timelineKey,
            {

                playerName,

                team,

                rows:
                    []
            }
        );
    }


    timelines
        .get(
            timelineKey
        )
        .rows
        .push({

            timeSeconds,

            alive:
                row
                    ?.controller
                    ?.alive ===
                true,

            movementValid:
                row
                    ?.pawn
                    ?.positionValidForMovement ===
                true,

            position:
                normalizePosition(
                    row
                        ?.pawn
                        ?.positionWorld
                )
        });
}


for (
    const timeline
    of timelines.values()
) {

    timeline.rows.sort(
        (
            a,
            b
        ) =>
            a.timeSeconds -
            b.timeSeconds
    );
}


console.log(
    `Player-state rows: ${playerStateRows}`
);

console.log(
    `Player timelines: ${timelines.size}`
);


// ============================================================
// RECONSTRUCT PLAYER PROXIMITY FOR EACH DEATH
// ============================================================

console.log(
    'Reconstructing synchronous player positions...'
);


let deathsWithSynchronousOpponent =
    0;


let deathsWithoutSynchronousOpponent =
    0;


for (
    const death
    of deaths
) {

    const opposingTeam =
        death.team ===
            2
            ? 3
            : (
                death.team ===
                    3
                    ? 2
                    : null
            );


    const players =
        [];


    if (
        opposingTeam !==
        null
    ) {

        for (
            const timeline
            of timelines.values()
        ) {

            if (
                timeline.team !==
                opposingTeam
            ) {

                continue;
            }


            const synchronous =
                estimateStateAtTime(
                    timeline.rows,
                    death.timeSeconds
                );


            const envelope =
                getMinimumDistanceInWindow(
                    timeline.rows,
                    death.timeSeconds,
                    death.position,
                    ENVELOPE_SECONDS
                );


            if (
                !synchronous
            ) {

                continue;
            }


            const distance3D =
                getDistance3D(
                    death.position,
                    synchronous.position
                );


            const distanceXY =
                getDistanceXY(
                    death.position,
                    synchronous.position
                );


            players.push({

                playerName:
                    timeline.playerName,

                team:
                    timeline.team,

                method:
                    synchronous.method,

                sourceTimeDelta:
                    synchronous.sourceTimeDelta,

                position:
                    synchronous.position,

                distance3D,

                distanceXY,

                envelopeMinDistance3D:
                    envelope
                        ?.distance3D
                    ??
                    null,

                envelopeMinDistanceXY:
                    envelope
                        ?.distanceXY
                    ??
                    null,

                envelopeTimeSeconds:
                    envelope
                        ?.timeSeconds
                    ??
                    null
            });
        }
    }


    players.sort(
        (
            a,
            b
        ) =>
            a.distance3D -
            b.distance3D
    );


    const nearest =
        players[
            0
        ]
        ??
        null;


    death.proximity =
        {

            opposingTeam,

            players,

            nearest,

            nearestDistance3D:
                nearest
                    ?.distance3D
                ??
                null,

            nearestDistanceXY:
                nearest
                    ?.distanceXY
                ??
                null
        };


    if (
        nearest
    ) {

        deathsWithSynchronousOpponent++;

    } else {

        deathsWithoutSynchronousOpponent++;
    }
}


// ============================================================
// PARTITIONS
// ============================================================

const matched =
    deaths.filter(
        row =>
            row.groundSoulMatched
    );


const unmatched =
    deaths.filter(
        row =>
            !row.groundSoulMatched
    );


// ============================================================
// BASIC DISTRIBUTIONS
// ============================================================

const matched3D =
    matched
        .map(
            row =>
                row
                    ?.proximity
                    ?.nearestDistance3D
        )
        .filter(
            Number.isFinite
        );


const unmatched3D =
    unmatched
        .map(
            row =>
                row
                    ?.proximity
                    ?.nearestDistance3D
        )
        .filter(
            Number.isFinite
        );


const matchedXY =
    matched
        .map(
            row =>
                row
                    ?.proximity
                    ?.nearestDistanceXY
        )
        .filter(
            Number.isFinite
        );


const unmatchedXY =
    unmatched
        .map(
            row =>
                row
                    ?.proximity
                    ?.nearestDistanceXY
        )
        .filter(
            Number.isFinite
        );


// ============================================================
// THRESHOLD CANDIDATES
// ============================================================

const thresholds =
    [];


for (
    let threshold =
        THRESHOLD_MIN;

    threshold <=
        THRESHOLD_MAX;

    threshold +=
        THRESHOLD_STEP
) {

    thresholds.push(
        threshold
    );
}


thresholds.push(
    DOCUMENTED_RANGE_HU
);


const uniqueThresholds =
    [
        ...new Set(
            thresholds
                .map(
                    value =>
                        Number(
                            value.toFixed(
                                6
                            )
                        )
                )
        )
    ]
    .sort(
        (
            a,
            b
        ) =>
            a -
            b
    );


// ============================================================
// EVALUATE THRESHOLDS
// ============================================================

const evaluation3D =
    uniqueThresholds.map(
        threshold =>
            evaluateThreshold(
                deaths,
                threshold,
                'nearestDistance3D'
            )
    );


const evaluationXY =
    uniqueThresholds.map(
        threshold =>
            evaluateThreshold(
                deaths,
                threshold,
                'nearestDistanceXY'
            )
    );


const best3D =
    selectBestThreshold(
        evaluation3D
    );


const bestXY =
    selectBestThreshold(
        evaluationXY
    );


const documented3D =
    evaluation3D.find(
        row =>
            approximatelyEqual(
                row.threshold,
                DOCUMENTED_RANGE_HU
            )
    );


const documentedXY =
    evaluationXY.find(
        row =>
            approximatelyEqual(
                row.threshold,
                DOCUMENTED_RANGE_HU
            )
    );


// ============================================================
// DOCUMENTED-RANGE OUTLIERS
// ============================================================

const matchedOutsideDocumented =
    matched.filter(
        row =>
            Number.isFinite(
                row
                    ?.proximity
                    ?.nearestDistance3D
            )
            &&
            row
                .proximity
                .nearestDistance3D >
                DOCUMENTED_RANGE_HU
    );


const unmatchedInsideDocumented =
    unmatched.filter(
        row =>
            Number.isFinite(
                row
                    ?.proximity
                    ?.nearestDistance3D
            )
            &&
            row
                .proximity
                .nearestDistance3D <=
                DOCUMENTED_RANGE_HU
    );


const unmatchedNoSynchronousOpponent =
    unmatched.filter(
        row =>
            !Number.isFinite(
                row
                    ?.proximity
                    ?.nearestDistance3D
            )
    );


// ============================================================
// TEMPORAL-ENVELOPE RESOLUTION
//
// For matched deaths apparently outside 45m synchronously,
// check whether any opponent was <=45m during ±0.5 sec.
//
// This can identify sampling/interpolation edge cases.
// ============================================================

let matchedOutsideResolvedByEnvelope =
    0;


for (
    const death
    of matchedOutsideDocumented
) {

    const anyWithinEnvelope =
        death
            .proximity
            .players
            .some(
                player =>
                    Number.isFinite(
                        player.envelopeMinDistance3D
                    )
                    &&
                    player.envelopeMinDistance3D <=
                        DOCUMENTED_RANGE_HU
            );


    death.documentedRangeEnvelopeResolution =
        anyWithinEnvelope;


    if (
        anyWithinEnvelope
    ) {

        matchedOutsideResolvedByEnvelope++;
    }
}


// ============================================================
// TYPE-SPECIFIC DOCUMENTED THRESHOLD
// ============================================================

const byBaseType =
    [];


for (
    const baseType
    of [
        'RANGED',
        'MEDIC',
        'MELEE'
    ]
) {

    const rows =
        deaths.filter(
            row =>
                row.baseType ===
                baseType
        );


    const typeEvaluation =
        evaluateThreshold(
            rows,
            DOCUMENTED_RANGE_HU,
            'nearestDistance3D'
        );


    byBaseType.push({

        baseType,

        total:
            rows.length,

        matched:
            rows.filter(
                row =>
                    row.groundSoulMatched
            ).length,

        unmatched:
            rows.filter(
                row =>
                    !row.groundSoulMatched
            ).length,

        documented45m:
            typeEvaluation
    });
}


// ============================================================
// CONVERT RANGE BACK TO METERS
// ============================================================

const best3DMeters =
    best3D
        ? best3D.threshold /
            HU_PER_METER
        : null;


const bestXYMeters =
    bestXY
        ? bestXY.threshold /
            HU_PER_METER
        : null;


// ============================================================
// OUTLIER WRITER
// ============================================================

mkdirSync(
    dirname(
        outlierPath
    ),
    {
        recursive: true
    }
);


const outlierWriter =
    createWriteStream(
        outlierPath,
        {
            encoding:
                'utf8'
        }
    );


for (
    const death
    of matchedOutsideDocumented
) {

    outlierWriter.write(
        JSON.stringify(
            compactOutlier(
                death,
                'MATCHED_OUTSIDE_DOCUMENTED_45M'
            )
        )
        +
        '\n'
    );
}


for (
    const death
    of unmatchedInsideDocumented
) {

    outlierWriter.write(
        JSON.stringify(
            compactOutlier(
                death,
                'UNMATCHED_INSIDE_DOCUMENTED_45M'
            )
        )
        +
        '\n'
    );
}


for (
    const death
    of unmatchedNoSynchronousOpponent
) {

    outlierWriter.write(
        JSON.stringify(
            compactOutlier(
                death,
                'UNMATCHED_NO_SYNCHRONOUS_OPPONENT_STATE'
            )
        )
        +
        '\n'
    );
}


await finishWriter(
    outlierWriter
);


// ============================================================
// VALIDATION
// ============================================================

const validation =
    {

        deathRowsLoaded:
            {

                actual:
                    deaths.length,

                expected:
                    replayName ===
                        'test'
                        ? 1727
                        : '>0',

                pass:
                    replayName ===
                        'test'

                        ? deaths.length ===
                            1727

                        : deaths.length >
                            0
            },

        matchedRows:
            {

                actual:
                    matched.length,

                expected:
                    replayName ===
                        'test'
                        ? 1388
                        : '>0',

                pass:
                    replayName ===
                        'test'

                        ? matched.length ===
                            1388

                        : matched.length >
                            0
            },

        unmatchedRows:
            {

                actual:
                    unmatched.length,

                expected:
                    replayName ===
                        'test'
                        ? 339
                        : '>=0',

                pass:
                    replayName ===
                        'test'

                        ? unmatched.length ===
                            339

                        : unmatched.length >=
                            0
            },

        playerTimelinesLoaded:
            {

                actual:
                    timelines.size,

                expected:
                    '>0',

                pass:
                    timelines.size >
                    0
            },

        synchronousOpponentStatesResolved:
            {

                actual:
                    deathsWithSynchronousOpponent,

                expected:
                    '>0',

                pass:
                    deathsWithSynchronousOpponent >
                    0
            },

        documentedThresholdEvaluated:
            {

                actual:
                    documented3D
                        ?.threshold
                    ??
                    null,

                expected:
                    DOCUMENTED_RANGE_HU,

                pass:
                    Boolean(
                        documented3D
                    )
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
// INTERPRETATION
// ============================================================

let rangeInterpretation =
    'UNRESOLVED';


if (
    documented3D
    &&
    documented3D.sensitivity >=
        0.95
    &&
    documented3D.specificity >=
        0.95
) {

    rangeInterpretation =
        'DOCUMENTED_45M_RANGE_STRONGLY_SUPPORTED';
}


if (
    documented3D
    &&
    documented3D.sensitivity >=
        0.98
    &&
    documented3D.specificity >=
        0.98
) {

    rangeInterpretation =
        'DOCUMENTED_45M_RANGE_NEAR_DETERMINISTIC';
}


// ============================================================
// SUMMARY
// ============================================================

const summary =
    {

        replay:
            replayName,

        version:
            'TROOPER_GROUND_SOUL_RANGE_VALIDATION_V01',

        canonical:
            false,

        status:
            validationPass
                ? 'WORKING_RANGE_VALIDATION'
                : 'DIAGNOSTIC_ONLY',

        documentedMechanicTarget:
            {

                rangeMeters:
                    DOCUMENTED_RANGE_METERS,

                hammerUnitsPerMeter:
                    HU_PER_METER,

                rangeInternalUnits:
                    DOCUMENTED_RANGE_HU,

                statement:
                    'Test whether an opposing-team player must be within approximately 45m when a Trooper dies for CCitadel_Pickup_AssignedGold to spawn.',

                importantException:
                    'Melee final blows can suppress ordinary soul-orb spawning and therefore create legitimate unmatched deaths inside the eligibility range.'
            },

        sourceCounts:
            {

                deaths:
                    deaths.length,

                matchedGroundSoul:
                    matched.length,

                unmatchedGroundSoul:
                    unmatched.length,

                playerStateRows,

                playerTimelines:
                    timelines.size,

                deathsWithSynchronousOpponent,

                deathsWithoutSynchronousOpponent
            },

        synchronousEstimation:
            {

                maxInterpolationGapSeconds:
                    MAX_INTERPOLATION_GAP_SECONDS,

                maxNearestFallbackDeltaSeconds:
                    MAX_NEAREST_SAMPLE_DELTA_SECONDS,

                envelopeSeconds:
                    ENVELOPE_SECONDS,

                primaryMethod:
                    'Linear interpolation between bracketing 0.25-second player-state samples when both samples are alive, movement-valid, and spatially valid.'
            },

        observedDistributions:
            {

                matchedNearestOpponent3D:
                    summarizeNumbers(
                        matched3D
                    ),

                unmatchedNearestOpponent3D:
                    summarizeNumbers(
                        unmatched3D
                    ),

                matchedNearestOpponentXY:
                    summarizeNumbers(
                        matchedXY
                    ),

                unmatchedNearestOpponentXY:
                    summarizeNumbers(
                        unmatchedXY
                    )
            },

        documented45mTest:
            {

                threeDimensional:
                    documented3D,

                planarXY:
                    documentedXY,

                matchedOutside45m:
                    matchedOutsideDocumented.length,

                matchedOutside45mResolvedByHalfSecondEnvelope:
                    matchedOutsideResolvedByEnvelope,

                unmatchedInside45m:
                    unmatchedInsideDocumented.length,

                unmatchedWithoutSynchronousOpponent:
                    unmatchedNoSynchronousOpponent.length,

                interpretation:
                    rangeInterpretation
            },

        empiricalThresholdSearch:
            {

                searchMinHU:
                    THRESHOLD_MIN,

                searchMaxHU:
                    THRESHOLD_MAX,

                stepHU:
                    THRESHOLD_STEP,

                best3D:
                    best3D
                        ? {

                            ...best3D,

                            meters:
                                best3DMeters
                        }
                        : null,

                bestXY:
                    bestXY
                        ? {

                            ...bestXY,

                            meters:
                                bestXYMeters
                        }
                        : null,

                comparisonToDocumented45m:
                    {

                        documentedHU:
                            DOCUMENTED_RANGE_HU,

                        best3DDifferenceHU:
                            best3D
                                ? best3D.threshold -
                                    DOCUMENTED_RANGE_HU
                                : null,

                        best3DDifferenceMeters:
                            best3D
                                ? best3DMeters -
                                    DOCUMENTED_RANGE_METERS
                                : null
                    }
            },

        byBaseType,

        outliers:
            {

                matchedOutside45m:
                    matchedOutsideDocumented
                        .map(
                            row =>
                                compactOutlier(
                                    row,
                                    'MATCHED_OUTSIDE_DOCUMENTED_45M'
                                )
                        ),

                unmatchedInside45m:
                    unmatchedInsideDocumented
                        .map(
                            row =>
                                compactOutlier(
                                    row,
                                    'UNMATCHED_INSIDE_DOCUMENTED_45M'
                                )
                        ),

                unmatchedNoSynchronousOpponent:
                    unmatchedNoSynchronousOpponent
                        .map(
                            row =>
                                compactOutlier(
                                    row,
                                    'UNMATCHED_NO_SYNCHRONOUS_OPPONENT_STATE'
                                )
                        )
            },

        interpretation:
            {

                result:
                    rangeInterpretation,

                ifSupported:
                    'Ground-soul spawn eligibility should become a state variable: at least one opposing-team player within the calibrated Trooper soul-drop range at death.',

                closeUnmatchedMeaning:
                    'Deaths inside the range without AssignedGold become priority candidates for melee-final-blow suppression or another explicit no-orb mechanic.',

                farUnmatchedMeaning:
                    'Deaths outside the range should not be counted as missed ground souls because the reward object was never eligible to spawn.',

                nextIfClean:
                    'Use matched eligible non-Rift deaths as the high-confidence discovery set for the separate flying deniable Soul Orb.'
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

                outliers:
                    outlierPath
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
    '========================================='
);

console.log(
    'GROUND SOUL RANGE VALIDATION V0.1'
);

console.log(
    '========================================='
);

console.log('');

console.log(
    `Documented range: ${DOCUMENTED_RANGE_METERS}m`
);

console.log(
    `Internal target: ${DOCUMENTED_RANGE_HU.toFixed(
        2
    )} units`
);

console.log('');

console.log(
    'SYNCHRONOUS DISTANCES'
);

console.log(
    '---------------------'
);

console.log(
    `Matched median: ${formatNumber(
        summarizeNumbers(
            matched3D
        ).median
    )}`
);

console.log(
    `Matched p95: ${formatNumber(
        summarizeNumbers(
            matched3D
        ).p95
    )}`
);

console.log(
    `Unmatched median: ${formatNumber(
        summarizeNumbers(
            unmatched3D
        ).median
    )}`
);

console.log(
    `Unmatched p05: ${formatNumber(
        summarizeNumbers(
            unmatched3D
        ).p05
    )}`
);

console.log('');

console.log(
    'DOCUMENTED 45M TEST'
);

console.log(
    '-------------------'
);

console.log(
    `TP matched-inside: ${documented3D?.tp ?? 0}`
);

console.log(
    `FN matched-outside: ${documented3D?.fn ?? 0}`
);

console.log(
    `FP unmatched-inside: ${documented3D?.fp ?? 0}`
);

console.log(
    `TN unmatched-outside: ${documented3D?.tn ?? 0}`
);

console.log(
    `Sensitivity: ${formatPercent(
        documented3D?.sensitivity
    )}`
);

console.log(
    `Specificity: ${formatPercent(
        documented3D?.specificity
    )}`
);

console.log(
    `MCC: ${formatNumber(
        documented3D?.mcc
    )}`
);

console.log('');

console.log(
    `Matched outside 45m: ${matchedOutsideDocumented.length}`
);

console.log(
    `...resolved by ±0.5s envelope: ${matchedOutsideResolvedByEnvelope}`
);

console.log(
    `Unmatched inside 45m: ${unmatchedInsideDocumented.length}`
);

console.log('');

console.log(
    'EMPIRICAL BEST THRESHOLD'
);

console.log(
    '------------------------'
);

console.log(
    `3D: ${
        best3D
            ? `${best3D.threshold.toFixed(
                2
            )} units = ${best3DMeters.toFixed(
                2
            )}m | MCC=${best3D.mcc.toFixed(
                4
            )}`
            : 'n/a'
    }`
);

console.log(
    `XY: ${
        bestXY
            ? `${bestXY.threshold.toFixed(
                2
            )} units = ${bestXYMeters.toFixed(
                2
            )}m | MCC=${bestXY.mcc.toFixed(
                4
            )}`
            : 'n/a'
    }`
);

console.log('');

console.log(
    'INTERPRETATION'
);

console.log(
    '--------------'
);

console.log(
    rangeInterpretation
);

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
                38
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
    `Outliers:\n${outlierPath}`
);

console.log('');


// ============================================================
// NORMALIZE DEATH
// ============================================================

function normalizeDeath(
    row
) {

    const entityIndex =
        finite(
            row
                ?.trooper
                ?.entityIndex
        );


    const timeSeconds =
        finite(
            row
                ?.timing
                ?.timeSeconds
        );


    const team =
        finite(
            row
                ?.trooper
                ?.team
        );


    const position =
        normalizePosition(
            row
                ?.trooper
                ?.position
        );


    if (
        entityIndex ===
            null
        ||
        timeSeconds ===
            null
        ||
        team ===
            null
        ||
        !position
    ) {

        return null;
    }


    return {

        deathIndex:
            finite(
                row.deathIndex
            ),

        deathKey:
            row.deathKey
            ??
            null,

        lifeId:
            row.lifeId
            ??
            null,

        entityIndex,

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

        team,

        lane:
            finite(
                row
                    ?.trooper
                    ?.lane
            ),

        position,

        timeSeconds,

        clock:
            row
                ?.timing
                ?.clock
            ??
            formatClock(
                timeSeconds
            ),

        groundSoulMatched:
            row
                ?.match
                ?.status ===
                'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
            ||
            Boolean(
                row.groundSoul
            ),

        proximity:
            null
    };
}


// ============================================================
// ESTIMATE PLAYER POSITION AT EXACT DEATH TIME
// ============================================================

function estimateStateAtTime(
    rows,
    timeSeconds
) {

    if (
        rows.length ===
        0
    ) {

        return null;
    }


    const index =
        lowerBoundTime(
            rows,
            timeSeconds
        );


    const before =
        index >
            0
            ? rows[
                index -
                1
            ]
            : null;


    const after =
        index <
            rows.length
            ? rows[
                index
            ]
            : null;


    // ========================================================
    // EXACT SAMPLE
    // ========================================================

    if (
        after
        &&
        Math.abs(
            after.timeSeconds -
            timeSeconds
        ) <
            1e-9
    ) {

        if (
            isUsablePlayerState(
                after
            )
        ) {

            return {

                method:
                    'EXACT_SAMPLE',

                sourceTimeDelta:
                    0,

                position:
                    after.position
            };
        }


        return null;
    }


    // ========================================================
    // INTERPOLATION
    // ========================================================

    if (
        before
        &&
        after
        &&
        isUsablePlayerState(
            before
        )
        &&
        isUsablePlayerState(
            after
        )
    ) {

        const gap =
            after.timeSeconds -
            before.timeSeconds;


        if (
            gap >
                0
            &&
            gap <=
                MAX_INTERPOLATION_GAP_SECONDS
            &&
            before.timeSeconds <=
                timeSeconds
            &&
            after.timeSeconds >=
                timeSeconds
        ) {

            const proportion =
                (
                    timeSeconds -
                    before.timeSeconds
                )
                /
                gap;


            return {

                method:
                    'LINEAR_INTERPOLATION',

                sourceTimeDelta:
                    Math.min(
                        Math.abs(
                            timeSeconds -
                            before.timeSeconds
                        ),
                        Math.abs(
                            after.timeSeconds -
                            timeSeconds
                        )
                    ),

                position:
                    {

                        x:
                            interpolate(
                                before.position.x,
                                after.position.x,
                                proportion
                            ),

                        y:
                            interpolate(
                                before.position.y,
                                after.position.y,
                                proportion
                            ),

                        z:
                            interpolate(
                                before.position.z,
                                after.position.z,
                                proportion
                            )
                    }
            };
        }
    }


    // ========================================================
    // FALLBACK NEAREST SAMPLE
    // ========================================================

    const candidates =
        [
            before,
            after
        ]
        .filter(
            Boolean
        )
        .filter(
            isUsablePlayerState
        )
        .map(
            row => ({

                row,

                delta:
                    Math.abs(
                        row.timeSeconds -
                        timeSeconds
                    )
            })
        )
        .sort(
            (
                a,
                b
            ) =>
                a.delta -
                b.delta
        );


    const nearest =
        candidates[
            0
        ]
        ??
        null;


    if (
        nearest
        &&
        nearest.delta <=
            MAX_NEAREST_SAMPLE_DELTA_SECONDS
    ) {

        return {

            method:
                'NEAREST_SAMPLE',

            sourceTimeDelta:
                nearest.delta,

            position:
                nearest.row.position
        };
    }


    return null;
}


// ============================================================
// TEMPORAL WINDOW MINIMUM
// ============================================================

function getMinimumDistanceInWindow(
    rows,
    timeSeconds,
    targetPosition,
    windowSeconds
) {

    const centerIndex =
        lowerBoundTime(
            rows,
            timeSeconds
        );


    let best =
        null;


    for (
        let i =
            Math.max(
                0,
                centerIndex -
                4
            );

        i <=
            Math.min(
                rows.length -
                    1,
                centerIndex +
                    4
            );

        i++
    ) {

        const row =
            rows[
                i
            ];


        const timeDelta =
            Math.abs(
                row.timeSeconds -
                timeSeconds
            );


        if (
            timeDelta >
            windowSeconds
        ) {

            continue;
        }


        if (
            !isUsablePlayerState(
                row
            )
        ) {

            continue;
        }


        const distance3D =
            getDistance3D(
                targetPosition,
                row.position
            );


        const distanceXY =
            getDistanceXY(
                targetPosition,
                row.position
            );


        if (
            !best
            ||
            distance3D <
                best.distance3D
        ) {

            best =
                {

                    timeSeconds:
                        row.timeSeconds,

                    timeDelta,

                    distance3D,

                    distanceXY
                };
        }
    }


    return best;
}


// ============================================================
// THRESHOLD EVALUATION
//
// Positive = ground-soul object spawned.
//
// Prediction:
// positive if any opposing player is within threshold.
// ============================================================

function evaluateThreshold(
    rows,
    threshold,
    distanceField
) {

    let tp =
        0;


    let tn =
        0;


    let fp =
        0;


    let fn =
        0;


    let unresolved =
        0;


    for (
        const row
        of rows
    ) {

        const distance =
            row
                ?.proximity
                ?.[
                    distanceField
                ];


        if (
            !Number.isFinite(
                distance
            )
        ) {

            unresolved++;


            continue;
        }


        const predictedSpawn =
            distance <=
            threshold;


        const observedSpawn =
            row.groundSoulMatched;


        if (
            predictedSpawn
            &&
            observedSpawn
        ) {

            tp++;

        } else if (
            predictedSpawn
            &&
            !observedSpawn
        ) {

            fp++;

        } else if (
            !predictedSpawn
            &&
            observedSpawn
        ) {

            fn++;

        } else {

            tn++;
        }
    }


    const sensitivity =
        rate(
            tp,
            tp +
                fn
        );


    const specificity =
        rate(
            tn,
            tn +
                fp
        );


    const precision =
        rate(
            tp,
            tp +
                fp
        );


    const accuracy =
        rate(
            tp +
                tn,
            tp +
                tn +
                fp +
                fn
        );


    const balancedAccuracy =
        (
            Number.isFinite(
                sensitivity
            )
            &&
            Number.isFinite(
                specificity
            )
        )
            ? (
                sensitivity +
                specificity
            )
            /
            2
            : null;


    const denominator =
        Math.sqrt(
            (
                tp +
                fp
            )
            *
            (
                tp +
                fn
            )
            *
            (
                tn +
                fp
            )
            *
            (
                tn +
                fn
            )
        );


    const mcc =
        denominator >
            0

            ? (
                tp *
                tn
                -
                fp *
                fn
            )
            /
            denominator

            : null;


    return {

        threshold,

        tp,

        fp,

        tn,

        fn,

        unresolved,

        sensitivity,

        specificity,

        precision,

        accuracy,

        balancedAccuracy,

        mcc
    };
}


// ============================================================
// SELECT BEST THRESHOLD
// ============================================================

function selectBestThreshold(
    rows
) {

    const valid =
        rows.filter(
            row =>
                Number.isFinite(
                    row.mcc
                )
        );


    if (
        valid.length ===
        0
    ) {

        return null;
    }


    valid.sort(
        (
            a,
            b
        ) =>
            b.mcc -
                a.mcc
            ||
            Math.abs(
                a.threshold -
                DOCUMENTED_RANGE_HU
            )
            -
            Math.abs(
                b.threshold -
                DOCUMENTED_RANGE_HU
            )
    );


    return valid[
        0
    ];
}


// ============================================================
// OUTLIER
// ============================================================

function compactOutlier(
    death,
    category
) {

    const nearest =
        death
            ?.proximity
            ?.nearest;


    const nearestEnvelopeDistance =
        death
            ?.proximity
            ?.players
            ?.map(
                player =>
                    player.envelopeMinDistance3D
            )
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
            )[0]
        ??
        null;


    return {

        category,

        deathIndex:
            death.deathIndex,

        deathKey:
            death.deathKey,

        entityIndex:
            death.entityIndex,

        clock:
            death.clock,

        timeSeconds:
            death.timeSeconds,

        baseType:
            death.baseType,

        variantLabel:
            death.variantLabel,

        team:
            death.team,

        lane:
            death.lane,

        groundSoulMatched:
            death.groundSoulMatched,

        deathPosition:
            death.position,

        nearestOpponent:
            nearest,

        nearestDistance3D:
            death
                ?.proximity
                ?.nearestDistance3D
            ??
            null,

        nearestDistanceXY:
            death
                ?.proximity
                ?.nearestDistanceXY
            ??
            null,

        nearestEnvelopeDistance3D:
            nearestEnvelopeDistance,

        documentedRangeHU:
            DOCUMENTED_RANGE_HU,

        documentedRangeMeters:
            DOCUMENTED_RANGE_METERS,

        envelopeResolved:
            death
                ?.documentedRangeEnvelopeResolution
            ??
            null
    };
}


// ============================================================
// PLAYER STATE USABILITY
// ============================================================

function isUsablePlayerState(
    row
) {

    return Boolean(
        row
        &&
        row.alive ===
            true
        &&
        row.movementValid ===
            true
        &&
        row.position
    );
}


// ============================================================
// LOWER BOUND
// ============================================================

function lowerBoundTime(
    rows,
    timeSeconds
) {

    let low =
        0;


    let high =
        rows.length;


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
            rows[
                middle
            ].timeSeconds <
                timeSeconds
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

            // Ignore malformed lines.
        }
    }


    return rows;
}


// ============================================================
// POSITION
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
        a.z -
        b.z;


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
// INTERPOLATION
// ============================================================

function interpolate(
    a,
    b,
    proportion
) {

    return a
        +
        (
            b -
            a
        )
        *
        proportion;
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

            p05:
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

        p05:
            percentile(
                clean,
                0.05
            ),

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
// HELPERS
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


function approximatelyEqual(
    a,
    b
) {

    return Math.abs(
        a -
        b
    ) <
    0.001;
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
        3
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
    `${minutes}:${
        String(
            secs
        ).padStart(
            2,
            '0'
        )
    }`;
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