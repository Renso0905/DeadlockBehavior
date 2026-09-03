import {
    createReadStream,
    mkdirSync,
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


// Multiple debris messages for the exact same prop within this
// tiny window will be treated as one destruction.
//
// A prop cannot legitimately respawn and break again within
// four ticks.
const DEBRIS_DEDUPE_WINDOW_TICKS =
    4;


// If direct target-handle resolution fails, damagePos can still
// potentially identify the resource prop.
//
// This is deliberately conservative.
const SPATIAL_FALLBACK_MAX_DISTANCE =
    160;


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
        'breakable_debris_resolution.json'
    );


// ============================================================
// TARGET CLASSES
// ============================================================

const RESOURCE_CLASS =
    'CCitadel_BreakableProp';


const DEBRIS_MESSAGE =
    'k_EEntityMsg_BreakablePropSpawnDebris';


// ============================================================
// STORAGE
// ============================================================

const breakableSlots =
    new Map();


const debrisMessages =
    [];


const resolvedTargetClassCounts =
    new Map();


let totalBreakableEntityEvents =
    0;


const breakableOperationCounts =
    {
        CREATE: 0,
        UPDATE: 0,
        LEAVE: 0,
        DELETE: 0,
        OTHER: 0
    };


let clockOffsetSeconds =
    null;


let clockOffsetSource =
    null;


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
// DEMO CLOCK
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    demoPacket => {

        const tick =
            Number(
                demoPacket.tick
            );


        if (
            Number.isFinite(tick)
        ) {

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


        if (
            clockOffsetSeconds !==
            null
        ) {

            return;
        }


        const demo =
            parser.getDemo();


        const possibleClasses =
            [
                'CCitadelGameRulesProxy',
                'CCitadelGameRules'
            ];


        for (
            const className
            of possibleClasses
        ) {

            let entities =
                [];


            try {

                entities =
                    Array.from(
                        demo.getEntitiesByClassName(
                            className
                        )
                        ??
                        []
                    );

            } catch {

                continue;
            }


            for (
                const entity
                of entities
            ) {

                const gameStart =
                    toFiniteNumber(
                        safeGetField(
                            entity,
                            'm_flGameStartTime'
                        )
                    );


                const stateStart =
                    toFiniteNumber(
                        safeGetField(
                            entity,
                            'm_flGameStateStartTime'
                        )
                    );


                if (
                    gameStart ===
                    null
                    ||
                    stateStart ===
                    null
                ) {

                    continue;
                }


                clockOffsetSeconds =
                    gameStart -
                    stateStart;


                clockOffsetSource =
                    {
                        className,

                        gameStart,

                        stateStart
                    };


                return;
            }
        }
    }
);


// ============================================================
// ENTITY MUTATIONS
//
// Breakable props are unusual:
//
// Previous catalog:
//   691 unique slots
//   ~30k CREATE operations
//   0 UPDATE operations
//
// Therefore CREATE itself must NOT be interpreted as gameplay
// spawn/respawn.
//
// Here we catalog persistent slots and their two subclasses.
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.ENTITY_PACKET,

    (
        demoPacket,
        messagePacket,
        events
    ) => {

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


            totalBreakableEntityEvents++;


            const operationName =
                classifyOperation(
                    event.operation
                );


            breakableOperationCounts[
                operationName
            ]++;


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


            const record =
                getOrCreateBreakableSlot(
                    entityIndex
                );


            if (
                operationName ===
                'CREATE'
            ) {

                record.createCount++;


                if (
                    record.firstCreateTick ===
                    null
                ) {

                    record.firstCreateTick =
                        Number(
                            demoPacket.tick
                        );
                }


                record.lastCreateTick =
                    Number(
                        demoPacket.tick
                    );


                updateSlotFromEntity(
                    record,
                    entity
                );

            } else if (
                operationName ===
                'LEAVE'
            ) {

                record.leaveCount++;


            } else if (
                operationName ===
                'DELETE'
            ) {

                record.deleteCount++;


            } else if (
                operationName ===
                'UPDATE'
            ) {

                record.updateCount++;


                updateSlotFromEntity(
                    record,
                    entity
                );
            }
        }
    }
);


// ============================================================
// DIRECT BREAKABLE DEBRIS MESSAGE
//
// This is the important signal.
//
// Payload:
// {
//   entityMsg: {
//     targetEntity: ...
//   },
//   damagePos: { x, y, z },
//   damageForce: { x, y, z }
// }
//
// We attempt direct handle resolution immediately.
//
// If that fails, we retain damagePos and perform a spatial
// fallback after the full map catalog is known.
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        const typeCode =
            getMessageTypeCode(
                messagePacket
            );


        if (
            typeCode !==
            DEBRIS_MESSAGE
        ) {

            return;
        }


        const data =
            messagePacket.data
            ??
            {};


        const targetHandle =
            data
                ?.entityMsg
                ?.targetEntity;


        const damagePos =
            normalizeVector(
                data.damagePos
            );


        const damageForce =
            normalizeVector(
                data.damageForce
            );


        const demoTick =
            Number(
                demoPacket.tick
            );


        const record =
            {

                demoTick,

                replayTimeSeconds:
                    Number.isFinite(
                        demoTick
                    )
                        ? demoTick /
                          TICK_RATE
                        : null,

                targetHandle:
                    serializeValue(
                        targetHandle
                    ),

                damagePos,

                damageForce,

                resolved:
                    false,

                resolvedClass:
                    null,

                resolvedEntityIndex:
                    null,

                resolvedSubclassId:
                    null,

                resolvedModelHandle:
                    null,

                resolvedInteractsAs:
                    null,

                resolvedPosition:
                    null,

                directPositionError:
                    null
            };


        const resolvedEntity =
            safeResolveEntityHandle(
                targetHandle
            );


        if (
            resolvedEntity
        ) {

            record.resolved =
                true;


            record.resolvedClass =
                resolvedEntity
                    ?.class
                    ?.name
                ??
                null;


            record.resolvedEntityIndex =
                getEntityIndex(
                    resolvedEntity
                );


            record.resolvedSubclassId =
                serializeValue(
                    safeGetField(
                        resolvedEntity,
                        'm_nSubclassID'
                    )
                );


            record.resolvedModelHandle =
                serializeValue(
                    safeGetField(
                        resolvedEntity,
                        'CBodyComponent.m_hModel'
                    )
                );


            record.resolvedInteractsAs =
                serializeValue(
                    safeGetField(
                        resolvedEntity,
                        'm_nInteractsAs'
                    )
                );


            record.resolvedPosition =
                getWorldPosition(
                    resolvedEntity
                );


            incrementCounter(
                resolvedTargetClassCounts,
                record.resolvedClass
                ??
                'UNKNOWN'
            );


            if (
                record.resolvedClass ===
                RESOURCE_CLASS
                &&
                record.resolvedEntityIndex !==
                null
            ) {

                const slot =
                    getOrCreateBreakableSlot(
                        record.resolvedEntityIndex
                    );


                updateSlotFromEntity(
                    slot,
                    resolvedEntity
                );


                if (
                    damagePos
                    &&
                    record.resolvedPosition
                ) {

                    record.directPositionError =
                        distance3D(
                            damagePos,
                            record.resolvedPosition
                        );
                }
            }
        }


        debrisMessages.push(
            record
        );
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
    'BREAKABLE DEBRIS RESOLUTION'
);

console.log(
    '===================================='
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


// ============================================================
// FINALIZE SLOT CATALOG
// ============================================================

const slotArray =
    [...breakableSlots.values()]

        .map(
            slot => {

                const firstCreateMatchTime =
                    tickToMatchTime(
                        slot.firstCreateTick
                    );


                return {

                    entityIndex:
                        slot.entityIndex,

                    subclassId:
                        slot.subclassId,

                    modelHandle:
                        slot.modelHandle,

                    interactsAs:
                        slot.interactsAs,

                    position:
                        slot.position,

                    createCount:
                        slot.createCount,

                    updateCount:
                        slot.updateCount,

                    leaveCount:
                        slot.leaveCount,

                    deleteCount:
                        slot.deleteCount,

                    firstCreateTick:
                        slot.firstCreateTick,

                    firstCreateReplayTimeSeconds:
                        tickToReplayTime(
                            slot.firstCreateTick
                        ),

                    firstCreateMatchTimeSeconds:
                        firstCreateMatchTime,

                    firstSpawnCohort:
                        classifyFirstSpawnCohort(
                            firstCreateMatchTime
                        ),

                    lastCreateTick:
                        slot.lastCreateTick
                };
            }
        )

        .sort(
            (
                a,
                b
            ) =>
                a.entityIndex -
                b.entityIndex
        );


// ============================================================
// SLOT LOOKUP FOR SPATIAL FALLBACK
// ============================================================

const slotsWithPositions =
    slotArray
        .filter(
            slot =>
                slot.position
                &&
                Number.isFinite(
                    slot.position.x
                )
                &&
                Number.isFinite(
                    slot.position.y
                )
        );


// ============================================================
// FINALIZE DEBRIS MESSAGES
//
// Direct handle resolution is authoritative.
//
// Only unresolved messages are eligible for spatial fallback.
// ============================================================

for (
    const message
    of debrisMessages
) {

    message.matchTimeSeconds =
        tickToMatchTime(
            message.demoTick
        );


    message.matchClock =
        formatClock(
            message.matchTimeSeconds
        );


    message.resourceMatchMethod =
        null;


    message.resourceEntityIndex =
        null;


    message.resourceSubclassId =
        null;


    message.resourceModelHandle =
        null;


    message.resourcePosition =
        null;


    message.resourceMatchDistance =
        null;


    // --------------------------------------------------------
    // DIRECT HANDLE RESOLUTION
    // --------------------------------------------------------

    if (
        message.resolvedClass ===
        RESOURCE_CLASS
        &&
        message.resolvedEntityIndex !==
        null
    ) {

        const slot =
            breakableSlots.get(
                message.resolvedEntityIndex
            );


        message.resourceMatchMethod =
            'DIRECT_HANDLE';


        message.resourceEntityIndex =
            message.resolvedEntityIndex;


        message.resourceSubclassId =
            message.resolvedSubclassId
            ??
            slot?.subclassId
            ??
            null;


        message.resourceModelHandle =
            message.resolvedModelHandle
            ??
            slot?.modelHandle
            ??
            null;


        message.resourcePosition =
            message.resolvedPosition
            ??
            slot?.position
            ??
            null;


        message.resourceMatchDistance =
            message.directPositionError;


        continue;
    }


    // --------------------------------------------------------
    // DO NOT override a confidently resolved non-resource
    // entity with spatial guessing.
    // --------------------------------------------------------

    if (
        message.resolved ===
        true
    ) {

        continue;
    }


    // --------------------------------------------------------
    // SPATIAL FALLBACK
    // --------------------------------------------------------

    if (
        !message.damagePos
    ) {

        continue;
    }


    const nearest =
        findNearestSlot(
            message.damagePos,
            slotsWithPositions
        );


    if (
        !nearest
        ||
        nearest.distance >
        SPATIAL_FALLBACK_MAX_DISTANCE
    ) {

        continue;
    }


    message.resourceMatchMethod =
        'SPATIAL_FALLBACK';


    message.resourceEntityIndex =
        nearest.slot.entityIndex;


    message.resourceSubclassId =
        nearest.slot.subclassId;


    message.resourceModelHandle =
        nearest.slot.modelHandle;


    message.resourcePosition =
        nearest.slot.position;


    message.resourceMatchDistance =
        nearest.distance;
}


// ============================================================
// RESOURCE-ONLY DEBRIS MESSAGES
// ============================================================

const matchedResourceMessages =
    debrisMessages

        .filter(
            message =>
                message.resourceEntityIndex !==
                null
        )

        .sort(
            (
                a,
                b
            ) =>
                a.demoTick -
                b.demoTick
        );


// ============================================================
// DEDUPE RESOURCE BREAK EVENTS
//
// Collapse repeated debris packets for the same persistent prop
// within a few ticks.
// ============================================================

const breaksBySlot =
    new Map();


for (
    const message
    of matchedResourceMessages
) {

    const entityIndex =
        message.resourceEntityIndex;


    if (
        !breaksBySlot.has(
            entityIndex
        )
    ) {

        breaksBySlot.set(
            entityIndex,
            []
        );
    }


    const events =
        breaksBySlot.get(
            entityIndex
        );


    const previous =
        events.length >
        0
            ? events[
                events.length -
                1
            ]
            : null;


    if (
        previous
        &&
        message.demoTick -
        previous.demoTick <=
        DEBRIS_DEDUPE_WINDOW_TICKS
    ) {

        previous.rawDebrisMessageCount++;


        previous.duplicateTicks.push(
            message.demoTick
        );


        continue;
    }


    events.push(
        {

            entityIndex,

            subclassId:
                message.resourceSubclassId,

            modelHandle:
                message.resourceModelHandle,

            demoTick:
                message.demoTick,

            replayTimeSeconds:
                message.replayTimeSeconds,

            matchTimeSeconds:
                message.matchTimeSeconds,

            matchClock:
                message.matchClock,

            position:
                message.resourcePosition,

            damagePos:
                message.damagePos,

            matchMethod:
                message.resourceMatchMethod,

            matchDistance:
                message.resourceMatchDistance,

            rawDebrisMessageCount:
                1,

            duplicateTicks:
                []
        }
    );
}


// ============================================================
// FLATTEN UNIQUE BREAK EVENTS
// ============================================================

const uniqueBreakEvents =
    [];


for (
    const [
        entityIndex,
        events
    ]
    of breaksBySlot
) {

    events.sort(
        (
            a,
            b
        ) =>
            a.demoTick -
            b.demoTick
    );


    for (
        let i = 0;
        i < events.length;
        i++
    ) {

        const current =
            events[i];


        const previous =
            i >
            0
                ? events[
                    i - 1
                ]
                : null;


        current.secondsSincePreviousBreak =
            previous
                ? (
                    current.demoTick -
                    previous.demoTick
                  )
                  /
                  TICK_RATE
                : null;


        current.breakNumberForSlot =
            i + 1;


        uniqueBreakEvents.push(
            current
        );
    }
}


uniqueBreakEvents.sort(
    (
        a,
        b
    ) =>
        a.demoTick -
        b.demoTick
);


// ============================================================
// SUBCLASS SUMMARIES
// ============================================================

const subclassIds =
    [
        ...new Set(
            slotArray
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
        slotArray.filter(
            slot =>
                slot.subclassId ===
                subclassId
        );


    const subclassBreaks =
        uniqueBreakEvents.filter(
            event =>
                event.subclassId ===
                subclassId
        );


    const brokenSlotIds =
        new Set(
            subclassBreaks.map(
                event =>
                    event.entityIndex
            )
        );


    const intervals =
        subclassBreaks

            .map(
                event =>
                    event.secondsSincePreviousBreak
            )

            .filter(
                value =>
                    Number.isFinite(
                        value
                    )
            );


    const modelCounts =
        new Map();


    const cohortCounts =
        new Map();


    for (
        const slot
        of subclassSlots
    ) {

        incrementCounter(
            modelCounts,
            slot.modelHandle
            ??
            'NULL'
        );


        incrementCounter(
            cohortCounts,
            slot.firstSpawnCohort
        );
    }


    subclassSummaries.push(
        {

            subclassId,

            slotCount:
                subclassSlots.length,

            uniqueSlotsBroken:
                brokenSlotIds.size,

            uniqueBreakCount:
                subclassBreaks.length,

            rawDebrisMessageCount:
                matchedResourceMessages
                    .filter(
                        event =>
                            event.resourceSubclassId ===
                            subclassId
                    )
                    .length,

            firstSpawnCohorts:
                mapToObject(
                    cohortCounts
                ),

            modelHandles:
                mapToObject(
                    modelCounts
                ),

            repeatedBreakIntervalSummary:
                summarizeNumbers(
                    intervals
                ),

            firstTenBreaks:
                subclassBreaks
                    .slice(
                        0,
                        10
                    )
        }
    );
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
// GLOBAL BREAK INTERVALS
// ============================================================

const allRepeatedIntervals =
    uniqueBreakEvents

        .map(
            event =>
                event.secondsSincePreviousBreak
        )

        .filter(
            value =>
                Number.isFinite(
                    value
                )
        );


// ============================================================
// REPEATED SLOT SUMMARY
// ============================================================

const repeatedBreakSlots =
    [...breaksBySlot.entries()]

        .filter(
            (
                [
                    entityIndex,
                    events
                ]
            ) =>
                events.length >
                1
        )

        .map(
            (
                [
                    entityIndex,
                    events
                ]
            ) => {

                const slot =
                    breakableSlots.get(
                        entityIndex
                    );


                return {

                    entityIndex,

                    subclassId:
                        slot?.subclassId
                        ??
                        null,

                    position:
                        slot?.position
                        ??
                        null,

                    breakCount:
                        events.length,

                    breakTimes:
                        events.map(
                            event =>
                                ({

                                    matchTimeSeconds:
                                        event.matchTimeSeconds,

                                    matchClock:
                                        event.matchClock,

                                    secondsSincePreviousBreak:
                                        event.secondsSincePreviousBreak
                                })
                        )
                };
            }
        )

        .sort(
            (
                a,
                b
            ) =>
                b.breakCount -
                a.breakCount
                ||
                a.entityIndex -
                b.entityIndex
        );


// ============================================================
// RESOLUTION SUMMARY
// ============================================================

const directResourceMessages =
    matchedResourceMessages.filter(
        message =>
            message.resourceMatchMethod ===
            'DIRECT_HANDLE'
    );


const spatialFallbackMessages =
    matchedResourceMessages.filter(
        message =>
            message.resourceMatchMethod ===
            'SPATIAL_FALLBACK'
    );


const unresolvedMessages =
    debrisMessages.filter(
        message =>
            message.resourceEntityIndex ===
                null
            &&
            message.resolved ===
                false
    );


const resolvedNonResourceMessages =
    debrisMessages.filter(
        message =>
            message.resolved ===
                true
            &&
            message.resolvedClass !==
                RESOURCE_CLASS
    );


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        method:
            'Resolve k_EEntityMsg_BreakablePropSpawnDebris target handles against persistent CCitadel_BreakableProp slots, with conservative spatial fallback when direct resolution fails',

        timing:
            {

                tickRate:
                    TICK_RATE,

                clockOffsetSeconds,

                clockOffsetSource,

                firstDemoTick,

                lastDemoTick
            },

        discoveryContext:
            {

                expectedResourceClass:
                    RESOURCE_CLASS,

                debrisMessageType:
                    DEBRIS_MESSAGE,

                debrisDedupeWindowTicks:
                    DEBRIS_DEDUPE_WINDOW_TICKS,

                spatialFallbackMaxDistance:
                    SPATIAL_FALLBACK_MAX_DISTANCE
            },

        entityLifecycle:
            {

                totalBreakableEntityEvents,

                operationCounts:
                    breakableOperationCounts,

                uniqueBreakableSlots:
                    slotArray.length
            },

        slotSummary:
            {

                total:
                    slotArray.length,

                bySubclass:
                    countBy(
                        slotArray,
                        slot =>
                            slot.subclassId
                    ),

                byFirstSpawnCohort:
                    countBy(
                        slotArray,
                        slot =>
                            slot.firstSpawnCohort
                    )
            },

        debrisSummary:
            {

                totalDebrisMessages:
                    debrisMessages.length,

                directlyResolvedResourceMessages:
                    directResourceMessages.length,

                spatialFallbackResourceMessages:
                    spatialFallbackMessages.length,

                matchedResourceMessages:
                    matchedResourceMessages.length,

                uniqueResourceBreakEvents:
                    uniqueBreakEvents.length,

                uniqueResourceSlotsBroken:
                    breaksBySlot.size,

                resolvedNonResourceMessages:
                    resolvedNonResourceMessages.length,

                unresolvedMessages:
                    unresolvedMessages.length,

                resolvedTargetClasses:
                    mapToObject(
                        resolvedTargetClassCounts
                    )
            },

        repeatedBreaks:
            {

                slotsBrokenMoreThanOnce:
                    repeatedBreakSlots.length,

                intervalSummarySeconds:
                    summarizeNumbers(
                        allRepeatedIntervals
                    )
            },

        subclassSummaries,

        breakableSlots:
            slotArray,

        repeatedBreakSlots,

        uniqueBreakEvents,

        unresolvedDebrisSamples:
            unresolvedMessages.slice(
                0,
                100
            ),

        resolvedNonResourceSamples:
            resolvedNonResourceMessages.slice(
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
// CONSOLE SUMMARY
// ============================================================

console.log(
    `Clock offset: ${
        clockOffsetSeconds === null
            ? 'NOT FOUND'
            : `${clockOffsetSeconds}s`
    }`
);

console.log('');

console.log(
    `Breakable slots: ${slotArray.length}`
);


for (
    const [
        subclass,
        count
    ]
    of Object.entries(
        output.slotSummary.bySubclass
    )
) {

    console.log(
        `  subclass ${subclass}: ${count}`
    );
}


console.log('');

console.log(
    'First-spawn cohorts:'
);


for (
    const [
        cohort,
        count
    ]
    of Object.entries(
        output.slotSummary.byFirstSpawnCohort
    )
) {

    console.log(
        `  ${cohort}: ${count}`
    );
}


console.log('');

console.log(
    'Breakable entity operations:'
);

console.log(
    `  CREATE: ${breakableOperationCounts.CREATE}`
);

console.log(
    `  UPDATE: ${breakableOperationCounts.UPDATE}`
);

console.log(
    `  LEAVE: ${breakableOperationCounts.LEAVE}`
);

console.log(
    `  DELETE: ${breakableOperationCounts.DELETE}`
);

console.log('');

console.log(
    `Debris messages: ${debrisMessages.length}`
);

console.log(
    `Direct resource matches: ${directResourceMessages.length}`
);

console.log(
    `Spatial fallback matches: ${spatialFallbackMessages.length}`
);

console.log(
    `Unique resource breaks: ${uniqueBreakEvents.length}`
);

console.log(
    `Unique resource slots broken: ${breaksBySlot.size}`
);

console.log(
    `Slots broken more than once: ${repeatedBreakSlots.length}`
);

console.log('');

console.log(
    'Resolved debris target classes:'
);


for (
    const [
        className,
        count
    ]
    of [...resolvedTargetClassCounts.entries()]
        .sort(
            (
                a,
                b
            ) =>
                b[1] -
                a[1]
        )
) {

    console.log(
        `  ${className}: ${count}`
    );
}


console.log('');

console.log(
    'Subclass break summaries:'
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
        `  slots: ${summary.slotCount}`
    );

    console.log(
        `  slots broken: ${summary.uniqueSlotsBroken}`
    );

    console.log(
        `  unique breaks: ${summary.uniqueBreakCount}`
    );

    console.log(
        `  raw debris messages: ${summary.rawDebrisMessageCount}`
    );


    const interval =
        summary
            .repeatedBreakIntervalSummary;


    if (
        interval.count >
        0
    ) {

        console.log(
            `  repeated-break interval median: ${interval.median.toFixed(3)}s`
        );

        console.log(
            `  repeated-break interval min: ${interval.min.toFixed(3)}s`
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
// BREAKABLE SLOT
// ============================================================

function getOrCreateBreakableSlot(
    entityIndex
) {

    if (
        !breakableSlots.has(
            entityIndex
        )
    ) {

        breakableSlots.set(
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

                createCount:
                    0,

                updateCount:
                    0,

                leaveCount:
                    0,

                deleteCount:
                    0,

                firstCreateTick:
                    null,

                lastCreateTick:
                    null
            }
        );
    }


    return breakableSlots.get(
        entityIndex
    );
}


// ============================================================
// UPDATE SLOT FROM ENTITY
// ============================================================

function updateSlotFromEntity(
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
// OPERATION
// ============================================================

function classifyOperation(
    operation
) {

    if (
        operation ===
        EntityOperation.CREATE
    ) {

        return 'CREATE';
    }


    if (
        operation ===
        EntityOperation.UPDATE
    ) {

        return 'UPDATE';
    }


    if (
        operation ===
        EntityOperation.LEAVE
    ) {

        return 'LEAVE';
    }


    if (
        operation ===
        EntityOperation.DELETE
    ) {

        return 'DELETE';
    }


    return 'OTHER';
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


    const possibilities =
        [

            entity.index,
            entity.entityIndex,
            entity.entIndex,
            entity.id
        ];


    for (
        const value
        of possibilities
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

            const value =
                toFiniteNumber(
                    entity.getIndex()
                );


            if (
                value !==
                null
            ) {

                return value;
            }

        } catch {
            // Ignore.
        }
    }


    return null;
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


        return (
            value ===
            undefined

                ? null

                : value
        );

    } catch {

        return null;
    }
}


// ============================================================
// WORLD POSITION
//
// Validated Source 2 position conversion:
//
// world = cell * 512 - 16384 + vec
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
// NEAREST SLOT
// ============================================================

function findNearestSlot(
    point,
    slots
) {

    let best =
        null;


    for (
        const slot
        of slots
    ) {

        const distance =
            distance3D(
                point,
                slot.position
            );


        if (
            !Number.isFinite(
                distance
            )
        ) {

            continue;
        }


        if (
            !best
            ||
            distance <
            best.distance
        ) {

            best =
                {
                    slot,
                    distance
                };
        }
    }


    return best;
}


// ============================================================
// DISTANCE
// ============================================================

function distance3D(
    a,
    b
) {

    if (
        !a
        ||
        !b
    ) {

        return null;
    }


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
// TIME
// ============================================================

function tickToReplayTime(
    tick
) {

    if (
        !Number.isFinite(
            tick
        )
    ) {

        return null;
    }


    return tick /
        TICK_RATE;
}


function tickToMatchTime(
    tick
) {

    const replayTime =
        tickToReplayTime(
            tick
        );


    if (
        replayTime ===
        null
        ||
        clockOffsetSeconds ===
        null
    ) {

        return null;
    }


    return replayTime -
        clockOffsetSeconds;
}


// ============================================================
// SPAWN COHORT
// ============================================================

function classifyFirstSpawnCohort(
    time
) {

    if (
        !Number.isFinite(
            time
        )
    ) {

        return 'UNKNOWN';
    }


    if (
        Math.abs(
            time -
            180
        )
        <=
        5
    ) {

        return 'INITIAL_3_MIN';
    }


    if (
        Math.abs(
            time -
            600
        )
        <=
        5
    ) {

        return 'MIDBOSS_10_MIN';
    }


    return 'OTHER';
}


// ============================================================
// CLOCK FORMAT
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


    const total =
        Math.abs(
            seconds
        );


    const minutes =
        Math.floor(
            total /
            60
        );


    const secs =
        Math.floor(
            total %
            60
        );


    return (

        (
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
        )
    );
}


// ============================================================
// COUNTER
// ============================================================

function incrementCounter(
    map,
    key
) {

    const normalized =
        key ===
        null
        ||
        key ===
        undefined

            ? 'NULL'

            : String(
                key
            );


    map.set(

        normalized,

        (
            map.get(
                normalized
            )
            ??
            0
        )
        +
        1
    );
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

        incrementCounter(
            map,
            selector(
                item
            )
        );
    }


    return mapToObject(
        map
    );
}


// ============================================================
// MAP TO OBJECT
// ============================================================

function mapToObject(
    map
) {

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
                (
                    a,
                    b
                ) =>
                    a - b
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