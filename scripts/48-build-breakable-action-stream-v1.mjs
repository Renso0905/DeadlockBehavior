import {
    createReadStream,
    createWriteStream,
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


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


// ============================================================
// PATHS
// ============================================================

const catalogPath =
    resolve(
        'output',
        replayName,
        'breakable_catalog_v1.json'
    );


const acquisitionPath =
    resolve(
        'output',
        replayName,
        'breakable_reward_acquisition_v1.jsonl'
    );


const resourceFeaturesPath =
    resolve(
        'output',
        replayName,
        'behavioral_resource_features_v01.jsonl'
    );


const outputJsonlPath =
    resolve(
        'output',
        replayName,
        'breakable_action_stream_v1.jsonl'
    );


const outputSummaryPath =
    resolve(
        'output',
        replayName,
        'breakable_action_stream_summary_v1.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        catalogPath,
        acquisitionPath,
        resourceFeaturesPath
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
// LOAD CATALOG
// ============================================================

const catalog =
    JSON.parse(
        readFileSync(
            catalogPath,
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
// LOAD ACQUISITION EVENTS
// ============================================================

const acquisitionByBreakKey =
    new Map();


let acquisitionRows =
    0;


let duplicateAcquisitionKeys =
    0;


const acquisitionReader =
    readline.createInterface({

        input:
            createReadStream(
                acquisitionPath,
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
    of acquisitionReader
) {

    if (
        !line.trim()
    ) {

        continue;
    }


    let row;


    try {

        row =
            JSON.parse(
                line
            );

    } catch {

        continue;
    }


    acquisitionRows++;


    const breakKey =
        row.breakKey
        ??
        null;


    if (
        !breakKey
    ) {

        continue;
    }


    if (
        acquisitionByBreakKey.has(
            breakKey
        )
    ) {

        duplicateAcquisitionKeys++;
    }


    acquisitionByBreakKey.set(
        breakKey,
        row
    );
}


// ============================================================
// LOAD RESOURCE-EXPOSURE FEATURES
//
// Multiple players can have an episode associated with the
// same break event.
//
// We preserve all such rows as environmental context but NEVER
// use proximity to infer an unknown breaker.
// ============================================================

const exposureByBreakKey =
    new Map();


let resourceFeatureRows =
    0;


let resourceFeatureBreakRows =
    0;


const featureReader =
    readline.createInterface({

        input:
            createReadStream(
                resourceFeaturesPath,
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
    of featureReader
) {

    if (
        !line.trim()
    ) {

        continue;
    }


    let row;


    try {

        row =
            JSON.parse(
                line
            );

    } catch {

        continue;
    }


    resourceFeatureRows++;


    if (
        row.objectKind !==
        'BREAKABLE'
    ) {

        continue;
    }


    const breakKey =
        row
            ?.action
            ?.breakKey
        ??
        null;


    if (
        !breakKey
    ) {

        continue;
    }


    resourceFeatureBreakRows++;


    if (
        !exposureByBreakKey.has(
            breakKey
        )
    ) {

        exposureByBreakKey.set(
            breakKey,
            []
        );
    }


    exposureByBreakKey
        .get(
            breakKey
        )
        .push(
            row
        );
}


// ============================================================
// OUTPUT STREAM
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
// GLOBAL COUNTS
// ============================================================

const counts =
    {

        totalBreaks:
            0,

        cratesBroken:
            0,

        statuesBroken:
            0,

        attributedBreaks:
            0,

        unattributedBreaks:
            0,

        meleeBreaks:
            0,

        bulletBreaks:
            0,

        ambiguousBulletBreaks:
            0,

        otherBreakerMethods:
            0,

        rewardRollSuccess:
            0,

        rewardRollFailure:
            0,

        successfulRewardRowsMatched:
            0,

        successfulRewardRowsMissing:
            0,

        breakerHadBroadExposure:
            0,

        breakerHadCloseAccess:
            0,

        breakerHadCoreAccess:
            0,

        attributedBreaksWithoutExposure:
            0,

        meleeBreaksWithoutExposure:
            0,

        bulletBreaksWithoutExposure:
            0
    };


// ============================================================
// ACQUISITION STATUS COUNTS
// ============================================================

const acquisitionStatusCounts =
    {};


// ============================================================
// ECONOMIC COUNTS
// ============================================================

const economy =
    {

        crateSoulRewardSpawns:
            0,

        crateSoulValueGenerated:
            0,

        crateSoulPickupsConfirmed:
            0,

        crateSoulValueConfirmedAcquired:
            0,

        crateSoulPickupsExpired:
            0,

        crateSoulValueExpired:
            0,

        crateSoulValueUnknownOutcome:
            0,

        statueBuffSpawns:
            0,

        statueBuffsConfirmedAcquired:
            0,

        statueBuffsExpired:
            0,

        statueBuffsUnknownOutcome:
            0
    };


// ============================================================
// PLAYER SUMMARIES
// ============================================================

const playerMap =
    new Map();


// ============================================================
// BREAKER/COLLECTOR CROSS-PLAYER EVENTS
// ============================================================

const crossPlayerCollections =
    [];


// ============================================================
// PROCESS ALL BREAK EVENTS
// ============================================================

const breakEvents =
    catalog.breakEvents
    ??
    [];


for (
    const event
    of breakEvents
) {

    counts.totalBreaks++;


    const breakKey =
        event.breakKey
        ??
        `${
            event.entityIndex
            ??
            'UNKNOWN'
        }|${
            event.breakTick
            ??
            'UNKNOWN'
        }`;


    const type =
        event.type
        ??
        'UNKNOWN';


    if (
        type ===
        'CRATE'
    ) {

        counts.cratesBroken++;
    }


    if (
        type ===
        'GOLDEN_STATUE'
    ) {

        counts.statuesBroken++;
    }


    // ========================================================
    // BREAKER
    // ========================================================

    const canonicalBreaker =
        event.canonicalBreaker
        ??
        null;


    const breakerStatus =
        canonicalBreaker
            ?.status
        ??
        'UNKNOWN';


    const breakerMethod =
        canonicalBreaker
            ?.method
        ??
        'UNKNOWN';


    const breakerPlayer =
        canonicalBreaker
            ?.player
        ??
        null;


    const breakerName =
        breakerPlayer
            ?.playerName
        ??
        null;


    const attributed =
        (
            breakerStatus ===
            'ATTRIBUTED'
            &&
            Boolean(
                breakerName
            )
        );


    if (
        attributed
    ) {

        counts.attributedBreaks++;

    } else {

        counts.unattributedBreaks++;
    }


    if (
        breakerMethod ===
        'MELEE_DIRECT'
    ) {

        counts.meleeBreaks++;

    } else if (
        breakerMethod ===
        'BULLET_RAY'
    ) {

        counts.bulletBreaks++;

    } else if (
        breakerMethod ===
        'BULLET_RAY_MULTIPLE_PLAYERS'
    ) {

        counts.ambiguousBulletBreaks++;

    } else if (
        attributed
    ) {

        counts.otherBreakerMethods++;
    }


    // ========================================================
    // EXPOSURE CONTEXT
    // ========================================================

    const exposureRows =
        exposureByBreakKey.get(
            breakKey
        )
        ??
        [];


    const breakerExposure =
        attributed

            ? (
                exposureRows.find(
                    row =>
                        row.playerName ===
                        breakerName
                )
                ??
                null
            )

            : null;


    const breakerBroadExposure =
        breakerExposure !==
        null;


    const breakerCloseAccess =
        breakerExposure
            ?.spatialBands
            ?.closeAccess ===
        true;


    const breakerCoreAccess =
        (
            breakerExposure
                ?.spatialBands
                ?.coreAccess ===
            true
        );


    if (
        attributed
    ) {

        if (
            breakerBroadExposure
        ) {

            counts.breakerHadBroadExposure++;

        } else {

            counts.attributedBreaksWithoutExposure++;
        }


        if (
            breakerCloseAccess
        ) {

            counts.breakerHadCloseAccess++;
        }


        if (
            breakerCoreAccess
        ) {

            counts.breakerHadCoreAccess++;
        }


        if (
            !breakerBroadExposure
            &&
            breakerMethod ===
                'MELEE_DIRECT'
        ) {

            counts.meleeBreaksWithoutExposure++;
        }


        if (
            !breakerBroadExposure
            &&
            breakerMethod ===
                'BULLET_RAY'
        ) {

            counts.bulletBreaksWithoutExposure++;
        }
    }


    // ========================================================
    // REWARD ROLL
    // ========================================================

    const reward =
        event.rewardOutcome
        ??
        {};


    const rewardDropped =
        reward.dropped ===
        true;


    if (
        rewardDropped
    ) {

        counts.rewardRollSuccess++;

    } else {

        counts.rewardRollFailure++;
    }


    const rewardType =
        reward.rewardType
        ??
        null;


    const goldReward =
        finite(
            reward.goldReward
        );


    const modifierSubclassId =
        serialize(
            reward.modifierSubclassId
        );


    // ========================================================
    // ACQUISITION
    // ========================================================

    const acquisition =
        rewardDropped

            ? (
                acquisitionByBreakKey.get(
                    breakKey
                )
                ??
                null
            )

            : null;


    let acquisitionStatus;


    let acquisitionConfidence;


    let collector =
        null;


    let collectorName =
        null;


    let breakerEqualsCollector =
        null;


    if (
        !rewardDropped
    ) {

        acquisitionStatus =
            'NO_REWARD_SPAWN';


        acquisitionConfidence =
            'NOT_APPLICABLE';


    } else if (
        !acquisition
    ) {

        acquisitionStatus =
            'MISSING_ACQUISITION_ROW';


        acquisitionConfidence =
            'UNKNOWN';


        counts.successfulRewardRowsMissing++;


    } else {

        counts.successfulRewardRowsMatched++;


        acquisitionStatus =
            acquisition
                ?.acquisition
                ?.status
            ??
            'UNKNOWN';


        acquisitionConfidence =
            acquisition
                ?.acquisition
                ?.confidence
            ??
            'UNKNOWN';


        collector =
            acquisition
                ?.acquisition
                ?.collector
            ??
            null;


        collectorName =
            collector
                ?.playerName
            ??
            null;


        breakerEqualsCollector =
            acquisition
                ?.acquisition
                ?.breakerEqualsCollector
            ??
            null;
    }


    increment(
        acquisitionStatusCounts,
        acquisitionStatus
    );


    // ========================================================
    // REALIZED VALUE
    // ========================================================

    let generatedSoulValue =
        0;


    let realizedSoulValue =
        null;


    let expiredSoulValue =
        0;


    let generatedStatueBuff =
        false;


    let realizedStatueBuff =
        null;


    let expiredStatueBuff =
        false;


    // --------------------------------------------------------
    // CRATE SOUL REWARD
    // --------------------------------------------------------

    if (
        rewardDropped
        &&
        rewardType ===
        'SOULS'
    ) {

        economy.crateSoulRewardSpawns++;


        generatedSoulValue =
            goldReward
            ??
            0;


        economy.crateSoulValueGenerated +=
            generatedSoulValue;


        if (
            acquisitionStatus ===
            'COLLECTED_HIGH_CONFIDENCE'
        ) {

            realizedSoulValue =
                generatedSoulValue;


            economy.crateSoulPickupsConfirmed++;


            economy
                .crateSoulValueConfirmedAcquired +=
                generatedSoulValue;


        } else if (
            acquisitionStatus ===
            'EXPIRED_UNCOLLECTED'
        ) {

            realizedSoulValue =
                0;


            expiredSoulValue =
                generatedSoulValue;


            economy.crateSoulPickupsExpired++;


            economy.crateSoulValueExpired +=
                generatedSoulValue;


        } else {

            realizedSoulValue =
                null;


            economy.crateSoulValueUnknownOutcome +=
                generatedSoulValue;
        }
    }


    // --------------------------------------------------------
    // NO CRATE REWARD SPAWN
    //
    // Realized value is definitely zero.
    // --------------------------------------------------------

    if (
        !rewardDropped
        &&
        type ===
        'CRATE'
    ) {

        realizedSoulValue =
            0;
    }


    // --------------------------------------------------------
    // STATUE BUFF REWARD
    // --------------------------------------------------------

    if (
        rewardDropped
        &&
        rewardType ===
        'PERMANENT_MODIFIER'
    ) {

        generatedStatueBuff =
            true;


        economy.statueBuffSpawns++;


        if (
            acquisitionStatus ===
            'COLLECTED_HIGH_CONFIDENCE'
        ) {

            realizedStatueBuff =
                true;


            economy.statueBuffsConfirmedAcquired++;


        } else if (
            acquisitionStatus ===
            'EXPIRED_UNCOLLECTED'
        ) {

            realizedStatueBuff =
                false;


            expiredStatueBuff =
                true;


            economy.statueBuffsExpired++;


        } else {

            realizedStatueBuff =
                null;


            economy.statueBuffsUnknownOutcome++;
        }
    }


    // --------------------------------------------------------
    // NO STATUE REWARD SPAWN
    // --------------------------------------------------------

    if (
        !rewardDropped
        &&
        type ===
        'GOLDEN_STATUE'
    ) {

        realizedStatueBuff =
            false;
    }


    // ========================================================
    // BREAKER PLAYER SUMMARY
    // ========================================================

    if (
        attributed
    ) {

        const player =
            getPlayer(
                breakerName
            );


        player.asBreaker.knownBreaks++;


        if (
            type ===
            'CRATE'
        ) {

            player.asBreaker.cratesBroken++;
        }


        if (
            type ===
            'GOLDEN_STATUE'
        ) {

            player.asBreaker.statuesBroken++;
        }


        increment(
            player.asBreaker.methods,
            breakerMethod
        );


        if (
            breakerBroadExposure
        ) {

            player
                .asBreaker
                .breaksWithBroadExposure++;

        } else {

            player
                .asBreaker
                .breaksWithoutBroadExposure++;
        }


        if (
            breakerCloseAccess
        ) {

            player
                .asBreaker
                .breaksWithCloseAccess++;
        }


        if (
            breakerCoreAccess
        ) {

            player
                .asBreaker
                .breaksWithCoreAccess++;
        }


        if (
            rewardDropped
        ) {

            player
                .asBreaker
                .rewardSpawnsProduced++;
        }


        if (
            rewardType ===
            'SOULS'
            &&
            rewardDropped
        ) {

            player
                .asBreaker
                .crateSoulValueGenerated +=
                generatedSoulValue;
        }


        if (
            rewardType ===
            'PERMANENT_MODIFIER'
            &&
            rewardDropped
        ) {

            player
                .asBreaker
                .statueBuffsGenerated++;
        }


        if (
            acquisitionStatus ===
            'EXPIRED_UNCOLLECTED'
        ) {

            player
                .asBreaker
                .generatedRewardExpired++;
        }


        if (
            acquisitionStatus ===
            'COLLECTED_HIGH_CONFIDENCE'
        ) {

            if (
                collectorName ===
                breakerName
            ) {

                player
                    .asBreaker
                    .generatedRewardCollectedBySelf++;

            } else if (
                collectorName
            ) {

                player
                    .asBreaker
                    .generatedRewardCollectedByOther++;
            }
        }
    }


    // ========================================================
    // COLLECTOR PLAYER SUMMARY
    // ========================================================

    if (
        acquisitionStatus ===
        'COLLECTED_HIGH_CONFIDENCE'
        &&
        collectorName
    ) {

        const player =
            getPlayer(
                collectorName
            );


        player.asCollector.confirmedCollections++;


        if (
            rewardType ===
            'SOULS'
        ) {

            player.asCollector.crateSoulPickups++;


            player.asCollector.crateSoulsAcquired +=
                generatedSoulValue;
        }


        if (
            rewardType ===
            'PERMANENT_MODIFIER'
        ) {

            player.asCollector.statueBuffPickups++;


            increment(
                player
                    .asCollector
                    .modifierSubclassCounts,
                modifierSubclassId
                ??
                'UNKNOWN'
            );
        }


        if (
            attributed
        ) {

            if (
                breakerName ===
                collectorName
            ) {

                player
                    .asCollector
                    .collectedOwnBreakReward++;

            } else {

                player
                    .asCollector
                    .collectedOtherPlayersBreakReward++;


                crossPlayerCollections.push({

                    breakKey,

                    breakTimeSeconds:
                        finite(
                            event.breakMatchTimeSeconds
                        ),

                    breakClock:
                        event.breakClock
                        ??
                        null,

                    breakableType:
                        type,

                    rewardType,

                    breaker:
                        breakerName,

                    collector:
                        collectorName,

                    breakerMethod,

                    goldReward:
                        goldReward
                        ??
                        null,

                    modifierSubclassId:
                        modifierSubclassId
                        ??
                        null,

                    pickupDelaySeconds:
                        finite(
                            acquisition
                                ?.acquisition
                                ?.secondsAfterSpawn
                        ),

                    collectorDistance3D:
                        finite(
                            collector.distance3D
                        )
                });
            }
        }
    }


    // ========================================================
    // ALL PLAYER EXPOSURES AT THE BREAK
    //
    // This is contextual only.
    // ========================================================

    const nearbyExposurePlayers =
        exposureRows.map(
            row => ({

                playerName:
                    row.playerName,

                outcome:
                    row.outcome,

                broadExposure:
                    row
                        ?.spatialBands
                        ?.broadExposure ===
                    true,

                closeAccess:
                    row
                        ?.spatialBands
                        ?.closeAccess ===
                    true,

                coreAccess:
                    row
                        ?.spatialBands
                        ?.coreAccess ===
                    true,

                closestObserved:
                    row.closestObserved
                    ??
                    null
            })
        );


    // ========================================================
    // ACTION-COMPLETE ROW
    // ========================================================

    const outputRow =
        {

            schemaVersion:
                1,

            breakKey,

            breakable:
                {

                    entityIndex:
                        finite(
                            event.entityIndex
                        ),

                    type,

                    worldPosition:
                        event.worldPosition
                        ??
                        null
                },

            timing:
                {

                    breakTick:
                        finite(
                            event.breakTick
                        ),

                    breakTimeSeconds:
                        finite(
                            event.breakMatchTimeSeconds
                        ),

                    breakClock:
                        event.breakClock
                        ??
                        null
                },

            action:
                {

                    breakerStatus,

                    method:
                        breakerMethod,

                    confidence:
                        canonicalBreaker
                            ?.confidence
                        ??
                        null,

                    player:
                        breakerPlayer,

                    attributed,

                    actionComplete:
                        true
                },

            exposureContext:
                {

                    breakerBroadExposure:
                        attributed
                            ? breakerBroadExposure
                            : null,

                    breakerCloseAccess:
                        attributed
                            ? breakerCloseAccess
                            : null,

                    breakerCoreAccess:
                        attributed
                            ? breakerCoreAccess
                            : null,

                    breakerLongRangeAction:
                        (
                            attributed
                            &&
                            breakerMethod ===
                                'BULLET_RAY'
                            &&
                            !breakerBroadExposure
                        ),

                    breakerExposure:
                        breakerExposure
                        ? {

                            episodeIndex:
                                breakerExposure.episodeIndex,

                            outcome:
                                breakerExposure.outcome,

                            closestObserved:
                                breakerExposure.closestObserved,

                            spatialBands:
                                breakerExposure.spatialBands
                        }
                        : null,

                    playersWithExposureAtBreak:
                        nearbyExposurePlayers
                },

            rewardRoll:
                {

                    dropped:
                        rewardDropped,

                    rewardType,

                    pickupEntityIndex:
                        finite(
                            reward.pickupEntityIndex
                        ),

                    pickupClass:
                        reward.pickupClass
                        ??
                        null,

                    goldReward:
                        goldReward
                        ??
                        null,

                    modifierSubclassId:
                        modifierSubclassId
                        ??
                        null
                },

            acquisition:
                {

                    status:
                        acquisitionStatus,

                    confidence:
                        acquisitionConfidence,

                    collector:
                        collector,

                    breakerEqualsCollector,

                    secondsAfterSpawn:
                        acquisition
                            ?.acquisition
                            ?.secondsAfterSpawn
                        ??
                        null,

                    deactivationTimeSeconds:
                        acquisition
                            ?.acquisition
                            ?.deactivationTimeSeconds
                        ??
                        null,

                    expectedNaturalExpiryTimeSeconds:
                        acquisition
                            ?.acquisition
                            ?.expectedNaturalExpiryTimeSeconds
                        ??
                        null
                },

            value:
                {

                    generatedSoulValue,

                    realizedSoulValue,

                    expiredSoulValue,

                    generatedStatueBuff,

                    realizedStatueBuff,

                    expiredStatueBuff,

                    realizationKnown:
                        (
                            !rewardDropped
                            ||
                            acquisitionStatus ===
                                'COLLECTED_HIGH_CONFIDENCE'
                            ||
                            acquisitionStatus ===
                                'EXPIRED_UNCOLLECTED'
                        )
                }
        };


    outputStream.write(
        JSON.stringify(
            outputRow
        )
        +
        '\n'
    );
}


// ============================================================
// CLOSE OUTPUT STREAM
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
// PLAYER FINALIZATION
// ============================================================

const players =
    [
        ...playerMap.values()
    ];


for (
    const player
    of players
) {

    player.asBreaker.broadExposureRate =
        rate(
            player
                .asBreaker
                .breaksWithBroadExposure,
            player
                .asBreaker
                .knownBreaks
        );


    player.asBreaker.closeAccessRate =
        rate(
            player
                .asBreaker
                .breaksWithCloseAccess,
            player
                .asBreaker
                .knownBreaks
        );


    player.asCollector.otherPlayerRewardShare =
        rate(
            player
                .asCollector
                .collectedOtherPlayersBreakReward,
            player
                .asCollector
                .confirmedCollections
        );
}


players.sort(
    (
        a,
        b
    ) =>
        a.playerName.localeCompare(
            b.playerName
        )
);


// ============================================================
// TEST-REPLAY EXPECTATIONS
// ============================================================

const expected =
    replayName ===
        'test'

        ? {

            totalBreaks:
                1261,

            attributedBreaks:
                724,

            meleeBreaks:
                522,

            bulletBreaks:
                202,

            successfulRewards:
                726,

            acquisitionRows:
                726,

            confirmedCollectors:
                428,

            expiredRewards:
                139
        }

        : null;


// ============================================================
// VALIDATION
// ============================================================

const validation =
    {

        outputRows:
            {

                actual:
                    counts.totalBreaks,

                expected:
                    expected
                        ?.totalBreaks
                    ??
                    '>0',

                pass:
                    expected
                        ? counts.totalBreaks ===
                            expected.totalBreaks
                        : counts.totalBreaks >
                            0
            },

        attributedBreaks:
            {

                actual:
                    counts.attributedBreaks,

                expected:
                    expected
                        ?.attributedBreaks
                    ??
                    'source-dependent',

                pass:
                    expected
                        ? counts.attributedBreaks ===
                            expected.attributedBreaks
                        : true
            },

        meleeBreaks:
            {

                actual:
                    counts.meleeBreaks,

                expected:
                    expected
                        ?.meleeBreaks
                    ??
                    'source-dependent',

                pass:
                    expected
                        ? counts.meleeBreaks ===
                            expected.meleeBreaks
                        : true
            },

        bulletBreaks:
            {

                actual:
                    counts.bulletBreaks,

                expected:
                    expected
                        ?.bulletBreaks
                    ??
                    'source-dependent',

                pass:
                    expected
                        ? counts.bulletBreaks ===
                            expected.bulletBreaks
                        : true
            },

        successfulRewardRolls:
            {

                actual:
                    counts.rewardRollSuccess,

                expected:
                    expected
                        ?.successfulRewards
                    ??
                    'source-dependent',

                pass:
                    expected
                        ? counts.rewardRollSuccess ===
                            expected.successfulRewards
                        : true
            },

        acquisitionRowsLoaded:
            {

                actual:
                    acquisitionRows,

                expected:
                    expected
                        ?.acquisitionRows
                    ??
                    'source-dependent',

                pass:
                    expected
                        ? acquisitionRows ===
                            expected.acquisitionRows
                        : true
            },

        droppedRewardsMatchedToAcquisition:
            {

                actual:
                    counts.successfulRewardRowsMatched,

                expected:
                    counts.rewardRollSuccess,

                pass:
                    counts.successfulRewardRowsMatched ===
                    counts.rewardRollSuccess
            },

        droppedRewardsMissingAcquisition:
            {

                actual:
                    counts.successfulRewardRowsMissing,

                expected:
                    0,

                pass:
                    counts.successfulRewardRowsMissing ===
                    0
            },

        duplicateAcquisitionKeys:
            {

                actual:
                    duplicateAcquisitionKeys,

                expected:
                    0,

                pass:
                    duplicateAcquisitionKeys ===
                    0
            },

        confirmedCollectors:
            {

                actual:
                    acquisitionStatusCounts
                        .COLLECTED_HIGH_CONFIDENCE
                    ??
                    0,

                expected:
                    expected
                        ?.confirmedCollectors
                    ??
                    'source-dependent',

                pass:
                    expected
                        ? (
                            acquisitionStatusCounts
                                .COLLECTED_HIGH_CONFIDENCE
                            ??
                            0
                        ) ===
                            expected.confirmedCollectors
                        : true
            },

        expiredRewards:
            {

                actual:
                    acquisitionStatusCounts
                        .EXPIRED_UNCOLLECTED
                    ??
                    0,

                expected:
                    expected
                        ?.expiredRewards
                    ??
                    'source-dependent',

                pass:
                    expected
                        ? (
                            acquisitionStatusCounts
                                .EXPIRED_UNCOLLECTED
                            ??
                            0
                        ) ===
                            expected.expiredRewards
                        : true
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
            'BREAKABLE_ACTION_STREAM_V1',

        canonical:
            false,

        status:
            'WORKING_CANONICAL_BREAKABLE_DATASET',

        architecture:
            {

                actionComplete:
                    true,

                exposureComplete:
                    false,

                explanation:
                    'Every break event is represented regardless of whether the breaker entered a spatial exposure episode. This preserves long-range bullet farming.',

                breakerAttribution:
                    'Partial canonical attribution: MELEE_DIRECT and unique-player BULLET_RAY are retained; unknown events remain unknown.',

                rewardRoll:
                    'Successful and failed crate/statue reward rolls are represented separately from collection.',

                acquisition:
                    'COLLECTED_HIGH_CONFIDENCE and exact-timer EXPIRED_UNCOLLECTED are retained from the provisional single-replay collector calibration. Ambiguous and unresolved lifecycle outcomes remain unknown.'
            },

        source:
            {

                breakableCatalog:
                    catalogPath,

                rewardAcquisition:
                    acquisitionPath,

                resourceExposureFeatures:
                    resourceFeaturesPath
            },

        sourceRows:
            {

                breakEvents:
                    breakEvents.length,

                acquisitionRows,

                resourceFeatureRows,

                resourceFeatureBreakRows,

                uniqueBreakKeysWithExposure:
                    exposureByBreakKey.size
            },

        counts,

        acquisitionStatusCounts,

        economy,

        crossPlayerCollection:
            {

                count:
                    crossPlayerCollections.length,

                events:
                    crossPlayerCollections
            },

        players,

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
    '===================================='
);

console.log(
    'BREAKABLE ACTION STREAM V1'
);

console.log(
    '===================================='
);

console.log('');

console.log(
    'BREAK ACTIONS'
);

console.log(
    '-------------'
);

console.log(
    `Total breaks: ${counts.totalBreaks}`
);

console.log(
    `Attributed: ${counts.attributedBreaks}`
);

console.log(
    `Unattributed: ${counts.unattributedBreaks}`
);

console.log(
    `Melee: ${counts.meleeBreaks}`
);

console.log(
    `Bullet: ${counts.bulletBreaks}`
);

console.log('');

console.log(
    'EXPOSURE'
);

console.log(
    '--------'
);

console.log(
    `Attributed breaks with broad exposure: ${counts.breakerHadBroadExposure}`
);

console.log(
    `Attributed breaks without exposure: ${counts.attributedBreaksWithoutExposure}`
);

console.log(
    `Melee without exposure: ${counts.meleeBreaksWithoutExposure}`
);

console.log(
    `Bullet without exposure: ${counts.bulletBreaksWithoutExposure}`
);

console.log('');

console.log(
    'REWARD ROLLS'
);

console.log(
    '------------'
);

console.log(
    `Successful: ${counts.rewardRollSuccess}`
);

console.log(
    `Failed: ${counts.rewardRollFailure}`
);

console.log('');

console.log(
    'ACQUISITION STATUS'
);

console.log(
    '------------------'
);


for (
    const [
        status,
        count
    ]
    of Object.entries(
        acquisitionStatusCounts
    )
    .sort(
        (
            a,
            b
        ) =>
            b[1] -
            a[1]
    )
) {

    console.log(
        `${status.padEnd(
            34
        )} ${count}`
    );
}


console.log('');

console.log(
    'REALIZED ECONOMY'
);

console.log(
    '----------------'
);

console.log(
    `Crate soul value generated: ${economy.crateSoulValueGenerated}`
);

console.log(
    `Confirmed crate souls acquired: ${economy.crateSoulValueConfirmedAcquired}`
);

console.log(
    `Confirmed crate souls expired: ${economy.crateSoulValueExpired}`
);

console.log(
    `Crate soul value outcome unknown: ${economy.crateSoulValueUnknownOutcome}`
);

console.log('');

console.log(
    `Statue buffs spawned: ${economy.statueBuffSpawns}`
);

console.log(
    `Statue buffs confirmed acquired: ${economy.statueBuffsConfirmedAcquired}`
);

console.log(
    `Statue buffs expired: ${economy.statueBuffsExpired}`
);

console.log(
    `Statue buffs outcome unknown: ${economy.statueBuffsUnknownOutcome}`
);

console.log('');

console.log(
    `Cross-player confirmed collections: ${crossPlayerCollections.length}`
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
    `Action stream:\n${outputJsonlPath}`
);

console.log('');

console.log(
    `Summary:\n${outputSummaryPath}`
);

console.log('');


// ============================================================
// PLAYER SUMMARY
// ============================================================

function getPlayer(
    playerName
) {

    if (
        playerMap.has(
            playerName
        )
    ) {

        return playerMap.get(
            playerName
        );
    }


    const player =
        {

            playerName,

            asBreaker:
                {

                    knownBreaks:
                        0,

                    cratesBroken:
                        0,

                    statuesBroken:
                        0,

                    methods:
                        {},

                    breaksWithBroadExposure:
                        0,

                    breaksWithoutBroadExposure:
                        0,

                    breaksWithCloseAccess:
                        0,

                    breaksWithCoreAccess:
                        0,

                    rewardSpawnsProduced:
                        0,

                    crateSoulValueGenerated:
                        0,

                    statueBuffsGenerated:
                        0,

                    generatedRewardCollectedBySelf:
                        0,

                    generatedRewardCollectedByOther:
                        0,

                    generatedRewardExpired:
                        0
                },

            asCollector:
                {

                    confirmedCollections:
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
                }
        };


    playerMap.set(
        playerName,
        player
    );


    return player;
}


// ============================================================
// INCREMENT
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


// ============================================================
// FINITE NUMBER
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


// ============================================================
// SERIALIZE
// ============================================================

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


// ============================================================
// RATE
// ============================================================

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