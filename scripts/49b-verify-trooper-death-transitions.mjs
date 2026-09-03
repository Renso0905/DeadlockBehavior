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


const MAX_TRANSITION_EXAMPLES =
    100;


const MAX_OPERATION_SAMPLES =
    30;


const PROGRESS_EVERY_TROOPER_EVENTS =
    1_000_000;


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
        'trooper_death_transition_verification.json'
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
// STATE
// ============================================================

const previousByEntity =
    new Map();


const trooperIndexes =
    new Set();


const operationCounts =
    new Map();


const rawOperationSamples =
    [];


const subclassCounts =
    new Map();


const teamCounts =
    new Map();


// ============================================================
// COUNTERS
// ============================================================

let trooperEvents =
    0;


let rowsWithHealth =
    0;


let rowsWithLifeState =
    0;


let rowsWithBoth =
    0;


let rowsMissingBoth =
    0;


let fieldEntryFallbacks =
    0;


let healthChanges =
    0;


let lifeStateChanges =
    0;


let healthNonZeroToZero =
    0;


let healthZeroToPositive =
    0;


let lifeAliveToDead =
    0;


let lifeDeadToAlive =
    0;


let combinedDeathCandidates =
    0;


// ============================================================
// TRANSITION ROWS
// ============================================================

const deathCandidates =
    [];


const healthTransitionExamples =
    [];


const lifeTransitionExamples =
    [];


const respawnTransitionExamples =
    [];


// Prevent duplicate death rows if the same Trooper receives
// multiple mutations during one tick.
const deathKeys =
    new Set();


const respawnKeys =
    new Set();


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
                    ` | health deaths: ${healthNonZeroToZero}`
                    +
                    ` | life deaths: ${lifeAliveToDead}`
                    +
                    ` | combined: ${combinedDeathCandidates}`
                );
            }


            // =================================================
            // RAW OPERATION DIAGNOSTIC
            //
            // We do not use operation for death detection.
            // =================================================

            const operationDescription =
                describeOperation(
                    event.operation
                );


            increment(
                operationCounts,
                operationDescription.key
            );


            if (
                rawOperationSamples.length <
                MAX_OPERATION_SAMPLES
            ) {

                rawOperationSamples.push({

                    tick,

                    entityIndex:
                        getEntityIndex(
                            entity
                        ),

                    description:
                        operationDescription
                });
            }


            // =================================================
            // ENTITY INDEX
            // =================================================

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


            trooperIndexes.add(
                entityIndex
            );


            // =================================================
            // READ CURRENT STATE
            // =================================================

            const current =
                readTrooperState(
                    entity,
                    tick
                );


            if (
                current.usedFieldEntryFallback
            ) {

                fieldEntryFallbacks++;
            }


            if (
                current.health !==
                null
            ) {

                rowsWithHealth++;
            }


            if (
                current.lifeState !==
                null
            ) {

                rowsWithLifeState++;
            }


            if (
                current.health !==
                    null
                &&
                current.lifeState !==
                    null
            ) {

                rowsWithBoth++;
            }


            if (
                current.health ===
                    null
                &&
                current.lifeState ===
                    null
            ) {

                rowsMissingBoth++;
            }


            // =================================================
            // SUBCLASS / TEAM
            // =================================================

            if (
                !previousByEntity.has(
                    entityIndex
                )
            ) {

                if (
                    current.subclassId !==
                    null
                ) {

                    increment(
                        subclassCounts,
                        String(
                            current.subclassId
                        )
                    );
                }


                if (
                    current.team !==
                    null
                ) {

                    increment(
                        teamCounts,
                        String(
                            current.team
                        )
                    );
                }
            }


            const previous =
                previousByEntity.get(
                    entityIndex
                )
                ??
                null;


            // =================================================
            // NO PREVIOUS STATE YET
            // =================================================

            if (
                !previous
            ) {

                previousByEntity.set(
                    entityIndex,
                    current
                );


                continue;
            }


            // =================================================
            // HEALTH TRANSITION
            // =================================================

            let healthDeath =
                false;


            let healthRespawn =
                false;


            if (
                previous.health !==
                    null
                &&
                current.health !==
                    null
                &&
                previous.health !==
                    current.health
            ) {

                healthChanges++;


                if (
                    healthTransitionExamples.length <
                    MAX_TRANSITION_EXAMPLES
                ) {

                    healthTransitionExamples.push({

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

                        previousHealth:
                            previous.health,

                        currentHealth:
                            current.health,

                        lifeState:
                            current.lifeState,

                        team:
                            current.team,

                        lane:
                            current.lane,

                        subclassId:
                            current.subclassId,

                        position:
                            current.position
                    });
                }


                if (
                    previous.health >
                        0
                    &&
                    current.health <=
                        0
                ) {

                    healthNonZeroToZero++;


                    healthDeath =
                        true;
                }


                if (
                    previous.health <=
                        0
                    &&
                    current.health >
                        0
                ) {

                    healthZeroToPositive++;


                    healthRespawn =
                        true;
                }
            }


            // =================================================
            // LIFE-STATE TRANSITION
            // =================================================

            let lifeDeath =
                false;


            let lifeRespawn =
                false;


            if (
                previous.lifeState !==
                    null
                &&
                current.lifeState !==
                    null
                &&
                previous.lifeState !==
                    current.lifeState
            ) {

                lifeStateChanges++;


                if (
                    lifeTransitionExamples.length <
                    MAX_TRANSITION_EXAMPLES
                ) {

                    lifeTransitionExamples.push({

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

                        previousLifeState:
                            previous.lifeState,

                        currentLifeState:
                            current.lifeState,

                        health:
                            current.health,

                        team:
                            current.team,

                        lane:
                            current.lane,

                        subclassId:
                            current.subclassId,

                        position:
                            current.position
                    });
                }


                if (
                    previous.lifeState ===
                        0
                    &&
                    current.lifeState !==
                        0
                ) {

                    lifeAliveToDead++;


                    lifeDeath =
                        true;
                }


                if (
                    previous.lifeState !==
                        0
                    &&
                    current.lifeState ===
                        0
                ) {

                    lifeDeadToAlive++;


                    lifeRespawn =
                        true;
                }
            }


            // =================================================
            // COMBINED DEATH CANDIDATE
            //
            // We accept either signal for this diagnostic.
            // Later we will determine which is canonical.
            // =================================================

            if (
                healthDeath
                ||
                lifeDeath
            ) {

                const deathKey =
                    `${entityIndex}|${tick}`;


                if (
                    !deathKeys.has(
                        deathKey
                    )
                ) {

                    deathKeys.add(
                        deathKey
                    );


                    combinedDeathCandidates++;


                    deathCandidates.push({

                        deathIndex:
                            deathCandidates.length,

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

                        healthSignal:
                            healthDeath,

                        lifeStateSignal:
                            lifeDeath,

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
                            previous.position
                    });
                }
            }


            // =================================================
            // RESPAWN / SLOT REUSE CANDIDATE
            // =================================================

            if (
                healthRespawn
                ||
                lifeRespawn
            ) {

                const respawnKey =
                    `${entityIndex}|${tick}`;


                if (
                    !respawnKeys.has(
                        respawnKey
                    )
                ) {

                    respawnKeys.add(
                        respawnKey
                    );


                    if (
                        respawnTransitionExamples.length <
                        MAX_TRANSITION_EXAMPLES
                    ) {

                        respawnTransitionExamples.push({

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

                            healthSignal:
                                healthRespawn,

                            lifeStateSignal:
                                lifeRespawn,

                            previousHealth:
                                previous.health,

                            currentHealth:
                                current.health,

                            previousLifeState:
                                previous.lifeState,

                            currentLifeState:
                                current.lifeState,

                            team:
                                current.team,

                            lane:
                                current.lane,

                            subclassId:
                                current.subclassId,

                            position:
                                current.position
                        });
                    }
                }
            }


            // =================================================
            // UPDATE STORED STATE
            // =================================================

            previousByEntity.set(
                entityIndex,
                current
            );
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
    'TROOPER DEATH TRANSITION VERIFICATION'
);

console.log(
    '======================================'
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log('');

console.log(
    'Ignoring EntityMutationEvent.operation for death detection.'
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// SIGNAL AGREEMENT
// ============================================================

let deathBothSignals =
    0;


let deathHealthOnly =
    0;


let deathLifeOnly =
    0;


for (
    const death
    of deathCandidates
) {

    if (
        death.healthSignal
        &&
        death.lifeStateSignal
    ) {

        deathBothSignals++;

    } else if (
        death.healthSignal
    ) {

        deathHealthOnly++;

    } else if (
        death.lifeStateSignal
    ) {

        deathLifeOnly++;
    }
}


// ============================================================
// SUBCLASS DEATH COUNTS
// ============================================================

const deathsBySubclass =
    new Map();


const deathsByTeam =
    new Map();


const deathsByLane =
    new Map();


for (
    const death
    of deathCandidates
) {

    increment(
        deathsBySubclass,
        String(
            death.subclassId
            ??
            'UNKNOWN'
        )
    );


    increment(
        deathsByTeam,
        String(
            death.team
            ??
            'UNKNOWN'
        )
    );


    increment(
        deathsByLane,
        String(
            death.lane
            ??
            'UNKNOWN'
        )
    );
}


// ============================================================
// DEATH TIMING SUMMARY
// ============================================================

const deathTimes =
    deathCandidates

        .map(
            row =>
                row.timeSeconds
        )

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


// ============================================================
// VALIDATION
// ============================================================

const validation =
    {

        trooperEventsObserved:
            {

                actual:
                    trooperEvents,

                expected:
                    '>0',

                pass:
                    trooperEvents >
                    0
            },

        uniqueTroopersObserved:
            {

                actual:
                    trooperIndexes.size,

                expected:
                    '>0',

                pass:
                    trooperIndexes.size >
                    0
            },

        healthReadable:
            {

                actual:
                    rowsWithHealth,

                expected:
                    '>0',

                pass:
                    rowsWithHealth >
                    0
            },

        lifeStateReadable:
            {

                actual:
                    rowsWithLifeState,

                expected:
                    '>0',

                pass:
                    rowsWithLifeState >
                    0
            },

        healthTransitionsObserved:
            {

                actual:
                    healthChanges,

                expected:
                    '>0',

                pass:
                    healthChanges >
                    0
            },

        deathCandidatesObserved:
            {

                actual:
                    combinedDeathCandidates,

                expected:
                    '>0',

                pass:
                    combinedDeathCandidates >
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
            'TROOPER_DEATH_TRANSITION_VERIFICATION',

        canonical:
            false,

        purpose:
            [

                'Verify CNPC_Trooper death transitions directly from current entity state without relying on EntityMutationEvent.operation.',

                'Determine whether m_iHealth, m_lifeState, or both provide the reliable replay death signal.',

                'Inspect the raw operation representation separately so the deadem operation enum can be corrected later.',

                'Prepare a validated Trooper death stream for soul telemetry correlation.'
            ],

        counts:
            {

                trooperEvents,

                uniqueTrooperIndexes:
                    trooperIndexes.size,

                rowsWithHealth,

                rowsWithLifeState,

                rowsWithBoth,

                rowsMissingBoth,

                fieldEntryFallbacks,

                healthChanges,

                lifeStateChanges,

                healthNonZeroToZero,

                healthZeroToPositive,

                lifeAliveToDead,

                lifeDeadToAlive,

                combinedDeathCandidates,

                deathBothSignals,

                deathHealthOnly,

                deathLifeOnly
            },

        operationDiagnostic:
            {

                counts:
                    mapToSortedObject(
                        operationCounts
                    ),

                samples:
                    rawOperationSamples
            },

        trooperSlots:
            {

                subclassCounts:
                    mapToSortedObject(
                        subclassCounts
                    ),

                teamCounts:
                    mapToSortedObject(
                        teamCounts
                    )
            },

        deathDistribution:
            {

                bySubclass:
                    mapToSortedObject(
                        deathsBySubclass
                    ),

                byTeam:
                    mapToSortedObject(
                        deathsByTeam
                    ),

                byLane:
                    mapToSortedObject(
                        deathsByLane
                    ),

                firstDeathTimeSeconds:
                    deathTimes[0]
                    ??
                    null,

                firstDeathClock:
                    deathTimes.length >
                        0
                        ? formatClock(
                            deathTimes[0]
                        )
                        : null,

                lastDeathTimeSeconds:
                    deathTimes[
                        deathTimes.length -
                        1
                    ]
                    ??
                    null,

                lastDeathClock:
                    deathTimes.length >
                        0
                        ? formatClock(
                            deathTimes[
                                deathTimes.length -
                                1
                            ]
                        )
                        : null
            },

        deathCandidates,

        transitionExamples:
            {

                health:
                    healthTransitionExamples,

                lifeState:
                    lifeTransitionExamples,

                respawnOrSlotReuse:
                    respawnTransitionExamples
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
    'FIELD READABILITY'
);

console.log(
    '-----------------'
);

console.log(
    `Trooper events: ${trooperEvents.toLocaleString()}`
);

console.log(
    `Rows with health: ${rowsWithHealth.toLocaleString()}`
);

console.log(
    `Rows with lifeState: ${rowsWithLifeState.toLocaleString()}`
);

console.log(
    `Rows with both: ${rowsWithBoth.toLocaleString()}`
);

console.log(
    `Rows missing both: ${rowsMissingBoth.toLocaleString()}`
);

console.log(
    `fieldEntries fallbacks: ${fieldEntryFallbacks.toLocaleString()}`
);

console.log('');

console.log(
    'HEALTH'
);

console.log(
    '------'
);

console.log(
    `Health changes: ${healthChanges.toLocaleString()}`
);

console.log(
    `>0 -> 0: ${healthNonZeroToZero.toLocaleString()}`
);

console.log(
    `0 -> >0: ${healthZeroToPositive.toLocaleString()}`
);

console.log('');

console.log(
    'LIFE STATE'
);

console.log(
    '----------'
);

console.log(
    `Life-state changes: ${lifeStateChanges.toLocaleString()}`
);

console.log(
    `0 -> nonzero: ${lifeAliveToDead.toLocaleString()}`
);

console.log(
    `nonzero -> 0: ${lifeDeadToAlive.toLocaleString()}`
);

console.log('');

console.log(
    'COMBINED DEATH SIGNAL'
);

console.log(
    '---------------------'
);

console.log(
    `Deaths: ${combinedDeathCandidates.toLocaleString()}`
);

console.log(
    `Both signals: ${deathBothSignals.toLocaleString()}`
);

console.log(
    `Health only: ${deathHealthOnly.toLocaleString()}`
);

console.log(
    `Life only: ${deathLifeOnly.toLocaleString()}`
);

console.log('');

console.log(
    'RAW EVENT.OPERATION VALUES'
);

console.log(
    '--------------------------'
);


for (
    const [
        key,
        count
    ]
    of Object.entries(
        mapToSortedObject(
            operationCounts
        )
    )
) {

    console.log(
        `${key.padEnd(
            50
        )} ${count}`
    );
}


console.log('');

console.log(
    'DEATHS BY TROOPER SUBCLASS'
);

console.log(
    '--------------------------'
);


for (
    const [
        key,
        count
    ]
    of Object.entries(
        mapToSortedObject(
            deathsBySubclass
        )
    )
) {

    console.log(
        `${key.padEnd(
            24
        )} ${count}`
    );
}


console.log('');

console.log(
    'DEATH TIMING'
);

console.log(
    '------------'
);

console.log(
    `First: ${
        deathTimes.length >
            0
            ? formatClock(
                deathTimes[0]
            )
            : 'n/a'
    }`
);

console.log(
    `Last: ${
        deathTimes.length >
            0
            ? formatClock(
                deathTimes[
                    deathTimes.length -
                    1
                ]
            )
            : 'n/a'
    }`
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
    `Output:\n${outputPath}`
);

console.log('');


// ============================================================
// READ TROOPER STATE
// ============================================================

function readTrooperState(
    entity,
    tick
) {

    let usedFieldEntryFallback =
        false;


    let health =
        finite(
            safeGetField(
                entity,
                'm_iHealth'
            )
        );


    let maxHealth =
        finite(
            safeGetField(
                entity,
                'm_iMaxHealth'
            )
        );


    let lifeState =
        finite(
            safeGetField(
                entity,
                'm_lifeState'
            )
        );


    let team =
        finite(
            safeGetField(
                entity,
                'm_iTeamNum'
            )
        );


    let lane =
        finite(
            safeGetField(
                entity,
                'm_iLane'
            )
        );


    let subclassId =
        serializeScalar(
            safeGetField(
                entity,
                'm_nSubclassID'
            )
        );


    // --------------------------------------------------------
    // Fallback if direct getField unexpectedly fails.
    //
    // We only iterate fieldEntries when one of the core
    // health/life fields is missing.
    // --------------------------------------------------------

    if (
        health ===
            null
        ||
        lifeState ===
            null
    ) {

        const targets =
            new Map();


        for (
            const [
                name,
                value
            ]
            of getFieldEntries(
                entity
            )
        ) {

            if (
                name ===
                    'm_iHealth'
                ||
                name ===
                    'm_iMaxHealth'
                ||
                name ===
                    'm_lifeState'
                ||
                name ===
                    'm_iTeamNum'
                ||
                name ===
                    'm_iLane'
                ||
                name ===
                    'm_nSubclassID'
            ) {

                targets.set(
                    name,
                    value
                );
            }
        }


        if (
            health ===
                null
        ) {

            health =
                finite(
                    targets.get(
                        'm_iHealth'
                    )
                );
        }


        if (
            maxHealth ===
                null
        ) {

            maxHealth =
                finite(
                    targets.get(
                        'm_iMaxHealth'
                    )
                );
        }


        if (
            lifeState ===
                null
        ) {

            lifeState =
                finite(
                    targets.get(
                        'm_lifeState'
                    )
                );
        }


        if (
            team ===
                null
        ) {

            team =
                finite(
                    targets.get(
                        'm_iTeamNum'
                    )
                );
        }


        if (
            lane ===
                null
        ) {

            lane =
                finite(
                    targets.get(
                        'm_iLane'
                    )
                );
        }


        if (
            subclassId ===
                null
        ) {

            subclassId =
                serializeScalar(
                    targets.get(
                        'm_nSubclassID'
                    )
                );
        }


        usedFieldEntryFallback =
            true;
    }


    return {

        tick,

        health,

        maxHealth,

        lifeState,

        team,

        lane,

        subclassId,

        position:
            getWorldPosition(
                entity
            ),

        usedFieldEntryFallback
    };
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
// OPERATION DIAGNOSTIC
// ============================================================

function describeOperation(
    operation
) {

    if (
        operation ===
        null
    ) {

        return {

            key:
                'null',

            type:
                'null',

            value:
                null
        };
    }


    if (
        operation ===
        undefined
    ) {

        return {

            key:
                'undefined',

            type:
                'undefined',

            value:
                null
        };
    }


    const type =
        typeof operation;


    if (
        type ===
            'string'
        ||
        type ===
            'number'
        ||
        type ===
            'boolean'
        ||
        type ===
            'bigint'
    ) {

        return {

            key:
                `${type}:${String(
                    operation
                )}`,

            type,

            value:
                String(
                    operation
                )
        };
    }


    let constructorName =
        null;


    try {

        constructorName =
            operation
                ?.constructor
                ?.name
            ??
            null;

    } catch {

        constructorName =
            null;
    }


    let serialized =
        null;


    try {

        serialized =
            JSON.stringify(
                operation,
                (
                    key,
                    value
                ) =>
                    typeof value ===
                        'bigint'
                        ? value.toString()
                        : value
            );

    } catch {

        serialized =
            String(
                operation
            );
    }


    return {

        key:
            `${type}:${constructorName ?? '?'}:${serialized}`,

        type,

        constructorName,

        serialized
    };
}


// ============================================================
// FIELD ACCESS
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

        // Ignore missing field.
    }


    return undefined;
}


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
// MAP HELPERS
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