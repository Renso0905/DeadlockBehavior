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


const MATCH_CLOCK_OFFSET_SECONDS =
    30;


// ============================================================
// DISCOVERY LIMITS
// ============================================================

const MAX_FULL_FIELD_NAMES =
    600;


const MAX_CHANGE_SHAPE_SAMPLES =
    20;


const MAX_EXAMPLES_PER_FIELD =
    30;


const MAX_TRANSITION_EXAMPLES_PER_FIELD =
    30;


const MAX_RAW_CHANGE_FIELDS =
    500;


// Console progress.
const PROGRESS_EVERY_TROOPER_EVENTS =
    1_000_000;


// ============================================================
// FIELD FILTERS
// ============================================================

// Broad on purpose.
//
// "state" is noisy, but useful during initial discovery.
const INTERESTING_FIELD_PATTERN =
    /health|life|dead|death|alive|state|damage|kill|spawn|respawn|team|lane|soul|gold|bounty|trooper|npc/i;


// These are especially likely to describe death/liveness.
const DEATH_FIELD_PATTERN =
    /health|life|dead|death|alive|kill|respawn/i;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'trooper_death_field_discovery.json'
    );


if (
    !existsSync(
        replayPath
    )
) {

    throw new Error(
        `Missing replay:\n${replayPath}`
    );
}


// ============================================================
// GLOBAL COUNTERS
// ============================================================

let trooperEvents =
    0;


let trooperCreates =
    0;


let trooperUpdates =
    0;


let trooperLeaves =
    0;


let trooperDeletes =
    0;


let updateEventsWithChanges =
    0;


let updateEventsWithoutChanges =
    0;


let totalChangeRecords =
    0;


// ============================================================
// TROOPER ENTITY INDEXES
// ============================================================

const trooperIndexes =
    new Set();


// ============================================================
// FULL FIELD-NAME DISCOVERY
// ============================================================

const fullFieldNames =
    new Set();


const interestingFullFieldNames =
    new Set();


const deathLikeFullFieldNames =
    new Set();


let capturedFullFields =
    false;


// ============================================================
// CHANGE FIELD COUNTS
// ============================================================

const changeFieldCounts =
    new Map();


const interestingChangeFieldCounts =
    new Map();


const deathLikeChangeFieldCounts =
    new Map();


// ============================================================
// FIELD VALUE EXAMPLES
// ============================================================

const fieldExamples =
    new Map();


// ============================================================
// FIELD TRANSITION STATS
//
// field name -> stats
// ============================================================

const transitionStats =
    new Map();


// ============================================================
// PREVIOUS VALUES
//
// entityIndex -> Map(fieldName -> value)
//
// Only fields that actually change are retained.
// ============================================================

const previousValuesByEntity =
    new Map();


// ============================================================
// RAW getChanges() SHAPE SAMPLES
// ============================================================

const changeShapeSamples =
    [];


// ============================================================
// CREATE / LEAVE / DELETE OBSERVATIONS
// ============================================================

const lifecycleSamples =
    {

        CREATE:
            [],

        LEAVE:
            [],

        DELETE:
            []
    };


const MAX_LIFECYCLE_SAMPLES =
    30;


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// ENTITY PACKET
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.ENTITY_PACKET,

    (
        demoPacket,
        messagePacket,
        events
    ) => {

        const tick =
            finite(
                demoPacket?.tick
            );


        if (
            tick ===
            null
        ) {

            return;
        }


        for (
            const event
            of events
            ??
            []
        ) {

            const entity =
                event.entity;


            if (
                !entity
            ) {

                continue;
            }


            const className =
                getEntityClassName(
                    entity
                );


            if (
                className !==
                'CNPC_Trooper'
            ) {

                continue;
            }


            trooperEvents++;


            if (
                trooperEvents %
                    PROGRESS_EVERY_TROOPER_EVENTS ===
                0
            ) {

                console.log(
                    `Trooper events: ${trooperEvents.toLocaleString()}`
                    +
                    ` | change fields: ${changeFieldCounts.size}`
                    +
                    ` | death-like fields: ${deathLikeChangeFieldCounts.size}`
                );
            }


            const operation =
                normalizeOperation(
                    event.operation
                );


            const entityIndex =
                getEntityIndex(
                    entity
                );


            if (
                entityIndex !==
                null
            ) {

                trooperIndexes.add(
                    entityIndex
                );
            }


            if (
                operation ===
                'CREATE'
            ) {

                trooperCreates++;
            }


            if (
                operation ===
                'UPDATE'
            ) {

                trooperUpdates++;
            }


            if (
                operation ===
                'LEAVE'
            ) {

                trooperLeaves++;
            }


            if (
                operation ===
                'DELETE'
            ) {

                trooperDeletes++;
            }


            // =================================================
            // FULL FIELD CATALOG
            //
            // Capture from one stable Trooper observation.
            // =================================================

            if (
                !capturedFullFields
            ) {

                const entries =
                    getFieldEntries(
                        entity
                    );


                if (
                    entries.length >
                    0
                ) {

                    capturedFullFields =
                        true;


                    for (
                        const [
                            fieldName
                        ]
                        of entries.slice(
                            0,
                            MAX_FULL_FIELD_NAMES
                        )
                    ) {

                        fullFieldNames.add(
                            fieldName
                        );


                        if (
                            INTERESTING_FIELD_PATTERN.test(
                                fieldName
                            )
                        ) {

                            interestingFullFieldNames.add(
                                fieldName
                            );
                        }


                        if (
                            DEATH_FIELD_PATTERN.test(
                                fieldName
                            )
                        ) {

                            deathLikeFullFieldNames.add(
                                fieldName
                            );
                        }
                    }


                    console.log('');

                    console.log(
                        `Captured ${entries.length} Trooper fields.`
                    );

                    console.log(
                        `Interesting names: ${interestingFullFieldNames.size}`
                    );

                    console.log(
                        `Death-like names: ${deathLikeFullFieldNames.size}`
                    );

                    console.log('');
                }
            }


            // =================================================
            // LIFECYCLE SAMPLE
            // =================================================

            if (
                operation !==
                'UPDATE'
                &&
                lifecycleSamples[
                    operation
                ]
                &&
                lifecycleSamples[
                    operation
                ].length <
                    MAX_LIFECYCLE_SAMPLES
            ) {

                lifecycleSamples[
                    operation
                ].push({

                    tick,

                    timeSeconds:
                        tickToMatchTime(
                            tick
                        ),

                    clock:
                        formatClock(
                            tickToMatchTime(
                                tick
                            )
                        ),

                    entityIndex,

                    operation,

                    interestingState:
                        readInterestingState(
                            entity
                        )
                });
            }


            // =================================================
            // UPDATE CHANGES
            // =================================================

            if (
                operation !==
                'UPDATE'
            ) {

                // Do not preserve stale state across PVS loss.
                if (
                    (
                        operation ===
                        'LEAVE'
                        ||
                        operation ===
                        'DELETE'
                    )
                    &&
                    entityIndex !==
                        null
                ) {

                    previousValuesByEntity.delete(
                        entityIndex
                    );
                }


                continue;
            }


            const rawChanges =
                safeGetChanges(
                    event
                );


            if (
                changeShapeSamples.length <
                    MAX_CHANGE_SHAPE_SAMPLES
            ) {

                changeShapeSamples.push({

                    tick,

                    entityIndex,

                    rawType:
                        describeValueType(
                            rawChanges
                        ),

                    raw:
                        serialize(
                            rawChanges
                        )
                });
            }


            const changes =
                normalizeChanges(
                    rawChanges
                );


            if (
                changes.length ===
                0
            ) {

                updateEventsWithoutChanges++;

                continue;
            }


            updateEventsWithChanges++;


            totalChangeRecords +=
                changes.length;


            // =================================================
            // ENTITY PREVIOUS VALUE MAP
            // =================================================

            let entityPrevious =
                null;


            if (
                entityIndex !==
                null
            ) {

                if (
                    !previousValuesByEntity.has(
                        entityIndex
                    )
                ) {

                    previousValuesByEntity.set(
                        entityIndex,
                        new Map()
                    );
                }


                entityPrevious =
                    previousValuesByEntity.get(
                        entityIndex
                    );
            }


            // =================================================
            // PROCESS CHANGED FIELDS
            // =================================================

            for (
                const change
                of changes.slice(
                    0,
                    MAX_RAW_CHANGE_FIELDS
                )
            ) {

                const fieldName =
                    change.fieldName;


                if (
                    !fieldName
                ) {

                    continue;
                }


                increment(
                    changeFieldCounts,
                    fieldName
                );


                const interesting =
                    INTERESTING_FIELD_PATTERN.test(
                        fieldName
                    );


                const deathLike =
                    DEATH_FIELD_PATTERN.test(
                        fieldName
                    );


                if (
                    interesting
                ) {

                    increment(
                        interestingChangeFieldCounts,
                        fieldName
                    );
                }


                if (
                    deathLike
                ) {

                    increment(
                        deathLikeChangeFieldCounts,
                        fieldName
                    );
                }


                // -------------------------------------------------
                // Get current value.
                //
                // Prefer the change payload, then query entity
                // current state using the discovered field path.
                // -------------------------------------------------

                let currentValue =
                    change.currentValue;


                if (
                    currentValue ===
                    undefined
                ) {

                    currentValue =
                        safeGetField(
                            entity,
                            fieldName
                        );
                }


                // -------------------------------------------------
                // Bounded examples.
                // -------------------------------------------------

                if (
                    interesting
                ) {

                    addFieldExample(
                        fieldName,
                        {

                            tick,

                            timeSeconds:
                                tickToMatchTime(
                                    tick
                                ),

                            clock:
                                formatClock(
                                    tickToMatchTime(
                                        tick
                                    )
                                ),

                            entityIndex,

                            value:
                                serialize(
                                    currentValue
                                ),

                            rawChange:
                                serialize(
                                    change.raw
                                )
                        }
                    );
                }


                // -------------------------------------------------
                // TRANSITIONS
                // -------------------------------------------------

                if (
                    entityPrevious
                ) {

                    const hadPrevious =
                        entityPrevious.has(
                            fieldName
                        );


                    const previousValue =
                        hadPrevious
                            ? entityPrevious.get(
                                fieldName
                            )
                            : undefined;


                    if (
                        hadPrevious
                        &&
                        !valuesEquivalent(
                            previousValue,
                            currentValue
                        )
                    ) {

                        recordTransition(
                            fieldName,
                            previousValue,
                            currentValue,
                            {

                                tick,

                                timeSeconds:
                                    tickToMatchTime(
                                        tick
                                    ),

                                clock:
                                    formatClock(
                                        tickToMatchTime(
                                            tick
                                        )
                                    ),

                                entityIndex
                            }
                        );
                    }


                    entityPrevious.set(
                        fieldName,
                        currentValue
                    );
                }
            }
        }
    }
);


// ============================================================
// RUN
// ============================================================

console.log('');

console.log(
    '======================================'
);

console.log(
    'TROOPER DEATH FIELD DISCOVERY'
);

console.log(
    '======================================'
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// SORTED FIELD COUNTS
// ============================================================

const allChangeFields =
    mapToRows(
        changeFieldCounts
    );


const interestingChangeFields =
    mapToRows(
        interestingChangeFieldCounts
    );


const deathLikeChangeFields =
    mapToRows(
        deathLikeChangeFieldCounts
    );


// ============================================================
// TRANSITION OUTPUT
// ============================================================

const transitions =
    [
        ...transitionStats.entries()
    ]

        .map(
            (
                [
                    fieldName,
                    stats
                ]
            ) => ({

                fieldName,

                changes:
                    stats.changes,

                numericNonZeroToZero:
                    stats.numericNonZeroToZero,

                numericZeroToNonZero:
                    stats.numericZeroToNonZero,

                falseToTrue:
                    stats.falseToTrue,

                trueToFalse:
                    stats.trueToFalse,

                valuePairs:
                    Object.fromEntries(
                        [
                            ...stats.valuePairs.entries()
                        ]
                        .sort(
                            (
                                a,
                                b
                            ) =>
                                b[1] -
                                a[1]
                        )
                        .slice(
                            0,
                            30
                        )
                    ),

                examples:
                    stats.examples
            })
        )

        .sort(
            (
                a,
                b
            ) => {

                // Prioritize obvious death-like transitions.
                const aDeathScore =
                    a.numericNonZeroToZero
                    +
                    a.falseToTrue
                    +
                    a.trueToFalse;


                const bDeathScore =
                    b.numericNonZeroToZero
                    +
                    b.falseToTrue
                    +
                    b.trueToFalse;


                if (
                    bDeathScore !==
                    aDeathScore
                ) {

                    return (
                        bDeathScore -
                        aDeathScore
                    );
                }


                return (
                    b.changes -
                    a.changes
                );
            }
        );


// ============================================================
// ZERO-TRANSITION CANDIDATES
// ============================================================

const zeroTransitionCandidates =
    transitions

        .filter(
            row =>
                row.numericNonZeroToZero >
                0
        )

        .sort(
            (
                a,
                b
            ) =>
                b.numericNonZeroToZero -
                a.numericNonZeroToZero
        );


// ============================================================
// BOOLEAN TRANSITION CANDIDATES
// ============================================================

const booleanTransitionCandidates =
    transitions

        .filter(
            row =>
                row.falseToTrue >
                    0
                ||
                row.trueToFalse >
                    0
        )

        .sort(
            (
                a,
                b
            ) =>
                (
                    b.falseToTrue +
                    b.trueToFalse
                )
                -
                (
                    a.falseToTrue +
                    a.trueToFalse
                )
        );


// ============================================================
// FIELD EXAMPLE OBJECT
// ============================================================

const fieldExampleObject =
    Object.fromEntries(
        [
            ...fieldExamples.entries()
        ]
        .sort(
            (
                a,
                b
            ) =>
                a[0].localeCompare(
                    b[0]
                )
        )
    );


// ============================================================
// VALIDATION
// ============================================================

const validation =
    {

        trooperEvents:
            {

                actual:
                    trooperEvents,

                expected:
                    '>0',

                pass:
                    trooperEvents >
                    0
            },

        uniqueTroopers:
            {

                actual:
                    trooperIndexes.size,

                expected:
                    '>0',

                pass:
                    trooperIndexes.size >
                    0
            },

        fullFieldsCaptured:
            {

                actual:
                    fullFieldNames.size,

                expected:
                    '>0',

                pass:
                    fullFieldNames.size >
                    0
            },

        updateChangesObserved:
            {

                actual:
                    totalChangeRecords,

                expected:
                    '>0',

                pass:
                    totalChangeRecords >
                    0
            },

        changedFieldNamesObserved:
            {

                actual:
                    changeFieldCounts.size,

                expected:
                    '>0',

                pass:
                    changeFieldCounts.size >
                    0
            },

        transitionFieldsObserved:
            {

                actual:
                    transitions.length,

                expected:
                    '>0',

                pass:
                    transitions.length >
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
            'TROOPER_DEATH_FIELD_DISCOVERY',

        canonical:
            false,

        purpose:
            [

                'Identify actual CNPC_Trooper health/life/death state fields without guessing schema paths.',

                'Use EntityMutationEvent.getChanges() so the diagnostic remains memory-safe despite millions of Trooper updates.',

                'Find fields showing repeated nonzero-to-zero, zero-to-nonzero, or boolean transitions that may encode death and respawn.',

                'Do not yet infer Trooper death from any candidate field until transition timing is validated.'
            ],

        counts:
            {

                trooperEvents,

                trooperCreates,

                trooperUpdates,

                trooperLeaves,

                trooperDeletes,

                uniqueTrooperIndexes:
                    trooperIndexes.size,

                updateEventsWithChanges,

                updateEventsWithoutChanges,

                totalChangeRecords,

                uniqueChangedFields:
                    changeFieldCounts.size
            },

        fullFieldDiscovery:
            {

                allFieldNames:
                    [
                        ...fullFieldNames
                    ].sort(),

                interestingFieldNames:
                    [
                        ...interestingFullFieldNames
                    ].sort(),

                deathLikeFieldNames:
                    [
                        ...deathLikeFullFieldNames
                    ].sort()
            },

        changedFields:
            {

                all:
                    allChangeFields,

                interesting:
                    interestingChangeFields,

                deathLike:
                    deathLikeChangeFields
            },

        zeroTransitionCandidates,

        booleanTransitionCandidates,

        allTransitions:
            transitions,

        fieldExamples:
            fieldExampleObject,

        changeShapeSamples,

        lifecycleSamples,

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
    'TROOPER EVENTS'
);

console.log(
    '--------------'
);

console.log(
    `Events: ${trooperEvents.toLocaleString()}`
);

console.log(
    `Unique slots: ${trooperIndexes.size}`
);

console.log(
    `Creates: ${trooperCreates.toLocaleString()}`
);

console.log(
    `Updates: ${trooperUpdates.toLocaleString()}`
);

console.log(
    `Leaves: ${trooperLeaves.toLocaleString()}`
);

console.log(
    `Deletes: ${trooperDeletes.toLocaleString()}`
);

console.log('');

console.log(
    'FULL FIELD NAMES: DEATH-LIKE'
);

console.log(
    '----------------------------'
);


if (
    deathLikeFullFieldNames.size ===
    0
) {

    console.log(
        'No obvious death-like field names found.'
    );

} else {

    for (
        const fieldName
        of [
            ...deathLikeFullFieldNames
        ].sort()
    ) {

        console.log(
            fieldName
        );
    }
}


console.log('');

console.log(
    'CHANGED DEATH-LIKE FIELDS'
);

console.log(
    '-------------------------'
);


if (
    deathLikeChangeFields.length ===
    0
) {

    console.log(
        'No death-like changed fields detected.'
    );

} else {

    for (
        const row
        of deathLikeChangeFields.slice(
            0,
            40
        )
    ) {

        console.log(
            `${
                row.fieldName.padEnd(
                    70
                )
            } ${row.count}`
        );
    }
}


console.log('');

console.log(
    'TOP NONZERO -> ZERO TRANSITIONS'
);

console.log(
    '-------------------------------'
);


if (
    zeroTransitionCandidates.length ===
    0
) {

    console.log(
        'No numeric nonzero -> zero transitions detected.'
    );

} else {

    for (
        const row
        of zeroTransitionCandidates.slice(
            0,
            40
        )
    ) {

        console.log(
            `${
                row.fieldName.padEnd(
                    70
                )
            } toZero=${
                String(
                    row.numericNonZeroToZero
                ).padStart(
                    6
                )
            } zeroToNonzero=${
                String(
                    row.numericZeroToNonZero
                ).padStart(
                    6
                )
            } changes=${
                String(
                    row.changes
                ).padStart(
                    8
                )
            }`
        );
    }
}


console.log('');

console.log(
    'TOP BOOLEAN TRANSITIONS'
);

console.log(
    '-----------------------'
);


if (
    booleanTransitionCandidates.length ===
    0
) {

    console.log(
        'No boolean transitions detected.'
    );

} else {

    for (
        const row
        of booleanTransitionCandidates.slice(
            0,
            40
        )
    ) {

        console.log(
            `${
                row.fieldName.padEnd(
                    70
                )
            } F->T=${
                String(
                    row.falseToTrue
                ).padStart(
                    6
                )
            } T->F=${
                String(
                    row.trueToFalse
                ).padStart(
                    6
                )
            }`
        );
    }
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
    `Output:\n${outputPath}`
);

console.log('');


// ============================================================
// SAFE getChanges()
// ============================================================

function safeGetChanges(
    event
) {

    try {

        if (
            typeof event.getChanges ===
            'function'
        ) {

            return event.getChanges();
        }

    } catch {

        return null;
    }


    return null;
}


// ============================================================
// NORMALIZE CHANGES
// ============================================================

function normalizeChanges(
    raw
) {

    if (
        raw ===
        null
        ||
        raw ===
        undefined
    ) {

        return [];
    }


    let values;


    // --------------------------------------------------------
    // Array
    // --------------------------------------------------------

    if (
        Array.isArray(
            raw
        )
    ) {

        values =
            raw;


    // --------------------------------------------------------
    // Map
    // --------------------------------------------------------

    } else if (
        raw instanceof Map
    ) {

        values =
            [
                ...raw.entries()
            ];


    // --------------------------------------------------------
    // Generic iterable
    // --------------------------------------------------------

    } else if (
        typeof raw?.[Symbol.iterator] ===
        'function'
        &&
        typeof raw !==
        'string'
    ) {

        try {

            values =
                [
                    ...raw
                ];

        } catch {

            values =
                [
                    raw
                ];
        }


    // --------------------------------------------------------
    // Plain object
    // --------------------------------------------------------

    } else if (
        typeof raw ===
        'object'
    ) {

        const keys =
            Object.keys(
                raw
            );


        // Sometimes changes can simply be:
        // { "field.path": value }
        if (
            keys.length >
            0
            &&
            !looksLikeSingleChangeObject(
                raw
            )
        ) {

            values =
                Object.entries(
                    raw
                );

        } else {

            values =
                [
                    raw
                ];
        }


    } else {

        values =
            [
                raw
            ];
    }


    const result =
        [];


    for (
        const item
        of values
    ) {

        const normalized =
            normalizeOneChange(
                item
            );


        if (
            normalized
        ) {

            result.push(
                normalized
            );
        }
    }


    return result;
}


// ============================================================
// NORMALIZE ONE CHANGE
// ============================================================

function normalizeOneChange(
    item
) {

    // --------------------------------------------------------
    // [fieldName, value]
    // --------------------------------------------------------

    if (
        Array.isArray(
            item
        )
        &&
        item.length >=
            2
    ) {

        return {

            fieldName:
                stringifyFieldName(
                    item[0]
                ),

            currentValue:
                item[1],

            raw:
                item
        };
    }


    // --------------------------------------------------------
    // String field path only
    // --------------------------------------------------------

    if (
        typeof item ===
        'string'
    ) {

        return {

            fieldName:
                item,

            currentValue:
                undefined,

            raw:
                item
        };
    }


    // --------------------------------------------------------
    // Object
    // --------------------------------------------------------

    if (
        item
        &&
        typeof item ===
        'object'
    ) {

        const fieldName =
            stringifyFieldName(
                item.fieldName
                ??
                item.name
                ??
                item.key
                ??
                item.path
                ??
                item.fieldPath
                ??
                item.property
                ??
                item.field
            );


        let currentValue =
            undefined;


        const valueKeys =
            [
                'newValue',
                'value',
                'after',
                'currentValue',
                'new',
                'data'
            ];


        for (
            const key
            of valueKeys
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    item,
                    key
                )
            ) {

                currentValue =
                    item[
                        key
                    ];


                break;
            }
        }


        if (
            fieldName
        ) {

            return {

                fieldName,

                currentValue,

                raw:
                    item
            };
        }
    }


    return null;
}


// ============================================================
// SINGLE-CHANGE OBJECT TEST
// ============================================================

function looksLikeSingleChangeObject(
    object
) {

    return Boolean(
        object.fieldName
        ??
        object.name
        ??
        object.key
        ??
        object.path
        ??
        object.fieldPath
        ??
        object.property
        ??
        object.field
    );
}


// ============================================================
// FIELD NAME
// ============================================================

function stringifyFieldName(
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
        'string'
    ) {

        return value;
    }


    if (
        Array.isArray(
            value
        )
    ) {

        return value
            .map(
                part =>
                    String(
                        part
                    )
            )
            .join(
                '.'
            );
    }


    if (
        typeof value ===
        'object'
    ) {

        const candidate =
            value.name
            ??
            value.path
            ??
            value.fieldName
            ??
            value.key
            ??
            null;


        if (
            candidate
        ) {

            return stringifyFieldName(
                candidate
            );
        }


        try {

            return JSON.stringify(
                value
            );

        } catch {

            return String(
                value
            );
        }
    }


    return String(
        value
    );
}


// ============================================================
// RECORD TRANSITION
// ============================================================

function recordTransition(
    fieldName,
    previousValue,
    currentValue,
    context
) {

    if (
        !transitionStats.has(
            fieldName
        )
    ) {

        transitionStats.set(
            fieldName,
            {

                changes:
                    0,

                numericNonZeroToZero:
                    0,

                numericZeroToNonZero:
                    0,

                falseToTrue:
                    0,

                trueToFalse:
                    0,

                valuePairs:
                    new Map(),

                examples:
                    []
            }
        );
    }


    const stats =
        transitionStats.get(
            fieldName
        );


    stats.changes++;


    const previousNumber =
        finite(
            previousValue
        );


    const currentNumber =
        finite(
            currentValue
        );


    if (
        previousNumber !==
            null
        &&
        currentNumber !==
            null
    ) {

        if (
            previousNumber !==
                0
            &&
            currentNumber ===
                0
        ) {

            stats.numericNonZeroToZero++;
        }


        if (
            previousNumber ===
                0
            &&
            currentNumber !==
                0
        ) {

            stats.numericZeroToNonZero++;
        }
    }


    if (
        previousValue ===
            false
        &&
        currentValue ===
            true
    ) {

        stats.falseToTrue++;
    }


    if (
        previousValue ===
            true
        &&
        currentValue ===
            false
    ) {

        stats.trueToFalse++;
    }


    const pairKey =
        `${
            compactValue(
                previousValue
            )
        } -> ${
            compactValue(
                currentValue
            )
        }`;


    increment(
        stats.valuePairs,
        pairKey
    );


    if (
        stats.examples.length <
        MAX_TRANSITION_EXAMPLES_PER_FIELD
    ) {

        stats.examples.push({

            ...context,

            previousValue:
                serialize(
                    previousValue
                ),

            currentValue:
                serialize(
                    currentValue
                )
        });
    }
}


// ============================================================
// FIELD EXAMPLES
// ============================================================

function addFieldExample(
    fieldName,
    example
) {

    if (
        !fieldExamples.has(
            fieldName
        )
    ) {

        fieldExamples.set(
            fieldName,
            []
        );
    }


    const examples =
        fieldExamples.get(
            fieldName
        );


    if (
        examples.length <
        MAX_EXAMPLES_PER_FIELD
    ) {

        examples.push(
            example
        );
    }
}


// ============================================================
// INTERESTING CURRENT STATE
// ============================================================

function readInterestingState(
    entity
) {

    const output =
        {};


    for (
        const [
            fieldName,
            value
        ]
        of getFieldEntries(
            entity
        )
    ) {

        if (
            !INTERESTING_FIELD_PATTERN.test(
                fieldName
            )
        ) {

            continue;
        }


        output[
            fieldName
        ] =
            serialize(
                value
            );


        if (
            Object.keys(
                output
            ).length >=
            80
        ) {

            break;
        }
    }


    return output;
}


// ============================================================
// FIELD ENTRIES
// ============================================================

function getFieldEntries(
    entity
) {

    try {

        if (
            typeof entity.fieldEntries ===
            'function'
        ) {

            const raw =
                [
                    ...entity.fieldEntries()
                ];


            return raw.map(
                item => {

                    if (
                        Array.isArray(
                            item
                        )
                    ) {

                        return [
                            String(
                                item[0]
                            ),
                            item[1]
                        ];
                    }


                    if (
                        item
                        &&
                        typeof item ===
                        'object'
                    ) {

                        return [

                            String(
                                item.name
                                ??
                                item.key
                                ??
                                item.fieldName
                                ??
                                item.path
                                ??
                                'UNKNOWN'
                            ),

                            item.value
                        ];
                    }


                    return [
                        String(
                            item
                        ),
                        null
                    ];
                }
            );
        }

    } catch {

        // Ignore.
    }


    return [];
}


// ============================================================
// SAFE FIELD LOOKUP
// ============================================================

function safeGetField(
    entity,
    fieldName
) {

    try {

        if (
            typeof entity.getField ===
            'function'
        ) {

            return entity.getField(
                fieldName
            );
        }

    } catch {

        // Missing field or incompatible path.
    }


    return undefined;
}


// ============================================================
// ENTITY CLASS
// ============================================================

function getEntityClassName(
    entity
) {

    try {

        if (
            typeof entity.getClassName ===
            'function'
        ) {

            const value =
                entity.getClassName();


            if (
                value
            ) {

                return String(
                    value
                );
            }
        }

    } catch {

        // Fall through.
    }


    return (
        entity.className
        ??
        entity
            ?.class
            ?.name
        ??
        entity
            ?._className
        ??
        null
    );
}


// ============================================================
// ENTITY INDEX
// ============================================================

function getEntityIndex(
    entity
) {

    const direct =
        finite(
            entity?.index
            ??
            entity?.entityIndex
        );


    if (
        direct !==
        null
    ) {

        return direct;
    }


    try {

        if (
            typeof entity.getIndex ===
            'function'
        ) {

            return finite(
                entity.getIndex()
            );
        }

    } catch {

        // Fall through.
    }


    return null;
}


// ============================================================
// OPERATION
// ============================================================

function normalizeOperation(
    operation
) {

    const value =
        String(
            operation
        )
        .toUpperCase();


    if (
        value.includes(
            'CREATE'
        )
    ) {

        return 'CREATE';
    }


    if (
        value.includes(
            'UPDATE'
        )
    ) {

        return 'UPDATE';
    }


    if (
        value.includes(
            'LEAVE'
        )
    ) {

        return 'LEAVE';
    }


    if (
        value.includes(
            'DELETE'
        )
    ) {

        return 'DELETE';
    }


    return value;
}


// ============================================================
// VALUE TYPE
// ============================================================

function describeValueType(
    value
) {

    if (
        value ===
        null
    ) {

        return 'null';
    }


    if (
        Array.isArray(
            value
        )
    ) {

        return 'array';
    }


    if (
        value instanceof Map
    ) {

        return 'map';
    }


    return typeof value;
}


// ============================================================
// VALUE COMPARISON
// ============================================================

function valuesEquivalent(
    a,
    b
) {

    if (
        a ===
        b
    ) {

        return true;
    }


    const aNumber =
        finite(
            a
        );


    const bNumber =
        finite(
            b
        );


    if (
        aNumber !==
            null
        &&
        bNumber !==
            null
    ) {

        return (
            aNumber ===
            bNumber
        );
    }


    return (
        compactValue(
            a
        )
        ===
        compactValue(
            b
        )
    );
}


// ============================================================
// COMPACT VALUE
// ============================================================

function compactValue(
    value
) {

    if (
        value ===
        undefined
    ) {

        return 'undefined';
    }


    if (
        value ===
        null
    ) {

        return 'null';
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

        return String(
            value
        );
    }


    try {

        const text =
            JSON.stringify(
                value
            );


        if (
            text.length >
            100
        ) {

            return text.slice(
                0,
                100
            );
        }


        return text;

    } catch {

        return String(
            value
        );
    }
}


// ============================================================
// MAP TO SORTED ROWS
// ============================================================

function mapToRows(
    map
) {

    return [
        ...map.entries()
    ]

        .map(
            (
                [
                    fieldName,
                    count
                ]
            ) => ({

                fieldName,

                count
            })
        )

        .sort(
            (
                a,
                b
            ) =>
                b.count -
                a.count
        );
}


// ============================================================
// COUNTER
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


// ============================================================
// TIME
// ============================================================

function tickToMatchTime(
    tick
) {

    return (
        tick /
        TICK_RATE
    )
    -
    MATCH_CLOCK_OFFSET_SECONDS;
}


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


// ============================================================
// SERIALIZE
// ============================================================

function serialize(
    value
) {

    if (
        value ===
        undefined
    ) {

        return '__UNDEFINED__';
    }


    if (
        value ===
        null
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


    if (
        Array.isArray(
            value
        )
    ) {

        return value
            .slice(
                0,
                30
            )
            .map(
                serialize
            );
    }


    if (
        value instanceof Map
    ) {

        return Object.fromEntries(
            [
                ...value.entries()
            ]
            .slice(
                0,
                30
            )
            .map(
                (
                    [
                        key,
                        nestedValue
                    ]
                ) => [

                    String(
                        key
                    ),

                    serialize(
                        nestedValue
                    )
                ]
            )
        );
    }


    try {

        return JSON.parse(
            JSON.stringify(
                value,
                (
                    key,
                    nested
                ) =>
                    typeof nested ===
                        'bigint'
                        ? nested.toString()
                        : nested
            )
        );

    } catch {

        return String(
            value
        );
    }
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