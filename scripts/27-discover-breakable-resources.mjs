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

import {
    Parser,
    InterceptorStage
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


const TICK_RATE =
    64;


// One sample per second.
//
// This script is DISCOVERY only.
// Once we identify the correct resource classes and state
// fields, the next script will track them at much finer
// resolution.
const SAMPLE_EVERY_TICKS =
    64;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const entityCatalogPath =
    resolve(
        'output',
        replayName,
        'entity_catalog.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_resource_discovery.json'
    );


// ============================================================
// CANDIDATE CLASS DISCOVERY
//
// We use the entity catalog we already generated.
//
// Do NOT assume all of these are real farm resources.
// The purpose is to make the candidate set broad enough that
// boxes/statues cannot quietly escape detection.
// ============================================================

const candidateClassNames =
    new Set([

        // Strong known candidates
        'CCitadel_PunchableNeutralGold',
        'CCitadel_BreakableProp'
    ]);


if (
    existsSync(
        entityCatalogPath
    )
) {

    const catalog =
        JSON.parse(
            readFileSync(
                entityCatalogPath,
                'utf8'
            )
        );


    collectCandidateClassNames(
        catalog,
        candidateClassNames
    );
}


// ============================================================
// FIELDS TO TEST
//
// deadem simply returns null/undefined for fields that do not
// exist on a particular class.
//
// We intentionally test a wide set.
// ============================================================

const fieldsToProbe =
    [

        // ----------------------------------------------------
        // WORLD POSITION
        // ----------------------------------------------------

        'CBodyComponent.m_cellX',
        'CBodyComponent.m_cellY',
        'CBodyComponent.m_cellZ',

        'CBodyComponent.m_vecX',
        'CBodyComponent.m_vecY',
        'CBodyComponent.m_vecZ',

        'CBodyComponent.m_angRotation',


        // ----------------------------------------------------
        // HEALTH / LIFE
        // ----------------------------------------------------

        'm_iHealth',
        'm_iMaxHealth',
        'm_lifeState',

        'm_bAlive',
        'm_bDestroyed',
        'm_bBroken',
        'm_bDisabled',
        'm_bActive',
        'm_bEnabled',

        'm_takedamage',


        // ----------------------------------------------------
        // CREATION / TIME
        // ----------------------------------------------------

        'm_flCreateTime',
        'm_flSpawnTime',
        'm_flLastSpawnTime',
        'm_flRespawnTime',
        'm_flNextRespawnTime',

        'm_flSimulationTime',
        'm_flAnimTime',


        // ----------------------------------------------------
        // STATE / FLAGS
        // ----------------------------------------------------

        'm_nState',
        'm_iState',
        'm_eState',

        'm_nSkin',
        'm_nBody',

        'm_fEffects',
        'm_fFlags',

        'm_bVisible',
        'm_bVisibleOnMap',


        // ----------------------------------------------------
        // MODEL / IDENTITY
        // ----------------------------------------------------

        'm_nModelIndex',
        'm_ModelName',
        'm_iszModelName',

        'm_iName',
        'm_iszName',

        'm_target',
        'm_targetname',

        'm_strEntityName',

        'm_nSubclassID',
        'm_iSubclassID',

        'm_nVariant',
        'm_iVariant',

        'm_nType',
        'm_iType'
    ];


// ============================================================
// STORAGE
// ============================================================

const classStats =
    new Map();


const entityRecords =
    new Map();


let sampledTicks =
    0;


let firstDemoTick =
    null;


let lastDemoTick =
    null;


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// SAMPLE CURRENT ENTITY STATE
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
        ) {

            return;
        }


        if (
            tick %
            SAMPLE_EVERY_TICKS !==
            0
        ) {

            return;
        }


        sampledTicks++;


        if (
            firstDemoTick ===
            null
        ) {

            firstDemoTick =
                tick;
        }


        lastDemoTick =
            tick;


        const replaySeconds =
            tick /
            TICK_RATE;


        const demo =
            parser.getDemo();


        // Track which entities are currently present during
        // this sample so we can detect disappear/reappear
        // behavior.

        const presentThisSample =
            new Set();


        for (
            const className
            of candidateClassNames
        ) {

            let entities;


            try {

                entities =
                    demo.getEntitiesByClassName(
                        className
                    );

            } catch {

                continue;
            }


            if (
                !Array.isArray(
                    entities
                )
                ||
                entities.length ===
                0
            ) {

                continue;
            }


            const stats =
                getOrCreateClassStats(
                    className
                );


            stats.samplesWithEntities++;


            stats.maxSimultaneousEntities =
                Math.max(
                    stats.maxSimultaneousEntities,
                    entities.length
                );


            for (
                const entity
                of entities
            ) {

                const entityIndex =
                    getEntityIndex(
                        entity
                    );


                if (
                    entityIndex ===
                    null
                ) {

                    continue;
                }


                const key =
                    `${className}|${entityIndex}`;


                presentThisSample.add(
                    key
                );


                stats.entityIndexes.add(
                    entityIndex
                );


                const snapshot =
                    snapshotEntity(
                        entity
                    );


                const record =
                    getOrCreateEntityRecord(
                        className,
                        entityIndex
                    );


                // --------------------------------------------
                // FIRST OBSERVATION
                // --------------------------------------------

                if (
                    record.firstSeenTick ===
                    null
                ) {

                    record.firstSeenTick =
                        tick;

                    record.firstSeenReplaySeconds =
                        replaySeconds;

                    record.firstSnapshot =
                        snapshot;
                }


                record.lastSeenTick =
                    tick;


                record.lastSeenReplaySeconds =
                    replaySeconds;


                record.sampleCount++;


                // --------------------------------------------
                // PRESENT / ABSENT LIFECYCLE
                // --------------------------------------------

                if (
                    record.present ===
                    false
                ) {

                    record.presenceTransitions.push({

                        type:
                            'ABSENT_TO_PRESENT',

                        tick,

                        replaySeconds
                    });
                }


                record.present =
                    true;


                // --------------------------------------------
                // POSITION
                // --------------------------------------------

                const position =
                    extractWorldPosition(
                        snapshot
                    );


                if (
                    position
                ) {

                    record.positions.push(
                        position
                    );


                    record.minX =
                        minFinite(
                            record.minX,
                            position.x
                        );


                    record.maxX =
                        maxFinite(
                            record.maxX,
                            position.x
                        );


                    record.minY =
                        minFinite(
                            record.minY,
                            position.y
                        );


                    record.maxY =
                        maxFinite(
                            record.maxY,
                            position.y
                        );


                    record.minZ =
                        minFinite(
                            record.minZ,
                            position.z
                        );


                    record.maxZ =
                        maxFinite(
                            record.maxZ,
                            position.z
                        );
                }


                // --------------------------------------------
                // FIELD AVAILABILITY
                // --------------------------------------------

                for (
                    const [
                        field,
                        value
                    ]
                    of Object.entries(
                        snapshot.fields
                    )
                ) {

                    if (
                        value !==
                        null
                        &&
                        value !==
                        undefined
                    ) {

                        stats.fieldsObserved.add(
                            field
                        );
                    }
                }


                // --------------------------------------------
                // STATE CHANGES
                // --------------------------------------------

                if (
                    record.lastSnapshot
                ) {

                    const changes =
                        diffSnapshots(
                            record.lastSnapshot,
                            snapshot
                        );


                    if (
                        changes.length >
                        0
                    ) {

                        record.stateChanges.push({

                            tick,

                            replaySeconds,

                            changes
                        });


                        for (
                            const change
                            of changes
                        ) {

                            stats.fieldsThatChanged.add(
                                change.field
                            );
                        }
                    }
                }


                record.lastSnapshot =
                    snapshot;
            }
        }


        // ====================================================
        // DETECT PRESENT -> ABSENT
        //
        // This is intentionally sampled, not packet-perfect.
        // We only want to know whether disappearance/recreation
        // is potentially part of the resource lifecycle.
        // ====================================================

        for (
            const [
                key,
                record
            ]
            of entityRecords
        ) {

            if (
                !record.present
            ) {

                continue;
            }


            if (
                presentThisSample.has(
                    key
                )
            ) {

                continue;
            }


            record.present =
                false;


            record.presenceTransitions.push({

                type:
                    'PRESENT_TO_ABSENT',

                tick,

                replaySeconds
            });
        }
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');
console.log(
    '===================================='
);
console.log(
    'BREAKABLE RESOURCE DISCOVERY'
);
console.log(
    '===================================='
);
console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Candidate classes: ${candidateClassNames.size}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// FINALIZE CLASS SUMMARIES
// ============================================================

const classes =
    [];


for (
    const [
        className,
        stats
    ]
    of classStats
) {

    const records =
        [...entityRecords.values()]
            .filter(
                record =>
                    record.className ===
                    className
            );


    const positions =
        records
            .map(
                record =>
                    canonicalPosition(
                        record.positions
                    )
            )
            .filter(
                Boolean
            );


    classes.push({

        className,

        uniqueEntityCount:
            stats.entityIndexes.size,

        maxSimultaneousEntities:
            stats.maxSimultaneousEntities,

        samplesWithEntities:
            stats.samplesWithEntities,

        fieldsObserved:
            [...stats.fieldsObserved]
                .sort(),

        fieldsThatChanged:
            [...stats.fieldsThatChanged]
                .sort(),

        entitiesWithPresenceTransitions:
            records.filter(
                record =>
                    record
                        .presenceTransitions
                        .length >
                    0
            ).length,

        entitiesWithStateChanges:
            records.filter(
                record =>
                    record
                        .stateChanges
                        .length >
                    0
            ).length,

        positionSummary:
            summarizePositions(
                positions
            )
    });
}


classes.sort(
    (
        a,
        b
    ) =>
        b.uniqueEntityCount -
        a.uniqueEntityCount
        ||
        a.className.localeCompare(
            b.className
        )
);


// ============================================================
// FINALIZE ENTITIES
// ============================================================

const entities =
    [...entityRecords.values()]
        .map(
            record => ({

                className:
                    record.className,

                entityIndex:
                    record.entityIndex,

                firstSeenTick:
                    record.firstSeenTick,

                firstSeenReplaySeconds:
                    record.firstSeenReplaySeconds,

                lastSeenTick:
                    record.lastSeenTick,

                lastSeenReplaySeconds:
                    record.lastSeenReplaySeconds,

                sampleCount:
                    record.sampleCount,

                canonicalPosition:
                    canonicalPosition(
                        record.positions
                    ),

                positionRange: {

                    minX:
                        record.minX,

                    maxX:
                        record.maxX,

                    minY:
                        record.minY,

                    maxY:
                        record.maxY,

                    minZ:
                        record.minZ,

                    maxZ:
                        record.maxZ
                },

                firstSnapshot:
                    record.firstSnapshot,

                lastSnapshot:
                    record.lastSnapshot,

                presenceTransitionCount:
                    record
                        .presenceTransitions
                        .length,

                presenceTransitions:
                    record
                        .presenceTransitions,

                stateChangeCount:
                    record
                        .stateChanges
                        .length,

                stateChanges:
                    record
                        .stateChanges
                        .slice(
                            0,
                            100
                        )
            })
        )

        .sort(
            (
                a,
                b
            ) =>
                a.className.localeCompare(
                    b.className
                )
                ||
                a.entityIndex -
                b.entityIndex
        );


// ============================================================
// STRONG CANDIDATES
//
// These aren't declared to be boxes/statues yet.
//
// This simply ranks classes/entities with characteristics that
// would make them interesting:
// - many persistent map locations
// - state changes
// - disappearance/reappearance
// - health/life fields
// ============================================================

const strongCandidates =
    classes

        .map(
            row => {

                let score =
                    0;


                const changed =
                    new Set(
                        row.fieldsThatChanged
                    );


                const observed =
                    new Set(
                        row.fieldsObserved
                    );


                if (
                    /punch|break|gold|statue|crate|box/i
                    .test(
                        row.className
                    )
                ) {

                    score +=
                        5;
                }


                if (
                    observed.has(
                        'm_iHealth'
                    )
                ) {

                    score +=
                        3;
                }


                if (
                    changed.has(
                        'm_iHealth'
                    )
                ) {

                    score +=
                        5;
                }


                if (
                    changed.has(
                        'm_lifeState'
                    )
                ) {

                    score +=
                        5;
                }


                if (
                    row.entitiesWithPresenceTransitions >
                    0
                ) {

                    score +=
                        3;
                }


                if (
                    row.uniqueEntityCount >
                    10
                ) {

                    score +=
                        2;
                }


                return {

                    score,

                    ...row
                };
            }
        )

        .sort(
            (
                a,
                b
            ) =>
                b.score -
                a.score
                ||
                b.uniqueEntityCount -
                a.uniqueEntityCount
        );


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        method:
            'Broad candidate-class discovery with 1-second sampled entity presence, state-field changes, and persistent world positions',

        sampling: {

            tickRate:
                TICK_RATE,

            sampleEveryTicks:
                SAMPLE_EVERY_TICKS,

            sampleEverySeconds:
                SAMPLE_EVERY_TICKS /
                TICK_RATE,

            sampledTicks,

            firstDemoTick,

            lastDemoTick
        },

        candidateClassNames:
            [...candidateClassNames]
                .sort(),

        summary: {

            candidateClassesRequested:
                candidateClassNames.size,

            candidateClassesObserved:
                classes.length,

            candidateEntitiesObserved:
                entities.length
        },

        strongCandidates,

        classes,

        entities
    };


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
// CONSOLE SUMMARY
// ============================================================

console.log(
    'OBSERVED CANDIDATE CLASSES'
);

console.log(
    '--------------------------'
);


if (
    classes.length ===
    0
) {

    console.log(
        'No candidate classes observed.'
    );

} else {

    for (
        const row
        of strongCandidates
    ) {

        console.log('');

        console.log(
            `${row.className}`
        );

        console.log(
            `  score: ${row.score}`
        );

        console.log(
            `  unique entities: ${row.uniqueEntityCount}`
        );

        console.log(
            `  max simultaneous: ${row.maxSimultaneousEntities}`
        );

        console.log(
            `  entities with state changes: ${row.entitiesWithStateChanges}`
        );

        console.log(
            `  entities with presence transitions: ${row.entitiesWithPresenceTransitions}`
        );


        if (
            row.fieldsThatChanged.length >
            0
        ) {

            console.log(
                `  changing fields: ${row.fieldsThatChanged.join(', ')}`
            );

        } else {

            console.log(
                '  changing fields: none observed'
            );
        }
    }
}


console.log('');
console.log(
    `Candidate entities observed: ${entities.length}`
);

console.log('');
console.log(
    `Output:\n${outputPath}`
);
console.log('');


await parser.dispose();


// ============================================================
// CLASS NAME DISCOVERY
// ============================================================

function collectCandidateClassNames(
    value,
    outputSet
) {

    if (
        typeof value ===
        'string'
    ) {

        if (
            looksLikeCandidateClassName(
                value
            )
        ) {

            outputSet.add(
                value
            );
        }


        return;
    }


    if (
        Array.isArray(
            value
        )
    ) {

        for (
            const item
            of value
        ) {

            collectCandidateClassNames(
                item,
                outputSet
            );
        }


        return;
    }


    if (
        !value
        ||
        typeof value !==
        'object'
    ) {

        return;
    }


    for (
        const [
            key,
            child
        ]
        of Object.entries(
            value
        )
    ) {

        if (
            looksLikeCandidateClassName(
                key
            )
        ) {

            outputSet.add(
                key
            );
        }


        collectCandidateClassNames(
            child,
            outputSet
        );
    }
}


function looksLikeCandidateClassName(
    value
) {

    if (
        typeof value !==
        'string'
    ) {

        return false;
    }


    // Source-style entity class names.
    if (
        !/^C[A-Za-z0-9_]+$/
        .test(
            value
        )
    ) {

        return false;
    }


    return (
        /break/i.test(value)
        ||
        /punch/i.test(value)
        ||
        /statue/i.test(value)
        ||
        /neutralgold/i.test(value)
        ||
        /gold/i.test(value)
        ||
        /crate/i.test(value)
        ||
        /loot/i.test(value)
        ||
        /box/i.test(value)
    );
}


// ============================================================
// CLASS STATS
// ============================================================

function getOrCreateClassStats(
    className
) {

    if (
        !classStats.has(
            className
        )
    ) {

        classStats.set(
            className,
            {

                className,

                entityIndexes:
                    new Set(),

                maxSimultaneousEntities:
                    0,

                samplesWithEntities:
                    0,

                fieldsObserved:
                    new Set(),

                fieldsThatChanged:
                    new Set()
            }
        );
    }


    return classStats.get(
        className
    );
}


// ============================================================
// ENTITY RECORD
// ============================================================

function getOrCreateEntityRecord(
    className,
    entityIndex
) {

    const key =
        `${className}|${entityIndex}`;


    if (
        !entityRecords.has(
            key
        )
    ) {

        entityRecords.set(
            key,
            {

                className,

                entityIndex,

                firstSeenTick:
                    null,

                firstSeenReplaySeconds:
                    null,

                lastSeenTick:
                    null,

                lastSeenReplaySeconds:
                    null,

                sampleCount:
                    0,

                present:
                    false,

                firstSnapshot:
                    null,

                lastSnapshot:
                    null,

                positions:
                    [],

                minX:
                    null,

                maxX:
                    null,

                minY:
                    null,

                maxY:
                    null,

                minZ:
                    null,

                maxZ:
                    null,

                presenceTransitions:
                    [],

                stateChanges:
                    []
            }
        );
    }


    return entityRecords.get(
        key
    );
}


// ============================================================
// ENTITY INDEX
// ============================================================

function getEntityIndex(
    entity
) {

    const candidates =
        [

            entity?.entityIndex,
            entity?.index,
            entity?.entIndex,
            entity?.id
        ];


    for (
        const value
        of candidates
    ) {

        const number =
            toFiniteNumber(
                value
            );


        if (
            number !==
            null
        ) {

            return number;
        }
    }


    // Some deadem entity implementations expose getIndex().
    if (
        typeof entity?.getIndex ===
        'function'
    ) {

        try {

            const number =
                toFiniteNumber(
                    entity.getIndex()
                );


            if (
                number !==
                null
            ) {

                return number;
            }

        } catch {
            // Ignore.
        }
    }


    return null;
}


// ============================================================
// SNAPSHOT
// ============================================================

function snapshotEntity(
    entity
) {

    const fields =
        {};


    for (
        const field
        of fieldsToProbe
    ) {

        fields[field] =
            safeGetField(
                entity,
                field
            );
    }


    return {
        fields
    };
}


// ============================================================
// FIELD READ
// ============================================================

function safeGetField(
    entity,
    field
) {

    try {

        const value =
            entity.getField(
                field
            );


        if (
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
            'number'
            ||
            typeof value ===
            'string'
            ||
            typeof value ===
            'boolean'
            ||
            value ===
            null
        ) {

            return value;
        }


        // Avoid serializing giant nested engine objects.
        return String(
            value
        );

    } catch {

        return null;
    }
}


// ============================================================
// SNAPSHOT DIFFERENCE
// ============================================================

function diffSnapshots(
    previous,
    current
) {

    const changes =
        [];


    for (
        const field
        of fieldsToProbe
    ) {

        const before =
            previous
                .fields
                ?.[field];


        const after =
            current
                .fields
                ?.[field];


        if (
            valuesEquivalent(
                before,
                after
            )
        ) {

            continue;
        }


        // Ignore position-related churn here.
        //
        // Position range is analyzed separately.
        if (
            field.startsWith(
                'CBodyComponent.'
            )
        ) {

            continue;
        }


        // Simulation/animation times naturally change every
        // update and would swamp the useful output.
        if (
            field ===
                'm_flSimulationTime'
            ||
            field ===
                'm_flAnimTime'
        ) {

            continue;
        }


        changes.push({

            field,

            before,

            after
        });
    }


    return changes;
}


// ============================================================
// VALUE EQUALITY
// ============================================================

function valuesEquivalent(
    a,
    b
) {

    if (
        a === b
    ) {

        return true;
    }


    const numberA =
        toFiniteNumber(
            a
        );


    const numberB =
        toFiniteNumber(
            b
        );


    if (
        numberA !==
        null
        &&
        numberB !==
        null
    ) {

        return (
            Math.abs(
                numberA -
                numberB
            )
            <
            0.000001
        );
    }


    return false;
}


// ============================================================
// POSITION
//
// Same transform we validated for player/neutral world state.
//
// world = cell * 512 - 16384 + vec
// ============================================================

function extractWorldPosition(
    snapshot
) {

    const fields =
        snapshot.fields;


    const cellX =
        toFiniteNumber(
            fields[
                'CBodyComponent.m_cellX'
            ]
        );


    const cellY =
        toFiniteNumber(
            fields[
                'CBodyComponent.m_cellY'
            ]
        );


    const cellZ =
        toFiniteNumber(
            fields[
                'CBodyComponent.m_cellZ'
            ]
        );


    const vecX =
        toFiniteNumber(
            fields[
                'CBodyComponent.m_vecX'
            ]
        );


    const vecY =
        toFiniteNumber(
            fields[
                'CBodyComponent.m_vecY'
            ]
        );


    const vecZ =
        toFiniteNumber(
            fields[
                'CBodyComponent.m_vecZ'
            ]
        );


    if (
        cellX ===
        null
        ||
        cellY ===
        null
        ||
        cellZ ===
        null
        ||
        vecX ===
        null
        ||
        vecY ===
        null
        ||
        vecZ ===
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
            cellZ *
            512
            -
            16384
            +
            vecZ
    };
}


// ============================================================
// CANONICAL POSITION
// ============================================================

function canonicalPosition(
    positions
) {

    if (
        !Array.isArray(
            positions
        )
        ||
        positions.length ===
        0
    ) {

        return null;
    }


    const xs =
        positions
            .map(
                point =>
                    point.x
            )
            .filter(
                Number.isFinite
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    a - b
            );


    const ys =
        positions
            .map(
                point =>
                    point.y
            )
            .filter(
                Number.isFinite
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    a - b
            );


    const zs =
        positions
            .map(
                point =>
                    point.z
            )
            .filter(
                Number.isFinite
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    a - b
            );


    if (
        xs.length ===
        0
        ||
        ys.length ===
        0
    ) {

        return null;
    }


    return {

        x:
            median(
                xs
            ),

        y:
            median(
                ys
            ),

        z:
            zs.length
                ? median(
                    zs
                )
                : null
    };
}


// ============================================================
// POSITION SUMMARY
// ============================================================

function summarizePositions(
    positions
) {

    if (
        positions.length ===
        0
    ) {

        return {

            count:
                0,

            minX:
                null,

            maxX:
                null,

            minY:
                null,

            maxY:
                null,

            minZ:
                null,

            maxZ:
                null
        };
    }


    const xs =
        positions
            .map(
                point =>
                    point.x
            );


    const ys =
        positions
            .map(
                point =>
                    point.y
            );


    const zs =
        positions
            .map(
                point =>
                    point.z
            )
            .filter(
                Number.isFinite
            );


    return {

        count:
            positions.length,

        minX:
            Math.min(
                ...xs
            ),

        maxX:
            Math.max(
                ...xs
            ),

        minY:
            Math.min(
                ...ys
            ),

        maxY:
            Math.max(
                ...ys
            ),

        minZ:
            zs.length
                ? Math.min(
                    ...zs
                )
                : null,

        maxZ:
            zs.length
                ? Math.max(
                    ...zs
                )
                : null
    };
}


// ============================================================
// NUMBER HELPERS
// ============================================================

function toFiniteNumber(
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


function minFinite(
    current,
    value
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return current;
    }


    if (
        !Number.isFinite(
            current
        )
    ) {

        return value;
    }


    return Math.min(
        current,
        value
    );
}


function maxFinite(
    current,
    value
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return current;
    }


    if (
        !Number.isFinite(
            current
        )
    ) {

        return value;
    }


    return Math.max(
        current,
        value
    );
}


// ============================================================
// MEDIAN
// ============================================================

function median(
    sorted
) {

    if (
        sorted.length ===
        0
    ) {

        return null;
    }


    const midpoint =
        Math.floor(
            sorted.length /
            2
        );


    if (
        sorted.length %
        2 ===
        1
    ) {

        return sorted[
            midpoint
        ];
    }


    return (
        sorted[
            midpoint - 1
        ]
        +
        sorted[
            midpoint
        ]
    )
    /
    2;
}