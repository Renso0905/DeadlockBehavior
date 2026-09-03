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

const TICK_RATE =
    64;

const MATCH_OFFSET =
    30;


const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'neutral_fow_entries.json'
    );


// ============================================================
// FILTER
//
// We'll retain every named FOW entry in the output, but mark
// entries whose names look related to neutral resources.
// ============================================================

const RELEVANT_NAME_PATTERN =
    /neutral|sinner|vault|camp|jungle|sacrifice/i;


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// STORAGE
// ============================================================

// Unique logical FOW entry:
//
// team + array index + entity name + referenced entity index

const entries =
    new Map();


let sampledTicks =
    0;


// ============================================================
// INTERCEPTOR
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    demoPacket => {

        const tick =
            Number(
                demoPacket.tick
            );


        if (
            !Number.isFinite(
                tick
            )
            ||
            tick %
            SAMPLE_EVERY_TICKS
            !==
            0
        ) {

            return;
        }


        sampledTicks++;


        const matchTime =
            tick /
            TICK_RATE
            -
            MATCH_OFFSET;


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

            const teamEntityIndex =
                Number(
                    team.index
                );


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
                    String(
                        index
                    )
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


                if (
                    !name
                ) {

                    continue;
                }


                const referencedEntityIndex =
                    numberField(
                        team,
                        `${prefix}.m_nEntIndex`
                    );


                const eClass =
                    numberField(
                        team,
                        `${prefix}.m_eClass`
                    );


                const lane =
                    numberField(
                        team,
                        `${prefix}.m_iLane`
                    );


                const height =
                    numberField(
                        team,
                        `${prefix}.m_eHeight`
                    );


                const visibleOnMap =
                    booleanField(
                        team,
                        `${prefix}.m_bVisibleOnMap`
                    );


                const healthPercent =
                    numberField(
                        team,
                        `${prefix}.m_nHealthPercent`
                    );


                const tickHidden =
                    numberField(
                        team,
                        `${prefix}.m_nTickHidden`
                    );


                // =============================================
                // TRY TO RESOLVE REFERENCED ENTITY
                // =============================================

                let resolvedEntity =
                    null;


                if (
                    Number.isFinite(
                        referencedEntityIndex
                    )
                    &&
                    referencedEntityIndex >
                    0
                ) {

                    try {

                        resolvedEntity =
                            demo.getEntity(
                                referencedEntityIndex
                            );

                    } catch {

                        resolvedEntity =
                            null;
                    }
                }


                const resolvedPosition =
                    resolvedEntity
                        ? worldPosition(
                            resolvedEntity
                        )
                        : null;


                const resolvedClassName =
                    resolvedEntity
                        ? guessClassName(
                            resolvedEntity
                        )
                        : null;


                // =============================================
                // KEY
                // =============================================

                const key =
                    [
                        teamNum,
                        index,
                        name,
                        referencedEntityIndex
                    ]
                    .join(
                        '|'
                    );


                if (
                    !entries.has(
                        key
                    )
                ) {

                    entries.set(
                        key,
                        {

                            key,

                            teamEntityIndex,

                            teamNum,

                            teamName,

                            fowIndex:
                                index,

                            fowSlot:
                                slot,

                            name,

                            relevant:
                                RELEVANT_NAME_PATTERN
                                    .test(
                                        name
                                    ),

                            referencedEntityIndex,

                            eClass,

                            lane,

                            height,

                            firstSeenTick:
                                tick,

                            firstSeenMatchTimeSeconds:
                                matchTime,

                            lastSeenTick:
                                tick,

                            lastSeenMatchTimeSeconds:
                                matchTime,

                            observations:
                                1,

                            visibleOnMapValues:
                                new Set(),

                            healthPercentValues:
                                new Set(),

                            tickHiddenValues:
                                new Set(),

                            resolvedClassNames:
                                new Set(),

                            resolvedPositions:
                                []
                        }
                    );
                }


                const entry =
                    entries.get(
                        key
                    );


                entry.lastSeenTick =
                    tick;

                entry.lastSeenMatchTimeSeconds =
                    matchTime;

                entry.observations++;


                if (
                    visibleOnMap !==
                    null
                ) {

                    entry
                        .visibleOnMapValues
                        .add(
                            visibleOnMap
                        );
                }


                if (
                    Number.isFinite(
                        healthPercent
                    )
                ) {

                    entry
                        .healthPercentValues
                        .add(
                            healthPercent
                        );
                }


                if (
                    Number.isFinite(
                        tickHidden
                    )
                ) {

                    entry
                        .tickHiddenValues
                        .add(
                            tickHidden
                        );
                }


                if (
                    resolvedClassName
                ) {

                    entry
                        .resolvedClassNames
                        .add(
                            resolvedClassName
                        );
                }


                if (
                    resolvedPosition
                ) {

                    // Don't store thousands of duplicates.

                    const previous =
                        entry
                            .resolvedPositions
                            .at(
                                -1
                            );


                    if (
                        !previous
                        ||
                        distanceXYZ(
                            previous,
                            resolvedPosition
                        )
                        >
                        1
                    ) {

                        entry
                            .resolvedPositions
                            .push(
                                resolvedPosition
                            );
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
    'Discovering CCitadelTeam FOW entries...'
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

const formattedEntries =
    [...entries.values()]

        .map(
            entry => ({

                key:
                    entry.key,

                teamEntityIndex:
                    entry.teamEntityIndex,

                teamNum:
                    entry.teamNum,

                teamName:
                    entry.teamName,

                fowIndex:
                    entry.fowIndex,

                fowSlot:
                    entry.fowSlot,

                name:
                    entry.name,

                relevant:
                    entry.relevant,

                referencedEntityIndex:
                    entry.referencedEntityIndex,

                eClass:
                    entry.eClass,

                lane:
                    entry.lane,

                height:
                    entry.height,

                firstSeenTick:
                    entry.firstSeenTick,

                firstSeenMatchTimeSeconds:
                    entry.firstSeenMatchTimeSeconds,

                lastSeenTick:
                    entry.lastSeenTick,

                lastSeenMatchTimeSeconds:
                    entry.lastSeenMatchTimeSeconds,

                observations:
                    entry.observations,

                visibleOnMapValues:
                    [...entry.visibleOnMapValues],

                healthPercentValues:
                    [...entry.healthPercentValues]
                        .sort(
                            (
                                a,
                                b
                            ) =>
                                a - b
                        ),

                tickHiddenValues:
                    [...entry.tickHiddenValues]
                        .sort(
                            (
                                a,
                                b
                            ) =>
                                a - b
                        ),

                resolvedClassNames:
                    [...entry.resolvedClassNames],

                resolvedPositions:
                    entry.resolvedPositions
            })
        )

        .sort(
            (
                a,
                b
            ) =>
                a.teamNum -
                b.teamNum
                ||
                a.fowIndex -
                b.fowIndex
        );


// ============================================================
// RELEVANT ENTRIES
// ============================================================

const relevantEntries =
    formattedEntries.filter(
        entry =>
            entry.relevant
    );


// ============================================================
// UNIQUE NAMES
// ============================================================

const uniqueNameMap =
    new Map();


for (
    const entry
    of formattedEntries
) {

    if (
        !uniqueNameMap.has(
            entry.name
        )
    ) {

        uniqueNameMap.set(
            entry.name,
            {

                name:
                    entry.name,

                relevant:
                    entry.relevant,

                fowIndexes:
                    new Set(),

                referencedEntityIndexes:
                    new Set(),

                teams:
                    new Set(),

                eClasses:
                    new Set(),

                resolvedClassNames:
                    new Set(),

                positions:
                    []
            }
        );
    }


    const summary =
        uniqueNameMap.get(
            entry.name
        );


    summary
        .fowIndexes
        .add(
            entry.fowIndex
        );


    if (
        Number.isFinite(
            entry.referencedEntityIndex
        )
    ) {

        summary
            .referencedEntityIndexes
            .add(
                entry.referencedEntityIndex
            );
    }


    if (
        Number.isFinite(
            entry.teamNum
        )
    ) {

        summary
            .teams
            .add(
                entry.teamNum
            );
    }


    if (
        Number.isFinite(
            entry.eClass
        )
    ) {

        summary
            .eClasses
            .add(
                entry.eClass
            );
    }


    for (
        const className
        of entry.resolvedClassNames
    ) {

        summary
            .resolvedClassNames
            .add(
                className
            );
    }


    for (
        const position
        of entry.resolvedPositions
    ) {

        if (
            !summary.positions.some(
                existing =>
                    distanceXYZ(
                        existing,
                        position
                    )
                    <
                    1
            )
        ) {

            summary.positions.push(
                position
            );
        }
    }
}


const uniqueNames =
    [...uniqueNameMap.values()]

        .map(
            row => ({

                name:
                    row.name,

                relevant:
                    row.relevant,

                fowIndexes:
                    [...row.fowIndexes]
                        .sort(
                            (
                                a,
                                b
                            ) =>
                                a - b
                        ),

                referencedEntityIndexes:
                    [...row.referencedEntityIndexes]
                        .sort(
                            (
                                a,
                                b
                            ) =>
                                a - b
                        ),

                teams:
                    [...row.teams]
                        .sort(
                            (
                                a,
                                b
                            ) =>
                                a - b
                        ),

                eClasses:
                    [...row.eClasses]
                        .sort(
                            (
                                a,
                                b
                            ) =>
                                a - b
                        ),

                resolvedClassNames:
                    [...row.resolvedClassNames],

                positions:
                    row.positions
            })
        )

        .sort(
            (
                a,
                b
            ) =>
                a.name.localeCompare(
                    b.name
                )
        );


const relevantNames =
    uniqueNames.filter(
        row =>
            row.relevant
    );


// ============================================================
// OUTPUT
// ============================================================

const output = {

    replay:
        replayName,

    method:
        'CCitadelTeam.m_vecFOWEntities enumeration',

    sampledTicks,

    maxFowEntriesTested:
        MAX_FOW_ENTRIES,

    totalNamedEntries:
        formattedEntries.length,

    totalUniqueNames:
        uniqueNames.length,

    relevantEntryCount:
        relevantEntries.length,

    relevantUniqueNameCount:
        relevantNames.length,

    relevantNamePattern:
        RELEVANT_NAME_PATTERN.source,

    relevantNames,

    relevantEntries,

    uniqueNames,

    allEntries:
        formattedEntries
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
    'NAMED FOW ENTITY DISCOVERY'
);

console.log(
    '===================================='
);

console.log('');


console.log(
    `Sampled ticks: ${sampledTicks}`
);

console.log(
    `Named FOW entries: ${formattedEntries.length}`
);

console.log(
    `Unique names: ${uniqueNames.length}`
);

console.log(
    `Relevant unique names: ${relevantNames.length}`
);


console.log('');
console.log(
    'NEUTRAL / CAMP / SINNER NAMES'
);

console.log(
    '-----------------------------'
);


for (
    const row
    of relevantNames
) {

    console.log('');

    console.log(
        row.name
    );


    console.log(
        `  FOW indexes: ${row.fowIndexes.join(', ')}`
    );


    console.log(
        `  entity indexes: ${row.referencedEntityIndexes.join(', ')}`
    );


    console.log(
        `  eClass: ${row.eClasses.join(', ')}`
    );


    if (
        row.resolvedClassNames.length
    ) {

        console.log(
            `  resolved classes: ${row.resolvedClassNames.join(', ')}`
        );
    }


    if (
        row.positions.length
    ) {

        console.log(
            '  positions:'
        );


        for (
            const position
            of row.positions
        ) {

            console.log(
                `    (${format(position.x)}, ${format(position.y)}, ${format(position.z)})`
            );
        }
    }
}


console.log('');
console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// FIELD HELPERS
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


// ============================================================
// WORLD POSITION
// ============================================================

function worldPosition(
    entity
) {

    const cellX =
        numberField(
            entity,
            'CBodyComponent.m_cellX'
        );

    const cellY =
        numberField(
            entity,
            'CBodyComponent.m_cellY'
        );

    const cellZ =
        numberField(
            entity,
            'CBodyComponent.m_cellZ'
        );

    const vecX =
        numberField(
            entity,
            'CBodyComponent.m_vecX'
        );

    const vecY =
        numberField(
            entity,
            'CBodyComponent.m_vecY'
        );

    const vecZ =
        numberField(
            entity,
            'CBodyComponent.m_vecZ'
        );


    if (
        ![
            cellX,
            cellY,
            cellZ,
            vecX,
            vecY,
            vecZ
        ]
        .every(
            Number.isFinite
        )
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
            cellZ *
            512
            -
            16384
            +
            vecZ
    };
}


// ============================================================
// CLASS NAME GUESS
// ============================================================

function guessClassName(
    entity
) {

    const candidates =
        [
            entity.className,
            entity.class?.name,
            entity.schema?.className,
            entity.entityClass?.name,
            entity.constructor?.name
        ];


    for (
        const candidate
        of candidates
    ) {

        if (
            typeof candidate ===
            'string'
            &&
            candidate.length
        ) {

            return candidate;
        }
    }


    return null;
}


// ============================================================
// DISTANCE
// ============================================================

function distanceXYZ(
    a,
    b
) {

    return Math.hypot(

        a.x - b.x,

        a.y - b.y,

        a.z - b.z
    );
}


// ============================================================
// FORMAT
// ============================================================

function format(
    value
) {

    return Number.isFinite(
        value
    )
        ? value.toFixed(
            1
        )
        : '—';
}