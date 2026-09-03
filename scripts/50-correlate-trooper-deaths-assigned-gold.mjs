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
// CORRELATION WINDOW
// ============================================================

// ±1 second around Trooper death.
const WINDOW_TICKS =
    64;


// Spatial distance is diagnostic only.
//
// We deliberately keep this broad because AssignedGold could
// be a logical/economy entity rather than a literal world
// pickup.
const SPATIAL_RADIUS =
    2000;


// Detailed correlations are bounded to keep output manageable.
const MAX_DETAILED_DEATHS_WITH_SIGNAL =
    1200;


const MAX_EVENTS_PER_DEATH =
    20;


const MAX_ASSIGNED_GOLD_FIELD_SAMPLE =
    150;


const MAX_RAW_OPERATION_SAMPLES =
    40;


const MAX_CHANGE_SHAPE_SAMPLES =
    40;


const MAX_CHANGE_FIELDS_PER_EVENT =
    40;


const MAX_CREATE_EXAMPLES =
    100;


const MAX_INTERESTING_UPDATE_EXAMPLES =
    100;


const PROGRESS_EVERY_TROOPER_EVENTS =
    1_000_000;


// ============================================================
// ASSIGNED GOLD FIELD FILTER
// ============================================================

const INTERESTING_ASSIGNED_GOLD_FIELD_PATTERN =
    /gold|soul|value|amount|reward|owner|target|source|team|player|hero|active|interactive|claim|deny|secure|position|create|spawn|lifetime/i;


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
        'trooper_assigned_gold_correlation.json'
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
// TROOPER STATE
// ============================================================

const previousTrooperState =
    new Map();


const trooperIndexes =
    new Set();


const trooperDeaths =
    [];


const deathsBySubclass =
    new Map();


let trooperEvents =
    0;


let healthDeathTransitions =
    0;


let lifeDeathTransitions =
    0;


// ============================================================
// ASSIGNED GOLD STATE
// ============================================================

const assignedGoldIndexes =
    new Set();


const assignedGoldOperationCounts =
    new Map();


const assignedGoldFieldNames =
    new Set();


const assignedGoldInterestingFieldNames =
    new Set();


let assignedGoldFieldsCaptured =
    false;


let assignedGoldEvents =
    0;


let assignedGoldCreates =
    0;


let assignedGoldUpdates =
    0;


let assignedGoldLeaves =
    0;


let assignedGoldDeletes =
    0;


// ============================================================
// ASSIGNED GOLD SAMPLES
// ============================================================

const assignedGoldOperationSamples =
    [];


const changeShapeSamples =
    [];


const assignedGoldCreateExamples =
    [];


const interestingUpdateExamples =
    [];


// ============================================================
// ROLLING ASSIGNED GOLD EVENT BUFFER
// ============================================================

let assignedGoldBuffer =
    [];


let assignedGoldBufferStart =
    0;


let maximumBufferSize =
    0;


// ============================================================
// PENDING DEATHS
//
// Remain active until +1 second so post-death AssignedGold
// events can be captured.
// ============================================================

let pendingDeaths =
    [];


// ============================================================
// GLOBAL CORRELATION COUNTS
// ============================================================

let deathsWithAnyAssignedGoldEvent =
    0;


let deathsWithCreate =
    0;


let deathsWithExactTickAnyEvent =
    0;


let deathsWithExactTickCreate =
    0;


// ============================================================
// CORRELATION BY TROOPER SUBCLASS
// ============================================================

const subclassCorrelation =
    new Map();


// ============================================================
// EVENT DELTA HISTOGRAMS
// ============================================================

const anyEventTickDeltaHistogram =
    new Map();


const createTickDeltaHistogram =
    new Map();


// ============================================================
// CREATE -> NEAREST DEATH ANALYSIS
// ============================================================

const assignedGoldCreateRows =
    [];


// ============================================================
// DETAILED DEATH CORRELATIONS
// ============================================================

const detailedDeathCorrelations =
    [];


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


        // ----------------------------------------------------
        // Drop deaths whose +1 second window is finished.
        // ----------------------------------------------------

        pendingDeaths =
            pendingDeaths.filter(
                death =>
                    tick <=
                    death.tick +
                    WINDOW_TICKS
            );


        // ----------------------------------------------------
        // Keep only the prior 1 second of AssignedGold events.
        // ----------------------------------------------------

        pruneAssignedGoldBuffer(
            tick -
            WINDOW_TICKS
        );


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
                className ===
                'CNPC_Trooper'
            ) {

                processTrooper(
                    entity,
                    tick
                );


                continue;
            }


            if (
                className ===
                'CCitadel_Pickup_AssignedGold'
            ) {

                processAssignedGold(
                    event,
                    entity,
                    tick
                );
            }
        }
    }
);


// ============================================================
// RUN
// ============================================================

console.log('');

console.log(
    '=========================================='
);

console.log(
    'TROOPER DEATH / ASSIGNED GOLD CORRELATION'
);

console.log(
    '=========================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Correlation window: ±${WINDOW_TICKS / TICK_RATE}s`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// FINALIZE DEATH CORRELATIONS
// ============================================================

for (
    const death
    of trooperDeaths
) {

    finalizeDeathCorrelation(
        death
    );
}


// ============================================================
// CREATE -> NEAREST DEATH
// ============================================================

const createNearestDeathRows =
    [];


const createsMatchedWithinWindow =
    [];


for (
    const create
    of assignedGoldCreateRows
) {

    let best =
        null;


    for (
        const death
        of trooperDeaths
    ) {

        const tickDelta =
            create.tick -
            death.tick;


        if (
            Math.abs(
                tickDelta
            ) >
            WINDOW_TICKS
        ) {

            continue;
        }


        let distance3D =
            null;


        if (
            create.position
            &&
            death.position
        ) {

            distance3D =
                getDistance3D(
                    create.position,
                    death.position
                );
        }


        const score =
            Math.abs(
                tickDelta
            )
            *
            100000
            +
            (
                distance3D
                ??
                0
            );


        if (
            !best
            ||
            score <
                best.score
        ) {

            best =
                {

                    score,

                    deathIndex:
                        death.deathIndex,

                    trooperEntityIndex:
                        death.entityIndex,

                    trooperSubclassId:
                        death.subclassId,

                    deathTick:
                        death.tick,

                    deathClock:
                        death.clock,

                    tickDelta,

                    secondsDelta:
                        tickDelta /
                        TICK_RATE,

                    distance3D
                };
        }
    }


    const row =
        {

            assignedGoldEntityIndex:
                create.entityIndex,

            createTick:
                create.tick,

            createTimeSeconds:
                create.timeSeconds,

            createClock:
                create.clock,

            position:
                create.position,

            nearestDeath:
                best
        };


    createNearestDeathRows.push(
        row
    );


    if (
        best
    ) {

        createsMatchedWithinWindow.push(
            row
        );
    }
}


// ============================================================
// SUBCLASS SUMMARY
// ============================================================

const bySubclass =
    [];


for (
    const [
        subclassId,
        deathCount
    ]
    of deathsBySubclass.entries()
) {

    const correlation =
        subclassCorrelation.get(
            subclassId
        )
        ??
        makeSubclassCorrelation();


    bySubclass.push({

        subclassId,

        deaths:
            deathCount,

        deathsWithAnyAssignedGoldEvent:
            correlation.deathsWithAny,

        anyEventRate:
            rate(
                correlation.deathsWithAny,
                deathCount
            ),

        deathsWithCreate:
            correlation.deathsWithCreate,

        createRate:
            rate(
                correlation.deathsWithCreate,
                deathCount
            ),

        deathsWithExactTickAny:
            correlation.deathsWithExactTickAny,

        exactTickAnyRate:
            rate(
                correlation.deathsWithExactTickAny,
                deathCount
            ),

        deathsWithExactTickCreate:
            correlation.deathsWithExactTickCreate,

        exactTickCreateRate:
            rate(
                correlation.deathsWithExactTickCreate,
                deathCount
            ),

        anyEventCount:
            correlation.anyEventCount,

        createEventCount:
            correlation.createEventCount
    });
}


bySubclass.sort(
    (
        a,
        b
    ) =>
        b.deaths -
        a.deaths
);


// ============================================================
// CREATE MATCH BY SUBCLASS
// ============================================================

const createMatchesBySubclass =
    new Map();


for (
    const row
    of createsMatchedWithinWindow
) {

    increment(
        createMatchesBySubclass,
        String(
            row
                .nearestDeath
                .trooperSubclassId
            ??
            'UNKNOWN'
        )
    );
}


// ============================================================
// DELTA DISTRIBUTIONS
// ============================================================

const createNearestTickDeltas =
    createsMatchedWithinWindow

        .map(
            row =>
                row.nearestDeath.tickDelta
        );


const createNearestDistances =
    createsMatchedWithinWindow

        .map(
            row =>
                row.nearestDeath.distance3D
        )

        .filter(
            Number.isFinite
        );


// ============================================================
// VALIDATION
// ============================================================

const validation =
    {

        trooperDeaths:
            {

                actual:
                    trooperDeaths.length,

                expected:
                    4812,

                pass:
                    replayName ===
                        'test'

                        ? trooperDeaths.length ===
                            4812

                        : trooperDeaths.length >
                            0
            },

        allDeathsDualSignal:
            {

                actual:
                    healthDeathTransitions ===
                    lifeDeathTransitions
                    &&
                    healthDeathTransitions ===
                    trooperDeaths.length,

                expected:
                    true,

                pass:
                    healthDeathTransitions ===
                    lifeDeathTransitions
                    &&
                    healthDeathTransitions ===
                    trooperDeaths.length
            },

        assignedGoldObserved:
            {

                actual:
                    assignedGoldEvents,

                expected:
                    '>0',

                pass:
                    assignedGoldEvents >
                    0
            },

        assignedGoldCreatesObserved:
            {

                actual:
                    assignedGoldCreates,

                expected:
                    '>0',

                pass:
                    assignedGoldCreates >
                    0
            },

        operationDecoded:
            {

                actual:
                    (
                        assignedGoldCreates +
                        assignedGoldUpdates +
                        assignedGoldLeaves +
                        assignedGoldDeletes
                    ),

                expected:
                    assignedGoldEvents,

                pass:
                    (
                        assignedGoldCreates +
                        assignedGoldUpdates +
                        assignedGoldLeaves +
                        assignedGoldDeletes
                    ) ===
                    assignedGoldEvents
            },

        correlationProduced:
            {

                actual:
                    deathsWithAnyAssignedGoldEvent,

                expected:
                    '>0',

                pass:
                    deathsWithAnyAssignedGoldEvent >
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
            'TROOPER_ASSIGNED_GOLD_CORRELATION',

        canonical:
            false,

        purpose:
            [

                'Validate the temporal relationship between CNPC_Trooper death and CCitadel_Pickup_AssignedGold telemetry.',

                'Stratify the relationship by Trooper subclass rather than assuming every CNPC_Trooper subclass is an ordinary farmable lane creep.',

                'Correctly decode deadem EntityOperation using event.operation._code.',

                'Inspect AssignedGold fields and lifecycle before assigning gameplay semantics such as ground-soul pickup or player soul award.'
            ],

        constants:
            {

                tickRate:
                    TICK_RATE,

                correlationWindowTicks:
                    WINDOW_TICKS,

                correlationWindowSeconds:
                    WINDOW_TICKS /
                    TICK_RATE,

                diagnosticSpatialRadius:
                    SPATIAL_RADIUS
            },

        troopers:
            {

                events:
                    trooperEvents,

                deaths:
                    trooperDeaths.length,

                healthDeathTransitions,

                lifeDeathTransitions,

                uniqueEntityIndexes:
                    trooperIndexes.size,

                deathsBySubclass:
                    mapToSortedObject(
                        deathsBySubclass
                    )
            },

        assignedGold:
            {

                events:
                    assignedGoldEvents,

                uniqueEntityIndexes:
                    assignedGoldIndexes.size,

                creates:
                    assignedGoldCreates,

                updates:
                    assignedGoldUpdates,

                leaves:
                    assignedGoldLeaves,

                deletes:
                    assignedGoldDeletes,

                operationCounts:
                    mapToSortedObject(
                        assignedGoldOperationCounts
                    ),

                fieldNames:
                    [
                        ...assignedGoldFieldNames
                    ].sort(),

                interestingFieldNames:
                    [
                        ...assignedGoldInterestingFieldNames
                    ].sort(),

                operationSamples:
                    assignedGoldOperationSamples,

                changeShapeSamples,

                createExamples:
                    assignedGoldCreateExamples,

                interestingUpdateExamples
            },

        correlation:
            {

                global:
                    {

                        deathsWithAnyAssignedGoldEvent,

                        anyEventRate:
                            rate(
                                deathsWithAnyAssignedGoldEvent,
                                trooperDeaths.length
                            ),

                        deathsWithCreate,

                        createRate:
                            rate(
                                deathsWithCreate,
                                trooperDeaths.length
                            ),

                        deathsWithExactTickAnyEvent,

                        exactTickAnyRate:
                            rate(
                                deathsWithExactTickAnyEvent,
                                trooperDeaths.length
                            ),

                        deathsWithExactTickCreate,

                        exactTickCreateRate:
                            rate(
                                deathsWithExactTickCreate,
                                trooperDeaths.length
                            )
                    },

                byTrooperSubclass:
                    bySubclass,

                anyEventTickDeltaHistogram:
                    mapToNumericKeyObject(
                        anyEventTickDeltaHistogram
                    ),

                createTickDeltaHistogram:
                    mapToNumericKeyObject(
                        createTickDeltaHistogram
                    ),

                detailedDeaths:
                    detailedDeathCorrelations
            },

        assignedGoldCreateToDeath:
            {

                createCount:
                    assignedGoldCreateRows.length,

                createsMatchedToDeathWithinWindow:
                    createsMatchedWithinWindow.length,

                matchRate:
                    rate(
                        createsMatchedWithinWindow.length,
                        assignedGoldCreateRows.length
                    ),

                matchedByTrooperSubclass:
                    mapToSortedObject(
                        createMatchesBySubclass
                    ),

                nearestDeathTickDelta:
                    summarizeNumbers(
                        createNearestTickDeltas
                    ),

                nearestDeathDistance3D:
                    summarizeNumbers(
                        createNearestDistances
                    ),

                rows:
                    createNearestDeathRows
            },

        memory:
            {

                maximumAssignedGoldRollingBuffer:
                    maximumBufferSize,

                detailedDeathRowsStored:
                    detailedDeathCorrelations.length
            },

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
    'TROOPER DEATHS'
);

console.log(
    '--------------'
);

console.log(
    `Deaths: ${trooperDeaths.length}`
);

console.log(
    `Health death transitions: ${healthDeathTransitions}`
);

console.log(
    `Life-state death transitions: ${lifeDeathTransitions}`
);

console.log('');

console.log(
    'DEATHS BY SUBCLASS'
);

console.log(
    '------------------'
);


for (
    const [
        subclassId,
        count
    ]
    of Object.entries(
        mapToSortedObject(
            deathsBySubclass
        )
    )
) {

    console.log(
        `${subclassId.padEnd(
            20
        )} ${count}`
    );
}


console.log('');

console.log(
    'ASSIGNED GOLD'
);

console.log(
    '-------------'
);

console.log(
    `Events: ${assignedGoldEvents.toLocaleString()}`
);

console.log(
    `Unique indexes: ${assignedGoldIndexes.size}`
);

console.log(
    `CREATE: ${assignedGoldCreates.toLocaleString()}`
);

console.log(
    `UPDATE: ${assignedGoldUpdates.toLocaleString()}`
);

console.log(
    `LEAVE:  ${assignedGoldLeaves.toLocaleString()}`
);

console.log(
    `DELETE: ${assignedGoldDeletes.toLocaleString()}`
);

console.log('');

console.log(
    'DEATH CORRELATION BY SUBCLASS'
);

console.log(
    '-----------------------------'
);


for (
    const row
    of bySubclass
) {

    console.log(
        `${
            String(
                row.subclassId
            ).padEnd(
                16
            )
        } deaths=${
            String(
                row.deaths
            ).padStart(
                5
            )
        } any=${
            String(
                row.deathsWithAnyAssignedGoldEvent
            ).padStart(
                5
            )
        } create=${
            String(
                row.deathsWithCreate
            ).padStart(
                5
            )
        } exactCreate=${
            String(
                row.deathsWithExactTickCreate
            ).padStart(
                5
            )
        }`
    );
}


console.log('');

console.log(
    'ASSIGNED GOLD CREATE -> TROOPER DEATH'
);

console.log(
    '-------------------------------------'
);

console.log(
    `Creates: ${assignedGoldCreateRows.length}`
);

console.log(
    `Matched within ±1s: ${createsMatchedWithinWindow.length}`
);

console.log(
    `Match rate: ${formatPercent(
        rate(
            createsMatchedWithinWindow.length,
            assignedGoldCreateRows.length
        )
    )}`
);

console.log('');

console.log(
    'MATCHED CREATES BY TROOPER SUBCLASS'
);

console.log(
    '-----------------------------------'
);


for (
    const [
        subclassId,
        count
    ]
    of Object.entries(
        mapToSortedObject(
            createMatchesBySubclass
        )
    )
) {

    console.log(
        `${subclassId.padEnd(
            20
        )} ${count}`
    );
}


console.log('');

console.log(
    'ASSIGNED GOLD INTERESTING FIELDS'
);

console.log(
    '--------------------------------'
);


for (
    const fieldName
    of [
        ...assignedGoldInterestingFieldNames
    ].sort()
) {

    console.log(
        fieldName
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
                28
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
// PROCESS TROOPER
// ============================================================

function processTrooper(
    entity,
    tick
) {

    trooperEvents++;


    if (
        trooperEvents %
            PROGRESS_EVERY_TROOPER_EVENTS ===
        0
    ) {

        console.log(
            `Trooper events: ${trooperEvents.toLocaleString()}`
            +
            ` | deaths: ${trooperDeaths.length}`
            +
            ` | AssignedGold events: ${assignedGoldEvents.toLocaleString()}`
        );
    }


    const entityIndex =
        getEntityIndex(
            entity
        );


    if (
        entityIndex ===
        null
    ) {

        return;
    }


    trooperIndexes.add(
        entityIndex
    );


    const current =
        {

            health:
                finite(
                    safeGetField(
                        entity,
                        'm_iHealth'
                    )
                ),

            lifeState:
                finite(
                    safeGetField(
                        entity,
                        'm_lifeState'
                    )
                ),

            team:
                finite(
                    safeGetField(
                        entity,
                        'm_iTeamNum'
                    )
                ),

            lane:
                finite(
                    safeGetField(
                        entity,
                        'm_iLane'
                    )
                ),

            subclassId:
                serializeScalar(
                    safeGetField(
                        entity,
                        'm_nSubclassID'
                    )
                ),

            position:
                getWorldPosition(
                    entity
                )
        };


    const previous =
        previousTrooperState.get(
            entityIndex
        )
        ??
        null;


    if (
        previous
    ) {

        const healthDeath =
            (
                previous.health !==
                    null
                &&
                current.health !==
                    null
                &&
                previous.health >
                    0
                &&
                current.health <=
                    0
            );


        const lifeDeath =
            (
                previous.lifeState !==
                    null
                &&
                current.lifeState !==
                    null
                &&
                previous.lifeState ===
                    0
                &&
                current.lifeState !==
                    0
            );


        if (
            healthDeath
        ) {

            healthDeathTransitions++;
        }


        if (
            lifeDeath
        ) {

            lifeDeathTransitions++;
        }


        // ----------------------------------------------------
        // Require BOTH independent signals.
        // ----------------------------------------------------

        if (
            healthDeath
            &&
            lifeDeath
        ) {

            const death =
                {

                    deathIndex:
                        trooperDeaths.length,

                    entityIndex,

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

                    previousHealth:
                        previous.health,

                    currentHealth:
                        current.health,

                    previousLifeState:
                        previous.lifeState,

                    currentLifeState:
                        current.lifeState,

                    team:
                        current.team
                        ??
                        previous.team,

                    lane:
                        current.lane
                        ??
                        previous.lane,

                    subclassId:
                        current.subclassId
                        ??
                        previous.subclassId,

                    position:
                        current.position
                        ??
                        previous.position,

                    correlatedEvents:
                        [],

                    seenAny:
                        false,

                    seenCreate:
                        false,

                    seenExactAny:
                        false,

                    seenExactCreate:
                        false
                };


            increment(
                deathsBySubclass,
                String(
                    death.subclassId
                    ??
                    'UNKNOWN'
                )
            );


            // ------------------------------------------------
            // Look backward through previous 1 second of
            // AssignedGold activity.
            // ------------------------------------------------

            for (
                let index =
                    assignedGoldBufferStart;

                index <
                    assignedGoldBuffer.length;

                index++
            ) {

                const assignedGoldEvent =
                    assignedGoldBuffer[
                        index
                    ];


                const delta =
                    assignedGoldEvent.tick -
                    tick;


                if (
                    delta <
                        -WINDOW_TICKS
                    ||
                    delta >
                        0
                ) {

                    continue;
                }


                associateAssignedGoldWithDeath(
                    death,
                    assignedGoldEvent
                );
            }


            trooperDeaths.push(
                death
            );


            pendingDeaths.push(
                death
            );
        }
    }


    previousTrooperState.set(
        entityIndex,
        current
    );
}


// ============================================================
// PROCESS ASSIGNED GOLD
// ============================================================

function processAssignedGold(
    event,
    entity,
    tick
) {

    assignedGoldEvents++;


    const entityIndex =
        getEntityIndex(
            entity
        );


    if (
        entityIndex !==
        null
    ) {

        assignedGoldIndexes.add(
            entityIndex
        );
    }


    const operation =
        decodeOperation(
            event.operation
        );


    increment(
        assignedGoldOperationCounts,
        operation
    );


    if (
        operation ===
        'CREATE'
    ) {

        assignedGoldCreates++;
    }


    if (
        operation ===
        'UPDATE'
    ) {

        assignedGoldUpdates++;
    }


    if (
        operation ===
        'LEAVE'
    ) {

        assignedGoldLeaves++;
    }


    if (
        operation ===
        'DELETE'
    ) {

        assignedGoldDeletes++;
    }


    if (
        assignedGoldOperationSamples.length <
        MAX_RAW_OPERATION_SAMPLES
    ) {

        assignedGoldOperationSamples.push({

            tick,

            entityIndex,

            decoded:
                operation,

            raw:
                serialize(
                    event.operation
                )
        });
    }


    // ========================================================
    // FIELD DISCOVERY
    // ========================================================

    if (
        !assignedGoldFieldsCaptured
    ) {

        const fields =
            getFieldEntries(
                entity
            );


        if (
            fields.length >
            0
        ) {

            assignedGoldFieldsCaptured =
                true;


            for (
                const [
                    fieldName
                ]
                of fields.slice(
                    0,
                    MAX_ASSIGNED_GOLD_FIELD_SAMPLE
                )
            ) {

                assignedGoldFieldNames.add(
                    fieldName
                );


                if (
                    INTERESTING_ASSIGNED_GOLD_FIELD_PATTERN.test(
                        fieldName
                    )
                ) {

                    assignedGoldInterestingFieldNames.add(
                        fieldName
                    );
                }
            }
        }
    }


    // ========================================================
    // CHANGES
    // ========================================================

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

            operation,

            type:
                describeType(
                    rawChanges
                ),

            raw:
                serialize(
                    rawChanges
                )
        });
    }


    const changeFields =
        extractChangeFieldNames(
            rawChanges
        );


    const interestingChanges =
        changeFields.filter(
            fieldName =>
                INTERESTING_ASSIGNED_GOLD_FIELD_PATTERN.test(
                    fieldName
                )
        );


    // ========================================================
    // CURRENT INTERESTING STATE
    // ========================================================

    const currentInterestingState =
        readInterestingAssignedGoldState(
            entity
        );


    const compact =
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

            className:
                'CCitadel_Pickup_AssignedGold',

            entityIndex,

            operation,

            position:
                getWorldPosition(
                    entity
                ),

            changeFields:
                changeFields.slice(
                    0,
                    MAX_CHANGE_FIELDS_PER_EVENT
                ),

            interestingChanges:
                interestingChanges.slice(
                    0,
                    MAX_CHANGE_FIELDS_PER_EVENT
                ),

            state:
                currentInterestingState
        };


    // ========================================================
    // CREATE SAMPLE
    // ========================================================

    if (
        operation ===
        'CREATE'
    ) {

        assignedGoldCreateRows.push(
            compact
        );


        if (
            assignedGoldCreateExamples.length <
            MAX_CREATE_EXAMPLES
        ) {

            assignedGoldCreateExamples.push(
                compact
            );
        }
    }


    // ========================================================
    // INTERESTING UPDATE SAMPLE
    // ========================================================

    if (
        operation ===
            'UPDATE'
        &&
        interestingChanges.length >
            0
        &&
        interestingUpdateExamples.length <
            MAX_INTERESTING_UPDATE_EXAMPLES
    ) {

        interestingUpdateExamples.push(
            compact
        );
    }


    // ========================================================
    // CORRELATE TO PENDING DEATHS
    // ========================================================

    for (
        const death
        of pendingDeaths
    ) {

        const delta =
            tick -
            death.tick;


        if (
            delta <
                0
            ||
            delta >
                WINDOW_TICKS
        ) {

            continue;
        }


        associateAssignedGoldWithDeath(
            death,
            compact
        );
    }


    // ========================================================
    // ROLLING BUFFER
    // ========================================================

    assignedGoldBuffer.push(
        compact
    );


    maximumBufferSize =
        Math.max(
            maximumBufferSize,
            getAssignedGoldBufferSize()
        );
}


// ============================================================
// ASSOCIATE EVENT WITH DEATH
// ============================================================

function associateAssignedGoldWithDeath(
    death,
    assignedGoldEvent
) {

    const tickDelta =
        assignedGoldEvent.tick -
        death.tick;


    if (
        Math.abs(
            tickDelta
        ) >
        WINDOW_TICKS
    ) {

        return;
    }


    let distance3D =
        null;


    if (
        death.position
        &&
        assignedGoldEvent.position
    ) {

        distance3D =
            getDistance3D(
                death.position,
                assignedGoldEvent.position
            );


        // Do not reject on position because this class might
        // not represent a literal pickup location.
    }


    death.seenAny =
        true;


    if (
        assignedGoldEvent.operation ===
        'CREATE'
    ) {

        death.seenCreate =
            true;
    }


    if (
        tickDelta ===
        0
    ) {

        death.seenExactAny =
            true;


        if (
            assignedGoldEvent.operation ===
            'CREATE'
        ) {

            death.seenExactCreate =
                true;
        }
    }


    increment(
        anyEventTickDeltaHistogram,
        String(
            tickDelta
        )
    );


    if (
        assignedGoldEvent.operation ===
        'CREATE'
    ) {

        increment(
            createTickDeltaHistogram,
            String(
                tickDelta
            )
        );
    }


    const subclassKey =
        String(
            death.subclassId
            ??
            'UNKNOWN'
        );


    if (
        !subclassCorrelation.has(
            subclassKey
        )
    ) {

        subclassCorrelation.set(
            subclassKey,
            makeSubclassCorrelation()
        );
    }


    const correlation =
        subclassCorrelation.get(
            subclassKey
        );


    correlation.anyEventCount++;


    if (
        assignedGoldEvent.operation ===
        'CREATE'
    ) {

        correlation.createEventCount++;
    }


    if (
        death.correlatedEvents.length <
        MAX_EVENTS_PER_DEATH
    ) {

        death.correlatedEvents.push({

            tick:
                assignedGoldEvent.tick,

            tickDelta,

            secondsDelta:
                tickDelta /
                TICK_RATE,

            entityIndex:
                assignedGoldEvent.entityIndex,

            operation:
                assignedGoldEvent.operation,

            distance3D,

            position:
                assignedGoldEvent.position,

            interestingChanges:
                assignedGoldEvent.interestingChanges,

            state:
                assignedGoldEvent.state
        });
    }
}


// ============================================================
// FINALIZE ONE DEATH
// ============================================================

function finalizeDeathCorrelation(
    death
) {

    const subclassKey =
        String(
            death.subclassId
            ??
            'UNKNOWN'
        );


    if (
        !subclassCorrelation.has(
            subclassKey
        )
    ) {

        subclassCorrelation.set(
            subclassKey,
            makeSubclassCorrelation()
        );
    }


    const correlation =
        subclassCorrelation.get(
            subclassKey
        );


    if (
        death.seenAny
    ) {

        deathsWithAnyAssignedGoldEvent++;


        correlation.deathsWithAny++;
    }


    if (
        death.seenCreate
    ) {

        deathsWithCreate++;


        correlation.deathsWithCreate++;
    }


    if (
        death.seenExactAny
    ) {

        deathsWithExactTickAnyEvent++;


        correlation.deathsWithExactTickAny++;
    }


    if (
        death.seenExactCreate
    ) {

        deathsWithExactTickCreate++;


        correlation.deathsWithExactTickCreate++;
    }


    if (
        death.correlatedEvents.length >
            0
        &&
        detailedDeathCorrelations.length <
            MAX_DETAILED_DEATHS_WITH_SIGNAL
    ) {

        detailedDeathCorrelations.push({

            deathIndex:
                death.deathIndex,

            trooperEntityIndex:
                death.entityIndex,

            tick:
                death.tick,

            timeSeconds:
                death.timeSeconds,

            clock:
                death.clock,

            team:
                death.team,

            lane:
                death.lane,

            subclassId:
                death.subclassId,

            previousHealth:
                death.previousHealth,

            currentLifeState:
                death.currentLifeState,

            position:
                death.position,

            seenAny:
                death.seenAny,

            seenCreate:
                death.seenCreate,

            seenExactAny:
                death.seenExactAny,

            seenExactCreate:
                death.seenExactCreate,

            assignedGoldEvents:
                death.correlatedEvents
        });
    }
}


// ============================================================
// SUBCLASS CORRELATION OBJECT
// ============================================================

function makeSubclassCorrelation() {

    return {

        deathsWithAny:
            0,

        deathsWithCreate:
            0,

        deathsWithExactTickAny:
            0,

        deathsWithExactTickCreate:
            0,

        anyEventCount:
            0,

        createEventCount:
            0
    };
}


// ============================================================
// BUFFER MANAGEMENT
// ============================================================

function pruneAssignedGoldBuffer(
    minimumTick
) {

    while (
        assignedGoldBufferStart <
            assignedGoldBuffer.length
        &&
        assignedGoldBuffer[
            assignedGoldBufferStart
        ].tick <
            minimumTick
    ) {

        assignedGoldBufferStart++;
    }


    if (
        assignedGoldBufferStart >
            5000
    ) {

        assignedGoldBuffer =
            assignedGoldBuffer.slice(
                assignedGoldBufferStart
            );


        assignedGoldBufferStart =
            0;
    }
}


function getAssignedGoldBufferSize() {

    return (
        assignedGoldBuffer.length -
        assignedGoldBufferStart
    );
}


// ============================================================
// OPERATION DECODE
// ============================================================

function decodeOperation(
    operation
) {

    const code =
        operation
            ?._code
        ??
        operation
            ?.code
        ??
        operation;


    const value =
        String(
            code
            ??
            'UNKNOWN'
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
// GET CHANGES
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
// EXTRACT CHANGED FIELD NAMES
// ============================================================

function extractChangeFieldNames(
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


    let rows;


    if (
        Array.isArray(
            raw
        )
    ) {

        rows =
            raw;

    } else if (
        raw instanceof Map
    ) {

        rows =
            [
                ...raw.entries()
            ];

    } else if (
        typeof raw?.[Symbol.iterator] ===
            'function'
        &&
        typeof raw !==
            'string'
    ) {

        try {

            rows =
                [
                    ...raw
                ];

        } catch {

            rows =
                [
                    raw
                ];
        }

    } else if (
        typeof raw ===
        'object'
    ) {

        rows =
            [
                raw
            ];

    } else {

        rows =
            [
                raw
            ];
    }


    const output =
        [];


    for (
        const row
        of rows
    ) {

        let name =
            null;


        if (
            Array.isArray(
                row
            )
            &&
            row.length >
                0
        ) {

            name =
                normalizeFieldName(
                    row[0]
                );

        } else if (
            typeof row ===
                'string'
        ) {

            name =
                row;

        } else if (
            row
            &&
            typeof row ===
                'object'
        ) {

            name =
                normalizeFieldName(
                    row.fieldName
                    ??
                    row.name
                    ??
                    row.key
                    ??
                    row.path
                    ??
                    row.fieldPath
                    ??
                    row.field
                );
        }


        if (
            name
        ) {

            output.push(
                name
            );
        }
    }


    return [
        ...new Set(
            output
        )
    ];
}


// ============================================================
// READ ASSIGNED GOLD STATE
// ============================================================

function readInterestingAssignedGoldState(
    entity
) {

    const output =
        {};


    let count =
        0;


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
            !INTERESTING_ASSIGNED_GOLD_FIELD_PATTERN.test(
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


        count++;


        if (
            count >=
            60
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

            return [
                ...entity.fieldEntries()
            ]
                .map(
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

        // Ignore field iteration failure.
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

        // Missing field.
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
// WORLD POSITION
// ============================================================

function getWorldPosition(
    entity
) {

    const cellX =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_cellX'
            )
        );


    const cellY =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_cellY'
            )
        );


    const cellZ =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_cellZ'
            )
        );


    const vecX =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_vecX'
            )
        );


    const vecY =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_vecY'
            )
        );


    const vecZ =
        finite(
            safeGetField(
                entity,
                'CBodyComponent.m_vecZ'
            )
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
// DISTANCE
// ============================================================

function getDistance3D(
    a,
    b
) {

    const dx =
        a.x -
        b.x;


    const dy =
        a.y -
        b.y;


    const dz =
        (
            a.z
            ??
            0
        )
        -
        (
            b.z
            ??
            0
        );


    return Math.sqrt(
        dx *
        dx
        +
        dy *
        dy
        +
        dz *
        dz
    );
}


// ============================================================
// FIELD NAME
// ============================================================

function normalizeFieldName(
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

        return normalizeFieldName(
            value.name
            ??
            value.path
            ??
            value.fieldName
            ??
            value.key
            ??
            null
        );
    }


    return String(
        value
    );
}


// ============================================================
// TYPE
// ============================================================

function describeType(
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
// HISTOGRAM OBJECT
// ============================================================

function mapToNumericKeyObject(
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
                Number(
                    a[0]
                )
                -
                Number(
                    b[0]
                )
        )
    );
}


// ============================================================
// MAP SORT
// ============================================================

function mapToSortedObject(
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
// SERIALIZE SCALAR
// ============================================================

function serializeScalar(
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
                40
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
                40
            )
            .map(
                (
                    [
                        key,
                        nested
                    ]
                ) => [

                    String(
                        key
                    ),

                    serialize(
                        nested
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
// FINITE
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


// ============================================================
// FORMAT PERCENT
// ============================================================

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
        2
    )
    +
    '%';
}