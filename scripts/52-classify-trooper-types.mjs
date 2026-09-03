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
// CURRENT MECHANIC FINGERPRINTS
//
// Used as classification evidence, not blindly assumed.
//
// Current public values:
//
// Ranged = 300 base HP
// Medic  = 350 base HP
// Melee  = 400 base HP
//
// Melee starts spawning after 5 minutes.
// Medic drops CCitadel_Pickup_Health candidate.
// ============================================================

const EXPECTED_BASE_HP =
    {

        RANGED:
            300,

        MEDIC:
            350,

        MELEE:
            400
    };


const MELEE_EXPECTED_START_SECONDS =
    300;


// ============================================================
// NORMAL SOUL-PRODUCING THRESHOLD
//
// Script 51 found three subclasses with ~72-85%
// AssignedGold association and one with ~0.065%.
//
// Keep threshold conservative.
// ============================================================

const NORMAL_SOUL_ASSOCIATION_THRESHOLD =
    0.50;


const NON_ECONOMIC_SOUL_THRESHOLD =
    0.10;


// ============================================================
// MEDIC PACK MATCHING
// ============================================================

const HEALTH_PICKUP_MIN_DELTA_TICKS =
    -1;


const HEALTH_PICKUP_MAX_DELTA_TICKS =
    6;


const HEALTH_PICKUP_MAX_DISTANCE_3D =
    256;


const HEALTH_PICKUP_POSITION_JUMP =
    64;


// ============================================================
// SPECIAL HIGH-HEALTH CANDIDATES
//
// Current Rift Troopers begin at +100% HP.
//
// We only FLAG these here.
//
// We do NOT yet call them Rift Troopers because Super Troopers,
// late-game HP buffs, and other modifiers need to be separated.
// ============================================================

const SPECIAL_HIGH_HEALTH_RATIO =
    1.80;


// ============================================================
// LIMITS
// ============================================================

const MAX_HEALTH_PICKUP_CANDIDATES_PER_DEATH =
    30;


const MAX_HEALTH_PICKUP_SAMPLES =
    100;


const MAX_SPECIAL_LIFE_EXAMPLES =
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


const groundSoulPath =
    resolve(
        'output',
        replayName,
        'trooper_ground_soul_candidates.jsonl'
    );


const script51SummaryPath =
    resolve(
        'output',
        replayName,
        'trooper_assigned_gold_ground_soul_validation.json'
    );


const outputSummaryPath =
    resolve(
        'output',
        replayName,
        'trooper_type_classification_v01.json'
    );


const outputDeathsPath =
    resolve(
        'output',
        replayName,
        'trooper_deaths_typed_v01.jsonl'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        replayPath,
        groundSoulPath,
        script51SummaryPath
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
// LOAD SCRIPT 51 SUMMARY
// ============================================================

const script51 =
    JSON.parse(
        readFileSync(
            script51SummaryPath,
            'utf8'
        )
    );


if (
    script51
        ?.validation
        ?.pass !==
    true
) {

    throw new Error(
        'Script 51 summary is not validation PASS.'
    );
}


// ============================================================
// LOAD VERIFIED ASSIGNED-GOLD MATCHES
// ============================================================

console.log('');

console.log(
    'Loading verified ground-soul matches...'
);


const groundSoulByDeathKey =
    new Map();


const groundSoulReader =
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
    of groundSoulReader
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


    const key =
        makeDeathKey(
            entityIndex,
            tick
        );


    groundSoulByDeathKey.set(
        key,
        row
    );
}


console.log(
    `Loaded ground-soul matches: ${groundSoulByDeathKey.size}`
);


// ============================================================
// TROOPER STATE
// ============================================================

const previousTrooperState =
    new Map();


const trooperIndexes =
    new Set();


const lifeSequenceByEntity =
    new Map();


const currentLifeIdByEntity =
    new Map();


const trooperDeaths =
    [];


const lifeStarts =
    [];


let trooperEvents =
    0;


let healthDeathTransitions =
    0;


let lifeDeathTransitions =
    0;


// ============================================================
// HEALTH PICKUP STATE
// ============================================================

const previousHealthPickupState =
    new Map();


const healthPickupIndexes =
    new Set();


const healthPickupFieldNames =
    new Set();


const healthPickupChangedFields =
    new Map();


let healthPickupEvents =
    0;


let healthPickupFirstObservations =
    0;


let healthPickupOperationCreates =
    0;


let healthPickupBecameActive =
    0;


let healthPickupBecameInteractive =
    0;


let healthPickupPositionJumps =
    0;


let healthPickupVacuumChanges =
    0;


const healthPickupSamples =
    [];


// ============================================================
// HEALTH PICKUP ROLLING BUFFER
// ============================================================

let healthPickupBuffer =
    [];


let healthPickupBufferStart =
    0;


let maxHealthPickupBuffer =
    0;


// ============================================================
// PENDING TROOPER DEATHS
// ============================================================

let pendingDeaths =
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


        const packetEvents =
            events
            ??
            [];


        // ----------------------------------------------------
        // Expire old death windows.
        // ----------------------------------------------------

        pendingDeaths =
            pendingDeaths.filter(
                death =>
                    tick <=
                    death.tick +
                    HEALTH_PICKUP_MAX_DELTA_TICKS
            );


        // ----------------------------------------------------
        // Prune old Health pickup events.
        // ----------------------------------------------------

        pruneHealthPickupBuffer(
            tick +
            HEALTH_PICKUP_MIN_DELTA_TICKS
        );


        // ====================================================
        // PASS 1:
        // Trooper state/deaths first.
        //
        // This makes packet ordering irrelevant for same-tick
        // Health pickup activity.
        // ====================================================

        for (
            const event
            of packetEvents
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


            processTrooper(
                entity,
                tick
            );
        }


        // ====================================================
        // PASS 2:
        // Medic Pack candidate lifecycle.
        // ====================================================

        for (
            const event
            of packetEvents
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
                'CCitadel_Pickup_Health'
            ) {

                continue;
            }


            processHealthPickup(
                event,
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
    '======================================='
);

console.log(
    'TROOPER TYPE CLASSIFICATION V0.1'
);

console.log(
    '======================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log('');

console.log(
    'Testing fingerprints:'
);

console.log(
    '  Ranged = 300 HP'
);

console.log(
    '  Medic  = 350 HP + Health pickup'
);

console.log(
    '  Melee  = 400 HP + appears after 5:00'
);

console.log(
    '  Special high-HP/no-soul lives are flagged, not labeled yet.'
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// SELECT BEST MEDIC-PACK MATCH PER DEATH
// ============================================================

for (
    const death
    of trooperDeaths
) {

    death.medicPackMatch =
        chooseBestHealthPickup(
            death
        );


    death.groundSoulMatch =
        groundSoulByDeathKey.get(
            death.deathKey
        )
        ??
        null;


    death.groundSoulMatched =
        Boolean(
            death.groundSoulMatch
        );


    death.medicPackMatched =
        Boolean(
            death.medicPackMatch
        );
}


// ============================================================
// SUBCLASS IDS
// ============================================================

const subclassIds =
    [
        ...new Set(
            trooperDeaths.map(
                death =>
                    String(
                        death.subclassId
                        ??
                        'UNKNOWN'
                    )
            )
        )
    ];


// ============================================================
// BUILD SUBCLASS EVIDENCE
// ============================================================

const subclassEvidence =
    [];


for (
    const subclassId
    of subclassIds
) {

    const deaths =
        trooperDeaths.filter(
            death =>
                String(
                    death.subclassId
                    ??
                    'UNKNOWN'
                )
                ===
                subclassId
        );


    const lives =
        lifeStarts.filter(
            life =>
                String(
                    life.subclassId
                    ??
                    'UNKNOWN'
                )
                ===
                subclassId
        );


    const preFiveLives =
        lives.filter(
            life =>
                life.timeSeconds >=
                    0
                &&
                life.timeSeconds <
                    300
        );


    const firstTenMinuteLives =
        lives.filter(
            life =>
                life.timeSeconds >=
                    0
                &&
                life.timeSeconds <
                    600
        );


    const soulMatches =
        deaths.filter(
            death =>
                death.groundSoulMatched
        );


    const medicMatches =
        deaths.filter(
            death =>
                death.medicPackMatched
        );


    const firstObservedTimeSeconds =
        minimumFinite(
            lives.map(
                life =>
                    life.timeSeconds
            )
        );


    const firstDeathTimeSeconds =
        minimumFinite(
            deaths.map(
                death =>
                    death.timeSeconds
            )
        );


    const modalPreFiveMaxHealth =
        modeNumber(
            preFiveLives.map(
                life =>
                    life.maxHealth
            )
        );


    const modalFirstTenMaxHealth =
        modeNumber(
            firstTenMinuteLives.map(
                life =>
                    life.maxHealth
            )
        );


    const modalAllMaxHealth =
        modeNumber(
            lives.map(
                life =>
                    life.maxHealth
            )
        );


    subclassEvidence.push({

        subclassId,

        deaths:
            deaths.length,

        lifeStarts:
            lives.length,

        preFiveMinuteLifeStarts:
            preFiveLives.length,

        firstTenMinuteLifeStarts:
            firstTenMinuteLives.length,

        firstObservedTimeSeconds,

        firstObservedClock:
            firstObservedTimeSeconds !==
                null
                ? formatClock(
                    firstObservedTimeSeconds
                )
                : null,

        firstDeathTimeSeconds,

        firstDeathClock:
            firstDeathTimeSeconds !==
                null
                ? formatClock(
                    firstDeathTimeSeconds
                )
                : null,

        groundSoulMatches:
            soulMatches.length,

        groundSoulMatchRate:
            rate(
                soulMatches.length,
                deaths.length
            ),

        medicPackMatches:
            medicMatches.length,

        medicPackMatchRate:
            rate(
                medicMatches.length,
                deaths.length
            ),

        maxHealth:
            {

                modalPreFiveMinutes:
                    modalPreFiveMaxHealth,

                modalFirstTenMinutes:
                    modalFirstTenMaxHealth,

                modalAll:
                    modalAllMaxHealth,

                preFiveDistribution:
                    frequencyObject(
                        preFiveLives.map(
                            life =>
                                life.maxHealth
                        )
                    ),

                firstTenDistribution:
                    frequencyObject(
                        firstTenMinuteLives.map(
                            life =>
                                life.maxHealth
                        )
                    ),

                allDistribution:
                    frequencyObject(
                        lives.map(
                            life =>
                                life.maxHealth
                        )
                    )
            },

        medicPackGeometry:
            {

                distance3D:
                    summarizeNumbers(
                        medicMatches.map(
                            death =>
                                death
                                    .medicPackMatch
                                    .distance3D
                        )
                    ),

                tickDelta:
                    summarizeNumbers(
                        medicMatches.map(
                            death =>
                                death
                                    .medicPackMatch
                                    .tickDelta
                        )
                    )
            }
    });
}


subclassEvidence.sort(
    (
        a,
        b
    ) =>
        b.deaths -
        a.deaths
);


// ============================================================
// IDENTIFY NORMAL ECONOMIC SUBCLASSES
// ============================================================

const normalEconomic =
    subclassEvidence.filter(
        row =>
            (
                row.groundSoulMatchRate
                ??
                0
            )
            >=
            NORMAL_SOUL_ASSOCIATION_THRESHOLD
    );


// ============================================================
// PROVISIONAL LABELS
// ============================================================

const labelBySubclass =
    new Map();


// ------------------------------------------------------------
// Non-economic obvious exclusion first.
// ------------------------------------------------------------

for (
    const row
    of subclassEvidence
) {

    if (
        (
            row.groundSoulMatchRate
            ??
            0
        )
        <
        NON_ECONOMIC_SOUL_THRESHOLD
    ) {

        labelBySubclass.set(
            row.subclassId,
            {

                baseType:
                    'NON_STANDARD_TROOPER_CANDIDATE',

                confidence:
                    'HIGH',

                evidence:
                    [
                        `Ground-soul association only ${formatPercent(
                            row.groundSoulMatchRate
                        )}.`,

                        'Does not behave like a normal soul-producing lane Trooper.'
                    ]
            }
        );
    }
}


// ------------------------------------------------------------
// MEDIC:
// highest Medic Pack production among soul-producing classes.
// ------------------------------------------------------------

let medicCandidate =
    null;


if (
    normalEconomic.length >
    0
) {

    medicCandidate =
        [
            ...normalEconomic
        ]
        .sort(
            (
                a,
                b
            ) =>
                (
                    b.medicPackMatchRate
                    ??
                    0
                )
                -
                (
                    a.medicPackMatchRate
                    ??
                    0
                )
        )[0];


    if (
        medicCandidate
        &&
        medicCandidate.medicPackMatches >
            0
    ) {

        labelBySubclass.set(
            medicCandidate.subclassId,
            {

                baseType:
                    'MEDIC',

                confidence:
                    (
                        (
                            medicCandidate.medicPackMatchRate
                            ??
                            0
                        ) >
                        0.50
                    )
                        ? 'HIGH'
                        : 'MODERATE',

                evidence:
                    [

                        `Highest CCitadel_Pickup_Health association: ${
                            medicCandidate.medicPackMatches
                        } / ${
                            medicCandidate.deaths
                        } = ${
                            formatPercent(
                                medicCandidate.medicPackMatchRate
                            )
                        }.`,

                        `Early modal max HP: ${
                            medicCandidate
                                .maxHealth
                                .modalPreFiveMinutes
                            ??
                            medicCandidate
                                .maxHealth
                                .modalFirstTenMinutes
                            ??
                            'unknown'
                        }.`,

                        'Medic Troopers are the normal Trooper type expected to produce the Health pickup.'
                    ]
            }
        );
    }
}


// ------------------------------------------------------------
// Remaining normal classes:
// use HP fingerprint + first appearance.
// ------------------------------------------------------------

for (
    const row
    of normalEconomic
) {

    if (
        labelBySubclass.has(
            row.subclassId
        )
    ) {

        continue;
    }


    const observedHP =
        row
            .maxHealth
            .modalPreFiveMinutes
        ??
        row
            .maxHealth
            .modalFirstTenMinutes
        ??
        row
            .maxHealth
            .modalAll;


    if (
        observedHP ===
        null
    ) {

        labelBySubclass.set(
            row.subclassId,
            {

                baseType:
                    'UNKNOWN_NORMAL',

                confidence:
                    'LOW',

                evidence:
                    [
                        'Soul-producing subclass, but no usable max-HP fingerprint.'
                    ]
            }
        );


        continue;
    }


    const rangedDifference =
        Math.abs(
            observedHP -
            EXPECTED_BASE_HP.RANGED
        );


    const meleeDifference =
        Math.abs(
            observedHP -
            EXPECTED_BASE_HP.MELEE
        );


    if (
        meleeDifference <
        rangedDifference
    ) {

        labelBySubclass.set(
            row.subclassId,
            {

                baseType:
                    'MELEE',

                confidence:
                    (
                        observedHP ===
                            EXPECTED_BASE_HP.MELEE
                        &&
                        (
                            row.firstObservedTimeSeconds
                            ??
                            0
                        ) >=
                            290
                    )
                        ? 'HIGH'
                        : 'MODERATE',

                evidence:
                    [

                        `Observed early modal max HP: ${observedHP}; expected Melee fingerprint is ${EXPECTED_BASE_HP.MELEE}.`,

                        `First observed: ${
                            row.firstObservedClock
                            ??
                            'unknown'
                        }.`,

                        'Melee Troopers are expected to begin appearing around 5:00.'
                    ]
            }
        );

    } else {

        labelBySubclass.set(
            row.subclassId,
            {

                baseType:
                    'RANGED',

                confidence:
                    observedHP ===
                        EXPECTED_BASE_HP.RANGED
                        ? 'HIGH'
                        : 'MODERATE',

                evidence:
                    [

                        `Observed early modal max HP: ${observedHP}; expected Ranged fingerprint is ${EXPECTED_BASE_HP.RANGED}.`,

                        `First observed: ${
                            row.firstObservedClock
                            ??
                            'unknown'
                        }.`
                    ]
            }
        );
    }
}


// ------------------------------------------------------------
// Anything still unlabeled remains unknown.
// ------------------------------------------------------------

for (
    const row
    of subclassEvidence
) {

    if (
        !labelBySubclass.has(
            row.subclassId
        )
    ) {

        labelBySubclass.set(
            row.subclassId,
            {

                baseType:
                    'UNKNOWN',

                confidence:
                    'LOW',

                evidence:
                    [
                        'Insufficient fingerprint evidence.'
                    ]
            }
        );
    }
}


// ============================================================
// ADD LABELS TO EVIDENCE
// ============================================================

for (
    const row
    of subclassEvidence
) {

    row.classification =
        labelBySubclass.get(
            row.subclassId
        );
}


// ============================================================
// EXPECTED BASE HP BY SUBCLASS
// ============================================================

const expectedBaseHPBySubclass =
    new Map();


for (
    const row
    of subclassEvidence
) {

    const label =
        row
            ?.classification
            ?.baseType;


    if (
        label ===
        'RANGED'
        ||
        label ===
        'MEDIC'
        ||
        label ===
        'MELEE'
    ) {

        expectedBaseHPBySubclass.set(
            row.subclassId,
            EXPECTED_BASE_HP[
                label
            ]
        );
    }
}


// ============================================================
// SPECIAL HIGH-HEALTH LIFE CANDIDATES
// ============================================================

const specialHighHealthLives =
    [];


for (
    const life
    of lifeStarts
) {

    const subclassId =
        String(
            life.subclassId
            ??
            'UNKNOWN'
        );


    const expectedBaseHP =
        expectedBaseHPBySubclass.get(
            subclassId
        )
        ??
        null;


    if (
        expectedBaseHP ===
            null
        ||
        life.maxHealth ===
            null
    ) {

        continue;
    }


    const hpRatio =
        life.maxHealth /
        expectedBaseHP;


    if (
        hpRatio <
        SPECIAL_HIGH_HEALTH_RATIO
    ) {

        continue;
    }


    const death =
        trooperDeaths.find(
            row =>
                row.lifeId ===
                life.lifeId
        )
        ??
        null;


    specialHighHealthLives.push({

        lifeId:
            life.lifeId,

        entityIndex:
            life.entityIndex,

        subclassId,

        baseType:
            labelBySubclass
                .get(
                    subclassId
                )
                ?.baseType
            ??
            null,

        lifeStartTimeSeconds:
            life.timeSeconds,

        lifeStartClock:
            life.clock,

        team:
            life.team,

        lane:
            life.lane,

        maxHealth:
            life.maxHealth,

        expectedBaseHealth:
            expectedBaseHP,

        maxHealthRatio:
            hpRatio,

        position:
            life.position,

        death:
            death
            ? {

                tick:
                    death.tick,

                timeSeconds:
                    death.timeSeconds,

                clock:
                    death.clock,

                groundSoulMatched:
                    death.groundSoulMatched,

                medicPackMatched:
                    death.medicPackMatched
            }
            : null,

        highHealthNoSoulCandidate:
            Boolean(
                death
                &&
                !death.groundSoulMatched
            ),

        interpretation:
            'SPECIAL_VARIANT_CANDIDATE_ONLY'
    });
}


// ============================================================
// SPECIAL SUMMARY
// ============================================================

const specialNoSoul =
    specialHighHealthLives.filter(
        row =>
            row.highHealthNoSoulCandidate
    );


// ============================================================
// WRITE TYPED DEATH STREAM
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
    of trooperDeaths
) {

    const subclassId =
        String(
            death.subclassId
            ??
            'UNKNOWN'
        );


    const classification =
        labelBySubclass.get(
            subclassId
        )
        ??
        {

            baseType:
                'UNKNOWN',

            confidence:
                'LOW'
        };


    const expectedBaseHP =
        expectedBaseHPBySubclass.get(
            subclassId
        )
        ??
        null;


    const hpRatio =
        expectedBaseHP !==
            null
        &&
        death.maxHealth !==
            null

            ? death.maxHealth /
                expectedBaseHP

            : null;


    const highHealthSpecialCandidate =
        hpRatio !==
            null
        &&
        hpRatio >=
            SPECIAL_HIGH_HEALTH_RATIO;


    const outputRow =
        {

            schemaVersion:
                1,

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

                    subclassId,

                    baseType:
                        classification.baseType,

                    baseTypeConfidence:
                        classification.confidence,

                    team:
                        death.team,

                    lane:
                        death.lane,

                    maxHealth:
                        death.maxHealth,

                    expectedBaseHealth:
                        expectedBaseHP,

                    maxHealthRatio:
                        hpRatio,

                    position:
                        death.position
                },

            economy:
                {

                    assignedGoldGroundSoulMatched:
                        death.groundSoulMatched,

                    medicPackMatched:
                        death.medicPackMatched
                },

            variant:
                {

                    resolved:
                        false,

                    variant:
                        'UNRESOLVED',

                    highHealthSpecialCandidate,

                    highHealthNoSoulCandidate:
                        (
                            highHealthSpecialCandidate
                            &&
                            !death.groundSoulMatched
                        ),

                    note:
                        'Rift vs Super vs ordinary late-game HP modification is not resolved in Script 52.'
                }
        };


    deathWriter.write(
        JSON.stringify(
            outputRow
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

        deathWriter.on(
            'error',
            rejectPromise
        );


        deathWriter.end(
            resolvePromise
        );
    }
);


// ============================================================
// LABEL COUNTS
// ============================================================

const labelCounts =
    new Map();


for (
    const row
    of subclassEvidence
) {

    increment(
        labelCounts,
        row
            .classification
            .baseType
    );
}


// ============================================================
// MEDIC PACK MATCH COUNTS BY SUBCLASS
// ============================================================

const medicPackMatchesBySubclass =
    new Map();


for (
    const death
    of trooperDeaths
) {

    if (
        death.medicPackMatched
    ) {

        increment(
            medicPackMatchesBySubclass,
            String(
                death.subclassId
                ??
                'UNKNOWN'
            )
        );
    }
}


// ============================================================
// VALIDATION
// ============================================================

const identifiedNormalLabels =
    [
        ...labelBySubclass.values()
    ]
        .map(
            row =>
                row.baseType
        );


const hasRanged =
    identifiedNormalLabels.includes(
        'RANGED'
    );


const hasMedic =
    identifiedNormalLabels.includes(
        'MEDIC'
    );


const hasMelee =
    identifiedNormalLabels.includes(
        'MELEE'
    );


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
                    (
                        healthDeathTransitions ===
                            trooperDeaths.length
                        &&
                        lifeDeathTransitions ===
                            trooperDeaths.length
                    ),

                expected:
                    true,

                pass:
                    healthDeathTransitions ===
                        trooperDeaths.length
                    &&
                    lifeDeathTransitions ===
                        trooperDeaths.length
            },

        script51GroundSoulLoaded:
            {

                actual:
                    groundSoulByDeathKey.size,

                expected:
                    '>0',

                pass:
                    groundSoulByDeathKey.size >
                    0
            },

        healthPickupObserved:
            {

                actual:
                    healthPickupEvents,

                expected:
                    '>0',

                pass:
                    healthPickupEvents >
                    0
            },

        medicPackDeathMatches:
            {

                actual:
                    trooperDeaths.filter(
                        death =>
                            death.medicPackMatched
                    ).length,

                expected:
                    '>0',

                pass:
                    trooperDeaths.some(
                        death =>
                            death.medicPackMatched
                    )
            },

        rangedIdentified:
            {

                actual:
                    hasRanged,

                expected:
                    true,

                pass:
                    hasRanged
            },

        medicIdentified:
            {

                actual:
                    hasMedic,

                expected:
                    true,

                pass:
                    hasMedic
            },

        meleeIdentified:
            {

                actual:
                    hasMelee,

                expected:
                    true,

                pass:
                    hasMelee
            },

        threeNormalSoulProducingClasses:
            {

                actual:
                    normalEconomic.length,

                expected:
                    3,

                pass:
                    replayName ===
                        'test'

                        ? normalEconomic.length ===
                            3

                        : normalEconomic.length >=
                            3
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
// SUMMARY
// ============================================================

const summary =
    {

        replay:
            replayName,

        version:
            'TROOPER_TYPE_CLASSIFICATION_V01',

        canonical:
            false,

        status:
            validationPass
                ? 'PROVISIONAL_TYPE_CLASSIFICATION'
                : 'DIAGNOSTIC_CLASSIFICATION',

        architecture:
            {

                baseType:
                    'RANGED / MEDIC / MELEE are classified independently from later special variants.',

                variant:
                    'NORMAL / SUPER / RIFT remains a separate unresolved dimension.',

                reason:
                    'Super Trooper is a modification to normal Troopers, while Rift Troopers have separate special economy/HP behavior.'
            },

        currentMechanicFingerprintsUsed:
            {

                rangedBaseHP:
                    EXPECTED_BASE_HP.RANGED,

                medicBaseHP:
                    EXPECTED_BASE_HP.MEDIC,

                meleeBaseHP:
                    EXPECTED_BASE_HP.MELEE,

                meleeExpectedStartSeconds:
                    MELEE_EXPECTED_START_SECONDS,

                medicUniqueSignal:
                    'CCitadel_Pickup_Health',

                normalSoulSignal:
                    'CCitadel_Pickup_AssignedGold',

                riftCandidateSignal:
                    'High HP combined with no AssignedGold, pending Rift-event validation.'
            },

        sourceCounts:
            {

                trooperEvents,

                uniqueTrooperIndexes:
                    trooperIndexes.size,

                lifeStarts:
                    lifeStarts.length,

                deaths:
                    trooperDeaths.length,

                groundSoulMatchesLoaded:
                    groundSoulByDeathKey.size,

                healthPickupEvents,

                uniqueHealthPickupIndexes:
                    healthPickupIndexes.size
            },

        healthPickupLifecycle:
            {

                firstObservations:
                    healthPickupFirstObservations,

                operationCreates:
                    healthPickupOperationCreates,

                becameActive:
                    healthPickupBecameActive,

                becameInteractive:
                    healthPickupBecameInteractive,

                positionJumps:
                    healthPickupPositionJumps,

                vacuumTargetChanges:
                    healthPickupVacuumChanges,

                fieldNames:
                    [
                        ...healthPickupFieldNames
                    ].sort(),

                changedFields:
                    mapToSortedObject(
                        healthPickupChangedFields
                    ),

                samples:
                    healthPickupSamples
            },

        subclassEvidence,

        provisionalMapping:
            Object.fromEntries(
                subclassEvidence.map(
                    row => [

                        row.subclassId,

                        row.classification
                    ]
                )
            ),

        medicPackMatchesBySubclass:
            mapToSortedObject(
                medicPackMatchesBySubclass
            ),

        specialVariantCandidates:
            {

                highHealthRatioThreshold:
                    SPECIAL_HIGH_HEALTH_RATIO,

                highHealthLives:
                    specialHighHealthLives.length,

                highHealthDeathsWithoutGroundSoul:
                    specialNoSoul.length,

                examples:
                    specialHighHealthLives.slice(
                        0,
                        MAX_SPECIAL_LIFE_EXAMPLES
                    ),

                interpretation:
                    'These are candidates for later Rift/Super analysis only. Do not label them from HP alone.'
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

                typedDeaths:
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
    '======================================='
);

console.log(
    'TROOPER TYPE CLASSIFICATION RESULTS'
);

console.log(
    '======================================='
);

console.log('');

console.log(
    'SUBCLASS EVIDENCE'
);

console.log(
    '-----------------'
);


for (
    const row
    of subclassEvidence
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
        } soul=${
            formatPercent(
                row.groundSoulMatchRate
            ).padStart(
                7
            )
        } medic=${
            formatPercent(
                row.medicPackMatchRate
            ).padStart(
                7
            )
        } HP<5=${
            String(
                row
                    .maxHealth
                    .modalPreFiveMinutes
                ??
                '-'
            ).padStart(
                5
            )
        } HP<10=${
            String(
                row
                    .maxHealth
                    .modalFirstTenMinutes
                ??
                '-'
            ).padStart(
                5
            )
        } first=${
            String(
                row.firstObservedClock
                ??
                '-'
            ).padStart(
                6
            )
        } => ${
            row
                .classification
                .baseType
        } [${
            row
                .classification
                .confidence
        }]`
    );
}


console.log('');

console.log(
    'MEDIC PACK MATCHES BY SUBCLASS'
);

console.log(
    '------------------------------'
);


for (
    const [
        subclassId,
        count
    ]
    of Object.entries(
        mapToSortedObject(
            medicPackMatchesBySubclass
        )
    )
) {

    console.log(
        `${subclassId.padEnd(
            20
        )} ${count}`
    );
}


console.log('');

console.log(
    'HEALTH PICKUP LIFECYCLE'
);

console.log(
    '-----------------------'
);

console.log(
    `Events: ${healthPickupEvents.toLocaleString()}`
);

console.log(
    `Unique indexes: ${healthPickupIndexes.size}`
);

console.log(
    `First observations: ${healthPickupFirstObservations}`
);

console.log(
    `operation CREATE: ${healthPickupOperationCreates}`
);

console.log(
    `Became active: ${healthPickupBecameActive}`
);

console.log(
    `Became interactive: ${healthPickupBecameInteractive}`
);

console.log(
    `Position jumps: ${healthPickupPositionJumps}`
);

console.log(
    `Vacuum target changes: ${healthPickupVacuumChanges}`
);

console.log('');

console.log(
    'SPECIAL VARIANT CANDIDATES'
);

console.log(
    '--------------------------'
);

console.log(
    `High-health lives >= ${SPECIAL_HIGH_HEALTH_RATIO.toFixed(
        2
    )}x base: ${specialHighHealthLives.length}`
);

console.log(
    `High-health + no ground soul: ${specialNoSoul.length}`
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
                36
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
    `Typed deaths:\n${outputDeathsPath}`
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
            ` | health pickups: ${healthPickupEvents.toLocaleString()}`
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


    // ========================================================
    // LIFE START / SLOT REUSE
    // ========================================================

    const firstAliveObservation =
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


    const lifeStateRespawn =
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
        firstAliveObservation
        ||
        healthRespawn
        ||
        lifeStateRespawn
    ) {

        const priorSequence =
            lifeSequenceByEntity.get(
                entityIndex
            )
            ??
            0;


        const sequence =
            priorSequence +
            1;


        lifeSequenceByEntity.set(
            entityIndex,
            sequence
        );


        const lifeId =
            `${entityIndex}|${sequence}`;


        currentLifeIdByEntity.set(
            entityIndex,
            lifeId
        );


        lifeStarts.push({

            lifeId,

            entityIndex,

            sequence,

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
                current.team,

            lane:
                current.lane,

            subclassId:
                current.subclassId,

            health:
                current.health,

            maxHealth:
                current.maxHealth,

            lifeState:
                current.lifeState,

            position:
                current.position
        });
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

            const death =
                {

                    deathIndex:
                        trooperDeaths.length,

                    deathKey:
                        makeDeathKey(
                            entityIndex,
                            tick
                        ),

                    lifeId:
                        currentLifeIdByEntity.get(
                            entityIndex
                        )
                        ??
                        null,

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

                    maxHealth:
                        current.maxHealth
                        ??
                        previous.maxHealth,

                    currentLifeState:
                        current.lifeState,

                    position:
                        current.position
                        ??
                        previous.position,

                    healthPickupCandidates:
                        [],

                    medicPackMatch:
                        null,

                    groundSoulMatch:
                        null,

                    groundSoulMatched:
                        false,

                    medicPackMatched:
                        false
                };


            // ------------------------------------------------
            // Prior-tick Health pickup candidates.
            // ------------------------------------------------

            for (
                let i =
                    healthPickupBufferStart;

                i <
                    healthPickupBuffer.length;

                i++
            ) {

                const pickup =
                    healthPickupBuffer[
                        i
                    ];


                const delta =
                    pickup.tick -
                    tick;


                if (
                    delta <
                        HEALTH_PICKUP_MIN_DELTA_TICKS
                    ||
                    delta >
                        0
                ) {

                    continue;
                }


                addHealthPickupCandidate(
                    death,
                    pickup
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
// PROCESS HEALTH PICKUP
// ============================================================

function processHealthPickup(
    event,
    entity,
    tick
) {

    healthPickupEvents++;


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


    healthPickupIndexes.add(
        entityIndex
    );


    // ========================================================
    // FIELD DISCOVERY
    // ========================================================

    if (
        healthPickupFieldNames.size ===
        0
    ) {

        for (
            const [
                fieldName
            ]
            of getFieldEntries(
                entity
            )
        ) {

            healthPickupFieldNames.add(
                fieldName
            );
        }
    }


    // ========================================================
    // CHANGES
    // ========================================================

    const changedFields =
        extractPlainObjectChangeFields(
            safeGetChanges(
                event
            )
        );


    for (
        const fieldName
        of changedFields
    ) {

        increment(
            healthPickupChangedFields,
            fieldName
        );
    }


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
                serializeScalar(
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
        previousHealthPickupState.get(
            entityIndex
        )
        ??
        null;


    // ========================================================
    // SIGNALS
    // ========================================================

    if (
        !previous
    ) {

        healthPickupFirstObservations++;


        current.signals.push(
            'FIRST_OBSERVATION'
        );
    }


    if (
        current.operation ===
        'CREATE'
    ) {

        healthPickupOperationCreates++;


        current.signals.push(
            'OPERATION_CREATE'
        );
    }


    if (
        previous
        &&
        previous.active ===
            false
        &&
        current.active ===
            true
    ) {

        healthPickupBecameActive++;


        current.signals.push(
            'BECAME_ACTIVE'
        );
    }


    if (
        previous
        &&
        previous.interactive ===
            false
        &&
        current.interactive ===
            true
    ) {

        healthPickupBecameInteractive++;


        current.signals.push(
            'BECAME_INTERACTIVE'
        );
    }


    if (
        previous
        &&
        previous.vacuumTarget !==
            current.vacuumTarget
    ) {

        healthPickupVacuumChanges++;


        current.signals.push(
            'VACUUM_TARGET_CHANGED'
        );
    }


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
            HEALTH_PICKUP_POSITION_JUMP
        ) {

            healthPickupPositionJumps++;


            current.signals.push(
                'POSITION_JUMP'
            );


            current.positionJumpDistance =
                jump;
        }
    }


    if (
        changedFields.includes(
            'm_bActive'
        )
    ) {

        current.signals.push(
            'ACTIVE_FIELD_CHANGED'
        );
    }


    if (
        changedFields.includes(
            'm_bInteractive'
        )
    ) {

        current.signals.push(
            'INTERACTIVE_FIELD_CHANGED'
        );
    }


    if (
        changedFields.includes(
            'm_hVacuumTarget'
        )
    ) {

        current.signals.push(
            'VACUUM_FIELD_CHANGED'
        );
    }


    current.signals =
        [
            ...new Set(
                current.signals
            )
        ];


    if (
        hasHealthPickupSpawnSignal(
            current
        )
        &&
        healthPickupSamples.length <
            MAX_HEALTH_PICKUP_SAMPLES
    ) {

        healthPickupSamples.push({

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

            operation:
                current.operation,

            active:
                current.active,

            interactive:
                current.interactive,

            vacuumTarget:
                current.vacuumTarget,

            team:
                current.team,

            subclassId:
                current.subclassId,

            position:
                current.position,

            signals:
                current.signals,

            changedFields:
                current.changedFields
        });
    }


    // ========================================================
    // FORWARD MATCH
    // ========================================================

    if (
        hasHealthPickupSpawnSignal(
            current
        )
    ) {

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
                    HEALTH_PICKUP_MAX_DELTA_TICKS
            ) {

                continue;
            }


            addHealthPickupCandidate(
                death,
                current
            );
        }


        healthPickupBuffer.push(
            current
        );


        maxHealthPickupBuffer =
            Math.max(
                maxHealthPickupBuffer,
                healthPickupBuffer.length -
                    healthPickupBufferStart
            );
    }


    previousHealthPickupState.set(
        entityIndex,
        current
    );
}


// ============================================================
// HEALTH PICKUP CANDIDATE
// ============================================================

function addHealthPickupCandidate(
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


    if (
        death.healthPickupCandidates.length >=
        MAX_HEALTH_PICKUP_CANDIDATES_PER_DEATH
    ) {

        return;
    }


    const tickDelta =
        pickup.tick -
        death.tick;


    if (
        tickDelta <
            HEALTH_PICKUP_MIN_DELTA_TICKS
        ||
        tickDelta >
            HEALTH_PICKUP_MAX_DELTA_TICKS
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
        HEALTH_PICKUP_MAX_DISTANCE_3D
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


    death.healthPickupCandidates.push({

        entityIndex:
            pickup.entityIndex,

        tick:
            pickup.tick,

        tickDelta,

        distance3D,

        distanceXY,

        verticalDelta,

        team:
            pickup.team,

        operation:
            pickup.operation,

        active:
            pickup.active,

        interactive:
            pickup.interactive,

        vacuumTarget:
            pickup.vacuumTarget,

        signals:
            pickup.signals,

        changedFields:
            pickup.changedFields,

        position:
            pickup.position
    });
}


// ============================================================
// CHOOSE MEDIC PACK MATCH
// ============================================================

function chooseBestHealthPickup(
    death
) {

    if (
        death.healthPickupCandidates.length ===
        0
    ) {

        return null;
    }


    return [
        ...death.healthPickupCandidates
    ]
        .sort(
            (
                a,
                b
            ) =>
                healthPickupCandidateScore(
                    a
                )
                -
                healthPickupCandidateScore(
                    b
                )
        )[0];
}


// ============================================================
// HEALTH PICKUP SCORE
// ============================================================

function healthPickupCandidateScore(
    row
) {

    let score =
        Math.abs(
            row.tickDelta
        )
        *
        1000
        +
        row.distance3D;


    if (
        row.signals.includes(
            'BECAME_ACTIVE'
        )
    ) {

        score -=
            600;
    }


    if (
        row.signals.includes(
            'POSITION_JUMP'
        )
    ) {

        score -=
            500;
    }


    if (
        row.signals.includes(
            'FIRST_OBSERVATION'
        )
    ) {

        score -=
            300;
    }


    if (
        row.signals.includes(
            'BECAME_INTERACTIVE'
        )
    ) {

        score -=
            250;
    }


    if (
        row.signals.includes(
            'VACUUM_TARGET_CHANGED'
        )
    ) {

        score -=
            200;
    }


    // PVS CREATE gets only weak weighting.
    if (
        row.signals.includes(
            'OPERATION_CREATE'
        )
    ) {

        score -=
            100;
    }


    return score;
}


// ============================================================
// HEALTH PICKUP SIGNAL
// ============================================================

function hasHealthPickupSpawnSignal(
    row
) {

    return (
        row.signals.includes(
            'FIRST_OBSERVATION'
        )
        ||
        row.signals.includes(
            'BECAME_ACTIVE'
        )
        ||
        row.signals.includes(
            'BECAME_INTERACTIVE'
        )
        ||
        row.signals.includes(
            'VACUUM_TARGET_CHANGED'
        )
        ||
        row.signals.includes(
            'POSITION_JUMP'
        )
        ||
        row.signals.includes(
            'OPERATION_CREATE'
        )
    );
}


// ============================================================
// BUFFER
// ============================================================

function pruneHealthPickupBuffer(
    minimumTick
) {

    while (
        healthPickupBufferStart <
            healthPickupBuffer.length
        &&
        healthPickupBuffer[
            healthPickupBufferStart
        ].tick <
            minimumTick
    ) {

        healthPickupBufferStart++;
    }


    if (
        healthPickupBufferStart >
        2000
    ) {

        healthPickupBuffer =
            healthPickupBuffer.slice(
                healthPickupBufferStart
            );


        healthPickupBufferStart =
            0;
    }
}


// ============================================================
// CHANGES
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


function extractPlainObjectChangeFields(
    raw
) {

    if (
        raw ===
            null
        ||
        raw ===
            undefined
    ) {

        return [];
    }


    if (
        raw instanceof Map
    ) {

        return [
            ...raw.keys()
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
            raw
        )
    ) {

        const result =
            [];


        for (
            const row
            of raw
        ) {

            if (
                Array.isArray(
                    row
                )
                &&
                row.length >
                    0
            ) {

                result.push(
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

                    result.push(
                        String(
                            name
                        )
                    );
                }
            }
        }


        return [
            ...new Set(
                result
            )
        ];
    }


    if (
        typeof raw ===
        'object'
    ) {

        return Object.keys(
            raw
        );
    }


    return [];
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
                    row => {

                        if (
                            Array.isArray(
                                row
                            )
                        ) {

                            return [
                                String(
                                    row[0]
                                ),
                                row[1]
                            ];
                        }


                        if (
                            row
                            &&
                            typeof row ===
                                'object'
                        ) {

                            return [

                                String(
                                    row.name
                                    ??
                                    row.key
                                    ??
                                    row.fieldName
                                    ??
                                    row.path
                                    ??
                                    'UNKNOWN'
                                ),

                                row.value
                            ];
                        }


                        return [
                            String(
                                row
                            ),
                            null
                        ];
                    }
                );
        }

    } catch {

        // Ignore.
    }


    return [];
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
// DEATH KEY
// ============================================================

function makeDeathKey(
    entityIndex,
    tick
) {

    return `${entityIndex}|${tick}`;
}


// ============================================================
// FREQUENCY / MODE
// ============================================================

function frequencyObject(
    values
) {

    const map =
        new Map();


    for (
        const value
        of values
    ) {

        if (
            !Number.isFinite(
                value
            )
        ) {

            continue;
        }


        increment(
            map,
            String(
                value
            )
        );
    }


    return mapToSortedObject(
        map
    );
}


function modeNumber(
    values
) {

    const counts =
        new Map();


    for (
        const value
        of values
    ) {

        if (
            !Number.isFinite(
                value
            )
        ) {

            continue;
        }


        increment(
            counts,
            value
        );
    }


    if (
        counts.size ===
        0
    ) {

        return null;
    }


    return [
        ...counts.entries()
    ]
        .sort(
            (
                a,
                b
            ) =>
                b[1] -
                a[1]
                ||
                a[0] -
                b[0]
        )[0][0];
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
// MINIMUM
// ============================================================

function minimumFinite(
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


    return Math.min(
        ...clean
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