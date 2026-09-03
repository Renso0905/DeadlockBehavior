import {
    createReadStream,
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


const TICK_RATE =
    64;


// ============================================================
// DIRECT MELEE WINDOWS
//
// We do not yet assume attack_trigger_time is exactly the
// damage/final-blow instant.
//
// Instead, evaluate several windows.
// ============================================================

const MELEE_WINDOWS_SECONDS =
    [
        0.125,
        0.250,
        0.500,
        0.750,
        1.000
    ];


// ============================================================
// PLAYER PROXIMITY THRESHOLDS
//
// Empirical diagnostic only.
//
// Do not assign gameplay meaning to any particular threshold
// until matched vs unmatched distributions are inspected.
// ============================================================

const PLAYER_DISTANCE_THRESHOLDS =
    [
        250,
        500,
        750,
        1000,
        1250,
        1500,
        1750,
        1800,
        2000,
        2250,
        2500,
        3000
    ];


// ============================================================
// PLAYER STATE TIMING
//
// player_state is sampled every 0.25 sec.
//
// Search ±0.5 sec and choose each player's temporally closest
// row to the Trooper death.
// ============================================================

const PLAYER_STATE_BUCKET_HZ =
    4;


const PLAYER_STATE_SEARCH_BUCKETS =
    2;


// ============================================================
// MELEE CLOCK ALIGNMENT
//
// Earlier telemetry used both demo-time and match-time forms.
//
// We automatically choose the offset that produces the most
// direct target-attributed temporal coincidences.
//
// raw + offset = match time
// ============================================================

const MELEE_TIME_OFFSET_CANDIDATES =
    [
        0,
        -30,
        30
    ];


// ============================================================
// OUTPUT LIMITS
// ============================================================

const MAX_EXAMPLES_PER_GROUP =
    100;


// ============================================================
// PATHS
// ============================================================

const deathStreamPath =
    resolve(
        'output',
        replayName,
        'trooper_ground_soul_one_to_one_v01.jsonl'
    );


const meleePath =
    resolve(
        'output',
        replayName,
        'verified_melee_events.jsonl'
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
        'trooper_ground_soul_unmatched_diagnostic_v01.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        deathStreamPath,
        meleePath,
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
// LOAD TROOPER ECONOMY DEATH STREAM
// ============================================================

console.log('');

console.log(
    'Loading one-to-one Trooper death stream...'
);


const deaths =
    await loadJsonl(
        deathStreamPath
    );


const normalizedDeaths =
    deaths

        .map(
            normalizeDeath
        )

        .filter(
            Boolean
        );


console.log(
    `Eligible death rows: ${normalizedDeaths.length}`
);


// ============================================================
// INDEX DEATHS BY TROOPER ENTITY
// ============================================================

const deathsByEntity =
    new Map();


for (
    const death
    of normalizedDeaths
) {

    if (
        !deathsByEntity.has(
            death.entityIndex
        )
    ) {

        deathsByEntity.set(
            death.entityIndex,
            []
        );
    }


    deathsByEntity
        .get(
            death.entityIndex
        )
        .push(
            death
        );
}


for (
    const rows
    of deathsByEntity.values()
) {

    rows.sort(
        (
            a,
            b
        ) =>
            a.timeSeconds -
            b.timeSeconds
    );
}


// ============================================================
// LOAD + NORMALIZE MELEE EVENTS
// ============================================================

console.log(
    'Loading verified melee events...'
);


const rawMelee =
    await loadJsonl(
        meleePath
    );


const melee =
    rawMelee

        .map(
            (
                row,
                index
            ) =>
                normalizeMelee(
                    row,
                    index
                )
        )

        .filter(
            Boolean
        );


console.log(
    `Melee rows loaded: ${rawMelee.length}`
);

console.log(
    `Melee rows normalized: ${melee.length}`
);


const meleeWithTarget =
    melee.filter(
        row =>
            row.targetEntityIndex !==
            null
    );


console.log(
    `Melee rows with attributed target: ${meleeWithTarget.length}`
);


// ============================================================
// DETECT MELEE TIME OFFSET
// ============================================================

const meleeOffsetDiagnostics =
    [];


for (
    const offset
    of MELEE_TIME_OFFSET_CANDIDATES
) {

    let directTargetMatches125 =
        0;


    let directTargetMatches250 =
        0;


    let directTargetMatches500 =
        0;


    const deltas =
        [];


    for (
        const attack
        of meleeWithTarget
    ) {

        if (
            attack.rawTime ===
            null
        ) {

            continue;
        }


        const candidateDeaths =
            deathsByEntity.get(
                attack.targetEntityIndex
            )
            ??
            [];


        if (
            candidateDeaths.length ===
            0
        ) {

            continue;
        }


        const attackTime =
            attack.rawTime +
            offset;


        const nearest =
            findNearestByTime(
                candidateDeaths,
                attackTime
            );


        if (
            !nearest
        ) {

            continue;
        }


        const delta =
            attackTime -
            nearest.timeSeconds;


        deltas.push(
            delta
        );


        if (
            Math.abs(
                delta
            ) <=
            0.125
        ) {

            directTargetMatches125++;
        }


        if (
            Math.abs(
                delta
            ) <=
            0.250
        ) {

            directTargetMatches250++;
        }


        if (
            Math.abs(
                delta
            ) <=
            0.500
        ) {

            directTargetMatches500++;
        }
    }


    const score =
        directTargetMatches125 *
            100
        +
        directTargetMatches250 *
            10
        +
        directTargetMatches500;


    meleeOffsetDiagnostics.push({

        offsetSeconds:
            offset,

        score,

        directTargetMatchesWithin125ms:
            directTargetMatches125,

        directTargetMatchesWithin250ms:
            directTargetMatches250,

        directTargetMatchesWithin500ms:
            directTargetMatches500,

        nearestDeathDelta:
            summarizeNumbers(
                deltas
            )
    });
}


meleeOffsetDiagnostics.sort(
    (
        a,
        b
    ) =>
        b.score -
        a.score
);


const selectedMeleeTimeOffset =
    meleeOffsetDiagnostics[
        0
    ]
    ?.offsetSeconds
    ??
    0;


for (
    const attack
    of melee
) {

    attack.matchTimeSeconds =
        attack.rawTime !==
            null

            ? attack.rawTime +
                selectedMeleeTimeOffset

            : (
                attack.rawTick !==
                    null

                    ? (
                        attack.rawTick /
                        TICK_RATE
                    )
                    - 30

                    : null
            );
}


console.log(
    `Selected melee time offset: ${selectedMeleeTimeOffset}s`
);


// ============================================================
// INDEX TARGET-ATTRIBUTED MELEE EVENTS
// ============================================================

const meleeByTargetEntity =
    new Map();


for (
    const attack
    of melee
) {

    if (
        attack.targetEntityIndex ===
            null
        ||
        attack.matchTimeSeconds ===
            null
    ) {

        continue;
    }


    if (
        !meleeByTargetEntity.has(
            attack.targetEntityIndex
        )
    ) {

        meleeByTargetEntity.set(
            attack.targetEntityIndex,
            []
        );
    }


    meleeByTargetEntity
        .get(
            attack.targetEntityIndex
        )
        .push(
            attack
        );
}


for (
    const rows
    of meleeByTargetEntity.values()
) {

    rows.sort(
        (
            a,
            b
        ) =>
            a.matchTimeSeconds -
            b.matchTimeSeconds
    );
}


// ============================================================
// LOAD PLAYER STATE BUCKETS
// ============================================================

console.log(
    'Loading player-state proximity buckets...'
);


const playerBuckets =
    new Map();


let playerRows =
    0;


let usablePlayerRows =
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


    playerRows++;


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
            row
                ?.matchTimeSeconds
        );


    const team =
        finite(
            row
                ?.controller
                ?.team
        );


    const playerName =
        row
            ?.controller
            ?.playerName
        ??
        null;


    const pawnEntityIndex =
        finite(
            row
                ?.pawn
                ?.entityIndex
        );


    const alive =
        row
            ?.controller
            ?.alive ===
        true;


    const movementValid =
        row
            ?.pawn
            ?.positionValidForMovement ===
        true;


    const position =
        normalizePosition(
            row
                ?.pawn
                ?.positionWorld
        );


    if (
        timeSeconds ===
            null
        ||
        team ===
            null
        ||
        !playerName
        ||
        pawnEntityIndex ===
            null
        ||
        !alive
        ||
        !movementValid
        ||
        !position
    ) {

        continue;
    }


    usablePlayerRows++;


    const bucket =
        Math.round(
            timeSeconds *
            PLAYER_STATE_BUCKET_HZ
        );


    if (
        !playerBuckets.has(
            bucket
        )
    ) {

        playerBuckets.set(
            bucket,
            []
        );
    }


    playerBuckets
        .get(
            bucket
        )
        .push({

            timeSeconds,

            team,

            playerName,

            pawnEntityIndex,

            position
        });
}


console.log(
    `Player rows: ${playerRows}`
);

console.log(
    `Usable spatial player rows: ${usablePlayerRows}`
);


// ============================================================
// ENRICH EACH DEATH
// ============================================================

for (
    const death
    of normalizedDeaths
) {

    // ========================================================
    // DIRECT TARGET-ATTRIBUTED MELEE
    // ========================================================

    const attacks =
        meleeByTargetEntity.get(
            death.entityIndex
        )
        ??
        [];


    const nearbyMelee =
        [];


    for (
        const attack
        of attacks
    ) {

        const delta =
            attack.matchTimeSeconds -
            death.timeSeconds;


        if (
            Math.abs(
                delta
            ) >
            1.0
        ) {

            continue;
        }


        nearbyMelee.push({

            meleeIndex:
                attack.meleeIndex,

            playerName:
                attack.playerName,

            playerTeam:
                attack.playerTeam,

            attackType:
                attack.attackType,

            hit:
                attack.hit,

            attackTimeSeconds:
                attack.matchTimeSeconds,

            timeDeltaSeconds:
                delta,

            absoluteTimeDeltaSeconds:
                Math.abs(
                    delta
                ),

            targetEntityIndex:
                attack.targetEntityIndex,

            position:
                attack.position
        });
    }


    nearbyMelee.sort(
        (
            a,
            b
        ) =>
            a.absoluteTimeDeltaSeconds -
            b.absoluteTimeDeltaSeconds
    );


    death.targetAttributedMeleeWithin1s =
        nearbyMelee;


    death.nearestTargetAttributedMelee =
        nearbyMelee[
            0
        ]
        ??
        null;


    // ========================================================
    // PLAYER PROXIMITY AT DEATH
    // ========================================================

    death.playerProximity =
        findOpposingPlayerProximity(
            death
        );
}


// ============================================================
// MATCHED / UNMATCHED GROUPS
// ============================================================

const matched =
    normalizedDeaths.filter(
        row =>
            row.groundSoulMatched
    );


const unmatched =
    normalizedDeaths.filter(
        row =>
            !row.groundSoulMatched
    );


// ============================================================
// MELEE WINDOW MATRIX
// ============================================================

const meleeWindowMatrix =
    [];


for (
    const windowSeconds
    of MELEE_WINDOWS_SECONDS
) {

    const matchedWithMelee =
        matched.filter(
            row =>
                hasTargetMeleeWithin(
                    row,
                    windowSeconds
                )
        );


    const unmatchedWithMelee =
        unmatched.filter(
            row =>
                hasTargetMeleeWithin(
                    row,
                    windowSeconds
                )
        );


    meleeWindowMatrix.push({

        windowSeconds,

        matched:
            {

                total:
                    matched.length,

                withTargetAttributedMelee:
                    matchedWithMelee.length,

                rate:
                    rate(
                        matchedWithMelee.length,
                        matched.length
                    )
            },

        unmatched:
            {

                total:
                    unmatched.length,

                withTargetAttributedMelee:
                    unmatchedWithMelee.length,

                rate:
                    rate(
                        unmatchedWithMelee.length,
                        unmatched.length
                    )
            },

        rateRatioUnmatchedVsMatched:
            safeRatio(
                rate(
                    unmatchedWithMelee.length,
                    unmatched.length
                ),
                rate(
                    matchedWithMelee.length,
                    matched.length
                )
            )
    });
}


// ============================================================
// BEST MELEE DIAGNOSTIC WINDOW
//
// Purely descriptive:
// choose the window with greatest unmatched-vs-matched
// percentage-point separation.
// ============================================================

let bestMeleeWindow =
    null;


for (
    const row
    of meleeWindowMatrix
) {

    const matchedRate =
        row
            ?.matched
            ?.rate;


    const unmatchedRate =
        row
            ?.unmatched
            ?.rate;


    if (
        !Number.isFinite(
            matchedRate
        )
        ||
        !Number.isFinite(
            unmatchedRate
        )
    ) {

        continue;
    }


    const separation =
        unmatchedRate -
        matchedRate;


    if (
        !bestMeleeWindow
        ||
        separation >
        bestMeleeWindow.separation
    ) {

        bestMeleeWindow =
            {

                windowSeconds:
                    row.windowSeconds,

                separation
            };
    }
}


// ============================================================
// MELEE ATTACK TYPE DISTRIBUTION
// ============================================================

const chosenMeleeWindow =
    bestMeleeWindow
        ?.windowSeconds
    ??
    0.5;


const matchedMeleeTypes =
    countBy(
        matched.filter(
            row =>
                hasTargetMeleeWithin(
                    row,
                    chosenMeleeWindow
                )
        ),
        row =>
            row
                .nearestTargetAttributedMelee
                ?.attackType
            ??
            'UNKNOWN'
    );


const unmatchedMeleeTypes =
    countBy(
        unmatched.filter(
            row =>
                hasTargetMeleeWithin(
                    row,
                    chosenMeleeWindow
                )
        ),
        row =>
            row
                .nearestTargetAttributedMelee
                ?.attackType
            ??
            'UNKNOWN'
    );


// ============================================================
// PLAYER PROXIMITY DISTRIBUTIONS
// ============================================================

const matchedNearest3D =
    matched

        .map(
            row =>
                row
                    ?.playerProximity
                    ?.nearestDistance3D
        )

        .filter(
            Number.isFinite
        );


const unmatchedNearest3D =
    unmatched

        .map(
            row =>
                row
                    ?.playerProximity
                    ?.nearestDistance3D
        )

        .filter(
            Number.isFinite
        );


const matchedNearestXY =
    matched

        .map(
            row =>
                row
                    ?.playerProximity
                    ?.nearestDistanceXY
        )

        .filter(
            Number.isFinite
        );


const unmatchedNearestXY =
    unmatched

        .map(
            row =>
                row
                    ?.playerProximity
                    ?.nearestDistanceXY
        )

        .filter(
            Number.isFinite
        );


// ============================================================
// DISTANCE THRESHOLD MATRIX
// ============================================================

const distanceThresholdMatrix =
    [];


for (
    const threshold
    of PLAYER_DISTANCE_THRESHOLDS
) {

    const matchedInside =
        matched.filter(
            row =>
                Number.isFinite(
                    row
                        ?.playerProximity
                        ?.nearestDistance3D
                )
                &&
                row
                    .playerProximity
                    .nearestDistance3D <=
                    threshold
        ).length;


    const unmatchedInside =
        unmatched.filter(
            row =>
                Number.isFinite(
                    row
                        ?.playerProximity
                        ?.nearestDistance3D
                )
                &&
                row
                    .playerProximity
                    .nearestDistance3D <=
                    threshold
        ).length;


    distanceThresholdMatrix.push({

        threshold,

        matched:
            {

                inside:
                    matchedInside,

                total:
                    matched.length,

                rate:
                    rate(
                        matchedInside,
                        matched.length
                    )
            },

        unmatched:
            {

                inside:
                    unmatchedInside,

                total:
                    unmatched.length,

                rate:
                    rate(
                        unmatchedInside,
                        unmatched.length
                    )
            }
    });
}


// ============================================================
// TYPE-SPECIFIC OUTCOME
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
        normalizedDeaths.filter(
            row =>
                row.baseType ===
                baseType
        );


    const typeMatched =
        rows.filter(
            row =>
                row.groundSoulMatched
        );


    const typeUnmatched =
        rows.filter(
            row =>
                !row.groundSoulMatched
        );


    const unmatchedWithMelee =
        typeUnmatched.filter(
            row =>
                hasTargetMeleeWithin(
                    row,
                    chosenMeleeWindow
                )
        );


    const matchedWithMelee =
        typeMatched.filter(
            row =>
                hasTargetMeleeWithin(
                    row,
                    chosenMeleeWindow
                )
        );


    byBaseType.push({

        baseType,

        total:
            rows.length,

        matched:
            typeMatched.length,

        unmatched:
            typeUnmatched.length,

        matchRate:
            rate(
                typeMatched.length,
                rows.length
            ),

        targetMeleeWithinChosenWindow:
            {

                windowSeconds:
                    chosenMeleeWindow,

                matched:
                    matchedWithMelee.length,

                matchedRate:
                    rate(
                        matchedWithMelee.length,
                        typeMatched.length
                    ),

                unmatched:
                    unmatchedWithMelee.length,

                unmatchedRate:
                    rate(
                        unmatchedWithMelee.length,
                        typeUnmatched.length
                    )
            },

        proximity:
            {

                matchedNearest3D:
                    summarizeNumbers(
                        typeMatched
                            .map(
                                row =>
                                    row
                                        ?.playerProximity
                                        ?.nearestDistance3D
                            )
                    ),

                unmatchedNearest3D:
                    summarizeNumbers(
                        typeUnmatched
                            .map(
                                row =>
                                    row
                                        ?.playerProximity
                                        ?.nearestDistance3D
                            )
                    )
            }
    });
}


// ============================================================
// CANDIDATE-ACTIVATION STATUS AMONG UNMATCHED
// ============================================================

const unmatchedCandidateActivationCounts =
    countBy(
        unmatched,
        row =>
            String(
                row.candidateActivationCount
                ??
                0
            )
    );


// ============================================================
// MELEE-EXPLAINED CANDIDATE SET
//
// Still diagnostic, not canonical.
//
// This means:
// a verified target-attributed melee attack occurred close in
// time to the same Trooper death.
//
// It does NOT yet assert that melee was definitively the
// lethal damage source.
// ============================================================

const meleeAssociatedUnmatched =
    unmatched.filter(
        row =>
            hasTargetMeleeWithin(
                row,
                chosenMeleeWindow
            )
    );


const nonMeleeAssociatedUnmatched =
    unmatched.filter(
        row =>
            !hasTargetMeleeWithin(
                row,
                chosenMeleeWindow
            )
    );


// ============================================================
// REMAINING UNMATCHED PROXIMITY
// ============================================================

const remainingNearest3D =
    nonMeleeAssociatedUnmatched

        .map(
            row =>
                row
                    ?.playerProximity
                    ?.nearestDistance3D
        );


// ============================================================
// COMBINED MATRIX
// ============================================================

const combinedMatrix =
    [];


for (
    const threshold
    of PLAYER_DISTANCE_THRESHOLDS
) {

    let meleeAssociated =
        0;


    let noMeleeInside =
        0;


    let noMeleeOutside =
        0;


    let noSpatial =
        0;


    for (
        const death
        of unmatched
    ) {

        if (
            hasTargetMeleeWithin(
                death,
                chosenMeleeWindow
            )
        ) {

            meleeAssociated++;


            continue;
        }


        const distance =
            death
                ?.playerProximity
                ?.nearestDistance3D;


        if (
            !Number.isFinite(
                distance
            )
        ) {

            noSpatial++;


            continue;
        }


        if (
            distance <=
            threshold
        ) {

            noMeleeInside++;

        } else {

            noMeleeOutside++;
        }
    }


    combinedMatrix.push({

        distanceThreshold:
            threshold,

        totalUnmatched:
            unmatched.length,

        meleeAssociated,

        noMeleeInsideDistance:
            noMeleeInside,

        noMeleeOutsideDistance:
            noMeleeOutside,

        noUsablePlayerSpatialState:
            noSpatial
    });
}


// ============================================================
// PLAYER TARGET COUNTS FOR MELEE-ASSOCIATED UNMATCHED
// ============================================================

const meleePlayersUnmatched =
    countBy(
        meleeAssociatedUnmatched,
        row =>
            row
                ?.nearestTargetAttributedMelee
                ?.playerName
            ??
            'UNKNOWN'
    );


// ============================================================
// VALIDATION
// ============================================================

const matchedCount =
    matched.length;


const unmatchedCount =
    unmatched.length;


const sourceTotal =
    matchedCount +
    unmatchedCount;


const validation =
    {

        deathRowsLoaded:
            {

                actual:
                    normalizedDeaths.length,

                expected:
                    replayName ===
                        'test'
                        ? 1727
                        : '>0',

                pass:
                    replayName ===
                        'test'

                        ? normalizedDeaths.length ===
                            1727

                        : normalizedDeaths.length >
                            0
            },

        matchedDeaths:
            {

                actual:
                    matchedCount,

                expected:
                    replayName ===
                        'test'
                        ? 1388
                        : '>0',

                pass:
                    replayName ===
                        'test'

                        ? matchedCount ===
                            1388

                        : matchedCount >
                            0
            },

        unmatchedDeaths:
            {

                actual:
                    unmatchedCount,

                expected:
                    replayName ===
                        'test'
                        ? 339
                        : '>=0',

                pass:
                    replayName ===
                        'test'

                        ? unmatchedCount ===
                            339

                        : unmatchedCount >=
                            0
            },

        partitionIdentity:
            {

                actual:
                    sourceTotal,

                expected:
                    normalizedDeaths.length,

                pass:
                    sourceTotal ===
                    normalizedDeaths.length
            },

        meleeRowsLoaded:
            {

                actual:
                    melee.length,

                expected:
                    '>0',

                pass:
                    melee.length >
                    0
            },

        meleeTargetRowsObserved:
            {

                actual:
                    meleeWithTarget.length,

                expected:
                    '>0',

                pass:
                    meleeWithTarget.length >
                    0
            },

        playerSpatialRowsLoaded:
            {

                actual:
                    usablePlayerRows,

                expected:
                    '>0',

                pass:
                    usablePlayerRows >
                    0
            },

        matchedPlayerProximityResolved:
            {

                actual:
                    matchedNearest3D.length,

                expected:
                    '>0',

                pass:
                    matchedNearest3D.length >
                    0
            },

        unmatchedPlayerProximityResolved:
            {

                actual:
                    unmatchedNearest3D.length,

                expected:
                    '>0',

                pass:
                    unmatchedNearest3D.length >
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
            'TROOPER_GROUND_SOUL_UNMATCHED_DIAGNOSTIC_V01',

        canonical:
            false,

        purpose:
            [

                'Explain ordinary economic Trooper deaths that did not receive a one-to-one CCitadel_Pickup_AssignedGold match.',

                'Test verified target-attributed melee attacks as a candidate explanation.',

                'Test nearest opposing-player distance as a candidate ground-soul eligibility condition.',

                'Do not classify unmatched deaths as missed farm.'
            ],

        sourceCounts:
            {

                economicTrooperDeaths:
                    normalizedDeaths.length,

                matchedGroundSoulDeaths:
                    matched.length,

                unmatchedGroundSoulDeaths:
                    unmatched.length,

                meleeRows:
                    melee.length,

                meleeRowsWithTargetAttribution:
                    meleeWithTarget.length,

                playerStateRows:
                    playerRows,

                usablePlayerSpatialRows:
                    usablePlayerRows
            },

        existingGroundSoulResult:
            {

                matched:
                    matched.length,

                unmatched:
                    unmatched.length,

                matchRate:
                    rate(
                        matched.length,
                        normalizedDeaths.length
                    ),

                interpretation:
                    'The previous one-to-one matcher is not modified here.'
            },

        meleeTimeAlignment:
            {

                selectedOffsetSeconds:
                    selectedMeleeTimeOffset,

                candidateOffsets:
                    meleeOffsetDiagnostics,

                interpretation:
                    'Offset is selected solely by target-attributed melee/Trooper temporal coincidence.'
            },

        meleeAssociation:
            {

                windowMatrix:
                    meleeWindowMatrix,

                selectedDiagnosticWindowSeconds:
                    chosenMeleeWindow,

                selectedWindowReason:
                    'Largest unmatched-minus-matched association-rate separation.',

                matchedDeathsWithTargetAttributedMelee:
                    matched.filter(
                        row =>
                            hasTargetMeleeWithin(
                                row,
                                chosenMeleeWindow
                            )
                    ).length,

                unmatchedDeathsWithTargetAttributedMelee:
                    meleeAssociatedUnmatched.length,

                unmatchedAssociationRate:
                    rate(
                        meleeAssociatedUnmatched.length,
                        unmatched.length
                    ),

                matchedAttackTypes:
                    mapToSortedObject(
                        matchedMeleeTypes
                    ),

                unmatchedAttackTypes:
                    mapToSortedObject(
                        unmatchedMeleeTypes
                    ),

                unmatchedPlayers:
                    mapToSortedObject(
                        meleePlayersUnmatched
                    ),

                interpretation:
                    'A temporal target-attributed melee association is evidence for the melee-finisher hypothesis, but is not yet canonical proof of lethal melee damage.'
            },

        proximity:
            {

                matchedNearestOpponent:
                    {

                        distance3D:
                            summarizeNumbers(
                                matchedNearest3D
                            ),

                        distanceXY:
                            summarizeNumbers(
                                matchedNearestXY
                            )
                    },

                unmatchedNearestOpponent:
                    {

                        distance3D:
                            summarizeNumbers(
                                unmatchedNearest3D
                            ),

                        distanceXY:
                            summarizeNumbers(
                                unmatchedNearestXY
                            )
                    },

                thresholdMatrix:
                    distanceThresholdMatrix,

                interpretation:
                    'Distance is measured from Trooper death position to the nearest alive opposing-team player state within ±0.5 sec.'
            },

        afterRemovingMeleeAssociatedUnmatched:
            {

                total:
                    nonMeleeAssociatedUnmatched.length,

                nearestOpponentDistance3D:
                    summarizeNumbers(
                        remainingNearest3D
                    ),

                combinedThresholdMatrix:
                    combinedMatrix
            },

        byBaseType,

        unmatchedCandidateActivationCounts:
            mapToNumericKeyObject(
                unmatchedCandidateActivationCounts
            ),

        examples:
            {

                unmatchedWithTargetAttributedMelee:
                    meleeAssociatedUnmatched
                        .slice(
                            0,
                            MAX_EXAMPLES_PER_GROUP
                        )
                        .map(
                            compactDeathExample
                        ),

                unmatchedWithoutTargetAttributedMelee:
                    nonMeleeAssociatedUnmatched
                        .slice(
                            0,
                            MAX_EXAMPLES_PER_GROUP
                        )
                        .map(
                            compactDeathExample
                        ),

                matchedWithTargetAttributedMelee:
                    matched
                        .filter(
                            row =>
                                hasTargetMeleeWithin(
                                    row,
                                    chosenMeleeWindow
                                )
                        )
                        .slice(
                            0,
                            MAX_EXAMPLES_PER_GROUP
                        )
                        .map(
                            compactDeathExample
                        )
            },

        interpretationRules:
            {

                doNotCallUnmatchedMissedSoul:
                    true,

                ifMeleeAssociationIsStrong:
                    'Promote melee final-blow suppression to the next validation target using lethal damage telemetry.',

                ifDistanceSeparationIsStrong:
                    'Calibrate a player-presence eligibility radius from the empirical transition rather than importing a public value.',

                ifBothAreWeak:
                    'Return to entity/message discovery around unmatched deaths because AssignedGold may encode an additional unresolved mechanic.'
            },

        validation:
            {

                pass:
                    validationPass,

                checks:
                    validation
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
    'UNMATCHED GROUND SOUL DIAGNOSTIC V0.1'
);

console.log(
    '========================================='
);

console.log('');

console.log(
    'GROUND SOUL'
);

console.log(
    '-----------'
);

console.log(
    `Matched: ${matched.length}`
);

console.log(
    `Unmatched: ${unmatched.length}`
);

console.log(
    `Match rate: ${formatPercent(
        rate(
            matched.length,
            normalizedDeaths.length
        )
    )}`
);

console.log('');

console.log(
    'MELEE TIME ALIGNMENT'
);

console.log(
    '--------------------'
);


for (
    const row
    of meleeOffsetDiagnostics
) {

    console.log(
        `offset=${
            String(
                row.offsetSeconds
            ).padStart(
                4
            )
        }s  <=125ms=${
            String(
                row.directTargetMatchesWithin125ms
            ).padStart(
                4
            )
        }  <=250ms=${
            String(
                row.directTargetMatchesWithin250ms
            ).padStart(
                4
            )
        }  <=500ms=${
            String(
                row.directTargetMatchesWithin500ms
            ).padStart(
                4
            )
        }`
    );
}


console.log('');

console.log(
    `Selected offset: ${selectedMeleeTimeOffset}s`
);

console.log('');

console.log(
    'MELEE ASSOCIATION MATRIX'
);

console.log(
    '------------------------'
);


for (
    const row
    of meleeWindowMatrix
) {

    console.log(
        `±${
            row.windowSeconds.toFixed(
                3
            )
        }s | matched ${
            String(
                row.matched.withTargetAttributedMelee
            ).padStart(
                4
            )
        }/${
            String(
                row.matched.total
            ).padStart(
                4
            )
        } ${
            formatPercent(
                row.matched.rate
            ).padStart(
                7
            )
        } | unmatched ${
            String(
                row.unmatched.withTargetAttributedMelee
            ).padStart(
                4
            )
        }/${
            String(
                row.unmatched.total
            ).padStart(
                3
            )
        } ${
            formatPercent(
                row.unmatched.rate
            ).padStart(
                7
            )
        }`
    );
}


console.log('');

console.log(
    `Chosen diagnostic melee window: ±${chosenMeleeWindow.toFixed(
        3
    )}s`
);

console.log(
    `Unmatched melee-associated: ${meleeAssociatedUnmatched.length}/${unmatched.length} = ${formatPercent(
        rate(
            meleeAssociatedUnmatched.length,
            unmatched.length
        )
    )}`
);

console.log('');

console.log(
    'NEAREST OPPOSING PLAYER'
);

console.log(
    '-----------------------'
);

console.log(
    `Matched median 3D: ${formatNumber(
        summarizeNumbers(
            matchedNearest3D
        ).median
    )}`
);

console.log(
    `Matched p90 3D: ${formatNumber(
        summarizeNumbers(
            matchedNearest3D
        ).p90
    )}`
);

console.log(
    `Unmatched median 3D: ${formatNumber(
        summarizeNumbers(
            unmatchedNearest3D
        ).median
    )}`
);

console.log(
    `Unmatched p90 3D: ${formatNumber(
        summarizeNumbers(
            unmatchedNearest3D
        ).p90
    )}`
);

console.log('');

console.log(
    'DISTANCE THRESHOLDS'
);

console.log(
    '-------------------'
);


for (
    const row
    of distanceThresholdMatrix
) {

    console.log(
        `<=${
            String(
                row.threshold
            ).padStart(
                4
            )
        } | matched ${
            formatPercent(
                row.matched.rate
            ).padStart(
                7
            )
        } | unmatched ${
            formatPercent(
                row.unmatched.rate
            ).padStart(
                7
            )
        }`
    );
}


console.log('');

console.log(
    'BY TROOPER TYPE'
);

console.log(
    '---------------'
);


for (
    const row
    of byBaseType
) {

    console.log(
        `${
            row.baseType.padEnd(
                8
            )
        } matched=${
            String(
                row.matched
            ).padStart(
                4
            )
        }/${
            String(
                row.total
            ).padStart(
                4
            )
        } ${
            formatPercent(
                row.matchRate
            ).padStart(
                7
            )
        } | unmatched melee=${
            String(
                row
                    .targetMeleeWithinChosenWindow
                    .unmatched
            ).padStart(
                3
            )
        }/${
            String(
                row.unmatched
            ).padStart(
                3
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
    `Output:\n${outputPath}`
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


    const tick =
        finite(
            row
                ?.timing
                ?.tick
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
        tick ===
            null
        ||
        !position
    ) {

        return null;
    }


    const matchStatus =
        row
            ?.match
            ?.status
        ??
        null;


    const groundSoulMatched =
        matchStatus ===
            'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
        ||
        Boolean(
            row.groundSoul
        );


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

        isSuper:
            row
                ?.trooper
                ?.isSuper ===
            true,

        isRift:
            row
                ?.trooper
                ?.isRift ===
            true,

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

        maxHealth:
            finite(
                row
                    ?.trooper
                    ?.maxHealth
            ),

        position,

        tick,

        timeSeconds,

        clock:
            row
                ?.timing
                ?.clock
            ??
            formatClock(
                timeSeconds
            ),

        groundSoulMatched,

        candidateActivationCount:
            finite(
                row
                    ?.match
                    ?.candidateActivationCount
                ??
                row
                    ?.match
                    ?.deathCandidateCount
            )
            ??
            0,

        targetAttributedMeleeWithin1s:
            [],

        nearestTargetAttributedMelee:
            null,

        playerProximity:
            null
    };
}


// ============================================================
// NORMALIZE MELEE
// ============================================================

function normalizeMelee(
    row,
    index
) {

    const rawTime =
        firstFinite(
            [

                row
                    ?.attack_trigger_time,

                row
                    ?.attackTriggerTime,

                row
                    ?.attack_time,

                row
                    ?.attackTime,

                row
                    ?.trigger_time,

                row
                    ?.triggerTime,

                row
                    ?.matchTimeSeconds,

                row
                    ?.timeSeconds,

                row
                    ?.time
            ]
        );


    const rawTick =
        firstFinite(
            [

                row
                    ?.attack_trigger_tick,

                row
                    ?.attackTriggerTick,

                row
                    ?.tick,

                row
                    ?.demoTick
            ]
        );


    const targetEntityIndex =
        extractTargetEntityIndex(
            row
                ?.target_if_attributed
            ??
            row
                ?.targetIfAttributed
            ??
            row
                ?.target
            ??
            row
                ?.targetEntity
            ??
            null
        );


    const playerName =
        firstString(
            [

                row
                    ?.player
                    ?.playerName,

                row
                    ?.player
                    ?.name,

                row
                    ?.playerName,

                typeof row?.player ===
                    'string'
                    ? row.player
                    : null
            ]
        );


    const playerTeam =
        firstFinite(
            [

                row
                    ?.player
                    ?.team,

                row
                    ?.team,

                row
                    ?.playerTeam
            ]
        );


    const attackType =
        String(
            row
                ?.attack_type
            ??
            row
                ?.attackType
            ??
            'UNKNOWN'
        );


    const hit =
        normalizeBoolean(
            row?.hit
        );


    const position =
        normalizePosition(
            row?.position
            ??
            row?.playerPosition
            ??
            row?.attackPosition
            ??
            null
        );


    if (
        rawTime ===
            null
        &&
        rawTick ===
            null
    ) {

        return null;
    }


    return {

        meleeIndex:
            index,

        rawTime,

        rawTick,

        matchTimeSeconds:
            null,

        targetEntityIndex,

        playerName,

        playerTeam,

        attackType,

        hit,

        position
    };
}


// ============================================================
// TARGET ENTITY INDEX
// ============================================================

function extractTargetEntityIndex(
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


    const direct =
        finite(
            value
        );


    if (
        direct !==
        null
    ) {

        return direct;
    }


    if (
        typeof value ===
        'string'
    ) {

        const match =
            value.match(
                /(?:entity|index|target)[^0-9]*(\d+)/i
            );


        if (
            match
        ) {

            return finite(
                match[1]
            );
        }


        return null;
    }


    if (
        typeof value ===
        'object'
    ) {

        const aliases =
            [

                'entityIndex',
                'entity_index',
                'targetEntityIndex',
                'target_entity_index',
                'index',
                'targetIndex',
                'target_index',
                'entity'
            ];


        for (
            const key
            of aliases
        ) {

            const candidate =
                finite(
                    value?.[
                        key
                    ]
                );


            if (
                candidate !==
                null
            ) {

                return candidate;
            }
        }


        for (
            const nestedKey
            of [
                'target',
                'entity',
                'victim'
            ]
        ) {

            if (
                value?.[
                    nestedKey
                ]
                &&
                value[
                    nestedKey
                ] !==
                value
            ) {

                const nested =
                    extractTargetEntityIndex(
                        value[
                            nestedKey
                        ]
                    );


                if (
                    nested !==
                    null
                ) {

                    return nested;
                }
            }
        }
    }


    return null;
}


// ============================================================
// FIND NEAREST OPPOSING PLAYER
// ============================================================

function findOpposingPlayerProximity(
    death
) {

    if (
        death.team !==
            2
        &&
        death.team !==
            3
    ) {

        return {

            resolved:
                false,

            reason:
                'INVALID_TROOPER_TEAM'
        };
    }


    const opposingTeam =
        death.team ===
            2
            ? 3
            : 2;


    const centerBucket =
        Math.round(
            death.timeSeconds *
            PLAYER_STATE_BUCKET_HZ
        );


    const nearestByPlayer =
        new Map();


    for (
        let offset =
            -PLAYER_STATE_SEARCH_BUCKETS;

        offset <=
            PLAYER_STATE_SEARCH_BUCKETS;

        offset++
    ) {

        const rows =
            playerBuckets.get(
                centerBucket +
                offset
            )
            ??
            [];


        for (
            const row
            of rows
        ) {

            if (
                row.team !==
                opposingTeam
            ) {

                continue;
            }


            const timeDelta =
                Math.abs(
                    row.timeSeconds -
                    death.timeSeconds
                );


            const existing =
                nearestByPlayer.get(
                    row.playerName
                );


            if (
                !existing
                ||
                timeDelta <
                    existing.timeDelta
            ) {

                nearestByPlayer.set(
                    row.playerName,
                    {

                        ...row,

                        timeDelta
                    }
                );
            }
        }
    }


    const candidates =
        [];


    for (
        const row
        of nearestByPlayer.values()
    ) {

        const distance3D =
            getDistance3D(
                death.position,
                row.position
            );


        const distanceXY =
            getDistanceXY(
                death.position,
                row.position
            );


        candidates.push({

            playerName:
                row.playerName,

            pawnEntityIndex:
                row.pawnEntityIndex,

            team:
                row.team,

            playerStateTimeSeconds:
                row.timeSeconds,

            absoluteTimeDeltaSeconds:
                row.timeDelta,

            distance3D,

            distanceXY,

            position:
                row.position
        });
    }


    candidates.sort(
        (
            a,
            b
        ) =>
            a.distance3D -
            b.distance3D
    );


    const nearest =
        candidates[
            0
        ]
        ??
        null;


    const withinThresholds =
        {};


    for (
        const threshold
        of PLAYER_DISTANCE_THRESHOLDS
    ) {

        withinThresholds[
            threshold
        ] =
            candidates.filter(
                row =>
                    row.distance3D <=
                    threshold
            ).length;
    }


    return {

        resolved:
            Boolean(
                nearest
            ),

        opposingTeam,

        nearestPlayer:
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
            null,

        opposingPlayersResolved:
            candidates.length,

        playersWithinThresholds:
            withinThresholds
    };
}


// ============================================================
// TARGET MELEE WINDOW
// ============================================================

function hasTargetMeleeWithin(
    death,
    windowSeconds
) {

    return death
        .targetAttributedMeleeWithin1s
        .some(
            row =>
                row.hit !==
                    false
                &&
                row.absoluteTimeDeltaSeconds <=
                    windowSeconds
        );
}


// ============================================================
// COMPACT EXAMPLE
// ============================================================

function compactDeathExample(
    death
) {

    return {

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

        candidateActivationCount:
            death.candidateActivationCount,

        nearestTargetAttributedMelee:
            death.nearestTargetAttributedMelee,

        playerProximity:
            {

                nearestDistance3D:
                    death
                        ?.playerProximity
                        ?.nearestDistance3D
                    ??
                    null,

                nearestDistanceXY:
                    death
                        ?.playerProximity
                        ?.nearestDistanceXY
                    ??
                    null,

                nearestPlayer:
                    death
                        ?.playerProximity
                        ?.nearestPlayer
                    ??
                    null
            }
    };
}


// ============================================================
// NEAREST BY TIME
// ============================================================

function findNearestByTime(
    rows,
    timeSeconds
) {

    let best =
        null;


    let bestDelta =
        Infinity;


    for (
        const row
        of rows
    ) {

        const delta =
            Math.abs(
                row.timeSeconds -
                timeSeconds
            );


        if (
            delta <
            bestDelta
        ) {

            bestDelta =
                delta;


            best =
                row;
        }
    }


    return best;
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
// COUNTS
// ============================================================

function countBy(
    rows,
    keyFn
) {

    const map =
        new Map();


    for (
        const row
        of rows
    ) {

        increment(
            map,
            keyFn(
                row
            )
        );
    }


    return map;
}


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
                b[1] -
                a[1]
        )
    );
}


function mapToNumericKeyObject(
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
                Number(
                    a[0]
                )
                -
                Number(
                    b[0]
                )
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


function firstFinite(
    values
) {

    for (
        const value
        of values
    ) {

        const number =
            finite(
                value
            );


        if (
            number !==
            null
        ) {

            return number;
        }
    }


    return null;
}


function firstString(
    values
) {

    for (
        const value
        of values
    ) {

        if (
            typeof value ===
                'string'
        &&
            value.length >
                0
        ) {

            return value;
        }
    }


    return null;
}


function normalizeBoolean(
    value
) {

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


    return null;
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


function safeRatio(
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
    `${minutes}:${
        String(
            secs
        ).padStart(
            2,
            '0'
        )
    }`;
}