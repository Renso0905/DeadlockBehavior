import {
    createReadStream,
    existsSync,
    mkdirSync,
    writeFileSync,
    createWriteStream
} from 'node:fs';

import {
    dirname,
    resolve
} from 'node:path';

import {
    createInterface
} from 'node:readline';

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


const ENTITY_INDEX_MASK =
    0x3fff;


// ============================================================
// MATCHING
// ============================================================

// Allow one tick before death because entity ordering inside
// the packet could theoretically expose the pickup first.
const MIN_DELTA_TICKS =
    -1;


// Ground-soul behavior in the first confirmed example:
// death tick -> CREATE
// next tick -> interactive + vacuum target.
//
// Four ticks gives us 62.5 ms total after death.
const MAX_DELTA_TICKS =
    4;


// Generous enough for spawn-height offsets while still being
// highly local to the dead Trooper.
const MAX_DISTANCE_3D =
    160;


// Used as evidence that a pooled pickup was reused at a new
// logical location.
const POSITION_JUMP_THRESHOLD =
    32;


// ============================================================
// OUTPUT LIMITS
// ============================================================

const MAX_CANDIDATES_PER_DEATH =
    40;


const MAX_DIAGNOSTIC_EXAMPLES =
    100;


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


const playerStatePath =
    resolve(
        'output',
        replayName,
        'player_state.jsonl'
    );


const outputSummaryPath =
    resolve(
        'output',
        replayName,
        'trooper_assigned_gold_ground_soul_validation.json'
    );


const outputEventsPath =
    resolve(
        'output',
        replayName,
        'trooper_ground_soul_candidates.jsonl'
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


if (
    !existsSync(
        playerStatePath
    )
) {

    throw new Error(
        `Missing player state:\n${playerStatePath}`
    );
}


// ============================================================
// PLAYER PAWN LOOKUP
// ============================================================

console.log('');

console.log(
    'Loading player pawn identities...'
);


const playerByPawnIndex =
    await loadPlayerPawnMap(
        playerStatePath
    );


console.log(
    `Known player pawn indexes: ${playerByPawnIndex.size}`
);


// ============================================================
// TROOPER STATE
// ============================================================

const previousTrooperState =
    new Map();


const trooperIndexes =
    new Set();


const trooperDeaths =
    [];


let trooperEvents =
    0;


let healthDeathTransitions =
    0;


let lifeDeathTransitions =
    0;


// ============================================================
// ASSIGNED GOLD STATE
// ============================================================

const previousAssignedGoldState =
    new Map();


const assignedGoldIndexes =
    new Set();


let assignedGoldEvents =
    0;


let assignedGoldFirstObservations =
    0;


let assignedGoldOperationCreates =
    0;


let assignedGoldBecameActive =
    0;


let assignedGoldBecameInactive =
    0;


let assignedGoldBecameInteractive =
    0;


let assignedGoldBecameNonInteractive =
    0;


let assignedGoldVacuumTargetChanges =
    0;


let assignedGoldPositionJumps =
    0;


// ============================================================
// CHANGE FIELD COUNTS
// ============================================================

const assignedGoldChangedFields =
    new Map();


// ============================================================
// ASSIGNED GOLD ROLLING BUFFER
// ============================================================

let assignedBuffer =
    [];


let assignedBufferStart =
    0;


let maxAssignedBufferSize =
    0;


// ============================================================
// PENDING TROOPER DEATHS
// ============================================================

let pendingDeaths =
    [];


// ============================================================
// EXAMPLES
// ============================================================

const firstMatchedExamples =
    [];


const unmatchedDeathExamples =
    [];


const vacuumTargetExamples =
    [];


const activationExamples =
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


        pruneAssignedBuffer(
            tick -
            8
        );


        pendingDeaths =
            pendingDeaths.filter(
                death =>
                    tick <=
                    death.tick +
                    MAX_DELTA_TICKS
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
    'ASSIGNED GOLD GROUND-SOUL VALIDATION'
);

console.log(
    '=========================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Window: ${MIN_DELTA_TICKS}..+${MAX_DELTA_TICKS} ticks`
);

console.log(
    `Maximum 3D distance: ${MAX_DISTANCE_3D}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// FINALIZE MATCHES
// ============================================================

const matchedRows =
    [];


const unmatchedRows =
    [];


for (
    const death
    of trooperDeaths
) {

    const result =
        chooseBestGroundSoulCandidate(
            death
        );


    if (
        result
    ) {

        matchedRows.push(
            result
        );


        if (
            firstMatchedExamples.length <
            MAX_DIAGNOSTIC_EXAMPLES
        ) {

            firstMatchedExamples.push(
                result
            );
        }

    } else {

        unmatchedRows.push(
            death
        );


        if (
            unmatchedDeathExamples.length <
            MAX_DIAGNOSTIC_EXAMPLES
        ) {

            unmatchedDeathExamples.push({

                deathIndex:
                    death.deathIndex,

                entityIndex:
                    death.entityIndex,

                tick:
                    death.tick,

                clock:
                    death.clock,

                team:
                    death.team,

                lane:
                    death.lane,

                subclassId:
                    death.subclassId,

                position:
                    death.position,

                candidateCount:
                    death.assignedGoldCandidates.length
            });
        }
    }
}


// ============================================================
// WRITE COMPACT MATCH STREAM
// ============================================================

mkdirSync(
    dirname(
        outputEventsPath
    ),
    {
        recursive: true
    }
);


const eventWriter =
    createWriteStream(
        outputEventsPath,
        {
            encoding: 'utf8'
        }
    );


for (
    const row
    of matchedRows
) {

    eventWriter.write(
        JSON.stringify(
            row
        )
        +
        '\n'
    );
}


await new Promise(
    (
        resolvePromise,
        rejectPromise
    ) => {

        eventWriter.on(
            'error',
            rejectPromise
        );


        eventWriter.end(
            resolvePromise
        );
    }
);


// ============================================================
// SUBCLASS SUMMARY
// ============================================================

const deathsBySubclass =
    countBy(
        trooperDeaths,
        row =>
            String(
                row.subclassId
                ??
                'UNKNOWN'
            )
    );


const matchedBySubclass =
    countBy(
        matchedRows,
        row =>
            String(
                row.trooper.subclassId
                ??
                'UNKNOWN'
            )
    );


const bySubclass =
    [];


for (
    const [
        subclassId,
        deathCount
    ]
    of deathsBySubclass.entries()
) {

    const rows =
        matchedRows.filter(
            row =>
                String(
                    row.trooper.subclassId
                    ??
                    'UNKNOWN'
                )
                ===
                subclassId
        );


    const oppositeTeam =
        rows.filter(
            row =>
                row.pickup.teamRelation ===
                'OPPOSITE_TROOPER_TEAM'
        ).length;


    const sameTeam =
        rows.filter(
            row =>
                row.pickup.teamRelation ===
                'SAME_AS_TROOPER'
        ).length;


    const validVacuum =
        rows.filter(
            row =>
                row.acquisition.validVacuumTarget
        ).length;


    const resolvedPlayer =
        rows.filter(
            row =>
                row.acquisition.targetPlayer !==
                null
        ).length;


    const exactTick =
        rows.filter(
            row =>
                row.match.tickDelta ===
                0
        ).length;


    const withinOneTick =
        rows.filter(
            row =>
                Math.abs(
                    row.match.tickDelta
                )
                <=
                1
        ).length;


    bySubclass.push({

        subclassId,

        deaths:
            deathCount,

        matchedGroundSoul:
            rows.length,

        matchRate:
            rate(
                rows.length,
                deathCount
            ),

        exactTickMatches:
            exactTick,

        exactTickRate:
            rate(
                exactTick,
                rows.length
            ),

        withinOneTickMatches:
            withinOneTick,

        withinOneTickRate:
            rate(
                withinOneTick,
                rows.length
            ),

        oppositeTeamMatches:
            oppositeTeam,

        oppositeTeamRate:
            rate(
                oppositeTeam,
                rows.length
            ),

        sameTeamMatches:
            sameTeam,

        validVacuumTargets:
            validVacuum,

        validVacuumTargetRate:
            rate(
                validVacuum,
                rows.length
            ),

        resolvedTargetPlayers:
            resolvedPlayer,

        resolvedTargetPlayerRate:
            rate(
                resolvedPlayer,
                rows.length
            ),

        geometry:
            {

                distance3D:
                    summarizeNumbers(
                        rows.map(
                            row =>
                                row.match.distance3D
                        )
                    ),

                distanceXY:
                    summarizeNumbers(
                        rows.map(
                            row =>
                                row.match.distanceXY
                        )
                    ),

                verticalDelta:
                    summarizeNumbers(
                        rows.map(
                            row =>
                                row.match.verticalDelta
                        )
                    ),

                absoluteVerticalDelta:
                    summarizeNumbers(
                        rows.map(
                            row =>
                                Math.abs(
                                    row.match.verticalDelta
                                )
                        )
                    ),

                tickDelta:
                    summarizeNumbers(
                        rows.map(
                            row =>
                                row.match.tickDelta
                        )
                    )
            }
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
// COLLECTOR COUNTS
// ============================================================

const resolvedCollectorCounts =
    countBy(
        matchedRows.filter(
            row =>
                row.acquisition.targetPlayer
        ),
        row =>
            row.acquisition.targetPlayer.playerName
    );


// ============================================================
// SIGNAL COUNTS
// ============================================================

const signalCounts =
    new Map();


for (
    const row
    of matchedRows
) {

    for (
        const signal
        of row.pickup.signals
    ) {

        increment(
            signalCounts,
            signal
        );
    }
}


// ============================================================
// GLOBAL GEOMETRY
// ============================================================

const globalGeometry =
    {

        distance3D:
            summarizeNumbers(
                matchedRows.map(
                    row =>
                        row.match.distance3D
                )
            ),

        distanceXY:
            summarizeNumbers(
                matchedRows.map(
                    row =>
                        row.match.distanceXY
                )
            ),

        verticalDelta:
            summarizeNumbers(
                matchedRows.map(
                    row =>
                        row.match.verticalDelta
                )
            ),

        tickDelta:
            summarizeNumbers(
                matchedRows.map(
                    row =>
                        row.match.tickDelta
                )
            )
    };


// ============================================================
// VALIDATION
// ============================================================

const strongestSubclassMatchRate =
    bySubclass.length >
        0
        ? Math.max(
            ...bySubclass.map(
                row =>
                    row.matchRate
                    ??
                    0
            )
        )
        : 0;


const validation =
    {

        trooperDeaths:
            {

                actual:
                    trooperDeaths.length,

                expected:
                    replayName ===
                        'test'
                        ? 4812
                        : '>0',

                pass:
                    replayName ===
                        'test'

                        ? trooperDeaths.length ===
                            4812

                        : trooperDeaths.length >
                            0
            },

        dualDeathSignals:
            {

                actual:
                    healthDeathTransitions ===
                        trooperDeaths.length
                    &&
                    lifeDeathTransitions ===
                        trooperDeaths.length,

                expected:
                    true,

                pass:
                    healthDeathTransitions ===
                        trooperDeaths.length
                    &&
                    lifeDeathTransitions ===
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

        localDeathMatchesObserved:
            {

                actual:
                    matchedRows.length,

                expected:
                    '>0',

                pass:
                    matchedRows.length >
                    0
            },

        strongSubclassAssociation:
            {

                actual:
                    strongestSubclassMatchRate,

                expected:
                    '>0.50',

                pass:
                    strongestSubclassMatchRate >
                    0.50
            },

        vacuumTargetsObserved:
            {

                actual:
                    matchedRows.filter(
                        row =>
                            row.acquisition.validVacuumTarget
                    ).length,

                expected:
                    '>0',

                pass:
                    matchedRows.some(
                        row =>
                            row.acquisition.validVacuumTarget
                    )
            },

        playerTargetsResolved:
            {

                actual:
                    matchedRows.filter(
                        row =>
                            row.acquisition.targetPlayer
                    ).length,

                expected:
                    '>0',

                pass:
                    matchedRows.some(
                        row =>
                            row.acquisition.targetPlayer
                    )
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
// INTERPRETATION GATE
// ============================================================

const ordinaryCandidates =
    bySubclass

        .filter(
            row =>
                (
                    row.matchRate
                    ??
                    0
                ) >=
                0.50
        )

        .map(
            row =>
                row.subclassId
        );


const interpretation =
    {

        assignedGoldGroundSoulCandidate:
            matchedRows.length >
                0
            &&
            strongestSubclassMatchRate >
                0.50,

        reason:
            [

                'A valid ground-soul candidate must occur within a few replay ticks of Trooper death and within a small 3D radius of the dead Trooper.',

                'Operation CREATE alone is explicitly not treated as a logical spawn because pooled entities can be emitted as CREATE repeatedly without representing a new gameplay object.',

                'Evidence is strengthened by active/interactivity transitions, position jumps, opposing-team assignment, and a valid m_hVacuumTarget.',

                'm_hVacuumTarget is decoded through the low 14 entity-index bits and resolved against known player pawn indexes from player_state.jsonl.',

                'This script does not identify the separate shootable/deniable soul orb.'
            ],

        trooperSubclassesWithStrongAssociation:
            ordinaryCandidates,

        caveat:
            'Single-replay validation only. Do not yet assign a final canonical Trooper subtype name solely from this replay.'
    };


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'ASSIGNED_GOLD_GROUND_SOUL_VALIDATION',

        canonical:
            false,

        purpose:
            [

                'Test whether CCitadel_Pickup_AssignedGold is the local magnetic/floor soul component generated by economically meaningful Trooper deaths.',

                'Avoid treating repeated EntityOperation CREATE events as gameplay spawns.',

                'Use synchronous death timing and geometry as the primary association rule.',

                'Resolve m_hVacuumTarget to player pawn identity where possible.',

                'Separate this candidate ground-soul component from the still-unidentified shootable/deniable soul orb.'
            ],

        matching:
            {

                minDeltaTicks:
                    MIN_DELTA_TICKS,

                maxDeltaTicks:
                    MAX_DELTA_TICKS,

                minDeltaSeconds:
                    MIN_DELTA_TICKS /
                    TICK_RATE,

                maxDeltaSeconds:
                    MAX_DELTA_TICKS /
                    TICK_RATE,

                maxDistance3D:
                    MAX_DISTANCE_3D,

                positionJumpThreshold:
                    POSITION_JUMP_THRESHOLD
            },

        sourceCounts:
            {

                playerPawnIdentities:
                    playerByPawnIndex.size,

                trooperEvents,

                trooperDeaths:
                    trooperDeaths.length,

                healthDeathTransitions,

                lifeDeathTransitions,

                uniqueTrooperIndexes:
                    trooperIndexes.size,

                assignedGoldEvents,

                uniqueAssignedGoldIndexes:
                    assignedGoldIndexes.size
            },

        assignedGoldLifecycle:
            {

                firstObservations:
                    assignedGoldFirstObservations,

                operationCreates:
                    assignedGoldOperationCreates,

                becameActive:
                    assignedGoldBecameActive,

                becameInactive:
                    assignedGoldBecameInactive,

                becameInteractive:
                    assignedGoldBecameInteractive,

                becameNonInteractive:
                    assignedGoldBecameNonInteractive,

                vacuumTargetChanges:
                    assignedGoldVacuumTargetChanges,

                positionJumps:
                    assignedGoldPositionJumps,

                changedFields:
                    mapToSortedObject(
                        assignedGoldChangedFields
                    )
            },

        groundSoulMatching:
            {

                matchedDeaths:
                    matchedRows.length,

                unmatchedDeaths:
                    unmatchedRows.length,

                globalMatchRate:
                    rate(
                        matchedRows.length,
                        trooperDeaths.length
                    ),

                signalCounts:
                    mapToSortedObject(
                        signalCounts
                    ),

                geometry:
                    globalGeometry,

                byTrooperSubclass:
                    bySubclass
            },

        acquisition:
            {

                validVacuumTargets:
                    matchedRows.filter(
                        row =>
                            row.acquisition.validVacuumTarget
                    ).length,

                resolvedPlayerTargets:
                    matchedRows.filter(
                        row =>
                            row.acquisition.targetPlayer
                    ).length,

                resolvedCollectorCounts:
                    mapToSortedObject(
                        resolvedCollectorCounts
                    )
            },

        interpretation,

        diagnosticExamples:
            {

                matched:
                    firstMatchedExamples,

                unmatched:
                    unmatchedDeathExamples,

                vacuumTargets:
                    vacuumTargetExamples,

                activationSignals:
                    activationExamples
            },

        memory:
            {

                maximumAssignedGoldRollingBuffer:
                    maxAssignedBufferSize
            },

        validation:
            {

                pass:
                    validationPass,

                checks:
                    validation
            },

        outputs:
            {

                matchedEventStream:
                    outputEventsPath
            }
    };


// ============================================================
// WRITE SUMMARY
// ============================================================

mkdirSync(
    dirname(
        outputSummaryPath
    ),
    {
        recursive: true
    }
);


writeFileSync(

    outputSummaryPath,

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
    `Health transitions: ${healthDeathTransitions}`
);

console.log(
    `Life-state transitions: ${lifeDeathTransitions}`
);

console.log('');

console.log(
    'ASSIGNED GOLD LIFECYCLE'
);

console.log(
    '-----------------------'
);

console.log(
    `Events: ${assignedGoldEvents.toLocaleString()}`
);

console.log(
    `Unique indexes: ${assignedGoldIndexes.size}`
);

console.log(
    `First observations: ${assignedGoldFirstObservations}`
);

console.log(
    `operation CREATE: ${assignedGoldOperationCreates}`
);

console.log(
    `Became active: ${assignedGoldBecameActive}`
);

console.log(
    `Became inactive: ${assignedGoldBecameInactive}`
);

console.log(
    `Became interactive: ${assignedGoldBecameInteractive}`
);

console.log(
    `Vacuum target changes: ${assignedGoldVacuumTargetChanges}`
);

console.log(
    `Position jumps: ${assignedGoldPositionJumps}`
);

console.log('');

console.log(
    'GROUND-SOUL MATCHING BY TROOPER SUBCLASS'
);

console.log(
    '----------------------------------------'
);


for (
    const row
    of bySubclass
) {

    console.log(
        `${
            row.subclassId.padEnd(
                16
            )
        } deaths=${
            String(
                row.deaths
            ).padStart(
                5
            )
        } matched=${
            String(
                row.matchedGroundSoul
            ).padStart(
                5
            )
        } rate=${
            formatPercent(
                row.matchRate
            ).padStart(
                7
            )
        } exact=${
            String(
                row.exactTickMatches
            ).padStart(
                5
            )
        } vacuum=${
            String(
                row.validVacuumTargets
            ).padStart(
                5
            )
        } player=${
            String(
                row.resolvedTargetPlayers
            ).padStart(
                5
            )
        } oppositeTeam=${
            String(
                row.oppositeTeamMatches
            ).padStart(
                5
            )
        }`
    );
}


console.log('');

console.log(
    'GLOBAL MATCH'
);

console.log(
    '------------'
);

console.log(
    `Matched deaths: ${matchedRows.length}`
);

console.log(
    `Unmatched deaths: ${unmatchedRows.length}`
);

console.log(
    `Match rate: ${formatPercent(
        rate(
            matchedRows.length,
            trooperDeaths.length
        )
    )}`
);

console.log(
    `Valid vacuum targets: ${
        matchedRows.filter(
            row =>
                row.acquisition.validVacuumTarget
        ).length
    }`
);

console.log(
    `Resolved player targets: ${
        matchedRows.filter(
            row =>
                row.acquisition.targetPlayer
        ).length
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
    `Summary:\n${outputSummaryPath}`
);

console.log('');

console.log(
    `Matched stream:\n${outputEventsPath}`
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
            ` | AssignedGold: ${assignedGoldEvents.toLocaleString()}`
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
                0;


        const lifeDeath =
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
                0;


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

                    previousHealth:
                        previous.health,

                    currentLifeState:
                        current.lifeState,

                    position:
                        current.position
                        ??
                        previous.position,

                    assignedGoldCandidates:
                        []
                };


            // =================================================
            // BACKWARD BUFFER
            // =================================================

            for (
                let i =
                    assignedBufferStart;

                i <
                    assignedBuffer.length;

                i++
            ) {

                const candidate =
                    assignedBuffer[
                        i
                    ];


                const delta =
                    candidate.tick -
                    tick;


                if (
                    delta <
                        MIN_DELTA_TICKS
                    ||
                    delta >
                        0
                ) {

                    continue;
                }


                addCandidateToDeath(
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
        entityIndex ===
        null
    ) {

        return;
    }


    assignedGoldIndexes.add(
        entityIndex
    );


    const rawChanges =
        safeGetChanges(
            event
        );


    const changedFields =
        extractPlainObjectChangeFields(
            rawChanges
        );


    for (
        const fieldName
        of changedFields
    ) {

        increment(
            assignedGoldChangedFields,
            fieldName
        );
    }


    const operation =
        decodeOperation(
            event.operation
        );


    if (
        operation ===
        'CREATE'
    ) {

        assignedGoldOperationCreates++;
    }


    const current =
        {

            tick,

            entityIndex,

            operation,

            active:
                booleanOrNull(
                    safeGetField(
                        entity,
                        'm_bActive'
                    )
                ),

            interactive:
                booleanOrNull(
                    safeGetField(
                        entity,
                        'm_bInteractive'
                    )
                ),

            vacuumTarget:
                handleOrNull(
                    safeGetField(
                        entity,
                        'm_hVacuumTarget'
                    )
                ),

            team:
                finite(
                    safeGetField(
                        entity,
                        'm_iTeamNum'
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
                ),

            changedFields,

            signals:
                []
        };


    const previous =
        previousAssignedGoldState.get(
            entityIndex
        )
        ??
        null;


    // ========================================================
    // FIRST OBSERVATION
    // ========================================================

    if (
        !previous
    ) {

        assignedGoldFirstObservations++;


        current.signals.push(
            'FIRST_OBSERVATION'
        );
    }


    // ========================================================
    // OPERATION CREATE
    // ========================================================

    if (
        operation ===
        'CREATE'
    ) {

        current.signals.push(
            'OPERATION_CREATE'
        );
    }


    // ========================================================
    // ACTIVE TRANSITIONS
    // ========================================================

    if (
        previous
        &&
        previous.active ===
            false
        &&
        current.active ===
            true
    ) {

        assignedGoldBecameActive++;


        current.signals.push(
            'BECAME_ACTIVE'
        );
    }


    if (
        previous
        &&
        previous.active ===
            true
        &&
        current.active ===
            false
    ) {

        assignedGoldBecameInactive++;


        current.signals.push(
            'BECAME_INACTIVE'
        );
    }


    // ========================================================
    // INTERACTIVE TRANSITIONS
    // ========================================================

    if (
        previous
        &&
        previous.interactive ===
            false
        &&
        current.interactive ===
            true
    ) {

        assignedGoldBecameInteractive++;


        current.signals.push(
            'BECAME_INTERACTIVE'
        );
    }


    if (
        previous
        &&
        previous.interactive ===
            true
        &&
        current.interactive ===
            false
    ) {

        assignedGoldBecameNonInteractive++;


        current.signals.push(
            'BECAME_NONINTERACTIVE'
        );
    }


    // ========================================================
    // VACUUM TARGET
    // ========================================================

    if (
        previous
        &&
        previous.vacuumTarget !==
            current.vacuumTarget
    ) {

        assignedGoldVacuumTargetChanges++;


        current.signals.push(
            'VACUUM_TARGET_CHANGED'
        );
    }


    if (
        isValidHandle(
            current.vacuumTarget
        )
    ) {

        current.signals.push(
            'VALID_VACUUM_TARGET'
        );


        if (
            vacuumTargetExamples.length <
            MAX_DIAGNOSTIC_EXAMPLES
        ) {

            const decodedIndex =
                decodeHandleEntityIndex(
                    current.vacuumTarget
                );


            vacuumTargetExamples.push({

                tick,

                clock:
                    formatClock(
                        tickToMatchTime(
                            tick
                        )
                    ),

                assignedGoldEntityIndex:
                    entityIndex,

                vacuumTarget:
                    current.vacuumTarget,

                decodedEntityIndex:
                    decodedIndex,

                targetPlayer:
                    playerByPawnIndex.get(
                        decodedIndex
                    )
                    ??
                    null,

                position:
                    current.position
            });
        }
    }


    // ========================================================
    // POSITION JUMP
    // ========================================================

    if (
        previous?.position
        &&
        current.position
    ) {

        const jump =
            getDistance3D(
                previous.position,
                current.position
            );


        if (
            jump >=
            POSITION_JUMP_THRESHOLD
        ) {

            assignedGoldPositionJumps++;


            current.signals.push(
                'POSITION_JUMP'
            );


            current.positionJumpDistance =
                jump;
        }
    }


    // ========================================================
    // RAW CHANGE SIGNALS
    // ========================================================

    for (
        const fieldName
        of changedFields
    ) {

        if (
            fieldName ===
            'm_bActive'
        ) {

            current.signals.push(
                'ACTIVE_FIELD_CHANGED'
            );
        }


        if (
            fieldName ===
            'm_bInteractive'
        ) {

            current.signals.push(
                'INTERACTIVE_FIELD_CHANGED'
            );
        }


        if (
            fieldName ===
            'm_hVacuumTarget'
        ) {

            current.signals.push(
                'VACUUM_FIELD_CHANGED'
            );
        }
    }


    current.signals =
        [
            ...new Set(
                current.signals
            )
        ];


    // ========================================================
    // DIAGNOSTIC ACTIVATION EXAMPLES
    // ========================================================

    if (
        hasActivationLikeSignal(
            current
        )
        &&
        activationExamples.length <
            MAX_DIAGNOSTIC_EXAMPLES
    ) {

        activationExamples.push({

            tick,

            clock:
                formatClock(
                    tickToMatchTime(
                        tick
                    )
                ),

            entityIndex,

            operation,

            active:
                current.active,

            interactive:
                current.interactive,

            vacuumTarget:
                current.vacuumTarget,

            team:
                current.team,

            position:
                current.position,

            signals:
                current.signals,

            changedFields:
                current.changedFields
        });
    }


    // ========================================================
    // FORWARD MATCH TO PENDING DEATHS
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
                MAX_DELTA_TICKS
        ) {

            continue;
        }


        addCandidateToDeath(
            death,
            current
        );
    }


    // ========================================================
    // BUFFER
    // ========================================================

    assignedBuffer.push(
        current
    );


    maxAssignedBufferSize =
        Math.max(
            maxAssignedBufferSize,
            assignedBuffer.length -
                assignedBufferStart
        );


    previousAssignedGoldState.set(
        entityIndex,
        current
    );
}


// ============================================================
// ADD CANDIDATE
// ============================================================

function addCandidateToDeath(
    death,
    pickup
) {

    if (
        !death.position
        ||
        !pickup.position
    ) {

        return;
    }


    const tickDelta =
        pickup.tick -
        death.tick;


    if (
        tickDelta <
            MIN_DELTA_TICKS
        ||
        tickDelta >
            MAX_DELTA_TICKS
    ) {

        return;
    }


    const distance3D =
        getDistance3D(
            death.position,
            pickup.position
        );


    if (
        distance3D >
        MAX_DISTANCE_3D
    ) {

        return;
    }


    // ========================================================
    // IMPORTANT
    //
    // Continuous movement updates are not by themselves treated
    // as evidence of a fresh logical soul spawn.
    // ========================================================

    if (
        !hasCandidateSignal(
            pickup
        )
    ) {

        return;
    }


    if (
        death.assignedGoldCandidates.length >=
        MAX_CANDIDATES_PER_DEATH
    ) {

        return;
    }


    const dx =
        pickup.position.x -
        death.position.x;


    const dy =
        pickup.position.y -
        death.position.y;


    const distanceXY =
        Math.sqrt(
            dx *
            dx
            +
            dy *
            dy
        );


    const verticalDelta =
        (
            pickup.position.z
            ??
            0
        )
        -
        (
            death.position.z
            ??
            0
        );


    death.assignedGoldCandidates.push({

        tick:
            pickup.tick,

        tickDelta,

        entityIndex:
            pickup.entityIndex,

        operation:
            pickup.operation,

        active:
            pickup.active,

        interactive:
            pickup.interactive,

        vacuumTarget:
            pickup.vacuumTarget,

        team:
            pickup.team,

        subclassId:
            pickup.subclassId,

        position:
            pickup.position,

        distance3D,

        distanceXY,

        verticalDelta,

        signals:
            pickup.signals,

        changedFields:
            pickup.changedFields,

        positionJumpDistance:
            pickup.positionJumpDistance
            ??
            null
    });
}


// ============================================================
// CANDIDATE SIGNAL
// ============================================================

function hasCandidateSignal(
    pickup
) {

    return (
        pickup.signals.includes(
            'FIRST_OBSERVATION'
        )
        ||
        pickup.signals.includes(
            'OPERATION_CREATE'
        )
        ||
        pickup.signals.includes(
            'BECAME_ACTIVE'
        )
        ||
        pickup.signals.includes(
            'BECAME_INTERACTIVE'
        )
        ||
        pickup.signals.includes(
            'VACUUM_TARGET_CHANGED'
        )
        ||
        pickup.signals.includes(
            'POSITION_JUMP'
        )
    );
}


function hasActivationLikeSignal(
    pickup
) {

    return (
        pickup.signals.includes(
            'FIRST_OBSERVATION'
        )
        ||
        pickup.signals.includes(
            'BECAME_ACTIVE'
        )
        ||
        pickup.signals.includes(
            'POSITION_JUMP'
        )
        ||
        pickup.signals.includes(
            'BECAME_INTERACTIVE'
        )
        ||
        pickup.signals.includes(
            'VACUUM_TARGET_CHANGED'
        )
    );
}


// ============================================================
// CHOOSE BEST CANDIDATE
// ============================================================

function chooseBestGroundSoulCandidate(
    death
) {

    if (
        death.assignedGoldCandidates.length ===
        0
    ) {

        return null;
    }


    const sorted =
        [
            ...death.assignedGoldCandidates
        ]
        .sort(
            (
                a,
                b
            ) =>
                candidateScore(
                    a
                )
                -
                candidateScore(
                    b
                )
        );


    const best =
        sorted[0];


    // ========================================================
    // FIND TARGET ASSIGNMENT
    //
    // Prefer a valid vacuum target from any candidate event
    // belonging to the same pooled entity within this tiny
    // death window.
    // ========================================================

    const sameEntityCandidates =
        death.assignedGoldCandidates

            .filter(
                row =>
                    row.entityIndex ===
                    best.entityIndex
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    a.tick -
                    b.tick
            );


    let targetHandle =
        null;


    let targetTick =
        null;


    for (
        const row
        of sameEntityCandidates
    ) {

        if (
            isValidHandle(
                row.vacuumTarget
            )
        ) {

            targetHandle =
                row.vacuumTarget;


            targetTick =
                row.tick;


            break;
        }
    }


    const targetEntityIndex =
        targetHandle !==
            null
            ? decodeHandleEntityIndex(
                targetHandle
            )
            : null;


    const targetPlayer =
        targetEntityIndex !==
            null
            ? (
                playerByPawnIndex.get(
                    targetEntityIndex
                )
                ??
                null
            )
            : null;


    const teamRelation =
        getTeamRelation(
            death.team,
            best.team
        );


    return {

        schemaVersion:
            'TROOPER_GROUND_SOUL_CANDIDATE_V1',

        canonical:
            false,

        trooper:
            {

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

                team:
                    death.team,

                lane:
                    death.lane,

                subclassId:
                    death.subclassId,

                previousHealth:
                    death.previousHealth,

                deathLifeState:
                    death.currentLifeState,

                position:
                    death.position
            },

        pickup:
            {

                className:
                    'CCitadel_Pickup_AssignedGold',

                entityIndex:
                    best.entityIndex,

                team:
                    best.team,

                teamRelation,

                subclassId:
                    best.subclassId,

                operation:
                    best.operation,

                active:
                    best.active,

                interactive:
                    best.interactive,

                position:
                    best.position,

                signals:
                    best.signals,

                changedFields:
                    best.changedFields
            },

        match:
            {

                tick:
                    best.tick,

                tickDelta:
                    best.tickDelta,

                secondsDelta:
                    best.tickDelta /
                    TICK_RATE,

                distance3D:
                    best.distance3D,

                distanceXY:
                    best.distanceXY,

                verticalDelta:
                    best.verticalDelta,

                score:
                    candidateScore(
                        best
                    ),

                candidateCount:
                    death.assignedGoldCandidates.length
            },

        acquisition:
            {

                validVacuumTarget:
                    targetHandle !==
                    null,

                vacuumTargetHandle:
                    targetHandle,

                vacuumTargetTick:
                    targetTick,

                vacuumTargetDeltaTicks:
                    targetTick !==
                        null
                        ? targetTick -
                            death.tick
                        : null,

                targetEntityIndex,

                targetPlayer
            }
    };
}


// ============================================================
// CANDIDATE SCORE
// ============================================================

function candidateScore(
    row
) {

    let score =
        0;


    // Timing first.
    score +=
        Math.abs(
            row.tickDelta
        )
        *
        1000;


    // Then geometry.
    score +=
        row.distance3D;


    // Strong lifecycle evidence.
    if (
        row.signals.includes(
            'BECAME_ACTIVE'
        )
    ) {

        score -=
            500;
    }


    if (
        row.signals.includes(
            'POSITION_JUMP'
        )
    ) {

        score -=
            400;
    }


    if (
        row.signals.includes(
            'FIRST_OBSERVATION'
        )
    ) {

        score -=
            300;
    }


    // CREATE is evidence, but deliberately weak because
    // deadem/PVS can repeat CREATE on pooled entities.
    if (
        row.signals.includes(
            'OPERATION_CREATE'
        )
    ) {

        score -=
            100;
    }


    if (
        row.signals.includes(
            'VACUUM_TARGET_CHANGED'
        )
    ) {

        score -=
            250;
    }


    if (
        row.signals.includes(
            'BECAME_INTERACTIVE'
        )
    ) {

        score -=
            200;
    }


    if (
        isValidHandle(
            row.vacuumTarget
        )
    ) {

        score -=
            150;
    }


    return score;
}


// ============================================================
// PLAYER PAWN MAP
// ============================================================

async function loadPlayerPawnMap(
    path
) {

    const output =
        new Map();


    const stream =
        createReadStream(
            path,
            {
                encoding:
                    'utf8'
            }
        );


    const lines =
        createInterface({
            input:
                stream,

            crlfDelay:
                Infinity
        });


    for await (
        const line
        of lines
    ) {

        if (
            !line.trim()
        ) {

            continue;
        }


        let row;


        try {

            row =
                JSON.parse(
                    line
                );

        } catch {

            continue;
        }


        const pawnIndex =
            finite(
                row
                    ?.pawn
                    ?.entityIndex
            );


        const playerName =
            row
                ?.controller
                ?.playerName
            ??
            null;


        if (
            pawnIndex ===
                null
            ||
            !playerName
        ) {

            continue;
        }


        if (
            !output.has(
                pawnIndex
            )
        ) {

            output.set(
                pawnIndex,
                {

                    playerName,

                    heroId:
                        finite(
                            row
                                ?.controller
                                ?.heroId
                        ),

                    team:
                        finite(
                            row
                                ?.controller
                                ?.team
                        ),

                    pawnEntityIndex:
                        pawnIndex,

                    controllerEntityIndex:
                        finite(
                            row
                                ?.controller
                                ?.entityIndex
                        )
                }
            );
        }
    }


    return output;
}


// ============================================================
// ASSIGNED BUFFER
// ============================================================

function pruneAssignedBuffer(
    minimumTick
) {

    while (
        assignedBufferStart <
            assignedBuffer.length
        &&
        assignedBuffer[
            assignedBufferStart
        ].tick <
            minimumTick
    ) {

        assignedBufferStart++;
    }


    if (
        assignedBufferStart >
        5000
    ) {

        assignedBuffer =
            assignedBuffer.slice(
                assignedBufferStart
            );


        assignedBufferStart =
            0;
    }
}


// ============================================================
// CHANGES
//
// IMPORTANT:
// getChanges() for these entities is a plain:
// {
//   "m_bInteractive": true,
//   "m_hVacuumTarget": 123,
//   ...
// }
//
// This corrects Script 50's extractor.
// ============================================================

function extractPlainObjectChangeFields(
    rawChanges
) {

    if (
        rawChanges ===
            null
        ||
        rawChanges ===
            undefined
    ) {

        return [];
    }


    if (
        rawChanges instanceof Map
    ) {

        return [
            ...rawChanges.keys()
        ]
        .map(
            key =>
                String(
                    key
                )
        );
    }


    if (
        Array.isArray(
            rawChanges
        )
    ) {

        const names =
            [];


        for (
            const row
            of rawChanges
        ) {

            if (
                Array.isArray(
                    row
                )
                &&
                row.length >
                    0
            ) {

                names.push(
                    String(
                        row[0]
                    )
                );


                continue;
            }


            if (
                row
                &&
                typeof row ===
                    'object'
            ) {

                const name =
                    row.fieldName
                    ??
                    row.name
                    ??
                    row.key
                    ??
                    row.path
                    ??
                    null;


                if (
                    name
                ) {

                    names.push(
                        String(
                            name
                        )
                    );
                }
            }
        }


        return [
            ...new Set(
                names
            )
        ];
    }


    if (
        typeof rawChanges ===
        'object'
    ) {

        return Object.keys(
            rawChanges
        );
    }


    return [];
}


// ============================================================
// SAFE getChanges
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
// OPERATION
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
// HANDLE
// ============================================================

function handleOrNull(
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


    try {

        return BigInt(
            value
        ).toString();

    } catch {

        return null;
    }
}


function isValidHandle(
    handle
) {

    if (
        handle ===
        null
        ||
        handle ===
        undefined
    ) {

        return false;
    }


    try {

        const value =
            BigInt(
                handle
            );


        // Source invalid entity handle.
        if (
            value ===
            16777215n
        ) {

            return false;
        }


        return value >
            0n;

    } catch {

        return false;
    }
}


function decodeHandleEntityIndex(
    handle
) {

    if (
        !isValidHandle(
            handle
        )
    ) {

        return null;
    }


    try {

        return Number(
            BigInt(
                handle
            )
            &
            BigInt(
                ENTITY_INDEX_MASK
            )
        );

    } catch {

        return null;
    }
}


// ============================================================
// TEAM RELATION
// ============================================================

function getTeamRelation(
    trooperTeam,
    pickupTeam
) {

    if (
        trooperTeam ===
            null
        ||
        pickupTeam ===
            null
    ) {

        return 'UNKNOWN';
    }


    if (
        trooperTeam ===
        pickupTeam
    ) {

        return 'SAME_AS_TROOPER';
    }


    if (
        (
            trooperTeam ===
                2
            &&
            pickupTeam ===
                3
        )
        ||
        (
            trooperTeam ===
                3
            &&
            pickupTeam ===
                2
        )
    ) {

        return 'OPPOSITE_TROOPER_TEAM';
    }


    return 'OTHER';
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
// POSITION
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
// SUMMARIES
// ============================================================

function countBy(
    rows,
    keyFunction
) {

    const output =
        new Map();


    for (
        const row
        of rows
    ) {

        increment(
            output,
            keyFunction(
                row
            )
        );
    }


    return output;
}


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


    const total =
        clean.reduce(
            (
                sum,
                value
            ) =>
                sum +
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
            total /
            clean.length
    };
}


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


    const position =
        (
            sorted.length -
            1
        )
        *
        proportion;


    const lower =
        Math.floor(
            position
        );


    const upper =
        Math.ceil(
            position
        );


    if (
        lower ===
        upper
    ) {

        return sorted[
            lower
        ];
    }


    const fraction =
        position -
        lower;


    return (
        sorted[
            lower
        ]
        *
        (
            1 -
            fraction
        )
        +
        sorted[
            upper
        ]
        *
        fraction
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
// VALUE HELPERS
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


function booleanOrNull(
    value
) {

    if (
        value ===
        true
        ||
        value ===
        false
    ) {

        return value;
    }


    if (
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
        0
        ||
        value ===
        '0'
    ) {

        return false;
    }


    return null;
}


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


    return numerator /
        denominator;
}


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