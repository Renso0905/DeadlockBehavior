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


const RESPAWN_SECONDS =
    180;


// Canonical mechanics for this recorded build.
//
// Normal map breakables become available at 3:00.
// Mid Boss room additions become available at 10:00.
const NORMAL_SPAWN_SECONDS =
    180;


const MIDBOSS_SPAWN_SECONDS =
    600;


// ============================================================
// CANONICAL TYPE MAPPING
// ============================================================

const SUBCLASS_TO_TYPE =
    {

        '3986897915':
            'CRATE',

        '3719077267':
            'GOLDEN_STATUE'
    };


// Expected persistent slot counts.
//
// These are used as validation assertions, not discovery
// assumptions.
const EXPECTED =
    {

        TOTAL:
            691,

        CRATE:
            518,

        GOLDEN_STATUE:
            173,

        NORMAL_CRATE:
            500,

        MIDBOSS_CRATE:
            18,

        NORMAL_GOLDEN_STATUE:
            165,

        MIDBOSS_GOLDEN_STATUE:
            8
    };


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const attributionPath =
    resolve(
        'output',
        replayName,
        'breakable_action_attribution_v1.json'
    );


const originValidationPath =
    resolve(
        'output',
        replayName,
        'breakable_damage_origin_validation.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_catalog_v1.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        replayPath,
        attributionPath
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
// LOAD V1 ATTRIBUTION
// ============================================================

const attribution =
    JSON.parse(
        readFileSync(
            attributionPath,
            'utf8'
        )
    );


const attributionRows =
    Array.isArray(
        attribution.attributionRows
    )

        ? attribution.attributionRows

        : [];


if (
    attributionRows.length ===
    0
) {

    throw new Error(
        'breakable_action_attribution_v1.json contains no attributionRows.'
    );
}


// ============================================================
// MATCH CLOCK OFFSET
// ============================================================

const matchClockOffsetSeconds =
    toFiniteNumber(
        attribution
            ?.canonical
            ?.matchClockOffsetSeconds
    )
    ??
    toFiniteNumber(
        attribution
            ?.timing
            ?.matchClockOffsetSeconds
    )
    ??
    30;


// ============================================================
// OPTIONAL SCRIPT 40 EVIDENCE
//
// IMPORTANT:
//
// These candidates remain NONCANONICAL.
//
// They are retained only so we do not throw away useful
// diagnostic evidence.
// ============================================================

const supplementaryByBreakKey =
    new Map();


if (
    existsSync(
        originValidationPath
    )
) {

    const originValidation =
        JSON.parse(
            readFileSync(
                originValidationPath,
                'utf8'
            )
        );


    const rows =
        originValidation
            ?.strictOriginPlusPreDamage
            ?.unresolvedCandidateRows
        ??
        [];


    for (
        const row
        of rows
    ) {

        const player =
            row
                ?.originPlusPreDamage
                ?.player
            ??
            null;


        const candidates =
            row
                ?.originPlusPreDamage
                ?.candidates
            ??
            [];


        if (
            !row.breakKey
            ||
            !player
        ) {

            continue;
        }


        supplementaryByBreakKey.set(
            row.breakKey,
            {

                canonical:
                    false,

                method:
                    'EXACT_ORIGIN_PLUS_EXACT_PREDAMAGE',

                validationStatus:
                    'RETAINED_DIAGNOSTIC_ONLY',

                reason:
                    'Observed 3/3 agreement and 0 conflicts in Script 40 controls, but the validation sample is too small for canonical promotion.',

                player,

                candidateCount:
                    candidates.length,

                abilities:
                    uniqueAbilities(
                        candidates
                    ),

                candidates:
                    candidates.map(
                        candidate => ({

                            tickDelta:
                                candidate.tickDelta
                                ??
                                null,

                            originDistance3D:
                                candidate.originDistance3D
                                ??
                                null,

                            preDamage:
                                candidate.preDamage
                                ??
                                null,

                            debrisDamage:
                                candidate.debrisDamage
                                ??
                                null,

                            preDamageDifference:
                                candidate.preDamageDifference
                                ??
                                null,

                            abilityId:
                                serializeValue(
                                    candidate.abilityId
                                ),

                            abilityEntityIndex:
                                toFiniteNumber(
                                    candidate.abilityEntityIndex
                                ),

                            attackerIndex:
                                toFiniteNumber(
                                    candidate.attackerIndex
                                ),

                            victimIndex:
                                toFiniteNumber(
                                    candidate.victimIndex
                                )
                        })
                    )
            }
        );
    }
}


// ============================================================
// BREAK ROWS BY SLOT
// ============================================================

const breaksByEntityIndex =
    new Map();


const breakByKey =
    new Map();


for (
    const row
    of attributionRows
) {

    const entityIndex =
        toFiniteNumber(
            row.entityIndex
        );


    const breakTick =
        toFiniteNumber(
            row.breakTick
        );


    if (
        entityIndex ===
            null
        ||
        breakTick ===
            null
        ||
        !row.breakKey
    ) {

        continue;
    }


    const breakMatchTimeSeconds =
        toFiniteNumber(
            row.breakMatchTimeSeconds
        )
        ??
        tickToMatchTime(
            breakTick
        );


    const normalized =
        {

            breakKey:
                row.breakKey,

            entityIndex,

            resourceType:
                row.resourceType
                ??
                null,

            subclassId:
                serializeValue(
                    row.subclassId
                ),

            breakTick,

            breakMatchTimeSeconds,

            breakClock:
                row.breakClock
                ??
                formatClock(
                    breakMatchTimeSeconds
                ),

            worldPosition:
                normalizePosition(
                    row.position
                ),

            impactPosition:
                normalizePosition(
                    row.impactPosition
                    ??
                    row
                        ?.debris
                        ?.damagePos
                ),

            debrisDamage:
                toFiniteNumber(
                    row
                        ?.debris
                        ?.damage
                ),

            rewardOutcome:
                normalizeRewardOutcome(
                    row.rewardOutcome
                ),

            canonicalBreaker:
                normalizeCanonicalBreaker(
                    row
                ),

            supplementaryAttribution:
                supplementaryByBreakKey.get(
                    row.breakKey
                )
                ??
                null
        };


    breakByKey.set(
        row.breakKey,
        normalized
    );


    if (
        !breaksByEntityIndex.has(
            entityIndex
        )
    ) {

        breaksByEntityIndex.set(
            entityIndex,
            []
        );
    }


    breaksByEntityIndex
        .get(
            entityIndex
        )
        .push(
            normalized
        );
}


for (
    const rows
    of breaksByEntityIndex.values()
) {

    rows.sort(
        (
            a,
            b
        ) =>
            a.breakTick -
            b.breakTick
    );
}


// ============================================================
// DISCOVER ALL PERSISTENT BREAKABLE SLOTS
//
// This is necessary because the behavioral opportunity set
// must include breakables that were NEVER broken.
//
// Break-event data alone cannot recover those.
// ============================================================

const slots =
    new Map();


let lastDemoTick =
    0;


let totalBreakableCreates =
    0;


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// Track replay end.
parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    (
        demoPacket
    ) => {

        const tick =
            toFiniteNumber(
                demoPacket?.tick
            );


        if (
            tick !==
                null
        ) {

            lastDemoTick =
                Math.max(
                    lastDemoTick,
                    tick
                );
        }
    }
);


// Capture first CREATE for every persistent CCitadel_BreakableProp
// slot.
parser.registerPostInterceptor(

    InterceptorStage.ENTITY_PACKET,

    (
        demoPacket,
        messagePacket,
        events
    ) => {

        const tick =
            toFiniteNumber(
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

            if (
                !isCreateOperation(
                    event.operation
                )
            ) {

                continue;
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
                className !==
                'CCitadel_BreakableProp'
            ) {

                continue;
            }


            totalBreakableCreates++;


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


            const subclassId =
                serializeValue(
                    safeGetField(
                        entity,
                        'm_nSubclassID'
                    )
                );


            const type =
                SUBCLASS_TO_TYPE[
                    String(
                        subclassId
                    )
                ]
                ??
                'UNKNOWN';


            const position =
                getWorldPosition(
                    entity
                );


            const observedMatchTimeSeconds =
                tickToMatchTime(
                    tick
                );


            if (
                !slots.has(
                    entityIndex
                )
            ) {

                slots.set(
                    entityIndex,
                    {

                        entityIndex,

                        subclassId,

                        type,

                        firstObservedCreateTick:
                            tick,

                        firstObservedCreateMatchTimeSeconds:
                            observedMatchTimeSeconds,

                        firstObservedPosition:
                            position,

                        createCount:
                            1
                    }
                );


            } else {

                const slot =
                    slots.get(
                        entityIndex
                    );


                slot.createCount++;


                // Fill missing metadata if first PVS creation
                // happened to lack a useful field.
                if (
                    slot.subclassId ===
                        null
                    &&
                    subclassId !==
                        null
                ) {

                    slot.subclassId =
                        subclassId;


                    slot.type =
                        SUBCLASS_TO_TYPE[
                            String(
                                subclassId
                            )
                        ]
                        ??
                        slot.type;
                }


                if (
                    !slot.firstObservedPosition
                    &&
                    position
                ) {

                    slot.firstObservedPosition =
                        position;
                }
            }
        }
    }
);


// ============================================================
// RUN PARSER
// ============================================================

console.log('');

console.log(
    '========================================='
);

console.log(
    'BUILD CANONICAL BREAKABLE CATALOG V1'
);

console.log(
    '========================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `V1 break events loaded: ${attributionRows.length}`
);

console.log(
    `Supplementary Script 40 candidates: ${supplementaryByBreakKey.size}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// MATCH DURATION
// ============================================================

const matchDurationSeconds =
    Math.max(
        0,
        tickToMatchTime(
            lastDemoTick
        )
    );


// ============================================================
// BUILD SLOT RECORDS
// ============================================================

const slotRecords =
    [];


const anomalies =
    [];


for (
    const slot
    of slots.values()
) {

    const slotBreaks =
        (
            breaksByEntityIndex.get(
                slot.entityIndex
            )
            ??
            []
        )

            .slice()

            .sort(
                (
                    a,
                    b
                ) =>
                    a.breakTick -
                    b.breakTick
            );


    // ========================================================
    // FALLBACK METADATA FROM BREAK ROWS
    // ========================================================

    const firstBreak =
        slotBreaks[0]
        ??
        null;


    if (
        (
            slot.subclassId ===
                null
            ||
            slot.type ===
                'UNKNOWN'
        )
        &&
        firstBreak
    ) {

        slot.subclassId =
            firstBreak.subclassId;


        slot.type =
            firstBreak.resourceType
            ??
            SUBCLASS_TO_TYPE[
                String(
                    firstBreak.subclassId
                )
            ]
            ??
            slot.type;
    }


    const worldPosition =
        slot.firstObservedPosition
        ??
        firstBreak?.worldPosition
        ??
        null;


    // ========================================================
    // SPAWN COHORT
    //
    // First CREATE observations form two clean populations in
    // this replay: the 3-minute map population and the
    // 10-minute Mid Boss room population.
    //
    // We classify by proximity to the known canonical spawn
    // times and verify the exact expected counts below.
    // ========================================================

    const observedSpawn =
        slot.firstObservedCreateMatchTimeSeconds;


    const distanceToNormal =
        Math.abs(
            observedSpawn -
            NORMAL_SPAWN_SECONDS
        );


    const distanceToMidBoss =
        Math.abs(
            observedSpawn -
            MIDBOSS_SPAWN_SECONDS
        );


    const spawnCohort =
        distanceToNormal <=
            distanceToMidBoss

            ? 'NORMAL_3_MIN'

            : 'MIDBOSS_10_MIN';


    const initialSpawnMatchTimeSeconds =
        spawnCohort ===
            'NORMAL_3_MIN'

            ? NORMAL_SPAWN_SECONDS

            : MIDBOSS_SPAWN_SECONDS;


    // ========================================================
    // VALIDATE BREAK TIMING
    // ========================================================

    for (
        let index =
            0;

        index <
            slotBreaks.length;

        index++
    ) {

        const current =
            slotBreaks[index];


        if (
            current.breakMatchTimeSeconds <
            initialSpawnMatchTimeSeconds
        ) {

            anomalies.push({

                type:
                    'BREAK_BEFORE_INITIAL_SPAWN',

                entityIndex:
                    slot.entityIndex,

                breakKey:
                    current.breakKey,

                breakMatchTimeSeconds:
                    current.breakMatchTimeSeconds,

                initialSpawnMatchTimeSeconds
            });
        }


        if (
            index >
            0
        ) {

            const previous =
                slotBreaks[
                    index -
                    1
                ];


            const delta =
                current.breakMatchTimeSeconds -
                previous.breakMatchTimeSeconds;


            if (
                delta <
                RESPAWN_SECONDS -
                0.1
            ) {

                anomalies.push({

                    type:
                        'BREAK_BEFORE_180_SECOND_RESPAWN',

                    entityIndex:
                        slot.entityIndex,

                    previousBreakKey:
                        previous.breakKey,

                    currentBreakKey:
                        current.breakKey,

                    deltaSeconds:
                        delta
                });
            }
        }
    }


    // ========================================================
    // AVAILABILITY INTERVALS
    // ========================================================

    const availability =
        buildAvailabilityIntervals(

            initialSpawnMatchTimeSeconds,

            slotBreaks,

            matchDurationSeconds
        );


    // ========================================================
    // BREAK EVENTS WITH RESPAWN TIMES
    // ========================================================

    const canonicalBreakEvents =
        slotBreaks.map(
            breakEvent => {

                const respawnMatchTimeSeconds =
                    breakEvent.breakMatchTimeSeconds +
                    RESPAWN_SECONDS;


                return {

                    breakKey:
                        breakEvent.breakKey,

                    breakTick:
                        breakEvent.breakTick,

                    breakMatchTimeSeconds:
                        breakEvent.breakMatchTimeSeconds,

                    breakClock:
                        breakEvent.breakClock,

                    impactPosition:
                        breakEvent.impactPosition,

                    debrisDamage:
                        breakEvent.debrisDamage,

                    rewardOutcome:
                        breakEvent.rewardOutcome,

                    canonicalBreaker:
                        breakEvent.canonicalBreaker,

                    supplementaryAttribution:
                        breakEvent.supplementaryAttribution,

                    respawnMatchTimeSeconds,

                    respawnClock:
                        formatClock(
                            respawnMatchTimeSeconds
                        ),

                    respawnWithinReplay:
                        respawnMatchTimeSeconds <=
                        matchDurationSeconds
                };
            }
        );


    // ========================================================
    // REALIZED REWARD TOTALS FOR SLOT
    // ========================================================

    const observedSoulRewards =
        canonicalBreakEvents

            .filter(
                event =>
                    event
                        ?.rewardOutcome
                        ?.rewardType ===
                    'SOULS'
            )

            .map(
                event =>
                    toFiniteNumber(
                        event
                            ?.rewardOutcome
                            ?.goldReward
                    )
            )

            .filter(
                value =>
                    value !==
                    null
            );


    const permanentModifierDrops =
        canonicalBreakEvents.filter(
            event =>
                event
                    ?.rewardOutcome
                    ?.rewardType ===
                'PERMANENT_MODIFIER'
        );


    const rewardDrops =
        canonicalBreakEvents.filter(
            event =>
                event
                    ?.rewardOutcome
                    ?.dropped ===
                true
        );


    const noRewardBreaks =
        canonicalBreakEvents.filter(
            event =>
                event
                    ?.rewardOutcome
                    ?.dropped ===
                false
        );


    // ========================================================
    // BREAKER SUMMARY
    // ========================================================

    const attributedBreakEvents =
        canonicalBreakEvents.filter(
            event =>
                event
                    ?.canonicalBreaker
                    ?.status ===
                'ATTRIBUTED'
        );


    const unattributedBreakEvents =
        canonicalBreakEvents.filter(
            event =>
                event
                    ?.canonicalBreaker
                    ?.status !==
                'ATTRIBUTED'
        );


    slotRecords.push({

        breakableId:
            String(
                slot.entityIndex
            ),

        entityIndex:
            slot.entityIndex,

        type:
            slot.type,

        subclassId:
            slot.subclassId,

        worldPosition,

        spawn:
            {

                cohort:
                    spawnCohort,

                initialSpawnMatchTimeSeconds,

                initialSpawnClock:
                    formatClock(
                        initialSpawnMatchTimeSeconds
                    ),

                firstObservedCreateTick:
                    slot.firstObservedCreateTick,

                firstObservedCreateMatchTimeSeconds:
                    slot.firstObservedCreateMatchTimeSeconds,

                firstObservedCreateClock:
                    formatClock(
                        slot.firstObservedCreateMatchTimeSeconds
                    ),

                pvsCreateCount:
                    slot.createCount
            },

        lifecycle:
            {

                respawnSeconds:
                    RESPAWN_SECONDS,

                breakCount:
                    canonicalBreakEvents.length,

                everBroken:
                    canonicalBreakEvents.length >
                    0,

                availableIntervals:
                    availability.availableIntervals,

                unavailableIntervals:
                    availability.unavailableIntervals
            },

        rewardSummary:
            {

                breakCount:
                    canonicalBreakEvents.length,

                rewardDropCount:
                    rewardDrops.length,

                noRewardCount:
                    noRewardBreaks.length,

                observedSoulDropCount:
                    observedSoulRewards.length,

                observedSoulTotal:
                    sum(
                        observedSoulRewards
                    ),

                permanentModifierDropCount:
                    permanentModifierDrops.length,

                permanentModifierSubclassCounts:
                    countBy(
                        permanentModifierDrops,
                        event =>
                            event
                                ?.rewardOutcome
                                ?.modifierSubclassId
                            ??
                            'UNKNOWN'
                    )
            },

        attributionSummary:
            {

                attributedBreakCount:
                    attributedBreakEvents.length,

                unattributedBreakCount:
                    unattributedBreakEvents.length,

                attributionRate:
                    rate(
                        attributedBreakEvents.length,
                        canonicalBreakEvents.length
                    ),

                methods:
                    countBy(
                        attributedBreakEvents,
                        event =>
                            event
                                ?.canonicalBreaker
                                ?.method
                            ??
                            'UNKNOWN'
                    )
            },

        breakEvents:
            canonicalBreakEvents
    });
}


// ============================================================
// SORT SLOTS
// ============================================================

slotRecords.sort(
    (
        a,
        b
    ) =>
        a.entityIndex -
        b.entityIndex
);


// ============================================================
// CHECK FOR BREAK EVENTS WHOSE SLOT WAS NEVER DISCOVERED
// ============================================================

for (
    const [
        entityIndex,
        breakRows
    ]
    of breaksByEntityIndex.entries()
) {

    if (
        slots.has(
            entityIndex
        )
    ) {

        continue;
    }


    anomalies.push({

        type:
            'BREAK_EVENT_WITHOUT_DISCOVERED_SLOT',

        entityIndex,

        breakKeys:
            breakRows.map(
                row =>
                    row.breakKey
            )
    });
}


// ============================================================
// COUNTS
// ============================================================

const crateSlots =
    slotRecords.filter(
        slot =>
            slot.type ===
            'CRATE'
    );


const statueSlots =
    slotRecords.filter(
        slot =>
            slot.type ===
            'GOLDEN_STATUE'
    );


const normalCrates =
    crateSlots.filter(
        slot =>
            slot.spawn.cohort ===
            'NORMAL_3_MIN'
    );


const midBossCrates =
    crateSlots.filter(
        slot =>
            slot.spawn.cohort ===
            'MIDBOSS_10_MIN'
    );


const normalStatues =
    statueSlots.filter(
        slot =>
            slot.spawn.cohort ===
            'NORMAL_3_MIN'
    );


const midBossStatues =
    statueSlots.filter(
        slot =>
            slot.spawn.cohort ===
            'MIDBOSS_10_MIN'
    );


const unknownSlots =
    slotRecords.filter(
        slot =>
            slot.type ===
            'UNKNOWN'
    );


const slotsWithoutPosition =
    slotRecords.filter(
        slot =>
            !slot.worldPosition
    );


const neverBrokenSlots =
    slotRecords.filter(
        slot =>
            slot.lifecycle.breakCount ===
            0
    );


const everBrokenSlots =
    slotRecords.filter(
        slot =>
            slot.lifecycle.breakCount >
            0
    );


// ============================================================
// GLOBAL BREAK EVENTS
// ============================================================

const allBreakEvents =
    slotRecords

        .flatMap(
            slot =>
                slot.breakEvents.map(
                    event => ({

                        breakableId:
                            slot.breakableId,

                        entityIndex:
                            slot.entityIndex,

                        type:
                            slot.type,

                        subclassId:
                            slot.subclassId,

                        worldPosition:
                            slot.worldPosition,

                        spawnCohort:
                            slot.spawn.cohort,

                        ...event
                    })
                )
        )

        .sort(
            (
                a,
                b
            ) =>
                a.breakTick -
                b.breakTick
        );


// ============================================================
// GLOBAL REWARD SUMMARY
// ============================================================

const crateBreaks =
    allBreakEvents.filter(
        event =>
            event.type ===
            'CRATE'
    );


const statueBreaks =
    allBreakEvents.filter(
        event =>
            event.type ===
            'GOLDEN_STATUE'
    );


const crateSoulDrops =
    crateBreaks.filter(
        event =>
            event
                ?.rewardOutcome
                ?.rewardType ===
            'SOULS'
    );


const statueModifierDrops =
    statueBreaks.filter(
        event =>
            event
                ?.rewardOutcome
                ?.rewardType ===
            'PERMANENT_MODIFIER'
    );


const allAttributedBreaks =
    allBreakEvents.filter(
        event =>
            event
                ?.canonicalBreaker
                ?.status ===
            'ATTRIBUTED'
    );


const allUnattributedBreaks =
    allBreakEvents.filter(
        event =>
            event
                ?.canonicalBreaker
                ?.status !==
            'ATTRIBUTED'
    );


const supplementaryCandidates =
    allBreakEvents.filter(
        event =>
            event.supplementaryAttribution
    );


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
    {

        totalSlots:
            makeCheck(
                slotRecords.length,
                EXPECTED.TOTAL
            ),

        crateSlots:
            makeCheck(
                crateSlots.length,
                EXPECTED.CRATE
            ),

        goldenStatueSlots:
            makeCheck(
                statueSlots.length,
                EXPECTED.GOLDEN_STATUE
            ),

        normalCrates:
            makeCheck(
                normalCrates.length,
                EXPECTED.NORMAL_CRATE
            ),

        midBossCrates:
            makeCheck(
                midBossCrates.length,
                EXPECTED.MIDBOSS_CRATE
            ),

        normalGoldenStatues:
            makeCheck(
                normalStatues.length,
                EXPECTED.NORMAL_GOLDEN_STATUE
            ),

        midBossGoldenStatues:
            makeCheck(
                midBossStatues.length,
                EXPECTED.MIDBOSS_GOLDEN_STATUE
            ),

        breakEvents:
            makeCheck(
                allBreakEvents.length,
                attributionRows.length
            ),

        unknownSubclassSlots:
            makeCheck(
                unknownSlots.length,
                0
            ),

        slotsWithoutPosition:
            makeCheck(
                slotsWithoutPosition.length,
                0
            ),

        breakEventsWithoutSlot:
            makeCheck(
                anomalies.filter(
                    anomaly =>
                        anomaly.type ===
                        'BREAK_EVENT_WITHOUT_DISCOVERED_SLOT'
                ).length,
                0
            ),

        impossibleRespawnSpacing:
            makeCheck(
                anomalies.filter(
                    anomaly =>
                        anomaly.type ===
                        'BREAK_BEFORE_180_SECOND_RESPAWN'
                ).length,
                0
            )
    };


const validationPass =
    Object
        .values(
            validationChecks
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
            'BREAKABLE_CATALOG_V1',

        canonical:
            true,

        methodology:
            {

                slotIdentity:
                    'Persistent CCitadel_BreakableProp entity index.',

                resourceType:
                    {

                        '3986897915':
                            'CRATE',

                        '3719077267':
                            'GOLDEN_STATUE'
                    },

                spawnCohorts:
                    {

                        NORMAL_3_MIN:
                            NORMAL_SPAWN_SECONDS,

                        MIDBOSS_10_MIN:
                            MIDBOSS_SPAWN_SECONDS
                    },

                availability:
                    'Available from canonical cohort spawn time until a confirmed debris break. Unavailable for exactly 180 seconds after each break, then available again regardless of later PVS CREATE timing.',

                breakSignal:
                    'k_EEntityMsg_BreakablePropSpawnDebris / paired LEAVE signal established in prior validation.',

                rewardSignal:
                    'Reward outcomes inherited from breakable_action_attribution_v1.json.',

                breakerAttribution:
                    'Only V1 canonical MELEE_DIRECT and BULLET_RAY attribution is treated as known breaker identity.',

                supplementaryAttribution:
                    'Exact-origin + exact-preDamage Script 40 candidates are retained but explicitly noncanonical and must not be used as known breaker identity in behavioral metrics.'
            },

        timing:
            {

                tickRate:
                    TICK_RATE,

                matchClockOffsetSeconds,

                lastDemoTick,

                matchDurationSeconds,

                matchDurationClock:
                    formatClock(
                        matchDurationSeconds
                    ),

                respawnSeconds:
                    RESPAWN_SECONDS
            },

        validation:
            {

                pass:
                    validationPass,

                checks:
                    validationChecks,

                anomalyCount:
                    anomalies.length,

                anomalies
            },

        summary:
            {

                persistentSlots:
                    slotRecords.length,

                typeCounts:
                    {

                        CRATE:
                            crateSlots.length,

                        GOLDEN_STATUE:
                            statueSlots.length,

                        UNKNOWN:
                            unknownSlots.length
                    },

                spawnCohorts:
                    {

                        NORMAL_3_MIN:
                            {

                                total:
                                    normalCrates.length +
                                    normalStatues.length,

                                CRATE:
                                    normalCrates.length,

                                GOLDEN_STATUE:
                                    normalStatues.length
                            },

                        MIDBOSS_10_MIN:
                            {

                                total:
                                    midBossCrates.length +
                                    midBossStatues.length,

                                CRATE:
                                    midBossCrates.length,

                                GOLDEN_STATUE:
                                    midBossStatues.length
                            }
                    },

                lifecycle:
                    {

                        everBrokenSlots:
                            everBrokenSlots.length,

                        neverBrokenSlots:
                            neverBrokenSlots.length,

                        totalBreakEvents:
                            allBreakEvents.length,

                        totalPvsCreates:
                            totalBreakableCreates
                    },

                rewards:
                    {

                        crateBreaks:
                            crateBreaks.length,

                        crateSoulDrops:
                            crateSoulDrops.length,

                        crateNoDrop:
                            crateBreaks.length -
                            crateSoulDrops.length,

                        crateObservedDropRate:
                            rate(
                                crateSoulDrops.length,
                                crateBreaks.length
                            ),

                        crateObservedSoulTotal:
                            sum(
                                crateSoulDrops.map(
                                    event =>
                                        toFiniteNumber(
                                            event
                                                ?.rewardOutcome
                                                ?.goldReward
                                        )
                                )
                                .filter(
                                    value =>
                                        value !==
                                        null
                                )
                            ),

                        goldenStatueBreaks:
                            statueBreaks.length,

                        goldenStatueModifierDrops:
                            statueModifierDrops.length,

                        goldenStatueNoDrop:
                            statueBreaks.length -
                            statueModifierDrops.length,

                        goldenStatueObservedDropRate:
                            rate(
                                statueModifierDrops.length,
                                statueBreaks.length
                            ),

                        modifierSubclassCounts:
                            countBy(
                                statueModifierDrops,
                                event =>
                                    event
                                        ?.rewardOutcome
                                        ?.modifierSubclassId
                                    ??
                                    'UNKNOWN'
                            )
                    },

                canonicalBreakerAttribution:
                    {

                        attributed:
                            allAttributedBreaks.length,

                        unattributed:
                            allUnattributedBreaks.length,

                        total:
                            allBreakEvents.length,

                        rate:
                            rate(
                                allAttributedBreaks.length,
                                allBreakEvents.length
                            ),

                        methods:
                            countBy(
                                allAttributedBreaks,
                                event =>
                                    event
                                        ?.canonicalBreaker
                                        ?.method
                                    ??
                                    'UNKNOWN'
                            ),

                        players:
                            countBy(
                                allAttributedBreaks,
                                event =>
                                    event
                                        ?.canonicalBreaker
                                        ?.player
                                        ?.playerName
                                    ??
                                    'UNKNOWN'
                            )
                    },

                supplementaryNoncanonicalAttribution:
                    {

                        candidateBreaks:
                            supplementaryCandidates.length,

                        players:
                            countBy(
                                supplementaryCandidates,
                                event =>
                                    event
                                        ?.supplementaryAttribution
                                        ?.player
                                        ?.playerName
                                    ??
                                    'UNKNOWN'
                            )
                    }
            },

        slots:
            slotRecords,

        breakEvents:
            allBreakEvents
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
// CONSOLE SUMMARY
// ============================================================

console.log(
    'SLOT DISCOVERY'
);

console.log(
    '--------------'
);

console.log(
    `Persistent slots: ${slotRecords.length}`
);

console.log(
    `CRATE: ${crateSlots.length}`
);

console.log(
    `GOLDEN_STATUE: ${statueSlots.length}`
);

console.log(
    `Unknown: ${unknownSlots.length}`
);

console.log('');

console.log(
    'SPAWN COHORTS'
);

console.log(
    '-------------'
);

console.log(
    `3m crates: ${normalCrates.length}`
);

console.log(
    `3m statues: ${normalStatues.length}`
);

console.log(
    `10m crates: ${midBossCrates.length}`
);

console.log(
    `10m statues: ${midBossStatues.length}`
);

console.log('');

console.log(
    'LIFECYCLE'
);

console.log(
    '---------'
);

console.log(
    `Ever broken slots: ${everBrokenSlots.length}`
);

console.log(
    `Never broken slots: ${neverBrokenSlots.length}`
);

console.log(
    `Break events: ${allBreakEvents.length}`
);

console.log(
    `PVS CREATE events observed: ${totalBreakableCreates}`
);

console.log('');

console.log(
    'REWARDS'
);

console.log(
    '-------'
);

console.log(
    `Crate breaks: ${crateBreaks.length}`
);

console.log(
    `Soul drops: ${crateSoulDrops.length}`
);

console.log(
    `No-drop crates: ${crateBreaks.length - crateSoulDrops.length}`
);

console.log(
    `Observed crate drop rate: ${formatPercent(
        rate(
            crateSoulDrops.length,
            crateBreaks.length
        )
    )}`
);

console.log('');

console.log(
    `Statue breaks: ${statueBreaks.length}`
);

console.log(
    `Modifier drops: ${statueModifierDrops.length}`
);

console.log(
    `No-drop statues: ${statueBreaks.length - statueModifierDrops.length}`
);

console.log(
    `Observed statue drop rate: ${formatPercent(
        rate(
            statueModifierDrops.length,
            statueBreaks.length
        )
    )}`
);

console.log('');

console.log(
    'BREAKER ATTRIBUTION'
);

console.log(
    '-------------------'
);

console.log(
    `Canonical attributed: ${allAttributedBreaks.length}/${allBreakEvents.length}`
);

console.log(
    `Canonical rate: ${formatPercent(
        rate(
            allAttributedBreaks.length,
            allBreakEvents.length
        )
    )}`
);

console.log(
    `Supplementary noncanonical Script 40 candidates: ${supplementaryCandidates.length}`
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
        name,
        check
    ]
    of Object.entries(
        validationChecks
    )
) {

    console.log(
        `${
            check.pass
                ? 'PASS'
                : 'FAIL'
        }  ${
            String(
                name
            ).padEnd(
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


await parser.dispose();


// ============================================================
// AVAILABILITY BUILDER
// ============================================================

function buildAvailabilityIntervals(
    initialSpawnSeconds,
    breakEvents,
    matchEndSeconds
) {

    const availableIntervals =
        [];


    const unavailableIntervals =
        [];


    if (
        initialSpawnSeconds >
        matchEndSeconds
    ) {

        return {

            availableIntervals,

            unavailableIntervals
        };
    }


    let availableStart =
        initialSpawnSeconds;


    for (
        const breakEvent
        of breakEvents
    ) {

        const breakTime =
            breakEvent.breakMatchTimeSeconds;


        if (
            !Number.isFinite(
                breakTime
            )
        ) {

            continue;
        }


        // Ignore impossible early break for interval
        // construction; it is separately flagged.
        if (
            breakTime <
            availableStart
        ) {

            continue;
        }


        availableIntervals.push({

            startMatchTimeSeconds:
                availableStart,

            startClock:
                formatClock(
                    availableStart
                ),

            endMatchTimeSeconds:
                breakTime,

            endClock:
                formatClock(
                    breakTime
                ),

            durationSeconds:
                breakTime -
                availableStart,

            endedBy:
                'BREAK',

            breakKey:
                breakEvent.breakKey
        });


        const respawnTime =
            breakTime +
            RESPAWN_SECONDS;


        unavailableIntervals.push({

            startMatchTimeSeconds:
                breakTime,

            startClock:
                formatClock(
                    breakTime
                ),

            endMatchTimeSeconds:
                Math.min(
                    respawnTime,
                    matchEndSeconds
                ),

            endClock:
                formatClock(
                    Math.min(
                        respawnTime,
                        matchEndSeconds
                    )
                ),

            durationSeconds:
                Math.max(
                    0,
                    Math.min(
                        respawnTime,
                        matchEndSeconds
                    )
                    -
                    breakTime
                ),

            reason:
                'BROKEN_RESPAWN_TIMER',

            breakKey:
                breakEvent.breakKey
        });


        availableStart =
            respawnTime;


        if (
            availableStart >
            matchEndSeconds
        ) {

            break;
        }
    }


    if (
        availableStart <
        matchEndSeconds
    ) {

        availableIntervals.push({

            startMatchTimeSeconds:
                availableStart,

            startClock:
                formatClock(
                    availableStart
                ),

            endMatchTimeSeconds:
                matchEndSeconds,

            endClock:
                formatClock(
                    matchEndSeconds
                ),

            durationSeconds:
                matchEndSeconds -
                availableStart,

            endedBy:
                'REPLAY_END',

            breakKey:
                null
        });
    }


    return {

        availableIntervals,

        unavailableIntervals
    };
}


// ============================================================
// CANONICAL BREAKER
// ============================================================

function normalizeCanonicalBreaker(
    row
) {

    const status =
        row.attributionStatus
        ??
        'UNATTRIBUTED';


    if (
        status !==
        'ATTRIBUTED'
        ||
        !row.player
    ) {

        return {

            status,

            method:
                row.attributionMethod
                ??
                null,

            confidence:
                row.confidence
                ??
                null,

            player:
                null
        };
    }


    return {

        status:
            'ATTRIBUTED',

        method:
            row.attributionMethod
            ??
            null,

        confidence:
            row.confidence
            ??
            null,

        player:
            {

                playerName:
                    row.player.playerName
                    ??
                    null,

                heroId:
                    toFiniteNumber(
                        row.player.heroId
                    ),

                team:
                    toFiniteNumber(
                        row.player.team
                    ),

                pawnEntityIndex:
                    toFiniteNumber(
                        row.player.pawnEntityIndex
                    ),

                controllerEntityIndex:
                    toFiniteNumber(
                        row.player.controllerEntityIndex
                    )
            }
    };
}


// ============================================================
// REWARD OUTCOME
// ============================================================

function normalizeRewardOutcome(
    rewardOutcome
) {

    if (
        !rewardOutcome
        ||
        typeof rewardOutcome !==
        'object'
    ) {

        return {

            dropped:
                false,

            rewardType:
                null,

            pickupClass:
                null,

            pickupEntityIndex:
                null,

            goldReward:
                null,

            modifierSubclassId:
                null
        };
    }


    return {

        dropped:
            rewardOutcome.dropped ===
            true,

        rewardType:
            rewardOutcome.rewardType
            ??
            null,

        pickupClass:
            rewardOutcome.pickupClass
            ??
            null,

        pickupEntityIndex:
            toFiniteNumber(
                rewardOutcome.pickupEntityIndex
            ),

        goldReward:
            toFiniteNumber(
                rewardOutcome.goldReward
            ),

        modifierSubclassId:
            serializeValue(
                rewardOutcome.modifierSubclassId
            )
    };
}


// ============================================================
// WORLD POSITION
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

                : null
    };
}


// ============================================================
// SAFE FIELD READ
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

        // Ignore absent field.
    }


    return null;
}


// ============================================================
// ENTITY CLASS NAME
// ============================================================

function getEntityClassName(
    entity
) {

    try {

        if (
            typeof entity.getClassName ===
            'function'
        ) {

            return entity.getClassName();
        }

    } catch {

        // fall through
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
        toFiniteNumber(
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

            return toFiniteNumber(
                entity.getIndex()
            );
        }

    } catch {

        // fall through
    }


    return null;
}


// ============================================================
// CREATE OPERATION
// ============================================================

function isCreateOperation(
    operation
) {

    if (
        operation ===
        EntityOperation.CREATE
    ) {

        return true;
    }


    const string =
        String(
            operation
        )
        .toUpperCase();


    return (
        string ===
        'CREATE'
        ||
        string.endsWith(
            '.CREATE'
        )
    );
}


// ============================================================
// UNIQUE ABILITIES
// ============================================================

function uniqueAbilities(
    candidates
) {

    const map =
        new Map();


    for (
        const candidate
        of candidates
        ??
        []
    ) {

        const abilityId =
            serializeValue(
                candidate.abilityId
            );


        const abilityEntityIndex =
            toFiniteNumber(
                candidate.abilityEntityIndex
            );


        const key =
            `${
                abilityId
                ??
                'NULL'
            }|${
                abilityEntityIndex
                ??
                'NULL'
            }`;


        if (
            !map.has(
                key
            )
        ) {

            map.set(
                key,
                {

                    abilityId,

                    abilityEntityIndex
                }
            );
        }
    }


    return [
        ...map.values()
    ];
}


// ============================================================
// POSITION NORMALIZATION
// ============================================================

function normalizePosition(
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

        z
    };
}


// ============================================================
// VALIDATION CHECK
// ============================================================

function makeCheck(
    actual,
    expected
) {

    return {

        actual,

        expected,

        pass:
            actual ===
            expected
    };
}


// ============================================================
// COUNT BY
// ============================================================

function countBy(
    rows,
    selector
) {

    const map =
        new Map();


    for (
        const row
        of rows
        ??
        []
    ) {

        const raw =
            selector(
                row
            );


        const key =
            raw ===
                null
                ||
                raw ===
                undefined

                ? 'NULL'

                : String(
                    raw
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
// SUM
// ============================================================

function sum(
    values
) {

    let total =
        0;


    for (
        const value
        of values
        ??
        []
    ) {

        if (
            Number.isFinite(
                value
            )
        ) {

            total +=
                value;
        }
    }


    return total;
}


// ============================================================
// RATE
// ============================================================

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


    return (
        numerator /
        denominator
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
    matchClockOffsetSeconds;
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


    const numeric =
        Number(
            value
        );


    return Number.isFinite(
        numeric
    )

        ? numeric

        : null;
}


// ============================================================
// PERCENT
// ============================================================

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