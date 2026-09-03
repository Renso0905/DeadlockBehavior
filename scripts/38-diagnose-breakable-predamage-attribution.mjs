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


// Capture damage messages around every break.
//
// We expect the strongest signal to be exact tick, but the
// wider window lets us empirically verify that.
const MAX_WINDOW_TICKS =
    4;


// Test these temporal windows.
const TICK_WINDOWS =
    [
        0,
        1,
        2,
        4
    ];


// Floating-point matching thresholds.
//
// Breakable debris damage and k_EUserMsg_Damage.preDamage
// frequently appear bit-identical, so the smallest thresholds
// are the most interesting.
const DAMAGE_EPSILONS =
    [
        0.000001,
        0.0001,
        0.001,
        0.01,
        0.1,
        1
    ];


// Diagnostic-only candidate.
//
// Do NOT make canonical in this script.
const DIAGNOSTIC_TICK_WINDOW =
    0;


const DIAGNOSTIC_DAMAGE_EPSILON =
    0.001;


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


const midBossDiagnosticPath =
    resolve(
        'output',
        replayName,
        'breakable_midboss_rejuv_diagnostic.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_predamage_attribution_diagnostic.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        replayPath,
        attributionPath,
        midBossDiagnosticPath
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
// LOAD INPUTS
// ============================================================

const attribution =
    JSON.parse(
        readFileSync(
            attributionPath,
            'utf8'
        )
    );


const midBossDiagnostic =
    JSON.parse(
        readFileSync(
            midBossDiagnosticPath,
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
        'Script 35 contains no attributionRows.'
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
// NORMALIZE BREAK ROWS
// ============================================================

const breaks =
    sourceRows

        .map(
            row => ({

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

                position:
                    normalizePosition(
                        row.position
                    ),

                impactPosition:
                    normalizePosition(
                        row.impactPosition
                    ),

                debrisDamage:
                    toFiniteNumber(
                        row
                            ?.debris
                            ?.damage
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
            })
        )

        .filter(
            row =>
                row.breakKey
                &&
                row.breakTick !==
                    null
                &&
                row.debrisDamage !==
                    null
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
// GROUPS
// ============================================================

const meleeBreaks =
    breaks.filter(
        row =>
            row.attributionMethod ===
            'MELEE_DIRECT'
    );


const bulletBreaks =
    breaks.filter(
        row =>
            row.attributionMethod ===
            'BULLET_RAY'
    );


const ambiguousBulletBreaks =
    breaks.filter(
        row =>
            row.attributionMethod ===
            'BULLET_RAY_MULTIPLE_PLAYERS'
    );


const noneBreaks =
    breaks.filter(
        row =>
            row.attributionMethod ===
            'NONE_V1'
    );


const unresolvedBreaks =
    breaks.filter(
        row =>
            row.attributionStatus !==
            'ATTRIBUTED'
    );


// ============================================================
// MID-BOSS-ASSOCIATED CLUSTER BREAK KEYS
// ============================================================

const sameImpactClusters =
    midBossDiagnostic.clusterCorrelations
    ??
    [];


const clusterByBreakKey =
    new Map();


for (
    const cluster
    of sameImpactClusters
) {

    for (
        const breakKey
        of cluster.resourceBreakKeys
        ??
        []
    ) {

        clusterByBreakKey.set(
            breakKey,
            cluster
        );
    }
}


// Specifically track the three repeating signatures that made
// us investigate this channel.
//
// This is diagnostic metadata only, NOT a rule.
const suspiciousSignatureValues =
    [
        71.41799926757812,
        74.11800384521484,
        74.010009765625
    ];


// ============================================================
// RELEVANT TICKS
// ============================================================

const relevantTicks =
    new Set();


for (
    const breakEvent
    of breaks
) {

    for (
        let delta =
            -MAX_WINDOW_TICKS;

        delta <=
            MAX_WINDOW_TICKS;

        delta++
    ) {

        relevantTicks.add(
            breakEvent.breakTick +
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


let damageMessagesInBreakWindows =
    0;


let playerResolvedDamageMessages =
    0;


let nonPlayerDamageMessages =
    0;


let damageMessagesWithPreDamage =
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


        damageMessagesInBreakWindows++;


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


        const preDamage =
            toFiniteNumber(
                data.preDamage
            );


        if (
            preDamage !==
            null
        ) {

            damageMessagesWithPreDamage++;
        }


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

                attackerIndex,

                player,

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

                preDamage,

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

                origin:
                    normalizePosition(
                        data.origin
                    ),

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
    '========================================'
);

console.log(
    'BREAKABLE PREDAMAGE ATTRIBUTION TEST'
);

console.log(
    '========================================'
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Total breaks: ${breaks.length}`
);

console.log(
    `Melee controls: ${meleeBreaks.length}`
);

console.log(
    `Bullet controls: ${bulletBreaks.length}`
);

console.log(
    `Ambiguous bullet: ${ambiguousBulletBreaks.length}`
);

console.log(
    `NONE_V1: ${noneBreaks.length}`
);

console.log(
    `Total unresolved: ${unresolvedBreaks.length}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// BUILD CANDIDATES
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
            MAX_WINDOW_TICKS;

        tick <=
            breakEvent.breakTick +
            MAX_WINDOW_TICKS;

        tick++
    ) {

        const messages =
            damageByTick.get(
                tick
            )
            ??
            [];


        for (
            const damageEvent
            of messages
        ) {

            if (
                !damageEvent.player
                ||
                damageEvent.preDamage ===
                    null
            ) {

                continue;
            }


            const absoluteDamageDifference =
                Math.abs(
                    damageEvent.preDamage -
                    breakEvent.debrisDamage
                );


            const tickDelta =
                damageEvent.tick -
                breakEvent.breakTick;


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

                absoluteDamageDifference,

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

                origin:
                    damageEvent.origin,

                serverTick:
                    damageEvent.serverTick,

                score:
                    candidateScore(
                        tickDelta,
                        absoluteDamageDifference
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


    const cluster =
        clusterByBreakKey.get(
            breakEvent.breakKey
        )
        ??
        null;


    breakRows.push({

        ...breakEvent,

        sameImpactCluster:
            cluster
                ? {

                    clusterKey:
                        cluster.clusterKey,

                    breakCount:
                        cluster.breakCount,

                    debrisDamageValues:
                        cluster.debrisDamageValues,

                    nearestMidBossKillDeltaSeconds:
                        cluster
                            ?.nearestMidBossKillCandidate
                            ?.deltaSeconds
                        ??
                        null
                }

                : null,

        suspiciousSignature:
            suspiciousSignatureValues.some(
                value =>
                    Math.abs(
                        value -
                        breakEvent.debrisDamage
                    )
                    <
                    0.000001
            ),

        candidateCount:
            candidates.length,

        bestCandidate:
            candidates[0]
            ??
            null,

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
        const epsilon
        of DAMAGE_EPSILONS
    ) {

        thresholdMatrix.push({

            tickWindow,

            tickWindowSeconds:
                tickWindow /
                TICK_RATE,

            damageEpsilon:
                epsilon,

            noneV1:
                summarizeThreshold(
                    breakRows.filter(
                        row =>
                            row.attributionMethod ===
                            'NONE_V1'
                    ),
                    tickWindow,
                    epsilon
                ),

            allUnresolved:
                summarizeThreshold(
                    breakRows.filter(
                        row =>
                            row.attributionStatus !==
                            'ATTRIBUTED'
                    ),
                    tickWindow,
                    epsilon
                ),

            meleeControl:
                summarizeControlThreshold(
                    breakRows.filter(
                        row =>
                            row.attributionMethod ===
                            'MELEE_DIRECT'
                    ),
                    tickWindow,
                    epsilon
                ),

            bulletControl:
                summarizeControlThreshold(
                    breakRows.filter(
                        row =>
                            row.attributionMethod ===
                            'BULLET_RAY'
                    ),
                    tickWindow,
                    epsilon
                )
        });
    }
}


// ============================================================
// STRICT DIAGNOSTIC MATCHES
// ============================================================

const strictDiagnosticMatches =
    [];


for (
    const row
    of breakRows
) {

    if (
        row.attributionStatus ===
        'ATTRIBUTED'
    ) {

        continue;
    }


    const candidates =
        thresholdCandidates(
            row,
            DIAGNOSTIC_TICK_WINDOW,
            DIAGNOSTIC_DAMAGE_EPSILON
        );


    if (
        candidates.length ===
        0
    ) {

        continue;
    }


    const players =
        uniquePlayers(
            candidates
        );


    const abilities =
        uniqueAbilities(
            candidates
        );


    strictDiagnosticMatches.push({

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

        debrisDamage:
            row.debrisDamage,

        rewardOutcome:
            row.rewardOutcome,

        previousAttributionMethod:
            row.attributionMethod,

        suspiciousSignature:
            row.suspiciousSignature,

        sameImpactCluster:
            row.sameImpactCluster,

        candidateCount:
            candidates.length,

        uniquePlayerCount:
            players.length,

        uniquePlayers:
            players,

        uniqueAbilityCount:
            abilities.length,

        uniqueAbilities:
            abilities,

        bestCandidate:
            candidates[0],

        candidates
    });
}


// ============================================================
// STRICT UNIQUE-PLAYER MATCHES
// ============================================================

const strictUniquePlayerMatches =
    strictDiagnosticMatches.filter(
        row =>
            row.uniquePlayerCount ===
            1
    );


const strictAmbiguousPlayerMatches =
    strictDiagnosticMatches.filter(
        row =>
            row.uniquePlayerCount >
            1
    );


// ============================================================
// CONTROL VALIDATION AT STRICT THRESHOLD
// ============================================================

const strictMeleeControl =
    evaluateControls(
        breakRows.filter(
            row =>
                row.attributionMethod ===
                'MELEE_DIRECT'
        ),
        DIAGNOSTIC_TICK_WINDOW,
        DIAGNOSTIC_DAMAGE_EPSILON
    );


const strictBulletControl =
    evaluateControls(
        breakRows.filter(
            row =>
                row.attributionMethod ===
                'BULLET_RAY'
        ),
        DIAGNOSTIC_TICK_WINDOW,
        DIAGNOSTIC_DAMAGE_EPSILON
    );


// ============================================================
// PLAYER COUNTS
// ============================================================

const strictPlayerCounts =
    countBy(
        strictUniquePlayerMatches,
        row =>
            row
                ?.uniquePlayers
                ?.[0]
                ?.playerName
            ??
            'UNKNOWN'
    );


// ============================================================
// ABILITY COUNTS
// ============================================================

const strictAbilityCounts =
    countBy(
        strictUniquePlayerMatches,
        row => {

            const abilities =
                row.uniqueAbilities
                ??
                [];


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
// SIGNATURE-SPECIFIC SUMMARY
// ============================================================

const suspiciousSignatureRows =
    strictUniquePlayerMatches.filter(
        row =>
            row.suspiciousSignature
    );


const suspiciousSignatureSummary =
    {};


for (
    const value
    of suspiciousSignatureValues
) {

    const rows =
        suspiciousSignatureRows.filter(
            row =>
                Math.abs(
                    row.debrisDamage -
                    value
                )
                <
                0.000001
        );


    suspiciousSignatureSummary[
        String(
            value
        )
    ] =
        {

            breakCount:
                rows.length,

            players:
                countBy(
                    rows,
                    row =>
                        row
                            .uniquePlayers
                            ?.[0]
                            ?.playerName
                        ??
                        'UNKNOWN'
                ),

            abilities:
                countBy(
                    rows,
                    row => {

                        const ability =
                            row
                                .uniqueAbilities
                                ?.[0];


                        return (
                            `${
                                ability
                                    ?.abilityId
                                ??
                                'NULL'
                            }|entity:${
                                ability
                                    ?.abilityEntityIndex
                                ??
                                'NULL'
                            }`
                        );
                    }
                ),

            clocks:
                [
                    ...new Set(
                        rows.map(
                            row =>
                                row.breakClock
                        )
                    )
                ],

            clusterBreaks:
                rows.filter(
                    row =>
                        row.sameImpactCluster
                ).length
        };
}


// ============================================================
// CLUSTER RECOVERY
// ============================================================

let unresolvedClusterBreaks =
    0;


let strictRecoveredClusterBreaks =
    0;


let suspiciousClusterBreaks =
    0;


let suspiciousRecoveredClusterBreaks =
    0;


for (
    const row
    of breakRows
) {

    if (
        row.attributionStatus ===
        'ATTRIBUTED'
        ||
        !row.sameImpactCluster
    ) {

        continue;
    }


    unresolvedClusterBreaks++;


    if (
        row.suspiciousSignature
    ) {

        suspiciousClusterBreaks++;
    }


    const strictCandidates =
        thresholdCandidates(
            row,
            DIAGNOSTIC_TICK_WINDOW,
            DIAGNOSTIC_DAMAGE_EPSILON
        );


    const players =
        uniquePlayers(
            strictCandidates
        );


    if (
        players.length ===
        1
    ) {

        strictRecoveredClusterBreaks++;


        if (
            row.suspiciousSignature
        ) {

            suspiciousRecoveredClusterBreaks++;
        }
    }
}


// ============================================================
// STRICT METHOD COUNTS
// ============================================================

const strictPreviousMethodCounts =
    countBy(
        strictUniquePlayerMatches,
        row =>
            row.previousAttributionMethod
            ??
            'NULL'
    );


// ============================================================
// REVISED POTENTIAL COVERAGE
//
// This is hypothetical.
//
// We are NOT modifying Script 35 yet.
// ============================================================

const existingAttributed =
    breaks.filter(
        row =>
            row.attributionStatus ===
            'ATTRIBUTED'
    ).length;


const newlyStrictUnique =
    strictUniquePlayerMatches.filter(
        row =>
            row.attributionStatus !==
            'ATTRIBUTED'
    ).length;


const hypotheticalAttributed =
    existingAttributed +
    newlyStrictUnique;


const hypotheticalCoverage =
    rate(
        hypotheticalAttributed,
        breaks.length
    );


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BREAKABLE_PREDAMAGE_ATTRIBUTION_DIAGNOSTIC',

        method:
            [

                'Load Script 35 canonical action attribution.',

                'Capture player-resolved k_EUserMsg_Damage messages within ±4 demo ticks of every resource break.',

                'Compare breakable debris damage against k_EUserMsg_Damage.preDamage rather than final damage, because armor/shields/mitigation alter final damage but debris preserves the pre-mitigation magnitude.',

                'Evaluate exact and near-exact damage-magnitude matches across several tick windows and floating-point tolerances.',

                'Use already-attributed melee and bullet breaks as controls to measure agreement and false-player conflict.',

                'Do not make preDamage attribution canonical in this script.'
            ],

        sourceCounts:
            {

                totalBreaks:
                    breaks.length,

                existingAttributed,

                meleeBreaks:
                    meleeBreaks.length,

                bulletBreaks:
                    bulletBreaks.length,

                ambiguousBulletBreaks:
                    ambiguousBulletBreaks.length,

                noneV1:
                    noneBreaks.length,

                unresolved:
                    unresolvedBreaks.length,

                knownPlayers:
                    playerByPawnIndex.size
            },

        messageCounts:
            {

                totalDamageMessages,

                damageMessagesInBreakWindows,

                playerResolvedDamageMessages,

                nonPlayerDamageMessages,

                damageMessagesWithPreDamage
            },

        thresholdMatrix,

        strictDiagnostic:
            {

                canonical:
                    false,

                criterion:
                    {

                        maxAbsoluteTickDelta:
                            DIAGNOSTIC_TICK_WINDOW,

                        maxAbsoluteTimeDeltaSeconds:
                            DIAGNOSTIC_TICK_WINDOW /
                            TICK_RATE,

                        maxAbsolutePreDamageDifference:
                            DIAGNOSTIC_DAMAGE_EPSILON,

                        uniquePlayerRequired:
                            true
                    },

                anyMatchBreaks:
                    strictDiagnosticMatches.length,

                uniquePlayerMatches:
                    strictUniquePlayerMatches.length,

                ambiguousPlayerMatches:
                    strictAmbiguousPlayerMatches.length,

                previousMethodCounts:
                    strictPreviousMethodCounts,

                playerCounts:
                    strictPlayerCounts,

                abilityCounts:
                    strictAbilityCounts,

                meleeControl:
                    strictMeleeControl,

                bulletControl:
                    strictBulletControl,

                matches:
                    strictDiagnosticMatches
            },

        suspiciousMidBossSignatures:
            {

                diagnosticOnly:
                    true,

                values:
                    suspiciousSignatureValues,

                summary:
                    suspiciousSignatureSummary,

                unresolvedSameImpactClusterBreaks:
                    unresolvedClusterBreaks,

                strictRecoveredSameImpactClusterBreaks:
                    strictRecoveredClusterBreaks,

                suspiciousClusterBreaks,

                suspiciousRecoveredClusterBreaks
            },

        hypotheticalCoverage:
            {

                existingAttributed,

                newlyStrictUnique,

                hypotheticalAttributed,

                totalBreaks:
                    breaks.length,

                coverage:
                    hypotheticalCoverage
            },

        breakRows
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
// CONSOLE
// ============================================================

console.log(
    'MESSAGE STREAM'
);

console.log(
    '--------------'
);

console.log(
    `k_EUserMsg_Damage total: ${totalDamageMessages}`
);

console.log(
    `Inside break windows: ${damageMessagesInBreakWindows}`
);

console.log(
    `Resolved player attackers: ${playerResolvedDamageMessages}`
);

console.log(
    `With preDamage: ${damageMessagesWithPreDamage}`
);

console.log('');


console.log(
    'EXACT-TICK PREDAMAGE THRESHOLDS'
);

console.log(
    '-------------------------------'
);

console.log('');


for (
    const epsilon
    of DAMAGE_EPSILONS
) {

    const row =
        thresholdMatrix.find(
            item =>
                item.tickWindow ===
                    0
                &&
                item.damageEpsilon ===
                    epsilon
        );


    if (
        !row
    ) {

        continue;
    }


    console.log(
        `epsilon <= ${
            String(
                epsilon
            ).padStart(
                8
            )
        }  unresolved=${
            String(
                row
                    .allUnresolved
                    .breaksWithCandidate
            ).padStart(
                4
            )
        }  unique=${
            String(
                row
                    .allUnresolved
                    .uniquePlayerBreaks
            ).padStart(
                4
            )
        }  ambiguous=${
            String(
                row
                    .allUnresolved
                    .multiplePlayerBreaks
            ).padStart(
                3
            )
        }  meleeAgree=${
            String(
                row
                    .meleeControl
                    .agreementBreaks
            ).padStart(
                3
            )
        }  meleeConflict=${
            String(
                row
                    .meleeControl
                    .conflictBreaks
            ).padStart(
                3
            )
        }  bulletAgree=${
            String(
                row
                    .bulletControl
                    .agreementBreaks
            ).padStart(
                3
            )
        }  bulletConflict=${
            String(
                row
                    .bulletControl
                    .conflictBreaks
            ).padStart(
                3
            )
        }`
    );
}


console.log('');


console.log(
    'STRICT DIAGNOSTIC'
);

console.log(
    '-----------------'
);

console.log(
    `Criterion: exact tick + |preDamage - debrisDamage| <= ${DIAGNOSTIC_DAMAGE_EPSILON}`
);

console.log(
    `Any unresolved match: ${strictDiagnosticMatches.length}`
);

console.log(
    `Unique-player matches: ${strictUniquePlayerMatches.length}`
);

console.log(
    `Ambiguous-player matches: ${strictAmbiguousPlayerMatches.length}`
);

console.log('');


console.log(
    'CONTROL VALIDATION'
);

console.log(
    '------------------'
);

console.log(
    `Melee controls with candidate: ${strictMeleeControl.breaksWithCandidate}/${strictMeleeControl.totalBreaks}`
);

console.log(
    `  agreement: ${strictMeleeControl.agreementBreaks}`
);

console.log(
    `  conflict:  ${strictMeleeControl.conflictBreaks}`
);

console.log(
    `  ambiguous: ${strictMeleeControl.multiplePlayerBreaks}`
);

console.log('');

console.log(
    `Bullet controls with candidate: ${strictBulletControl.breaksWithCandidate}/${strictBulletControl.totalBreaks}`
);

console.log(
    `  agreement: ${strictBulletControl.agreementBreaks}`
);

console.log(
    `  conflict:  ${strictBulletControl.conflictBreaks}`
);

console.log(
    `  ambiguous: ${strictBulletControl.multiplePlayerBreaks}`
);

console.log('');


console.log(
    'TOP STRICT PLAYERS'
);

console.log(
    '------------------'
);


for (
    const [
        player,
        count
    ]
    of Object.entries(
        strictPlayerCounts
    )
    .slice(
        0,
        15
    )
) {

    console.log(
        `${
            String(
                player
            ).padEnd(
                28
            )
        } ${count}`
    );
}


console.log('');


console.log(
    'TOP STRICT ABILITIES'
);

console.log(
    '--------------------'
);


for (
    const [
        ability,
        count
    ]
    of Object.entries(
        strictAbilityCounts
    )
    .slice(
        0,
        15
    )
) {

    console.log(
        `${
            String(
                ability
            ).padEnd(
                32
            )
        } ${count}`
    );
}


console.log('');


console.log(
    'MID-BOSS SIGNATURE RECOVERY'
);

console.log(
    '---------------------------'
);


for (
    const [
        damage,
        summary
    ]
    of Object.entries(
        suspiciousSignatureSummary
    )
) {

    console.log(
        `damage=${
            String(
                damage
            ).padEnd(
                20
            )
        } breaks=${
            String(
                summary.breakCount
            ).padStart(
                3
            )
        } clusterBreaks=${
            String(
                summary.clusterBreaks
            ).padStart(
                3
            )
        } players=${
            JSON.stringify(
                summary.players
            )
        } abilities=${
            JSON.stringify(
                summary.abilities
            )
        }`
    );
}


console.log('');


console.log(
    'HYPOTHETICAL COVERAGE'
);

console.log(
    '---------------------'
);

console.log(
    `Existing attributed: ${existingAttributed}/${breaks.length}`
);

console.log(
    `New strict unique-player: ${newlyStrictUnique}`
);

console.log(
    `Potential attributed: ${hypotheticalAttributed}/${breaks.length} = ${formatPercent(hypotheticalCoverage)}`
);

console.log('');


console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// THRESHOLD SUMMARY
// ============================================================

function summarizeThreshold(
    rows,
    tickWindow,
    epsilon
) {

    let breaksWithCandidate =
        0;


    let singleCandidateBreaks =
        0;


    let multipleCandidateBreaks =
        0;


    let uniquePlayerBreaks =
        0;


    let multiplePlayerBreaks =
        0;


    let exactTickBreaks =
        0;


    for (
        const row
        of rows
    ) {

        const candidates =
            thresholdCandidates(
                row,
                tickWindow,
                epsilon
            );


        if (
            candidates.length ===
            0
        ) {

            continue;
        }


        breaksWithCandidate++;


        if (
            candidates.length ===
            1
        ) {

            singleCandidateBreaks++;

        } else {

            multipleCandidateBreaks++;
        }


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


        if (
            candidates.some(
                candidate =>
                    candidate.tickDelta ===
                    0
            )
        ) {

            exactTickBreaks++;
        }
    }


    return {

        totalBreaks:
            rows.length,

        breaksWithCandidate,

        matchRate:
            rate(
                breaksWithCandidate,
                rows.length
            ),

        singleCandidateBreaks,

        multipleCandidateBreaks,

        uniquePlayerBreaks,

        multiplePlayerBreaks,

        exactTickBreaks
    };
}


// ============================================================
// CONTROL THRESHOLD SUMMARY
// ============================================================

function summarizeControlThreshold(
    rows,
    tickWindow,
    epsilon
) {

    return evaluateControls(
        rows,
        tickWindow,
        epsilon
    );
}


// ============================================================
// CONTROL EVALUATION
// ============================================================

function evaluateControls(
    rows,
    tickWindow,
    epsilon
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


    let noExistingPlayer =
        0;


    for (
        const row
        of rows
    ) {

        const candidates =
            thresholdCandidates(
                row,
                tickWindow,
                epsilon
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
                !row.existingPlayer
            ) {

                noExistingPlayer++;


            } else if (
                samePlayer(
                    players[0],
                    row.existingPlayer
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
            rows.length,

        breaksWithCandidate,

        matchRate:
            rate(
                breaksWithCandidate,
                rows.length
            ),

        uniquePlayerBreaks,

        multiplePlayerBreaks,

        agreementBreaks,

        conflictBreaks,

        noExistingPlayer,

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
// THRESHOLD CANDIDATES
// ============================================================

function thresholdCandidates(
    row,
    tickWindow,
    epsilon
) {

    return (
        row.candidates
        ??
        []
    )

        .filter(
            candidate =>
                Math.abs(
                    candidate.tickDelta
                )
                <=
                tickWindow
                &&
                candidate.absoluteDamageDifference <=
                    epsilon
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

        const key =
            `${
                candidate.abilityId
                ??
                'NULL'
            }|${
                candidate.abilityEntityIndex
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

                    abilityId:
                        candidate.abilityId,

                    abilityEntityIndex:
                        candidate.abilityEntityIndex
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
    damageDifference
) {

    return (
        Math.abs(
            tickDelta
        )
        *
        1000000
        +
        damageDifference
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
// DECODE ENTITY INDEX
// ============================================================

function decodeEntityIndex(
    value
) {

    const number =
        toFiniteNumber(
            value
        );


    if (
        number ===
        null
    ) {

        return null;
    }


    return (
        Math.trunc(
            number
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