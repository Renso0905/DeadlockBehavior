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

import readline from 'node:readline';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


const BREAKABLE_XY_THRESHOLDS =
    [
        100,
        150,
        200,
        250,
        300,
        400,
        500
    ];


const BREAKABLE_VERTICAL_THRESHOLDS =
    [
        16,
        32,
        64,
        96,
        128,
        192,
        256
    ];


const CAMP_XY_THRESHOLDS =
    [
        100,
        200,
        300,
        400,
        500,
        600,
        800
    ];


const CAMP_VERTICAL_THRESHOLDS =
    [
        16,
        32,
        64,
        96,
        128,
        192,
        256
    ];


// Tiny tolerance for episode boundaries.
const TIME_EPSILON =
    0.000001;


// ============================================================
// PATHS
// ============================================================

const playerStatePath =
    resolve(
        'output',
        replayName,
        'player_state.jsonl'
    );


const metricsPath =
    resolve(
        'output',
        replayName,
        'behavioral_metrics_v01.json'
    );


const episodesPath =
    resolve(
        'output',
        replayName,
        'behavioral_resource_episodes_v01.jsonl'
    );


const breakablePath =
    resolve(
        'output',
        replayName,
        'breakable_catalog_v1.json'
    );


const campPathCandidates =
    [

        resolve(
            'inspector',
            'data',
            replayName,
            'v02_overlays.json'
        ),

        resolve(
            'output',
            replayName,
            'v02_overlays.json'
        )
    ];


const outputPath =
    resolve(
        'output',
        replayName,
        'behavioral_accessibility_geometry_calibration.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        playerStatePath,
        metricsPath,
        episodesPath,
        breakablePath
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


const campPath =
    firstExistingPath(
        campPathCandidates
    );


if (
    !campPath
) {

    throw new Error(
        [
            'Could not find v02_overlays.json.',
            '',
            'Checked:',
            ...campPathCandidates
        ].join(
            '\n'
        )
    );
}


// ============================================================
// LOAD SUMMARIES / RESOURCES
// ============================================================

const metrics =
    JSON.parse(
        readFileSync(
            metricsPath,
            'utf8'
        )
    );


const breakables =
    JSON.parse(
        readFileSync(
            breakablePath,
            'utf8'
        )
    );


const overlays =
    JSON.parse(
        readFileSync(
            campPath,
            'utf8'
        )
    );


if (
    metrics
        ?.validation
        ?.pass !==
    true
) {

    throw new Error(
        'behavioral_metrics_v01.json is not validation PASS.'
    );
}


// ============================================================
// RESOURCE POSITIONS
// ============================================================

const resourcePositionByKey =
    new Map();


// ------------------------------------------------------------
// BREAKABLES
// ------------------------------------------------------------

for (
    const slot
    of breakables.slots
    ??
    []
) {

    const position =
        normalizePosition(
            slot.worldPosition
        );


    if (
        !position
    ) {

        continue;
    }


    const key =
        `BREAKABLE:${
            slot.breakableId
            ??
            slot.entityIndex
        }`;


    resourcePositionByKey.set(
        key,
        position
    );
}


// ------------------------------------------------------------
// CAMPS
// ------------------------------------------------------------

for (
    const camp
    of overlays.camps
    ??
    []
) {

    const position =
        normalizePosition(
            camp.worldPosition
        );


    if (
        !position
    ) {

        continue;
    }


    const key =
        `CAMP:${
            camp.campId
            ??
            camp.name
        }`;


    resourcePositionByKey.set(
        key,
        position
    );
}


// ============================================================
// CANONICAL BREAK TOTALS
// ============================================================

let canonicalKnownBreaks =
    0;


let canonicalMeleeBreaks =
    0;


let canonicalBulletBreaks =
    0;


for (
    const player
    of metrics.players
    ??
    []
) {

    const actions =
        player.knownBreakableActions
        ??
        {};


    canonicalKnownBreaks +=
        finite(
            actions.totalKnownBreaks
        )
        ??
        0;


    canonicalMeleeBreaks +=
        finite(
            actions.meleeBreaks
        )
        ??
        0;


    canonicalBulletBreaks +=
        finite(
            actions.bulletBreaks
        )
        ??
        0;
}


// ============================================================
// LOAD EPISODES
// ============================================================

const episodes =
    [];


const episodesByPlayer =
    new Map();


let episodeLinesRead =
    0;


let episodeParseFailures =
    0;


let episodesMissingResourcePosition =
    0;


const episodeReader =
    readline.createInterface({

        input:
            createReadStream(
                episodesPath,
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
    of episodeReader
) {

    if (
        !line.trim()
    ) {

        continue;
    }


    episodeLinesRead++;


    let row;


    try {

        row =
            JSON.parse(
                line
            );

    } catch {

        episodeParseFailures++;

        continue;
    }


    const playerName =
        row.playerName
        ??
        null;


    const resourceKey =
        row.resourceKey
        ??
        null;


    const startTimeSeconds =
        finite(
            row.startTimeSeconds
        );


    const endTimeSeconds =
        finite(
            row.endTimeSeconds
        );


    if (
        !playerName
        ||
        !resourceKey
        ||
        startTimeSeconds ===
            null
        ||
        endTimeSeconds ===
            null
    ) {

        continue;
    }


    const resourcePosition =
        resourcePositionByKey.get(
            resourceKey
        )
        ??
        null;


    if (
        !resourcePosition
    ) {

        episodesMissingResourcePosition++;

        continue;
    }


    const episode =
        {

            episodeIndex:
                episodes.length,

            playerName,

            resourceKey,

            objectKind:
                row.objectKind
                ??
                'UNKNOWN',

            objectId:
                row.objectId
                ??
                null,

            subtype:
                row.subtype
                ??
                null,

            tier:
                row.tier
                ??
                null,

            outcome:
                row.outcome
                ??
                'UNKNOWN',

            startTimeSeconds,

            endTimeSeconds,

            durationSeconds:
                finite(
                    row.durationSeconds
                ),

            resourcePosition,

            canonicalBreakMethod:
                row
                    ?.consumption
                    ?.canonicalBreaker
                    ?.method
                ??
                null,

            canonicalBreakerPlayer:
                row
                    ?.consumption
                    ?.canonicalBreaker
                    ?.player
                    ?.playerName
                ??
                null,

            breakKey:
                row
                    ?.consumption
                    ?.breakKey
                ??
                null,

            geometry:
                {

                    validSamples:
                        0,

                    closest3D:
                        null,

                    closestXY:
                        null,

                    lowestVertical:
                        null,

                    minVerticalWithinXY:
                        {}
                }
        };


    const xyThresholds =
        episode.objectKind ===
            'CAMP'

            ? CAMP_XY_THRESHOLDS

            : BREAKABLE_XY_THRESHOLDS;


    for (
        const threshold
        of xyThresholds
    ) {

        episode
            .geometry
            .minVerticalWithinXY[
                String(
                    threshold
                )
            ] =
            null;
    }


    episodes.push(
        episode
    );


    if (
        !episodesByPlayer.has(
            playerName
        )
    ) {

        episodesByPlayer.set(
            playerName,
            []
        );
    }


    episodesByPlayer
        .get(
            playerName
        )
        .push(
            episode
        );
}


// ============================================================
// SORT PLAYER EPISODES
// ============================================================

for (
    const playerEpisodes
    of episodesByPlayer.values()
) {

    playerEpisodes.sort(
        (
            a,
            b
        ) =>
            a.startTimeSeconds -
            b.startTimeSeconds
            ||
            a.endTimeSeconds -
            b.endTimeSeconds
    );
}


// ============================================================
// PLAYER SWEEP STATE
// ============================================================

const sweepByPlayer =
    new Map();


for (
    const [
        playerName,
        playerEpisodes
    ]
    of episodesByPlayer.entries()
) {

    sweepByPlayer.set(
        playerName,
        {

            episodes:
                playerEpisodes,

            nextEpisodeIndex:
                0,

            activeEpisodes:
                []
        }
    );
}


// ============================================================
// PLAYER STATE STREAM
// ============================================================

let playerRowsRead =
    0;


let playerRowsParsed =
    0;


let spatialRowsUsed =
    0;


let rowsWithoutMatchingPlayerEpisodes =
    0;


const playerReader =
    readline.createInterface({

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


console.log('');

console.log(
    '==========================================='
);

console.log(
    'RESOURCE ACCESSIBILITY GEOMETRY CALIBRATION'
);

console.log(
    '==========================================='
);

console.log('');

console.log(
    `Episodes loaded: ${episodes.length}`
);

console.log(
    `Players with episodes: ${episodesByPlayer.size}`
);

console.log(
    `Resource positions: ${resourcePositionByKey.size}`
);

console.log('');


// ============================================================
// STREAM PLAYER SAMPLES THROUGH EPISODES
// ============================================================

for await (
    const line
    of playerReader
) {

    if (
        !line.trim()
    ) {

        continue;
    }


    playerRowsRead++;


    let row;


    try {

        row =
            JSON.parse(
                line
            );

    } catch {

        continue;
    }


    playerRowsParsed++;


    const playerName =
        extractPlayerName(
            row
        );


    const time =
        finite(
            row.matchTimeSeconds
        );


    const position =
        normalizePosition(
            row
                ?.pawn
                ?.positionWorld
        );


    const alive =
        extractAlive(
            row
        );


    const positionValid =
        row
            ?.pawn
            ?.positionValidForMovement ===
        true;


    if (
        !playerName
        ||
        time ===
            null
        ||
        !position
        ||
        time <
            0
        ||
        !alive
        ||
        !positionValid
    ) {

        continue;
    }


    const sweep =
        sweepByPlayer.get(
            playerName
        );


    if (
        !sweep
    ) {

        rowsWithoutMatchingPlayerEpisodes++;

        continue;
    }


    spatialRowsUsed++;


    // ========================================================
    // ACTIVATE EPISODES THAT HAVE STARTED
    // ========================================================

    while (
        sweep.nextEpisodeIndex <
            sweep.episodes.length
        &&
        sweep
            .episodes[
                sweep.nextEpisodeIndex
            ]
            .startTimeSeconds
        <=
        time +
            TIME_EPSILON
    ) {

        const episode =
            sweep.episodes[
                sweep.nextEpisodeIndex
            ];


        sweep.nextEpisodeIndex++;


        // If this episode already ended before the current
        // sample, it had no spatial sample at this timestamp.
        if (
            episode.endTimeSeconds <
            time -
            TIME_EPSILON
        ) {

            continue;
        }


        sweep.activeEpisodes.push(
            episode
        );
    }


    // ========================================================
    // REMOVE EPISODES THAT HAVE ENDED
    // ========================================================

    sweep.activeEpisodes =
        sweep.activeEpisodes.filter(
            episode =>
                episode.endTimeSeconds >=
                time -
                TIME_EPSILON
        );


    // ========================================================
    // UPDATE SYNCHRONOUS GEOMETRY
    // ========================================================

    for (
        const episode
        of sweep.activeEpisodes
    ) {

        if (
            time <
            episode.startTimeSeconds -
                TIME_EPSILON
            ||
            time >
            episode.endTimeSeconds +
                TIME_EPSILON
        ) {

            continue;
        }


        updateEpisodeGeometry(
            episode,
            time,
            position
        );
    }
}


// ============================================================
// EPISODE GEOMETRY COMPLETENESS
// ============================================================

const episodesWithSamples =
    episodes.filter(
        episode =>
            episode.geometry.validSamples >
            0
    );


const episodesWithoutSamples =
    episodes.filter(
        episode =>
            episode.geometry.validSamples ===
            0
    );


const breakableEpisodes =
    episodesWithSamples.filter(
        episode =>
            episode.objectKind ===
            'BREAKABLE'
    );


const campEpisodes =
    episodesWithSamples.filter(
        episode =>
            episode.objectKind ===
            'CAMP'
    );


// ============================================================
// SYNCHRONOUS CLOSEST-SAMPLE DISTRIBUTIONS
// ============================================================

const synchronousDistributions =
    {

        breakableSelfBreak:
            summarizeClosest3D(
                breakableEpisodes.filter(
                    episode =>
                        episode.outcome ===
                        'SELF_BREAK'
                )
            ),

        breakableLeftAvailable:
            summarizeClosest3D(
                breakableEpisodes.filter(
                    episode =>
                        episode.outcome ===
                        'LEFT_AVAILABLE'
                )
            ),

        breakableUnknownBreak:
            summarizeClosest3D(
                breakableEpisodes.filter(
                    episode =>
                        episode.outcome ===
                        'BREAK_ATTRIBUTION_UNKNOWN'
                )
            ),

        campCleared:
            summarizeClosest3D(
                campEpisodes.filter(
                    episode =>
                        episode.outcome ===
                        'CAMP_CLEARED_DURING_EPISODE'
                )
            ),

        campLeftAvailable:
            summarizeClosest3D(
                campEpisodes.filter(
                    episode =>
                        episode.outcome ===
                        'LEFT_AVAILABLE'
                )
            )
    };


// ============================================================
// BREAKABLE JOINT XY × VERTICAL GRID
// ============================================================

const breakableJointGrid =
    [];


for (
    const xyThreshold
    of BREAKABLE_XY_THRESHOLDS
) {

    for (
        const verticalThreshold
        of BREAKABLE_VERTICAL_THRESHOLDS
    ) {

        const retained =
            breakableEpisodes.filter(
                episode =>
                    episodePassesJointThreshold(
                        episode,
                        xyThreshold,
                        verticalThreshold
                    )
            );


        const outcomes =
            countBy(
                retained,
                episode =>
                    episode.outcome
            );


        const selfBreaks =
            retained.filter(
                episode =>
                    episode.outcome ===
                    'SELF_BREAK'
            );


        const meleeSelfBreaks =
            selfBreaks.filter(
                episode =>
                    episode.canonicalBreakMethod ===
                    'MELEE_DIRECT'
            );


        const bulletSelfBreaks =
            selfBreaks.filter(
                episode =>
                    episode.canonicalBreakMethod ===
                    'BULLET_RAY'
            );


        const anyBreak =
            retained.filter(
                episode =>
                    episode.outcome ===
                        'SELF_BREAK'
                    ||
                    episode.outcome ===
                        'BREAK_ATTRIBUTION_UNKNOWN'
                    ||
                    episode.outcome ===
                        'OTHER_PLAYER_BREAK'
            );


        breakableJointGrid.push({

            xyThreshold,

            verticalThreshold,

            retainedEpisodes:
                retained.length,

            retentionRate:
                rate(
                    retained.length,
                    breakableEpisodes.length
                ),

            outcomes,

            selfBreaks:
                selfBreaks.length,

            anyBreakDuringEpisode:
                anyBreak.length,

            selfBreakShare:
                rate(
                    selfBreaks.length,
                    retained.length
                ),

            anyBreakShare:
                rate(
                    anyBreak.length,
                    retained.length
                ),

            meleeCapture:
                {

                    captured:
                        meleeSelfBreaks.length,

                    total:
                        canonicalMeleeBreaks,

                    rate:
                        rate(
                            meleeSelfBreaks.length,
                            canonicalMeleeBreaks
                        )
                },

            bulletCapture:
                {

                    captured:
                        bulletSelfBreaks.length,

                    total:
                        canonicalBulletBreaks,

                    rate:
                        rate(
                            bulletSelfBreaks.length,
                            canonicalBulletBreaks
                        )
                }
        });
    }
}


// ============================================================
// CAMP JOINT XY × VERTICAL GRID
// ============================================================

const campJointGrid =
    [];


for (
    const xyThreshold
    of CAMP_XY_THRESHOLDS
) {

    for (
        const verticalThreshold
        of CAMP_VERTICAL_THRESHOLDS
    ) {

        const retained =
            campEpisodes.filter(
                episode =>
                    episodePassesJointThreshold(
                        episode,
                        xyThreshold,
                        verticalThreshold
                    )
            );


        const outcomes =
            countBy(
                retained,
                episode =>
                    episode.outcome
            );


        const clears =
            outcomes
                .CAMP_CLEARED_DURING_EPISODE
            ??
            0;


        campJointGrid.push({

            xyThreshold,

            verticalThreshold,

            retainedEpisodes:
                retained.length,

            retentionRate:
                rate(
                    retained.length,
                    campEpisodes.length
                ),

            outcomes,

            clearDuringEpisode:
                clears,

            clearShare:
                rate(
                    clears,
                    retained.length
                )
        });
    }
}


// ============================================================
// SELECT USEFUL CALIBRATION CANDIDATES
// ============================================================

// ------------------------------------------------------------
// Breakable candidate:
//
// Find smallest retained population that still captures at
// least 95% of canonical melee breaks.
// ------------------------------------------------------------

const breakableMelee95Candidates =
    breakableJointGrid

        .filter(
            row =>
                row.meleeCapture.rate !==
                    null
                &&
                row.meleeCapture.rate >=
                    0.95
        )

        .sort(
            (
                a,
                b
            ) =>
                a.retainedEpisodes -
                b.retainedEpisodes
                ||
                b.selfBreakShare -
                a.selfBreakShare
        );


const breakableMelee95 =
    breakableMelee95Candidates[0]
    ??
    null;


// ------------------------------------------------------------
// Breakable candidate:
//
// Highest self-break share among cells that capture >=90% of
// melee breaks.
// ------------------------------------------------------------

const breakableHighPrecision =
    breakableJointGrid

        .filter(
            row =>
                row.meleeCapture.rate !==
                    null
                &&
                row.meleeCapture.rate >=
                    0.90
        )

        .sort(
            (
                a,
                b
            ) =>
                b.selfBreakShare -
                a.selfBreakShare
                ||
                a.retainedEpisodes -
                b.retainedEpisodes
        )[0]
    ??
    null;


// ------------------------------------------------------------
// Camp candidate:
//
// Highest clear share among cells retaining at least 80% of
// observed clear episodes.
// ------------------------------------------------------------

const totalCampClearEpisodes =
    campEpisodes.filter(
        episode =>
            episode.outcome ===
            'CAMP_CLEARED_DURING_EPISODE'
    ).length;


const campEngagementCandidates =
    campJointGrid

        .map(
            row => ({

                ...row,

                clearCaptureRate:
                    rate(
                        row.clearDuringEpisode,
                        totalCampClearEpisodes
                    )
            })
        )

        .filter(
            row =>
                row.clearCaptureRate !==
                    null
                &&
                row.clearCaptureRate >=
                    0.80
        )

        .sort(
            (
                a,
                b
            ) =>
                b.clearShare -
                a.clearShare
                ||
                a.retainedEpisodes -
                b.retainedEpisodes
        );


const campEngagementCandidate =
    campEngagementCandidates[0]
    ??
    null;


// ============================================================
// PLAYER-LEVEL SELECTED RULES
// ============================================================

const playerNames =
    [
        ...new Set(
            episodesWithSamples.map(
                episode =>
                    episode.playerName
            )
        )
    ]
    .sort();


const playerSummaries =
    [];


for (
    const playerName
    of playerNames
) {

    const playerBreakables =
        breakableEpisodes.filter(
            episode =>
                episode.playerName ===
                playerName
        );


    const playerCamps =
        campEpisodes.filter(
            episode =>
                episode.playerName ===
                playerName
        );


    playerSummaries.push({

        playerName,

        breakableEpisodes:
            playerBreakables.length,

        campEpisodes:
            playerCamps.length,

        breakableMelee95Rule:
            breakableMelee95
                ? summarizePlayerRule(
                    playerBreakables,
                    breakableMelee95
                )
                : null,

        breakableHighPrecisionRule:
            breakableHighPrecision
                ? summarizePlayerRule(
                    playerBreakables,
                    breakableHighPrecision
                )
                : null,

        campEngagementRule:
            campEngagementCandidate
                ? summarizePlayerRule(
                    playerCamps,
                    campEngagementCandidate
                )
                : null
    });
}


// ============================================================
// COMPACT ENHANCED EPISODE OUTPUT
// ============================================================

const enhancedEpisodes =
    episodes.map(
        episode => ({

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

            outcome:
                episode.outcome,

            startTimeSeconds:
                episode.startTimeSeconds,

            endTimeSeconds:
                episode.endTimeSeconds,

            durationSeconds:
                episode.durationSeconds,

            canonicalBreakMethod:
                episode.canonicalBreakMethod,

            canonicalBreakerPlayer:
                episode.canonicalBreakerPlayer,

            breakKey:
                episode.breakKey,

            geometry:
                episode.geometry
        })
    );


// ============================================================
// VALIDATION
// ============================================================

const validation =
    {

        episodeLinesParsed:
            {

                actual:
                    episodes.length,

                expected:
                    metrics
                        ?.playerStateProcessing
                        ?.episodesWritten
                    ??
                    9573,

                pass:
                    episodes.length ===
                    (
                        metrics
                            ?.playerStateProcessing
                            ?.episodesWritten
                        ??
                        9573
                    )
            },

        missingResourcePositions:
            {

                actual:
                    episodesMissingResourcePosition,

                expected:
                    0,

                pass:
                    episodesMissingResourcePosition ===
                    0
            },

        episodesWithSpatialSamples:
            {

                actual:
                    episodesWithSamples.length,

                expected:
                    '>0',

                pass:
                    episodesWithSamples.length >
                    0
            },

        breakableEpisodesWithSamples:
            {

                actual:
                    breakableEpisodes.length,

                expected:
                    '>0',

                pass:
                    breakableEpisodes.length >
                    0
            },

        campEpisodesWithSamples:
            {

                actual:
                    campEpisodes.length,

                expected:
                    '>0',

                pass:
                    campEpisodes.length >
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
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BEHAVIORAL_ACCESSIBILITY_GEOMETRY_CALIBRATION',

        canonical:
            false,

        purpose:
            [

                'Recalculate episode geometry from actual player samples so horizontal and vertical separation are measured synchronously.',

                'Avoid combining independently observed minimum XY and minimum vertical distances from different timestamps.',

                'Evaluate candidate XY + vertical accessibility thresholds against observed break and camp-clear behavior.',

                'Do not classify spatial non-consumption as a mistake.'
            ],

        source:
            {

                playerState:
                    playerStatePath,

                metrics:
                    metricsPath,

                episodes:
                    episodesPath,

                breakables:
                    breakablePath,

                camps:
                    campPath
            },

        sourceCounts:
            {

                episodeLinesRead,

                episodeParseFailures,

                episodesLoaded:
                    episodes.length,

                episodesMissingResourcePosition,

                playerRowsRead,

                playerRowsParsed,

                spatialRowsUsed,

                rowsWithoutMatchingPlayerEpisodes,

                episodesWithSamples:
                    episodesWithSamples.length,

                episodesWithoutSamples:
                    episodesWithoutSamples.length,

                breakableEpisodesWithSamples:
                    breakableEpisodes.length,

                campEpisodesWithSamples:
                    campEpisodes.length
            },

        canonicalBreakTotals:
            {

                known:
                    canonicalKnownBreaks,

                melee:
                    canonicalMeleeBreaks,

                bullet:
                    canonicalBulletBreaks
            },

        synchronousDistributions,

        recommendedCalibrationCandidates:
            {

                breakableMelee95,

                breakableHighPrecision,

                campEngagementCandidate,

                interpretation:
                    {

                        breakable:
                            'Candidate thresholds are descriptive accessibility bands. Bullet farming remains a separate long-range action channel.',

                        camp:
                            'Candidate threshold attempts to preserve at least 80% of observed camp-clear exposure episodes while maximizing clear concentration.'
                    }
            },

        breakableJointGrid,

        campJointGrid,

        players:
            playerSummaries,

        validation:
            {

                pass:
                    validationPass,

                checks:
                    validation
            },

        enhancedEpisodes
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
// CONSOLE
// ============================================================

console.log(
    'SOURCE PROCESSING'
);

console.log(
    '-----------------'
);

console.log(
    `Episode lines: ${episodeLinesRead}`
);

console.log(
    `Episodes loaded: ${episodes.length}`
);

console.log(
    `Missing resource positions: ${episodesMissingResourcePosition}`
);

console.log(
    `Episodes with samples: ${episodesWithSamples.length}`
);

console.log(
    `Episodes without samples: ${episodesWithoutSamples.length}`
);

console.log('');

console.log(
    'SYNCHRONOUS CLOSEST-3D DISTRIBUTIONS'
);

console.log(
    '------------------------------------'
);


printClosestSummary(
    'BREAK SELF',
    synchronousDistributions.breakableSelfBreak
);


printClosestSummary(
    'BREAK LEFT',
    synchronousDistributions.breakableLeftAvailable
);


printClosestSummary(
    'CAMP CLEAR',
    synchronousDistributions.campCleared
);


printClosestSummary(
    'CAMP LEFT',
    synchronousDistributions.campLeftAvailable
);


console.log('');

console.log(
    'BREAKABLE CALIBRATION CANDIDATES'
);

console.log(
    '--------------------------------'
);


printBreakableCandidate(
    'MELEE >=95%',
    breakableMelee95
);


printBreakableCandidate(
    'HIGH PREC.',
    breakableHighPrecision
);


console.log('');

console.log(
    'CAMP CALIBRATION CANDIDATE'
);

console.log(
    '--------------------------'
);


if (
    campEngagementCandidate
) {

    console.log(
        `XY <= ${campEngagementCandidate.xyThreshold}`
        +
        ` |Z| <= ${campEngagementCandidate.verticalThreshold}`
        +
        ` episodes=${campEngagementCandidate.retainedEpisodes}`
        +
        ` clears=${campEngagementCandidate.clearDuringEpisode}`
        +
        ` clearCapture=${formatPercent(
            campEngagementCandidate.clearCaptureRate
        )}`
        +
        ` clearShare=${formatPercent(
            campEngagementCandidate.clearShare
        )}`
    );

} else {

    console.log(
        'No qualifying rule.'
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
    `Output:\n${outputPath}`
);

console.log('');


// ============================================================
// UPDATE EPISODE GEOMETRY
// ============================================================

function updateEpisodeGeometry(
    episode,
    time,
    playerPosition
) {

    const resourcePosition =
        episode.resourcePosition;


    const dx =
        playerPosition.x -
        resourcePosition.x;


    const dy =
        playerPosition.y -
        resourcePosition.y;


    const dzSigned =
        (
            playerPosition.z
            ??
            0
        )
        -
        (
            resourcePosition.z
            ??
            0
        );


    const distanceXY =
        Math.sqrt(
            dx *
            dx
            +
            dy *
            dy
        );


    const verticalDistance =
        Math.abs(
            dzSigned
        );


    const distance3D =
        Math.sqrt(
            distanceXY *
            distanceXY
            +
            verticalDistance *
            verticalDistance
        );


    const sample =
        {

            timeSeconds:
                time,

            playerPosition,

            distance3D,

            distanceXY,

            verticalDistance,

            signedVerticalDifference:
                dzSigned
        };


    episode.geometry.validSamples++;


    // --------------------------------------------------------
    // CLOSEST 3D
    // --------------------------------------------------------

    if (
        !episode.geometry.closest3D
        ||
        distance3D <
        episode
            .geometry
            .closest3D
            .distance3D
    ) {

        episode.geometry.closest3D =
            sample;
    }


    // --------------------------------------------------------
    // CLOSEST XY
    //
    // Retains the vertical separation AT THE SAME SAMPLE.
    // --------------------------------------------------------

    if (
        !episode.geometry.closestXY
        ||
        distanceXY <
        episode
            .geometry
            .closestXY
            .distanceXY
    ) {

        episode.geometry.closestXY =
            sample;
    }


    // --------------------------------------------------------
    // LOWEST VERTICAL SEPARATION
    //
    // Retains the horizontal separation AT THE SAME SAMPLE.
    // --------------------------------------------------------

    if (
        !episode.geometry.lowestVertical
        ||
        verticalDistance <
        episode
            .geometry
            .lowestVertical
            .verticalDistance
    ) {

        episode.geometry.lowestVertical =
            sample;
    }


    // --------------------------------------------------------
    // MINIMUM VERTICAL SEPARATION OBSERVED WHILE WITHIN EACH
    // XY THRESHOLD.
    //
    // This gives us a legitimate joint XY + Z test.
    // --------------------------------------------------------

    const xyThresholds =
        episode.objectKind ===
            'CAMP'

            ? CAMP_XY_THRESHOLDS

            : BREAKABLE_XY_THRESHOLDS;


    for (
        const threshold
        of xyThresholds
    ) {

        if (
            distanceXY >
            threshold
        ) {

            continue;
        }


        const key =
            String(
                threshold
            );


        const current =
            episode
                .geometry
                .minVerticalWithinXY[
                    key
                ];


        if (
            current ===
                null
            ||
            verticalDistance <
            current.verticalDistance
        ) {

            episode
                .geometry
                .minVerticalWithinXY[
                    key
                ] =
                sample;
        }
    }
}


// ============================================================
// JOINT THRESHOLD
// ============================================================

function episodePassesJointThreshold(
    episode,
    xyThreshold,
    verticalThreshold
) {

    const sample =
        episode
            ?.geometry
            ?.minVerticalWithinXY
            ?.[
                String(
                    xyThreshold
                )
            ];


    if (
        !sample
    ) {

        return false;
    }


    return (
        sample.verticalDistance <=
        verticalThreshold
    );
}


// ============================================================
// PLAYER RULE SUMMARY
// ============================================================

function summarizePlayerRule(
    episodes,
    rule
) {

    const retained =
        episodes.filter(
            episode =>
                episodePassesJointThreshold(
                    episode,
                    rule.xyThreshold,
                    rule.verticalThreshold
                )
        );


    return {

        xyThreshold:
            rule.xyThreshold,

        verticalThreshold:
            rule.verticalThreshold,

        episodes:
            retained.length,

        outcomes:
            countBy(
                retained,
                episode =>
                    episode.outcome
            )
    };
}


// ============================================================
// SYNCHRONOUS DISTRIBUTION
// ============================================================

function summarizeClosest3D(
    episodes
) {

    return {

        count:
            episodes.length,

        distance3D:
            summarizeNumbers(
                episodes.map(
                    episode =>
                        episode
                            ?.geometry
                            ?.closest3D
                            ?.distance3D
                )
            ),

        distanceXYAtClosest3D:
            summarizeNumbers(
                episodes.map(
                    episode =>
                        episode
                            ?.geometry
                            ?.closest3D
                            ?.distanceXY
                )
            ),

        verticalAtClosest3D:
            summarizeNumbers(
                episodes.map(
                    episode =>
                        episode
                            ?.geometry
                            ?.closest3D
                            ?.verticalDistance
                )
            )
    };
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
// CONSOLE SUMMARY
// ============================================================

function printClosestSummary(
    label,
    summary
) {

    const d =
        summary.distance3D;


    const z =
        summary.verticalAtClosest3D;


    console.log(
        `${
            label.padEnd(
                12
            )
        } n=${
            String(
                summary.count
            ).padStart(
                4
            )
        } d3Med=${
            formatNumber(
                d.median
            ).padStart(
                7
            )
        } zMed=${
            formatNumber(
                z.median
            ).padStart(
                7
            )
        } zP90=${
            formatNumber(
                z.p90
            ).padStart(
                7
            )
        }`
    );
}


function printBreakableCandidate(
    label,
    row
) {

    if (
        !row
    ) {

        console.log(
            `${label}: none`
        );

        return;
    }


    console.log(
        `${
            label.padEnd(
                12
            )
        } XY<=${String(
            row.xyThreshold
        ).padStart(
            3
        )}`
        +
        ` |Z|<=${String(
            row.verticalThreshold
        ).padStart(
            3
        )}`
        +
        ` episodes=${String(
            row.retainedEpisodes
        ).padStart(
            4
        )}`
        +
        ` selfShare=${formatPercent(
            row.selfBreakShare
        )}`
        +
        ` meleeCapture=${formatPercent(
            row.meleeCapture.rate
        )}`
    );
}


// ============================================================
// COUNT BY
// ============================================================

function countBy(
    rows,
    selector
) {

    const map =
        new Map();


    for (
        const row
        of rows
    ) {

        const key =
            String(
                selector(
                    row
                )
                ??
                'UNKNOWN'
            );


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


// ============================================================
// PLAYER EXTRACTION
// ============================================================

function extractPlayerName(
    row
) {

    const value =
        row
            ?.controller
            ?.playerName;


    if (
        typeof value ===
        'string'
        &&
        value.trim()
    ) {

        return value.trim();
    }


    return null;
}


function extractAlive(
    row
) {

    if (
        typeof row
            ?.controller
            ?.alive ===
        'boolean'
    ) {

        return row
            .controller
            .alive;
    }


    const lifeState =
        finite(
            row
                ?.pawn
                ?.lifeState
        );


    if (
        lifeState !==
        null
    ) {

        return (
            lifeState ===
            0
        );
    }


    return false;
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
// FIRST EXISTING PATH
// ============================================================

function firstExistingPath(
    paths
) {

    for (
        const path
        of paths
    ) {

        if (
            existsSync(
                path
            )
        ) {

            return path;
        }
    }


    return null;
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
        1
    );
}