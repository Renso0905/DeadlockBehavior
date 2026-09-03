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
    InterceptorStage
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


const TICK_RATE =
    64;


const ENTITY_INDEX_MASK =
    0x3fff;


// We only need a tiny temporal neighborhood.
//
// Exact tick is the primary test.
const MAX_TICK_WINDOW =
    2;


// Spatial thresholds to evaluate.
//
// Script 37 showed some true exact-origin matches with
// originDistance = 0.
//
// We still test progressively larger tolerances so we can see
// exactly when false-player matches begin appearing.
const ORIGIN_DISTANCE_THRESHOLDS =
    [
        0.000001,
        0.001,
        0.01,
        0.1,
        0.25,
        1,
        4,
        16,
        32,
        64
    ];


// Temporal windows.
const TICK_WINDOWS =
    [
        0,
        1,
        2
    ];


// Exact preDamage matching threshold.
//
// This is only used for the COMBINED signal.
//
// We already know preDamage alone is unsafe.
const PREDAMAGE_EPSILON =
    0.000001;


// Candidate strict origin rule.
//
// Diagnostic only.
//
// Do NOT make this canonical in Script 40.
const STRICT_ORIGIN_TICK_WINDOW =
    0;


const STRICT_ORIGIN_DISTANCE =
    0.001;


// Candidate strict combined rule.
const STRICT_COMBINED_TICK_WINDOW =
    0;


const STRICT_COMBINED_ORIGIN_DISTANCE =
    0.001;


const STRICT_COMBINED_PREDAMAGE_EPSILON =
    0.000001;


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


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_damage_origin_validation.json'
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
// LOAD ATTRIBUTION V1
// ============================================================

const attribution =
    JSON.parse(
        readFileSync(
            attributionPath,
            'utf8'
        )
    );


const sourceRows =
    Array.isArray(
        attribution.attributionRows
    )
        ? attribution.attributionRows
        : [];


if (
    sourceRows.length ===
    0
) {

    throw new Error(
        'breakable_action_attribution_v1.json contains no attributionRows.'
    );
}


const matchClockOffsetSeconds =
    toFiniteNumber(
        attribution
            ?.canonical
            ?.matchClockOffsetSeconds
    )
    ??
    30;


// ============================================================
// PLAYER IDENTITY
// ============================================================

const playerByPawnIndex =
    new Map();


const playerByControllerIndex =
    new Map();


for (
    const row
    of attribution.playerSummaries
    ??
    []
) {

    const player =
        {

            playerName:
                row.playerName
                ??
                null,

            heroId:
                toFiniteNumber(
                    row.heroId
                ),

            team:
                toFiniteNumber(
                    row.team
                ),

            pawnEntityIndex:
                toFiniteNumber(
                    row.pawnEntityIndex
                ),

            controllerEntityIndex:
                toFiniteNumber(
                    row.controllerEntityIndex
                )
        };


    if (
        player.pawnEntityIndex !==
        null
    ) {

        playerByPawnIndex.set(
            player.pawnEntityIndex,
            player
        );
    }


    if (
        player.controllerEntityIndex !==
        null
    ) {

        playerByControllerIndex.set(
            player.controllerEntityIndex,
            player
        );
    }
}


// ============================================================
// NORMALIZE BREAKS
// ============================================================

const breaks =
    sourceRows

        .map(
            row => {

                const debris =
                    row.debris
                    ??
                    {};


                const impactPosition =
                    normalizePosition(
                        row.impactPosition
                        ??
                        debris.damagePos
                        ??
                        debris.position
                    );


                return {

                    breakKey:
                        row.breakKey,

                    entityIndex:
                        toFiniteNumber(
                            row.entityIndex
                        ),

                    resourceType:
                        row.resourceType
                        ??
                        'UNKNOWN',

                    subclassId:
                        serializeValue(
                            row.subclassId
                        ),

                    breakTick:
                        toFiniteNumber(
                            row.breakTick
                        ),

                    breakMatchTimeSeconds:
                        toFiniteNumber(
                            row.breakMatchTimeSeconds
                        ),

                    breakClock:
                        row.breakClock
                        ??
                        null,

                    resourcePosition:
                        normalizePosition(
                            row.position
                        ),

                    impactPosition,

                    debrisDamage:
                        toFiniteNumber(
                            debris.damage
                        ),

                    rewardOutcome:
                        row.rewardOutcome
                        ??
                        null,

                    attributionStatus:
                        row.attributionStatus
                        ??
                        null,

                    attributionMethod:
                        row.attributionMethod
                        ??
                        null,

                    existingPlayer:
                        row.player
                        ??
                        null
                };
            }
        )

        .filter(
            row =>
                row.breakKey
                &&
                row.breakTick !==
                    null
                &&
                row.impactPosition
        )

        .sort(
            (
                a,
                b
            ) =>
                a.breakTick -
                b.breakTick
        );


if (
    breaks.length ===
    0
) {

    throw new Error(
        'No break rows with usable impact positions.'
    );
}


// ============================================================
// GROUPS
// ============================================================

const attributedBreaks =
    breaks.filter(
        row =>
            row.attributionStatus ===
            'ATTRIBUTED'
            &&
            row.existingPlayer
    );


const meleeControls =
    attributedBreaks.filter(
        row =>
            row.attributionMethod ===
            'MELEE_DIRECT'
    );


const bulletControls =
    attributedBreaks.filter(
        row =>
            row.attributionMethod ===
            'BULLET_RAY'
    );


const unresolvedBreaks =
    breaks.filter(
        row =>
            row.attributionStatus !==
            'ATTRIBUTED'
    );


// ============================================================
// RELEVANT TICKS
// ============================================================

const relevantTicks =
    new Set();


for (
    const row
    of breaks
) {

    for (
        let delta =
            -MAX_TICK_WINDOW;

        delta <=
            MAX_TICK_WINDOW;

        delta++
    ) {

        relevantTicks.add(
            row.breakTick +
            delta
        );
    }
}


// ============================================================
// DAMAGE EVENTS
// ============================================================

const damageByTick =
    new Map();


let totalDamageMessages =
    0;


let damageMessagesInWindows =
    0;


let playerResolvedDamageMessages =
    0;


let nonPlayerDamageMessages =
    0;


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        const tick =
            toFiniteNumber(
                demoPacket.tick
            );


        if (
            tick ===
            null
        ) {

            return;
        }


        const typeCode =
            getMessageTypeCode(
                messagePacket
            );


        if (
            typeCode !==
            'k_EUserMsg_Damage'
        ) {

            return;
        }


        totalDamageMessages++;


        if (
            !relevantTicks.has(
                tick
            )
        ) {

            return;
        }


        damageMessagesInWindows++;


        const data =
            messagePacket.data
            ??
            {};


        const attackerIndex =
            toFiniteNumber(
                data.entindexAttacker
            );


        const player =
            resolvePlayerEntity(
                attackerIndex
            );


        if (
            player
        ) {

            playerResolvedDamageMessages++;

        } else {

            nonPlayerDamageMessages++;
        }


        const origin =
            normalizePosition(
                data.origin
            );


        const event =
            {

                tick,

                matchTimeSeconds:
                    tickToMatchTime(
                        tick
                    ),

                clock:
                    formatClock(
                        tickToMatchTime(
                            tick
                        )
                    ),

                player,

                attackerIndex,

                victimIndex:
                    toFiniteNumber(
                        data.entindexVictim
                    ),

                inflictorIndex:
                    toFiniteNumber(
                        data.entindexInflictor
                    ),

                abilityEntityIndex:
                    toFiniteNumber(
                        data.entindexAbility
                    ),

                abilityId:
                    serializeValue(
                        data.abilityId
                    ),

                damage:
                    toFiniteNumber(
                        data.damage
                    ),

                preDamage:
                    toFiniteNumber(
                        data.preDamage
                    ),

                healthLost:
                    toFiniteNumber(
                        data.healthLost
                    ),

                damageAbsorbed:
                    toFiniteNumber(
                        data.damageAbsorbed
                    ),

                citadelType:
                    toFiniteNumber(
                        data.citadelType
                    ),

                damageType:
                    serializeValue(
                        data.type
                    ),

                attackerClass:
                    toFiniteNumber(
                        data.attackerClass
                    ),

                victimClass:
                    toFiniteNumber(
                        data.victimClass
                    ),

                origin,

                damageDirection:
                    normalizePosition(
                        data.damageDirection
                    ),

                serverTick:
                    toFiniteNumber(
                        data.serverTick
                    )
            };


        if (
            !damageByTick.has(
                tick
            )
        ) {

            damageByTick.set(
                tick,
                []
            );
        }


        damageByTick
            .get(
                tick
            )
            .push(
                event
            );
    }
);


// ============================================================
// RUN
// ============================================================

console.log('');

console.log(
    '==========================================='
);

console.log(
    'BREAKABLE DAMAGE ORIGIN VALIDATION'
);

console.log(
    '==========================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Breaks with impact positions: ${breaks.length}`
);

console.log(
    `Known attributed controls: ${attributedBreaks.length}`
);

console.log(
    `  melee: ${meleeControls.length}`
);

console.log(
    `  bullet: ${bulletControls.length}`
);

console.log(
    `Unresolved: ${unresolvedBreaks.length}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// BUILD CANDIDATE ROWS
// ============================================================

const breakRows =
    [];


for (
    const breakEvent
    of breaks
) {

    const candidates =
        [];


    for (
        let tick =
            breakEvent.breakTick -
            MAX_TICK_WINDOW;

        tick <=
            breakEvent.breakTick +
            MAX_TICK_WINDOW;

        tick++
    ) {

        const damageEvents =
            damageByTick.get(
                tick
            )
            ??
            [];


        for (
            const damageEvent
            of damageEvents
        ) {

            if (
                !damageEvent.player
                ||
                !damageEvent.origin
            ) {

                continue;
            }


            const tickDelta =
                damageEvent.tick -
                breakEvent.breakTick;


            const originDistance3D =
                distance3D(
                    breakEvent.impactPosition,
                    damageEvent.origin
                );


            const originDistanceXY =
                distanceXY(
                    breakEvent.impactPosition,
                    damageEvent.origin
                );


            const preDamageDifference =
                (
                    breakEvent.debrisDamage !==
                        null
                    &&
                    damageEvent.preDamage !==
                        null
                )

                    ? Math.abs(
                        breakEvent.debrisDamage -
                        damageEvent.preDamage
                    )

                    : null;


            candidates.push({

                damageTick:
                    damageEvent.tick,

                damageClock:
                    damageEvent.clock,

                tickDelta,

                timeDeltaSeconds:
                    tickDelta /
                    TICK_RATE,

                player:
                    damageEvent.player,

                attackerIndex:
                    damageEvent.attackerIndex,

                victimIndex:
                    damageEvent.victimIndex,

                inflictorIndex:
                    damageEvent.inflictorIndex,

                abilityEntityIndex:
                    damageEvent.abilityEntityIndex,

                abilityId:
                    damageEvent.abilityId,

                damage:
                    damageEvent.damage,

                preDamage:
                    damageEvent.preDamage,

                debrisDamage:
                    breakEvent.debrisDamage,

                preDamageDifference,

                healthLost:
                    damageEvent.healthLost,

                damageAbsorbed:
                    damageEvent.damageAbsorbed,

                citadelType:
                    damageEvent.citadelType,

                damageType:
                    damageEvent.damageType,

                attackerClass:
                    damageEvent.attackerClass,

                victimClass:
                    damageEvent.victimClass,

                damageOrigin:
                    damageEvent.origin,

                impactPosition:
                    breakEvent.impactPosition,

                originDistance3D,

                originDistanceXY,

                serverTick:
                    damageEvent.serverTick,

                score:
                    candidateScore(
                        tickDelta,
                        originDistance3D,
                        preDamageDifference
                    )
            });
        }
    }


    candidates.sort(
        (
            a,
            b
        ) =>
            a.score -
            b.score
    );


    breakRows.push({

        ...breakEvent,

        candidateCount:
            candidates.length,

        candidates
    });
}


// ============================================================
// THRESHOLD MATRIX
// ============================================================

const thresholdMatrix =
    [];


for (
    const tickWindow
    of TICK_WINDOWS
) {

    for (
        const originDistance
        of ORIGIN_DISTANCE_THRESHOLDS
    ) {

        const originRule =
            {

                tickWindow,

                originDistance,

                requirePreDamageMatch:
                    false
            };


        const combinedRule =
            {

                tickWindow,

                originDistance,

                requirePreDamageMatch:
                    true,

                preDamageEpsilon:
                    PREDAMAGE_EPSILON
            };


        thresholdMatrix.push({

            tickWindow,

            tickWindowSeconds:
                tickWindow /
                TICK_RATE,

            originDistance,

            originOnly:
                {

                    allControls:
                        evaluateControls(
                            attributedBreaks,
                            originRule
                        ),

                    meleeControls:
                        evaluateControls(
                            meleeControls,
                            originRule
                        ),

                    bulletControls:
                        evaluateControls(
                            bulletControls,
                            originRule
                        ),

                    unresolved:
                        evaluateUnresolved(
                            unresolvedBreaks,
                            originRule
                        )
                },

            originPlusPreDamage:
                {

                    allControls:
                        evaluateControls(
                            attributedBreaks,
                            combinedRule
                        ),

                    meleeControls:
                        evaluateControls(
                            meleeControls,
                            combinedRule
                        ),

                    bulletControls:
                        evaluateControls(
                            bulletControls,
                            combinedRule
                        ),

                    unresolved:
                        evaluateUnresolved(
                            unresolvedBreaks,
                            combinedRule
                        )
                }
        });
    }
}


// ============================================================
// STRICT ORIGIN RESULTS
// ============================================================

const strictOriginRule =
    {

        tickWindow:
            STRICT_ORIGIN_TICK_WINDOW,

        originDistance:
            STRICT_ORIGIN_DISTANCE,

        requirePreDamageMatch:
            false
    };


const strictCombinedRule =
    {

        tickWindow:
            STRICT_COMBINED_TICK_WINDOW,

        originDistance:
            STRICT_COMBINED_ORIGIN_DISTANCE,

        requirePreDamageMatch:
            true,

        preDamageEpsilon:
            STRICT_COMBINED_PREDAMAGE_EPSILON
    };


const strictOriginControls =
    evaluateControls(
        attributedBreaks,
        strictOriginRule
    );


const strictOriginBulletControls =
    evaluateControls(
        bulletControls,
        strictOriginRule
    );


const strictOriginMeleeControls =
    evaluateControls(
        meleeControls,
        strictOriginRule
    );


const strictOriginUnresolved =
    evaluateUnresolved(
        unresolvedBreaks,
        strictOriginRule
    );


const strictCombinedControls =
    evaluateControls(
        attributedBreaks,
        strictCombinedRule
    );


const strictCombinedBulletControls =
    evaluateControls(
        bulletControls,
        strictCombinedRule
    );


const strictCombinedMeleeControls =
    evaluateControls(
        meleeControls,
        strictCombinedRule
    );


const strictCombinedUnresolved =
    evaluateUnresolved(
        unresolvedBreaks,
        strictCombinedRule
    );


// ============================================================
// STRICT BREAK CLASSIFICATION
// ============================================================

const strictRows =
    [];


for (
    const row
    of breakRows
) {

    const originCandidates =
        candidatesForRule(
            row,
            strictOriginRule
        );


    const combinedCandidates =
        candidatesForRule(
            row,
            strictCombinedRule
        );


    const originPlayers =
        uniquePlayers(
            originCandidates
        );


    const combinedPlayers =
        uniquePlayers(
            combinedCandidates
        );


    let originClassification =
        'NONE';


    if (
        originPlayers.length ===
        1
    ) {

        originClassification =
            'UNIQUE_PLAYER';

    } else if (
        originPlayers.length >
        1
    ) {

        originClassification =
            'MULTIPLE_PLAYERS';
    }


    let combinedClassification =
        'NONE';


    if (
        combinedPlayers.length ===
        1
    ) {

        combinedClassification =
            'UNIQUE_PLAYER';

    } else if (
        combinedPlayers.length >
        1
    ) {

        combinedClassification =
            'MULTIPLE_PLAYERS';
    }


    const originPlayer =
        originPlayers.length ===
            1
            ? originPlayers[0]
            : null;


    const combinedPlayer =
        combinedPlayers.length ===
            1
            ? combinedPlayers[0]
            : null;


    strictRows.push({

        breakKey:
            row.breakKey,

        breakTick:
            row.breakTick,

        breakClock:
            row.breakClock,

        entityIndex:
            row.entityIndex,

        resourceType:
            row.resourceType,

        impactPosition:
            row.impactPosition,

        debrisDamage:
            row.debrisDamage,

        rewardOutcome:
            row.rewardOutcome,

        existingAttribution:
            {

                status:
                    row.attributionStatus,

                method:
                    row.attributionMethod,

                player:
                    row.existingPlayer
            },

        originOnly:
            {

                classification:
                    originClassification,

                candidateCount:
                    originCandidates.length,

                uniquePlayerCount:
                    originPlayers.length,

                players:
                    originPlayers,

                player:
                    originPlayer,

                agreesWithExisting:
                    (
                        originPlayer
                        &&
                        row.existingPlayer
                    )

                        ? samePlayer(
                            originPlayer,
                            row.existingPlayer
                        )

                        : null,

                candidates:
                    originCandidates
            },

        originPlusPreDamage:
            {

                classification:
                    combinedClassification,

                candidateCount:
                    combinedCandidates.length,

                uniquePlayerCount:
                    combinedPlayers.length,

                players:
                    combinedPlayers,

                player:
                    combinedPlayer,

                agreesWithExisting:
                    (
                        combinedPlayer
                        &&
                        row.existingPlayer
                    )

                        ? samePlayer(
                            combinedPlayer,
                            row.existingPlayer
                        )

                        : null,

                candidates:
                    combinedCandidates
            }
    });
}


// ============================================================
// STRICT CONFLICT ROWS
// ============================================================

const originControlConflicts =
    strictRows.filter(
        row =>
            row.existingAttribution.status ===
                'ATTRIBUTED'
            &&
            row.originOnly.player
            &&
            row.originOnly.agreesWithExisting ===
                false
    );


const combinedControlConflicts =
    strictRows.filter(
        row =>
            row.existingAttribution.status ===
                'ATTRIBUTED'
            &&
            row.originPlusPreDamage.player
            &&
            row
                .originPlusPreDamage
                .agreesWithExisting ===
                false
    );


// ============================================================
// STRICT AGREEMENT ROWS
// ============================================================

const originControlAgreements =
    strictRows.filter(
        row =>
            row.existingAttribution.status ===
                'ATTRIBUTED'
            &&
            row.originOnly.player
            &&
            row.originOnly.agreesWithExisting ===
                true
    );


const combinedControlAgreements =
    strictRows.filter(
        row =>
            row.existingAttribution.status ===
                'ATTRIBUTED'
            &&
            row.originPlusPreDamage.player
            &&
            row
                .originPlusPreDamage
                .agreesWithExisting ===
                true
    );


// ============================================================
// UNRESOLVED CANDIDATES
// ============================================================

const originUnresolvedCandidates =
    strictRows.filter(
        row =>
            row.existingAttribution.status !==
                'ATTRIBUTED'
            &&
            row.originOnly.player
    );


const combinedUnresolvedCandidates =
    strictRows.filter(
        row =>
            row.existingAttribution.status !==
                'ATTRIBUTED'
            &&
            row.originPlusPreDamage.player
    );


// ============================================================
// ORIGIN vs COMBINED RELATIONSHIP
// ============================================================

let unresolvedBothSignals =
    0;


let unresolvedBothAgree =
    0;


let unresolvedBothConflict =
    0;


for (
    const row
    of strictRows
) {

    if (
        row.existingAttribution.status ===
        'ATTRIBUTED'
        ||
        !row.originOnly.player
        ||
        !row.originPlusPreDamage.player
    ) {

        continue;
    }


    unresolvedBothSignals++;


    if (
        samePlayer(
            row.originOnly.player,
            row.originPlusPreDamage.player
        )
    ) {

        unresolvedBothAgree++;

    } else {

        unresolvedBothConflict++;
    }
}


// ============================================================
// PLAYER COUNTS
// ============================================================

const strictOriginUnresolvedPlayerCounts =
    countBy(
        originUnresolvedCandidates,
        row =>
            row
                .originOnly
                .player
                ?.playerName
            ??
            'UNKNOWN'
    );


const strictCombinedUnresolvedPlayerCounts =
    countBy(
        combinedUnresolvedCandidates,
        row =>
            row
                .originPlusPreDamage
                .player
                ?.playerName
            ??
            'UNKNOWN'
    );


// ============================================================
// ABILITY COUNTS
// ============================================================

const strictCombinedAbilityCounts =
    countBy(
        combinedUnresolvedCandidates,
        row => {

            const candidates =
                row
                    .originPlusPreDamage
                    .candidates
                ??
                [];


            const abilities =
                uniqueAbilities(
                    candidates
                );


            if (
                abilities.length ===
                1
            ) {

                return (
                    `${
                        abilities[0].abilityId
                        ??
                        'NULL'
                    }|entity:${
                        abilities[0].abilityEntityIndex
                        ??
                        'NULL'
                    }`
                );
            }


            return (
                `MULTIPLE:${
                    abilities.length
                }`
            );
        }
    );


// ============================================================
// HYPOTHETICAL COVERAGE
//
// Still diagnostic.
//
// We only calculate it so we know the possible gain.
// ============================================================

const existingAttributed =
    attributedBreaks.length;


const hypotheticalOriginAttributed =
    existingAttributed +
    originUnresolvedCandidates.length;


const hypotheticalCombinedAttributed =
    existingAttributed +
    combinedUnresolvedCandidates.length;


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BREAKABLE_DAMAGE_ORIGIN_VALIDATION',

        canonical:
            false,

        purpose:
            [

                'Validate exact k_EUserMsg_Damage origin matching against all breakable resource events.',

                'Use already-attributed melee and bullet-ray breaks as positive controls.',

                'Measure precision and conflict rate conditional on a spatial origin candidate existing.',

                'Compare origin-only matching against the stricter conjunction of exact origin plus exact preDamage.',

                'Do not change canonical attribution in this script.'
            ],

        constants:
            {

                tickRate:
                    TICK_RATE,

                maxTickWindow:
                    MAX_TICK_WINDOW,

                preDamageEpsilon:
                    PREDAMAGE_EPSILON,

                strictOrigin:
                    {

                        tickWindow:
                            STRICT_ORIGIN_TICK_WINDOW,

                        maxOriginDistance3D:
                            STRICT_ORIGIN_DISTANCE
                    },

                strictCombined:
                    {

                        tickWindow:
                            STRICT_COMBINED_TICK_WINDOW,

                        maxOriginDistance3D:
                            STRICT_COMBINED_ORIGIN_DISTANCE,

                        maxPreDamageDifference:
                            STRICT_COMBINED_PREDAMAGE_EPSILON
                    }
            },

        sourceCounts:
            {

                totalSourceRows:
                    sourceRows.length,

                usableBreakRows:
                    breaks.length,

                attributedControls:
                    attributedBreaks.length,

                meleeControls:
                    meleeControls.length,

                bulletControls:
                    bulletControls.length,

                unresolved:
                    unresolvedBreaks.length,

                players:
                    playerByPawnIndex.size
            },

        messageCounts:
            {

                totalDamageMessages,

                damageMessagesInWindows,

                playerResolvedDamageMessages,

                nonPlayerDamageMessages
            },

        thresholdMatrix,

        strictOrigin:
            {

                rule:
                    strictOriginRule,

                allControls:
                    strictOriginControls,

                meleeControls:
                    strictOriginMeleeControls,

                bulletControls:
                    strictOriginBulletControls,

                unresolved:
                    strictOriginUnresolved,

                controlAgreementRows:
                    originControlAgreements,

                controlConflictRows:
                    originControlConflicts,

                unresolvedCandidateRows:
                    originUnresolvedCandidates,

                unresolvedPlayerCounts:
                    strictOriginUnresolvedPlayerCounts,

                hypotheticalCoverage:
                    {

                        existingAttributed,

                        newlyAttributed:
                            originUnresolvedCandidates.length,

                        totalAttributed:
                            hypotheticalOriginAttributed,

                        totalBreaks:
                            breaks.length,

                        coverage:
                            rate(
                                hypotheticalOriginAttributed,
                                breaks.length
                            )
                    }
            },

        strictOriginPlusPreDamage:
            {

                rule:
                    strictCombinedRule,

                allControls:
                    strictCombinedControls,

                meleeControls:
                    strictCombinedMeleeControls,

                bulletControls:
                    strictCombinedBulletControls,

                unresolved:
                    strictCombinedUnresolved,

                controlAgreementRows:
                    combinedControlAgreements,

                controlConflictRows:
                    combinedControlConflicts,

                unresolvedCandidateRows:
                    combinedUnresolvedCandidates,

                unresolvedPlayerCounts:
                    strictCombinedUnresolvedPlayerCounts,

                unresolvedAbilityCounts:
                    strictCombinedAbilityCounts,

                hypotheticalCoverage:
                    {

                        existingAttributed,

                        newlyAttributed:
                            combinedUnresolvedCandidates.length,

                        totalAttributed:
                            hypotheticalCombinedAttributed,

                        totalBreaks:
                            breaks.length,

                        coverage:
                            rate(
                                hypotheticalCombinedAttributed,
                                breaks.length
                            )
                    }
            },

        unresolvedSignalRelationship:
            {

                rowsWithBothOriginAndCombinedUniquePlayer:
                    unresolvedBothSignals,

                agreements:
                    unresolvedBothAgree,

                conflicts:
                    unresolvedBothConflict,

                agreementRate:
                    rate(
                        unresolvedBothAgree,
                        unresolvedBothSignals
                    )
            },

        strictRows
    };


// ============================================================
// WRITE OUTPUT
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
// CONSOLE
// ============================================================

console.log('');

console.log(
    'MESSAGE STREAM'
);

console.log(
    '--------------'
);

console.log(
    `Total k_EUserMsg_Damage: ${totalDamageMessages}`
);

console.log(
    `Inside break windows: ${damageMessagesInWindows}`
);

console.log(
    `Player-resolved: ${playerResolvedDamageMessages}`
);

console.log('');


// ============================================================
// MATRIX SUMMARY
// ============================================================

console.log(
    'EXACT-TICK ORIGIN THRESHOLDS'
);

console.log(
    '----------------------------'
);

console.log('');


for (
    const originDistance
    of ORIGIN_DISTANCE_THRESHOLDS
) {

    const row =
        thresholdMatrix.find(
            item =>
                item.tickWindow ===
                    0
                &&
                item.originDistance ===
                    originDistance
        );


    if (
        !row
    ) {

        continue;
    }


    const originControls =
        row
            .originOnly
            .allControls;


    const originUnresolved =
        row
            .originOnly
            .unresolved;


    const combinedControls =
        row
            .originPlusPreDamage
            .allControls;


    const combinedUnresolved =
        row
            .originPlusPreDamage
            .unresolved;


    console.log(
        `dist <= ${
            String(
                originDistance
            ).padStart(
                9
            )
        } | ORIGIN ctrl=${
            String(
                originControls.uniquePlayerBreaks
            ).padStart(
                3
            )
        } agree=${
            String(
                originControls.agreementBreaks
            ).padStart(
                3
            )
        } conflict=${
            String(
                originControls.conflictBreaks
            ).padStart(
                3
            )
        } unresolved=${
            String(
                originUnresolved.uniquePlayerBreaks
            ).padStart(
                3
            )
        } | COMBINED ctrl=${
            String(
                combinedControls.uniquePlayerBreaks
            ).padStart(
                3
            )
        } agree=${
            String(
                combinedControls.agreementBreaks
            ).padStart(
                3
            )
        } conflict=${
            String(
                combinedControls.conflictBreaks
            ).padStart(
                3
            )
        } unresolved=${
            String(
                combinedUnresolved.uniquePlayerBreaks
            ).padStart(
                3
            )
        }`
    );
}


console.log('');


// ============================================================
// STRICT ORIGIN
// ============================================================

console.log(
    'STRICT ORIGIN ONLY'
);

console.log(
    '------------------'
);

printControlSummary(
    'All controls',
    strictOriginControls
);

printControlSummary(
    'Melee',
    strictOriginMeleeControls
);

printControlSummary(
    'Bullet',
    strictOriginBulletControls
);

console.log(
    `Unresolved unique-player candidates: ${strictOriginUnresolved.uniquePlayerBreaks}`
);

console.log('');


// ============================================================
// STRICT COMBINED
// ============================================================

console.log(
    'STRICT ORIGIN + PREDAMAGE'
);

console.log(
    '-------------------------'
);

printControlSummary(
    'All controls',
    strictCombinedControls
);

printControlSummary(
    'Melee',
    strictCombinedMeleeControls
);

printControlSummary(
    'Bullet',
    strictCombinedBulletControls
);

console.log(
    `Unresolved unique-player candidates: ${strictCombinedUnresolved.uniquePlayerBreaks}`
);

console.log('');


// ============================================================
// CONFLICT EXAMPLES
// ============================================================

console.log(
    'STRICT ORIGIN CONTROL CONFLICTS'
);

console.log(
    '-------------------------------'
);

console.log(
    `Count: ${originControlConflicts.length}`
);


for (
    const row
    of originControlConflicts
        .slice(
            0,
            20
        )
) {

    console.log(
        `${
            String(
                row.breakClock
            ).padEnd(
                8
            )
        } ${
            row.breakKey
        } known=${
            row
                .existingAttribution
                .player
                ?.playerName
            ??
            'UNKNOWN'
        } origin=${
            row
                .originOnly
                .player
                ?.playerName
            ??
            'UNKNOWN'
        } method=${
            row
                .existingAttribution
                .method
        }`
    );
}


console.log('');

console.log(
    'STRICT COMBINED CONTROL CONFLICTS'
);

console.log(
    '---------------------------------'
);

console.log(
    `Count: ${combinedControlConflicts.length}`
);


for (
    const row
    of combinedControlConflicts
        .slice(
            0,
            20
        )
) {

    console.log(
        `${
            String(
                row.breakClock
            ).padEnd(
                8
            )
        } ${
            row.breakKey
        } known=${
            row
                .existingAttribution
                .player
                ?.playerName
            ??
            'UNKNOWN'
        } combined=${
            row
                .originPlusPreDamage
                .player
                ?.playerName
            ??
            'UNKNOWN'
        } method=${
            row
                .existingAttribution
                .method
        }`
    );
}


console.log('');


// ============================================================
// HYPOTHETICAL COVERAGE
// ============================================================

console.log(
    'HYPOTHETICAL COVERAGE'
);

console.log(
    '---------------------'
);

console.log(
    `Current V1: ${existingAttributed}/${breaks.length} = ${formatPercent(
        rate(
            existingAttributed,
            breaks.length
        )
    )}`
);

console.log(
    `+ strict origin: ${hypotheticalOriginAttributed}/${breaks.length} = ${formatPercent(
        rate(
            hypotheticalOriginAttributed,
            breaks.length
        )
    )}`
);

console.log(
    `+ strict origin+preDamage: ${hypotheticalCombinedAttributed}/${breaks.length} = ${formatPercent(
        rate(
            hypotheticalCombinedAttributed,
            breaks.length
        )
    )}`
);

console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// EVALUATE CONTROLS
// ============================================================

function evaluateControls(
    sourceBreaks,
    rule
) {

    let breaksWithCandidate =
        0;


    let uniquePlayerBreaks =
        0;


    let multiplePlayerBreaks =
        0;


    let agreementBreaks =
        0;


    let conflictBreaks =
        0;


    for (
        const source
        of sourceBreaks
    ) {

        const row =
            breakRows.find(
                item =>
                    item.breakKey ===
                    source.breakKey
            );


        if (
            !row
        ) {

            continue;
        }


        const candidates =
            candidatesForRule(
                row,
                rule
            );


        if (
            candidates.length ===
            0
        ) {

            continue;
        }


        breaksWithCandidate++;


        const players =
            uniquePlayers(
                candidates
            );


        if (
            players.length ===
            1
        ) {

            uniquePlayerBreaks++;


            if (
                samePlayer(
                    players[0],
                    source.existingPlayer
                )
            ) {

                agreementBreaks++;

            } else {

                conflictBreaks++;
            }


        } else if (
            players.length >
            1
        ) {

            multiplePlayerBreaks++;
        }
    }


    return {

        totalBreaks:
            sourceBreaks.length,

        breaksWithCandidate,

        matchRate:
            rate(
                breaksWithCandidate,
                sourceBreaks.length
            ),

        uniquePlayerBreaks,

        multiplePlayerBreaks,

        agreementBreaks,

        conflictBreaks,

        agreementRateAmongUnique:
            rate(
                agreementBreaks,
                uniquePlayerBreaks
            ),

        conflictRateAmongUnique:
            rate(
                conflictBreaks,
                uniquePlayerBreaks
            )
    };
}


// ============================================================
// EVALUATE UNRESOLVED
// ============================================================

function evaluateUnresolved(
    sourceBreaks,
    rule
) {

    let breaksWithCandidate =
        0;


    let uniquePlayerBreaks =
        0;


    let multiplePlayerBreaks =
        0;


    for (
        const source
        of sourceBreaks
    ) {

        const row =
            breakRows.find(
                item =>
                    item.breakKey ===
                    source.breakKey
            );


        if (
            !row
        ) {

            continue;
        }


        const candidates =
            candidatesForRule(
                row,
                rule
            );


        if (
            candidates.length ===
            0
        ) {

            continue;
        }


        breaksWithCandidate++;


        const players =
            uniquePlayers(
                candidates
            );


        if (
            players.length ===
            1
        ) {

            uniquePlayerBreaks++;

        } else if (
            players.length >
            1
        ) {

            multiplePlayerBreaks++;
        }
    }


    return {

        totalBreaks:
            sourceBreaks.length,

        breaksWithCandidate,

        matchRate:
            rate(
                breaksWithCandidate,
                sourceBreaks.length
            ),

        uniquePlayerBreaks,

        multiplePlayerBreaks
    };
}


// ============================================================
// RULE FILTER
// ============================================================

function candidatesForRule(
    row,
    rule
) {

    return (
        row.candidates
        ??
        []
    )

        .filter(
            candidate => {

                if (
                    Math.abs(
                        candidate.tickDelta
                    )
                    >
                    rule.tickWindow
                ) {

                    return false;
                }


                if (
                    candidate.originDistance3D >
                    rule.originDistance
                ) {

                    return false;
                }


                if (
                    rule.requirePreDamageMatch
                ) {

                    if (
                        candidate.preDamageDifference ===
                            null
                        ||
                        candidate.preDamageDifference >
                            rule.preDamageEpsilon
                    ) {

                        return false;
                    }
                }


                return true;
            }
        )

        .sort(
            (
                a,
                b
            ) =>
                a.score -
                b.score
        );
}


// ============================================================
// UNIQUE PLAYERS
// ============================================================

function uniquePlayers(
    candidates
) {

    const map =
        new Map();


    for (
        const candidate
        of candidates
    ) {

        const player =
            candidate.player;


        if (
            !player
        ) {

            continue;
        }


        const key =
            playerKey(
                player
            );


        if (
            !map.has(
                key
            )
        ) {

            map.set(
                key,
                player
            );
        }
    }


    return [
        ...map.values()
    ];
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
// CANDIDATE SCORE
// ============================================================

function candidateScore(
    tickDelta,
    originDistance,
    preDamageDifference
) {

    return (
        Math.abs(
            tickDelta
        )
        *
        1000000000
        +
        originDistance
        *
        1000000
        +
        (
            preDamageDifference
            ??
            999999
        )
    );
}


// ============================================================
// PLAYER RESOLUTION
// ============================================================

function resolvePlayerEntity(
    rawIndex
) {

    const numeric =
        toFiniteNumber(
            rawIndex
        );


    if (
        numeric ===
        null
    ) {

        return null;
    }


    if (
        playerByPawnIndex.has(
            numeric
        )
    ) {

        return playerByPawnIndex.get(
            numeric
        );
    }


    if (
        playerByControllerIndex.has(
            numeric
        )
    ) {

        return playerByControllerIndex.get(
            numeric
        );
    }


    const decoded =
        decodeEntityIndex(
            numeric
        );


    if (
        decoded !==
            null
        &&
        playerByPawnIndex.has(
            decoded
        )
    ) {

        return playerByPawnIndex.get(
            decoded
        );
    }


    if (
        decoded !==
            null
        &&
        playerByControllerIndex.has(
            decoded
        )
    ) {

        return playerByControllerIndex.get(
            decoded
        );
    }


    return null;
}


// ============================================================
// ENTITY HANDLE DECODING
// ============================================================

function decodeEntityIndex(
    value
) {

    const numeric =
        toFiniteNumber(
            value
        );


    if (
        numeric ===
        null
    ) {

        return null;
    }


    return (
        Math.trunc(
            numeric
        )
        &
        ENTITY_INDEX_MASK
    );
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
// PLAYER KEY
// ============================================================

function playerKey(
    player
) {

    if (
        player.pawnEntityIndex !==
            null
        &&
        player.pawnEntityIndex !==
            undefined
    ) {

        return (
            `pawn:${
                player.pawnEntityIndex
            }`
        );
    }


    return (
        `name:${
            player.playerName
            ??
            'UNKNOWN'
        }`
    );
}


// ============================================================
// SAME PLAYER
// ============================================================

function samePlayer(
    a,
    b
) {

    if (
        !a
        ||
        !b
    ) {

        return false;
    }


    if (
        a.pawnEntityIndex !==
            null
        &&
        a.pawnEntityIndex !==
            undefined
        &&
        b.pawnEntityIndex !==
            null
        &&
        b.pawnEntityIndex !==
            undefined
    ) {

        return (
            a.pawnEntityIndex ===
            b.pawnEntityIndex
        );
    }


    return (
        a.playerName ===
        b.playerName
    );
}


// ============================================================
// DISTANCE
// ============================================================

function distance3D(
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
        dx * dx
        +
        dy * dy
        +
        dz * dz
    );
}


function distanceXY(
    a,
    b
) {

    const dx =
        a.x -
        b.x;


    const dy =
        a.y -
        b.y;


    return Math.sqrt(
        dx * dx
        +
        dy * dy
    );
}


// ============================================================
// POSITION
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

        z:
            z
            ??
            0
    };
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
// CONTROL PRINT
// ============================================================

function printControlSummary(
    label,
    summary
) {

    console.log(
        `${
            String(
                label
            ).padEnd(
                14
            )
        } candidates=${
            String(
                summary.uniquePlayerBreaks
            ).padStart(
                3
            )
        } agree=${
            String(
                summary.agreementBreaks
            ).padStart(
                3
            )
        } conflict=${
            String(
                summary.conflictBreaks
            ).padStart(
                3
            )
        } precision=${
            formatPercent(
                summary.agreementRateAmongUnique
            )
        }`
    );
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