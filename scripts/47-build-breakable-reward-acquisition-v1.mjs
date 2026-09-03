import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    createWriteStream
} from 'node:fs';

import {
    dirname,
    resolve
} from 'node:path';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


const TICK_RATE =
    64;


// ------------------------------------------------------------
// Empirically observed pickup lifetimes.
//
// Prior pickup lifecycle validation showed:
//
// CCitadel_Pickup_Gold      = 300 seconds
// CCitadel_Pickup_Modifier  = 30 seconds
// ------------------------------------------------------------

const CRATE_PICKUP_LIFETIME_SECONDS =
    300;


const STATUE_PICKUP_LIFETIME_SECONDS =
    30;


// Allow a few ticks of timer jitter.
const EXPIRY_TOLERANCE_SECONDS =
    3 /
    TICK_RATE;


// ------------------------------------------------------------
// Collector geometry.
//
// This is NOT asserted to be the engine's literal collision
// radius.
//
// It is the current replay-calibrated threshold for player
// pawn center -> pickup coordinate at the disappearance event.
// ------------------------------------------------------------

const COLLECTOR_DISTANCE_3D =
    128;


// Additional diagnostic thresholds.
const DIAGNOSTIC_THRESHOLDS =
    [
        96,
        112,
        128,
        144,
        160
    ];


// ============================================================
// PATHS
// ============================================================

const diagnosticPath =
    resolve(
        'output',
        replayName,
        'breakable_reward_collection_diagnostic.json'
    );


const catalogPath =
    resolve(
        'output',
        replayName,
        'breakable_catalog_v1.json'
    );


const outputJsonlPath =
    resolve(
        'output',
        replayName,
        'breakable_reward_acquisition_v1.jsonl'
    );


const outputSummaryPath =
    resolve(
        'output',
        replayName,
        'breakable_reward_acquisition_summary_v1.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        diagnosticPath,
        catalogPath
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
// LOAD
// ============================================================

const diagnostic =
    JSON.parse(
        readFileSync(
            diagnosticPath,
            'utf8'
        )
    );


const catalog =
    JSON.parse(
        readFileSync(
            catalogPath,
            'utf8'
        )
    );


const rewardRows =
    diagnostic.rewardRows
    ??
    [];


const matchDurationSeconds =
    finite(
        catalog
            ?.timing
            ?.matchDurationSeconds
    );


// ============================================================
// OUTPUT
// ============================================================

mkdirSync(
    dirname(
        outputJsonlPath
    ),
    {
        recursive: true
    }
);


const outputStream =
    createWriteStream(
        outputJsonlPath,
        {
            encoding:
                'utf8'
        }
    );


// ============================================================
// COUNTERS
// ============================================================

const counts =
    {

        totalRewards:
            0,

        crateSoulRewards:
            0,

        statueModifierRewards:
            0,

        collectedHighConfidence:
            0,

        expiredUncollected:
            0,

        ambiguousMultiplePlayers:
            0,

        earlyDeactivationNoClosePlayer:
            0,

        rightCensored:
            0,

        unresolvedLifecycle:
            0
    };


const byRewardType =
    {};


const byCollector =
    new Map();


const thresholdDiagnostics =
    new Map();


for (
    const threshold
    of DIAGNOSTIC_THRESHOLDS
) {

    thresholdDiagnostics.set(
        threshold,
        {

            threshold,

            eligibleEarlyDeactivations:
                0,

            unique:
                0,

            multiple:
                0,

            none:
                0
        }
    );
}


// ============================================================
// BREAKER / COLLECTOR COUNTERS
// ============================================================

let collectedWithKnownBreaker =
    0;


let sameBreakerCollector =
    0;


let differentBreakerCollector =
    0;


const differentBreakerCollectorExamples =
    [];


// ============================================================
// TYPE-SPECIFIC VALUE
// ============================================================

let confirmedCrateSoulPickups =
    0;


let confirmedCrateSoulsAcquired =
    0;


let expiredCrateSoulPickups =
    0;


let expiredCrateSoulValue =
    0;


let confirmedStatueBuffPickups =
    0;


let expiredStatueBuffPickups =
    0;


// ============================================================
// DELAY DISTRIBUTIONS
// ============================================================

const confirmedCollectionDelays =
    [];


const confirmedCrateDelays =
    [];


const confirmedStatueDelays =
    [];


const confirmedCollectorDistances =
    [];


// ============================================================
// PROCESS REWARDS
// ============================================================

for (
    const row
    of rewardRows
) {

    counts.totalRewards++;


    if (
        row.rewardType ===
        'SOULS'
    ) {

        counts.crateSoulRewards++;

    } else if (
        row.rewardType ===
        'PERMANENT_MODIFIER'
    ) {

        counts.statueModifierRewards++;
    }


    incrementNested(
        byRewardType,
        row.rewardType
        ??
        'UNKNOWN',
        'total'
    );


    const lifetime =
        getPickupLifetime(
            row
        );


    const transition =
        row.collectionTransition
        ??
        null;


    const delay =
        finite(
            row.secondsUntilDeactivation
        );


    // ========================================================
    // NO DEACTIVATION OBSERVED
    // ========================================================

    if (
        !transition
        ||
        delay ===
            null
    ) {

        const expiryWouldOccurAt =
            (
                finite(
                    row.breakTimeSeconds
                ) !==
                    null
                &&
                lifetime !==
                    null
            )

                ? row.breakTimeSeconds +
                    lifetime

                : null;


        const rightCensored =
            (
                expiryWouldOccurAt !==
                    null
                &&
                matchDurationSeconds !==
                    null
                &&
                expiryWouldOccurAt >
                    matchDurationSeconds
            );


        const status =
            rightCensored

                ? 'RIGHT_CENSORED'

                : 'LIFECYCLE_UNRESOLVED';


        if (
            rightCensored
        ) {

            counts.rightCensored++;

        } else {

            counts.unresolvedLifecycle++;
        }


        incrementNested(
            byRewardType,
            row.rewardType
            ??
            'UNKNOWN',
            status
        );


        writeResult({

            row,

            status,

            confidence:
                'UNKNOWN',

            collector:
                null,

            lifetime,

            expiryWouldOccurAt,

            candidatePlayers:
                []
        });


        continue;
    }


    // ========================================================
    // NATURAL EXPIRATION
    // ========================================================

    const isNaturalExpiry =
        lifetime !==
            null
        &&
        Math.abs(
            delay -
            lifetime
        )
        <=
        EXPIRY_TOLERANCE_SECONDS;


    if (
        isNaturalExpiry
    ) {

        counts.expiredUncollected++;


        incrementNested(
            byRewardType,
            row.rewardType
            ??
            'UNKNOWN',
            'EXPIRED_UNCOLLECTED'
        );


        if (
            row.rewardType ===
            'SOULS'
        ) {

            expiredCrateSoulPickups++;


            expiredCrateSoulValue +=
                finite(
                    row.goldReward
                )
                ??
                0;
        }


        if (
            row.rewardType ===
            'PERMANENT_MODIFIER'
        ) {

            expiredStatueBuffPickups++;
        }


        writeResult({

            row,

            status:
                'EXPIRED_UNCOLLECTED',

            confidence:
                'HIGH_LIFECYCLE',

            collector:
                null,

            lifetime,

            expiryWouldOccurAt:
                row.breakTimeSeconds +
                lifetime,

            candidatePlayers:
                row.candidatePlayers
                ??
                []
        });


        continue;
    }


    // ========================================================
    // EARLY DEACTIVATION
    //
    // This is the only class eligible for physical collector
    // attribution.
    // ========================================================

    const candidates =
        (
            row.candidatePlayers
            ??
            []
        )
            .filter(
                player =>
                    Number.isFinite(
                        finite(
                            player.distance3D
                        )
                    )
            );


    // --------------------------------------------------------
    // Diagnostic threshold sensitivity
    // --------------------------------------------------------

    for (
        const threshold
        of DIAGNOSTIC_THRESHOLDS
    ) {

        const diagnosticRow =
            thresholdDiagnostics.get(
                threshold
            );


        diagnosticRow
            .eligibleEarlyDeactivations++;


        const inside =
            candidates.filter(
                player =>
                    player.distance3D <=
                    threshold
            );


        if (
            inside.length ===
            0
        ) {

            diagnosticRow.none++;

        } else if (
            inside.length ===
            1
        ) {

            diagnosticRow.unique++;

        } else {

            diagnosticRow.multiple++;
        }
    }


    const closeCandidates =
        candidates.filter(
            player =>
                player.distance3D <=
                COLLECTOR_DISTANCE_3D
        );


    // ========================================================
    // UNIQUE PHYSICAL COLLECTOR
    // ========================================================

    if (
        closeCandidates.length ===
        1
    ) {

        const collector =
            closeCandidates[0];


        counts.collectedHighConfidence++;


        incrementNested(
            byRewardType,
            row.rewardType
            ??
            'UNKNOWN',
            'COLLECTED_HIGH_CONFIDENCE'
        );


        confirmedCollectionDelays.push(
            delay
        );


        confirmedCollectorDistances.push(
            collector.distance3D
        );


        if (
            row.rewardType ===
            'SOULS'
        ) {

            confirmedCrateSoulPickups++;


            confirmedCrateSoulsAcquired +=
                finite(
                    row.goldReward
                )
                ??
                0;


            confirmedCrateDelays.push(
                delay
            );
        }


        if (
            row.rewardType ===
            'PERMANENT_MODIFIER'
        ) {

            confirmedStatueBuffPickups++;


            confirmedStatueDelays.push(
                delay
            );
        }


        // ----------------------------------------------------
        // Collector player summary
        // ----------------------------------------------------

        const playerSummary =
            getCollectorSummary(
                collector.playerName
            );


        playerSummary.totalRewardsCollected++;


        if (
            row.rewardType ===
            'SOULS'
        ) {

            playerSummary.crateSoulPickups++;


            playerSummary.crateSoulsAcquired +=
                finite(
                    row.goldReward
                )
                ??
                0;
        }


        if (
            row.rewardType ===
            'PERMANENT_MODIFIER'
        ) {

            playerSummary.statueBuffPickups++;


            increment(
                playerSummary.modifierSubclassCounts,
                row.modifierSubclassId
                ??
                'UNKNOWN'
            );
        }


        // ----------------------------------------------------
        // Breaker vs collector
        // ----------------------------------------------------

        const breakerName =
            row
                ?.canonicalBreaker
                ?.player
                ?.playerName
            ??
            null;


        const breakerKnown =
            row
                ?.canonicalBreaker
                ?.status ===
                'ATTRIBUTED'
            &&
            Boolean(
                breakerName
            );


        if (
            breakerKnown
        ) {

            collectedWithKnownBreaker++;


            if (
                breakerName ===
                collector.playerName
            ) {

                sameBreakerCollector++;


                playerSummary
                    .collectedOwnBreakReward++;

            } else {

                differentBreakerCollector++;


                playerSummary
                    .collectedOtherPlayersBreakReward++;


                if (
                    differentBreakerCollectorExamples.length <
                    50
                ) {

                    differentBreakerCollectorExamples.push({

                        breakKey:
                            row.breakKey,

                        rewardType:
                            row.rewardType,

                        breaker:
                            breakerName,

                        collector:
                            collector.playerName,

                        pickupDelaySeconds:
                            delay,

                        collectorDistance3D:
                            collector.distance3D,

                        goldReward:
                            row.goldReward
                            ??
                            null,

                        modifierSubclassId:
                            row.modifierSubclassId
                            ??
                            null
                    });
                }
            }
        }


        writeResult({

            row,

            status:
                'COLLECTED_HIGH_CONFIDENCE',

            confidence:
                'HIGH_GEOMETRIC_LIFECYCLE',

            collector,

            lifetime,

            expiryWouldOccurAt:
                row.breakTimeSeconds +
                lifetime,

            candidatePlayers:
                closeCandidates
        });


        continue;
    }


    // ========================================================
    // MULTIPLE PLAYERS WITHIN COLLECTION BAND
    // ========================================================

    if (
        closeCandidates.length >
        1
    ) {

        counts.ambiguousMultiplePlayers++;


        incrementNested(
            byRewardType,
            row.rewardType
            ??
            'UNKNOWN',
            'AMBIGUOUS_MULTIPLE_PLAYERS'
        );


        writeResult({

            row,

            status:
                'AMBIGUOUS_MULTIPLE_PLAYERS',

            confidence:
                'AMBIGUOUS',

            collector:
                null,

            lifetime,

            expiryWouldOccurAt:
                row.breakTimeSeconds +
                lifetime,

            candidatePlayers:
                closeCandidates
        });


        continue;
    }


    // ========================================================
    // EARLY DEACTIVATION, BUT NO PLAYER WITHIN 128
    //
    // Do NOT call this an expiration.
    // Do NOT infer a collector.
    // ========================================================

    counts.earlyDeactivationNoClosePlayer++;


    incrementNested(
        byRewardType,
        row.rewardType
        ??
        'UNKNOWN',
        'EARLY_DEACTIVATION_UNRESOLVED'
    );


    writeResult({

        row,

        status:
            'EARLY_DEACTIVATION_UNRESOLVED',

        confidence:
            'UNKNOWN',

        collector:
            null,

        lifetime,

        expiryWouldOccurAt:
            row.breakTimeSeconds +
            lifetime,

        candidatePlayers:
            candidates.slice(
                0,
                5
            )
    });
}


// ============================================================
// CLOSE STREAM
// ============================================================

await new Promise(
    (
        resolvePromise,
        rejectPromise
    ) => {

        outputStream.on(
            'error',
            rejectPromise
        );


        outputStream.end(
            resolvePromise
        );
    }
);


// ============================================================
// COLLECTOR SUMMARIES
// ============================================================

const collectors =
    [
        ...byCollector.values()
    ]
        .sort(
            (
                a,
                b
            ) =>
                b.totalRewardsCollected -
                a.totalRewardsCollected
                ||
                a.playerName.localeCompare(
                    b.playerName
                )
        );


// ============================================================
// VALIDATION
// ============================================================

const classifiedTotal =
    counts.collectedHighConfidence
    +
    counts.expiredUncollected
    +
    counts.ambiguousMultiplePlayers
    +
    counts.earlyDeactivationNoClosePlayer
    +
    counts.rightCensored
    +
    counts.unresolvedLifecycle;


const validation =
    {

        sourceRewardCount:
            {

                actual:
                    rewardRows.length,

                expected:
                    726,

                pass:
                    rewardRows.length ===
                    726
            },

        crateRewardCount:
            {

                actual:
                    counts.crateSoulRewards,

                expected:
                    587,

                pass:
                    counts.crateSoulRewards ===
                    587
            },

        statueRewardCount:
            {

                actual:
                    counts.statueModifierRewards,

                expected:
                    139,

                pass:
                    counts.statueModifierRewards ===
                    139
            },

        allRowsClassified:
            {

                actual:
                    classifiedTotal,

                expected:
                    rewardRows.length,

                pass:
                    classifiedTotal ===
                    rewardRows.length
            },

        highConfidenceCollectorsProduced:
            {

                actual:
                    counts.collectedHighConfidence,

                expected:
                    '>0',

                pass:
                    counts.collectedHighConfidence >
                    0
            },

        expirationsDetected:
            {

                actual:
                    counts.expiredUncollected,

                expected:
                    '>0',

                pass:
                    counts.expiredUncollected >
                    0
            },

        collectorThreshold:
            {

                actual:
                    COLLECTOR_DISTANCE_3D,

                expected:
                    128,

                pass:
                    COLLECTOR_DISTANCE_3D ===
                    128
            }
    };


const validationPass =
    Object
        .values(
            validation
        )
        .every(
            check =>
                check.pass
        );


// ============================================================
// SUMMARY
// ============================================================

const summary =
    {

        replay:
            replayName,

        version:
            'BREAKABLE_REWARD_ACQUISITION_V1',

        canonical:
            true,

        scope:
            'REWARD_ACQUISITION_ONLY',

        importantDistinctions:
            {

                break:
                    'Breakable destruction event.',

                rewardSpawn:
                    'Successful crate/statue reward roll creates a physical pickup.',

                collection:
                    'Physical pickup disappears before natural lifetime while exactly one player is within calibrated collection geometry.',

                expiration:
                    'Pickup reaches its exact natural lifetime and disappears without collection attribution.',

                breakerNotCollector:
                    'Breaker identity and collector identity are stored independently.'
            },

        constants:
            {

                cratePickupLifetimeSeconds:
                    CRATE_PICKUP_LIFETIME_SECONDS,

                statuePickupLifetimeSeconds:
                    STATUE_PICKUP_LIFETIME_SECONDS,

                expiryToleranceSeconds:
                    EXPIRY_TOLERANCE_SECONDS,

                collectorDistance3D:
                    COLLECTOR_DISTANCE_3D,

                collectorDistanceInterpretation:
                    'Replay-calibrated pawn-center to pickup-coordinate distance; not asserted to equal the literal game collision radius.'
            },

        counts,

        byRewardType,

        value:
            {

                confirmedCrateSoulPickups,

                confirmedCrateSoulsAcquired,

                expiredCrateSoulPickups,

                expiredCrateSoulValue,

                confirmedStatueBuffPickups,

                expiredStatueBuffPickups
            },

        breakerCollector:
            {

                collectedRewardsWithKnownBreaker:
                    collectedWithKnownBreaker,

                sameBreakerCollector,

                differentBreakerCollector,

                sameRate:
                    rate(
                        sameBreakerCollector,
                        collectedWithKnownBreaker
                    ),

                differentRate:
                    rate(
                        differentBreakerCollector,
                        collectedWithKnownBreaker
                    ),

                examples:
                    differentBreakerCollectorExamples
            },

        confirmedCollectionGeometry:
            {

                distance3D:
                    summarizeNumbers(
                        confirmedCollectorDistances
                    ),

                delaySeconds:
                    summarizeNumbers(
                        confirmedCollectionDelays
                    ),

                crateDelaySeconds:
                    summarizeNumbers(
                        confirmedCrateDelays
                    ),

                statueDelaySeconds:
                    summarizeNumbers(
                        confirmedStatueDelays
                    )
            },

        thresholdDiagnostics:
            [
                ...thresholdDiagnostics.values()
            ],

        collectors,

        validation:
            {

                pass:
                    validationPass,

                checks:
                    validation
            }
    };


// ============================================================
// WRITE SUMMARY
// ============================================================

writeFileSync(

    outputSummaryPath,

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
    '======================================='
);

console.log(
    'BREAKABLE REWARD ACQUISITION V1'
);

console.log(
    '======================================='
);

console.log('');

console.log(
    `Rewards: ${counts.totalRewards}`
);

console.log(
    `  crate souls: ${counts.crateSoulRewards}`
);

console.log(
    `  statue buffs: ${counts.statueModifierRewards}`
);

console.log('');

console.log(
    'CLASSIFICATION'
);

console.log(
    '--------------'
);

console.log(
    `Collected HIGH:              ${counts.collectedHighConfidence}`
);

console.log(
    `Expired uncollected:         ${counts.expiredUncollected}`
);

console.log(
    `Ambiguous multiple players: ${counts.ambiguousMultiplePlayers}`
);

console.log(
    `Early deactivate unresolved: ${counts.earlyDeactivationNoClosePlayer}`
);

console.log(
    `Right censored:              ${counts.rightCensored}`
);

console.log(
    `Lifecycle unresolved:        ${counts.unresolvedLifecycle}`
);

console.log('');

console.log(
    'CONFIRMED VALUE ACQUIRED'
);

console.log(
    '------------------------'
);

console.log(
    `Crate pickups: ${confirmedCrateSoulPickups}`
);

console.log(
    `Crate souls acquired: ${confirmedCrateSoulsAcquired}`
);

console.log(
    `Statue buffs acquired: ${confirmedStatueBuffPickups}`
);

console.log('');

console.log(
    'BREAKER vs COLLECTOR'
);

console.log(
    '--------------------'
);

console.log(
    `Known-breaker collected rows: ${collectedWithKnownBreaker}`
);

console.log(
    `Same player: ${sameBreakerCollector}`
);

console.log(
    `Different player: ${differentBreakerCollector}`
);

console.log(
    `Different rate: ${formatPercent(
        rate(
            differentBreakerCollector,
            collectedWithKnownBreaker
        )
    )}`
);

console.log('');

console.log(
    'THRESHOLD DIAGNOSTIC'
);

console.log(
    '--------------------'
);


for (
    const row
    of thresholdDiagnostics.values()
) {

    console.log(
        `<= ${
            String(
                row.threshold
            ).padStart(
                3
            )
        }  eligible=${
            String(
                row.eligibleEarlyDeactivations
            ).padStart(
                4
            )
        }  unique=${
            String(
                row.unique
            ).padStart(
                4
            )
        }  multiple=${
            String(
                row.multiple
            ).padStart(
                3
            )
        }  none=${
            String(
                row.none
            ).padStart(
                4
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
                34
            )
        } actual=${
            check.actual
        } expected=${
            check.expected
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
    `Events:\n${outputJsonlPath}`
);

console.log('');

console.log(
    `Summary:\n${outputSummaryPath}`
);

console.log('');


// ============================================================
// WRITE RESULT
// ============================================================

function writeResult({
    row,
    status,
    confidence,
    collector,
    lifetime,
    expiryWouldOccurAt,
    candidatePlayers
}) {

    const breaker =
        row.canonicalBreaker
        ??
        null;


    const breakerName =
        breaker
            ?.player
            ?.playerName
        ??
        null;


    const collectorName =
        collector
            ?.playerName
        ??
        null;


    const output =
        {

            schemaVersion:
                1,

            breakKey:
                row.breakKey,

            breakableEntityIndex:
                row.breakableEntityIndex,

            breakableType:
                row.breakableType,

            breakTick:
                row.breakTick,

            breakTimeSeconds:
                row.breakTimeSeconds,

            breakClock:
                row.breakClock,

            reward:
                {

                    rewardType:
                        row.rewardType,

                    pickupClass:
                        row.pickupClass,

                    pickupEntityIndex:
                        row.pickupEntityIndex,

                    goldReward:
                        row.goldReward
                        ??
                        null,

                    modifierSubclassId:
                        row.modifierSubclassId
                        ??
                        null,

                    lifetimeSeconds:
                        lifetime
                },

            breaker:
                breaker,

            acquisition:
                {

                    status,

                    confidence,

                    deactivationObserved:
                        Boolean(
                            row.collectionTransition
                        ),

                    deactivationTick:
                        row
                            ?.collectionTransition
                            ?.tick
                        ??
                        null,

                    deactivationTimeSeconds:
                        row
                            ?.collectionTransition
                            ?.timeSeconds
                        ??
                        null,

                    secondsAfterSpawn:
                        row.secondsUntilDeactivation
                        ??
                        null,

                    expectedNaturalExpiryTimeSeconds:
                        expiryWouldOccurAt,

                    collector:
                        collector
                        ? {

                            playerName:
                                collector.playerName,

                            distance3D:
                                collector.distance3D,

                            distanceXY:
                                collector.distanceXY,

                            verticalDistance:
                                collector.verticalDistance,

                            interpolatedPosition:
                                collector.interpolatedPosition,

                            netWorthBefore:
                                collector.netWorthBefore,

                            netWorthAfter:
                                collector.netWorthAfter,

                            netWorthDelta:
                                collector.netWorthDelta
                        }
                        : null,

                    closeCandidatePlayers:
                        candidatePlayers,

                    breakerEqualsCollector:
                        (
                            breakerName
                            &&
                            collectorName
                        )
                            ? breakerName ===
                                collectorName
                            : null
                }
        };


    outputStream.write(
        JSON.stringify(
            output
        )
        +
        '\n'
    );
}


// ============================================================
// PICKUP LIFETIME
// ============================================================

function getPickupLifetime(
    row
) {

    if (
        row.rewardType ===
        'SOULS'
        ||
        row.pickupClass ===
        'CCitadel_Pickup_Gold'
    ) {

        return CRATE_PICKUP_LIFETIME_SECONDS;
    }


    if (
        row.rewardType ===
        'PERMANENT_MODIFIER'
        ||
        row.pickupClass ===
        'CCitadel_Pickup_Modifier'
    ) {

        return STATUE_PICKUP_LIFETIME_SECONDS;
    }


    return null;
}


// ============================================================
// COLLECTOR SUMMARY
// ============================================================

function getCollectorSummary(
    playerName
) {

    if (
        byCollector.has(
            playerName
        )
    ) {

        return byCollector.get(
            playerName
        );
    }


    const summary =
        {

            playerName,

            totalRewardsCollected:
                0,

            crateSoulPickups:
                0,

            crateSoulsAcquired:
                0,

            statueBuffPickups:
                0,

            modifierSubclassCounts:
                {},

            collectedOwnBreakReward:
                0,

            collectedOtherPlayersBreakReward:
                0
        };


    byCollector.set(
        playerName,
        summary
    );


    return summary;
}


// ============================================================
// COUNTERS
// ============================================================

function increment(
    object,
    key
) {

    const normalized =
        String(
            key
            ??
            'UNKNOWN'
        );


    object[
        normalized
    ] =
        (
            object[
                normalized
            ]
            ??
            0
        )
        +
        1;
}


function incrementNested(
    object,
    first,
    second
) {

    if (
        !object[
            first
        ]
    ) {

        object[
            first
        ] =
            {};
    }


    increment(
        object[
            first
        ],
        second
    );
}


// ============================================================
// NUMBERS
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