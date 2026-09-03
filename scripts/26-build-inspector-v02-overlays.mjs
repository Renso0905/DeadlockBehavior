import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
} from 'node:fs';

import {
    resolve
} from 'node:path';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


const outputDir =
    resolve(
        'output',
        replayName
    );


const inspectorDataDir =
    resolve(
        'inspector',
        'data',
        replayName
    );


// ============================================================
// INPUT PATHS
// ============================================================

const matchingPath =
    resolve(
        outputDir,
        'fow_neutral_subcohort_matching.json'
    );


const fowRespawnPath =
    resolve(
        outputDir,
        'fow_camp_respawn_validation.json'
    );


const spawnCohortPath =
    resolve(
        outputDir,
        'neutral_spawn_cohorts.json'
    );


const meleePath =
    resolve(
        outputDir,
        'verified_melee_events.jsonl'
    );


const meleeSummaryPath =
    resolve(
        outputDir,
        'melee_verification_summary.json'
    );


const playerSummaryPath =
    resolve(
        outputDir,
        'player_state_summary.json'
    );


// ============================================================
// OUTPUT
// ============================================================

const outputPath =
    resolve(
        inspectorDataDir,
        'v02_overlays.json'
    );


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
    const path
    of [
        matchingPath,
        fowRespawnPath,
        spawnCohortPath,
        meleePath
    ]
) {

    if (
        !existsSync(path)
    ) {

        throw new Error(
            `Missing required file:\n${path}`
        );
    }
}


mkdirSync(
    inspectorDataDir,
    {
        recursive: true
    }
);


// ============================================================
// LOAD
// ============================================================

const matching =
    readJson(
        matchingPath
    );


const fowRespawns =
    readJson(
        fowRespawnPath
    );


const spawnCohorts =
    readJson(
        spawnCohortPath
    );


const meleeSummary =
    existsSync(
        meleeSummaryPath
    )
        ? readJson(
            meleeSummaryPath
        )
        : null;


const playerSummary =
    existsSync(
        playerSummaryPath
    )
        ? readJson(
            playerSummaryPath
        )
        : null;


const rawMeleeEvents =
    readJsonl(
        meleePath
    );


// ============================================================
// MATCH DURATION
// ============================================================

const matchDurationSeconds =
    firstFinite(

        playerSummary
            ?.finalMatchTimeSeconds,

        playerSummary
            ?.summary
            ?.finalMatchTimeSeconds,

        findLatestFowTime(
            fowRespawns
        ),

        0
    );


// ============================================================
// ENTITY -> UNIT TYPE
//
// This fixes an important issue with the earlier geometric
// groups.
//
// SPAWN_0007 and SPAWN_0009 were each two camps merged
// geometrically.
//
// Composition must therefore be calculated from the actual
// entity indexes assigned to each FOW-matched creation
// subcohort, rather than from the original geometry group's
// total composition.
// ============================================================

const unitTypeByEntity =
    new Map();


for (
    const group
    of spawnCohorts.spawnGroups ?? []
) {

    for (
        const member
        of group.members ?? []
    ) {

        const entityIndex =
            toFiniteNumber(
                member.entityIndex
            );


        if (
            entityIndex === null
        ) {

            continue;
        }


        unitTypeByEntity.set(
            entityIndex,
            member.unitType ?? 'UNKNOWN'
        );
    }
}


// ============================================================
// FOW RESPAWN INDEX
// ============================================================

const fowByName =
    new Map(

        (
            fowRespawns.markers
            ??
            []
        )

        .map(
            marker => [

                marker.name,

                marker
            ]
        )
    );


// ============================================================
// BUILD CANONICAL CAMPS
// ============================================================

const camps =
    [];


for (
    const tier
    of [
        'SMALL',
        'MEDIUM',
        'LARGE'
    ]
) {

    const tierResult =
        matching
            .tierResults
            ?.[tier];


    if (
        !tierResult
    ) {

        continue;
    }


    for (
        const match
        of tierResult.matches ?? []
    ) {

        const fow =
            fowByName.get(
                match.markerName
            );


        const members =
            (
                match.cohortEntityIndexes
                ??
                []
            )

            .map(
                entityIndex => {

                    const numericEntityIndex =
                        toFiniteNumber(
                            entityIndex
                        );


                    return {

                        entityIndex:
                            numericEntityIndex
                            ??
                            entityIndex,

                        unitType:
                            numericEntityIndex !== null

                                ? (
                                    unitTypeByEntity.get(
                                        numericEntityIndex
                                    )
                                    ??
                                    'UNKNOWN'
                                )

                                : 'UNKNOWN'
                    };
                }
            );


        const unitComposition =
            countValues(
                members.map(
                    member =>
                        member.unitType
                )
            );


        const intervals =
            buildCampIntervals(
                fow,
                matchDurationSeconds
            );


        const clearEvents =
            (
                fow?.transitions
                ??
                []
            )

            .filter(
                transition =>
                    transition.type ===
                    'BECAME_INACTIVE'
            )

            .map(
                transition => ({

                    timeSeconds:
                        transition
                            .matchTimeSeconds,

                    clock:
                        transition
                            .matchClock
                })
            );


        const respawnEvents =
            (
                fow?.transitions
                ??
                []
            )

            .filter(
                transition => {

                    if (
                        transition.type !==
                        'BECAME_ACTIVE'
                    ) {

                        return false;
                    }


                    const transitionTime =
                        toFiniteNumber(
                            transition
                                .matchTimeSeconds
                        );


                    const firstActive =
                        toFiniteNumber(
                            fow
                                ?.firstActiveTimeSeconds
                        );


                    if (
                        transitionTime ===
                        null
                    ) {

                        return false;
                    }


                    if (
                        firstActive ===
                        null
                    ) {

                        return true;
                    }


                    return (
                        transitionTime >
                        firstActive
                    );
                }
            )

            .map(
                transition => ({

                    timeSeconds:
                        transition
                            .matchTimeSeconds,

                    clock:
                        transition
                            .matchClock
                })
            );


        camps.push({

            // =================================================
            // CANONICAL IDENTITY
            // =================================================

            campId:
                match.markerName,

            name:
                match.markerName,

            tier,


            // =================================================
            // POSITION
            // =================================================

            fowPosition:
                match.markerFowPosition
                ??
                null,

            worldPosition: {

                x:
                    firstFinite(

                        match
                            .markerEstimatedWorldPosition
                            ?.x,

                        match
                            .cohortCentroid
                            ?.x
                    ),

                y:
                    firstFinite(

                        match
                            .markerEstimatedWorldPosition
                            ?.y,

                        match
                            .cohortCentroid
                            ?.y
                    ),

                z:
                    firstFinite(
                        match
                            .cohortCentroid
                            ?.z
                    )
            },

            creepCentroid:
                match.cohortCentroid
                ??
                null,

            fowToCreepDistanceXY:
                firstFinite(
                    match.distanceXY
                ),


            // =================================================
            // MEMBERSHIP
            // =================================================

            memberCount:
                members.length,

            members,

            entityIndexes:
                members.map(
                    member =>
                        member.entityIndex
                ),

            unitComposition,


            // =================================================
            // DISCOVERY PROVENANCE
            // =================================================

            sourceGroupId:
                match.sourceGroupId
                ??
                null,

            sourceSubcohortId:
                match.subcohortId
                ??
                null,

            creationSubcohortIndex:
                firstFinite(
                    match
                        .creationSubcohortIndex
                ),

            originalGeometryGroupSize:
                firstFinite(
                    match
                        .sourceGroupMemberCount
                ),

            originalGeometryStatus:
                match.sourceGroupStatus
                ??
                null,


            // =================================================
            // TIMERS
            // =================================================

            spawnTimeSeconds:
                expectedSpawn(
                    tier
                ),

            respawnDurationSeconds:
                expectedRespawn(
                    tier
                ),

            observedFirstActiveTimeSeconds:
                firstFinite(
                    fow
                        ?.firstActiveTimeSeconds
                ),

            observedFirstActiveClock:
                fow
                    ?.firstActiveClock
                ??
                null,


            // =================================================
            // FOW STATE HISTORY
            // =================================================

            fowIndex:
                firstFinite(
                    fow?.fowIndex
                ),

            clearEvents,

            respawnEvents,

            validatedRespawnCycles:
                fow?.cycles
                ??
                [],

            validatedRespawnCycleCount:
                firstFinite(
                    fow
                        ?.exactLikeCycleCount
                )
                ??
                0,

            intervals
        });
    }
}


// ============================================================
// SORT CAMPS
// ============================================================

const tierOrder =
    {
        SMALL: 1,
        MEDIUM: 2,
        LARGE: 3
    };


camps.sort(
    (
        a,
        b
    ) =>

        (
            tierOrder[a.tier]
            ??
            99
        )

        -

        (
            tierOrder[b.tier]
            ??
            99
        )

        ||

        a.name.localeCompare(
            b.name
        )
);


// ============================================================
// MELEE EVENTS
//
// Direct attack type comes from:
// CCitadel_Ability_HoldMelee
//
// firstObservedMatchTimeSeconds is our canonical replay time.
//
// attackTriggeredTime is retained only as the raw internal
// ability/server time.
// ============================================================

const meleeEvents =
    rawMeleeEvents

        .map(
            (
                event,
                index
            ) =>
                normalizeMeleeEvent(
                    event,
                    index
                )
        )

        .filter(
            event =>
                Number.isFinite(
                    event.timeSeconds
                )
        )

        .sort(
            (
                a,
                b
            ) =>
                a.timeSeconds -
                b.timeSeconds
        );


// ============================================================
// MELEE COUNTS
// ============================================================

const meleeByType =
    countValues(
        meleeEvents.map(
            event =>
                event.attackType
                ??
                'UNKNOWN'
        )
    );


const meleeByPlayer =
    {};


for (
    const event
    of meleeEvents
) {

    const name =
        event.playerName
        ??
        'UNKNOWN';


    if (
        !meleeByPlayer[name]
    ) {

        meleeByPlayer[name] =
            {
                total: 0,
                hits: 0,
                whiffs: 0,
                unknownHitState: 0,
                byType: {}
            };
    }


    const row =
        meleeByPlayer[name];


    row.total++;


    if (
        event.hit === true
    ) {

        row.hits++;

    } else if (
        event.hit === false
    ) {

        row.whiffs++;

    } else {

        row.unknownHitState++;
    }


    const type =
        event.attackType
        ??
        'UNKNOWN';


    row.byType[type] =
        (
            row.byType[type]
            ??
            0
        )
        +
        1;
}


// ============================================================
// CAMP COUNTS
// ============================================================

const campCounts =
    countValues(
        camps.map(
            camp =>
                camp.tier
        )
    );


// ============================================================
// VALIDATION
// ============================================================

const expectedDirectMeleeEvents =
    firstFinite(
        meleeSummary
            ?.totalDirectAttacks
    );


const validation =
    {

        // =====================================================
        // CAMPS
        // =====================================================

        campCount:
            camps.length,

        expectedCampCount:
            40,

        campCounts,

        expectedCampCounts:
            {
                SMALL: 4,
                MEDIUM: 24,
                LARGE: 12
            },

        campsPass:
            (
                camps.length ===
                40

                &&

                campCounts.SMALL ===
                4

                &&

                campCounts.MEDIUM ===
                24

                &&

                campCounts.LARGE ===
                12
            ),

        campsWithValidatedRespawnCycle:
            camps.filter(
                camp =>
                    camp
                        .validatedRespawnCycleCount
                    >
                    0
            ).length,


        // =====================================================
        // MELEE
        // =====================================================

        meleeEventCount:
            meleeEvents.length,

        expectedDirectMeleeEvents,

        meleeCountPass:
            expectedDirectMeleeEvents ===
            null

                ? null

                : (
                    meleeEvents.length ===
                    expectedDirectMeleeEvents
                ),


        expectedMeleeByType:
            meleeSummary
                ?.attacksByType
            ??
            null,

        actualMeleeByType:
            meleeByType,

        meleeTypeCountsPass:
            meleeSummary
                ?.attacksByType

                ? compareCounts(
                    meleeByType,
                    meleeSummary
                        .attacksByType
                )

                : null
    };


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        schemaVersion:
            2,

        inspectorVersion:
            '0.2',

        replay:
            replayName,


        // =====================================================
        // INPUT PROVENANCE
        // =====================================================

        generatedFrom: {

            camps:
                [
                    'fow_neutral_subcohort_matching.json',
                    'fow_camp_respawn_validation.json',
                    'neutral_spawn_cohorts.json'
                ],

            melee:
                [
                    'verified_melee_events.jsonl',
                    'melee_verification_summary.json'
                ]
        },


        // =====================================================
        // MODELING RULES
        // =====================================================

        modelingRules: {

            campIdentity:
                'CCitadelTeam FOW marker name',

            campTier:
                'FOW eClass-derived Small/Medium/Large tier',

            campAvailability:
                'FOW active/inactive state',

            campClear:
                'FOW BECAME_INACTIVE',

            campRespawn:
                'FOW BECAME_ACTIVE after initial spawn',

            campMembership:
                'FOW marker matched to same-tier neutral creation subcohort by calibrated minimap/world position',

            campFinalInterval:
                'If a camp is cleared when the replay ends, next availability is predicted from clear time + validated tier timer',

            meleeType:
                'Direct CCitadel_Ability_HoldMelee attack type',

            meleeMatchTime:
                'firstObservedMatchTimeSeconds',

            meleeRawServerTime:
                'attackTriggeredTime',

            meleeInputHold:
                'Retained as behavioral charge/input feature only; not authoritative attack classification'
        },


        // =====================================================
        // MATCH
        // =====================================================

        match: {

            durationSeconds:
                matchDurationSeconds,

            durationClock:
                formatClock(
                    matchDurationSeconds
                )
        },


        // =====================================================
        // SUMMARY
        // =====================================================

        summary: {

            camps: {

                total:
                    camps.length,

                byTier:
                    campCounts,

                withValidatedRespawnCycle:
                    validation
                        .campsWithValidatedRespawnCycle
            },


            melee: {

                total:
                    meleeEvents.length,

                byType:
                    meleeByType,

                byPlayer:
                    meleeByPlayer,

                sourceSummary:
                    meleeSummary
            }
        },


        // =====================================================
        // VALIDATION
        // =====================================================

        validation,


        // =====================================================
        // DATA
        // =====================================================

        camps,

        meleeEvents
    };


// ============================================================
// WRITE
// ============================================================

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
    'INSPECTOR V0.2 OVERLAY DATA'
);

console.log(
    '===================================='
);

console.log('');


console.log(
    `Replay: ${replayName}`
);


console.log(
    `Match duration: ${
        formatClock(
            matchDurationSeconds
        )
    }`
);


console.log('');


// ============================================================
// CAMP SUMMARY
// ============================================================

console.log(
    `Camps: ${camps.length}`
);


console.log(
    `  Small: ${
        campCounts.SMALL
        ??
        0
    }`
);


console.log(
    `  Medium: ${
        campCounts.MEDIUM
        ??
        0
    }`
);


console.log(
    `  Large: ${
        campCounts.LARGE
        ??
        0
    }`
);


console.log(
    `  With validated respawn cycles: ${
        validation
            .campsWithValidatedRespawnCycle
    }`
);


console.log(
    `  Validation: ${
        validation.campsPass
            ? 'PASS'
            : 'FAIL'
    }`
);


console.log('');


// ============================================================
// MELEE SUMMARY
// ============================================================

console.log(
    `Direct melee events: ${
        meleeEvents.length
    }`
);


console.log(
    `  LIGHT: ${
        meleeByType.LIGHT
        ??
        0
    }`
);


console.log(
    `  HEAVY: ${
        meleeByType.HEAVY
        ??
        0
    }`
);


console.log(
    `  HEAVY_AIR: ${
        meleeByType.HEAVY_AIR
        ??
        0
    }`
);


console.log(
    `  SLIDE: ${
        meleeByType.SLIDE
        ??
        0
    }`
);


console.log(
    `  UNKNOWN: ${
        meleeByType.UNKNOWN
        ??
        0
    }`
);


if (
    validation.meleeCountPass !==
    null
) {

    console.log(
        `  Count validation: ${
            validation.meleeCountPass
                ? 'PASS'
                : 'FAIL'
        }`
    );
}


if (
    validation.meleeTypeCountsPass !==
    null
) {

    console.log(
        `  Type-count validation: ${
            validation.meleeTypeCountsPass
                ? 'PASS'
                : 'FAIL'
        }`
    );
}


// ============================================================
// PREGAME MELEE
// ============================================================

const pregameMeleeCount =
    meleeEvents.filter(
        event =>
            event.timeSeconds <
            0
    ).length;


const matchMeleeCount =
    meleeEvents.filter(
        event =>
            event.timeSeconds >=
            0
    ).length;


console.log('');

console.log(
    `  Pregame melee events: ${
        pregameMeleeCount
    }`
);


console.log(
    `  Match-time melee events: ${
        matchMeleeCount
    }`
);


// ============================================================
// INPUT MATCH SUMMARY
// ============================================================

const meleeWithInputMatch =
    meleeEvents.filter(
        event =>
            event.inputMatched
    ).length;


console.log(
    `  With matched raw input: ${
        meleeWithInputMatch
    }`
);


console.log('');
console.log(
    `Output:\n${outputPath}`
);
console.log('');


// ============================================================
// CAMP INTERVALS
// ============================================================

function buildCampIntervals(
    marker,
    matchDuration
) {

    if (
        !marker
    ) {

        return [];
    }


    const intervals =
        [];


    const firstActive =
        toFiniteNumber(
            marker.firstActiveTimeSeconds
        );


    const expectedRespawnSeconds =
        toFiniteNumber(
            marker.expectedRespawnSeconds
        );


    // ========================================================
    // NOT YET SPAWNED
    // ========================================================

    if (
        firstActive !==
        null
        &&
        firstActive >
        0
    ) {

        intervals.push({

            state:
                'NOT_SPAWNED',

            startTimeSeconds:
                0,

            endTimeSeconds:
                firstActive,

            nextAvailabilityTimeSeconds:
                firstActive,

            availabilityTimeSource:
                'OBSERVED_INITIAL_SPAWN'
        });
    }


    // ========================================================
    // INITIAL STATE
    // ========================================================

    let state =
        firstActive !==
        null

            ? 'AVAILABLE'

            : 'NOT_SPAWNED';


    let start =
        firstActive !==
        null

            ? firstActive

            : 0;


    const transitions =
        (
            marker.transitions
            ??
            []
        )

        .filter(
            transition =>
                toFiniteNumber(
                    transition.matchTimeSeconds
                )
                !==
                null
        )

        .sort(
            (
                a,
                b
            ) =>

                a.matchTimeSeconds
                -
                b.matchTimeSeconds
        );


    // ========================================================
    // TRANSITIONS
    // ========================================================

    for (
        const transition
        of transitions
    ) {

        const time =
            toFiniteNumber(
                transition.matchTimeSeconds
            );


        if (
            time ===
            null
        ) {

            continue;
        }


        // Initial BECAME_ACTIVE is already represented by
        // firstActive.

        if (
            time <=
            start
        ) {

            continue;
        }


        const nextState =
            transition.type ===
            'BECAME_ACTIVE'

                ? 'AVAILABLE'

                : transition.type ===
                  'BECAME_INACTIVE'

                    ? 'CLEARED'

                    : null;


        if (
            !nextState
            ||
            nextState ===
            state
        ) {

            continue;
        }


        const interval =
            {

                state,

                startTimeSeconds:
                    start,

                endTimeSeconds:
                    time,

                nextAvailabilityTimeSeconds:
                    null,

                availabilityTimeSource:
                    null
            };


        // ====================================================
        // COMPLETED CLEARED INTERVAL
        //
        // If this interval ends because the FOW marker became
        // active again, we directly observed the respawn.
        // ====================================================

        if (
            state ===
            'CLEARED'
            &&
            nextState ===
            'AVAILABLE'
        ) {

            interval.nextAvailabilityTimeSeconds =
                time;


            interval.availabilityTimeSource =
                'OBSERVED_RESPAWN';
        }


        intervals.push(
            interval
        );


        state =
            nextState;


        start =
            time;
    }


    // ========================================================
    // FINAL INTERVAL
    // ========================================================

    if (
        Number.isFinite(
            matchDuration
        )
        &&
        matchDuration >
        start
    ) {

        const finalInterval =
            {

                state,

                startTimeSeconds:
                    start,

                endTimeSeconds:
                    matchDuration,

                nextAvailabilityTimeSeconds:
                    null,

                availabilityTimeSource:
                    null
            };


        // ====================================================
        // MATCH ENDS WHILE CAMP IS CLEARED
        //
        // We cannot observe the actual later respawn because
        // the replay ended.
        //
        // Use:
        //
        // clear time + validated tier timer
        //
        // instead of incorrectly using match end as the
        // respawn time.
        // ====================================================

        if (
            state ===
            'CLEARED'
            &&
            expectedRespawnSeconds !==
            null
        ) {

            finalInterval.nextAvailabilityTimeSeconds =
                start
                +
                expectedRespawnSeconds;


            finalInterval.availabilityTimeSource =
                'PREDICTED_FROM_TIMER';
        }


        intervals.push(
            finalInterval
        );
    }


    return intervals;
}


// ============================================================
// NORMALIZE MELEE
// ============================================================

function normalizeMeleeEvent(
    event,
    index
) {

    // ========================================================
    // CANONICAL MATCH TIME
    //
    // firstObservedMatchTimeSeconds is the direct attack's
    // timestamp on the replay match clock.
    //
    // attackTriggeredTime is NOT the same clock. Preserve it
    // separately for diagnostics only.
    // ========================================================

    const timeSeconds =
        firstFinite(

            event
                .firstObservedMatchTimeSeconds,

            event
                .hitObservedMatchTimeSeconds,

            event
                .inputMatch
                ?.estimatedActionMatchTimeSeconds,

            event
                .inputMatch
                ?.releaseMatchTimeSeconds,

            event
                .inputMatch
                ?.pressMatchTimeSeconds
        );


    // ========================================================
    // POSITION
    // ========================================================

    const position =
        firstPosition(

            event.attackPosition,

            event.hitPosition
        );


    // ========================================================
    // RAW INPUT MATCH
    // ========================================================

    const inputMatch =
        (
            event.inputMatch
            &&
            typeof event.inputMatch ===
            'object'
        )

            ? event.inputMatch

            : null;


    return {

        // =====================================================
        // IDENTITY
        // =====================================================

        eventId:
            `MELEE_${String(
                index + 1
            ).padStart(
                5,
                '0'
            )}`,

        sourceKey:
            event.key
            ??
            null,

        abilityEntityIndex:
            firstFinite(
                event.abilityEntityIndex
            ),

        ownerHandle:
            firstFinite(
                event.ownerHandle
            ),

        pawnEntityIndex:
            firstFinite(
                event.pawnEntityIndex
            ),

        controllerEntityIndex:
            firstFinite(
                event.controllerEntityIndex
            ),


        // =====================================================
        // PLAYER
        // =====================================================

        playerName:
            firstString(
                event.playerName
            ),

        heroId:
            firstFinite(
                event.heroId
            ),

        team:
            firstFinite(
                event.team
            ),


        // =====================================================
        // CANONICAL REPLAY TIME
        // =====================================================

        timeSeconds,

        clock:
            Number.isFinite(
                timeSeconds
            )

                ? formatClock(
                    timeSeconds
                )

                : null,

        firstObservedTick:
            firstFinite(
                event.firstObservedTick
            ),

        firstObservedMatchTimeSeconds:
            firstFinite(
                event
                    .firstObservedMatchTimeSeconds
            ),

        firstObservedClock:
            firstString(
                event.firstObservedClock
            ),


        // =====================================================
        // RAW INTERNAL ABILITY TIME
        // =====================================================

        attackTriggeredTime:
            firstFinite(
                event.attackTriggeredTime
            ),


        // =====================================================
        // DIRECT EXECUTED ATTACK
        // =====================================================

        attackType:
            firstString(
                event.attackType
            ),

        attackTypeCode:
            firstFinite(
                event.attackTypeCode
            ),

        firstAttackState:
            firstString(
                event.firstAttackState
            ),

        firstAttackStateCode:
            firstFinite(
                event.firstAttackStateCode
            ),

        position,


        // =====================================================
        // HIT STATE
        // =====================================================

        hit:
            firstBoolean(
                event.hit
            ),

        hitObservedTick:
            firstFinite(
                event.hitObservedTick
            ),

        hitObservedMatchTimeSeconds:
            firstFinite(
                event
                    .hitObservedMatchTimeSeconds
            ),

        hitObservedClock:
            firstString(
                event.hitObservedClock
            ),

        hitPosition:
            firstPosition(
                event.hitPosition
            ),


        // =====================================================
        // RAW INPUT MATCH
        //
        // Retain this for behavior analysis.
        //
        // DO NOT use it as the final Light/Heavy classifier.
        // =====================================================

        inputMatched:
            inputMatch !==
            null,

        inputHoldCategory:
            firstString(
                inputMatch
                    ?.classification
            ),

        inputHoldSeconds:
            firstFinite(
                inputMatch
                    ?.holdSeconds
            ),

        inputPressTimeSeconds:
            firstFinite(
                inputMatch
                    ?.pressMatchTimeSeconds
            ),

        inputReleaseTimeSeconds:
            firstFinite(
                inputMatch
                    ?.releaseMatchTimeSeconds
            ),

        inputEstimatedActionTimeSeconds:
            firstFinite(
                inputMatch
                    ?.estimatedActionMatchTimeSeconds
            ),

        inputMatchDeltaSeconds:
            firstFinite(
                inputMatch
                    ?.absoluteDeltaSeconds
            )
    };
}


// ============================================================
// JSON HELPERS
// ============================================================

function readJson(
    path
) {

    return JSON.parse(
        readFileSync(
            path,
            'utf8'
        )
    );
}


function readJsonl(
    path
) {

    const text =
        readFileSync(
            path,
            'utf8'
        );


    if (
        !text.trim()
    ) {

        return [];
    }


    return text

        .split(
            /\r?\n/
        )

        .map(
            line =>
                line.trim()
        )

        .filter(
            Boolean
        )

        .map(
            (
                line,
                index
            ) => {

                try {

                    return JSON.parse(
                        line
                    );

                } catch (
                    error
                ) {

                    throw new Error(

                        `Invalid JSONL at line ${
                            index + 1
                        } in ${path}\n${error.message}`
                    );
                }
            }
        );
}


// ============================================================
// POSITION
// ============================================================

function firstPosition(
    ...values
) {

    for (
        const value
        of values
    ) {

        if (
            !value
            ||
            typeof value !==
            'object'
        ) {

            continue;
        }


        const x =
            toFiniteNumber(
                value.x
            );


        const y =
            toFiniteNumber(
                value.y
            );


        const z =
            toFiniteNumber(
                value.z
            );


        if (
            x !==
            null
            &&
            y !==
            null
        ) {

            return {

                x,

                y,

                z
            };
        }
    }


    return null;
}


// ============================================================
// VALUE HELPERS
// ============================================================

function toFiniteNumber(
    value
) {

    // Important:
    //
    // Number(null) === 0
    //
    // which would silently corrupt optional telemetry fields.
    //
    // Explicitly reject null/undefined/empty string first.

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


function firstFinite(
    ...values
) {

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


    return null;
}


function firstString(
    ...values
) {

    for (
        const value
        of values
    ) {

        if (
            typeof value ===
            'string'
            &&
            value.length >
            0
        ) {

            return value;
        }
    }


    return null;
}


function firstBoolean(
    ...values
) {

    for (
        const value
        of values
    ) {

        if (
            typeof value ===
            'boolean'
        ) {

            return value;
        }
    }


    return null;
}


// ============================================================
// CAMP TIMER HELPERS
// ============================================================

function expectedSpawn(
    tier
) {

    if (
        tier ===
        'SMALL'
    ) {

        return 120;
    }


    if (
        tier ===
        'MEDIUM'
    ) {

        return 300;
    }


    if (
        tier ===
        'LARGE'
    ) {

        return 480;
    }


    return null;
}


function expectedRespawn(
    tier
) {

    if (
        tier ===
        'SMALL'
    ) {

        return 85;
    }


    if (
        tier ===
        'MEDIUM'
    ) {

        return 290;
    }


    if (
        tier ===
        'LARGE'
    ) {

        return 335;
    }


    return null;
}


// ============================================================
// FOW TIME
// ============================================================

function findLatestFowTime(
    data
) {

    let latest =
        0;


    for (
        const marker
        of data.markers ?? []
    ) {

        const firstActive =
            toFiniteNumber(
                marker.firstActiveTimeSeconds
            );


        if (
            firstActive !==
            null
        ) {

            latest =
                Math.max(
                    latest,
                    firstActive
                );
        }


        for (
            const transition
            of marker.transitions ?? []
        ) {

            const time =
                toFiniteNumber(
                    transition.matchTimeSeconds
                );


            if (
                time !==
                null
            ) {

                latest =
                    Math.max(
                        latest,
                        time
                    );
            }
        }
    }


    return latest;
}


// ============================================================
// COUNT
// ============================================================

function countValues(
    values
) {

    const output =
        {};


    for (
        const value
        of values
    ) {

        const key =
            String(
                value
            );


        output[key] =
            (
                output[key]
                ??
                0
            )
            +
            1;
    }


    return output;
}


// ============================================================
// COUNT COMPARISON
// ============================================================

function compareCounts(
    actual,
    expected
) {

    const keys =
        new Set([

            ...Object.keys(
                actual
                ??
                {}
            ),

            ...Object.keys(
                expected
                ??
                {}
            )
        ]);


    for (
        const key
        of keys
    ) {

        if (
            (
                actual?.[key]
                ??
                0
            )
            !==
            (
                expected?.[key]
                ??
                0
            )
        ) {

            return false;
        }
    }


    return true;
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

        return '—';
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
        )
        .padStart(
            2,
            '0'
        )
    );
}