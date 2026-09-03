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


// Search damage messages around every break.
const MAX_WINDOW_TICKS =
    4;


// Store candidate damage origins out to this distance.
// Threshold analysis below is much tighter.
const MAX_STORED_ORIGIN_DISTANCE =
    512;


// Empirically test these timing windows.
const TICK_WINDOWS =
    [
        0,
        1,
        2,
        4
    ];


// Empirically test these spatial thresholds.
//
// We do NOT choose a canonical threshold yet.
const ORIGIN_DISTANCE_THRESHOLDS =
    [
        0.25,
        0.5,
        1,
        2,
        4,
        8,
        16,
        32,
        64,
        96,
        128
    ];


// Diagnostic-only subset.
//
// NOT CANONICAL.
//
// This just gives us concrete rows to inspect after the run.
const DIAGNOSTIC_TICK_WINDOW =
    4;


const DIAGNOSTIC_ORIGIN_DISTANCE =
    4;


// Search ImportantAbilityUsed slightly farther around a
// damage-origin candidate so we can attach a human-readable
// ability name when that message happens to exist.
const IMPORTANT_ABILITY_WINDOW_TICKS =
    8;


const MAX_CANDIDATES_PER_BREAK =
    12;


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
        'breakable_damage_origin_diagnostic.json'
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
// LOAD SCRIPT 35
// ============================================================

const source =
    JSON.parse(
        readFileSync(
            attributionPath,
            'utf8'
        )
    );


const sourceRows =
    Array.isArray(
        source.attributionRows
    )
        ? source.attributionRows
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
        source
            ?.canonical
            ?.matchClockOffsetSeconds
    )
    ??
    30;


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
                    )
                    ??
                    normalizePosition(
                        row.position
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


const unattributedBreaks =
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
// PLAYER IDENTITY
//
// Script 35 already has canonical pawn/controller IDs.
// ============================================================

const playerByPawnIndex =
    new Map();


const playerByControllerIndex =
    new Map();


for (
    const player
    of source.playerSummaries
    ??
    []
) {

    const identity =
        {

            playerName:
                player.playerName
                ??
                null,

            heroId:
                toFiniteNumber(
                    player.heroId
                ),

            team:
                toFiniteNumber(
                    player.team
                ),

            pawnEntityIndex:
                toFiniteNumber(
                    player.pawnEntityIndex
                ),

            controllerEntityIndex:
                toFiniteNumber(
                    player.controllerEntityIndex
                )
        };


    if (
        identity.pawnEntityIndex !==
        null
    ) {

        playerByPawnIndex.set(
            identity.pawnEntityIndex,
            identity
        );
    }


    if (
        identity.controllerEntityIndex !==
        null
    ) {

        playerByControllerIndex.set(
            identity.controllerEntityIndex,
            identity
        );
    }
}


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


// ImportantAbilityUsed can be slightly farther away.
const importantAbilityTicks =
    new Set();


for (
    const breakEvent
    of breaks
) {

    for (
        let delta =
            -IMPORTANT_ABILITY_WINDOW_TICKS;

        delta <=
            IMPORTANT_ABILITY_WINDOW_TICKS;

        delta++
    ) {

        importantAbilityTicks.add(
            breakEvent.breakTick +
            delta
        );
    }
}


// ============================================================
// CAPTURED EVENTS
// ============================================================

const damageByTick =
    new Map();


const importantAbilityByTick =
    new Map();


let totalDamageMessages =
    0;


let damageMessagesInBreakWindows =
    0;


let playerResolvedDamageMessages =
    0;


let unresolvedAttackerDamageMessages =
    0;


let totalImportantAbilityMessages =
    0;


let importantAbilityMessagesInWindows =
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


        // ====================================================
        // PLAYER / NPC DAMAGE MESSAGE
        // ====================================================

        if (
            typeCode ===
            'k_EUserMsg_Damage'
        ) {

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

                unresolvedAttackerDamageMessages++;
            }


            const event =
                {

                    tick,

                    matchTimeSeconds:
                        tickToMatchTime(
                            tick
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

                    preDamage:
                        toFiniteNumber(
                            data.preDamage
                        ),

                    healthLost:
                        toFiniteNumber(
                            data.healthLost
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


            return;
        }


        // ====================================================
        // IMPORTANT ABILITY USED
        // ====================================================

        if (
            typeCode ===
            'k_EUserMsg_ImportantAbilityUsed'
        ) {

            totalImportantAbilityMessages++;


            if (
                !importantAbilityTicks.has(
                    tick
                )
            ) {

                return;
            }


            importantAbilityMessagesInWindows++;


            const data =
                messagePacket.data
                ??
                {};


            const rawCaster =
                toFiniteNumber(
                    data.caster
                );


            const rawPlayer =
                toFiniteNumber(
                    data.player
                );


            const casterDecoded =
                decodeEntityIndex(
                    rawCaster
                );


            const playerDecoded =
                decodeEntityIndex(
                    rawPlayer
                );


            const resolvedPlayer =
                resolvePlayerEntity(
                    rawCaster
                )
                ??
                resolvePlayerEntity(
                    casterDecoded
                )
                ??
                resolvePlayerEntity(
                    rawPlayer
                )
                ??
                resolvePlayerEntity(
                    playerDecoded
                );


            const event =
                {

                    tick,

                    matchTimeSeconds:
                        tickToMatchTime(
                            tick
                        ),

                    rawCaster,

                    rawPlayer,

                    casterDecodedEntityIndex:
                        casterDecoded,

                    playerDecodedEntityIndex:
                        playerDecoded,

                    player:
                        resolvedPlayer,

                    abilityName:
                        data.abilityName
                        ??
                        null
                };


            if (
                !importantAbilityByTick.has(
                    tick
                )
            ) {

                importantAbilityByTick.set(
                    tick,
                    []
                );
            }


            importantAbilityByTick
                .get(
                    tick
                )
                .push(
                    event
                );
        }
    }
);


// ============================================================
// RUN
// ============================================================

console.log('');

console.log(
    '===================================='
);

console.log(
    'BREAKABLE DAMAGE-ORIGIN DIAGNOSTIC'
);

console.log(
    '===================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Total breaks: ${breaks.length}`
);

console.log(
    `Melee: ${meleeBreaks.length}`
);

console.log(
    `Bullet: ${bulletBreaks.length}`
);

console.log(
    `Ambiguous bullet: ${ambiguousBulletBreaks.length}`
);

console.log(
    `Unattributed: ${unattributedBreaks.length}`
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
// BUILD DAMAGE-ORIGIN CANDIDATES
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
                !damageEvent.origin
            ) {

                continue;
            }


            const originDistance =
                distance3D(
                    breakEvent.impactPosition,
                    damageEvent.origin
                );


            if (
                originDistance ===
                    null
                ||
                originDistance >
                    MAX_STORED_ORIGIN_DISTANCE
            ) {

                continue;
            }


            const tickDelta =
                damageEvent.tick -
                breakEvent.breakTick;


            const nearbyImportantAbilities =
                findNearbyImportantAbilities(
                    breakEvent.breakTick,
                    damageEvent.player
                );


            candidates.push({

                damageTick:
                    damageEvent.tick,

                damageMatchTimeSeconds:
                    damageEvent.matchTimeSeconds,

                tickDelta,

                timeDeltaSeconds:
                    tickDelta /
                    TICK_RATE,

                originDistance,

                damageOrigin:
                    damageEvent.origin,

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

                healthLost:
                    damageEvent.healthLost,

                citadelType:
                    damageEvent.citadelType,

                damageType:
                    damageEvent.damageType,

                attackerClass:
                    damageEvent.attackerClass,

                victimClass:
                    damageEvent.victimClass,

                serverTick:
                    damageEvent.serverTick,

                nearbyImportantAbilities,

                score:
                    candidateScore(
                        tickDelta,
                        originDistance
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

        bestCandidate:
            candidates[0]
            ??
            null,

        candidates:
            candidates.slice(
                0,
                MAX_CANDIDATES_PER_BREAK
            )
    });
}


// ============================================================
// GROUP ROWS
// ============================================================

const rowsByMethod =
    new Map();


for (
    const row
    of breakRows
) {

    if (
        !rowsByMethod.has(
            row.attributionMethod
        )
    ) {

        rowsByMethod.set(
            row.attributionMethod,
            []
        );
    }


    rowsByMethod
        .get(
            row.attributionMethod
        )
        .push(
            row
        );
}


const unresolvedRows =
    breakRows.filter(
        row =>
            row.attributionStatus !==
            'ATTRIBUTED'
    );


const noneRows =
    breakRows.filter(
        row =>
            row.attributionMethod ===
            'NONE_V1'
    );


const meleeRows =
    breakRows.filter(
        row =>
            row.attributionMethod ===
            'MELEE_DIRECT'
    );


const bulletRows =
    breakRows.filter(
        row =>
            row.attributionMethod ===
            'BULLET_RAY'
    );


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
        const distanceThreshold
        of ORIGIN_DISTANCE_THRESHOLDS
    ) {

        thresholdMatrix.push({

            tickWindow,

            tickWindowSeconds:
                tickWindow /
                TICK_RATE,

            distanceThreshold,

            unattributed:
                summarizeThreshold(
                    noneRows,
                    tickWindow,
                    distanceThreshold
                ),

            allUnresolved:
                summarizeThreshold(
                    unresolvedRows,
                    tickWindow,
                    distanceThreshold
                ),

            meleeControl:
                summarizeThreshold(
                    meleeRows,
                    tickWindow,
                    distanceThreshold
                ),

            bulletControl:
                summarizeThreshold(
                    bulletRows,
                    tickWindow,
                    distanceThreshold
                )
        });
    }
}


// ============================================================
// DIAGNOSTIC MATCHES
//
// Again:
//
//     ±4 ticks / <=4 units
//
// is diagnostic only.
//
// We are not making it canonical until we see the control
// contamination curve.
// ============================================================

const diagnosticMatches =
    [];


for (
    const row
    of unresolvedRows
) {

    const candidates =
        thresholdCandidates(
            row,
            DIAGNOSTIC_TICK_WINDOW,
            DIAGNOSTIC_ORIGIN_DISTANCE
        );


    if (
        candidates.length ===
        0
    ) {

        continue;
    }


    const uniquePlayers =
        getUniquePlayers(
            candidates
        );


    diagnosticMatches.push({

        breakKey:
            row.breakKey,

        breakTick:
            row.breakTick,

        breakClock:
            row.breakClock,

        resourceType:
            row.resourceType,

        entityIndex:
            row.entityIndex,

        impactPosition:
            row.impactPosition,

        debrisDamage:
            row.debrisDamage,

        previousAttributionMethod:
            row.attributionMethod,

        candidateCount:
            candidates.length,

        uniquePlayerCount:
            uniquePlayers.length,

        uniquePlayers,

        bestCandidate:
            candidates[0],

        candidates:
            candidates.slice(
                0,
                8
            )
    });
}


// ============================================================
// DIAGNOSTIC ABILITY IDS
// ============================================================

const diagnosticAbilityIdCounts =
    countBy(
        diagnosticMatches,
        row =>
            row
                ?.bestCandidate
                ?.abilityId
            ??
            'NULL'
    );


const diagnosticAbilityNameCounts =
    {};


for (
    const row
    of diagnosticMatches
) {

    const names =
        row
            ?.bestCandidate
            ?.nearbyImportantAbilities
        ??
        [];


    for (
        const ability
        of names
    ) {

        const name =
            ability.abilityName
            ??
            'UNKNOWN';


        diagnosticAbilityNameCounts[
            name
        ] =
            (
                diagnosticAbilityNameCounts[
                    name
                ]
                ??
                0
            )
            +
            1;
    }
}


// ============================================================
// UNRESOLVED SAME-TICK CLUSTERS
// ============================================================

const unresolvedByTick =
    new Map();


for (
    const row
    of unresolvedRows
) {

    if (
        !unresolvedByTick.has(
            row.breakTick
        )
    ) {

        unresolvedByTick.set(
            row.breakTick,
            []
        );
    }


    unresolvedByTick
        .get(
            row.breakTick
        )
        .push(
            row
        );
}


const sameTickClusterDistribution =
    countBy(
        [...unresolvedByTick.values()],
        rows =>
            rows.length
    );


const clusteredUnresolvedBreaks =
    [...unresolvedByTick.values()]

        .filter(
            rows =>
                rows.length >
                1
        )

        .reduce(
            (
                total,
                rows
            ) =>
                total +
                rows.length,
            0
        );


// ============================================================
// SAME TICK + SAME IMPACT POSITION
//
// AoE destruction often sends several breakable debris
// messages with exactly the same impact point.
//
// Quantize at 0.25 world units merely to avoid insignificant
// floating point differences.
// ============================================================

const impactClusterMap =
    new Map();


for (
    const row
    of unresolvedRows
) {

    const key =
        [
            row.breakTick,
            quantize(
                row.impactPosition.x,
                0.25
            ),
            quantize(
                row.impactPosition.y,
                0.25
            ),
            quantize(
                row.impactPosition.z,
                0.25
            )
        ].join(
            '|'
        );


    if (
        !impactClusterMap.has(
            key
        )
    ) {

        impactClusterMap.set(
            key,
            []
        );
    }


    impactClusterMap
        .get(
            key
        )
        .push(
            row
        );
}


const sameImpactClusters =
    [...impactClusterMap.entries()]

        .filter(
            ([
                ,
                rows
            ]) =>
                rows.length >
                1
        )

        .map(
            ([
                key,
                rows
            ]) => ({

                key,

                tick:
                    rows[0].breakTick,

                clock:
                    rows[0].breakClock,

                impactPosition:
                    rows[0].impactPosition,

                breakCount:
                    rows.length,

                debrisDamageValues:
                    [
                        ...new Set(
                            rows.map(
                                row =>
                                    row.debrisDamage
                            )
                        )
                    ],

                resources:
                    rows.map(
                        row => ({

                            breakKey:
                                row.breakKey,

                            entityIndex:
                                row.entityIndex,

                            resourceType:
                                row.resourceType,

                            position:
                                row.position
                        })
                    )
            })
        )

        .sort(
            (
                a,
                b
            ) =>
                b.breakCount -
                a.breakCount
        );


const breaksInsideSameImpactClusters =
    sameImpactClusters.reduce(
        (
            total,
            cluster
        ) =>
            total +
            cluster.breakCount,
        0
    );


// ============================================================
// DAMAGE SIGNATURES
// ============================================================

const unresolvedDamageSignatures =
    countBy(
        unresolvedRows,
        row =>
            row.debrisDamage ===
                null

                ? 'NULL'

                : roundNumber(
                    row.debrisDamage,
                    3
                )
    );


// ============================================================
// BEST-CANDIDATE DISTANCE DISTRIBUTIONS
// ============================================================

const unresolvedBestDistances =
    unresolvedRows

        .map(
            row =>
                row
                    ?.bestCandidate
                    ?.originDistance
        )

        .filter(
            Number.isFinite
        );


const meleeBestDistances =
    meleeRows

        .map(
            row =>
                row
                    ?.bestCandidate
                    ?.originDistance
        )

        .filter(
            Number.isFinite
        );


const bulletBestDistances =
    bulletRows

        .map(
            row =>
                row
                    ?.bestCandidate
                    ?.originDistance
        )

        .filter(
            Number.isFinite
        );


// ============================================================
// DIAGNOSTIC PLAYER COUNTS
// ============================================================

const diagnosticPlayerCounts =
    countBy(
        diagnosticMatches,
        row =>
            row
                ?.bestCandidate
                ?.player
                ?.playerName
            ??
            'UNKNOWN'
    );


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BREAKABLE_DAMAGE_ORIGIN_DIAGNOSTIC',

        method:
            [

                'Load Script 35 canonical breakable action attribution.',

                'Capture k_EUserMsg_Damage messages within ±4 demo ticks of every break.',

                'Do not require the damage-message victim to be the breakable, because breakables are not emitted as k_EUserMsg_Damage victims in this replay.',

                'Resolve entindexAttacker directly to known player pawn/controller identity.',

                'Compare k_EUserMsg_Damage.origin against the breakable debris impact position.',

                'Evaluate several timing and origin-distance thresholds against unresolved breaks and against known melee/bullet controls.',

                'Capture nearby k_EUserMsg_ImportantAbilityUsed messages only as supplementary human-readable ability evidence.',

                'Do not make damage-origin attribution canonical in this script.'
            ],

        sourceCounts:
            {

                totalBreaks:
                    breaks.length,

                meleeBreaks:
                    meleeBreaks.length,

                bulletBreaks:
                    bulletBreaks.length,

                ambiguousBulletBreaks:
                    ambiguousBulletBreaks.length,

                unattributedBreaks:
                    unattributedBreaks.length,

                unresolvedBreaks:
                    unresolvedBreaks.length,

                knownPlayerPawns:
                    playerByPawnIndex.size,

                knownPlayerControllers:
                    playerByControllerIndex.size
            },

        messageCounts:
            {

                totalDamageMessages,

                damageMessagesInBreakWindows,

                playerResolvedDamageMessages,

                unresolvedAttackerDamageMessages,

                totalImportantAbilityMessages,

                importantAbilityMessagesInWindows
            },

        unresolvedStructure:
            {

                uniqueUnresolvedBreakTicks:
                    unresolvedByTick.size,

                clusteredUnresolvedBreaks,

                singleTickUnresolvedBreaks:
                    unresolvedRows.length -
                    clusteredUnresolvedBreaks,

                sameTickClusterSizeDistribution:
                    sameTickClusterDistribution,

                sameImpactClusterCount:
                    sameImpactClusters.length,

                breaksInsideSameImpactClusters,

                sameImpactClusters
            },

        debrisDamageSignatures:
            unresolvedDamageSignatures,

        bestOriginDistance:
            {

                unresolved:
                    summarizeNumbers(
                        unresolvedBestDistances
                    ),

                meleeControl:
                    summarizeNumbers(
                        meleeBestDistances
                    ),

                bulletControl:
                    summarizeNumbers(
                        bulletBestDistances
                    )
            },

        thresholdMatrix,

        diagnosticOnly:
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

                        maxOriginDistance:
                            DIAGNOSTIC_ORIGIN_DISTANCE
                    },

                matchedUnresolvedBreaks:
                    diagnosticMatches.length,

                rateAmongUnresolved:
                    rate(
                        diagnosticMatches.length,
                        unresolvedRows.length
                    ),

                playerCounts:
                    diagnosticPlayerCounts,

                abilityIdCounts:
                    diagnosticAbilityIdCounts,

                importantAbilityNameCounts:
                    sortObjectDescending(
                        diagnosticAbilityNameCounts
                    ),

                matches:
                    diagnosticMatches
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
    `Resolved to player attacker: ${playerResolvedDamageMessages}`
);

console.log(
    `Non-player/unresolved attacker: ${unresolvedAttackerDamageMessages}`
);

console.log('');


console.log(
    'UNRESOLVED STRUCTURE'
);

console.log(
    '--------------------'
);

console.log(
    `Unresolved breaks: ${unresolvedRows.length}`
);

console.log(
    `Unique unresolved ticks: ${unresolvedByTick.size}`
);

console.log(
    `Breaks on multi-break ticks: ${clusteredUnresolvedBreaks}`
);

console.log(
    `Same-impact clusters: ${sameImpactClusters.length}`
);

console.log(
    `Breaks inside same-impact clusters: ${breaksInsideSameImpactClusters}`
);

console.log('');


console.log(
    'DAMAGE-ORIGIN THRESHOLDS — ±4 TICKS'
);

console.log(
    '-----------------------------------'
);

console.log('');


for (
    const threshold
    of ORIGIN_DISTANCE_THRESHOLDS
) {

    const row =
        thresholdMatrix.find(
            item =>
                item.tickWindow ===
                    4
                &&
                item.distanceThreshold ===
                    threshold
        );


    if (
        !row
    ) {

        continue;
    }


    console.log(
        `origin <= ${
            String(
                threshold
            ).padStart(
                6
            )
        }  unresolved=${
            String(
                row.allUnresolved.breaksWithCandidate
            ).padStart(
                4
            )
        }/${
            unresolvedRows.length
        }  unique=${
            String(
                row.allUnresolved.uniquePlayerBreaks
            ).padStart(
                4
            )
        }  ambiguous=${
            String(
                row.allUnresolved.multiplePlayerBreaks
            ).padStart(
                3
            )
        }  meleeControl=${
            String(
                row.meleeControl.breaksWithCandidate
            ).padStart(
                3
            )
        }  bulletControl=${
            String(
                row.bulletControl.breaksWithCandidate
            ).padStart(
                3
            )
        }`
    );
}


console.log('');


console.log(
    'DIAGNOSTIC ONLY — ±4 TICKS / <=4 UNITS'
);

console.log(
    '--------------------------------------'
);

console.log(
    `Matched unresolved: ${
        diagnosticMatches.length
    }/${
        unresolvedRows.length
    } = ${
        formatPercent(
            rate(
                diagnosticMatches.length,
                unresolvedRows.length
            )
        )
    }`
);

console.log('');


console.log(
    'BEST ORIGIN DISTANCE'
);

console.log(
    '--------------------'
);

console.log(
    'Unresolved:'
);

printSummary(
    summarizeNumbers(
        unresolvedBestDistances
    )
);

console.log('');

console.log(
    'Known melee control:'
);

printSummary(
    summarizeNumbers(
        meleeBestDistances
    )
);

console.log('');

console.log(
    'Known bullet control:'
);

printSummary(
    summarizeNumbers(
        bulletBestDistances
    )
);

console.log('');


console.log(
    'TOP UNRESOLVED DEBRIS DAMAGE VALUES'
);

console.log(
    '-----------------------------------'
);


for (
    const [
        value,
        count
    ]
    of Object.entries(
        unresolvedDamageSignatures
    )
    .slice(
        0,
        15
    )
) {

    console.log(
        `${
            String(
                value
            ).padStart(
                12
            )
        } : ${count}`
    );
}


console.log('');


console.log(
    'TOP DIAGNOSTIC ABILITY IDS'
);

console.log(
    '--------------------------'
);


for (
    const [
        abilityId,
        count
    ]
    of Object.entries(
        diagnosticAbilityIdCounts
    )
    .slice(
        0,
        15
    )
) {

    console.log(
        `${
            String(
                abilityId
            ).padEnd(
                16
            )
        } ${count}`
    );
}


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
    distanceThreshold
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
                distanceThreshold
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
            getUniquePlayers(
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
// THRESHOLD FILTER
// ============================================================

function thresholdCandidates(
    row,
    tickWindow,
    distanceThreshold
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
                candidate.originDistance <=
                    distanceThreshold
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
// NEARBY IMPORTANT ABILITIES
// ============================================================

function findNearbyImportantAbilities(
    breakTick,
    player
) {

    const rows =
        [];


    for (
        let tick =
            breakTick -
            IMPORTANT_ABILITY_WINDOW_TICKS;

        tick <=
            breakTick +
            IMPORTANT_ABILITY_WINDOW_TICKS;

        tick++
    ) {

        const events =
            importantAbilityByTick.get(
                tick
            )
            ??
            [];


        for (
            const event
            of events
        ) {

            if (
                !event.player
                ||
                !samePlayer(
                    event.player,
                    player
                )
            ) {

                continue;
            }


            rows.push({

                tick:
                    event.tick,

                tickDelta:
                    event.tick -
                    breakTick,

                matchTimeSeconds:
                    event.matchTimeSeconds,

                abilityName:
                    event.abilityName,

                rawCaster:
                    event.rawCaster,

                rawPlayer:
                    event.rawPlayer
            });
        }
    }


    return rows;
}


// ============================================================
// UNIQUE PLAYERS
// ============================================================

function getUniquePlayers(
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
            player.pawnEntityIndex !==
                null
                &&
                player.pawnEntityIndex !==
                    undefined

                ? `pawn:${player.pawnEntityIndex}`

                : `name:${player.playerName}`;


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
// CANDIDATE SCORE
// ============================================================

function candidateScore(
    tickDelta,
    originDistance
) {

    let score =
        Math.abs(
            tickDelta
        )
        *
        10000;


    if (
        tickDelta >
        0
    ) {

        score +=
            2500;
    }


    score +=
        originDistance;


    return score;
}


// ============================================================
// PLAYER RESOLUTION
// ============================================================

function resolvePlayerEntity(
    rawIndex
) {

    if (
        rawIndex ===
        null
        ||
        rawIndex ===
        undefined
    ) {

        return null;
    }


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
// ENTITY HANDLE LOW 14 BITS
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
// DISTANCE
// ============================================================

function distance3D(
    a,
    b
) {

    if (
        !a
        ||
        !b
    ) {

        return null;
    }


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
// QUANTIZE
// ============================================================

function quantize(
    value,
    step
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return null;
    }


    return (
        Math.round(
            value /
            step
        )
        *
        step
    );
}


// ============================================================
// ROUND
// ============================================================

function roundNumber(
    value,
    decimals
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return null;
    }


    const factor =
        10 **
        decimals;


    return (
        Math.round(
            value *
            factor
        )
        /
        factor
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
        [...map.entries()]
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
// SORT OBJECT
// ============================================================

function sortObjectDescending(
    object
) {

    return Object.fromEntries(
        Object.entries(
            object
        )
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


    const sum =
        clean.reduce(
            (
                total,
                value
            ) =>
                total +
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
            sum /
            clean.length
    };
}


// ============================================================
// PERCENTILE
// ============================================================

function percentile(
    sorted,
    proportion
) {

    if (
        sorted.length ===
        0
    ) {

        return null;
    }


    if (
        sorted.length ===
        1
    ) {

        return sorted[0];
    }


    const index =
        (
            sorted.length -
            1
        )
        *
        proportion;


    const lower =
        Math.floor(
            index
        );


    const upper =
        Math.ceil(
            index
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
        index -
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
// PRINT SUMMARY
// ============================================================

function printSummary(
    summary
) {

    console.log(
        `  count: ${summary.count}`
    );

    console.log(
        `  min: ${formatNumber(summary.min)}`
    );

    console.log(
        `  p25: ${formatNumber(summary.p25)}`
    );

    console.log(
        `  median: ${formatNumber(summary.median)}`
    );

    console.log(
        `  p75: ${formatNumber(summary.p75)}`
    );

    console.log(
        `  p90: ${formatNumber(summary.p90)}`
    );

    console.log(
        `  p95: ${formatNumber(summary.p95)}`
    );

    console.log(
        `  max: ${formatNumber(summary.max)}`
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
// FORMAT NUMBER
// ============================================================

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
// FORMAT PERCENT
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