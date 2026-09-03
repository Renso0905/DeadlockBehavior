import {
    createReadStream,
    existsSync,
    writeFileSync
} from 'node:fs';

import {
    resolve
} from 'node:path';

import readline from 'node:readline';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


const TICK_RATE =
    64;


const MATCH_CLOCK_OFFSET_SECONDS =
    30;


const MAX_EXAMPLES =
    5;


// ============================================================
// PATHS
// ============================================================

const inputPath =
    resolve(
        'output',
        replayName,
        'player_state.jsonl'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'player_state_schema_diagnostic.json'
    );


if (
    !existsSync(
        inputPath
    )
) {

    throw new Error(
        `Missing:\n${inputPath}`
    );
}


// ============================================================
// COUNTERS
// ============================================================

let totalLines =
    0;


let parsedRows =
    0;


let parseFailures =
    0;


let playerNameSuccess =
    0;


let timeSuccess =
    0;


let positionSuccess =
    0;


let allThreeSuccess =
    0;


let missingPlayerName =
    0;


let missingTime =
    0;


let missingPosition =
    0;


const rawExamples =
    [];


const extractionExamples =
    [];


const topLevelKeyCounts =
    new Map();


const positionKeyCounts =
    new Map();


// ============================================================
// READ FILE
// ============================================================

const reader =
    readline.createInterface({

        input:
            createReadStream(
                inputPath,
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


    totalLines++;


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


    parsedRows++;


    // ========================================================
    // RECORD KEYS
    // ========================================================

    for (
        const key
        of Object.keys(
            row
        )
    ) {

        increment(
            topLevelKeyCounts,
            key
        );
    }


    if (
        row.position
        &&
        typeof row.position ===
        'object'
    ) {

        for (
            const key
            of Object.keys(
                row.position
            )
        ) {

            increment(
                positionKeyCounts,
                key
            );
        }
    }


    // ========================================================
    // EXTRACT
    // ========================================================

    const playerName =
        extractPlayerName(
            row
        );


    const time =
        extractMatchTime(
            row
        );


    const position =
        extractWorldPosition(
            row
        );


    if (
        playerName
    ) {

        playerNameSuccess++;

    } else {

        missingPlayerName++;
    }


    if (
        time !==
        null
    ) {

        timeSuccess++;

    } else {

        missingTime++;
    }


    if (
        position
    ) {

        positionSuccess++;

    } else {

        missingPosition++;
    }


    if (
        playerName
        &&
        time !==
            null
        &&
        position
    ) {

        allThreeSuccess++;
    }


    // ========================================================
    // EXAMPLES
    // ========================================================

    if (
        rawExamples.length <
        MAX_EXAMPLES
    ) {

        rawExamples.push(
            row
        );
    }


    if (
        extractionExamples.length <
        MAX_EXAMPLES
    ) {

        extractionExamples.push({

            topLevelKeys:
                Object.keys(
                    row
                ),

            positionKeys:
                row.position
                &&
                typeof row.position ===
                    'object'

                    ? Object.keys(
                        row.position
                    )

                    : null,

            rawRelevantFields:
                {

                    playerName:
                        row.playerName,

                    name:
                        row.name,

                    player:
                        row.player,

                    tick:
                        row.tick,

                    replaySeconds:
                        row.replaySeconds,

                    matchTimeSeconds:
                        row.matchTimeSeconds,

                    matchTime:
                        row.matchTime,

                    gameTimeSeconds:
                        row.gameTimeSeconds,

                    position:
                        row.position,

                    worldPosition:
                        row.worldPosition
                },

            extracted:
                {

                    playerName,

                    time,

                    position
                }
        });
    }
}


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        inputPath,

        counts:
            {

                totalLines,

                parsedRows,

                parseFailures,

                playerNameSuccess,

                timeSuccess,

                positionSuccess,

                allThreeSuccess,

                missingPlayerName,

                missingTime,

                missingPosition
            },

        rates:
            {

                playerNameSuccess:
                    rate(
                        playerNameSuccess,
                        parsedRows
                    ),

                timeSuccess:
                    rate(
                        timeSuccess,
                        parsedRows
                    ),

                positionSuccess:
                    rate(
                        positionSuccess,
                        parsedRows
                    ),

                allThreeSuccess:
                    rate(
                        allThreeSuccess,
                        parsedRows
                    )
            },

        topLevelKeyCounts:
            sortedObject(
                topLevelKeyCounts
            ),

        positionKeyCounts:
            sortedObject(
                positionKeyCounts
            ),

        extractionExamples,

        rawExamples
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
    '======================================'
);

console.log(
    'PLAYER STATE SCHEMA DIAGNOSTIC'
);

console.log(
    '======================================'
);

console.log('');

console.log(
    `Parsed rows: ${parsedRows}/${totalLines}`
);

console.log('');

console.log(
    `Player name success: ${playerNameSuccess}/${parsedRows}`
);

console.log(
    `Time success:        ${timeSuccess}/${parsedRows}`
);

console.log(
    `Position success:    ${positionSuccess}/${parsedRows}`
);

console.log(
    `ALL THREE:           ${allThreeSuccess}/${parsedRows}`
);

console.log('');

console.log(
    'FAILURES'
);

console.log(
    '--------'
);

console.log(
    `Missing player name: ${missingPlayerName}`
);

console.log(
    `Missing time:        ${missingTime}`
);

console.log(
    `Missing position:    ${missingPosition}`
);

console.log('');

console.log(
    'TOP-LEVEL KEYS'
);

console.log(
    '--------------'
);


for (
    const [
        key,
        count
    ]
    of Object.entries(
        sortedObject(
            topLevelKeyCounts
        )
    )
) {

    console.log(
        `${key.padEnd(
            28
        )} ${count}`
    );
}


console.log('');

console.log(
    'POSITION KEYS'
);

console.log(
    '-------------'
);


for (
    const [
        key,
        count
    ]
    of Object.entries(
        sortedObject(
            positionKeyCounts
        )
    )
) {

    console.log(
        `${key.padEnd(
            28
        )} ${count}`
    );
}


console.log('');

console.log(
    'FIRST EXTRACTION EXAMPLE'
);

console.log(
    '------------------------'
);

console.log(
    JSON.stringify(
        extractionExamples[0],
        null,
        2
    )
);

console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


// ============================================================
// SAME EXTRACTORS AS SCRIPT 42
// ============================================================

function extractPlayerName(
    row
) {

    const candidates =
        [

            row.playerName,

            row.name,

            row
                ?.player
                ?.playerName,

            row
                ?.player
                ?.name
        ];


    for (
        const candidate
        of candidates
    ) {

        if (
            typeof candidate ===
            'string'
            &&
            candidate.trim()
        ) {

            return candidate.trim();
        }
    }


    return null;
}


// ============================================================
// MATCH TIME
// ============================================================

function extractMatchTime(
    row
) {

    const direct =
        finite(
            row.matchTimeSeconds
            ??
            row.matchTime
            ??
            row.gameTimeSeconds
        );


    if (
        direct !==
        null
    ) {

        return direct;
    }


    const replaySeconds =
        finite(
            row.replaySeconds
        );


    if (
        replaySeconds !==
        null
    ) {

        return (
            replaySeconds -
            MATCH_CLOCK_OFFSET_SECONDS
        );
    }


    const tick =
        finite(
            row.tick
        );


    if (
        tick !==
        null
    ) {

        return (
            tick /
            TICK_RATE
        )
        -
        MATCH_CLOCK_OFFSET_SECONDS;
    }


    return null;
}


// ============================================================
// WORLD POSITION
// ============================================================

function extractWorldPosition(
    row
) {

    const directCandidates =
        [

            row.worldPosition,

            row
                ?.position
                ?.worldPosition,

            row
                ?.position
                ?.world,

            (
                row.position
                &&
                row.position.x !==
                    undefined
            )
                ? row.position
                : null
        ];


    for (
        const candidate
        of directCandidates
    ) {

        const normalized =
            normalizePosition(
                candidate
            );


        if (
            normalized
        ) {

            return normalized;
        }
    }


    const position =
        row.position
        ??
        row;


    const cellX =
        finite(
            position.cellX
        );


    const cellY =
        finite(
            position.cellY
        );


    const cellZ =
        finite(
            position.cellZ
        );


    const vecX =
        finite(
            position.vecX
        );


    const vecY =
        finite(
            position.vecY
        );


    const vecZ =
        finite(
            position.vecZ
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
// NORMALIZE POSITION
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
// HELPERS
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


function sortedObject(
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