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
    InterceptorStage,
    EntityOperation
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


const TICK_RATE =
    64;


const RESOURCE_CLASS =
    'CCitadel_BreakableProp';


const DEBRIS_MESSAGE =
    'k_EEntityMsg_BreakablePropSpawnDebris';


// Expected timer is still formally a hypothesis.
//
// Script 28 showed minimum repeated-break interval:
//
//     180.09375 seconds
//
// This script tests whether the entity lifecycle supports a
// 180-second respawn.
const EXPECTED_RESPAWN_SECONDS =
    180;


const EXACT_TIMER_TOLERANCE_SECONDS =
    1;


// Debris and LEAVE may occur on adjacent packets.
// This is only for verifying destruction pairing.
const LEAVE_MATCH_WINDOW_TICKS =
    4;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const resourceLifecyclePath =
    resolve(
        'output',
        replayName,
        'resource_lifecycle_summary.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_respawn_validation.json'
    );


// ============================================================
// MATCH CLOCK OFFSET
//
// Prefer the already validated output from our earlier resource
// lifecycle work.
//
// That file reports:
//
//     matchClockOffsetSeconds = 30
//
// Meaning:
//
//     matchTime = replayTime - 30
// ============================================================

let matchClockOffsetSeconds =
    30;


let clockOffsetSource =
    'FALLBACK_30_SECONDS';


if (
    existsSync(
        resourceLifecyclePath
    )
) {

    try {

        const resourceLifecycle =
            JSON.parse(
                readFileSync(
                    resourceLifecyclePath,
                    'utf8'
                )
            );


        const candidate =
            Number(
                resourceLifecycle
                    .matchClockOffsetSeconds
            );


        if (
            Number.isFinite(
                candidate
            )
        ) {

            matchClockOffsetSeconds =
                candidate;


            clockOffsetSource =
                'resource_lifecycle_summary.json';
        }

    } catch {

        // Keep the validated 30-second fallback.
    }
}


// ============================================================
// STORAGE
// ============================================================

const slots =
    new Map();


const rawBreakMessages =
    [];


let totalDebrisMessages =
    0;


let directResourceDebrisMessages =
    0;


let nonResourceDebrisMessages =
    0;


let unresolvedDebrisMessages =
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
// DEMO TICKS
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
            firstDemoTick ===
            null
        ) {

            firstDemoTick =
                tick;
        }


        lastDemoTick =
            tick;
    }
);


// ============================================================
// ENTITY LIFECYCLE
//
// Record EVERY CREATE and LEAVE for every persistent
// CCitadel_BreakableProp slot.
//
// CREATE is not assumed to mean respawn.
//
// Later we specifically ask:
//
//     after an actual break event,
//     when is the next CREATE for that same slot?
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.ENTITY_PACKET,

    (
        demoPacket,
        messagePacket,
        events
    ) => {

        const tick =
            Number(
                demoPacket.tick
            );


        for (
            const event
            of events
        ) {

            const entity =
                event.entity;


            const className =
                entity
                    ?.class
                    ?.name;


            if (
                className !==
                RESOURCE_CLASS
            ) {

                continue;
            }


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


            const slot =
                getOrCreateSlot(
                    entityIndex
                );


            updateSlotIdentity(
                slot,
                entity
            );


            if (
                event.operation ===
                EntityOperation.CREATE
            ) {

                slot.createTicks.push(
                    tick
                );


                continue;
            }


            if (
                event.operation ===
                EntityOperation.LEAVE
            ) {

                slot.leaveTicks.push(
                    tick
                );


                continue;
            }


            if (
                event.operation ===
                EntityOperation.UPDATE
            ) {

                slot.updateTicks.push(
                    tick
                );


                continue;
            }


            if (
                event.operation ===
                EntityOperation.DELETE
            ) {

                slot.deleteTicks.push(
                    tick
                );
            }
        }
    }
);


// ============================================================
// DIRECT BREAK MESSAGES
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        const messageType =
            getMessageTypeCode(
                messagePacket
            );


        if (
            messageType !==
            DEBRIS_MESSAGE
        ) {

            return;
        }


        totalDebrisMessages++;


        const data =
            messagePacket.data
            ??
            {};


        const targetHandle =
            data
                ?.entityMsg
                ?.targetEntity;


        const resolvedEntity =
            safeResolveEntityHandle(
                targetHandle
            );


        if (
            !resolvedEntity
        ) {

            unresolvedDebrisMessages++;

            return;
        }


        const className =
            resolvedEntity
                ?.class
                ?.name
            ??
            null;


        if (
            className !==
            RESOURCE_CLASS
        ) {

            nonResourceDebrisMessages++;

            return;
        }


        directResourceDebrisMessages++;


        const entityIndex =
            getEntityIndex(
                resolvedEntity
            );


        if (
            entityIndex ===
            null
        ) {

            return;
        }


        const slot =
            getOrCreateSlot(
                entityIndex
            );


        updateSlotIdentity(
            slot,
            resolvedEntity
        );


        const tick =
            Number(
                demoPacket.tick
            );


        const damagePos =
            normalizeVector(
                data.damagePos
            );


        rawBreakMessages.push({

            entityIndex,

            tick,

            replayTimeSeconds:
                tick /
                TICK_RATE,

            matchTimeSeconds:
                tickToMatchTime(
                    tick
                ),

            subclassId:
                slot.subclassId,

            modelHandle:
                slot.modelHandle,

            position:
                slot.position,

            damagePos
        });
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
    'BREAKABLE RESPAWN VALIDATION'
);

console.log(
    '===================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Match clock offset: ${matchClockOffsetSeconds}s`
);

console.log(
    `Offset source: ${clockOffsetSource}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// SORT SLOT EVENTS
// ============================================================

for (
    const slot
    of slots.values()
) {

    slot.createTicks.sort(
        numericSort
    );


    slot.leaveTicks.sort(
        numericSort
    );


    slot.updateTicks.sort(
        numericSort
    );


    slot.deleteTicks.sort(
        numericSort
    );
}


rawBreakMessages.sort(
    (
        a,
        b
    ) =>
        a.tick -
        b.tick
);


// ============================================================
// BREAK → LEAVE VALIDATION
// ============================================================

const destructionPairs =
    [];


for (
    const breakEvent
    of rawBreakMessages
) {

    const slot =
        slots.get(
            breakEvent.entityIndex
        );


    if (
        !slot
    ) {

        continue;
    }


    const leaveMatch =
        findNearestTick(
            breakEvent.tick,
            slot.leaveTicks,
            LEAVE_MATCH_WINDOW_TICKS
        );


    destructionPairs.push({

        entityIndex:
            breakEvent.entityIndex,

        subclassId:
            breakEvent.subclassId,

        breakTick:
            breakEvent.tick,

        breakMatchTimeSeconds:
            breakEvent.matchTimeSeconds,

        breakClock:
            formatClock(
                breakEvent.matchTimeSeconds
            ),

        leaveTick:
            leaveMatch
                ?.tick
            ??
            null,

        leaveDeltaTicks:
            leaveMatch
                ?.deltaTicks
            ??
            null,

        leaveDeltaSeconds:
            leaveMatch
                ? leaveMatch.deltaTicks /
                  TICK_RATE
            : null,

        paired:
            leaveMatch !==
            null
    });
}


// ============================================================
// BREAK → FIRST SUBSEQUENT CREATE
//
// This is the central test.
//
// If the resource respawns after ~180 sec and becomes networked
// immediately, firstPostBreakCreateDelay should cluster at 180.
//
// If PVS delays CREATE, then:
//     delay >= actual respawn timer
//
// In that case the LOWER EDGE of the distribution is still
// highly informative.
//
// We therefore preserve:
// - exact ~180 matches
// - minimum observed delay
// - complete distribution
// ============================================================

const breakRespawnCandidates =
    [];


const breaksBySlot =
    groupBy(
        rawBreakMessages,
        event =>
            event.entityIndex
    );


for (
    const [
        entityIndex,
        breakEvents
    ]
    of breaksBySlot
) {

    const slot =
        slots.get(
            Number(
                entityIndex
            )
        );


    if (
        !slot
    ) {

        continue;
    }


    breakEvents.sort(
        (
            a,
            b
        ) =>
            a.tick -
            b.tick
    );


    for (
        let i = 0;
        i < breakEvents.length;
        i++
    ) {

        const breakEvent =
            breakEvents[i];


        const nextBreak =
            breakEvents[
                i + 1
            ]
            ??
            null;


        const firstPostBreakCreate =
            firstTickGreaterThan(
                slot.createTicks,
                breakEvent.tick
            );


        const firstPostBreakLeave =
            firstTickGreaterThan(
                slot.leaveTicks,
                breakEvent.tick
            );


        const createDelaySeconds =
            firstPostBreakCreate !==
            null

                ? (
                    firstPostBreakCreate -
                    breakEvent.tick
                  )
                  /
                  TICK_RATE

                : null;


        const nextBreakDelaySeconds =
            nextBreak

                ? (
                    nextBreak.tick -
                    breakEvent.tick
                  )
                  /
                  TICK_RATE

                : null;


        const exactTimerMatch =
            Number.isFinite(
                createDelaySeconds
            )
            &&
            Math.abs(
                createDelaySeconds -
                EXPECTED_RESPAWN_SECONDS
            )
            <=
            EXACT_TIMER_TOLERANCE_SECONDS;


        const createBeforeNextBreak =
            (
                firstPostBreakCreate !==
                null
                &&
                (
                    nextBreak ===
                    null
                    ||
                    firstPostBreakCreate <
                    nextBreak.tick
                )
            );


        breakRespawnCandidates.push({

            entityIndex:
                breakEvent.entityIndex,

            subclassId:
                slot.subclassId,

            modelHandle:
                slot.modelHandle,

            position:
                slot.position,

            breakNumberForSlot:
                i + 1,

            breakTick:
                breakEvent.tick,

            breakMatchTimeSeconds:
                breakEvent.matchTimeSeconds,

            breakClock:
                formatClock(
                    breakEvent.matchTimeSeconds
                ),

            firstPostBreakCreateTick:
                firstPostBreakCreate,

            firstPostBreakCreateMatchTimeSeconds:
                tickToMatchTime(
                    firstPostBreakCreate
                ),

            firstPostBreakCreateClock:
                formatClock(
                    tickToMatchTime(
                        firstPostBreakCreate
                    )
                ),

            breakToFirstCreateSeconds:
                createDelaySeconds,

            expectedRespawnSeconds:
                EXPECTED_RESPAWN_SECONDS,

            timerErrorSeconds:
                Number.isFinite(
                    createDelaySeconds
                )

                    ? createDelaySeconds -
                      EXPECTED_RESPAWN_SECONDS

                    : null,

            withinOneSecondOfExpected:
                exactTimerMatch,

            createBeforeNextBreak,

            nextBreakTick:
                nextBreak
                    ?.tick
                ??
                null,

            nextBreakMatchTimeSeconds:
                nextBreak
                    ?.matchTimeSeconds
                ??
                null,

            breakToNextBreakSeconds:
                nextBreakDelaySeconds,

            firstLaterLeaveTick:
                firstPostBreakLeave
        });
    }
}


// ============================================================
// FILTER USABLE RESPAWN OBSERVATIONS
//
// If there is no subsequent CREATE, the replay simply ended or
// that object never became networked again.
//
// If CREATE happens after a later break, it cannot be the
// availability event preceding that later break, so exclude it
// from timer inference.
// ============================================================

const usableRespawnCandidates =
    breakRespawnCandidates

        .filter(
            row =>
                Number.isFinite(
                    row.breakToFirstCreateSeconds
                )
                &&
                row.createBeforeNextBreak
        );


const exactExpectedTimerCandidates =
    usableRespawnCandidates

        .filter(
            row =>
                row.withinOneSecondOfExpected
        );


// ============================================================
// TIMER DISTRIBUTIONS
// ============================================================

const globalCreateDelays =
    usableRespawnCandidates
        .map(
            row =>
                row.breakToFirstCreateSeconds
        );


const timerErrorValues =
    usableRespawnCandidates
        .map(
            row =>
                row.timerErrorSeconds
        );


// ============================================================
// SUBCLASS SUMMARIES
// ============================================================

const subclassIds =
    [
        ...new Set(
            [...slots.values()]
                .map(
                    slot =>
                        slot.subclassId
                )
                .filter(
                    value =>
                        value !==
                        null
                )
        )
    ];


const subclassSummaries =
    [];


for (
    const subclassId
    of subclassIds
) {

    const subclassSlots =
        [...slots.values()]
            .filter(
                slot =>
                    slot.subclassId ===
                    subclassId
            );


    const subclassBreaks =
        rawBreakMessages
            .filter(
                event =>
                    event.subclassId ===
                    subclassId
            );


    const subclassCandidates =
        usableRespawnCandidates
            .filter(
                row =>
                    row.subclassId ===
                    subclassId
            );


    const exactMatches =
        subclassCandidates
            .filter(
                row =>
                    row.withinOneSecondOfExpected
            );


    const delays =
        subclassCandidates
            .map(
                row =>
                    row.breakToFirstCreateSeconds
            );


    const breakToBreak =
        breakRespawnCandidates

            .filter(
                row =>
                    row.subclassId ===
                    subclassId
                    &&
                    Number.isFinite(
                        row.breakToNextBreakSeconds
                    )
            )

            .map(
                row =>
                    row.breakToNextBreakSeconds
            );


    subclassSummaries.push({

        subclassId,

        slotCount:
            subclassSlots.length,

        modelHandles:
            countBy(
                subclassSlots,
                slot =>
                    slot.modelHandle
            ),

        breakCount:
            subclassBreaks.length,

        uniqueSlotsBroken:
            new Set(
                subclassBreaks.map(
                    event =>
                        event.entityIndex
                )
            ).size,

        usableBreakToCreatePairs:
            subclassCandidates.length,

        exactExpectedTimerPairs:
            exactMatches.length,

        exactExpectedTimerRate:
            subclassCandidates.length >
            0

                ? exactMatches.length /
                  subclassCandidates.length

                : null,

        breakToFirstCreateSeconds:
            summarizeNumbers(
                delays
            ),

        breakToNextBreakSeconds:
            summarizeNumbers(
                breakToBreak
            ),

        closestToExpected:
            [...subclassCandidates]

                .sort(
                    (
                        a,
                        b
                    ) =>
                        Math.abs(
                            a.timerErrorSeconds
                        )
                        -
                        Math.abs(
                            b.timerErrorSeconds
                        )
                )

                .slice(
                    0,
                    20
                )
    });
}


subclassSummaries.sort(
    (
        a,
        b
    ) =>
        b.slotCount -
        a.slotCount
);


// ============================================================
// FIRST-SPAWN COHORTS
//
// Now that the 30-second match offset is known, classify all
// persistent locations.
//
// Expected:
//
// ordinary map resources:
//     replay ~210 sec
//     match  ~180 sec = 3:00
//
// Mid Boss room resources:
//     replay ~630 sec
//     match  ~600 sec = 10:00
// ============================================================

const firstSpawnRows =
    [];


for (
    const slot
    of slots.values()
) {

    if (
        slot.createTicks.length ===
        0
    ) {

        continue;
    }


    const firstCreateTick =
        slot.createTicks[0];


    const firstMatchTime =
        tickToMatchTime(
            firstCreateTick
        );


    firstSpawnRows.push({

        entityIndex:
            slot.entityIndex,

        subclassId:
            slot.subclassId,

        modelHandle:
            slot.modelHandle,

        position:
            slot.position,

        firstCreateTick,

        firstReplayTimeSeconds:
            firstCreateTick /
            TICK_RATE,

        firstMatchTimeSeconds:
            firstMatchTime,

        firstMatchClock:
            formatClock(
                firstMatchTime
            ),

        spawnCohort:
            classifySpawnCohort(
                firstMatchTime
            )
    });
}


const spawnCohortSummary =
    countBy(
        firstSpawnRows,
        row =>
            row.spawnCohort
    );


const spawnCohortBySubclass =
    {};


for (
    const subclassId
    of subclassIds
) {

    spawnCohortBySubclass[
        subclassId
    ] =
        countBy(

            firstSpawnRows.filter(
                row =>
                    row.subclassId ===
                    subclassId
            ),

            row =>
                row.spawnCohort
        );
}


// ============================================================
// BREAK / LEAVE PAIR SUMMARY
// ============================================================

const pairedDestructions =
    destructionPairs.filter(
        row =>
            row.paired
    );


const destructionDeltaTicks =
    pairedDestructions
        .map(
            row =>
                Math.abs(
                    row.leaveDeltaTicks
                )
        );


// ============================================================
// CANONICAL TIMER ASSESSMENT
// ============================================================

const minimumCreateDelay =
    globalCreateDelays.length >
    0

        ? Math.min(
            ...globalCreateDelays
        )

        : null;


const timerLooksLike180 =
    (
        Number.isFinite(
            minimumCreateDelay
        )
        &&
        Math.abs(
            minimumCreateDelay -
            EXPECTED_RESPAWN_SECONDS
        )
        <=
        EXACT_TIMER_TOLERANCE_SECONDS
    );


const timerAssessment =
    {

        hypothesisSeconds:
            EXPECTED_RESPAWN_SECONDS,

        minimumObservedBreakToCreateSeconds:
            minimumCreateDelay,

        exactWithinOneSecondCount:
            exactExpectedTimerCandidates.length,

        usablePairCount:
            usableRespawnCandidates.length,

        exactWithinOneSecondRate:
            usableRespawnCandidates.length >
            0

                ? exactExpectedTimerCandidates.length /
                  usableRespawnCandidates.length

                : null,

        supportedByMinimumObservedDelay:
            timerLooksLike180,

        interpretation:
            timerLooksLike180

                ? 'SUPPORTED: the lower edge of observed break→CREATE delays reaches the 180-second hypothesis. Later CREATEs may be delayed by PVS/network relevance.'

                : 'NOT YET CONFIRMED: break→CREATE data did not reach the 180-second hypothesis within tolerance.'
    };


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        method:
            [
                'Use direct k_EEntityMsg_BreakablePropSpawnDebris resolution as destruction',
                'Verify debris against same-slot CCitadel_BreakableProp LEAVE operations',
                'For each confirmed break, find first subsequent CREATE on the same persistent entity slot',
                'Treat CREATE delay as an upper bound on true respawn when PVS may delay network recreation',
                'Use the lower edge and exact-timer observations to test a 180-second respawn hypothesis'
            ],

        timing:
            {

                tickRate:
                    TICK_RATE,

                matchClockOffsetSeconds,

                clockOffsetSource,

                firstDemoTick,

                lastDemoTick,

                matchDurationSeconds:
                    Number.isFinite(
                        lastDemoTick
                    )

                        ? (
                            lastDemoTick /
                            TICK_RATE
                          )
                          -
                          matchClockOffsetSeconds

                        : null
            },

        hypothesis:
            {

                respawnSeconds:
                    EXPECTED_RESPAWN_SECONDS,

                toleranceSeconds:
                    EXACT_TIMER_TOLERANCE_SECONDS
            },

        breakSignalValidation:
            {

                totalDebrisMessages,

                directResourceDebrisMessages,

                nonResourceDebrisMessages,

                unresolvedDebrisMessages,

                resourceBreakCount:
                    rawBreakMessages.length,

                pairedWithSameSlotLeave:
                    pairedDestructions.length,

                pairRate:
                    rawBreakMessages.length >
                    0

                        ? pairedDestructions.length /
                          rawBreakMessages.length

                        : null,

                absoluteLeaveDeltaTickSummary:
                    summarizeNumbers(
                        destructionDeltaTicks
                    )
            },

        persistentResources:
            {

                slotCount:
                    slots.size,

                bySubclass:
                    countBy(
                        [...slots.values()],
                        slot =>
                            slot.subclassId
                    ),

                spawnCohorts:
                    spawnCohortSummary,

                spawnCohortsBySubclass:
                    spawnCohortBySubclass
            },

        respawnValidation:
            {

                totalBreakEvents:
                    breakRespawnCandidates.length,

                usableBreakToCreatePairs:
                    usableRespawnCandidates.length,

                exactExpectedTimerPairs:
                    exactExpectedTimerCandidates.length,

                breakToFirstCreateSeconds:
                    summarizeNumbers(
                        globalCreateDelays
                    ),

                timerErrorSeconds:
                    summarizeNumbers(
                        timerErrorValues
                    ),

                timerAssessment
            },

        subclassSummaries,

        firstSpawnRows,

        destructionPairs,

        breakRespawnCandidates,

        exactExpectedTimerSamples:
            exactExpectedTimerCandidates
                .slice(
                    0,
                    100
                )
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
// CONSOLE OUTPUT
// ============================================================

console.log(
    'BREAK SIGNAL'
);

console.log(
    '------------'
);

console.log(
    `Total debris messages: ${totalDebrisMessages}`
);

console.log(
    `Resource debris messages: ${directResourceDebrisMessages}`
);

console.log(
    `Resource breaks paired with LEAVE: ${pairedDestructions.length}/${rawBreakMessages.length}`
);

console.log('');


console.log(
    'PERSISTENT LOCATIONS'
);

console.log(
    '--------------------'
);

console.log(
    `Total: ${slots.size}`
);


for (
    const [
        subclass,
        count
    ]
    of Object.entries(
        output
            .persistentResources
            .bySubclass
    )
) {

    console.log(
        `Subclass ${subclass}: ${count}`
    );
}


console.log('');

console.log(
    'SPAWN COHORTS'
);

console.log(
    '-------------'
);


for (
    const [
        cohort,
        count
    ]
    of Object.entries(
        spawnCohortSummary
    )
) {

    console.log(
        `${cohort}: ${count}`
    );
}


console.log('');

console.log(
    'RESPAWN TEST'
);

console.log(
    '------------'
);

console.log(
    `Expected: ${EXPECTED_RESPAWN_SECONDS}s`
);

console.log(
    `Usable break -> CREATE pairs: ${usableRespawnCandidates.length}`
);

console.log(
    `Within ±${EXACT_TIMER_TOLERANCE_SECONDS}s: ${exactExpectedTimerCandidates.length}`
);


const globalSummary =
    output
        .respawnValidation
        .breakToFirstCreateSeconds;


if (
    globalSummary.count >
    0
) {

    console.log(
        `Minimum: ${globalSummary.min.toFixed(6)}s`
    );

    console.log(
        `P10: ${globalSummary.p10.toFixed(6)}s`
    );

    console.log(
        `Median: ${globalSummary.median.toFixed(6)}s`
    );
}


console.log('');

console.log(
    timerAssessment.interpretation
);

console.log('');


console.log(
    'SUBCLASSES'
);

console.log(
    '----------'
);


for (
    const summary
    of subclassSummaries
) {

    console.log('');

    console.log(
        `Subclass ${summary.subclassId}`
    );

    console.log(
        `  locations: ${summary.slotCount}`
    );

    console.log(
        `  breaks: ${summary.breakCount}`
    );

    console.log(
        `  usable respawn observations: ${summary.usableBreakToCreatePairs}`
    );

    console.log(
        `  exact ~180s observations: ${summary.exactExpectedTimerPairs}`
    );


    if (
        summary
            .breakToFirstCreateSeconds
            .count >
        0
    ) {

        console.log(
            `  minimum break->CREATE: ${summary.breakToFirstCreateSeconds.min.toFixed(6)}s`
        );

        console.log(
            `  median break->CREATE: ${summary.breakToFirstCreateSeconds.median.toFixed(6)}s`
        );
    }
}


console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// SLOT
// ============================================================

function getOrCreateSlot(
    entityIndex
) {

    if (
        !slots.has(
            entityIndex
        )
    ) {

        slots.set(
            entityIndex,
            {

                entityIndex,

                subclassId:
                    null,

                modelHandle:
                    null,

                interactsAs:
                    null,

                position:
                    null,

                createTicks:
                    [],

                leaveTicks:
                    [],

                updateTicks:
                    [],

                deleteTicks:
                    []
            }
        );
    }


    return slots.get(
        entityIndex
    );
}


// ============================================================
// SLOT IDENTITY
// ============================================================

function updateSlotIdentity(
    slot,
    entity
) {

    const subclassId =
        serializeValue(
            safeGetField(
                entity,
                'm_nSubclassID'
            )
        );


    const modelHandle =
        serializeValue(
            safeGetField(
                entity,
                'CBodyComponent.m_hModel'
            )
        );


    const interactsAs =
        serializeValue(
            safeGetField(
                entity,
                'm_nInteractsAs'
            )
        );


    const position =
        getWorldPosition(
            entity
        );


    if (
        subclassId !==
        null
    ) {

        slot.subclassId =
            subclassId;
    }


    if (
        modelHandle !==
        null
    ) {

        slot.modelHandle =
            modelHandle;
    }


    if (
        interactsAs !==
        null
    ) {

        slot.interactsAs =
            interactsAs;
    }


    if (
        position
    ) {

        slot.position =
            position;
    }
}


// ============================================================
// MESSAGE TYPE
// ============================================================

function getMessageTypeCode(
    messagePacket
) {

    return (
        messagePacket
            ?.type
            ?._code
        ??
        messagePacket
            ?.type
            ?.code
        ??
        null
    );
}


// ============================================================
// HANDLE RESOLUTION
// ============================================================

function safeResolveEntityHandle(
    handle
) {

    if (
        handle ===
        null
        ||
        handle ===
        undefined
    ) {

        return null;
    }


    try {

        return (
            parser
                .getDemo()
                .getEntityByHandle(
                    handle
                )
            ??
            null
        );

    } catch {

        return null;
    }
}


// ============================================================
// ENTITY INDEX
// ============================================================

function getEntityIndex(
    entity
) {

    if (
        !entity
    ) {

        return null;
    }


    const values =
        [

            entity.index,
            entity.entityIndex,
            entity.entIndex,
            entity.id
        ];


    for (
        const value
        of values
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


    if (
        typeof entity.getIndex ===
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
// FIELD
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


        return value ===
            undefined

            ? null

            : value;

    } catch {

        return null;
    }
}


// ============================================================
// POSITION
// ============================================================

function getWorldPosition(
    entity
) {

    const cellX =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_cellX'
            )
        );


    const cellY =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_cellY'
            )
        );


    const cellZ =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_cellZ'
            )
        );


    const vecX =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_vecX'
            )
        );


    const vecY =
        toFiniteNumber(
            safeGetField(
                entity,
                'CBodyComponent.m_vecY'
            )
        );


    const vecZ =
        toFiniteNumber(
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
// VECTOR
// ============================================================

function normalizeVector(
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
        toFiniteNumber(
            value.x
            ??
            value[0]
        );


    const y =
        toFiniteNumber(
            value.y
            ??
            value[1]
        );


    const z =
        toFiniteNumber(
            value.z
            ??
            value[2]
        );


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

        z:
            z
            ??
            0
    };
}


// ============================================================
// FIND FIRST LATER TICK
// ============================================================

function firstTickGreaterThan(
    ticks,
    target
) {

    // Arrays are sorted.
    //
    // Binary search avoids scanning tens of thousands of
    // CREATE records repeatedly.

    let low =
        0;


    let high =
        ticks.length -
        1;


    let result =
        null;


    while (
        low <=
        high
    ) {

        const middle =
            Math.floor(
                (
                    low +
                    high
                )
                /
                2
            );


        const tick =
            ticks[
                middle
            ];


        if (
            tick >
            target
        ) {

            result =
                tick;


            high =
                middle -
                1;

        } else {

            low =
                middle +
                1;
        }
    }


    return result;
}


// ============================================================
// NEAREST TICK
// ============================================================

function findNearestTick(
    target,
    ticks,
    maxDeltaTicks
) {

    let best =
        null;


    for (
        const tick
        of ticks
    ) {

        const delta =
            tick -
            target;


        const absolute =
            Math.abs(
                delta
            );


        if (
            absolute >
            maxDeltaTicks
        ) {

            continue;
        }


        if (
            !best
            ||
            absolute <
            Math.abs(
                best.deltaTicks
            )
        ) {

            best =
                {

                    tick,

                    deltaTicks:
                        delta
                };
        }
    }


    return best;
}


// ============================================================
// TIME
// ============================================================

function tickToMatchTime(
    tick
) {

    if (
        !Number.isFinite(
            tick
        )
    ) {

        return null;
    }


    return (
        tick /
        TICK_RATE
    )
    -
    matchClockOffsetSeconds;
}


// ============================================================
// SPAWN COHORT
// ============================================================

function classifySpawnCohort(
    matchTime
) {

    if (
        !Number.isFinite(
            matchTime
        )
    ) {

        return 'UNKNOWN';
    }


    if (
        Math.abs(
            matchTime -
            180
        )
        <=
        2
    ) {

        return 'INITIAL_3_MIN';
    }


    if (
        Math.abs(
            matchTime -
            600
        )
        <=
        2
    ) {

        return 'MIDBOSS_10_MIN';
    }


    return 'OTHER';
}


// ============================================================
// CLOCK
// ============================================================

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
    `${minutes}:`
    +
    String(
        secs
    ).padStart(
        2,
        '0'
    );
}


// ============================================================
// GROUP BY
// ============================================================

function groupBy(
    array,
    selector
) {

    const map =
        new Map();


    for (
        const item
        of array
    ) {

        const key =
            selector(
                item
            );


        if (
            !map.has(
                key
            )
        ) {

            map.set(
                key,
                []
            );
        }


        map.get(
            key
        ).push(
            item
        );
    }


    return map;
}


// ============================================================
// COUNT BY
// ============================================================

function countBy(
    array,
    selector
) {

    const map =
        new Map();


    for (
        const item
        of array
    ) {

        const rawKey =
            selector(
                item
            );


        const key =
            rawKey ===
                null
                ||
                rawKey ===
                undefined

                ? 'NULL'

                : String(
                    rawKey
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
        [...map.entries()]
            .sort(
                (
                    a,
                    b
                ) =>
                    String(
                        a[0]
                    )
                    .localeCompare(
                        String(
                            b[0]
                        )
                    )
            )
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
                numericSort
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
// SERIALIZATION
// ============================================================

function serializeValue(
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
        'number'
        ||
        typeof value ===
        'string'
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


// ============================================================
// SORT
// ============================================================

function numericSort(
    a,
    b
) {

    return a -
        b;
}