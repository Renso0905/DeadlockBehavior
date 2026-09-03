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

// ±2 seconds around each Trooper death.
const DEATH_WINDOW_TICKS =
    128;


// Broad discovery radius.
const DEATH_RADIUS =
    1600;


// Only retain detailed correlations for this many deaths.
// ALL deaths still contribute to aggregate class counts.
const MAX_DETAILED_DEATHS =
    600;


// Max candidate rows retained for one detailed death.
const MAX_CANDIDATES_PER_DEATH =
    40;


// Max raw samples retained per candidate entity class.
const MAX_RAW_SAMPLES_PER_CLASS =
    30;


// Max field examples retained per entity class.
const MAX_FIELD_SAMPLE =
    80;


// Max candidate active/inactive transitions retained.
const MAX_ACTIVE_TRANSITIONS =
    3000;


// Max interesting message examples retained.
const MAX_INTERESTING_MESSAGES =
    1000;


// Console progress interval.
const PROGRESS_EVERY_ENTITY_EVENTS =
    2_000_000;


// ============================================================
// CANDIDATE NAME FILTER
//
// IMPORTANT:
//
// Only entities whose CLASS NAME looks soul/resource-related
// enter the rolling correlation buffer.
//
// We still catalog ALL entity classes and their fields,
// so an unexpectedly named soul class can still be found
// afterward without storing millions of events.
// ============================================================

const STREAM_CANDIDATE_NAME_PATTERN =
    /soul|orb|pickup|essence|gold|currency|bounty/i;


const FIELD_HINT_PATTERN =
    /soul|orb|pickup|essence|gold|currency|reward|deny|denied|secure|secured|claim|bounty/i;


const MESSAGE_HINT_PATTERN =
    /soul|orb|deny|denied|secure|secured|trooper|currency|gold|bounty/i;


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
        'trooper_soul_telemetry_discovery.json'
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
// GLOBAL ENTITY CLASS CATALOG
//
// This is small: one object per class, not one object per
// mutation.
// ============================================================

const classStats =
    new Map();


let totalEntityMutationEvents =
    0;


// ============================================================
// TROOPER STATE
// ============================================================

const trooperState =
    new Map();


const trooperEntityIndexes =
    new Set();


const trooperSubclassCounts =
    new Map();


const trooperTeamCounts =
    new Map();


const trooperFieldNames =
    new Map();


const trooperDeaths =
    [];


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


// ============================================================
// STREAMING CANDIDATE BUFFER
//
// candidateBuffer contains only recent candidate events.
//
// We never retain the whole replay.
// ============================================================

let candidateBuffer =
    [];


let candidateBufferStart =
    0;


let maximumCandidateBufferSize =
    0;


let totalCandidateEventsObserved =
    0;


// ============================================================
// PENDING TROOPER DEATHS
//
// Death remains pending for +2 seconds so candidate activity
// after death can be correlated.
// ============================================================

let pendingDeaths =
    [];


// ============================================================
// CORRELATION COUNTERS
// ============================================================

// Total candidate event associations near deaths.
const nearbyCandidateEventCounts =
    new Map();


// Number of distinct Trooper deaths that had >=1 event from
// each candidate class.
const deathsWithCandidateClass =
    new Map();


// Detailed records for only first N deaths.
const detailedDeathCorrelations =
    [];


// ============================================================
// RAW CANDIDATE CLASS SAMPLES
// ============================================================

const rawCandidateSamplesByClass =
    new Map();


// ============================================================
// ACTIVE STATE TRACKING
// ============================================================

const candidateActiveState =
    new Map();


const activeTransitions =
    [];


// ============================================================
// MESSAGE DISCOVERY
// ============================================================

const messageCounts =
    new Map();


const interestingMessages =
    [];


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// ENTITY PACKETS
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
        // Remove deaths whose +2 second observation window
        // has completed.
        // ----------------------------------------------------

        pendingDeaths =
            pendingDeaths.filter(
                death =>
                    tick <=
                    death.tick +
                    DEATH_WINDOW_TICKS
            );


        // ----------------------------------------------------
        // Prune candidate events older than -2 seconds.
        // ----------------------------------------------------

        pruneCandidateBuffer(
            tick -
            DEATH_WINDOW_TICKS
        );


        for (
            const event
            of events
            ??
            []
        ) {

            totalEntityMutationEvents++;


            if (
                totalEntityMutationEvents %
                    PROGRESS_EVERY_ENTITY_EVENTS ===
                0
            ) {

                console.log(
                    `Entity mutations: ${totalEntityMutationEvents.toLocaleString()}`
                    +
                    ` | Trooper deaths: ${trooperDeaths.length.toLocaleString()}`
                    +
                    ` | candidate buffer: ${getCandidateBufferSize()}`
                );
            }


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
                !className
            ) {

                continue;
            }


            const entityIndex =
                getEntityIndex(
                    entity
                );


            const operation =
                normalizeOperation(
                    event.operation
                );


            // =================================================
            // GLOBAL CLASS CATALOG
            // =================================================

            const stats =
                getClassStats(
                    className
                );


            stats.events++;


            incrementOperation(
                stats,
                operation
            );


            if (
                entityIndex !==
                null
            ) {

                stats.entityIndexes.add(
                    entityIndex
                );
            }


            // Only inspect/cache fields the first time we see
            // the class.
            if (
                !stats.fieldsCaptured
            ) {

                stats.fieldsCaptured =
                    true;


                stats.fieldSample =
                    collectFieldSample(
                        entity,
                        MAX_FIELD_SAMPLE
                    );


                stats.fieldHint =
                    stats.fieldSample.some(
                        field =>
                            FIELD_HINT_PATTERN.test(
                                field.name
                            )
                    );
            }


            // =================================================
            // TROOPER
            // =================================================

            if (
                className ===
                'CNPC_Trooper'
            ) {

                processTrooperEvent(
                    entity,
                    entityIndex,
                    operation,
                    tick
                );


                continue;
            }


            // =================================================
            // STREAMED SOUL/RESOURCE CANDIDATE
            //
            // NAME FILTER ONLY.
            //
            // Generic fields like "owner" and "team" are not
            // enough to put a class into the rolling buffer.
            // =================================================

            if (
                !STREAM_CANDIDATE_NAME_PATTERN.test(
                    className
                )
            ) {

                continue;
            }


            const candidate =
                readCandidateEvent(
                    entity,
                    entityIndex,
                    className,
                    operation,
                    tick
                );


            totalCandidateEventsObserved++;


            // -------------------------------------------------
            // Bounded raw samples by class.
            // -------------------------------------------------

            if (
                !rawCandidateSamplesByClass.has(
                    className
                )
            ) {

                rawCandidateSamplesByClass.set(
                    className,
                    []
                );
            }


            const samples =
                rawCandidateSamplesByClass.get(
                    className
                );


            if (
                samples.length <
                MAX_RAW_SAMPLES_PER_CLASS
            ) {

                samples.push(
                    candidate
                );
            }


            // -------------------------------------------------
            // Correlate candidate with deaths that occurred
            // during the previous +2 seconds.
            // -------------------------------------------------

            for (
                const death
                of pendingDeaths
            ) {

                const tickDelta =
                    tick -
                    death.tick;


                if (
                    tickDelta <
                    0
                    ||
                    tickDelta >
                    DEATH_WINDOW_TICKS
                ) {

                    continue;
                }


                associateCandidateWithDeath(
                    death,
                    candidate
                );
            }


            // -------------------------------------------------
            // Add event to rolling buffer so future Trooper
            // deaths can inspect the preceding -2 seconds.
            // -------------------------------------------------

            candidateBuffer.push(
                candidate
            );


            maximumCandidateBufferSize =
                Math.max(
                    maximumCandidateBufferSize,
                    getCandidateBufferSize()
                );


            // =================================================
            // ACTIVE / INACTIVE TRANSITION
            // =================================================

            if (
                entityIndex !==
                    null
                &&
                candidate.active !==
                    null
            ) {

                const key =
                    `${className}|${entityIndex}`;


                const previousActive =
                    candidateActiveState.get(
                        key
                    );


                if (
                    previousActive !==
                        undefined
                    &&
                    previousActive !==
                        candidate.active
                    &&
                    activeTransitions.length <
                        MAX_ACTIVE_TRANSITIONS
                ) {

                    activeTransitions.push({

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

                        className,

                        entityIndex,

                        from:
                            previousActive,

                        to:
                            candidate.active,

                        position:
                            candidate.position,

                        fields:
                            candidate.fields
                    });
                }


                candidateActiveState.set(
                    key,
                    candidate.active
                );
            }
        }
    }
);


// ============================================================
// MESSAGE PACKETS
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        const tick =
            finite(
                demoPacket?.tick
            );


        const label =
            messageTypeLabel(
                messagePacket?.type
            );


        if (
            !label
        ) {

            return;
        }


        increment(
            messageCounts,
            label
        );


        if (
            MESSAGE_HINT_PATTERN.test(
                label
            )
            &&
            interestingMessages.length <
                MAX_INTERESTING_MESSAGES
        ) {

            interestingMessages.push({

                tick,

                timeSeconds:
                    tick !==
                        null
                        ? tickToMatchTime(
                            tick
                        )
                        : null,

                clock:
                    tick !==
                        null
                        ? formatClock(
                            tickToMatchTime(
                                tick
                            )
                        )
                        : null,

                type:
                    label,

                packetKeys:
                    Object.keys(
                        messagePacket
                        ??
                        {}
                    )
            });
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
    'TROOPER / SOUL TELEMETRY DISCOVERY'
);

console.log(
    'STREAMING / MEMORY-SAFE VERSION'
);

console.log(
    '======================================'
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Death window: ±${DEATH_WINDOW_TICKS / TICK_RATE}s`
);

console.log(
    `Discovery radius: ${DEATH_RADIUS}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// FINAL CLASS CATALOG
// ============================================================

const entityClassCatalog =
    [
        ...classStats.entries()
    ]

        .map(
            (
                [
                    className,
                    stats
                ]
            ) => ({

                className,

                uniqueEntities:
                    stats.entityIndexes.size,

                events:
                    stats.events,

                creates:
                    stats.creates,

                updates:
                    stats.updates,

                leaves:
                    stats.leaves,

                deletes:
                    stats.deletes,

                candidateByClassName:
                    STREAM_CANDIDATE_NAME_PATTERN.test(
                        className
                    ),

                candidateByFieldHint:
                    stats.fieldHint,

                fieldSample:
                    stats.fieldSample
            })
        )

        .sort(
            (
                a,
                b
            ) =>
                b.events -
                a.events
        );


// ============================================================
// RESOURCE CANDIDATE CLASS LIST
//
// Includes:
// 1. classes streamed because the name looked relevant
// 2. classes whose sampled fields contain a strong resource
//    hint, even if their name was unexpected.
//
// Category #2 was NOT streamed into death correlations;
// inspect it afterward if something important appears there.
// ============================================================

const candidateResourceClasses =
    entityClassCatalog

        .filter(
            row =>
                row.candidateByClassName
                ||
                row.candidateByFieldHint
        )

        .sort(
            (
                a,
                b
            ) => {

                if (
                    a.candidateByClassName !==
                    b.candidateByClassName
                ) {

                    return a.candidateByClassName
                        ? -1
                        : 1;
                }


                return b.events -
                    a.events;
            }
        );


// ============================================================
// MESSAGE SUMMARY
// ============================================================

const messages =
    [
        ...messageCounts.entries()
    ]

        .map(
            (
                [
                    type,
                    count
                ]
            ) => ({

                type,

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


// ============================================================
// TROOPER DEATH SUMMARY
// ============================================================

const compactTrooperDeaths =
    trooperDeaths.map(
        death => ({

            deathIndex:
                death.deathIndex,

            entityIndex:
                death.entityIndex,

            tick:
                death.tick,

            timeSeconds:
                death.timeSeconds,

            clock:
                death.clock,

            position:
                death.position,

            team:
                death.team,

            subclassId:
                death.subclassId,

            lane:
                death.lane
        })
    );


// ============================================================
// VALIDATION
// ============================================================

const validation =
    {

        entityClassesObserved:
            {

                actual:
                    entityClassCatalog.length,

                expected:
                    '>0',

                pass:
                    entityClassCatalog.length >
                    0
            },

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
                    trooperEntityIndexes.size,

                expected:
                    '>0',

                pass:
                    trooperEntityIndexes.size >
                    0
            },

        trooperDeathsDetected:
            {

                actual:
                    trooperDeaths.length,

                expected:
                    '>0',

                pass:
                    trooperDeaths.length >
                    0
            },

        candidateClassesFound:
            {

                actual:
                    candidateResourceClasses.length,

                expected:
                    '>0',

                pass:
                    candidateResourceClasses.length >
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
            'TROOPER_SOUL_TELEMETRY_DISCOVERY_STREAMING',

        canonical:
            false,

        architecture:
            {

                memorySafe:
                    true,

                explanation:
                    'Candidate entity mutations are processed in a short rolling window rather than retained for the entire replay.',

                streamedCandidateRule:
                    'Only classes whose class names match soul/orb/pickup/essence/gold/currency/bounty are streamed through death correlation.',

                fieldHintRule:
                    'All entity classes still receive one bounded field sample. Unexpected classes with soul/resource-like fields are surfaced separately for inspection.'
            },

        timing:
            {

                tickRate:
                    TICK_RATE,

                matchClockOffsetSeconds:
                    MATCH_CLOCK_OFFSET_SECONDS,

                deathWindowTicks:
                    DEATH_WINDOW_TICKS,

                deathWindowSeconds:
                    DEATH_WINDOW_TICKS /
                    TICK_RATE,

                deathRadius:
                    DEATH_RADIUS
            },

        memoryDiagnostics:
            {

                totalEntityMutationEvents,

                totalCandidateEventsObserved,

                maximumCandidateBufferSize,

                detailedDeathLimit:
                    MAX_DETAILED_DEATHS,

                detailedDeathsStored:
                    detailedDeathCorrelations.length,

                activeTransitionsStored:
                    activeTransitions.length
            },

        troopers:
            {

                events:
                    trooperEvents,

                creates:
                    trooperCreates,

                updates:
                    trooperUpdates,

                leaves:
                    trooperLeaves,

                deletes:
                    trooperDeletes,

                uniqueEntityIndexes:
                    trooperEntityIndexes.size,

                subclassCounts:
                    mapToSortedObject(
                        trooperSubclassCounts
                    ),

                teamCounts:
                    mapToSortedObject(
                        trooperTeamCounts
                    ),

                fieldNames:
                    mapToSortedObject(
                        trooperFieldNames
                    ),

                deathsDetected:
                    trooperDeaths.length,

                deaths:
                    compactTrooperDeaths
            },

        correlation:
            {

                nearbyCandidateEventCounts:
                    mapToSortedObject(
                        nearbyCandidateEventCounts
                    ),

                deathsWithCandidateClass:
                    mapToSortedObject(
                        deathsWithCandidateClass
                    ),

                detailedDeaths:
                    detailedDeathCorrelations
            },

        candidateResourceClasses,

        candidateResourceRawSamples:
            Object.fromEntries(
                rawCandidateSamplesByClass.entries()
            ),

        activeTransitions,

        messages,

        interestingMessages,

        entityClassCatalog,

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
// CONSOLE RESULTS
// ============================================================

console.log('');

console.log(
    'TROOPERS'
);

console.log(
    '--------'
);

console.log(
    `Entity events: ${trooperEvents.toLocaleString()}`
);

console.log(
    `Unique entity indexes: ${trooperEntityIndexes.size}`
);

console.log(
    `Detected death transitions: ${trooperDeaths.length}`
);

console.log('');

console.log(
    'MEMORY-SAFE STREAM'
);

console.log(
    '------------------'
);

console.log(
    `Total entity mutations: ${totalEntityMutationEvents.toLocaleString()}`
);

console.log(
    `Candidate events streamed: ${totalCandidateEventsObserved.toLocaleString()}`
);

console.log(
    `Maximum rolling candidate buffer: ${maximumCandidateBufferSize.toLocaleString()}`
);

console.log('');

console.log(
    'TROOPER SUBCLASSES'
);

console.log(
    '------------------'
);


for (
    const [
        key,
        count
    ]
    of Object.entries(
        mapToSortedObject(
            trooperSubclassCounts
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
    'STREAMED RESOURCE CLASSES NEAR TROOPER DEATHS'
);

console.log(
    '---------------------------------------------'
);


const nearbyEntries =
    Object.entries(
        mapToSortedObject(
            nearbyCandidateEventCounts
        )
    );


if (
    nearbyEntries.length ===
    0
) {

    console.log(
        'No streamed candidate classes correlated with Trooper deaths.'
    );

} else {

    for (
        const [
            className,
            count
        ]
        of nearbyEntries.slice(
            0,
            30
        )
    ) {

        console.log(
            `${className.padEnd(
                52
            )} ${count}`
        );
    }
}


console.log('');

console.log(
    'DEATHS WITH EACH CANDIDATE CLASS'
);

console.log(
    '--------------------------------'
);


const deathPresenceEntries =
    Object.entries(
        mapToSortedObject(
            deathsWithCandidateClass
        )
    );


if (
    deathPresenceEntries.length ===
    0
) {

    console.log(
        'No candidate class presence detected.'
    );

} else {

    for (
        const [
            className,
            count
        ]
        of deathPresenceEntries.slice(
            0,
            30
        )
    ) {

        console.log(
            `${className.padEnd(
                52
            )} ${count}`
        );
    }
}


console.log('');

console.log(
    'RESOURCE-LIKE ENTITY CLASSES'
);

console.log(
    '----------------------------'
);


for (
    const row
    of candidateResourceClasses.slice(
        0,
        40
    )
) {

    console.log(
        `${
            row.className.padEnd(
                52
            )
        } entities=${
            String(
                row.uniqueEntities
            ).padStart(
                5
            )
        } events=${
            String(
                row.events
            ).padStart(
                8
            )
        } name=${
            row.candidateByClassName
                ? 'Y'
                : 'N'
        } field=${
            row.candidateByFieldHint
                ? 'Y'
                : 'N'
        }`
    );
}


console.log('');

console.log(
    'SOUL-LIKE MESSAGE TYPES'
);

console.log(
    '-----------------------'
);


const soulMessages =
    messages.filter(
        row =>
            MESSAGE_HINT_PATTERN.test(
                row.type
            )
    );


if (
    soulMessages.length ===
    0
) {

    console.log(
        'No message names matched soul/orb/deny/secure terms.'
    );

} else {

    for (
        const row
        of soulMessages.slice(
            0,
            40
        )
    ) {

        console.log(
            `${row.type.padEnd(
                60
            )} ${row.count}`
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
// TROOPER EVENT PROCESSING
// ============================================================

function processTrooperEvent(
    entity,
    entityIndex,
    operation,
    tick
) {

    trooperEvents++;


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


    if (
        entityIndex ===
        null
    ) {

        return;
    }


    trooperEntityIndexes.add(
        entityIndex
    );


    // --------------------------------------------------------
    // Only collect field names on the first observation of
    // each Trooper entity.
    // --------------------------------------------------------

    if (
        !trooperState.has(
            entityIndex
        )
    ) {

        for (
            const [
                name
            ]
            of getFieldEntries(
                entity
            )
        ) {

            increment(
                trooperFieldNames,
                name
            );
        }
    }


    const current =
        readTrooperState(
            entity,
            tick
        );


    const previous =
        trooperState.get(
            entityIndex
        )
        ??
        null;


    // --------------------------------------------------------
    // Count subclass/team on first stable state only.
    // --------------------------------------------------------

    if (
        !previous
    ) {

        if (
            current.subclassId !==
            null
        ) {

            increment(
                trooperSubclassCounts,
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
                trooperTeamCounts,
                String(
                    current.team
                )
            );
        }
    }


    // ========================================================
    // TRUE STATE DEATH TRANSITION
    // ========================================================

    if (
        operation ===
            'UPDATE'
        &&
        previous
        &&
        wasAlive(
            previous
        )
        &&
        isDead(
            current
        )
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

                position:
                    current.position
                    ??
                    previous.position
                    ??
                    null,

                team:
                    current.team
                    ??
                    previous.team
                    ??
                    null,

                subclassId:
                    current.subclassId
                    ??
                    previous.subclassId
                    ??
                    null,

                lane:
                    current.lane
                    ??
                    previous.lane
                    ??
                    null,

                seenCandidateClasses:
                    new Set(),

                detail:
                    null
            };


        // ----------------------------------------------------
        // Retain detailed candidate rows for first N deaths.
        // ----------------------------------------------------

        if (
            death.deathIndex <
            MAX_DETAILED_DEATHS
        ) {

            death.detail =
                {

                    deathIndex:
                        death.deathIndex,

                    entityIndex,

                    tick,

                    timeSeconds:
                        death.timeSeconds,

                    clock:
                        death.clock,

                    position:
                        death.position,

                    team:
                        death.team,

                    subclassId:
                        death.subclassId,

                    lane:
                        death.lane,

                    candidates:
                        []
                };


            detailedDeathCorrelations.push(
                death.detail
            );
        }


        // ----------------------------------------------------
        // Correlate candidate events from preceding -2 sec.
        // ----------------------------------------------------

        for (
            let index =
                candidateBufferStart;

            index <
                candidateBuffer.length;

            index++
        ) {

            const candidate =
                candidateBuffer[
                    index
                ];


            const tickDelta =
                candidate.tick -
                death.tick;


            if (
                tickDelta <
                    -DEATH_WINDOW_TICKS
                ||
                tickDelta >
                    0
            ) {

                continue;
            }


            associateCandidateWithDeath(
                death,
                candidate
            );
        }


        trooperDeaths.push(
            death
        );


        pendingDeaths.push(
            death
        );
    }


    // ========================================================
    // PVS HANDLING
    //
    // Do not carry old health state across a LEAVE/DELETE.
    // ========================================================

    if (
        operation ===
            'LEAVE'
        ||
        operation ===
            'DELETE'
    ) {

        trooperState.delete(
            entityIndex
        );


        return;
    }


    trooperState.set(
        entityIndex,
        current
    );
}


// ============================================================
// ASSOCIATE CANDIDATE WITH DEATH
// ============================================================

function associateCandidateWithDeath(
    death,
    candidate
) {

    const tickDelta =
        candidate.tick -
        death.tick;


    if (
        Math.abs(
            tickDelta
        ) >
        DEATH_WINDOW_TICKS
    ) {

        return;
    }


    let distance3D =
        null;


    if (
        death.position
        &&
        candidate.position
    ) {

        distance3D =
            getDistance3D(
                death.position,
                candidate.position
            );


        if (
            distance3D >
            DEATH_RADIUS
        ) {

            return;
        }
    }


    // Total event associations.
    increment(
        nearbyCandidateEventCounts,
        candidate.className
    );


    // Unique death presence.
    if (
        !death.seenCandidateClasses.has(
            candidate.className
        )
    ) {

        death.seenCandidateClasses.add(
            candidate.className
        );


        increment(
            deathsWithCandidateClass,
            candidate.className
        );
    }


    // Detailed rows are bounded.
    if (
        death.detail
        &&
        death.detail.candidates.length <
            MAX_CANDIDATES_PER_DEATH
    ) {

        death.detail.candidates.push({

            tick:
                candidate.tick,

            tickDelta,

            secondsDelta:
                tickDelta /
                TICK_RATE,

            className:
                candidate.className,

            entityIndex:
                candidate.entityIndex,

            operation:
                candidate.operation,

            distance3D,

            position:
                candidate.position,

            active:
                candidate.active,

            interactive:
                candidate.interactive,

            fields:
                candidate.fields
        });
    }
}


// ============================================================
// READ TROOPER STATE
// ============================================================

function readTrooperState(
    entity,
    tick
) {

    return {

        tick,

        health:
            firstFiniteField(
                entity,
                [
                    'm_iHealth',
                    'm_iCurrentHealth',
                    'm_nHealth'
                ]
            ),

        maxHealth:
            firstFiniteField(
                entity,
                [
                    'm_iMaxHealth',
                    'm_nMaxHealth'
                ]
            ),

        lifeState:
            firstFiniteField(
                entity,
                [
                    'm_lifeState',
                    'm_nLifeState'
                ]
            ),

        team:
            firstFiniteField(
                entity,
                [
                    'm_iTeamNum',
                    'm_nTeamNum',
                    'm_iTeam'
                ]
            ),

        subclassId:
            serialize(
                firstExistingField(
                    entity,
                    [
                        'm_nSubclassID',
                        'm_nSubclassId'
                    ]
                )
            ),

        lane:
            firstFiniteField(
                entity,
                [
                    'm_nLane',
                    'm_iLane',
                    'm_eLane',
                    'm_nCurrentLane',
                    'm_iLaneAssignment'
                ]
            ),

        position:
            getWorldPosition(
                entity
            )
    };
}


// ============================================================
// READ CANDIDATE EVENT
// ============================================================

function readCandidateEvent(
    entity,
    entityIndex,
    className,
    operation,
    tick
) {

    return {

        tick,

        timeSeconds:
            tickToMatchTime(
                tick
            ),

        className,

        entityIndex,

        operation,

        position:
            getWorldPosition(
                entity
            ),

        active:
            firstBooleanField(
                entity,
                [
                    'm_bActive',
                    'm_bIsActive',
                    'm_bEnabled'
                ]
            ),

        interactive:
            firstBooleanField(
                entity,
                [
                    'm_bInteractive',
                    'm_bIsInteractive'
                ]
            ),

        fields:
            collectCandidateFields(
                entity
            )
    };
}


// ============================================================
// CANDIDATE BUFFER
// ============================================================

function pruneCandidateBuffer(
    minimumTick
) {

    while (
        candidateBufferStart <
            candidateBuffer.length
        &&
        candidateBuffer[
            candidateBufferStart
        ].tick <
            minimumTick
    ) {

        candidateBufferStart++;
    }


    // Occasionally compact the underlying array.
    if (
        candidateBufferStart >
            10000
    ) {

        candidateBuffer =
            candidateBuffer.slice(
                candidateBufferStart
            );


        candidateBufferStart =
            0;
    }
}


function getCandidateBufferSize() {

    return (
        candidateBuffer.length -
        candidateBufferStart
    );
}


// ============================================================
// ALIVE / DEAD
// ============================================================

function wasAlive(
    state
) {

    if (
        state.lifeState !==
        null
    ) {

        return (
            state.lifeState ===
            0
        );
    }


    if (
        state.health !==
        null
    ) {

        return (
            state.health >
            0
        );
    }


    return false;
}


function isDead(
    state
) {

    if (
        state.lifeState !==
        null
        &&
        state.lifeState !==
            0
    ) {

        return true;
    }


    if (
        state.health !==
        null
        &&
        state.health <=
            0
    ) {

        return true;
    }


    return false;
}


// ============================================================
// CLASS STATS
// ============================================================

function getClassStats(
    className
) {

    if (
        classStats.has(
            className
        )
    ) {

        return classStats.get(
            className
        );
    }


    const stats =
        {

            events:
                0,

            creates:
                0,

            updates:
                0,

            leaves:
                0,

            deletes:
                0,

            entityIndexes:
                new Set(),

            fieldsCaptured:
                false,

            fieldHint:
                false,

            fieldSample:
                []
        };


    classStats.set(
        className,
        stats
    );


    return stats;
}


function incrementOperation(
    stats,
    operation
) {

    if (
        operation ===
        'CREATE'
    ) {

        stats.creates++;
    }


    if (
        operation ===
        'UPDATE'
    ) {

        stats.updates++;
    }


    if (
        operation ===
        'LEAVE'
    ) {

        stats.leaves++;
    }


    if (
        operation ===
        'DELETE'
    ) {

        stats.deletes++;
    }
}


// ============================================================
// FIELD SAMPLING
// ============================================================

function collectFieldSample(
    entity,
    limit
) {

    return getFieldEntries(
        entity
    )

        .slice(
            0,
            limit
        )

        .map(
            (
                [
                    name,
                    value
                ]
            ) => ({

                name,

                value:
                    serialize(
                        value
                    )
            })
        );
}


// ============================================================
// CANDIDATE FIELDS
// ============================================================

function collectCandidateFields(
    entity
) {

    const output =
        [];


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
            !FIELD_HINT_PATTERN.test(
                name
            )
            &&
            !/subclass|source|target|owner|team|spawn|create|lifetime|velocity/i.test(
                name
            )
        ) {

            continue;
        }


        output.push({

            name,

            value:
                serialize(
                    value
                )
        });


        if (
            output.length >=
            40
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
                    entry => {

                        if (
                            Array.isArray(
                                entry
                            )
                        ) {

                            return [
                                String(
                                    entry[0]
                                ),
                                entry[1]
                            ];
                        }


                        if (
                            entry
                            &&
                            typeof entry ===
                            'object'
                        ) {

                            return [
                                String(
                                    entry.name
                                    ??
                                    entry.key
                                    ??
                                    entry.fieldName
                                    ??
                                    'UNKNOWN'
                                ),

                                entry.value
                            ];
                        }


                        return [
                            String(
                                entry
                            ),
                            null
                        ];
                    }
                );
        }

    } catch {

        // Ignore malformed field iteration.
    }


    return [];
}


// ============================================================
// FIELD LOOKUPS
// ============================================================

function firstExistingField(
    entity,
    names
) {

    for (
        const name
        of names
    ) {

        const value =
            safeGetField(
                entity,
                name
            );


        if (
            value !==
                null
            &&
            value !==
                undefined
        ) {

            return value;
        }
    }


    return null;
}


function firstFiniteField(
    entity,
    names
) {

    for (
        const name
        of names
    ) {

        const value =
            finite(
                safeGetField(
                    entity,
                    name
                )
            );


        if (
            value !==
            null
        ) {

            return value;
        }
    }


    return null;
}


function firstBooleanField(
    entity,
    names
) {

    for (
        const name
        of names
    ) {

        const value =
            safeGetField(
                entity,
                name
            );


        if (
            value ===
                true
            ||
            value ===
                1
            ||
            value ===
                '1'
        ) {

            return true;
        }


        if (
            value ===
                false
            ||
            value ===
                0
            ||
            value ===
                '0'
        ) {

            return false;
        }
    }


    return null;
}


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


    return null;
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
        firstFiniteField(
            entity,
            [
                'CBodyComponent.m_cellX'
            ]
        );


    const cellY =
        firstFiniteField(
            entity,
            [
                'CBodyComponent.m_cellY'
            ]
        );


    const cellZ =
        firstFiniteField(
            entity,
            [
                'CBodyComponent.m_cellZ'
            ]
        );


    const vecX =
        firstFiniteField(
            entity,
            [
                'CBodyComponent.m_vecX'
            ]
        );


    const vecY =
        firstFiniteField(
            entity,
            [
                'CBodyComponent.m_vecY'
            ]
        );


    const vecZ =
        firstFiniteField(
            entity,
            [
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
// MESSAGE LABEL
// ============================================================

function messageTypeLabel(
    type
) {

    if (
        type ===
        null
        ||
        type ===
        undefined
    ) {

        return null;
    }


    if (
        typeof type ===
        'string'
    ) {

        return type;
    }


    const candidates =
        [
            type.name,
            type._name
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


    const id =
        type._id
        ??
        type.id
        ??
        null;


    const code =
        type._code
        ??
        type.code
        ??
        null;


    if (
        id !==
        null
        ||
        code !==
        null
    ) {

        return `id=${
            String(
                id
                ??
                '?'
            )
        }|code=${
            String(
                code
                ??
                '?'
            )
        }`;
    }


    try {

        return JSON.stringify(
            type
        );

    } catch {

        return String(
            type
        );
    }
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
// COUNTERS
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
// SERIALIZE
// ============================================================

function serialize(
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


    if (
        Array.isArray(
            value
        )
    ) {

        return value
            .slice(
                0,
                20
            )
            .map(
                serialize
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