import {
    createReadStream,
    createWriteStream,
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
// ASSIGNED GOLD ACTIVATION RECONSTRUCTION
// ============================================================

// Script 51 found essentially one position jump per activation.
const POSITION_JUMP_THRESHOLD =
    32;


// Signals occurring within this many ticks at nearly the same
// position are merged into one logical activation.
const ACTIVATION_MERGE_TICKS =
    3;


const ACTIVATION_MERGE_DISTANCE =
    64;


// ============================================================
// DEATH <-> GROUND SOUL MATCHING
//
// Retains Script 51's empirically validated geometry/window.
// ============================================================

const MIN_DELTA_TICKS =
    -1;


const MAX_DELTA_TICKS =
    4;


const MAX_DISTANCE_3D =
    160;


// ============================================================
// BASE TYPES INCLUDED IN LANE ECONOMY
// ============================================================

const ECONOMIC_BASE_TYPES =
    new Set([
        'RANGED',
        'MEDIC',
        'MELEE'
    ]);


// ============================================================
// OUTPUT LIMITS
// ============================================================

const MAX_COMPONENT_EXAMPLES =
    100;


const MAX_UNMATCHED_EXAMPLES =
    100;


const MAX_ACTIVATION_EXAMPLES =
    100;


const PROGRESS_EVERY_ASSIGNED_GOLD_EVENTS =
    50_000;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const variantSummaryPath =
    resolve(
        'output',
        replayName,
        'trooper_variant_classification_v01.json'
    );


const typedLivesPath =
    resolve(
        'output',
        replayName,
        'trooper_lives_typed_v02.jsonl'
    );


const typedDeathsPath =
    resolve(
        'output',
        replayName,
        'trooper_deaths_typed_v02.jsonl'
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
        'trooper_ground_soul_one_to_one_summary_v01.json'
    );


const outputDeathStreamPath =
    resolve(
        'output',
        replayName,
        'trooper_ground_soul_one_to_one_v01.jsonl'
    );


const outputActivationStreamPath =
    resolve(
        'output',
        replayName,
        'assigned_gold_activation_stream_v01.jsonl'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        replayPath,
        variantSummaryPath,
        typedLivesPath,
        typedDeathsPath,
        playerStatePath
    ]
) {

    if (
        !existsSync(
            path
        )
    ) {

        throw new Error(
            `Missing required input:\n${path}`
        );
    }
}


// ============================================================
// LOAD VARIANT SUMMARY
// ============================================================

const variantSummary =
    JSON.parse(
        readFileSync(
            variantSummaryPath,
            'utf8'
        )
    );


if (
    variantSummary
        ?.validation
        ?.pass !==
    true
) {

    throw new Error(
        'Variant classification summary did not pass validation.'
    );
}


// ============================================================
// LOAD PLAYER PAWN IDENTITIES
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
    `Player pawn indexes: ${playerByPawnIndex.size}`
);


// ============================================================
// LOAD TYPED TROOPER LIVES
// ============================================================

console.log(
    'Loading typed Trooper lives...'
);


const lives =
    await loadJsonl(
        typedLivesPath
    );


const lifeById =
    new Map();


for (
    const life
    of lives
) {

    if (
        life?.lifeId
    ) {

        lifeById.set(
            life.lifeId,
            life
        );
    }
}


console.log(
    `Typed lives: ${lives.length}`
);


// ============================================================
// LOAD TYPED TROOPER DEATHS
// ============================================================

console.log(
    'Loading typed Trooper deaths...'
);


const allDeaths =
    await loadJsonl(
        typedDeathsPath
    );


console.log(
    `Typed death rows: ${allDeaths.length}`
);


// ============================================================
// CLASSIFY DEATH ELIGIBILITY
// ============================================================

const eligibleDeaths =
    [];


const excludedDeaths =
    [];


const exclusionCounts =
    new Map();


for (
    const row
    of allDeaths
) {

    const classification =
        classifyDeathEligibility(
            row,
            lifeById.get(
                row?.lifeId
            )
            ??
            null
        );


    row.groundSoulEligibility =
        classification;


    if (
        classification.eligible
    ) {

        eligibleDeaths.push(
            normalizeDeath(
                row
            )
        );

    } else {

        excludedDeaths.push(
            row
        );


        increment(
            exclusionCounts,
            classification.reason
        );
    }
}


// ============================================================
// ASSIGNED GOLD RECONSTRUCTION STATE
// ============================================================

const previousAssignedGold =
    new Map();


const openActivationByEntity =
    new Map();


const activationSequenceByEntity =
    new Map();


const activations =
    [];


const assignedGoldIndexes =
    new Set();


let assignedGoldEvents =
    0;


let firstObservations =
    0;


let becameActiveCount =
    0;


let becameInactiveCount =
    0;


let becameInteractiveCount =
    0;


let becameNonInteractiveCount =
    0;


let positionJumpCount =
    0;


let vacuumTargetChangeCount =
    0;


let operationCreateCount =
    0;


let activationsStartedByBecameActive =
    0;


let activationsStartedByPositionJump =
    0;


let activationsStartedByFirstObservation =
    0;


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


            if (
                getEntityClassName(
                    entity
                ) !==
                'CCitadel_Pickup_AssignedGold'
            ) {

                continue;
            }


            processAssignedGold(
                event,
                entity,
                tick
            );
        }
    }
);


// ============================================================
// RUN PARSER
// ============================================================

console.log('');

console.log(
    '============================================'
);

console.log(
    'GROUND SOUL ONE-TO-ONE RECONSTRUCTION V0.1'
);

console.log(
    '============================================'
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Eligible economic deaths: ${eligibleDeaths.length}`
);

console.log(
    `Excluded deaths: ${excludedDeaths.length}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// FINALIZE OPEN ACTIVATIONS
// ============================================================

for (
    const activation
    of openActivationByEntity.values()
) {

    finalizeActivation(
        activation,
        null,
        'REPLAY_END_OR_LAST_OBSERVATION'
    );
}


openActivationByEntity.clear();


// ============================================================
// SORT ACTIVATIONS
// ============================================================

activations.sort(
    (
        a,
        b
    ) =>
        a.activationTick -
        b.activationTick
);


// ============================================================
// INDEX ACTIVATIONS BY TICK
// ============================================================

const activationsByTick =
    new Map();


for (
    let activationIndex =
        0;

    activationIndex <
        activations.length;

    activationIndex++
) {

    const activation =
        activations[
            activationIndex
        ];


    activation.activationIndex =
        activationIndex;


    if (
        !activationsByTick.has(
            activation.activationTick
        )
    ) {

        activationsByTick.set(
            activation.activationTick,
            []
        );
    }


    activationsByTick
        .get(
            activation.activationTick
        )
        .push(
            activationIndex
        );
}


// ============================================================
// BUILD BIPARTITE CANDIDATE EDGES
// ============================================================

const candidateEdges =
    [];


const deathEdges =
    new Map();


const activationEdges =
    new Map();


for (
    let deathIndex =
        0;

    deathIndex <
        eligibleDeaths.length;

    deathIndex++
) {

    const death =
        eligibleDeaths[
            deathIndex
        ];


    death.deathIndex =
        deathIndex;


    for (
        let tick =
            death.tick +
            MIN_DELTA_TICKS;

        tick <=
            death.tick +
            MAX_DELTA_TICKS;

        tick++
    ) {

        const activationIndexes =
            activationsByTick.get(
                tick
            )
            ??
            [];


        for (
            const activationIndex
            of activationIndexes
        ) {

            const activation =
                activations[
                    activationIndex
                ];


            const edge =
                buildCandidateEdge(
                    death,
                    deathIndex,
                    activation,
                    activationIndex
                );


            if (
                !edge
            ) {

                continue;
            }


            const edgeIndex =
                candidateEdges.length;


            candidateEdges.push(
                edge
            );


            if (
                !deathEdges.has(
                    deathIndex
                )
            ) {

                deathEdges.set(
                    deathIndex,
                    []
                );
            }


            deathEdges
                .get(
                    deathIndex
                )
                .push(
                    edgeIndex
                );


            if (
                !activationEdges.has(
                    activationIndex
                )
            ) {

                activationEdges.set(
                    activationIndex,
                    []
                );
            }


            activationEdges
                .get(
                    activationIndex
                )
                .push(
                    edgeIndex
                );
        }
    }
}


// ============================================================
// BUILD CONNECTED CANDIDATE COMPONENTS
//
// Each component is solved independently.
// ============================================================

const components =
    buildCandidateComponents(
        candidateEdges,
        deathEdges,
        activationEdges
    );


// ============================================================
// SOLVE EXACT ONE-TO-ONE MATCHES
// ============================================================

const finalMatches =
    [];


for (
    const component
    of components
) {

    const matches =
        solveComponentMinCostMatching(
            component,
            candidateEdges
        );


    finalMatches.push(
        ...matches
    );
}


// ============================================================
// MATCH LOOKUPS
// ============================================================

const matchByDeathIndex =
    new Map();


const matchByActivationIndex =
    new Map();


for (
    const match
    of finalMatches
) {

    if (
        matchByDeathIndex.has(
            match.deathIndex
        )
    ) {

        throw new Error(
            `Death assigned twice: ${match.deathIndex}`
        );
    }


    if (
        matchByActivationIndex.has(
            match.activationIndex
        )
    ) {

        throw new Error(
            `Activation assigned twice: ${match.activationIndex}`
        );
    }


    matchByDeathIndex.set(
        match.deathIndex,
        match
    );


    matchByActivationIndex.set(
        match.activationIndex,
        match
    );
}


// ============================================================
// ENRICH MATCHES
// ============================================================

const matchRows =
    [];


for (
    const match
    of finalMatches
) {

    const death =
        eligibleDeaths[
            match.deathIndex
        ];


    const activation =
        activations[
            match.activationIndex
        ];


    const deathCandidateCount =
        deathEdges.get(
            match.deathIndex
        )
        ?.length
        ??
        0;


    const activationCandidateCount =
        activationEdges.get(
            match.activationIndex
        )
        ?.length
        ??
        0;


    matchRows.push(
        buildMatchOutput(
            death,
            activation,
            match.edge,
            deathCandidateCount,
            activationCandidateCount
        )
    );
}


// ============================================================
// UNMATCHED ELIGIBLE DEATHS
// ============================================================

const unmatchedDeaths =
    [];


for (
    let deathIndex =
        0;

    deathIndex <
        eligibleDeaths.length;

    deathIndex++
) {

    if (
        matchByDeathIndex.has(
            deathIndex
        )
    ) {

        continue;
    }


    const death =
        eligibleDeaths[
            deathIndex
        ];


    unmatchedDeaths.push({

        ...death,

        candidateActivationCount:
            deathEdges.get(
                deathIndex
            )
            ?.length
            ??
            0,

        status:
            'NO_ONE_TO_ONE_ASSIGNED_GOLD_MATCH',

        interpretation:
            'Do not classify as a missed soul. Possible explanations include melee-finisher behavior, soul-drop eligibility/range rules, telemetry/PVS limitations, or another unresolved mechanic.'
    });
}


// ============================================================
// UNMATCHED ACTIVATIONS
// ============================================================

const unmatchedActivations =
    [];


for (
    let activationIndex =
        0;

    activationIndex <
        activations.length;

    activationIndex++
) {

    if (
        matchByActivationIndex.has(
            activationIndex
        )
    ) {

        continue;
    }


    const activation =
        activations[
            activationIndex
        ];


    unmatchedActivations.push({

        activationIndex,

        activationId:
            activation.activationId,

        entityIndex:
            activation.entityIndex,

        activationTick:
            activation.activationTick,

        activationTimeSeconds:
            activation.activationTimeSeconds,

        activationClock:
            activation.activationClock,

        team:
            activation.team,

        position:
            activation.position,

        startSignals:
            activation.startSignals,

        candidateDeathCount:
            activationEdges.get(
                activationIndex
            )
            ?.length
            ??
            0
    });
}


// ============================================================
// RAW AMBIGUITY COUNTS
//
// These quantify exactly why the one-to-one solver matters.
// ============================================================

const deathsWithMultipleCandidates =
    [
        ...deathEdges.values()
    ]
    .filter(
        edges =>
            edges.length >
            1
    )
    .length;


const activationsWithMultipleCandidates =
    [
        ...activationEdges.values()
    ]
    .filter(
        edges =>
            edges.length >
            1
    )
    .length;


const ambiguousCandidateEdges =
    candidateEdges.filter(
        edge =>
            (
                deathEdges.get(
                    edge.deathIndex
                )
                ?.length
                ??
                0
            ) >
                1
            ||
            (
                activationEdges.get(
                    edge.activationIndex
                )
                ?.length
                ??
                0
            ) >
                1
    ).length;


// ============================================================
// MATCH SUMMARY BY BASE TYPE
// ============================================================

const eligibleByBaseType =
    countBy(
        eligibleDeaths,
        row =>
            row.baseType
    );


const matchedByBaseType =
    countBy(
        matchRows,
        row =>
            row.trooper.baseType
    );


const unmatchedByBaseType =
    countBy(
        unmatchedDeaths,
        row =>
            row.baseType
    );


// ============================================================
// MATCH SUMMARY BY VARIANT LABEL
// ============================================================

const eligibleByVariant =
    countBy(
        eligibleDeaths,
        row =>
            row.variantLabel
    );


const matchedByVariant =
    countBy(
        matchRows,
        row =>
            row.trooper.variantLabel
    );


// ============================================================
// TARGET PLAYER COUNTS
// ============================================================

const vacuumTargetPlayers =
    countBy(
        matchRows.filter(
            row =>
                row.groundSoul.vacuumTargetPlayer
        ),
        row =>
            row.groundSoul
                .vacuumTargetPlayer
                .playerName
    );


// ============================================================
// GEOMETRY SUMMARY
// ============================================================

const geometrySummary =
    {

        tickDelta:
            summarizeNumbers(
                matchRows.map(
                    row =>
                        row.match.tickDelta
                )
            ),

        distance3D:
            summarizeNumbers(
                matchRows.map(
                    row =>
                        row.match.distance3D
                )
            ),

        distanceXY:
            summarizeNumbers(
                matchRows.map(
                    row =>
                        row.match.distanceXY
                )
            ),

        verticalDelta:
            summarizeNumbers(
                matchRows.map(
                    row =>
                        row.match.verticalDelta
                )
            )
    };


// ============================================================
// CONFIDENCE COUNTS
// ============================================================

const confidenceCounts =
    countBy(
        matchRows,
        row =>
            row.match.confidence
    );


// ============================================================
// COMPONENT SUMMARY
// ============================================================

const componentSizes =
    components.map(
        component => ({

            deaths:
                component.deathIndexes.length,

            activations:
                component.activationIndexes.length,

            edges:
                component.edgeIndexes.length
        })
    );


const multiEntityComponents =
    componentSizes.filter(
        row =>
            row.deaths >
                1
            ||
            row.activations >
                1
    );


// ============================================================
// VALIDATION
// ============================================================

const matchedRiftRows =
    matchRows.filter(
        row =>
            row.trooper.isRift
    );


const matchedInvalidBaseTypes =
    matchRows.filter(
        row =>
            !ECONOMIC_BASE_TYPES.has(
                row.trooper.baseType
            )
    );


const sameTeamMatches =
    matchRows.filter(
        row =>
            (
                row.trooper.team ===
                    2
                ||
                row.trooper.team ===
                    3
            )
            &&
            (
                row.groundSoul.team ===
                    2
                ||
                row.groundSoul.team ===
                    3
            )
            &&
            row.trooper.team ===
                row.groundSoul.team
    );


const outOfGeometryMatches =
    matchRows.filter(
        row =>
            row.match.distance3D >
                MAX_DISTANCE_3D
            ||
            row.match.tickDelta <
                MIN_DELTA_TICKS
            ||
            row.match.tickDelta >
                MAX_DELTA_TICKS
    );


const uniqueDeathAssignments =
    new Set(
        finalMatches.map(
            row =>
                row.deathIndex
        )
    );


const uniqueActivationAssignments =
    new Set(
        finalMatches.map(
            row =>
                row.activationIndex
        )
    );


const validation =
    {

        variantSummaryPass:
            {

                actual:
                    variantSummary
                        ?.validation
                        ?.pass,

                expected:
                    true,

                pass:
                    variantSummary
                        ?.validation
                        ?.pass ===
                    true
            },

        typedDeathsLoaded:
            {

                actual:
                    allDeaths.length,

                expected:
                    replayName ===
                        'test'
                        ? 4812
                        : '>0',

                pass:
                    replayName ===
                        'test'

                        ? allDeaths.length ===
                            4812

                        : allDeaths.length >
                            0
            },

        eligibleDeathsObserved:
            {

                actual:
                    eligibleDeaths.length,

                expected:
                    '>0',

                pass:
                    eligibleDeaths.length >
                    0
            },

        assignedGoldEventsObserved:
            {

                actual:
                    assignedGoldEvents,

                expected:
                    '>0',

                pass:
                    assignedGoldEvents >
                    0
            },

        assignedGoldSlotsObserved:
            {

                actual:
                    assignedGoldIndexes.size,

                expected:
                    replayName ===
                        'test'
                        ? 23
                        : '>0',

                pass:
                    replayName ===
                        'test'

                        ? assignedGoldIndexes.size ===
                            23

                        : assignedGoldIndexes.size >
                            0
            },

        logicalActivationsObserved:
            {

                actual:
                    activations.length,

                expected:
                    '>0',

                pass:
                    activations.length >
                    0
            },

        candidateEdgesObserved:
            {

                actual:
                    candidateEdges.length,

                expected:
                    '>0',

                pass:
                    candidateEdges.length >
                    0
            },

        matchesObserved:
            {

                actual:
                    matchRows.length,

                expected:
                    '>0',

                pass:
                    matchRows.length >
                    0
            },

        deathAssignmentsUnique:
            {

                actual:
                    uniqueDeathAssignments.size,

                expected:
                    finalMatches.length,

                pass:
                    uniqueDeathAssignments.size ===
                    finalMatches.length
            },

        activationAssignmentsUnique:
            {

                actual:
                    uniqueActivationAssignments.size,

                expected:
                    finalMatches.length,

                pass:
                    uniqueActivationAssignments.size ===
                    finalMatches.length
            },

        noRiftDeathsMatched:
            {

                actual:
                    matchedRiftRows.length,

                expected:
                    0,

                pass:
                    matchedRiftRows.length ===
                    0
            },

        noNonEconomicTypesMatched:
            {

                actual:
                    matchedInvalidBaseTypes.length,

                expected:
                    0,

                pass:
                    matchedInvalidBaseTypes.length ===
                    0
            },

        noSameTeamMatches:
            {

                actual:
                    sameTeamMatches.length,

                expected:
                    0,

                pass:
                    sameTeamMatches.length ===
                    0
            },

        allMatchesInsideGeometry:
            {

                actual:
                    outOfGeometryMatches.length,

                expected:
                    0,

                pass:
                    outOfGeometryMatches.length ===
                    0
            }
    };


const validationPass =
    Object
        .values(
            validation
        )
        .every(
            row =>
                row.pass
        );


// ============================================================
// WRITE ACTIVATION STREAM
// ============================================================

mkdirSync(
    dirname(
        outputActivationStreamPath
    ),
    {
        recursive: true
    }
);


const activationWriter =
    createWriteStream(
        outputActivationStreamPath,
        {
            encoding:
                'utf8'
        }
    );


for (
    const activation
    of activations
) {

    const match =
        matchByActivationIndex.get(
            activation.activationIndex
        )
        ??
        null;


    activationWriter.write(
        JSON.stringify({

            schemaVersion:
                1,

            canonical:
                false,

            activationIndex:
                activation.activationIndex,

            activationId:
                activation.activationId,

            entityIndex:
                activation.entityIndex,

            timing:
                {

                    activationTick:
                        activation.activationTick,

                    activationTimeSeconds:
                        activation.activationTimeSeconds,

                    activationClock:
                        activation.activationClock,

                    endTick:
                        activation.endTick,

                    endTimeSeconds:
                        activation.endTimeSeconds,

                    endClock:
                        activation.endClock,

                    durationSeconds:
                        activation.durationSeconds
                },

            state:
                {

                    team:
                        activation.team,

                    subclassId:
                        activation.subclassId,

                    position:
                        activation.position,

                    active:
                        activation.activeAtStart,

                    interactive:
                        activation.interactiveAtStart
                },

            lifecycle:
                {

                    startSignals:
                        activation.startSignals,

                    endReason:
                        activation.endReason,

                    firstInteractiveTick:
                        activation.firstInteractiveTick,

                    firstValidVacuumTarget:
                        activation.firstValidVacuumTarget,

                    vacuumTargetTransitions:
                        activation.vacuumTargetTransitions
                },

            oneToOne:
                {

                    candidateDeathCount:
                        activationEdges.get(
                            activation.activationIndex
                        )
                        ?.length
                        ??
                        0,

                    matched:
                        Boolean(
                            match
                        ),

                    matchedDeathIndex:
                        match
                            ?.deathIndex
                        ??
                        null
                }
        })
        +
        '\n'
    );
}


await finishWriter(
    activationWriter
);


// ============================================================
// WRITE DEATH ECONOMY STREAM
// ============================================================

mkdirSync(
    dirname(
        outputDeathStreamPath
    ),
    {
        recursive: true
    }
);


const deathWriter =
    createWriteStream(
        outputDeathStreamPath,
        {
            encoding:
                'utf8'
        }
    );


for (
    let deathIndex =
        0;

    deathIndex <
        eligibleDeaths.length;

    deathIndex++
) {

    const death =
        eligibleDeaths[
            deathIndex
        ];


    const match =
        matchRows.find(
            row =>
                row
                    .trooper
                    .deathIndex ===
                deathIndex
        )
        ??
        null;


    deathWriter.write(
        JSON.stringify({

            schemaVersion:
                1,

            canonical:
                false,

            deathIndex,

            deathKey:
                death.deathKey,

            lifeId:
                death.lifeId,

            trooper:
                {

                    entityIndex:
                        death.entityIndex,

                    baseType:
                        death.baseType,

                    subclassId:
                        death.subclassId,

                    variantLabel:
                        death.variantLabel,

                    isSuper:
                        death.isSuper,

                    isRift:
                        death.isRift,

                    team:
                        death.team,

                    lane:
                        death.lane,

                    maxHealth:
                        death.maxHealth,

                    position:
                        death.position
                },

            timing:
                {

                    tick:
                        death.tick,

                    timeSeconds:
                        death.timeSeconds,

                    clock:
                        death.clock
                },

            groundSoul:
                match
                    ? match.groundSoul
                    : null,

            match:
                match
                    ? match.match
                    : {

                        status:
                            'NO_ONE_TO_ONE_ASSIGNED_GOLD_MATCH',

                        candidateActivationCount:
                            deathEdges.get(
                                deathIndex
                            )
                            ?.length
                            ??
                            0,

                        interpretation:
                            'No AssignedGold activation was assigned. This is not yet equivalent to a missed soul.'
                    }
        })
        +
        '\n'
    );
}


await finishWriter(
    deathWriter
);


// ============================================================
// SUMMARY
// ============================================================

const summary =
    {

        replay:
            replayName,

        version:
            'TROOPER_GROUND_SOUL_ONE_TO_ONE_V01',

        canonical:
            false,

        status:
            validationPass
                ? 'WORKING_ONE_TO_ONE_GROUND_SOUL_DATASET'
                : 'DIAGNOSTIC_ONLY',

        purpose:
            [

                'Reconstruct logical CCitadel_Pickup_AssignedGold activations from pooled replay entities.',

                'Prevent one AssignedGold activation from being credited to multiple Trooper deaths.',

                'Restrict ground-soul matching to Ranged, Medic, and Melee lane Troopers.',

                'Exclude Rift Troopers using both life-start and death variant evidence.',

                'Retain Super Troopers as economically eligible unless later telemetry disproves that assumption.',

                'Do not interpret unmatched Trooper deaths as missed souls yet.'
            ],

        matchingRules:
            {

                minDeltaTicks:
                    MIN_DELTA_TICKS,

                maxDeltaTicks:
                    MAX_DELTA_TICKS,

                maxDistance3D:
                    MAX_DISTANCE_3D,

                sameTeamRejected:
                    true,

                oneDeathMaximumAssignments:
                    1,

                oneActivationMaximumAssignments:
                    1,

                optimization:
                    'Exact maximum-cardinality minimum-cost matching inside each connected local candidate component.'
            },

        deathEligibility:
            {

                allTypedDeaths:
                    allDeaths.length,

                eligibleEconomicDeaths:
                    eligibleDeaths.length,

                excludedDeaths:
                    excludedDeaths.length,

                exclusionCounts:
                    mapToSortedObject(
                        exclusionCounts
                    ),

                eligibleByBaseType:
                    mapToSortedObject(
                        eligibleByBaseType
                    ),

                eligibleByVariant:
                    mapToSortedObject(
                        eligibleByVariant
                    )
            },

        assignedGoldLifecycle:
            {

                entityEvents:
                    assignedGoldEvents,

                uniqueEntitySlots:
                    assignedGoldIndexes.size,

                firstObservations,

                operationCreateCount,

                becameActive:
                    becameActiveCount,

                becameInactive:
                    becameInactiveCount,

                becameInteractive:
                    becameInteractiveCount,

                becameNonInteractive:
                    becameNonInteractiveCount,

                positionJumps:
                    positionJumpCount,

                vacuumTargetChanges:
                    vacuumTargetChangeCount,

                logicalActivations:
                    activations.length,

                activationStarts:
                    {

                        byBecameActive:
                            activationsStartedByBecameActive,

                        byPositionJump:
                            activationsStartedByPositionJump,

                        byFirstObservation:
                            activationsStartedByFirstObservation
                    }
            },

        candidateGraph:
            {

                candidateEdges:
                    candidateEdges.length,

                connectedComponents:
                    components.length,

                multiEntityComponents:
                    multiEntityComponents.length,

                deathsWithMultipleCandidates,

                activationsWithMultipleCandidates,

                ambiguousCandidateEdges,

                largestDeathComponent:
                    maximumOrZero(
                        componentSizes.map(
                            row =>
                                row.deaths
                        )
                    ),

                largestActivationComponent:
                    maximumOrZero(
                        componentSizes.map(
                            row =>
                                row.activations
                        )
                    ),

                largestEdgeComponent:
                    maximumOrZero(
                        componentSizes.map(
                            row =>
                                row.edges
                        )
                    ),

                examples:
                    componentSizes
                        .filter(
                            row =>
                                row.deaths >
                                    1
                                ||
                                row.activations >
                                    1
                        )
                        .slice(
                            0,
                            MAX_COMPONENT_EXAMPLES
                        )
            },

        oneToOneResults:
            {

                matchedDeaths:
                    matchRows.length,

                unmatchedEligibleDeaths:
                    unmatchedDeaths.length,

                eligibleDeathMatchRate:
                    rate(
                        matchRows.length,
                        eligibleDeaths.length
                    ),

                matchedActivations:
                    matchRows.length,

                unmatchedActivations:
                    unmatchedActivations.length,

                activationMatchRate:
                    rate(
                        matchRows.length,
                        activations.length
                    ),

                matchedByBaseType:
                    mapToSortedObject(
                        matchedByBaseType
                    ),

                unmatchedByBaseType:
                    mapToSortedObject(
                        unmatchedByBaseType
                    ),

                matchedByVariant:
                    mapToSortedObject(
                        matchedByVariant
                    ),

                confidenceCounts:
                    mapToSortedObject(
                        confidenceCounts
                    ),

                geometry:
                    geometrySummary
            },

        vacuumTargets:
            {

                matchedGroundSoulsWithResolvedPlayerTarget:
                    matchRows.filter(
                        row =>
                            row
                                .groundSoul
                                .vacuumTargetPlayer
                    ).length,

                playerCounts:
                    mapToSortedObject(
                        vacuumTargetPlayers
                    ),

                interpretation:
                    'm_hVacuumTarget is retained as an observed magnetic target. It is not yet treated as fully validated soul acquisition.'
            },

        unresolvedInterpretation:
            {

                unmatchedDeathsAreNotMissedSouls:
                    true,

                reasonsToTestNext:
                    [

                        'Melee final-blow behavior may alter ordinary soul-object spawning.',

                        'Player proximity/range may determine whether the ground component is instantiated.',

                        'Some replay observations may be absent because of PVS/entity visibility.',

                        'Additional economy conditions may remain unidentified.'
                    ],

                nextAfterThisPass:
                    'Use the one-to-one stream to explain unmatched deaths and then identify the separate shootable/deniable soul-orb telemetry.'
            },

        examples:
            {

                matched:
                    matchRows.slice(
                        0,
                        MAX_ACTIVATION_EXAMPLES
                    ),

                unmatchedDeaths:
                    unmatchedDeaths.slice(
                        0,
                        MAX_UNMATCHED_EXAMPLES
                    ),

                unmatchedActivations:
                    unmatchedActivations.slice(
                        0,
                        MAX_UNMATCHED_EXAMPLES
                    )
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

                deathGroundSoulStream:
                    outputDeathStreamPath,

                assignedGoldActivationStream:
                    outputActivationStreamPath
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
        summary,
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
    'DEATH ELIGIBILITY'
);

console.log(
    '-----------------'
);

console.log(
    `All typed deaths: ${allDeaths.length}`
);

console.log(
    `Eligible economic deaths: ${eligibleDeaths.length}`
);

console.log(
    `Excluded: ${excludedDeaths.length}`
);


for (
    const [
        reason,
        count
    ]
    of Object.entries(
        mapToSortedObject(
            exclusionCounts
        )
    )
) {

    console.log(
        `  ${reason.padEnd(
            32
        )} ${count}`
    );
}


console.log('');

console.log(
    'ASSIGNED GOLD ACTIVATIONS'
);

console.log(
    '-------------------------'
);

console.log(
    `Entity events: ${assignedGoldEvents.toLocaleString()}`
);

console.log(
    `Entity slots: ${assignedGoldIndexes.size}`
);

console.log(
    `becameActive: ${becameActiveCount}`
);

console.log(
    `Position jumps: ${positionJumpCount}`
);

console.log(
    `Logical activations: ${activations.length}`
);

console.log('');

console.log(
    'CANDIDATE GRAPH'
);

console.log(
    '---------------'
);

console.log(
    `Edges: ${candidateEdges.length}`
);

console.log(
    `Connected components: ${components.length}`
);

console.log(
    `Deaths with >1 candidate: ${deathsWithMultipleCandidates}`
);

console.log(
    `Activations with >1 candidate death: ${activationsWithMultipleCandidates}`
);

console.log(
    `Ambiguous edges: ${ambiguousCandidateEdges}`
);

console.log('');

console.log(
    'ONE-TO-ONE RESULTS'
);

console.log(
    '------------------'
);

console.log(
    `Matched deaths: ${matchRows.length}`
);

console.log(
    `Unmatched eligible deaths: ${unmatchedDeaths.length}`
);

console.log(
    `Eligible death match rate: ${formatPercent(
        rate(
            matchRows.length,
            eligibleDeaths.length
        )
    )}`
);

console.log(
    `Unmatched AssignedGold activations: ${unmatchedActivations.length}`
);

console.log('');

console.log(
    'MATCHED BY BASE TYPE'
);

console.log(
    '--------------------'
);


for (
    const baseType
    of [
        'RANGED',
        'MEDIC',
        'MELEE'
    ]
) {

    const eligible =
        eligibleByBaseType.get(
            baseType
        )
        ??
        0;


    const matched =
        matchedByBaseType.get(
            baseType
        )
        ??
        0;


    console.log(
        `${
            baseType.padEnd(
                10
            )
        } ${
            String(
                matched
            ).padStart(
                5
            )
        } / ${
            String(
                eligible
            ).padStart(
                5
            )
        } = ${
            formatPercent(
                rate(
                    matched,
                    eligible
                )
            )
        }`
    );
}


console.log('');

console.log(
    'MATCH GEOMETRY'
);

console.log(
    '--------------'
);

console.log(
    `Tick delta median: ${geometrySummary.tickDelta.median}`
);

console.log(
    `3D distance median: ${formatNumber(
        geometrySummary.distance3D.median
    )}`
);

console.log(
    `3D distance p90: ${formatNumber(
        geometrySummary.distance3D.p90
    )}`
);

console.log(
    `XY distance median: ${formatNumber(
        geometrySummary.distanceXY.median
    )}`
);

console.log(
    `Vertical delta median: ${formatNumber(
        geometrySummary.verticalDelta.median
    )}`
);

console.log('');

console.log(
    'VACUUM TARGETS'
);

console.log(
    '--------------'
);

console.log(
    `Resolved player targets: ${
        matchRows.filter(
            row =>
                row
                    .groundSoul
                    .vacuumTargetPlayer
        ).length
    } / ${matchRows.length}`
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
                34
            )
        } actual=${
            JSON.stringify(
                check.actual
            )
        } expected=${
            JSON.stringify(
                check.expected
            )
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
    `Death stream:\n${outputDeathStreamPath}`
);

console.log('');

console.log(
    `Activation stream:\n${outputActivationStreamPath}`
);

console.log('');


// ============================================================
// ASSIGNED GOLD PROCESSOR
// ============================================================

function processAssignedGold(
    event,
    entity,
    tick
) {

    assignedGoldEvents++;


    if (
        assignedGoldEvents %
            PROGRESS_EVERY_ASSIGNED_GOLD_EVENTS ===
        0
    ) {

        console.log(
            `AssignedGold events: ${
                assignedGoldEvents.toLocaleString()
            } | logical activations: ${
                activations.length
            }`
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


    assignedGoldIndexes.add(
        entityIndex
    );


    const previous =
        previousAssignedGold.get(
            entityIndex
        )
        ??
        null;


    const current =
        {

            tick,

            entityIndex,

            operation:
                decodeOperation(
                    event.operation
                ),

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

            signals:
                []
        };


    // ========================================================
    // SIGNALS
    // ========================================================

    const firstObservation =
        previous ===
        null;


    if (
        firstObservation
    ) {

        firstObservations++;


        current.signals.push(
            'FIRST_OBSERVATION'
        );
    }


    if (
        current.operation ===
        'CREATE'
    ) {

        operationCreateCount++;


        current.signals.push(
            'OPERATION_CREATE'
        );
    }


    const becameActive =
        previous
        &&
        previous.active ===
            false
        &&
        current.active ===
            true;


    if (
        becameActive
    ) {

        becameActiveCount++;


        current.signals.push(
            'BECAME_ACTIVE'
        );
    }


    const becameInactive =
        previous
        &&
        previous.active ===
            true
        &&
        current.active ===
            false;


    if (
        becameInactive
    ) {

        becameInactiveCount++;


        current.signals.push(
            'BECAME_INACTIVE'
        );
    }


    const becameInteractive =
        previous
        &&
        previous.interactive ===
            false
        &&
        current.interactive ===
            true;


    if (
        becameInteractive
    ) {

        becameInteractiveCount++;


        current.signals.push(
            'BECAME_INTERACTIVE'
        );
    }


    const becameNonInteractive =
        previous
        &&
        previous.interactive ===
            true
        &&
        current.interactive ===
            false;


    if (
        becameNonInteractive
    ) {

        becameNonInteractiveCount++;


        current.signals.push(
            'BECAME_NONINTERACTIVE'
        );
    }


    const vacuumChanged =
        previous
        &&
        previous.vacuumTarget !==
            current.vacuumTarget;


    if (
        vacuumChanged
    ) {

        vacuumTargetChangeCount++;


        current.signals.push(
            'VACUUM_TARGET_CHANGED'
        );
    }


    let positionJump =
        false;


    let positionJumpDistance =
        null;


    if (
        previous?.position
        &&
        current.position
    ) {

        positionJumpDistance =
            getDistance3D(
                previous.position,
                current.position
            );


        if (
            positionJumpDistance >=
            POSITION_JUMP_THRESHOLD
        ) {

            positionJump =
                true;


            positionJumpCount++;


            current.signals.push(
                'POSITION_JUMP'
            );
        }
    }


    // ========================================================
    // LOGICAL ACTIVATION START
    //
    // CREATE alone is deliberately ignored.
    // ========================================================

    const firstActiveObservation =
        firstObservation
        &&
        current.active ===
            true;


    const strongActivationSignal =
        becameActive
        ||
        (
            positionJump
            &&
            current.active ===
                true
        )
        ||
        firstActiveObservation;


    if (
        strongActivationSignal
    ) {

        let open =
            openActivationByEntity.get(
                entityIndex
            )
            ??
            null;


        const canMerge =
            open
            &&
            shouldMergeActivationSignal(
                open,
                current
            );


        if (
            canMerge
        ) {

            mergeActivationSignal(
                open,
                current,
                positionJumpDistance
            );

        } else {

            if (
                open
            ) {

                finalizeActivation(
                    open,
                    tick,
                    'ENTITY_REUSED_BEFORE_INACTIVE'
                );
            }


            const activation =
                startActivation(
                    current,
                    positionJumpDistance
                );


            openActivationByEntity.set(
                entityIndex,
                activation
            );


            if (
                becameActive
            ) {

                activationsStartedByBecameActive++;
            }


            if (
                positionJump
            ) {

                activationsStartedByPositionJump++;
            }


            if (
                firstActiveObservation
            ) {

                activationsStartedByFirstObservation++;
            }
        }
    }


    // ========================================================
    // UPDATE OPEN ACTIVATION
    // ========================================================

    const open =
        openActivationByEntity.get(
            entityIndex
        )
        ??
        null;


    if (
        open
    ) {

        updateActivationLifecycle(
            open,
            current
        );
    }


    // ========================================================
    // END ACTIVATION
    // ========================================================

    if (
        becameInactive
        &&
        open
    ) {

        finalizeActivation(
            open,
            tick,
            'BECAME_INACTIVE'
        );


        openActivationByEntity.delete(
            entityIndex
        );
    }


    previousAssignedGold.set(
        entityIndex,
        current
    );
}


// ============================================================
// START ACTIVATION
// ============================================================

function startActivation(
    current,
    positionJumpDistance
) {

    const sequence =
        (
            activationSequenceByEntity.get(
                current.entityIndex
            )
            ??
            0
        )
        +
        1;


    activationSequenceByEntity.set(
        current.entityIndex,
        sequence
    );


    const activation =
        {

            activationId:
                `${current.entityIndex}|${sequence}`,

            entityIndex:
                current.entityIndex,

            sequence,

            activationTick:
                current.tick,

            activationTimeSeconds:
                tickToMatchTime(
                    current.tick
                ),

            activationClock:
                formatClock(
                    tickToMatchTime(
                        current.tick
                    )
                ),

            team:
                current.team,

            subclassId:
                current.subclassId,

            position:
                current.position,

            activeAtStart:
                current.active,

            interactiveAtStart:
                current.interactive,

            startSignals:
                [
                    ...current.signals
                ],

            positionJumpDistance,

            firstInteractiveTick:
                current.interactive ===
                    true
                    ? current.tick
                    : null,

            firstValidVacuumTarget:
                null,

            vacuumTargetTransitions:
                [],

            lastObservedTick:
                current.tick,

            endTick:
                null,

            endTimeSeconds:
                null,

            endClock:
                null,

            durationSeconds:
                null,

            endReason:
                null,

            finalized:
                false
        };


    attachVacuumTarget(
        activation,
        current
    );


    return activation;
}


// ============================================================
// MERGE ACTIVATION SIGNAL
// ============================================================

function mergeActivationSignal(
    activation,
    current,
    positionJumpDistance
) {

    activation.startSignals =
        [
            ...new Set([
                ...activation.startSignals,
                ...current.signals
            ])
        ];


    if (
        Number.isFinite(
            positionJumpDistance
        )
    ) {

        activation.positionJumpDistance =
            Math.max(
                activation.positionJumpDistance
                ??
                0,
                positionJumpDistance
            );
    }


    if (
        !activation.position
        &&
        current.position
    ) {

        activation.position =
            current.position;
    }


    if (
        activation.team ===
            null
        &&
        current.team !==
            null
    ) {

        activation.team =
            current.team;
    }
}


// ============================================================
// UPDATE ACTIVATION
// ============================================================

function updateActivationLifecycle(
    activation,
    current
) {

    activation.lastObservedTick =
        current.tick;


    if (
        activation.firstInteractiveTick ===
            null
        &&
        current.interactive ===
            true
    ) {

        activation.firstInteractiveTick =
            current.tick;
    }


    attachVacuumTarget(
        activation,
        current
    );
}


// ============================================================
// VACUUM TARGET
// ============================================================

function attachVacuumTarget(
    activation,
    current
) {

    if (
        !isValidHandle(
            current.vacuumTarget
        )
    ) {

        return;
    }


    const decodedIndex =
        decodeHandleEntityIndex(
            current.vacuumTarget
        );


    const player =
        decodedIndex !==
            null
            ? (
                playerByPawnIndex.get(
                    decodedIndex
                )
                ??
                null
            )
            : null;


    const previousTransition =
        activation
            .vacuumTargetTransitions[
                activation
                    .vacuumTargetTransitions
                    .length -
                1
            ]
        ??
        null;


    if (
        previousTransition
        &&
        previousTransition.handle ===
        current.vacuumTarget
    ) {

        return;
    }


    const transition =
        {

            tick:
                current.tick,

            timeSeconds:
                tickToMatchTime(
                    current.tick
                ),

            clock:
                formatClock(
                    tickToMatchTime(
                        current.tick
                    )
                ),

            handle:
                current.vacuumTarget,

            decodedEntityIndex:
                decodedIndex,

            player
        };


    activation
        .vacuumTargetTransitions
        .push(
            transition
        );


    if (
        !activation.firstValidVacuumTarget
    ) {

        activation.firstValidVacuumTarget =
            transition;
    }
}


// ============================================================
// MERGE CHECK
// ============================================================

function shouldMergeActivationSignal(
    activation,
    current
) {

    const tickDelta =
        current.tick -
        activation.activationTick;


    if (
        tickDelta <
            0
        ||
        tickDelta >
            ACTIVATION_MERGE_TICKS
    ) {

        return false;
    }


    if (
        activation.position
        &&
        current.position
    ) {

        const distance =
            getDistance3D(
                activation.position,
                current.position
            );


        if (
            distance >
            ACTIVATION_MERGE_DISTANCE
        ) {

            return false;
        }
    }


    return true;
}


// ============================================================
// FINALIZE ACTIVATION
// ============================================================

function finalizeActivation(
    activation,
    endTick,
    reason
) {

    if (
        activation.finalized
    ) {

        return;
    }


    const finalTick =
        endTick
        ??
        activation.lastObservedTick;


    activation.endTick =
        finalTick;


    activation.endTimeSeconds =
        Number.isFinite(
            finalTick
        )
            ? tickToMatchTime(
                finalTick
            )
            : null;


    activation.endClock =
        Number.isFinite(
            activation.endTimeSeconds
        )
            ? formatClock(
                activation.endTimeSeconds
            )
            : null;


    activation.durationSeconds =
        Number.isFinite(
            finalTick
        )
            ? (
                finalTick -
                activation.activationTick
            )
            /
            TICK_RATE
            : null;


    activation.endReason =
        reason;


    activation.finalized =
        true;


    activations.push(
        activation
    );
}


// ============================================================
// DEATH ELIGIBILITY
// ============================================================

function classifyDeathEligibility(
    death,
    life
) {

    const baseType =
        death
            ?.trooper
            ?.baseType
        ??
        life
            ?.trooper
            ?.baseType
        ??
        'UNKNOWN';


    if (
        !ECONOMIC_BASE_TYPES.has(
            baseType
        )
    ) {

        return {

            eligible:
                false,

            reason:
                'NON_ECONOMIC_BASE_TYPE'
        };
    }


    const deathIsRift =
        death
            ?.variant
            ?.isRift ===
        true;


    const lifeIsRift =
        life
            ?.variant
            ?.isRift ===
        true;


    const deathLabel =
        String(
            death
                ?.variant
                ?.label
            ??
            ''
        );


    const lifeLabel =
        String(
            life
                ?.variant
                ?.label
            ??
            ''
        );


    const riftByLabel =
        deathLabel.startsWith(
            'RIFT_'
        )
        ||
        lifeLabel.startsWith(
            'RIFT_'
        );


    if (
        deathIsRift
        ||
        lifeIsRift
        ||
        riftByLabel
    ) {

        return {

            eligible:
                false,

            reason:
                'RIFT_TROOPER'
        };
    }


    return {

        eligible:
            true,

        reason:
            'ELIGIBLE'
    };
}


// ============================================================
// NORMALIZE DEATH
// ============================================================

function normalizeDeath(
    death
) {

    const life =
        lifeById.get(
            death?.lifeId
        )
        ??
        null;


    const deathVariant =
        death?.variant
        ??
        {};


    const lifeVariant =
        life?.variant
        ??
        {};


    const variantLabel =
        deathVariant.label
        ??
        lifeVariant.label
        ??
        'UNRESOLVED';


    const isSuper =
        deathVariant.isSuper ===
            true
        ||
        lifeVariant.isSuper ===
            true;


    const isRift =
        deathVariant.isRift ===
            true
        ||
        lifeVariant.isRift ===
            true
        ||
        String(
            variantLabel
        ).startsWith(
            'RIFT_'
        );


    return {

        deathKey:
            death.deathKey,

        lifeId:
            death.lifeId,

        entityIndex:
            finite(
                death.entityIndex
            ),

        tick:
            finite(
                death
                    ?.timing
                    ?.tick
            ),

        timeSeconds:
            finite(
                death
                    ?.timing
                    ?.timeSeconds
            ),

        clock:
            death
                ?.timing
                ?.clock
            ??
            null,

        subclassId:
            String(
                death
                    ?.trooper
                    ?.subclassId
                ??
                'UNKNOWN'
            ),

        baseType:
            death
                ?.trooper
                ?.baseType
            ??
            'UNKNOWN',

        variantLabel,

        isSuper,

        isRift,

        team:
            finite(
                death
                    ?.trooper
                    ?.team
            ),

        lane:
            finite(
                death
                    ?.trooper
                    ?.lane
            ),

        maxHealth:
            finite(
                death
                    ?.trooper
                    ?.maxHealth
            ),

        position:
            death
                ?.trooper
                ?.position
            ??
            null
    };
}


// ============================================================
// BUILD CANDIDATE EDGE
// ============================================================

function buildCandidateEdge(
    death,
    deathIndex,
    activation,
    activationIndex
) {

    if (
        !death.position
        ||
        !activation.position
    ) {

        return null;
    }


    const tickDelta =
        activation.activationTick -
        death.tick;


    if (
        tickDelta <
            MIN_DELTA_TICKS
        ||
        tickDelta >
            MAX_DELTA_TICKS
    ) {

        return null;
    }


    // ========================================================
    // TEAM RULE
    //
    // AssignedGold belongs to the team opposite the dead
    // Trooper in the validated examples.
    // ========================================================

    if (
        (
            death.team ===
                2
            ||
            death.team ===
                3
        )
        &&
        (
            activation.team ===
                2
            ||
            activation.team ===
                3
        )
    ) {

        if (
            death.team ===
            activation.team
        ) {

            return null;
        }
    }


    const distance3D =
        getDistance3D(
            death.position,
            activation.position
        );


    if (
        distance3D >
        MAX_DISTANCE_3D
    ) {

        return null;
    }


    const dx =
        activation.position.x -
        death.position.x;


    const dy =
        activation.position.y -
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
            activation.position.z
            ??
            0
        )
        -
        (
            death.position.z
            ??
            0
        );


    const evidencePenalty =
        getActivationEvidencePenalty(
            activation
        );


    // ========================================================
    // INTEGER COST
    //
    // Timing dominates.
    // Geometry breaks same-tick ties.
    // Lifecycle evidence is a final tie breaker.
    // ========================================================

    const cost =
        Math.abs(
            tickDelta
        )
        *
        1_000_000
        +
        Math.round(
            distance3D *
            100
        )
        +
        evidencePenalty;


    return {

        deathIndex,

        activationIndex,

        tickDelta,

        distance3D,

        distanceXY,

        verticalDelta,

        cost
    };
}


// ============================================================
// ACTIVATION EVIDENCE PENALTY
// ============================================================

function getActivationEvidencePenalty(
    activation
) {

    const signals =
        new Set(
            activation.startSignals
        );


    if (
        signals.has(
            'BECAME_ACTIVE'
        )
        &&
        signals.has(
            'POSITION_JUMP'
        )
    ) {

        return 0;
    }


    if (
        signals.has(
            'BECAME_ACTIVE'
        )
    ) {

        return 50;
    }


    if (
        signals.has(
            'POSITION_JUMP'
        )
    ) {

        return 100;
    }


    if (
        signals.has(
            'FIRST_OBSERVATION'
        )
    ) {

        return 500;
    }


    return 1000;
}


// ============================================================
// BUILD CANDIDATE COMPONENTS
// ============================================================

function buildCandidateComponents(
    edges,
    deathAdjacency,
    activationAdjacency
) {

    const visitedDeaths =
        new Set();


    const visitedActivations =
        new Set();


    const components =
        [];


    const allDeathIndexes =
        [
            ...deathAdjacency.keys()
        ];


    for (
        const startDeath
        of allDeathIndexes
    ) {

        if (
            visitedDeaths.has(
                startDeath
            )
        ) {

            continue;
        }


        const queue =
            [
                {
                    type:
                        'D',

                    index:
                        startDeath
                }
            ];


        const deathIndexes =
            new Set();


        const activationIndexes =
            new Set();


        const edgeIndexes =
            new Set();


        while (
            queue.length >
            0
        ) {

            const node =
                queue.shift();


            if (
                node.type ===
                'D'
            ) {

                if (
                    visitedDeaths.has(
                        node.index
                    )
                ) {

                    continue;
                }


                visitedDeaths.add(
                    node.index
                );


                deathIndexes.add(
                    node.index
                );


                for (
                    const edgeIndex
                    of deathAdjacency.get(
                        node.index
                    )
                    ??
                    []
                ) {

                    edgeIndexes.add(
                        edgeIndex
                    );


                    const activationIndex =
                        edges[
                            edgeIndex
                        ].activationIndex;


                    if (
                        !visitedActivations.has(
                            activationIndex
                        )
                    ) {

                        queue.push({

                            type:
                                'A',

                            index:
                                activationIndex
                        });
                    }
                }

            } else {

                if (
                    visitedActivations.has(
                        node.index
                    )
                ) {

                    continue;
                }


                visitedActivations.add(
                    node.index
                );


                activationIndexes.add(
                    node.index
                );


                for (
                    const edgeIndex
                    of activationAdjacency.get(
                        node.index
                    )
                    ??
                    []
                ) {

                    edgeIndexes.add(
                        edgeIndex
                    );


                    const deathIndex =
                        edges[
                            edgeIndex
                        ].deathIndex;


                    if (
                        !visitedDeaths.has(
                            deathIndex
                        )
                    ) {

                        queue.push({

                            type:
                                'D',

                            index:
                                deathIndex
                        });
                    }
                }
            }
        }


        components.push({

            deathIndexes:
                [
                    ...deathIndexes
                ],

            activationIndexes:
                [
                    ...activationIndexes
                ],

            edgeIndexes:
                [
                    ...edgeIndexes
                ]
        });
    }


    return components;
}


// ============================================================
// EXACT LOCAL MIN-COST MAXIMUM MATCHING
//
// Successive shortest augmenting paths.
// Components are tiny because the telemetry window is only
// -1..+4 ticks.
// ============================================================

function solveComponentMinCostMatching(
    component,
    globalEdges
) {

    const deaths =
        component.deathIndexes;


    const activationsLocal =
        component.activationIndexes;


    if (
        deaths.length ===
        0
        ||
        activationsLocal.length ===
            0
    ) {

        return [];
    }


    const deathLocal =
        new Map(
            deaths.map(
                (
                    globalIndex,
                    localIndex
                ) => [
                    globalIndex,
                    localIndex
                ]
            )
        );


    const activationLocal =
        new Map(
            activationsLocal.map(
                (
                    globalIndex,
                    localIndex
                ) => [
                    globalIndex,
                    localIndex
                ]
            )
        );


    const deathCount =
        deaths.length;


    const activationCount =
        activationsLocal.length;


    const source =
        0;


    const deathOffset =
        1;


    const activationOffset =
        deathOffset +
        deathCount;


    const sink =
        activationOffset +
        activationCount;


    const graph =
        Array.from(
            {
                length:
                    sink +
                    1
            },
            () => []
        );


    for (
        let i =
            0;

        i <
            deathCount;

        i++
    ) {

        addFlowEdge(
            graph,
            source,
            deathOffset +
                i,
            1,
            0,
            null
        );
    }


    for (
        let i =
            0;

        i <
            activationCount;

        i++
    ) {

        addFlowEdge(
            graph,
            activationOffset +
                i,
            sink,
            1,
            0,
            null
        );
    }


    for (
        const edgeIndex
        of component.edgeIndexes
    ) {

        const edge =
            globalEdges[
                edgeIndex
            ];


        const localDeath =
            deathLocal.get(
                edge.deathIndex
            );


        const localActivation =
            activationLocal.get(
                edge.activationIndex
            );


        addFlowEdge(
            graph,
            deathOffset +
                localDeath,
            activationOffset +
                localActivation,
            1,
            edge.cost,
            {

                edgeIndex,

                deathIndex:
                    edge.deathIndex,

                activationIndex:
                    edge.activationIndex
            }
        );
    }


    // ========================================================
    // AUGMENT UNTIL NO SOURCE->SINK PATH EXISTS
    //
    // SPFA is intentionally used because local components are
    // tiny and reverse edges can have negative cost.
    // ========================================================

    while (
        true
    ) {

        const shortest =
            shortestPathSPFA(
                graph,
                source,
                sink
            );


        if (
            !shortest.reachable
        ) {

            break;
        }


        let node =
            sink;


        while (
            node !==
            source
        ) {

            const previousNode =
                shortest.previousNode[
                    node
                ];


            const edgeIndex =
                shortest.previousEdge[
                    node
                ];


            const edge =
                graph[
                    previousNode
                ][
                    edgeIndex
                ];


            edge.capacity -=
                1;


            graph[
                node
            ][
                edge.reverseIndex
            ].capacity +=
                1;


            node =
                previousNode;
        }
    }


    // ========================================================
    // EXTRACT USED DEATH->ACTIVATION EDGES
    // ========================================================

    const matches =
        [];


    for (
        let localDeath =
            0;

        localDeath <
            deathCount;

        localDeath++
    ) {

        const node =
            deathOffset +
            localDeath;


        for (
            const edge
            of graph[
                node
            ]
        ) {

            if (
                !edge.meta
            ) {

                continue;
            }


            // Original capacity was 1.
            // capacity 0 means flow currently occupies edge.
            if (
                edge.capacity !==
                0
            ) {

                continue;
            }


            const globalEdge =
                globalEdges[
                    edge.meta.edgeIndex
                ];


            matches.push({

                deathIndex:
                    edge.meta.deathIndex,

                activationIndex:
                    edge.meta.activationIndex,

                edge:
                    globalEdge
            });
        }
    }


    return matches;
}


// ============================================================
// FLOW EDGE
// ============================================================

function addFlowEdge(
    graph,
    from,
    to,
    capacity,
    cost,
    meta
) {

    const forward =
        {

            to,

            reverseIndex:
                graph[
                    to
                ].length,

            capacity,

            cost,

            meta
        };


    const reverse =
        {

            to:
                from,

            reverseIndex:
                graph[
                    from
                ].length,

            capacity:
                0,

            cost:
                -cost,

            meta:
                null
        };


    graph[
        from
    ].push(
        forward
    );


    graph[
        to
    ].push(
        reverse
    );
}


// ============================================================
// SPFA
// ============================================================

function shortestPathSPFA(
    graph,
    source,
    sink
) {

    const count =
        graph.length;


    const distance =
        Array(
            count
        ).fill(
            Infinity
        );


    const previousNode =
        Array(
            count
        ).fill(
            -1
        );


    const previousEdge =
        Array(
            count
        ).fill(
            -1
        );


    const inQueue =
        Array(
            count
        ).fill(
            false
        );


    const queue =
        [
            source
        ];


    distance[
        source
    ] =
        0;


    inQueue[
        source
    ] =
        true;


    let head =
        0;


    while (
        head <
        queue.length
    ) {

        const node =
            queue[
                head++
            ];


        inQueue[
            node
        ] =
            false;


        for (
            let edgeIndex =
                0;

            edgeIndex <
                graph[
                    node
                ].length;

            edgeIndex++
        ) {

            const edge =
                graph[
                    node
                ][
                    edgeIndex
                ];


            if (
                edge.capacity <=
                0
            ) {

                continue;
            }


            const nextDistance =
                distance[
                    node
                ]
                +
                edge.cost;


            if (
                nextDistance >=
                distance[
                    edge.to
                ]
            ) {

                continue;
            }


            distance[
                edge.to
            ] =
                nextDistance;


            previousNode[
                edge.to
            ] =
                node;


            previousEdge[
                edge.to
            ] =
                edgeIndex;


            if (
                !inQueue[
                    edge.to
                ]
            ) {

                queue.push(
                    edge.to
                );


                inQueue[
                    edge.to
                ] =
                    true;
            }
        }
    }


    return {

        reachable:
            Number.isFinite(
                distance[
                    sink
                ]
            ),

        distance,

        previousNode,

        previousEdge
    };
}


// ============================================================
// MATCH OUTPUT
// ============================================================

function buildMatchOutput(
    death,
    activation,
    edge,
    deathCandidateCount,
    activationCandidateCount
) {

    const target =
        activation.firstValidVacuumTarget;


    let confidence =
        'MODERATE';


    if (
        edge.tickDelta ===
            0
        &&
        edge.distance3D <=
            80
        &&
        (
            deathCandidateCount ===
                1
            ||
            activationCandidateCount ===
                1
        )
    ) {

        confidence =
            'HIGH';
    }


    if (
        edge.tickDelta ===
            0
        &&
        edge.distance3D <=
            60
        &&
        deathCandidateCount ===
            1
        &&
        activationCandidateCount ===
            1
    ) {

        confidence =
            'VERY_HIGH';
    }


    return {

        schemaVersion:
            1,

        canonical:
            false,

        trooper:
            {

                deathIndex:
                    death.deathIndex,

                deathKey:
                    death.deathKey,

                lifeId:
                    death.lifeId,

                entityIndex:
                    death.entityIndex,

                baseType:
                    death.baseType,

                subclassId:
                    death.subclassId,

                variantLabel:
                    death.variantLabel,

                isSuper:
                    death.isSuper,

                isRift:
                    death.isRift,

                team:
                    death.team,

                lane:
                    death.lane,

                maxHealth:
                    death.maxHealth,

                position:
                    death.position,

                tick:
                    death.tick,

                timeSeconds:
                    death.timeSeconds,

                clock:
                    death.clock
            },

        groundSoul:
            {

                activationIndex:
                    activation.activationIndex,

                activationId:
                    activation.activationId,

                entityIndex:
                    activation.entityIndex,

                activationTick:
                    activation.activationTick,

                activationTimeSeconds:
                    activation.activationTimeSeconds,

                activationClock:
                    activation.activationClock,

                team:
                    activation.team,

                subclassId:
                    activation.subclassId,

                position:
                    activation.position,

                startSignals:
                    activation.startSignals,

                durationSeconds:
                    activation.durationSeconds,

                endReason:
                    activation.endReason,

                vacuumTargetHandle:
                    target
                        ?.handle
                    ??
                    null,

                vacuumTargetEntityIndex:
                    target
                        ?.decodedEntityIndex
                    ??
                    null,

                vacuumTargetPlayer:
                    target
                        ?.player
                    ??
                    null,

                vacuumTargetTick:
                    target
                        ?.tick
                    ??
                    null
            },

        match:
            {

                status:
                    'ONE_TO_ONE_ASSIGNED_GOLD_MATCH',

                confidence,

                tickDelta:
                    edge.tickDelta,

                secondsDelta:
                    edge.tickDelta /
                    TICK_RATE,

                distance3D:
                    edge.distance3D,

                distanceXY:
                    edge.distanceXY,

                verticalDelta:
                    edge.verticalDelta,

                cost:
                    edge.cost,

                deathCandidateCount,

                activationCandidateCount
            }
    };
}


// ============================================================
// LOAD JSONL
// ============================================================

async function loadJsonl(
    path
) {

    const result =
        [];


    const reader =
        createInterface({

            input:
                createReadStream(
                    path,
                    {
                        encoding:
                            'utf8'
                    }
                ),

            crlfDelay:
                Infinity
        });


    for await (
        const line
        of reader
    ) {

        if (
            !line.trim()
        ) {

            continue;
        }


        try {

            result.push(
                JSON.parse(
                    line
                )
            );

        } catch {

            // Ignore malformed line.
        }
    }


    return result;
}


// ============================================================
// PLAYER PAWN MAP
// ============================================================

async function loadPlayerPawnMap(
    path
) {

    const output =
        new Map();


    const reader =
        createInterface({

            input:
                createReadStream(
                    path,
                    {
                        encoding:
                            'utf8'
                    }
                ),

            crlfDelay:
                Infinity
        });


    for await (
        const line
        of reader
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
// ENTITY OPERATION
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


    const text =
        String(
            code
            ??
            'UNKNOWN'
        )
        .toUpperCase();


    if (
        text.includes(
            'CREATE'
        )
    ) {

        return 'CREATE';
    }


    if (
        text.includes(
            'UPDATE'
        )
    ) {

        return 'UPDATE';
    }


    if (
        text.includes(
            'LEAVE'
        )
    ) {

        return 'LEAVE';
    }


    if (
        text.includes(
            'DELETE'
        )
    ) {

        return 'DELETE';
    }


    return text;
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


        if (
            value <=
                0n
            ||
            value ===
                16777215n
        ) {

            return false;
        }


        return true;

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
// COUNTS
// ============================================================

function countBy(
    rows,
    keyFn
) {

    const result =
        new Map();


    for (
        const row
        of rows
    ) {

        increment(
            result,
            keyFn(
                row
            )
        );
    }


    return result;
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


    const weight =
        position -
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


function maximumOrZero(
    values
) {

    const clean =
        values.filter(
            Number.isFinite
        );


    return clean.length >
        0
        ? Math.max(
            ...clean
        )
        : 0;
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


function formatNumber(
    value
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return 'n/a';
    }


    return value.toFixed(
        3
    );
}


// ============================================================
// WRITER FINISH
// ============================================================

function finishWriter(
    writer
) {

    return new Promise(
        (
            resolvePromise,
            rejectPromise
        ) => {

            writer.on(
                'error',
                rejectPromise
            );


            writer.end(
                resolvePromise
            );
        }
    );
}