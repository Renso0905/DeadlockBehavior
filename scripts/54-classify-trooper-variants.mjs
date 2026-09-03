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


// ============================================================
// CURRENT TELEMETRY / MECHANIC MODEL
//
// Base HP:
// Ranged = 300
// Medic  = 350
// Melee  = 400
//
// At 35:00:
// all Troopers receive +50% HP.
//
// Super:
// +40% HP.
//
// Rift:
// Event 1 = +100% HP  -> total 2.0x
// Event 2 = +120% HP  -> total 2.2x
// Event 3 = +140% HP  -> total 2.4x
// Event 4+ = +160% HP -> total 2.6x
//
// These modifiers may compound.
// ============================================================

const BASE_HP =
    {

        RANGED:
            300,

        MEDIC:
            350,

        MELEE:
            400
    };


const GLOBAL_HP_BOOST_TIME =
    35 *
    60;


const GLOBAL_HP_MULTIPLIER =
    1.50;


const SUPER_HP_MULTIPLIER =
    1.40;


const RIFT_STAGE_MULTIPLIERS =
    {

        1:
            2.00,

        2:
            2.20,

        3:
            2.40,

        4:
            2.60
    };


// ============================================================
// HP MATCH TOLERANCE
//
// We observed e.g. 961 where exact arithmetic predicts 960.
//
// Allow:
// - at least 3 HP absolute difference
// - or 1% relative difference
// ============================================================

const MIN_HP_TOLERANCE =
    3;


const RELATIVE_HP_TOLERANCE =
    0.01;


// ============================================================
// RIFT SPAWN-COHORT DISCOVERY
//
// Current Rift rewards produce at least 5 Troopers.
//
// They appear together in one team/lane and should have one
// common Rift stage.
// ============================================================

const RIFT_MIN_COHORT_SIZE =
    5;


const RIFT_COHORT_MAX_GAP_SECONDS =
    2.5;


const RIFT_COHORT_MAX_SPAN_SECONDS =
    12;


const RIFT_COHORT_MAX_SPAWN_SPREAD =
    600;


// ============================================================
// OUTPUT LIMITS
// ============================================================

const MAX_COHORT_MEMBER_EXAMPLES =
    30;


const MAX_UNKNOWN_HP_EXAMPLES =
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


const typeSummaryPath =
    resolve(
        'output',
        replayName,
        'trooper_type_classification_v01.json'
    );


const groundSoulPath =
    resolve(
        'output',
        replayName,
        'trooper_ground_soul_candidates.jsonl'
    );


const outputSummaryPath =
    resolve(
        'output',
        replayName,
        'trooper_variant_classification_v01.json'
    );


const outputLivesPath =
    resolve(
        'output',
        replayName,
        'trooper_lives_typed_v02.jsonl'
    );


const outputDeathsPath =
    resolve(
        'output',
        replayName,
        'trooper_deaths_typed_v02.jsonl'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        replayPath,
        typeSummaryPath,
        groundSoulPath
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
// LOAD TYPE SUMMARY
// ============================================================

const typeSummary =
    JSON.parse(
        readFileSync(
            typeSummaryPath,
            'utf8'
        )
    );


if (
    typeSummary
        ?.validation
        ?.pass !==
    true
) {

    throw new Error(
        'Script 52 classification did not pass validation.'
    );
}


// ============================================================
// BASE-TYPE MAP
// ============================================================

const baseTypeBySubclass =
    new Map();


for (
    const [
        subclassId,
        mapping
    ]
    of Object.entries(
        typeSummary
            ?.provisionalMapping
        ??
        {}
    )
) {

    baseTypeBySubclass.set(
        String(
            subclassId
        ),
        mapping
            ?.baseType
        ??
        'UNKNOWN'
    );
}


// ============================================================
// LOAD GROUND-SOUL MATCH KEYS
//
// IMPORTANT:
//
// Script 51 matches are still proximity associations.
//
// A Rift Trooper may appear matched if a nearby normal Trooper
// produced the AssignedGold object.
//
// Therefore:
//
// groundSoulMatched is retained as observation,
// NOT used as the primary Rift classifier here.
// ============================================================

console.log('');

console.log(
    'Loading AssignedGold death associations...'
);


const groundSoulByDeathKey =
    new Map();


const soulReader =
    createInterface({

        input:
            createReadStream(
                groundSoulPath,
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
    of soulReader
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


    const entityIndex =
        finite(
            row
                ?.trooper
                ?.entityIndex
        );


    const tick =
        finite(
            row
                ?.trooper
                ?.tick
        );


    if (
        entityIndex ===
            null
        ||
        tick ===
            null
    ) {

        continue;
    }


    groundSoulByDeathKey.set(
        makeDeathKey(
            entityIndex,
            tick
        ),
        row
    );
}


console.log(
    `Loaded AssignedGold associations: ${groundSoulByDeathKey.size}`
);


// ============================================================
// TROOPER STATE
// ============================================================

const previousByEntity =
    new Map();


const sequenceByEntity =
    new Map();


const currentLifeByEntity =
    new Map();


const lifeStarts =
    [];


const deaths =
    [];


const uniqueTrooperIndexes =
    new Set();


let trooperEvents =
    0;


let healthDeathTransitions =
    0;


let lifeDeathTransitions =
    0;


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
                'CNPC_Trooper'
            ) {

                continue;
            }


            processTrooper(
                entity,
                tick
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
    'TROOPER VARIANT CLASSIFICATION V0.1'
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
    'Variant dimensions:'
);

console.log(
    '  baseType = RANGED / MEDIC / MELEE'
);

console.log(
    '  isSuper'
);

console.log(
    '  isRift'
);

console.log(
    '  riftStage'
);

console.log(
    '  global35MinuteHpBoost'
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// ENRICH DEATH SOUL OBSERVATION
// ============================================================

for (
    const death
    of deaths
) {

    death.groundSoulAssociation =
        groundSoulByDeathKey.get(
            death.deathKey
        )
        ??
        null;


    death.groundSoulMatched =
        Boolean(
            death.groundSoulAssociation
        );
}


// ============================================================
// LINK DEATHS BACK TO LIVES
// ============================================================

const lifeById =
    new Map(
        lifeStarts.map(
            life => [
                life.lifeId,
                life
            ]
        )
    );


for (
    const death
    of deaths
) {

    if (
        !death.lifeId
    ) {

        continue;
    }


    const life =
        lifeById.get(
            death.lifeId
        );


    if (
        !life
    ) {

        continue;
    }


    life.death =
        {

            tick:
                death.tick,

            timeSeconds:
                death.timeSeconds,

            clock:
                death.clock,

            maxHealth:
                death.maxHealth,

            hpPattern:
                death.hpPattern,

            groundSoulMatched:
                death.groundSoulMatched
        };
}


// ============================================================
// VARIANT COUNTS AT LIFE START
// ============================================================

const lifeVariantCounts =
    countBy(
        lifeStarts,
        life =>
            life
                ?.hpPattern
                ?.label
            ??
            'UNRESOLVED'
    );


// ============================================================
// VARIANT COUNTS AT DEATH
// ============================================================

const deathVariantCounts =
    countBy(
        deaths,
        death =>
            death
                ?.hpPattern
                ?.label
            ??
            'UNRESOLVED'
    );


// ============================================================
// RIFT LIFE CANDIDATES
// ============================================================

const riftLifeCandidates =
    lifeStarts

        .filter(
            life =>
                life.timeSeconds >=
                    0
                &&
                life
                    ?.hpPattern
                    ?.isRift ===
                    true
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
// BUILD RIFT SPAWN COHORTS
// ============================================================

const rawRiftCohorts =
    buildRiftCohorts(
        riftLifeCandidates
    );


const riftCohorts =
    rawRiftCohorts.map(
        (
            cohort,
            index
        ) =>
            summarizeRiftCohort(
                cohort,
                index
            )
    );


// ============================================================
// HIGH-CONFIDENCE RIFT COHORTS
// ============================================================

const confirmedRiftCohorts =
    riftCohorts.filter(
        cohort =>
            cohort.highConfidenceRiftCohort
    );


// ============================================================
// ASSIGN COHORT IDS TO LIVES
// ============================================================

const riftCohortByLifeId =
    new Map();


for (
    const cohort
    of confirmedRiftCohorts
) {

    for (
        const lifeId
        of cohort.lifeIds
    ) {

        riftCohortByLifeId.set(
            lifeId,
            cohort.cohortId
        );
    }
}


// ============================================================
// ATTACH COHORT TO LIFE / DEATH
// ============================================================

for (
    const life
    of lifeStarts
) {

    life.riftCohortId =
        riftCohortByLifeId.get(
            life.lifeId
        )
        ??
        null;
}


for (
    const death
    of deaths
) {

    death.riftCohortId =
        death.lifeId
            ? (
                riftCohortByLifeId.get(
                    death.lifeId
                )
                ??
                null
            )
            : null;
}


// ============================================================
// RIFT EVENT SEQUENCE
// ============================================================

const riftSequence =
    confirmedRiftCohorts

        .sort(
            (
                a,
                b
            ) =>
                a.firstLifeStartSeconds -
                b.firstLifeStartSeconds
        )

        .map(
            (
                cohort,
                index,
                all
            ) => ({

                eventIndex:
                    index +
                    1,

                cohortId:
                    cohort.cohortId,

                inferredStageFromHP:
                    cohort.riftStage,

                team:
                    cohort.team,

                lane:
                    cohort.lane,

                trooperCount:
                    cohort.memberCount,

                firstLifeStartSeconds:
                    cohort.firstLifeStartSeconds,

                firstLifeStartClock:
                    cohort.firstLifeStartClock,

                lastLifeStartSeconds:
                    cohort.lastLifeStartSeconds,

                spawnSpanSeconds:
                    cohort.spawnSpanSeconds,

                secondsSincePrevious:
                    index >
                        0
                        ? (
                            cohort.firstLifeStartSeconds -
                            all[
                                index -
                                1
                            ].firstLifeStartSeconds
                        )
                        : null,

                minutesSincePrevious:
                    index >
                        0
                        ? (
                            (
                                cohort.firstLifeStartSeconds -
                                all[
                                    index -
                                    1
                                ].firstLifeStartSeconds
                            )
                            /
                            60
                        )
                        : null,

                baseTypeCounts:
                    cohort.baseTypeCounts,

                hpPatternCounts:
                    cohort.hpPatternCounts,

                AssignedGoldAssociationsAtDeath:
                    cohort.groundSoulMatchedDeaths,

                deathsObserved:
                    cohort.deathsObserved,

                note:
                    'Cohort spawn time is observed directly. Exact Rift capture time is not claimed without a direct Rift event.'
            })
        );


// ============================================================
// SUPER TROOPER OBSERVATIONS
// ============================================================

const superLives =
    lifeStarts.filter(
        life =>
            life
                ?.hpPattern
                ?.isSuper ===
            true
    );


const superDeaths =
    deaths.filter(
        death =>
            death
                ?.hpPattern
                ?.isSuper ===
            true
    );


// ============================================================
// FIRST SUPER OBSERVATION BY TEAM/LANE
// ============================================================

const firstSuperByTeamLane =
    new Map();


for (
    const life
    of superLives
        .slice()
        .sort(
            (
                a,
                b
            ) =>
                a.timeSeconds -
                b.timeSeconds
        )
) {

    const key =
        `${life.team}|${life.lane}`;


    if (
        !firstSuperByTeamLane.has(
            key
        )
    ) {

        firstSuperByTeamLane.set(
            key,
            {

                team:
                    life.team,

                lane:
                    life.lane,

                lifeId:
                    life.lifeId,

                entityIndex:
                    life.entityIndex,

                baseType:
                    life.baseType,

                timeSeconds:
                    life.timeSeconds,

                clock:
                    life.clock,

                maxHealth:
                    life.maxHealth,

                hpPattern:
                    life.hpPattern,

                interpretation:
                    'Super status is observed by the HP multiplier. Shrine destruction must have occurred at or before this observation; exact destruction time is not inferred here.'
            }
        );
    }
}


// ============================================================
// SUPER COUNTS BY TEAM/LANE
// ============================================================

const superCountsByTeamLane =
    new Map();


for (
    const death
    of superDeaths
) {

    increment(
        superCountsByTeamLane,
        `${death.team}|${death.lane}`
    );
}


// ============================================================
// UNRESOLVED HP PATTERNS
// ============================================================

const unresolvedLifePatterns =
    lifeStarts

        .filter(
            life =>
                life
                    ?.hpPattern
                    ?.resolved !==
                true
        )

        .slice(
            0,
            MAX_UNKNOWN_HP_EXAMPLES
        );


const unresolvedDeathPatterns =
    deaths

        .filter(
            death =>
                death
                    ?.hpPattern
                    ?.resolved !==
                true
        )

        .slice(
            0,
            MAX_UNKNOWN_HP_EXAMPLES
        );


// ============================================================
// NONSTANDARD 1-HP SUBCLASS ASSESSMENT
// ============================================================

const nonStandardAssessment =
    [];


for (
    const evidence
    of typeSummary
        ?.subclassEvidence
    ??
    []
) {

    const subclassId =
        String(
            evidence.subclassId
        );


    const baseType =
        baseTypeBySubclass.get(
            subclassId
        )
        ??
        'UNKNOWN';


    if (
        baseType !==
        'NON_STANDARD_TROOPER_CANDIDATE'
    ) {

        continue;
    }


    const modalHP =
        finite(
            evidence
                ?.maxHealth
                ?.modalAll
        );


    const soulRate =
        finite(
            evidence
                ?.groundSoulMatchRate
        );


    let candidateInterpretation =
        'UNKNOWN_NON_ECONOMIC_TROOPER_OBJECT';


    if (
        modalHP ===
            1
        &&
        soulRate !==
            null
        &&
        soulRate <
            0.01
    ) {

        candidateInterpretation =
            'ONE_HP_NON_ECONOMIC_TROOPER_OBJECT';
    }


    nonStandardAssessment.push({

        subclassId,

        modalMaxHealth:
            modalHP,

        deaths:
            evidence.deaths,

        lifeStarts:
            evidence.lifeStarts,

        groundSoulMatchRate:
            soulRate,

        candidateInterpretation,

        excludedFromNormalLaneTrooperEconomy:
            true,

        note:
            'Do not treat this subclass as Ranged, Medic, Melee, Super, or Rift until its exact helper/entity role is directly validated.'
    });
}


// ============================================================
// VALIDATION
// ============================================================

const baseTypeCounts =
    new Map();


for (
    const life
    of lifeStarts
) {

    increment(
        baseTypeCounts,
        life.baseType
    );
}


const riftStagesObserved =
    [
        ...new Set(
            confirmedRiftCohorts.map(
                row =>
                    row.riftStage
            )
        )
    ]
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


const riftStageSequenceNonDecreasing =
    isNonDecreasing(
        riftSequence.map(
            row =>
                row.inferredStageFromHP
        )
    );


const validation =
    {

        priorTypeClassificationPass:
            {

                actual:
                    typeSummary
                        ?.validation
                        ?.pass,

                expected:
                    true,

                pass:
                    typeSummary
                        ?.validation
                        ?.pass ===
                    true
            },

        trooperDeaths:
            {

                actual:
                    deaths.length,

                expected:
                    replayName ===
                        'test'
                        ? 4812
                        : '>0',

                pass:
                    replayName ===
                        'test'

                        ? deaths.length ===
                            4812

                        : deaths.length >
                            0
            },

        dualDeathSignals:
            {

                actual:
                    healthDeathTransitions ===
                        deaths.length
                    &&
                    lifeDeathTransitions ===
                        deaths.length,

                expected:
                    true,

                pass:
                    healthDeathTransitions ===
                        deaths.length
                    &&
                    lifeDeathTransitions ===
                        deaths.length
            },

        normalBaseTypesPresent:
            {

                actual:
                    [
                        baseTypeCounts.has(
                            'RANGED'
                        ),
                        baseTypeCounts.has(
                            'MEDIC'
                        ),
                        baseTypeCounts.has(
                            'MELEE'
                        )
                    ],

                expected:
                    [
                        true,
                        true,
                        true
                    ],

                pass:
                    baseTypeCounts.has(
                        'RANGED'
                    )
                    &&
                    baseTypeCounts.has(
                        'MEDIC'
                    )
                    &&
                    baseTypeCounts.has(
                        'MELEE'
                    )
            },

        riftHpPatternsObserved:
            {

                actual:
                    riftLifeCandidates.length,

                expected:
                    '>0',

                pass:
                    riftLifeCandidates.length >
                    0
            },

        riftCohortsObserved:
            {

                actual:
                    confirmedRiftCohorts.length,

                expected:
                    '>0',

                pass:
                    confirmedRiftCohorts.length >
                    0
            },

        riftStagesProgressMonotonically:
            {

                actual:
                    riftStageSequenceNonDecreasing,

                expected:
                    true,

                pass:
                    riftStageSequenceNonDecreasing
            },

        superHpPatternsObserved:
            {

                actual:
                    superLives.length,

                expected:
                    '>0',

                pass:
                    superLives.length >
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
// WRITE LIFE STREAM
// ============================================================

mkdirSync(
    dirname(
        outputLivesPath
    ),
    {
        recursive: true
    }
);


const lifeWriter =
    createWriteStream(
        outputLivesPath,
        {
            encoding:
                'utf8'
        }
    );


for (
    const life
    of lifeStarts
) {

    lifeWriter.write(
        JSON.stringify({

            schemaVersion:
                2,

            canonical:
                false,

            lifeId:
                life.lifeId,

            entityIndex:
                life.entityIndex,

            sequence:
                life.sequence,

            timing:
                {

                    tick:
                        life.tick,

                    timeSeconds:
                        life.timeSeconds,

                    clock:
                        life.clock
                },

            trooper:
                {

                    subclassId:
                        life.subclassId,

                    baseType:
                        life.baseType,

                    team:
                        life.team,

                    lane:
                        life.lane,

                    maxHealth:
                        life.maxHealth,

                    position:
                        life.position
                },

            variant:
                {

                    ...life.hpPattern,

                    riftCohortId:
                        life.riftCohortId
                },

            death:
                life.death
                ??
                null
        })
        +
        '\n'
    );
}


await finishWriter(
    lifeWriter
);


// ============================================================
// WRITE DEATH STREAM
// ============================================================

mkdirSync(
    dirname(
        outputDeathsPath
    ),
    {
        recursive: true
    }
);


const deathWriter =
    createWriteStream(
        outputDeathsPath,
        {
            encoding:
                'utf8'
        }
    );


for (
    const death
    of deaths
) {

    deathWriter.write(
        JSON.stringify({

            schemaVersion:
                2,

            canonical:
                false,

            deathKey:
                death.deathKey,

            lifeId:
                death.lifeId,

            entityIndex:
                death.entityIndex,

            timing:
                {

                    tick:
                        death.tick,

                    timeSeconds:
                        death.timeSeconds,

                    clock:
                        death.clock
                },

            trooper:
                {

                    subclassId:
                        death.subclassId,

                    baseType:
                        death.baseType,

                    team:
                        death.team,

                    lane:
                        death.lane,

                    maxHealth:
                        death.maxHealth,

                    position:
                        death.position
                },

            variant:
                {

                    ...death.hpPattern,

                    riftCohortId:
                        death.riftCohortId
                },

            economy:
                {

                    AssignedGoldProximityAssociation:
                        death.groundSoulMatched,

                    AssignedGoldAssociationKey:
                        death.groundSoulMatched
                            ? death.deathKey
                            : null,

                    importantCaveat:
                        death
                            ?.hpPattern
                            ?.isRift

                            ? 'Rift Troopers are expected to yield no souls. Any AssignedGold proximity match here must be treated as possible cross-match contamination until one-to-one soul assignment is implemented.'

                            : null
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
            'TROOPER_VARIANT_CLASSIFICATION_V01',

        canonical:
            false,

        status:
            validationPass
                ? 'PROVISIONAL_VARIANT_CLASSIFICATION'
                : 'DIAGNOSTIC_VARIANT_CLASSIFICATION',

        ontology:
            {

                baseType:
                    [
                        'RANGED',
                        'MEDIC',
                        'MELEE'
                    ],

                independentVariantDimensions:
                    {

                        isSuper:
                            'Permanent lane upgrade after enemy Shrine destruction.',

                        isRift:
                            'Special Trooper generated by an Unstable Rift capture.',

                        riftStage:
                            'Rift health/damage stage inferred from exact HP multiplier.',

                        global35MinuteHpBoost:
                            'Global +50% Trooper HP state after 35:00.'
                    },

                important:
                    'Rift and Super are not forced into one mutually exclusive category. Compound RIFT+SUPER patterns are retained.'
            },

        hpModel:
            {

                baseHP:
                    BASE_HP,

                globalBoost:
                    {

                        startsAtSeconds:
                            GLOBAL_HP_BOOST_TIME,

                        startsAtClock:
                            formatClock(
                                GLOBAL_HP_BOOST_TIME
                            ),

                        multiplier:
                            GLOBAL_HP_MULTIPLIER
                    },

                superMultiplier:
                    SUPER_HP_MULTIPLIER,

                riftStageMultipliers:
                    RIFT_STAGE_MULTIPLIERS,

                examples:
                    {

                        rangedNormalEarly:
                            300,

                        rangedNormalAfter35:
                            450,

                        rangedSuperAfter35:
                            630,

                        rangedRift1Before35:
                            600,

                        rangedRift2Before35:
                            660,

                        rangedRift3Before35:
                            720,

                        rangedRift4Before35:
                            780,

                        rangedRift4After35:
                            1170,

                        rangedRift4SuperAfter35:
                            1638
                    }
            },

        sourceCounts:
            {

                trooperEvents,

                uniqueTrooperIndexes:
                    uniqueTrooperIndexes.size,

                lifeStarts:
                    lifeStarts.length,

                deaths:
                    deaths.length,

                AssignedGoldAssociationsLoaded:
                    groundSoulByDeathKey.size
            },

        baseTypeCounts:
            mapToSortedObject(
                baseTypeCounts
            ),

        variantCounts:
            {

                lifeStart:
                    mapToSortedObject(
                        lifeVariantCounts
                    ),

                death:
                    mapToSortedObject(
                        deathVariantCounts
                    )
            },

        rift:
            {

                riftPatternLives:
                    riftLifeCandidates.length,

                rawCohorts:
                    riftCohorts.length,

                highConfidenceCohorts:
                    confirmedRiftCohorts.length,

                stagesObserved:
                    riftStagesObserved,

                cohorts:
                    riftCohorts,

                inferredEventSequence:
                    riftSequence,

                interpretation:
                    'Rift cohorts are inferred from synchronized groups of >=5 Trooper lives with exact Rift HP multipliers. This avoids dependence on an explicit replay event name, which has not yet been found.'
            },

        super:
            {

                lifeStartPatterns:
                    superLives.length,

                deathPatterns:
                    superDeaths.length,

                deathCountsByTeamLane:
                    mapToSortedObject(
                        superCountsByTeamLane
                    ),

                firstObservedByTeamLane:
                    [
                        ...firstSuperByTeamLane.values()
                    ]
                    .sort(
                        (
                            a,
                            b
                        ) =>
                            a.timeSeconds -
                            b.timeSeconds
                    ),

                interpretation:
                    'The HP multiplier identifies Super state directly. First observed Super life is only a lower-bound marker for Shrine destruction; exact Shrine destruction telemetry should be validated separately.'
            },

        nonStandardTrooperObjects:
            nonStandardAssessment,

        unresolved:
            {

                lifePatternCount:
                    lifeStarts.filter(
                        row =>
                            row
                                ?.hpPattern
                                ?.resolved !==
                            true
                    ).length,

                deathPatternCount:
                    deaths.filter(
                        row =>
                            row
                                ?.hpPattern
                                ?.resolved !==
                            true
                    ).length,

                lifeExamples:
                    unresolvedLifePatterns,

                deathExamples:
                    unresolvedDeathPatterns
            },

        nextCriticalEconomyIssue:
            {

                issue:
                    'AssignedGold matches are not yet one-to-one.',

                consequence:
                    'A single AssignedGold activation can potentially be proximity-matched to multiple simultaneous nearby Trooper deaths.',

                nextAction:
                    'After variant classification, rebuild ground-soul attribution as a one-to-one death-to-AssignedGold assignment before calculating missed soul percentages.'
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

                lifeStream:
                    outputLivesPath,

                deathStream:
                    outputDeathsPath
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
    'BASE TYPES'
);

console.log(
    '----------'
);


for (
    const [
        key,
        value
    ]
    of Object.entries(
        mapToSortedObject(
            baseTypeCounts
        )
    )
) {

    console.log(
        `${key.padEnd(
            36
        )} ${value}`
    );
}


console.log('');

console.log(
    'VARIANT PATTERNS AT DEATH'
);

console.log(
    '-------------------------'
);


for (
    const [
        key,
        value
    ]
    of Object.entries(
        mapToSortedObject(
            deathVariantCounts
        )
    )
) {

    console.log(
        `${key.padEnd(
            36
        )} ${value}`
    );
}


console.log('');

console.log(
    'HIGH-CONFIDENCE RIFT COHORTS'
);

console.log(
    '----------------------------'
);


if (
    confirmedRiftCohorts.length ===
    0
) {

    console.log(
        'None detected.'
    );

} else {

    for (
        const cohort
        of confirmedRiftCohorts
    ) {

        console.log(
            `${
                cohort.cohortId.padEnd(
                    12
                )
            } time=${
                String(
                    cohort.firstLifeStartClock
                ).padStart(
                    6
                )
            } team=${
                String(
                    cohort.team
                ).padStart(
                    2
                )
            } lane=${
                String(
                    cohort.lane
                ).padStart(
                    2
                )
            } stage=${
                String(
                    cohort.riftStage
                ).padStart(
                    2
                )
            } n=${
                String(
                    cohort.memberCount
                ).padStart(
                    2
                )
            } span=${
                cohort.spawnSpanSeconds.toFixed(
                    2
                )
            }s soulAssoc=${
                cohort.groundSoulMatchedDeaths
            }/${
                cohort.deathsObserved
            }`
        );
    }
}


console.log('');

console.log(
    'INFERRED RIFT EVENT SEQUENCE'
);

console.log(
    '----------------------------'
);


for (
    const event
    of riftSequence
) {

    console.log(
        `#${
            event.eventIndex
        } ${
            event.firstLifeStartClock
        } team=${
            event.team
        } lane=${
            event.lane
        } stage=${
            event.inferredStageFromHP
        } troopers=${
            event.trooperCount
        }${
            event.minutesSincePrevious !==
                null
                ? ` Δ=${event.minutesSincePrevious.toFixed(
                    2
                )}m`
                : ''
        }`
    );
}


console.log('');

console.log(
    'FIRST SUPER OBSERVATIONS'
);

console.log(
    '------------------------'
);


for (
    const row
    of [
        ...firstSuperByTeamLane.values()
    ]
    .sort(
        (
            a,
            b
        ) =>
            a.timeSeconds -
            b.timeSeconds
    )
) {

    console.log(
        `team=${
            row.team
        } lane=${
            row.lane
        } first=${
            row.clock
        } type=${
            row.baseType
        } hp=${
            row.maxHealth
        } pattern=${
            row.hpPattern.label
        }`
    );
}


console.log('');

console.log(
    'NONSTANDARD CNPC_TROOPER SUBCLASSES'
);

console.log(
    '-----------------------------------'
);


for (
    const row
    of nonStandardAssessment
) {

    console.log(
        `${
            row.subclassId.padEnd(
                16
            )
        } HP=${
            row.modalMaxHealth
        } deaths=${
            row.deaths
        } soul=${
            formatPercent(
                row.groundSoulMatchRate
            )
        } => ${
            row.candidateInterpretation
        }`
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
                38
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
    `Lives:\n${outputLivesPath}`
);

console.log('');

console.log(
    `Deaths:\n${outputDeathsPath}`
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
            `Trooper events: ${
                trooperEvents.toLocaleString()
            } | lives=${
                lifeStarts.length
            } | deaths=${
                deaths.length
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


    uniqueTrooperIndexes.add(
        entityIndex
    );


    const subclassId =
        serializeScalar(
            safeGetField(
                entity,
                'm_nSubclassID'
            )
        );


    const subclassKey =
        String(
            subclassId
            ??
            'UNKNOWN'
        );


    const baseType =
        baseTypeBySubclass.get(
            subclassKey
        )
        ??
        'UNKNOWN';


    const current =
        {

            health:
                finite(
                    safeGetField(
                        entity,
                        'm_iHealth'
                    )
                ),

            maxHealth:
                finite(
                    safeGetField(
                        entity,
                        'm_iMaxHealth'
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

            subclassId,

            baseType,

            position:
                getWorldPosition(
                    entity
                )
        };


    const previous =
        previousByEntity.get(
            entityIndex
        )
        ??
        null;


    // ========================================================
    // LIFE START
    // ========================================================

    const firstAlive =
        !previous
        &&
        current.health !==
            null
        &&
        current.health >
            0;


    const healthRespawn =
        previous
        &&
        previous.health !==
            null
        &&
        current.health !==
            null
        &&
        previous.health <=
            0
        &&
        current.health >
            0;


    const lifeRespawn =
        previous
        &&
        previous.lifeState !==
            null
        &&
        current.lifeState !==
            null
        &&
        previous.lifeState !==
            0
        &&
        current.lifeState ===
            0;


    if (
        firstAlive
        ||
        healthRespawn
        ||
        lifeRespawn
    ) {

        const nextSequence =
            (
                sequenceByEntity.get(
                    entityIndex
                )
                ??
                0
            )
            +
            1;


        sequenceByEntity.set(
            entityIndex,
            nextSequence
        );


        const lifeId =
            `${entityIndex}|${nextSequence}`;


        const timeSeconds =
            tickToMatchTime(
                tick
            );


        const life =
            {

                lifeId,

                entityIndex,

                sequence:
                    nextSequence,

                tick,

                timeSeconds,

                clock:
                    formatClock(
                        timeSeconds
                    ),

                subclassId:
                    subclassKey,

                baseType,

                team:
                    current.team,

                lane:
                    current.lane,

                health:
                    current.health,

                maxHealth:
                    current.maxHealth,

                position:
                    current.position,

                hpPattern:
                    classifyHpPattern(
                        baseType,
                        current.maxHealth,
                        timeSeconds
                    ),

                death:
                    null,

                riftCohortId:
                    null
            };


        lifeStarts.push(
            life
        );


        currentLifeByEntity.set(
            entityIndex,
            lifeId
        );
    }


    // ========================================================
    // DEATH
    // ========================================================

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

            const timeSeconds =
                tickToMatchTime(
                    tick
                );


            const finalBaseType =
                current.baseType !==
                    'UNKNOWN'
                    ? current.baseType
                    : previous.baseType;


            const finalMaxHealth =
                current.maxHealth
                ??
                previous.maxHealth;


            deaths.push({

                deathKey:
                    makeDeathKey(
                        entityIndex,
                        tick
                    ),

                lifeId:
                    currentLifeByEntity.get(
                        entityIndex
                    )
                    ??
                    null,

                entityIndex,

                tick,

                timeSeconds,

                clock:
                    formatClock(
                        timeSeconds
                    ),

                subclassId:
                    String(
                        current.subclassId
                        ??
                        previous.subclassId
                        ??
                        'UNKNOWN'
                    ),

                baseType:
                    finalBaseType,

                team:
                    current.team
                    ??
                    previous.team,

                lane:
                    current.lane
                    ??
                    previous.lane,

                maxHealth:
                    finalMaxHealth,

                previousHealth:
                    previous.health,

                position:
                    current.position
                    ??
                    previous.position,

                hpPattern:
                    classifyHpPattern(
                        finalBaseType,
                        finalMaxHealth,
                        timeSeconds
                    ),

                groundSoulAssociation:
                    null,

                groundSoulMatched:
                    false,

                riftCohortId:
                    null
            });
        }
    }


    previousByEntity.set(
        entityIndex,
        current
    );
}


// ============================================================
// HP PATTERN CLASSIFIER
// ============================================================

function classifyHpPattern(
    baseType,
    observedHP,
    timeSeconds
) {

    const baseHP =
        BASE_HP[
            baseType
        ];


    if (
        !Number.isFinite(
            baseHP
        )
        ||
        !Number.isFinite(
            observedHP
        )
        ||
        !Number.isFinite(
            timeSeconds
        )
    ) {

        return {

            resolved:
                false,

            label:
                'UNRESOLVED',

            isSuper:
                false,

            isRift:
                false,

            riftStage:
                null,

            global35MinuteHpBoost:
                null,

            observedHP,

            expectedHP:
                null,

            absoluteError:
                null,

            relativeError:
                null
        };
    }


    const globalBoost =
        timeSeconds >=
        GLOBAL_HP_BOOST_TIME;


    const globalMultiplier =
        globalBoost
            ? GLOBAL_HP_MULTIPLIER
            : 1;


    const patterns =
        [];


    // ========================================================
    // NORMAL
    // ========================================================

    patterns.push({

        label:
            'NORMAL',

        isSuper:
            false,

        isRift:
            false,

        riftStage:
            null,

        variantMultiplier:
            1
    });


    // ========================================================
    // SUPER
    // ========================================================

    patterns.push({

        label:
            'SUPER',

        isSuper:
            true,

        isRift:
            false,

        riftStage:
            null,

        variantMultiplier:
            SUPER_HP_MULTIPLIER
    });


    // ========================================================
    // RIFT
    // ========================================================

    for (
        const [
            stageString,
            multiplier
        ]
        of Object.entries(
            RIFT_STAGE_MULTIPLIERS
        )
    ) {

        const stage =
            Number(
                stageString
            );


        patterns.push({

            label:
                `RIFT_STAGE_${stage}`,

            isSuper:
                false,

            isRift:
                true,

            riftStage:
                stage,

            variantMultiplier:
                multiplier
        });


        patterns.push({

            label:
                `RIFT_STAGE_${stage}_SUPER`,

            isSuper:
                true,

            isRift:
                true,

            riftStage:
                stage,

            variantMultiplier:
                multiplier *
                SUPER_HP_MULTIPLIER
        });
    }


    // ========================================================
    // SCORE PATTERNS
    // ========================================================

    const scored =
        patterns.map(
            pattern => {

                const expectedHP =
                    baseHP
                    *
                    globalMultiplier
                    *
                    pattern.variantMultiplier;


                const absoluteError =
                    Math.abs(
                        observedHP -
                        expectedHP
                    );


                const relativeError =
                    expectedHP >
                        0
                        ? absoluteError /
                            expectedHP
                        : null;


                return {

                    ...pattern,

                    expectedHP,

                    absoluteError,

                    relativeError
                };
            }
        )
        .sort(
            (
                a,
                b
            ) =>
                a.absoluteError -
                b.absoluteError
        );


    const best =
        scored[0];


    const tolerance =
        Math.max(
            MIN_HP_TOLERANCE,
            best.expectedHP *
                RELATIVE_HP_TOLERANCE
        );


    const resolved =
        best.absoluteError <=
        tolerance;


    const normalCurrentHP =
        baseHP *
        globalMultiplier;


    const residualVariantMultiplier =
        normalCurrentHP >
            0
            ? observedHP /
                normalCurrentHP
            : null;


    return {

        resolved,

        label:
            resolved
                ? best.label
                : 'UNRESOLVED',

        nearestLabel:
            best.label,

        baseType,

        baseHP,

        observedHP,

        global35MinuteHpBoost:
            globalBoost,

        globalMultiplier,

        residualVariantMultiplier,

        isSuper:
            resolved
                ? best.isSuper
                : false,

        isRift:
            resolved
                ? best.isRift
                : false,

        riftStage:
            resolved
                ? best.riftStage
                : null,

        variantMultiplier:
            resolved
                ? best.variantMultiplier
                : null,

        expectedHP:
            best.expectedHP,

        absoluteError:
            best.absoluteError,

        relativeError:
            best.relativeError,

        tolerance,

        alternativePatterns:
            scored
                .slice(
                    0,
                    3
                )
                .map(
                    row => ({

                        label:
                            row.label,

                        expectedHP:
                            row.expectedHP,

                        absoluteError:
                            row.absoluteError
                    })
                )
    };
}


// ============================================================
// RIFT COHORT BUILDER
// ============================================================

function buildRiftCohorts(
    candidates
) {

    const groups =
        [];


    const buckets =
        new Map();


    for (
        const life
        of candidates
    ) {

        const stage =
            life
                ?.hpPattern
                ?.riftStage;


        const key =
            `${
                life.team
            }|${
                life.lane
            }|${
                stage
            }`;


        if (
            !buckets.has(
                key
            )
        ) {

            buckets.set(
                key,
                []
            );
        }


        buckets
            .get(
                key
            )
            .push(
                life
            );
    }


    for (
        const bucket
        of buckets.values()
    ) {

        bucket.sort(
            (
                a,
                b
            ) =>
                a.timeSeconds -
                b.timeSeconds
        );


        let current =
            [];


        for (
            const life
            of bucket
        ) {

            if (
                current.length ===
                0
            ) {

                current.push(
                    life
                );


                continue;
            }


            const previous =
                current[
                    current.length -
                    1
                ];


            const first =
                current[0];


            const gap =
                life.timeSeconds -
                previous.timeSeconds;


            const totalSpan =
                life.timeSeconds -
                first.timeSeconds;


            const distanceFromCentroid =
                getDistanceFromLifeCentroid(
                    current,
                    life
                );


            const sameCohort =
                gap <=
                    RIFT_COHORT_MAX_GAP_SECONDS
                &&
                totalSpan <=
                    RIFT_COHORT_MAX_SPAN_SECONDS
                &&
                (
                    distanceFromCentroid ===
                        null
                    ||
                    distanceFromCentroid <=
                        RIFT_COHORT_MAX_SPAWN_SPREAD
                );


            if (
                sameCohort
            ) {

                current.push(
                    life
                );

            } else {

                groups.push(
                    current
                );


                current =
                    [
                        life
                    ];
            }
        }


        if (
            current.length >
            0
        ) {

            groups.push(
                current
            );
        }
    }


    return groups.sort(
        (
            a,
            b
        ) =>
            a[0].timeSeconds -
            b[0].timeSeconds
    );
}


// ============================================================
// SUMMARIZE RIFT COHORT
// ============================================================

function summarizeRiftCohort(
    members,
    index
) {

    const sorted =
        [
            ...members
        ]
        .sort(
            (
                a,
                b
            ) =>
                a.timeSeconds -
                b.timeSeconds
        );


    const first =
        sorted[0];


    const last =
        sorted[
            sorted.length -
            1
        ];


    const stageCounts =
        countBy(
            sorted,
            row =>
                String(
                    row
                        ?.hpPattern
                        ?.riftStage
                    ??
                    'UNKNOWN'
                )
        );


    const stageEntries =
        [
            ...stageCounts.entries()
        ]
        .sort(
            (
                a,
                b
            ) =>
                b[1] -
                a[1]
        );


    const riftStage =
        stageEntries.length >
            0
            ? finite(
                stageEntries[0][0]
            )
            : null;


    const baseTypeCounts =
        mapToSortedObject(
            countBy(
                sorted,
                row =>
                    row.baseType
            )
        );


    const hpPatternCounts =
        mapToSortedObject(
            countBy(
                sorted,
                row =>
                    row
                        ?.hpPattern
                        ?.label
                    ??
                    'UNKNOWN'
            )
        );


    const centroid =
        getLifeCentroid(
            sorted
        );


    const spawnDistances =
        centroid
            ? sorted
                .map(
                    life =>
                        life.position
                            ? getDistance3D(
                                life.position,
                                centroid
                            )
                            : null
                )
                .filter(
                    Number.isFinite
                )
            : [];


    const maxSpawnSpread =
        spawnDistances.length >
            0
            ? Math.max(
                ...spawnDistances
            )
            : null;


    const deathRows =
        sorted

            .map(
                life =>
                    life.death
            )

            .filter(
                Boolean
            );


    const groundSoulMatchedDeaths =
        deathRows.filter(
            death =>
                death.groundSoulMatched
        ).length;


    const span =
        last.timeSeconds -
        first.timeSeconds;


    const oneStageOnly =
        stageCounts.size ===
        1;


    const enoughTroopers =
        sorted.length >=
        RIFT_MIN_COHORT_SIZE;


    const compactSpawn =
        maxSpawnSpread ===
            null
        ||
        maxSpawnSpread <=
            RIFT_COHORT_MAX_SPAWN_SPREAD;


    const shortSpawnWindow =
        span <=
        RIFT_COHORT_MAX_SPAN_SECONDS;


    const highConfidence =
        enoughTroopers
        &&
        oneStageOnly
        &&
        compactSpawn
        &&
        shortSpawnWindow;


    return {

        cohortId:
            `RIFT_COHORT_${
                String(
                    index +
                    1
                ).padStart(
                    2,
                    '0'
                )
            }`,

        highConfidenceRiftCohort:
            highConfidence,

        evidence:
            {

                enoughTroopers,

                oneRiftStage:
                    oneStageOnly,

                compactSpawn,

                shortSpawnWindow
            },

        team:
            first.team,

        lane:
            first.lane,

        riftStage,

        memberCount:
            sorted.length,

        firstLifeStartSeconds:
            first.timeSeconds,

        firstLifeStartClock:
            first.clock,

        lastLifeStartSeconds:
            last.timeSeconds,

        lastLifeStartClock:
            last.clock,

        spawnSpanSeconds:
            span,

        centroid,

        maxSpawnSpread,

        baseTypeCounts,

        hpPatternCounts,

        deathsObserved:
            deathRows.length,

        groundSoulMatchedDeaths,

        groundSoulAssociationRate:
            rate(
                groundSoulMatchedDeaths,
                deathRows.length
            ),

        lifeIds:
            sorted.map(
                row =>
                    row.lifeId
            ),

        memberExamples:
            sorted
                .slice(
                    0,
                    MAX_COHORT_MEMBER_EXAMPLES
                )
                .map(
                    life => ({

                        lifeId:
                            life.lifeId,

                        entityIndex:
                            life.entityIndex,

                        timeSeconds:
                            life.timeSeconds,

                        clock:
                            life.clock,

                        baseType:
                            life.baseType,

                        subclassId:
                            life.subclassId,

                        team:
                            life.team,

                        lane:
                            life.lane,

                        maxHealth:
                            life.maxHealth,

                        hpPattern:
                            life.hpPattern.label,

                        position:
                            life.position,

                        death:
                            life.death
                            ??
                            null
                    })
                )
    };
}


// ============================================================
// CENTROID
// ============================================================

function getLifeCentroid(
    lives
) {

    const positions =
        lives

            .map(
                row =>
                    row.position
            )

            .filter(
                Boolean
            );


    if (
        positions.length ===
        0
    ) {

        return null;
    }


    return {

        x:
            average(
                positions.map(
                    row =>
                        row.x
                )
            ),

        y:
            average(
                positions.map(
                    row =>
                        row.y
                )
            ),

        z:
            average(
                positions.map(
                    row =>
                        row.z
                )
            )
    };
}


function getDistanceFromLifeCentroid(
    current,
    candidate
) {

    if (
        !candidate.position
    ) {

        return null;
    }


    const centroid =
        getLifeCentroid(
            current
        );


    if (
        !centroid
    ) {

        return null;
    }


    return getDistance3D(
        centroid,
        candidate.position
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


// ============================================================
// COUNT BY
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


// ============================================================
// MAP COUNTER
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
// NONDECREASING
// ============================================================

function isNonDecreasing(
    values
) {

    const clean =
        values.filter(
            Number.isFinite
        );


    for (
        let i =
            1;

        i <
            clean.length;

        i++
    ) {

        if (
            clean[i] <
            clean[
                i -
                1
            ]
        ) {

            return false;
        }
    }


    return true;
}


// ============================================================
// AVERAGE
// ============================================================

function average(
    values
) {

    const clean =
        values.filter(
            Number.isFinite
        );


    if (
        clean.length ===
        0
    ) {

        return null;
    }


    return clean.reduce(
        (
            total,
            value
        ) =>
            total +
            value,
        0
    )
    /
    clean.length;
}


// ============================================================
// DEATH KEY
// ============================================================

function makeDeathKey(
    entityIndex,
    tick
) {

    return `${entityIndex}|${tick}`;
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