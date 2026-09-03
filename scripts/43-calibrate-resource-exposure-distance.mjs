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


const BREAKABLE_THRESHOLDS =
    [
        50,
        100,
        150,
        200,
        250,
        300,
        400,
        500
    ];


const CAMP_THRESHOLDS =
    [
        200,
        300,
        400,
        500,
        600,
        700,
        800
    ];


// ============================================================
// PATHS
// ============================================================

const summaryPath =
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


const outputPath =
    resolve(
        'output',
        replayName,
        'behavioral_exposure_distance_calibration.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        summaryPath,
        episodesPath
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
// LOAD SUMMARY
// ============================================================

const summary =
    JSON.parse(
        readFileSync(
            summaryPath,
            'utf8'
        )
    );


if (
    summary
        ?.validation
        ?.pass !==
    true
) {

    throw new Error(
        'behavioral_metrics_v01.json is not validation PASS.'
    );
}


// ============================================================
// CANONICAL BREAK TOTALS
// ============================================================

let canonicalMeleeBreaks =
    0;


let canonicalBulletBreaks =
    0;


let canonicalKnownBreaks =
    0;


for (
    const player
    of summary.players
    ??
    []
) {

    const actions =
        player.knownBreakableActions
        ??
        {};


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


    canonicalKnownBreaks +=
        finite(
            actions.totalKnownBreaks
        )
        ??
        0;
}


// ============================================================
// READ EPISODES
// ============================================================

const episodes =
    [];


let linesRead =
    0;


let parseFailures =
    0;


const reader =
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
    of reader
) {

    if (
        !line.trim()
    ) {

        continue;
    }


    linesRead++;


    let row;


    try {

        row =
            JSON.parse(
                line
            );

    } catch {

        parseFailures++;

        continue;
    }


    const minDistance3D =
        finite(
            row.minDistance3D
        );


    const durationSeconds =
        finite(
            row.durationSeconds
        );


    if (
        minDistance3D ===
        null
    ) {

        continue;
    }


    episodes.push({

        playerName:
            row.playerName
            ??
            'UNKNOWN',

        objectKind:
            row.objectKind
            ??
            'UNKNOWN',

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

        minDistance3D,

        minDistanceXY:
            finite(
                row.minDistanceXY
            ),

        minVerticalDistance:
            finite(
                row.minVerticalDistance
            ),

        startDistance3D:
            finite(
                row.startDistance3D
            ),

        durationSeconds,

        sampleCount:
            finite(
                row.sampleCount
            ),

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
            null
    });
}


// ============================================================
// PRIMARY GROUPS
// ============================================================

const breakableEpisodes =
    episodes.filter(
        row =>
            row.objectKind ===
            'BREAKABLE'
    );


const crateEpisodes =
    breakableEpisodes.filter(
        row =>
            row.subtype ===
            'CRATE'
    );


const statueEpisodes =
    breakableEpisodes.filter(
        row =>
            row.subtype ===
            'GOLDEN_STATUE'
    );


const campEpisodes =
    episodes.filter(
        row =>
            row.objectKind ===
            'CAMP'
    );


// ============================================================
// GLOBAL DISTANCE DISTRIBUTIONS
// ============================================================

const distanceDistributions =
    {

        allBreakables:
            summarizeEpisodeGroup(
                breakableEpisodes
            ),

        crates:
            summarizeEpisodeGroup(
                crateEpisodes
            ),

        goldenStatues:
            summarizeEpisodeGroup(
                statueEpisodes
            ),

        camps:
            summarizeEpisodeGroup(
                campEpisodes
            ),

        breakableOutcomes:
            buildOutcomeDistributions(
                breakableEpisodes
            ),

        campOutcomes:
            buildOutcomeDistributions(
                campEpisodes
            )
    };


// ============================================================
// BREAKABLE THRESHOLD SENSITIVITY
// ============================================================

const breakableThresholds =
    [];


for (
    const threshold
    of BREAKABLE_THRESHOLDS
) {

    const retained =
        breakableEpisodes.filter(
            row =>
                row.minDistance3D <=
                threshold
        );


    const outcomes =
        countBy(
            retained,
            row =>
                row.outcome
        );


    const selfBreaks =
        retained.filter(
            row =>
                row.outcome ===
                'SELF_BREAK'
        );


    const meleeSelfBreaks =
        selfBreaks.filter(
            row =>
                row.canonicalBreakMethod ===
                'MELEE_DIRECT'
        );


    const bulletSelfBreaks =
        selfBreaks.filter(
            row =>
                row.canonicalBreakMethod ===
                'BULLET_RAY'
        );


    breakableThresholds.push({

        threshold,

        totalEpisodes:
            breakableEpisodes.length,

        retainedEpisodes:
            retained.length,

        retentionRate:
            rate(
                retained.length,
                breakableEpisodes.length
            ),

        outcomes,

        leftAvailable:
            outcomes.LEFT_AVAILABLE
            ??
            0,

        selfBreak:
            outcomes.SELF_BREAK
            ??
            0,

        breakAttributionUnknown:
            outcomes.BREAK_ATTRIBUTION_UNKNOWN
            ??
            0,

        otherPlayerBreak:
            outcomes.OTHER_PLAYER_BREAK
            ??
            0,

        selfBreakShareAmongRetained:
            rate(
                outcomes.SELF_BREAK
                ??
                0,
                retained.length
            ),

        knownBreakCapture:
            {

                totalCanonicalKnownBreaks:
                    canonicalKnownBreaks,

                capturedSelfBreakEpisodes:
                    selfBreaks.length,

                captureRate:
                    rate(
                        selfBreaks.length,
                        canonicalKnownBreaks
                    )
            },

        meleeCapture:
            {

                totalCanonicalMeleeBreaks:
                    canonicalMeleeBreaks,

                capturedMeleeSelfBreakEpisodes:
                    meleeSelfBreaks.length,

                captureRate:
                    rate(
                        meleeSelfBreaks.length,
                        canonicalMeleeBreaks
                    )
            },

        bulletCapture:
            {

                totalCanonicalBulletBreaks:
                    canonicalBulletBreaks,

                capturedBulletSelfBreakEpisodes:
                    bulletSelfBreaks.length,

                captureRate:
                    rate(
                        bulletSelfBreaks.length,
                        canonicalBulletBreaks
                    )
            }
    });
}


// ============================================================
// CAMP THRESHOLD SENSITIVITY
// ============================================================

const campThresholds =
    [];


for (
    const threshold
    of CAMP_THRESHOLDS
) {

    const retained =
        campEpisodes.filter(
            row =>
                row.minDistance3D <=
                threshold
        );


    const outcomes =
        countBy(
            retained,
            row =>
                row.outcome
        );


    const clears =
        outcomes
            .CAMP_CLEARED_DURING_EPISODE
        ??
        0;


    const left =
        outcomes.LEFT_AVAILABLE
        ??
        0;


    campThresholds.push({

        threshold,

        totalEpisodes:
            campEpisodes.length,

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

        leftAvailable:
            left,

        clearShareAmongRetained:
            rate(
                clears,
                retained.length
            )
    });
}


// ============================================================
// PLAYER-LEVEL CALIBRATION
// ============================================================

const playerNames =
    [
        ...new Set(
            episodes.map(
                row =>
                    row.playerName
            )
        )
    ]
    .sort();


const players =
    [];


for (
    const playerName
    of playerNames
) {

    const playerRows =
        episodes.filter(
            row =>
                row.playerName ===
                playerName
        );


    const playerBreakables =
        playerRows.filter(
            row =>
                row.objectKind ===
                'BREAKABLE'
        );


    const playerCamps =
        playerRows.filter(
            row =>
                row.objectKind ===
                'CAMP'
        );


    players.push({

        playerName,

        allEpisodes:
            playerRows.length,

        breakableEpisodes:
            playerBreakables.length,

        campEpisodes:
            playerCamps.length,

        breakableDistance:
            summarizeEpisodeGroup(
                playerBreakables
            ),

        campDistance:
            summarizeEpisodeGroup(
                playerCamps
            ),

        breakableAt200:
            summarizePlayerThreshold(
                playerBreakables,
                200
            ),

        breakableAt300:
            summarizePlayerThreshold(
                playerBreakables,
                300
            ),

        breakableAt500:
            summarizePlayerThreshold(
                playerBreakables,
                500
            ),

        campAt400:
            summarizePlayerThreshold(
                playerCamps,
                400
            ),

        campAt600:
            summarizePlayerThreshold(
                playerCamps,
                600
            ),

        campAt800:
            summarizePlayerThreshold(
                playerCamps,
                800
            )
    });
}


// ============================================================
// OUTCOME COMPARISON
// ============================================================

const keyOutcomeComparison =
    {

        breakableSelfBreak:
            summarizeEpisodeGroup(
                breakableEpisodes.filter(
                    row =>
                        row.outcome ===
                        'SELF_BREAK'
                )
            ),

        breakableLeftAvailable:
            summarizeEpisodeGroup(
                breakableEpisodes.filter(
                    row =>
                        row.outcome ===
                        'LEFT_AVAILABLE'
                )
            ),

        breakableUnknownBreak:
            summarizeEpisodeGroup(
                breakableEpisodes.filter(
                    row =>
                        row.outcome ===
                        'BREAK_ATTRIBUTION_UNKNOWN'
                )
            ),

        breakableOtherPlayerBreak:
            summarizeEpisodeGroup(
                breakableEpisodes.filter(
                    row =>
                        row.outcome ===
                        'OTHER_PLAYER_BREAK'
                )
            ),

        campCleared:
            summarizeEpisodeGroup(
                campEpisodes.filter(
                    row =>
                        row.outcome ===
                        'CAMP_CLEARED_DURING_EPISODE'
                )
            ),

        campLeftAvailable:
            summarizeEpisodeGroup(
                campEpisodes.filter(
                    row =>
                        row.outcome ===
                        'LEFT_AVAILABLE'
                )
            )
    };


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BEHAVIORAL_EXPOSURE_DISTANCE_CALIBRATION',

        canonical:
            false,

        purpose:
            [

                'Calibrate spatial exposure using observed minimum distance rather than arbitrarily replacing the broad episode envelope.',

                'Compare distance distributions for consumption-associated episodes versus LEFT_AVAILABLE episodes.',

                'Measure how progressively tighter distance thresholds affect canonical melee and bullet break capture.',

                'Do not classify LEFT_AVAILABLE as a mistake or missed opportunity.'
            ],

        source:
            {

                summary:
                    summaryPath,

                episodes:
                    episodesPath
            },

        sourceCounts:
            {

                linesRead,

                parseFailures,

                usableEpisodes:
                    episodes.length,

                breakableEpisodes:
                    breakableEpisodes.length,

                crateEpisodes:
                    crateEpisodes.length,

                goldenStatueEpisodes:
                    statueEpisodes.length,

                campEpisodes:
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

        distanceDistributions,

        keyOutcomeComparison,

        breakableThresholdSensitivity:
            breakableThresholds,

        campThresholdSensitivity:
            campThresholds,

        players
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

console.log('');

console.log(
    '=========================================='
);

console.log(
    'RESOURCE EXPOSURE DISTANCE CALIBRATION'
);

console.log(
    '=========================================='
);

console.log('');

console.log(
    `Episodes: ${episodes.length}`
);

console.log(
    `Breakables: ${breakableEpisodes.length}`
);

console.log(
    `Camps: ${campEpisodes.length}`
);

console.log('');

console.log(
    'CANONICAL BREAK TOTALS'
);

console.log(
    '----------------------'
);

console.log(
    `Known: ${canonicalKnownBreaks}`
);

console.log(
    `Melee: ${canonicalMeleeBreaks}`
);

console.log(
    `Bullet: ${canonicalBulletBreaks}`
);

console.log('');


// ============================================================
// KEY DISTRIBUTIONS
// ============================================================

console.log(
    'BREAKABLE MIN-DISTANCE DISTRIBUTIONS'
);

console.log(
    '------------------------------------'
);


printDistanceSummary(
    'SELF_BREAK',
    keyOutcomeComparison.breakableSelfBreak
);


printDistanceSummary(
    'LEFT_AVAILABLE',
    keyOutcomeComparison.breakableLeftAvailable
);


printDistanceSummary(
    'UNKNOWN_BREAK',
    keyOutcomeComparison.breakableUnknownBreak
);


printDistanceSummary(
    'OTHER_BREAK',
    keyOutcomeComparison.breakableOtherPlayerBreak
);


console.log('');

console.log(
    'CAMP MIN-DISTANCE DISTRIBUTIONS'
);

console.log(
    '-------------------------------'
);


printDistanceSummary(
    'CLEARED',
    keyOutcomeComparison.campCleared
);


printDistanceSummary(
    'LEFT_AVAILABLE',
    keyOutcomeComparison.campLeftAvailable
);


console.log('');


// ============================================================
// BREAKABLE THRESHOLDS
// ============================================================

console.log(
    'BREAKABLE THRESHOLD SENSITIVITY'
);

console.log(
    '-------------------------------'
);


for (
    const row
    of breakableThresholds
) {

    console.log(
        `<= ${
            String(
                row.threshold
            ).padStart(
                3
            )
        }  episodes=${
            String(
                row.retainedEpisodes
            ).padStart(
                4
            )
        }  left=${
            String(
                row.leftAvailable
            ).padStart(
                4
            )
        }  self=${
            String(
                row.selfBreak
            ).padStart(
                3
            )
        }  meleeCapture=${
            formatPercent(
                row
                    .meleeCapture
                    .captureRate
            ).padStart(
                7
            )
        }  bulletCapture=${
            formatPercent(
                row
                    .bulletCapture
                    .captureRate
            ).padStart(
                7
            )
        }`
    );
}


console.log('');


// ============================================================
// CAMP THRESHOLDS
// ============================================================

console.log(
    'CAMP THRESHOLD SENSITIVITY'
);

console.log(
    '--------------------------'
);


for (
    const row
    of campThresholds
) {

    console.log(
        `<= ${
            String(
                row.threshold
            ).padStart(
                3
            )
        }  episodes=${
            String(
                row.retainedEpisodes
            ).padStart(
                4
            )
        }  left=${
            String(
                row.leftAvailable
            ).padStart(
                4
            )
        }  clear=${
            String(
                row.clearDuringEpisode
            ).padStart(
                3
            )
        }  clearShare=${
            formatPercent(
                row.clearShareAmongRetained
            ).padStart(
                7
            )
        }`
    );
}


console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


// ============================================================
// PLAYER THRESHOLD SUMMARY
// ============================================================

function summarizePlayerThreshold(
    rows,
    threshold
) {

    const retained =
        rows.filter(
            row =>
                row.minDistance3D <=
                threshold
        );


    return {

        threshold,

        episodes:
            retained.length,

        outcomes:
            countBy(
                retained,
                row =>
                    row.outcome
            )
    };
}


// ============================================================
// OUTCOME DISTRIBUTIONS
// ============================================================

function buildOutcomeDistributions(
    rows
) {

    const output =
        {};


    const outcomes =
        [
            ...new Set(
                rows.map(
                    row =>
                        row.outcome
                )
            )
        ]
        .sort();


    for (
        const outcome
        of outcomes
    ) {

        output[
            outcome
        ] =
            summarizeEpisodeGroup(
                rows.filter(
                    row =>
                        row.outcome ===
                        outcome
                )
            );
    }


    return output;
}


// ============================================================
// EPISODE GROUP SUMMARY
// ============================================================

function summarizeEpisodeGroup(
    rows
) {

    return {

        count:
            rows.length,

        minDistance3D:
            summarizeNumbers(
                rows.map(
                    row =>
                        row.minDistance3D
                )
            ),

        minDistanceXY:
            summarizeNumbers(
                rows.map(
                    row =>
                        row.minDistanceXY
                )
            ),

        minVerticalDistance:
            summarizeNumbers(
                rows.map(
                    row =>
                        row.minVerticalDistance
                )
            ),

        durationSeconds:
            summarizeNumbers(
                rows.map(
                    row =>
                        row.durationSeconds
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

        const raw =
            selector(
                row
            );


        const key =
            String(
                raw
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
// CONSOLE DISTANCE
// ============================================================

function printDistanceSummary(
    label,
    summary
) {

    const d =
        summary.minDistance3D;


    console.log(
        `${
            label.padEnd(
                16
            )
        } n=${
            String(
                summary.count
            ).padStart(
                4
            )
        } median=${
            formatNumber(
                d.median
            ).padStart(
                8
            )
        } p25=${
            formatNumber(
                d.p25
            ).padStart(
                8
            )
        } p75=${
            formatNumber(
                d.p75
            ).padStart(
                8
            )
        } p90=${
            formatNumber(
                d.p90
            ).padStart(
                8
            )
        }`
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