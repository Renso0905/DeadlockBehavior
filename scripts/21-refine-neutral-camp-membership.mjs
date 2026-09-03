import {
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


// Creation times inside one spatial blob occasionally differ
// by only a few ticks.
//
// We only call them distinct creation subcohorts when the
// separation is > 0.05 sec.

const CREATE_SUBCOHORT_TOLERANCE =
    0.05;


// The replay detects full respawns one tick after the nominal
// timer:
//
// 85.015625
// 290.015625
// 335.015625
//
// Give ourselves 0.05 sec tolerance.

const TIMER_TOLERANCE =
    0.05;


// Used only to find approximately 180-degree mirrored groups.

const MIRROR_MAX_ERROR_XY =
    500;


// ============================================================
// PATHS
// ============================================================

const spawnPath =
    resolve(
        'output',
        replayName,
        'neutral_spawn_cohorts.json'
    );


const healthPath =
    resolve(
        'output',
        replayName,
        'neutral_health_respawn_validation.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'neutral_camp_membership_refinement.json'
    );


// ============================================================
// LOAD
// ============================================================

const spawnData =
    JSON.parse(
        readFileSync(
            spawnPath,
            'utf8'
        )
    );


const healthData =
    JSON.parse(
        readFileSync(
            healthPath,
            'utf8'
        )
    );


const spawnGroups =
    spawnData.spawnGroups;


const healthAudits =
    healthData.groupAudits;


// ============================================================
// INDEXES
// ============================================================

const healthByGroup =
    new Map(
        healthAudits.map(
            group => [
                group.groupId,
                group
            ]
        )
    );


const entityEvents =
    new Map(
        healthData.entityEvents.map(
            row => [
                Number(
                    row.entityIndex
                ),
                row.events
            ]
        )
    );


// ============================================================
// REFINE EACH GEOMETRIC GROUP
// ============================================================

const refinements =
    spawnGroups.map(
        refineGroup
    );


// ============================================================
// MIRROR EVIDENCE
//
// Several map resources occur in rotationally symmetric pairs.
//
// This is SUPPORTING evidence only.
// It never changes membership by itself.
// ============================================================

for (
    const group
    of refinements
) {

    group.mirrorEvidence =
        findMirror(
            group,
            refinements
        );
}


// ============================================================
// SECOND-PASS STATUS
//
// A group with unresolved conflicting evidence can borrow some
// support from a strongly matching mirror, but mirror evidence
// never upgrades something to VALIDATED.
// ============================================================

for (
    const group
    of refinements
) {

    if (
        group.status !==
        'UNRESOLVED_CONFLICTING_SUBSET_SIGNAL'
    ) {

        continue;
    }


    const mirrorId =
        group.mirrorEvidence
            ?.mirrorGroupId;


    if (
        !mirrorId
    ) {

        continue;
    }


    const mirror =
        refinements.find(
            candidate =>
                candidate.groupId ===
                mirrorId
        );


    if (
        !mirror
    ) {

        continue;
    }


    if (
        mirror
            .creationSubcohortSizes
            .join(',')
        ===
        group
            .creationSubcohortSizes
            .join(',')
    ) {

        group.mirrorEvidence
            .matchingCreationStructure =
            true;
    }


    if (
        mirror.status ===
        'UNRESOLVED_CONFLICTING_SUBSET_SIGNAL'
    ) {

        group.notes.push(
            'Mirrored group shows the same unresolved multi-subcohort structure.'
        );
    }
}


// ============================================================
// REGULAR / SPECIAL
// ============================================================

const regularGroups =
    refinements.filter(
        group =>
            group.baseClassification !==
            'SINNER_NEUTRAL_CANDIDATE'
    );


const sinnerGroups =
    refinements.filter(
        group =>
            group.baseClassification ===
            'SINNER_NEUTRAL_CANDIDATE'
    );


// ============================================================
// SUMMARY
// ============================================================

const summary = {

    geometricGroupCount:
        refinements.length,

    regularGeometricGroupCount:
        regularGroups.length,

    sinnerAssociatedGroupCount:
        sinnerGroups.length,

    byBaseClassification:
        countValues(
            refinements.map(
                group =>
                    group.baseClassification
            )
        ),

    byStatus:
        countValues(
            refinements.map(
                group =>
                    group.status
            )
        ),

    mediumGeometricGroupCount:
        refinements.filter(
            group =>
                group.baseClassification ===
                'MEDIUM_CAMP_CANDIDATE'
        ).length,

    mediumGroupsByStatus:
        countValues(
            refinements

                .filter(
                    group =>
                        group.baseClassification ===
                        'MEDIUM_CAMP_CANDIDATE'
                )

                .map(
                    group =>
                        group.status
                )
        ),

    validatedSingleCampCount:
        refinements.filter(
            group =>
                group.status ===
                'VALIDATED_SINGLE_CAMP'
        ).length,

    probableSingleCampCount:
        refinements.filter(
            group =>
                group.status ===
                'PROBABLE_SINGLE_CAMP'
        ).length,

    validatedSplitCount:
        refinements.filter(
            group =>
                group.status ===
                'VALIDATED_SPLIT'
        ).length,

    unresolvedConflictingCount:
        refinements.filter(
            group =>
                group.status ===
                'UNRESOLVED_CONFLICTING_SUBSET_SIGNAL'
        ).length
};


// ============================================================
// OUTPUT
// ============================================================

const output = {

    replay:
        replayName,

    method: [
        'initial spawn-time cohort',
        'XY/Z spatial geometry',
        'direct health/life-state transitions',
        'full-group tier-timer validation',
        'creation-time subcohorts',
        'proper-subset tier-timer diagnostics',
        'map rotational symmetry'
    ],

    rules: {

        validatedSingleCamp:
            'The full geometric group was observed fully dead and the entire group returned after the exact expected camp timer.',

        probableSingleCamp:
            'No direct full-cycle validation was observed, but the group has coherent geometry/creation structure and no strong evidence requiring a split.',

        validatedSplit:
            'At least two disjoint proper subsets independently demonstrate exact tier-timer cycles. This is intentionally difficult to achieve.',

        unresolvedConflictingSubsetSignal:
            'A proper creation-time subset demonstrates an exact tier-timer cycle, but evidence is insufficient to prove the full geometric group should be split.',

        sinnerSpecial:
            '8-minute neutral group without a Large unit. Handle jointly with nearby Sinner state rather than applying ordinary camp logic.'
    },

    importantCaution:
        'Replay/PVS behavior can cause incomplete or misleading individual DEAD -> ALIVE observations. Full-group synchronized timer validation is weighted much more strongly than isolated subset returns.',

    summary,

    groups:
        refinements
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
// CONSOLE
// ============================================================

console.log('');
console.log(
    '===================================='
);
console.log(
    'NEUTRAL CAMP MEMBERSHIP REFINEMENT'
);
console.log(
    '===================================='
);
console.log('');


console.log(
    `Geometric groups: ${summary.geometricGroupCount}`
);

console.log(
    `Regular groups: ${summary.regularGeometricGroupCount}`
);

console.log(
    `Sinner-associated groups: ${summary.sinnerAssociatedGroupCount}`
);

console.log('');

console.log(
    `Medium geometric groups: ${summary.mediumGeometricGroupCount}`
);

console.log('');

console.log(
    'Status counts:'
);


for (
    const [
        status,
        count
    ]
    of Object.entries(
        summary.byStatus
    )
) {

    console.log(
        `  ${status}: ${count}`
    );
}


// ============================================================
// PRINT MEDIUM GROUPS
// ============================================================

console.log('');
console.log(
    'MEDIUM CAMP MEMBERSHIP'
);
console.log(
    '----------------------'
);


for (
    const group
    of refinements.filter(
        value =>
            value.baseClassification ===
            'MEDIUM_CAMP_CANDIDATE'
    )
) {

    console.log('');

    console.log(
        `${group.groupId}` +
        ` size=${group.memberCount}` +
        ` -> ${group.status}`
    );


    console.log(
        `  members: ${group.entityIndexes.join(', ')}`
    );


    console.log(
        `  composition: ${JSON.stringify(group.unitTypeCounts)}`
    );


    console.log(
        `  create subcohorts: ${JSON.stringify(group.creationSubcohortEntityIndexes)}`
    );


    if (
        group.fullGroupExactRespawnCount >
        0
    ) {

        console.log(
            `  exact full-group respawns: ${group.fullGroupExactRespawnCount}`
        );
    }


    if (
        group.properSubsetTimerSignals.length
    ) {

        console.log(
            '  proper-subset timer signals:'
        );


        for (
            const signal
            of group.properSubsetTimerSignals
        ) {

            console.log(
                `    [${signal.entityIndexes.join(', ')}]` +
                ` cycles=${signal.exactTimerCycleCount}`
            );


            for (
                const cycle
                of signal.exactTimerCycles
            ) {

                console.log(
                    `      clear=${formatClock(cycle.clearTimeSeconds)}` +
                    ` return=${formatClock(cycle.returnTimeSeconds)}` +
                    ` delay=${cycle.delaySeconds.toFixed(3)}s`
                );
            }
        }
    }


    if (
        group.mirrorEvidence
    ) {

        console.log(
            `  mirror: ${group.mirrorEvidence.mirrorGroupId}` +
            ` error=${group.mirrorEvidence.rotation180ErrorXY.toFixed(1)}`
        );
    }
}


// ============================================================
// PRINT VALIDATED SINGLES
// ============================================================

console.log('');
console.log(
    'VALIDATED NON-3-UNIT CAMPS'
);
console.log(
    '--------------------------'
);


for (
    const group
    of refinements
) {

    if (
        group.status ===
        'VALIDATED_SINGLE_CAMP'
        &&
        group.memberCount !==
        3
    ) {

        console.log(
            `${group.groupId}` +
            ` size=${group.memberCount}` +
            ` composition=${JSON.stringify(group.unitTypeCounts)}` +
            ` exactRespawns=${group.fullGroupExactRespawnCount}`
        );
    }
}


// ============================================================
// PRINT UNRESOLVED
// ============================================================

console.log('');
console.log(
    'UNRESOLVED / CONFLICTING'
);
console.log(
    '------------------------'
);


for (
    const group
    of refinements
) {

    if (
        group.status ===
        'UNRESOLVED_CONFLICTING_SUBSET_SIGNAL'
        ||
        group.status ===
        'VALIDATED_SPLIT'
    ) {

        console.log('');

        console.log(
            `${group.groupId} -> ${group.status}`
        );

        console.log(
            `  members: ${group.entityIndexes.join(', ')}`
        );

        console.log(
            `  create subcohorts: ${JSON.stringify(group.creationSubcohortEntityIndexes)}`
        );

        console.log(
            `  exact subset signals: ${group.properSubsetTimerSignals.length}`
        );
    }
}


console.log('');
console.log(
    `Output:\n${outputPath}`
);
console.log('');


// ============================================================
// REFINE GROUP
// ============================================================

function refineGroup(
    spawnGroup
) {

    const audit =
        healthByGroup.get(
            spawnGroup.spawnGroupId
        );


    const baseClassification =
        audit
            ?.classification
        ??
        classifyFromSpawn(
            spawnGroup
        );


    const expectedTimerSeconds =
        expectedTimer(
            baseClassification
        );


    // ========================================================
    // FULL-GROUP VALIDATION
    // ========================================================

    const fullGroupExactRespawns =
        (
            audit?.fullRespawns
            ??
            []
        )
        .filter(
            respawn =>
                isExactTimer(
                    respawn.respawnDelaySeconds,
                    expectedTimerSeconds
                )
        );


    // ========================================================
    // CREATION SUBCOHORTS
    // ========================================================

    const creationSubcohorts =
        buildCreationSubcohorts(
            spawnGroup.members,
            CREATE_SUBCOHORT_TOLERANCE
        );


    // ========================================================
    // TEST PROPER CREATION SUBCOHORTS
    //
    // A subcohort is diagnostic only unless multiple disjoint
    // subsets independently validate.
    // ========================================================

    const properSubsetTimerSignals =
        [];


    for (
        const subcohort
        of creationSubcohorts
    ) {

        if (
            subcohort.members.length ===
            spawnGroup.members.length
        ) {

            continue;
        }


        if (
            subcohort.members.length <
            2
        ) {

            continue;
        }


        if (
            !Number.isFinite(
                expectedTimerSeconds
            )
        ) {

            continue;
        }


        const cycles =
            evaluateSubsetCycles(

                subcohort.members.map(
                    member =>
                        member.entityIndex
                ),

                spawnGroup
                    .firstObservedMatchTimeSeconds,

                expectedTimerSeconds
            );


        const exactCycles =
            cycles.filter(
                cycle =>
                    cycle.exactTimer
            );


        if (
            exactCycles.length
        ) {

            properSubsetTimerSignals.push({

                createTimeMin:
                    subcohort.minCreateTime,

                createTimeMax:
                    subcohort.maxCreateTime,

                entityIndexes:
                    subcohort.members.map(
                        member =>
                            member.entityIndex
                    ),

                memberCount:
                    subcohort.members.length,

                exactTimerCycleCount:
                    exactCycles.length,

                exactTimerCycles:
                    exactCycles,

                allObservedCycles:
                    cycles
            });
        }
    }


    // ========================================================
    // CAN WE ACTUALLY VALIDATE A SPLIT?
    //
    // Require two DISJOINT proper subsets to each independently
    // demonstrate at least one exact tier-timer cycle.
    //
    // This intentionally sets a very high bar.
    // ========================================================

    const validatingSubsetPairs =
        [];


    for (
        let i = 0;
        i < properSubsetTimerSignals.length;
        i++
    ) {

        for (
            let j = i + 1;
            j < properSubsetTimerSignals.length;
            j++
        ) {

            const a =
                properSubsetTimerSignals[i];

            const b =
                properSubsetTimerSignals[j];


            if (
                areDisjoint(
                    a.entityIndexes,
                    b.entityIndexes
                )
            ) {

                validatingSubsetPairs.push({

                    subsetA:
                        a.entityIndexes,

                    subsetB:
                        b.entityIndexes
                });
            }
        }
    }


    // ========================================================
    // STATUS
    // ========================================================

    let status =
        'UNRESOLVED';


    const notes =
        [];


    if (
        baseClassification ===
        'SINNER_NEUTRAL_CANDIDATE'
    ) {

        status =
            'SINNER_SPECIAL';


        notes.push(
            'Do not treat as an ordinary Large camp. Combine with nearby Sinner state.'
        );

    } else if (
        fullGroupExactRespawns.length >
        0
    ) {

        status =
            'VALIDATED_SINGLE_CAMP';


        notes.push(
            'Entire geometric group completed at least one exact full-clear -> full-respawn tier-timer cycle.'
        );

    } else if (
        validatingSubsetPairs.length >
        0
    ) {

        status =
            'VALIDATED_SPLIT';


        notes.push(
            'Two disjoint proper subsets independently completed exact tier-timer cycles.'
        );

    } else if (
        properSubsetTimerSignals.length >
        0
    ) {

        status =
            'UNRESOLVED_CONFLICTING_SUBSET_SIGNAL';


        notes.push(
            'At least one proper creation-time subset completed an exact tier-timer cycle.'
        );


        notes.push(
            'This is not sufficient by itself to split the geometric group because replay/PVS observations can be incomplete.'
        );

    } else {

        status =
            'PROBABLE_SINGLE_CAMP';


        if (
            creationSubcohorts.length ===
            1
        ) {

            notes.push(
                'All members belong to one creation-time subcohort.'
            );

        } else {

            notes.push(
                'Multiple creation-time batches exist, but none independently demonstrate an exact proper-subset camp cycle.'
            );
        }


        notes.push(
            'No observed evidence currently requires splitting this geometric group.'
        );
    }


    // ========================================================
    // RETURN COHORT SUMMARY
    // ========================================================

    const returnCohorts =
        audit?.returnCohorts
        ??
        [];


    return {

        groupId:
            spawnGroup.spawnGroupId,

        baseClassification,

        status,

        expectedTimerSeconds,

        firstObservedMatchTimeSeconds:
            spawnGroup
                .firstObservedMatchTimeSeconds,

        centroid:
            spawnGroup.centroid,

        memberCount:
            spawnGroup.memberCount,

        entityIndexes:
            spawnGroup.entityIndexes,

        unitTypeCounts:
            spawnGroup.unitTypeCounts,

        rawCreateTimeMin:
            spawnGroup.rawCreateTimeMin,

        rawCreateTimeMax:
            spawnGroup.rawCreateTimeMax,

        creationSubcohortCount:
            creationSubcohorts.length,

        creationSubcohortSizes:
            creationSubcohorts.map(
                subcohort =>
                    subcohort.members.length
            ),

        creationSubcohortEntityIndexes:
            creationSubcohorts.map(
                subcohort =>
                    subcohort.members.map(
                        member =>
                            member.entityIndex
                    )
            ),

        creationSubcohorts:
            creationSubcohorts.map(
                subcohort => ({

                    minCreateTime:
                        subcohort.minCreateTime,

                    maxCreateTime:
                        subcohort.maxCreateTime,

                    memberCount:
                        subcohort.members.length,

                    entityIndexes:
                        subcohort.members.map(
                            member =>
                                member.entityIndex
                        ),

                    centroid:
                        memberCentroid(
                            subcohort.members
                        )
                })
            ),

        observedFullClearCount:
            audit?.fullClearCount
            ??
            0,

        observedFullRespawnCount:
            audit?.fullRespawnCount
            ??
            0,

        fullGroupExactRespawnCount:
            fullGroupExactRespawns.length,

        fullGroupExactRespawns:
            fullGroupExactRespawns,

        properSubsetTimerSignals,

        validatingSubsetPairs,

        observedReturnCohorts:
            returnCohorts,

        notes,

        mirrorEvidence:
            null
    };
}


// ============================================================
// CREATION SUBCOHORTS
// ============================================================

function buildCreationSubcohorts(
    members,
    tolerance
) {

    const sorted =
        [...members]
            .sort(
                (
                    a,
                    b
                ) =>
                    a.createTime -
                    b.createTime
            );


    const groups =
        [];


    for (
        const member
        of sorted
    ) {

        const last =
            groups.at(
                -1
            );


        if (
            !last
            ||
            member.createTime -
            last.maxCreateTime
            >
            tolerance
        ) {

            groups.push({

                minCreateTime:
                    member.createTime,

                maxCreateTime:
                    member.createTime,

                members:
                    [
                        member
                    ]
            });


            continue;
        }


        last.members.push(
            member
        );


        last.maxCreateTime =
            Math.max(
                last.maxCreateTime,
                member.createTime
            );
    }


    return groups;
}


// ============================================================
// SUBSET CYCLE ANALYSIS
//
// Initial state is ALIVE because these entities are first
// observed when their spawn cohort appears.
//
// We then apply direct health transition events.
//
// Again: this is DIAGNOSTIC, not definitive, because replay
// visibility may omit state changes.
// ============================================================

function evaluateSubsetCycles(
    entityIndexes,
    spawnTime,
    expectedTimerSeconds
) {

    const states =
        new Map(
            entityIndexes.map(
                entityIndex => [
                    entityIndex,
                    true
                ]
            )
        );


    const events =
        entityIndexes

            .flatMap(
                entityIndex =>
                    (
                        entityEvents.get(
                            entityIndex
                        )
                        ??
                        []
                    )
                    .map(
                        event => ({

                            ...event,

                            entityIndex
                        })
                    )
            )

            .filter(
                event =>
                    event.matchTimeSeconds >=
                    spawnTime
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    a.matchTimeSeconds -
                    b.matchTimeSeconds
                    ||
                    eventOrder(
                        a.type
                    )
                    -
                    eventOrder(
                        b.type
                    )
            );


    let pendingClear =
        null;


    let previousAllDead =
        false;


    let previousAllAlive =
        true;


    const cycles =
        [];


    // Process events grouped by exact replay time.
    //
    // Multiple members can transition on the same tick.

    const timeGroups =
        groupEventsByTime(
            events
        );


    for (
        const batch
        of timeGroups
    ) {

        for (
            const event
            of batch.events
        ) {

            if (
                event.type ===
                'DEATH'
            ) {

                states.set(
                    event.entityIndex,
                    false
                );

            } else if (
                event.type ===
                'RETURN_TO_ALIVE'
            ) {

                states.set(
                    event.entityIndex,
                    true
                );
            }
        }


        const allDead =
            [...states.values()]
                .every(
                    alive =>
                        alive === false
                );


        const allAlive =
            [...states.values()]
                .every(
                    alive =>
                        alive === true
                );


        if (
            allDead
            &&
            !previousAllDead
        ) {

            pendingClear =
                batch.timeSeconds;
        }


        if (
            pendingClear !==
            null
            &&
            allAlive
            &&
            !previousAllAlive
        ) {

            const delay =
                batch.timeSeconds -
                pendingClear;


            cycles.push({

                clearTimeSeconds:
                    pendingClear,

                returnTimeSeconds:
                    batch.timeSeconds,

                delaySeconds:
                    delay,

                expectedTimerSeconds,

                timerErrorSeconds:
                    delay -
                    expectedTimerSeconds,

                exactTimer:
                    Math.abs(
                        delay -
                        expectedTimerSeconds
                    )
                    <=
                    TIMER_TOLERANCE
            });


            pendingClear =
                null;
        }


        previousAllDead =
            allDead;

        previousAllAlive =
            allAlive;
    }


    return cycles;
}


// ============================================================
// EVENT TIME GROUPING
// ============================================================

function groupEventsByTime(
    events
) {

    const result =
        [];


    for (
        const event
        of events
    ) {

        const last =
            result.at(
                -1
            );


        if (
            !last
            ||
            Math.abs(
                event.matchTimeSeconds -
                last.timeSeconds
            )
            >
            0.000001
        ) {

            result.push({

                timeSeconds:
                    event.matchTimeSeconds,

                events:
                    [
                        event
                    ]
            });


            continue;
        }


        last.events.push(
            event
        );
    }


    return result;
}


function eventOrder(
    type
) {

    if (
        type ===
        'DEATH'
    ) {

        return 0;
    }


    return 1;
}


// ============================================================
// MIRROR FINDER
// ============================================================

function findMirror(
    group,
    groups
) {

    let best =
        null;


    for (
        const candidate
        of groups
    ) {

        if (
            candidate.groupId ===
            group.groupId
        ) {

            continue;
        }


        if (
            candidate.baseClassification !==
            group.baseClassification
        ) {

            continue;
        }


        if (
            candidate.memberCount !==
            group.memberCount
        ) {

            continue;
        }


        if (
            compositionKey(
                candidate.unitTypeCounts
            )
            !==
            compositionKey(
                group.unitTypeCounts
            )
        ) {

            continue;
        }


        const error =
            Math.hypot(

                group.centroid.x +
                candidate.centroid.x,

                group.centroid.y +
                candidate.centroid.y
            );


        if (
            !best
            ||
            error <
            best.rotation180ErrorXY
        ) {

            best = {

                mirrorGroupId:
                    candidate.groupId,

                rotation180ErrorXY:
                    error,

                mirrorStatus:
                    candidate.status,

                matchingCreationStructure:
                    false
            };
        }
    }


    if (
        best
        &&
        best.rotation180ErrorXY <=
        MIRROR_MAX_ERROR_XY
    ) {

        return best;
    }


    return null;
}


// ============================================================
// CLASSIFICATION
// ============================================================

function classifyFromSpawn(
    group
) {

    const spawn =
        group.firstObservedMatchTimeSeconds;


    if (
        Math.abs(
            spawn -
            120
        )
        <
        2
    ) {

        return 'SMALL_CAMP_CANDIDATE';
    }


    if (
        Math.abs(
            spawn -
            300
        )
        <
        2
    ) {

        return 'MEDIUM_CAMP_CANDIDATE';
    }


    if (
        Math.abs(
            spawn -
            480
        )
        <
        2
    ) {

        const large =
            group.unitTypeCounts
                ?.LARGE_UNIT
            ??
            0;


        if (
            large >
            0
        ) {

            return 'LARGE_CAMP_CANDIDATE';
        }


        return 'SINNER_NEUTRAL_CANDIDATE';
    }


    return 'UNKNOWN';
}


function expectedTimer(
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
// TIMER CHECK
// ============================================================

function isExactTimer(
    value,
    expected
) {

    return (
        Number.isFinite(
            value
        )
        &&
        Number.isFinite(
            expected
        )
        &&
        Math.abs(
            value -
            expected
        )
        <=
        TIMER_TOLERANCE
    );
}


// ============================================================
// SET HELPERS
// ============================================================

function areDisjoint(
    a,
    b
) {

    const set =
        new Set(
            a
        );


    return !b.some(
        value =>
            set.has(
                value
            )
    );
}


// ============================================================
// COMPOSITION
// ============================================================

function compositionKey(
    counts
) {

    return Object.entries(
        counts
        ??
        {}
    )

        .sort(
            (
                a,
                b
            ) =>
                a[0]
                    .localeCompare(
                        b[0]
                    )
        )

        .map(
            (
                [
                    key,
                    value
                ]
            ) =>
                `${key}:${value}`
        )

        .join(
            '|'
        );
}


// ============================================================
// MEMBER CENTROID
// ============================================================

function memberCentroid(
    members
) {

    const positions =
        members

            .map(
                member =>
                    member.position
            )

            .filter(
                Boolean
            );


    if (
        !positions.length
    ) {

        return null;
    }


    return {

        x:
            average(
                positions.map(
                    position =>
                        position.x
                )
            ),

        y:
            average(
                positions.map(
                    position =>
                        position.y
                )
            ),

        z:
            average(
                positions.map(
                    position =>
                        position.z
                )
            )
    };
}


// ============================================================
// COUNT
// ============================================================

function countValues(
    values
) {

    const result =
        {};


    for (
        const value
        of values
    ) {

        const key =
            String(
                value
            );


        result[key] =
            (
                result[key]
                ??
                0
            )
            +
            1;
    }


    return result;
}


// ============================================================
// MATH
// ============================================================

function average(
    values
) {

    if (
        !values.length
    ) {

        return null;
    }


    return values.reduce(
        (
            total,
            value
        ) =>
            total +
            value,
        0
    )
    /
    values.length;
}


// ============================================================
// TIME
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