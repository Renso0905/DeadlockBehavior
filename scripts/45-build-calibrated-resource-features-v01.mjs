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


// ------------------------------------------------------------
// IMPORTANT
//
// These are PROVISIONAL calibrated operational bands.
//
// They were derived from the test replay and must be
// revalidated across additional replays before being treated
// as global canonical Deadlock constants.
// ------------------------------------------------------------


// ============================================================
// BREAKABLE BANDS
// ============================================================

const BREAKABLE_CLOSE_XY =
    300;


const BREAKABLE_CLOSE_Z =
    64;


const BREAKABLE_CORE_XY =
    250;


const BREAKABLE_CORE_Z =
    32;


// ============================================================
// CAMP BANDS
// ============================================================

const CAMP_CLOSE_XY =
    300;


const CAMP_CLOSE_Z =
    64;


const CAMP_CORE_XY =
    200;


const CAMP_CORE_Z =
    64;


// ============================================================
// PATHS
// ============================================================

const calibrationPath =
    resolve(
        'output',
        replayName,
        'behavioral_accessibility_geometry_calibration.json'
    );


const episodeOutputPath =
    resolve(
        'output',
        replayName,
        'behavioral_resource_features_v01.jsonl'
    );


const summaryOutputPath =
    resolve(
        'output',
        replayName,
        'behavioral_resource_features_summary_v01.json'
    );


// ============================================================
// REQUIRE INPUT
// ============================================================

if (
    !existsSync(
        calibrationPath
    )
) {

    throw new Error(
        `Missing required input:\n${calibrationPath}`
    );
}


// ============================================================
// LOAD
// ============================================================

const calibration =
    JSON.parse(
        readFileSync(
            calibrationPath,
            'utf8'
        )
    );


if (
    calibration
        ?.validation
        ?.pass !==
    true
) {

    throw new Error(
        'behavioral_accessibility_geometry_calibration.json is not validation PASS.'
    );
}


const sourceEpisodes =
    calibration.enhancedEpisodes
    ??
    [];


// ============================================================
// OUTPUT DIRECTORY
// ============================================================

mkdirSync(
    dirname(
        episodeOutputPath
    ),
    {
        recursive: true
    }
);


// ============================================================
// OUTPUT STREAM
// ============================================================

const stream =
    createWriteStream(
        episodeOutputPath,
        {
            encoding:
                'utf8'
        }
    );


// ============================================================
// PLAYER SUMMARIES
// ============================================================

const playerMap =
    new Map();


let featureRows =
    0;


let breakableRows =
    0;


let campRows =
    0;


let breakableCloseRows =
    0;


let breakableCoreRows =
    0;


let campCloseRows =
    0;


let campCoreRows =
    0;


let knownSelfBreakRows =
    0;


let knownBulletBreakRows =
    0;


let bulletBreakOutsideCloseRows =
    0;


let campClearRows =
    0;


// ============================================================
// PROCESS EPISODES
// ============================================================

for (
    const episode
    of sourceEpisodes
) {

    const feature =
        buildFeatureRow(
            episode
        );


    if (
        !feature
    ) {

        continue;
    }


    stream.write(
        JSON.stringify(
            feature
        )
        +
        '\n'
    );


    featureRows++;


    const player =
        getPlayerSummary(
            feature.playerName
        );


    player.totalEpisodes++;


    increment(
        player.outcomes,
        feature.outcome
    );


    // ========================================================
    // BREAKABLE
    // ========================================================

    if (
        feature.objectKind ===
        'BREAKABLE'
    ) {

        breakableRows++;


        player.breakables.broadEpisodes++;


        increment(
            player.breakables.bySubtype,
            feature.subtype
            ??
            'UNKNOWN'
        );


        if (
            feature.spatialBands.closeAccess
        ) {

            breakableCloseRows++;


            player.breakables.closeAccessEpisodes++;


            increment(
                player
                    .breakables
                    .closeAccessOutcomes,
                feature.outcome
            );
        }


        if (
            feature.spatialBands.coreAccess
        ) {

            breakableCoreRows++;


            player.breakables.coreAccessEpisodes++;


            increment(
                player
                    .breakables
                    .coreAccessOutcomes,
                feature.outcome
            );
        }


        if (
            feature.action.selfBreak
        ) {

            knownSelfBreakRows++;


            player
                .breakables
                .knownSelfBreaks++;


            increment(
                player
                    .breakables
                    .selfBreakMethods,
                feature.action.method
                ??
                'UNKNOWN'
            );
        }


        if (
            feature.action.method ===
            'BULLET_RAY'
            &&
            feature.action.selfBreak
        ) {

            knownBulletBreakRows++;


            player
                .breakables
                .knownBulletBreaks++;


            if (
                !feature
                    .spatialBands
                    .closeAccess
            ) {

                bulletBreakOutsideCloseRows++;


                player
                    .breakables
                    .bulletBreaksOutsideCloseAccess++;
            }
        }
    }


    // ========================================================
    // CAMP
    // ========================================================

    if (
        feature.objectKind ===
        'CAMP'
    ) {

        campRows++;


        player.camps.broadEpisodes++;


        increment(
            player.camps.byTier,
            feature.tier
            ??
            'UNKNOWN'
        );


        if (
            feature.spatialBands.closeAccess
        ) {

            campCloseRows++;


            player.camps.closeAccessEpisodes++;


            increment(
                player
                    .camps
                    .closeAccessOutcomes,
                feature.outcome
            );
        }


        if (
            feature.spatialBands.coreProximity
        ) {

            campCoreRows++;


            player.camps.coreProximityEpisodes++;


            increment(
                player
                    .camps
                    .coreProximityOutcomes,
                feature.outcome
            );
        }


        if (
            feature.action.campClearedDuringEpisode
        ) {

            campClearRows++;


            player
                .camps
                .clearDuringEpisode++;
        }
    }
}


// ============================================================
// FINISH STREAM
// ============================================================

await new Promise(
    (
        resolvePromise,
        rejectPromise
    ) => {

        stream.on(
            'error',
            rejectPromise
        );


        stream.end(
            resolvePromise
        );
    }
);


// ============================================================
// FINALIZE PLAYER SUMMARIES
// ============================================================

const players =
    [
        ...playerMap.values()
    ];


for (
    const player
    of players
) {

    // --------------------------------------------------------
    // BREAKABLE DESCRIPTIVE RATES
    // --------------------------------------------------------

    player
        .breakables
        .closeAccessShareOfBroad =
        rate(
            player
                .breakables
                .closeAccessEpisodes,
            player
                .breakables
                .broadEpisodes
        );


    player
        .breakables
        .coreAccessShareOfBroad =
        rate(
            player
                .breakables
                .coreAccessEpisodes,
            player
                .breakables
                .broadEpisodes
        );


    player
        .breakables
        .selfBreakShareOfCloseAccess =
        rate(
            player
                .breakables
                .closeAccessOutcomes
                .SELF_BREAK
            ??
            0,
            player
                .breakables
                .closeAccessEpisodes
        );


    player
        .breakables
        .anyBreakShareOfCloseAccess =
        rate(
            (
                player
                    .breakables
                    .closeAccessOutcomes
                    .SELF_BREAK
                ??
                0
            )
            +
            (
                player
                    .breakables
                    .closeAccessOutcomes
                    .BREAK_ATTRIBUTION_UNKNOWN
                ??
                0
            )
            +
            (
                player
                    .breakables
                    .closeAccessOutcomes
                    .OTHER_PLAYER_BREAK
                ??
                0
            ),
            player
                .breakables
                .closeAccessEpisodes
        );


    player
        .breakables
        .selfBreakShareOfCoreAccess =
        rate(
            player
                .breakables
                .coreAccessOutcomes
                .SELF_BREAK
            ??
            0,
            player
                .breakables
                .coreAccessEpisodes
        );


    player
        .breakables
        .bulletBreakOutsideCloseShare =
        rate(
            player
                .breakables
                .bulletBreaksOutsideCloseAccess,
            player
                .breakables
                .knownBulletBreaks
        );


    // --------------------------------------------------------
    // CAMP DESCRIPTIVE RATES
    // --------------------------------------------------------

    player
        .camps
        .closeAccessShareOfBroad =
        rate(
            player
                .camps
                .closeAccessEpisodes,
            player
                .camps
                .broadEpisodes
        );


    player
        .camps
        .coreProximityShareOfBroad =
        rate(
            player
                .camps
                .coreProximityEpisodes,
            player
                .camps
                .broadEpisodes
        );


    player
        .camps
        .clearShareOfCoreProximity =
        rate(
            player
                .camps
                .coreProximityOutcomes
                .CAMP_CLEARED_DURING_EPISODE
            ??
            0,
            player
                .camps
                .coreProximityEpisodes
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
// VALIDATION
// ============================================================

const expectedEpisodeCount =
    calibration
        ?.sourceCounts
        ?.episodesLoaded
    ??
    9573;


const validation =
    {

        sourceCalibrationPass:
            {

                actual:
                    calibration
                        ?.validation
                        ?.pass,

                expected:
                    true,

                pass:
                    calibration
                        ?.validation
                        ?.pass ===
                    true
            },

        featureRows:
            {

                actual:
                    featureRows,

                expected:
                    expectedEpisodeCount,

                pass:
                    featureRows ===
                    expectedEpisodeCount
            },

        breakableRows:
            {

                actual:
                    breakableRows,

                expected:
                    calibration
                        ?.sourceCounts
                        ?.breakableEpisodesWithSamples
                    ??
                    8752,

                pass:
                    breakableRows ===
                    (
                        calibration
                            ?.sourceCounts
                            ?.breakableEpisodesWithSamples
                        ??
                        8752
                    )
            },

        campRows:
            {

                actual:
                    campRows,

                expected:
                    calibration
                        ?.sourceCounts
                        ?.campEpisodesWithSamples
                    ??
                    821,

                pass:
                    campRows ===
                    (
                        calibration
                            ?.sourceCounts
                            ?.campEpisodesWithSamples
                        ??
                        821
                    )
            },

        players:
            {

                actual:
                    players.length,

                expected:
                    12,

                pass:
                    players.length ===
                    12
            },

        closeBreakableRowsProduced:
            {

                actual:
                    breakableCloseRows,

                expected:
                    '>0',

                pass:
                    breakableCloseRows >
                    0
            },

        coreCampRowsProduced:
            {

                actual:
                    campCoreRows,

                expected:
                    '>0',

                pass:
                    campCoreRows >
                    0
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
// SUMMARY OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BEHAVIORAL_RESOURCE_FEATURES_V01',

        canonical:
            false,

        status:
            'PROVISIONAL_SINGLE_REPLAY_CALIBRATION',

        methodology:
            {

                broadExposure:
                    'Inherited from Behavioral Metrics v0.1 broad spatial episode envelopes.',

                breakableCloseAccess:
                    `At least one synchronous sample with XY <= ${BREAKABLE_CLOSE_XY} and |Z| <= ${BREAKABLE_CLOSE_Z}.`,

                breakableCoreAccess:
                    `At least one synchronous sample with XY <= ${BREAKABLE_CORE_XY} and |Z| <= ${BREAKABLE_CORE_Z}.`,

                campCloseAccess:
                    `At least one synchronous sample with XY <= ${CAMP_CLOSE_XY} and |Z| <= ${CAMP_CLOSE_Z}.`,

                campCoreProximity:
                    `At least one synchronous sample with XY <= ${CAMP_CORE_XY} and |Z| <= ${CAMP_CORE_Z}.`,

                directInteraction:
                    'Breakable SELF_BREAK remains based only on canonical action attribution, not proximity.',

                bulletInteraction:
                    'Canonical BULLET_RAY breaks remain valid even if the player never entered a close-access band.',

                campClearCaution:
                    'CAMP_CLEARED_DURING_EPISODE means the environmental camp state cleared while the player was spatially exposed. It does not establish that the player caused the clear.'
            },

        thresholds:
            {

                breakable:
                    {

                        broadEnvelope:
                            {

                                source:
                                    'Behavioral Metrics v0.1',

                                approximate3DRadius:
                                    500
                            },

                        closeAccess:
                            {

                                xy:
                                    BREAKABLE_CLOSE_XY,

                                vertical:
                                    BREAKABLE_CLOSE_Z
                            },

                        coreAccess:
                            {

                                xy:
                                    BREAKABLE_CORE_XY,

                                vertical:
                                    BREAKABLE_CORE_Z
                            }
                    },

                camp:
                    {

                        broadEnvelope:
                            {

                                source:
                                    'Behavioral Metrics v0.1',

                                approximate3DRadius:
                                    800
                            },

                        closeAccess:
                            {

                                xy:
                                    CAMP_CLOSE_XY,

                                vertical:
                                    CAMP_CLOSE_Z
                            },

                        coreProximity:
                            {

                                xy:
                                    CAMP_CORE_XY,

                                vertical:
                                    CAMP_CORE_Z
                            }
                    }
            },

        calibrationEvidence:
            {

                breakableClose:
                    {

                        basis:
                            '300 XY / 64 Z',

                        meleeBreakCapture:
                            501 /
                            522,

                        meleeBreakCapturePercent:
                            (
                                501 /
                                522
                            )
                            *
                            100,

                        note:
                            'Selected as a slightly more robust same-level band than the automatic 300/32 candidate.'
                    },

                breakableCore:
                    {

                        basis:
                            '250 XY / 32 Z',

                        meleeBreakCapture:
                            474 /
                            522,

                        meleeBreakCapturePercent:
                            (
                                474 /
                                522
                            )
                            *
                            100,

                        note:
                            'Tighter high-concentration close-contact band.'
                    },

                campCore:
                    {

                        basis:
                            '200 XY / 64 Z',

                        observedClearEpisodesCaptured:
                            116,

                        totalObservedClearEpisodes:
                            145,

                        clearCaptureRate:
                            116 /
                            145,

                        clearShareWithinBand:
                            116 /
                            158,

                        note:
                            'Vertical limits 16, 32, and 64 classified exactly the same episodes in the calibration replay; 64 retained as the more robust provisional gate.'
                    }
            },

        counts:
            {

                totalEpisodes:
                    featureRows,

                breakableEpisodes:
                    breakableRows,

                campEpisodes:
                    campRows,

                breakableCloseAccess:
                    breakableCloseRows,

                breakableCoreAccess:
                    breakableCoreRows,

                campCloseAccess:
                    campCloseRows,

                campCoreProximity:
                    campCoreRows,

                knownSelfBreaks:
                    knownSelfBreakRows,

                knownBulletBreaks:
                    knownBulletBreakRows,

                bulletBreaksOutsideCloseAccess:
                    bulletBreakOutsideCloseRows,

                campClearedDuringEpisode:
                    campClearRows
            },

        validation:
            {

                pass:
                    validationPass,

                checks:
                    validation
            },

        players
    };


writeFileSync(

    summaryOutputPath,

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
    '=========================================='
);

console.log(
    'CALIBRATED RESOURCE FEATURES V0.1'
);

console.log(
    '=========================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log('');

console.log(
    'BREAKABLES'
);

console.log(
    '----------'
);

console.log(
    `Broad episodes: ${breakableRows}`
);

console.log(
    `Close access (${BREAKABLE_CLOSE_XY}/${BREAKABLE_CLOSE_Z}): ${breakableCloseRows}`
);

console.log(
    `Core access  (${BREAKABLE_CORE_XY}/${BREAKABLE_CORE_Z}): ${breakableCoreRows}`
);

console.log(
    `Known self breaks: ${knownSelfBreakRows}`
);

console.log(
    `Known bullet breaks: ${knownBulletBreakRows}`
);

console.log(
    `Bullet breaks outside close access: ${bulletBreakOutsideCloseRows}`
);

console.log('');

console.log(
    'CAMPS'
);

console.log(
    '-----'
);

console.log(
    `Broad episodes: ${campRows}`
);

console.log(
    `Close access (${CAMP_CLOSE_XY}/${CAMP_CLOSE_Z}): ${campCloseRows}`
);

console.log(
    `Core proximity (${CAMP_CORE_XY}/${CAMP_CORE_Z}): ${campCoreRows}`
);

console.log(
    `Clear-during-episode: ${campClearRows}`
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
                30
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
    `Episodes:\n${episodeOutputPath}`
);

console.log('');

console.log(
    `Summary:\n${summaryOutputPath}`
);

console.log('');


// ============================================================
// BUILD FEATURE ROW
// ============================================================

function buildFeatureRow(
    episode
) {

    if (
        !episode
        ||
        !episode.playerName
        ||
        !episode.objectKind
    ) {

        return null;
    }


    const closest3D =
        episode
            ?.geometry
            ?.closest3D
        ??
        null;


    const feature =
        {

            schemaVersion:
                1,

            episodeIndex:
                episode.episodeIndex,

            playerName:
                episode.playerName,

            resourceKey:
                episode.resourceKey,

            objectKind:
                episode.objectKind,

            objectId:
                episode.objectId,

            subtype:
                episode.subtype,

            tier:
                episode.tier,

            startTimeSeconds:
                episode.startTimeSeconds,

            endTimeSeconds:
                episode.endTimeSeconds,

            durationSeconds:
                episode.durationSeconds,

            outcome:
                episode.outcome,

            closestObserved:
                closest3D
                ? {

                    timeSeconds:
                        closest3D.timeSeconds,

                    distance3D:
                        closest3D.distance3D,

                    distanceXY:
                        closest3D.distanceXY,

                    verticalDistance:
                        closest3D.verticalDistance,

                    signedVerticalDifference:
                        closest3D.signedVerticalDifference
                }
                : null,

            spatialBands:
                {},

            action:
                {

                    selfBreak:
                        episode.outcome ===
                        'SELF_BREAK',

                    anyBreakDuringEpisode:
                        episode.outcome ===
                            'SELF_BREAK'
                        ||
                        episode.outcome ===
                            'BREAK_ATTRIBUTION_UNKNOWN'
                        ||
                        episode.outcome ===
                            'OTHER_PLAYER_BREAK',

                    campClearedDuringEpisode:
                        episode.outcome ===
                        'CAMP_CLEARED_DURING_EPISODE',

                    method:
                        episode.canonicalBreakMethod,

                    canonicalBreakerPlayer:
                        episode.canonicalBreakerPlayer,

                    breakKey:
                        episode.breakKey
                }
        };


    // ========================================================
    // BREAKABLE BANDS
    // ========================================================

    if (
        episode.objectKind ===
        'BREAKABLE'
    ) {

        feature.spatialBands =
            {

                broadExposure:
                    true,

                closeAccess:
                    passesJointBand(
                        episode,
                        BREAKABLE_CLOSE_XY,
                        BREAKABLE_CLOSE_Z
                    ),

                coreAccess:
                    passesJointBand(
                        episode,
                        BREAKABLE_CORE_XY,
                        BREAKABLE_CORE_Z
                    ),

                closeAccessSample:
                    getBandSample(
                        episode,
                        BREAKABLE_CLOSE_XY
                    ),

                coreAccessSample:
                    getBandSample(
                        episode,
                        BREAKABLE_CORE_XY
                    )
            };


        feature.action.longRangeBulletInteraction =
            (
                feature.action.selfBreak
                &&
                feature.action.method ===
                    'BULLET_RAY'
                &&
                !feature
                    .spatialBands
                    .closeAccess
            );
    }


    // ========================================================
    // CAMP BANDS
    // ========================================================

    if (
        episode.objectKind ===
        'CAMP'
    ) {

        feature.spatialBands =
            {

                broadExposure:
                    true,

                closeAccess:
                    passesJointBand(
                        episode,
                        CAMP_CLOSE_XY,
                        CAMP_CLOSE_Z
                    ),

                coreProximity:
                    passesJointBand(
                        episode,
                        CAMP_CORE_XY,
                        CAMP_CORE_Z
                    ),

                closeAccessSample:
                    getBandSample(
                        episode,
                        CAMP_CLOSE_XY
                    ),

                coreProximitySample:
                    getBandSample(
                        episode,
                        CAMP_CORE_XY
                    )
            };
    }


    return feature;
}


// ============================================================
// PASS JOINT BAND
// ============================================================

function passesJointBand(
    episode,
    xyThreshold,
    verticalThreshold
) {

    const sample =
        getBandSample(
            episode,
            xyThreshold
        );


    if (
        !sample
    ) {

        return false;
    }


    return (
        finite(
            sample.distanceXY
        ) !==
            null
        &&
        finite(
            sample.verticalDistance
        ) !==
            null
        &&
        sample.distanceXY <=
            xyThreshold
        &&
        sample.verticalDistance <=
            verticalThreshold
    );
}


// ============================================================
// GET SYNCHRONOUS BAND SAMPLE
// ============================================================

function getBandSample(
    episode,
    xyThreshold
) {

    const sample =
        episode
            ?.geometry
            ?.minVerticalWithinXY
            ?.[
                String(
                    xyThreshold
                )
            ]
        ??
        null;


    if (
        !sample
    ) {

        return null;
    }


    return {

        timeSeconds:
            sample.timeSeconds,

        distance3D:
            sample.distance3D,

        distanceXY:
            sample.distanceXY,

        verticalDistance:
            sample.verticalDistance,

        signedVerticalDifference:
            sample.signedVerticalDifference
    };
}


// ============================================================
// PLAYER SUMMARY
// ============================================================

function getPlayerSummary(
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

            totalEpisodes:
                0,

            outcomes:
                {},

            breakables:
                {

                    broadEpisodes:
                        0,

                    closeAccessEpisodes:
                        0,

                    coreAccessEpisodes:
                        0,

                    bySubtype:
                        {},

                    closeAccessOutcomes:
                        {},

                    coreAccessOutcomes:
                        {},

                    knownSelfBreaks:
                        0,

                    knownBulletBreaks:
                        0,

                    bulletBreaksOutsideCloseAccess:
                        0,

                    selfBreakMethods:
                        {}
                },

            camps:
                {

                    broadEpisodes:
                        0,

                    closeAccessEpisodes:
                        0,

                    coreProximityEpisodes:
                        0,

                    byTier:
                        {},

                    closeAccessOutcomes:
                        {},

                    coreProximityOutcomes:
                        {},

                    clearDuringEpisode:
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
// NUMBER
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