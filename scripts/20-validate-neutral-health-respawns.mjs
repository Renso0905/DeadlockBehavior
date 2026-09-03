import {
    createReadStream,
    readFileSync,
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

const TICK_RATE =
    64;

const MATCH_OFFSET =
    30;

const RETURN_COHORT_TOLERANCE =
    0.20;


const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const cohortPath =
    resolve(
        'output',
        replayName,
        'neutral_spawn_cohorts.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'neutral_health_respawn_validation.json'
    );


// ============================================================
// LOAD FIXED GEOMETRIC GROUPS
// ============================================================

const source =
    JSON.parse(
        readFileSync(
            cohortPath,
            'utf8'
        )
    );


const groups =
    source.spawnGroups;


// ============================================================
// INDEX MEMBERSHIP
// ============================================================

const groupByEntity =
    new Map();


for (
    const group
    of groups
) {

    for (
        const entityIndex
        of group.entityIndexes
    ) {

        groupByEntity.set(
            entityIndex,
            group.spawnGroupId
        );
    }
}


const groupDefinition =
    new Map(
        groups.map(
            group => [
                group.spawnGroupId,
                group
            ]
        )
    );


// ============================================================
// ENTITY STATE
// ============================================================

const entityState =
    new Map();


const entityEvents =
    new Map();


for (
    const group
    of groups
) {

    for (
        const entityIndex
        of group.entityIndexes
    ) {

        entityState.set(
            entityIndex,
            {
                known: false,
                alive: null,
                health: null,
                lifeState: null,
                lastObservedTick: null
            }
        );


        entityEvents.set(
            entityIndex,
            []
        );
    }
}


// ============================================================
// GROUP RUNTIME STATE
// ============================================================

const groupRuntime =
    new Map();


for (
    const group
    of groups
) {

    groupRuntime.set(
        group.spawnGroupId,
        {
            initialized: false,

            wasAllDead: false,

            wasAllAlive: false,

            pendingClear:
                null,

            fullClears:
                [],

            fullRespawns:
                [],

            returnEvents:
                [],

            deathEvents:
                []
        }
    );
}


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
            !Number.isFinite(
                tick
            )
        ) {

            return;
        }


        const matchTime =
            tick /
            TICK_RATE
            -
            MATCH_OFFSET;


        const demo =
            parser.getDemo();


        const neutrals =
            demo.getEntitiesByClassName(
                'CNPC_TrooperNeutral'
            );


        // Track which groups had state changes this packet.
        const touchedGroups =
            new Set();


        for (
            const neutral
            of neutrals
        ) {

            const entityIndex =
                Number(
                    neutral.index
                );


            if (
                !entityState.has(
                    entityIndex
                )
            ) {

                continue;
            }


            const health =
                numberField(
                    neutral,
                    'm_iHealth'
                );


            const lifeState =
                numberField(
                    neutral,
                    'm_lifeState'
                );


            // Health is our primary signal.
            //
            // If health is unavailable for some packet,
            // don't manufacture a transition.

            if (
                !Number.isFinite(
                    health
                )
            ) {

                continue;
            }


            const alive =
                health > 0
                &&
                lifeState !== 1;


            const state =
                entityState.get(
                    entityIndex
                );


            const groupId =
                groupByEntity.get(
                    entityIndex
                );


            const runtime =
                groupRuntime.get(
                    groupId
                );


            // =================================================
            // FIRST OBSERVATION
            // =================================================

            if (
                !state.known
            ) {

                state.known =
                    true;

                state.alive =
                    alive;

                state.health =
                    health;

                state.lifeState =
                    lifeState;

                state.lastObservedTick =
                    tick;


                touchedGroups.add(
                    groupId
                );


                continue;
            }


            // =================================================
            // ALIVE -> DEAD
            // =================================================

            if (
                state.alive === true
                &&
                alive === false
            ) {

                const event = {

                    type:
                        'DEATH',

                    entityIndex,

                    groupId,

                    tick,

                    matchTimeSeconds:
                        matchTime,

                    matchClock:
                        formatClock(
                            matchTime
                        ),

                    healthBefore:
                        state.health,

                    healthAfter:
                        health,

                    lifeStateBefore:
                        state.lifeState,

                    lifeStateAfter:
                        lifeState
                };


                entityEvents
                    .get(
                        entityIndex
                    )
                    .push(
                        event
                    );


                runtime
                    .deathEvents
                    .push(
                        event
                    );


                touchedGroups.add(
                    groupId
                );
            }


            // =================================================
            // DEAD -> ALIVE
            //
            // This is the signal we actually care about.
            // =================================================

            if (
                state.alive === false
                &&
                alive === true
            ) {

                const event = {

                    type:
                        'RETURN_TO_ALIVE',

                    entityIndex,

                    groupId,

                    tick,

                    matchTimeSeconds:
                        matchTime,

                    matchClock:
                        formatClock(
                            matchTime
                        ),

                    healthBefore:
                        state.health,

                    healthAfter:
                        health,

                    lifeStateBefore:
                        state.lifeState,

                    lifeStateAfter:
                        lifeState
                };


                entityEvents
                    .get(
                        entityIndex
                    )
                    .push(
                        event
                    );


                runtime
                    .returnEvents
                    .push(
                        event
                    );


                touchedGroups.add(
                    groupId
                );
            }


            state.alive =
                alive;

            state.health =
                health;

            state.lifeState =
                lifeState;

            state.lastObservedTick =
                tick;
        }


        // =====================================================
        // EVALUATE GROUP STATE AFTER ALL ENTITY UPDATES
        //
        // This prevents sequential entity processing within a
        // single tick from manufacturing fake partial states.
        // =====================================================

        for (
            const groupId
            of touchedGroups
        ) {

            evaluateGroup(
                groupId,
                tick,
                matchTime
            );
        }
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');
console.log(
    'Tracking direct neutral health transitions...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// FINAL GROUP AUDITS
// ============================================================

const groupAudits =
    [];


for (
    const group
    of groups
) {

    const runtime =
        groupRuntime.get(
            group.spawnGroupId
        );


    const returnCohorts =
        clusterReturnEvents(
            runtime.returnEvents,
            RETURN_COHORT_TOLERANCE
        );


    const classification =
        classifyGroup(
            group
        );


    const expectedRespawnSeconds =
        expectedRespawn(
            classification
        );


    const fullRespawns =
        runtime.fullRespawns.map(
            event => ({

                ...event,

                expectedRespawnSeconds,

                deltaFromExpectedSeconds:

                    Number.isFinite(
                        expectedRespawnSeconds
                    )

                        ? event.respawnDelaySeconds
                          -
                          expectedRespawnSeconds

                        : null
            })
        );


    groupAudits.push({

        groupId:
            group.spawnGroupId,

        classification,

        firstObservedMatchTimeSeconds:
            group.firstObservedMatchTimeSeconds,

        centroid:
            group.centroid,

        memberCount:
            group.memberCount,

        entityIndexes:
            group.entityIndexes,

        unitTypeCounts:
            group.unitTypeCounts,

        deathEventCount:
            runtime.deathEvents.length,

        returnEventCount:
            runtime.returnEvents.length,

        fullClearCount:
            runtime.fullClears.length,

        fullRespawnCount:
            runtime.fullRespawns.length,

        fullClears:
            runtime.fullClears,

        fullRespawns,

        returnCohorts,

        returnCohortPatterns:
            summarizePatterns(
                returnCohorts
            )
    });
}


// ============================================================
// GLOBAL VALIDATIONS
// ============================================================

const validatedRespawns =
    groupAudits.flatMap(
        group =>
            group.fullRespawns.map(
                event => ({

                    groupId:
                        group.groupId,

                    classification:
                        group.classification,

                    memberCount:
                        group.memberCount,

                    unitTypeCounts:
                        group.unitTypeCounts,

                    centroid:
                        group.centroid,

                    ...event
                })
            )
    );


const byClassification =
    {};


for (
    const classification
    of [
        'SMALL_CAMP_CANDIDATE',
        'MEDIUM_CAMP_CANDIDATE',
        'LARGE_CAMP_CANDIDATE',
        'SINNER_NEUTRAL_CANDIDATE'
    ]
) {

    const matching =
        groupAudits.filter(
            group =>
                group.classification ===
                classification
        );


    const respawns =
        validatedRespawns.filter(
            event =>
                event.classification ===
                classification
        );


    byClassification[
        classification
    ] = {

        groupCount:
            matching.length,

        groupsWithFullClear:
            matching.filter(
                group =>
                    group.fullClearCount > 0
            ).length,

        groupsWithValidatedFullRespawn:
            matching.filter(
                group =>
                    group.fullRespawnCount > 0
            ).length,

        validatedRespawnCount:
            respawns.length,

        respawnDelayStatistics:
            summarize(
                respawns.map(
                    event =>
                        event.respawnDelaySeconds
                )
            )
    };
}


// ============================================================
// ENTITY EVENT OUTPUT
// ============================================================

const entityEventOutput =
    [...entityEvents.entries()]
        .map(
            (
                [
                    entityIndex,
                    events
                ]
            ) => ({

                entityIndex,

                groupId:
                    groupByEntity.get(
                        entityIndex
                    ),

                events
            })
        )
        .filter(
            row =>
                row.events.length > 0
        );


// ============================================================
// OUTPUT
// ============================================================

const output = {

    replay:
        replayName,

    method:
        'direct m_iHealth / m_lifeState transitions on fixed neutral entity slots',

    importantRules: [

        'CREATE events are not used as respawn evidence.',

        'An entity return is defined as observed DEAD -> ALIVE using direct health/life state.',

        'A full camp clear occurs only when every member of the candidate group is dead simultaneously.',

        'A validated full respawn occurs when a fully-dead candidate group later becomes fully alive.',

        'Return cohorts smaller than the geometric group may indicate that the geometric group actually contains multiple camps.'
    ],

    candidateGroupCount:
        groups.length,

    candidateNeutralSlots:
        groupByEntity.size,

    byClassification,

    validatedRespawns,

    groupAudits,

    entityEvents:
        entityEventOutput
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
// CONSOLE SUMMARY
// ============================================================

console.log('');
console.log(
    '===================================='
);
console.log(
    'NEUTRAL HEALTH RESPAWN VALIDATION'
);
console.log(
    '===================================='
);
console.log('');


console.log(
    `Candidate groups: ${groups.length}`
);

console.log(
    `Neutral slots: ${groupByEntity.size}`
);

console.log('');


for (
    const [
        classification,
        summary
    ]
    of Object.entries(
        byClassification
    )
) {

    console.log(
        classification
    );

    console.log(
        `  groups: ${summary.groupCount}`
    );

    console.log(
        `  groups fully cleared: ${summary.groupsWithFullClear}`
    );

    console.log(
        `  groups with validated full respawn: ${summary.groupsWithValidatedFullRespawn}`
    );

    console.log(
        `  validated respawns: ${summary.validatedRespawnCount}`
    );


    const stats =
        summary.respawnDelayStatistics;


    if (
        stats.count > 0
    ) {

        console.log(
            `  respawn delay median: ${stats.median.toFixed(3)}s`
        );

        console.log(
            `  respawn delay min/max: ${stats.min.toFixed(3)} / ${stats.max.toFixed(3)}s`
        );
    }


    console.log('');
}


// ============================================================
// PRINT VALIDATED FULL RESPAWNS
// ============================================================

console.log(
    'VALIDATED FULL CLEAR -> FULL RESPAWN'
);

console.log(
    '------------------------------------'
);


for (
    const event
    of validatedRespawns
) {

    console.log(
        `${event.groupId}` +
        ` ${event.classification}` +
        ` size=${event.memberCount}` +
        ` clear=${event.clearClock}` +
        ` respawn=${event.respawnClock}` +
        ` delay=${event.respawnDelaySeconds.toFixed(3)}s` +
        (
            Number.isFinite(
                event.expectedRespawnSeconds
            )
                ? ` expected=${event.expectedRespawnSeconds}s` +
                  ` error=${event.deltaFromExpectedSeconds.toFixed(3)}s`
                : ''
        )
    );
}


// ============================================================
// PRINT LARGE / AMBIGUOUS MEDIUM GROUPS
// ============================================================

console.log('');
console.log(
    'AMBIGUOUS 5-MINUTE GROUP RETURN PATTERNS'
);

console.log(
    '----------------------------------------'
);


for (
    const group
    of groupAudits
) {

    if (
        group.classification !==
        'MEDIUM_CAMP_CANDIDATE'
        ||
        group.memberCount <= 3
    ) {

        continue;
    }


    console.log('');

    console.log(
        `${group.groupId}` +
        ` size=${group.memberCount}` +
        ` composition=${JSON.stringify(group.unitTypeCounts)}`
    );


    console.log(
        `  full clears: ${group.fullClearCount}`
    );

    console.log(
        `  full respawns: ${group.fullRespawnCount}`
    );


    console.log(
        '  return cohorts:'
    );


    for (
        const pattern
        of group.returnCohortPatterns
    ) {

        console.log(
            `    [${pattern.members.join(', ')}] x${pattern.count}`
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
// GROUP STATE EVALUATION
// ============================================================

function evaluateGroup(
    groupId,
    tick,
    matchTime
) {

    const definition =
        groupDefinition.get(
            groupId
        );


    const runtime =
        groupRuntime.get(
            groupId
        );


    const states =
        definition.entityIndexes.map(
            entityIndex =>
                entityState.get(
                    entityIndex
                )
        );


    // We cannot evaluate the whole group until every member
    // has been observed at least once.

    if (
        states.some(
            state =>
                !state.known
        )
    ) {

        return;
    }


    const allDead =
        states.every(
            state =>
                state.alive === false
        );


    const allAlive =
        states.every(
            state =>
                state.alive === true
        );


    if (
        !runtime.initialized
    ) {

        runtime.initialized =
            true;

        runtime.wasAllDead =
            allDead;

        runtime.wasAllAlive =
            allAlive;


        if (
            allDead
        ) {

            runtime.pendingClear = {

                tick,

                matchTimeSeconds:
                    matchTime,

                matchClock:
                    formatClock(
                        matchTime
                    )
            };
        }


        return;
    }


    // ========================================================
    // FIRST TICK WHERE EVERY MEMBER IS DEAD
    // ========================================================

    if (
        allDead
        &&
        !runtime.wasAllDead
    ) {

        const clear = {

            tick,

            matchTimeSeconds:
                matchTime,

            matchClock:
                formatClock(
                    matchTime
                )
        };


        runtime.fullClears.push(
            clear
        );


        runtime.pendingClear =
            clear;
    }


    // ========================================================
    // AFTER A FULL CLEAR, GROUP BECOMES FULLY ALIVE
    // ========================================================

    if (
        runtime.pendingClear
        &&
        allAlive
        &&
        !runtime.wasAllAlive
    ) {

        const respawn = {

            clearTick:
                runtime
                    .pendingClear
                    .tick,

            clearMatchTimeSeconds:
                runtime
                    .pendingClear
                    .matchTimeSeconds,

            clearClock:
                runtime
                    .pendingClear
                    .matchClock,

            respawnTick:
                tick,

            respawnMatchTimeSeconds:
                matchTime,

            respawnClock:
                formatClock(
                    matchTime
                ),

            respawnDelaySeconds:
                matchTime
                -
                runtime
                    .pendingClear
                    .matchTimeSeconds
        };


        runtime.fullRespawns.push(
            respawn
        );


        runtime.pendingClear =
            null;
    }


    runtime.wasAllDead =
        allDead;

    runtime.wasAllAlive =
        allAlive;
}


// ============================================================
// RETURN COHORTS
// ============================================================

function clusterReturnEvents(
    events,
    tolerance
) {

    const sorted =
        [...events]
            .sort(
                (
                    a,
                    b
                ) =>
                    a.matchTimeSeconds
                    -
                    b.matchTimeSeconds
            );


    const cohorts =
        [];


    for (
        const event
        of sorted
    ) {

        const last =
            cohorts.at(
                -1
            );


        if (
            !last
            ||
            event.matchTimeSeconds
            -
            last.lastTime
            >
            tolerance
        ) {

            cohorts.push({

                timeSeconds:
                    event.matchTimeSeconds,

                firstTime:
                    event.matchTimeSeconds,

                lastTime:
                    event.matchTimeSeconds,

                members:
                    [
                        event.entityIndex
                    ]
            });


            continue;
        }


        last.members.push(
            event.entityIndex
        );


        last.lastTime =
            event.matchTimeSeconds;


        last.timeSeconds =
            (
                last.firstTime
                +
                last.lastTime
            )
            /
            2;
    }


    for (
        const cohort
        of cohorts
    ) {

        cohort.members =
            [...new Set(
                cohort.members
            )]
            .sort(
                (
                    a,
                    b
                ) =>
                    a - b
            );


        cohort.memberCount =
            cohort.members.length;
    }


    return cohorts;
}


// ============================================================
// PATTERN SUMMARY
// ============================================================

function summarizePatterns(
    cohorts
) {

    const patterns =
        new Map();


    for (
        const cohort
        of cohorts
    ) {

        const key =
            cohort.members.join(
                ','
            );


        if (
            !patterns.has(
                key
            )
        ) {

            patterns.set(
                key,
                {
                    members:
                        cohort.members,

                    count:
                        0,

                    times:
                        []
                }
            );
        }


        const pattern =
            patterns.get(
                key
            );


        pattern.count++;

        pattern.times.push(
            cohort.timeSeconds
        );
    }


    return [...patterns.values()]
        .sort(
            (
                a,
                b
            ) =>
                b.count -
                a.count
                ||
                b.members.length -
                a.members.length
        );
}


// ============================================================
// CLASSIFICATION
// ============================================================

function classifyGroup(
    group
) {

    const spawn =
        group.firstObservedMatchTimeSeconds;


    if (
        Math.abs(
            spawn -
            120
        )
        < 2
    ) {

        return 'SMALL_CAMP_CANDIDATE';
    }


    if (
        Math.abs(
            spawn -
            300
        )
        < 2
    ) {

        return 'MEDIUM_CAMP_CANDIDATE';
    }


    if (
        Math.abs(
            spawn -
            480
        )
        < 2
    ) {

        const large =
            group.unitTypeCounts
                ?.LARGE_UNIT
            ??
            0;


        return (
            large > 0
                ? 'LARGE_CAMP_CANDIDATE'
                : 'SINNER_NEUTRAL_CANDIDATE'
        );
    }


    return 'UNKNOWN';
}


function expectedRespawn(
    classification
) {

    if (
        classification ===
        'SMALL_CAMP_CANDIDATE'
    ) {

        return 85;
    }


    if (
        classification ===
        'MEDIUM_CAMP_CANDIDATE'
    ) {

        return 290;
    }


    if (
        classification ===
        'LARGE_CAMP_CANDIDATE'
    ) {

        return 335;
    }


    return null;
}


// ============================================================
// FIELD
// ============================================================

function numberField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    const number =
        Number(
            entity.getField(
                field
            )
        );


    return Number.isFinite(
        number
    )
        ? number
        : null;
}


// ============================================================
// STATS
// ============================================================

function summarize(
    values
) {

    const sorted =
        [...values]

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
        !sorted.length
    ) {

        return {
            count: 0,
            min: null,
            median: null,
            max: null,
            mean: null
        };
    }


    return {

        count:
            sorted.length,

        min:
            sorted[0],

        median:
            percentile(
                sorted,
                0.5
            ),

        max:
            sorted.at(-1),

        mean:
            sorted.reduce(
                (
                    sum,
                    value
                ) =>
                    sum +
                    value,
                0
            )
            /
            sorted.length
    };
}


function percentile(
    sorted,
    p
) {

    const index =
        (
            sorted.length -
            1
        )
        *
        p;


    const low =
        Math.floor(
            index
        );


    const high =
        Math.ceil(
            index
        );


    if (
        low ===
        high
    ) {

        return sorted[
            low
        ];
    }


    const fraction =
        index -
        low;


    return (
        sorted[low]
        *
        (
            1 -
            fraction
        )
    )
    +
    (
        sorted[high]
        *
        fraction
    );
}


// ============================================================
// TIME
// ============================================================

function formatClock(
    seconds
) {

    const negative =
        seconds < 0;


    const value =
        Math.abs(
            seconds
        );


    const minutes =
        Math.floor(
            value /
            60
        );


    const secs =
        Math.floor(
            value %
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