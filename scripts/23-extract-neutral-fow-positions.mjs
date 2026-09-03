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
    64;

const MAX_FOW_ENTRIES =
    256;

const CAMP_CLASSES =
    new Map([
        [34, 'SMALL'],
        [35, 'MEDIUM'],
        [36, 'LARGE']
    ]);


const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'neutral_fow_direct_positions.json'
    );


// ============================================================
// STORAGE
// ============================================================

const markers =
    new Map();


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    demoPacket => {

        const tick =
            Number(
                demoPacket.tick
            );


        if (
            !Number.isFinite(tick)
            ||
            tick % SAMPLE_EVERY_TICKS !== 0
        ) {

            return;
        }


        const demo =
            parser.getDemo();


        const teams =
            demo.getEntitiesByClassName(
                'CCitadelTeam'
            );


        for (
            const team
            of teams
        ) {

            const teamNum =
                numberField(
                    team,
                    'm_iTeamNum'
                );


            const teamName =
                stringField(
                    team,
                    'm_szTeamname'
                );


            for (
                let index = 0;
                index < MAX_FOW_ENTRIES;
                index++
            ) {

                const slot =
                    String(index)
                        .padStart(
                            4,
                            '0'
                        );


                const prefix =
                    `m_vecFOWEntities.${slot}`;


                const name =
                    stringField(
                        team,
                        `${prefix}.m_strEntityName`
                    );


                if (!name) {
                    continue;
                }


                const eClass =
                    numberField(
                        team,
                        `${prefix}.m_eClass`
                    );


                if (
                    !CAMP_CLASSES.has(
                        eClass
                    )
                ) {

                    continue;
                }


                const positionX =
                    numberField(
                        team,
                        `${prefix}.m_nPositionX`
                    );


                const positionY =
                    numberField(
                        team,
                        `${prefix}.m_nPositionY`
                    );


                const visible =
                    booleanField(
                        team,
                        `${prefix}.m_bVisibleOnMap`
                    );


                if (
                    !markers.has(
                        name
                    )
                ) {

                    markers.set(
                        name,
                        {
                            name,

                            eClass,

                            campTier:
                                CAMP_CLASSES.get(
                                    eClass
                                ),

                            fowIndexes:
                                new Set(),

                            teams:
                                new Set(),

                            observations:
                                0,

                            positionPairs:
                                new Map(),

                            visibleCount:
                                0,

                            hiddenCount:
                                0
                        }
                    );
                }


                const marker =
                    markers.get(
                        name
                    );


                marker.observations++;


                marker.fowIndexes.add(
                    index
                );


                marker.teams.add(
                    `${teamNum}:${teamName ?? ''}`
                );


                if (
                    visible === true
                ) {

                    marker.visibleCount++;

                } else if (
                    visible === false
                ) {

                    marker.hiddenCount++;
                }


                if (
                    Number.isFinite(
                        positionX
                    )
                    &&
                    Number.isFinite(
                        positionY
                    )
                ) {

                    const key =
                        `${positionX},${positionY}`;


                    if (
                        !marker.positionPairs.has(
                            key
                        )
                    ) {

                        marker.positionPairs.set(
                            key,
                            {
                                x:
                                    positionX,

                                y:
                                    positionY,

                                count:
                                    0,

                                visibleCount:
                                    0,

                                hiddenCount:
                                    0
                            }
                        );
                    }


                    const pair =
                        marker.positionPairs.get(
                            key
                        );


                    pair.count++;


                    if (
                        visible === true
                    ) {

                        pair.visibleCount++;

                    } else if (
                        visible === false
                    ) {

                        pair.hiddenCount++;
                    }
                }
            }
        }
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');
console.log(
    'Extracting direct neutral FOW positions...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// FORMAT
// ============================================================

const rows =
    [...markers.values()]

        .map(
            marker => {

                const positionPairs =
                    [...marker.positionPairs.values()]

                        .sort(
                            (
                                a,
                                b
                            ) =>
                                b.count -
                                a.count
                        );


                const nonZeroPairs =
                    positionPairs.filter(
                        pair =>
                            !(
                                pair.x === 0
                                &&
                                pair.y === 0
                            )
                    );


                // Prefer the most frequently observed
                // nonzero coordinate.
                //
                // Preserve all coordinates in output so we
                // don't throw away state changes.

                const preferredPosition =
                    nonZeroPairs[0]
                    ??
                    positionPairs[0]
                    ??
                    null;


                return {

                    name:
                        marker.name,

                    eClass:
                        marker.eClass,

                    campTier:
                        marker.campTier,

                    fowIndexes:
                        [...marker.fowIndexes]
                            .sort(
                                (
                                    a,
                                    b
                                ) =>
                                    a - b
                            ),

                    teams:
                        [...marker.teams]
                            .sort(),

                    observations:
                        marker.observations,

                    visibleCount:
                        marker.visibleCount,

                    hiddenCount:
                        marker.hiddenCount,

                    preferredPosition,

                    positionPairCount:
                        positionPairs.length,

                    positionPairs
                };
            }
        )

        .sort(
            (
                a,
                b
            ) => {

                const tierOrder =
                    {
                        SMALL: 1,
                        MEDIUM: 2,
                        LARGE: 3
                    };


                return (
                    tierOrder[a.campTier]
                    -
                    tierOrder[b.campTier]
                    ||
                    a.name.localeCompare(
                        b.name
                    )
                );
            }
        );


// ============================================================
// SUMMARY
// ============================================================

const summary = {

    markerCount:
        rows.length,

    byEClass:
        countValues(
            rows.map(
                row =>
                    row.eClass
            )
        ),

    byCampTier:
        countValues(
            rows.map(
                row =>
                    row.campTier
            )
        ),

    markersWithPreferredPosition:
        rows.filter(
            row =>
                row.preferredPosition
        ).length,

    markersWithNonzeroPreferredPosition:
        rows.filter(
            row =>
                row.preferredPosition
                &&
                !(
                    row.preferredPosition.x === 0
                    &&
                    row.preferredPosition.y === 0
                )
        ).length,

    markersOnlyZeroPosition:
        rows.filter(
            row =>
                row.positionPairs.length > 0
                &&
                !row.positionPairs.some(
                    pair =>
                        pair.x !== 0
                        ||
                        pair.y !== 0
                )
        )
        .map(
            row =>
                row.name
        )
};


// ============================================================
// VALIDATION
// ============================================================

const validation = {

    expectedTotal:
        38,

    expectedSmall:
        4,

    expectedMedium:
        22,

    expectedLarge:
        12,

    actualTotal:
        rows.length,

    actualSmall:
        rows.filter(
            row =>
                row.campTier ===
                'SMALL'
        ).length,

    actualMedium:
        rows.filter(
            row =>
                row.campTier ===
                'MEDIUM'
        ).length,

    actualLarge:
        rows.filter(
            row =>
                row.campTier ===
                'LARGE'
        ).length,

    pass:
        (
            rows.length === 38
            &&
            rows.filter(
                row =>
                    row.campTier ===
                    'SMALL'
            ).length === 4
            &&
            rows.filter(
                row =>
                    row.campTier ===
                    'MEDIUM'
            ).length === 22
            &&
            rows.filter(
                row =>
                    row.campTier ===
                    'LARGE'
            ).length === 12
        )
};


// ============================================================
// OUTPUT
// ============================================================

const output = {

    replay:
        replayName,

    method:
        'direct CCitadelTeam.m_vecFOWEntities m_nPositionX/m_nPositionY extraction',

    classInterpretation: {

        34:
            'SMALL',

        35:
            'MEDIUM',

        36:
            'LARGE'
    },

    classInterpretationBasis:
        'The unique marker counts for eClass 34/35/36 are exactly 4/22/12, matching the independently established Small/Medium/Large camp counts.',

    summary,

    validation,

    markers:
        rows
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

console.log(
    '===================================='
);

console.log(
    'DIRECT FOW CAMP POSITIONS'
);

console.log(
    '===================================='
);

console.log('');


console.log(
    `Markers: ${summary.markerCount}`
);

console.log(
    `Small: ${validation.actualSmall}`
);

console.log(
    `Medium: ${validation.actualMedium}`
);

console.log(
    `Large: ${validation.actualLarge}`
);

console.log('');

console.log(
    `Validation: ${
        validation.pass
            ? 'PASS'
            : 'FAIL'
    }`
);

console.log('');


// ============================================================
// PRINT MARKERS
// ============================================================

for (
    const tier
    of [
        'SMALL',
        'MEDIUM',
        'LARGE'
    ]
) {

    console.log(
        tier
    );

    console.log(
        '-'.repeat(
            tier.length
        )
    );


    for (
        const marker
        of rows.filter(
            row =>
                row.campTier ===
                tier
        )
    ) {

        const position =
            marker.preferredPosition;


        console.log(

            `${marker.name}`

            +

            (
                position

                    ? ` -> (${position.x}, ${position.y})` +
                      ` count=${position.count}`

                    : ' -> NO POSITION'
            )
        );
    }


    console.log('');
}


// ============================================================
// ZERO POSITION WARNINGS
// ============================================================

if (
    summary
        .markersOnlyZeroPosition
        .length
) {

    console.log(
        'ONLY ZERO POSITION:'
    );


    for (
        const name
        of summary
            .markersOnlyZeroPosition
    ) {

        console.log(
            `  ${name}`
        );
    }


    console.log('');
}


console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// HELPERS
// ============================================================

function numberField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    let value;


    try {

        value =
            entity.getField(
                field
            );

    } catch {

        return null;
    }


    const result =
        Number(
            value
        );


    return Number.isFinite(
        result
    )
        ? result
        : null;
}


function stringField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    let value;


    try {

        value =
            entity.getField(
                field
            );

    } catch {

        return null;
    }


    if (
        typeof value !==
        'string'
    ) {

        return null;
    }


    const trimmed =
        value.trim();


    return trimmed.length
        ? trimmed
        : null;
}


function booleanField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    let value;


    try {

        value =
            entity.getField(
                field
            );

    } catch {

        return null;
    }


    if (
        typeof value ===
        'boolean'
    ) {

        return value;
    }


    return null;
}


function countValues(
    values
) {

    const output =
        {};


    for (
        const value
        of values
    ) {

        const key =
            String(
                value
            );


        output[key] =
            (
                output[key]
                ??
                0
            )
            +
            1;
    }


    return output;
}