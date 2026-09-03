import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
} from 'node:fs';

import {
    dirname,
    resolve
} from 'node:path';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


// Exact preDamage equality has effectively been bit-identical
// in the discovered examples.
//
// Keep a tiny epsilon for floating-point serialization.
const PREDAMAGE_EPSILON =
    0.000001;


// Script 36 grouped common impact points to quarter-unit
// precision.
//
// We rebuild clusters here from the canonical V1 break rows.
const IMPACT_ROUNDING =
    0.25;


// A same-impact cluster must contain at least two resources
// before we consider it AoE/multi-break evidence.
const MIN_CLUSTER_SIZE =
    2;


// These are diagnostic signatures discovered around the
// Mid Boss fights.
//
// They are NOT themselves used as attribution rules.
const SUSPICIOUS_SIGNATURES =
    [
        71.41799926757812,
        74.11800384521484,
        74.010009765625
    ];


// ============================================================
// PATHS
// ============================================================

const attributionV1Path =
    resolve(
        'output',
        replayName,
        'breakable_action_attribution_v1.json'
    );


const damageOriginPath =
    resolve(
        'output',
        replayName,
        'breakable_midboss_rejuv_diagnostic.json'
    );


const preDamagePath =
    resolve(
        'output',
        replayName,
        'breakable_predamage_attribution_diagnostic.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_evidence_fusion_diagnostic.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        attributionV1Path,
        damageOriginPath,
        preDamagePath
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

const attributionV1 =
    JSON.parse(
        readFileSync(
            attributionV1Path,
            'utf8'
        )
    );


const damageOriginDiagnostic =
    JSON.parse(
        readFileSync(
            damageOriginPath,
            'utf8'
        )
    );


const preDamageDiagnostic =
    JSON.parse(
        readFileSync(
            preDamagePath,
            'utf8'
        )
    );


// ============================================================
// CANONICAL BREAK ROWS
// ============================================================

const v1Rows =
    Array.isArray(
        attributionV1.attributionRows
    )
        ? attributionV1.attributionRows
        : [];


if (
    v1Rows.length ===
    0
) {

    throw new Error(
        'breakable_action_attribution_v1.json contains no attributionRows.'
    );
}


// ============================================================
// PREDAMAGE ROWS
// ============================================================

const preDamageRows =
    Array.isArray(
        preDamageDiagnostic.breakRows
    )
        ? preDamageDiagnostic.breakRows
        : [];


if (
    preDamageRows.length ===
    0
) {

    throw new Error(
        'breakable_predamage_attribution_diagnostic.json contains no breakRows.'
    );
}


const preDamageRowByBreakKey =
    new Map();


for (
    const row
    of preDamageRows
) {

    preDamageRowByBreakKey.set(
        row.breakKey,
        row
    );
}


// ============================================================
// DAMAGE ORIGIN MATCHES
// ============================================================

const exactOriginRows =
    Array.isArray(
        damageOriginDiagnostic.exactOriginMatches
    )
        ? damageOriginDiagnostic.exactOriginMatches
        : [];


const exactOriginByBreakKey =
    new Map();


for (
    const row
    of exactOriginRows
) {

    if (
        !row.breakKey
        ||
        !row.player
    ) {

        continue;
    }


    exactOriginByBreakKey.set(
        row.breakKey,
        row
    );
}


// ============================================================
// NORMALIZED BREAKS
// ============================================================

const breaks =
    v1Rows

        .map(
            row => {

                const debrisDamage =
                    toFiniteNumber(
                        row
                            ?.debris
                            ?.damage
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

                    breakClock:
                        row.breakClock
                        ??
                        null,

                    breakMatchTimeSeconds:
                        toFiniteNumber(
                            row.breakMatchTimeSeconds
                        ),

                    position:
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

                    debrisDamage,

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
                        null,

                    meleeEvidence:
                        row.meleeEvidence
                        ??
                        null,

                    bulletEvidence:
                        row.bulletEvidence
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
        )

        .sort(
            (
                a,
                b
            ) =>
                a.breakTick -
                b.breakTick
        );


const breakByKey =
    new Map();


for (
    const row
    of breaks
) {

    breakByKey.set(
        row.breakKey,
        row
    );
}


// ============================================================
// BUILD SAME-IMPACT / SAME-DAMAGE CLUSTERS
// ============================================================

const clusterMap =
    new Map();


for (
    const row
    of breaks
) {

    if (
        !row.impactPosition
        ||
        row.debrisDamage ===
            null
    ) {

        continue;
    }


    const clusterKey =
        buildClusterKey(
            row
        );


    if (
        !clusterMap.has(
            clusterKey
        )
    ) {

        clusterMap.set(
            clusterKey,
            {

                clusterKey,

                tick:
                    row.breakTick,

                clock:
                    row.breakClock,

                impactPosition:
                    roundPosition(
                        row.impactPosition,
                        IMPACT_ROUNDING
                    ),

                debrisDamage:
                    row.debrisDamage,

                members:
                    []
            }
        );
    }


    clusterMap
        .get(
            clusterKey
        )
        .members
        .push(
            row
        );
}


const clusters =
    [
        ...clusterMap.values()
    ]

        .filter(
            cluster =>
                cluster.members.length >=
                MIN_CLUSTER_SIZE
        )

        .sort(
            (
                a,
                b
            ) =>
                b.members.length -
                a.members.length
                ||
                a.tick -
                b.tick
        );


const clusterByBreakKey =
    new Map();


for (
    const cluster
    of clusters
) {

    for (
        const member
        of cluster.members
    ) {

        clusterByBreakKey.set(
            member.breakKey,
            cluster
        );
    }
}


// ============================================================
// STRICT PREDAMAGE EVIDENCE PER BREAK
// ============================================================

const strictPreDamageByBreakKey =
    new Map();


for (
    const row
    of breaks
) {

    const source =
        preDamageRowByBreakKey.get(
            row.breakKey
        );


    if (
        !source
    ) {

        continue;
    }


    const candidates =
        (
            source.candidates
            ??
            []
        )

            .filter(
                candidate =>
                    candidate.tickDelta ===
                        0
                    &&
                    toFiniteNumber(
                        candidate.absoluteDamageDifference
                    )
                    !==
                        null
                    &&
                    candidate.absoluteDamageDifference <=
                        PREDAMAGE_EPSILON
                    &&
                    candidate.player
            );


    if (
        candidates.length ===
        0
    ) {

        continue;
    }


    const players =
        uniquePlayers(
            candidates.map(
                candidate =>
                    candidate.player
            )
        );


    const abilities =
        uniqueAbilities(
            candidates
        );


    const citadelTypes =
        uniqueValues(
            candidates.map(
                candidate =>
                    candidate.citadelType
            )
        );


    const damageTypes =
        uniqueValues(
            candidates.map(
                candidate =>
                    candidate.damageType
            )
        );


    strictPreDamageByBreakKey.set(
        row.breakKey,
        {

            candidateCount:
                candidates.length,

            uniquePlayerCount:
                players.length,

            players,

            uniqueAbilityCount:
                abilities.length,

            abilities,

            citadelTypes,

            damageTypes,

            candidates,

            player:
                players.length ===
                    1
                    ? players[0]
                    : null,

            ability:
                abilities.length ===
                    1
                    ? abilities[0]
                    : null
        }
    );
}


// ============================================================
// CLUSTER-LEVEL PREDAMAGE EVIDENCE
//
// A cluster can only become a conservative attribution
// candidate when:
//
// 1. >= 2 resources share the same break tick,
//    debris impact point and damage value.
//
// 2. At least one exact-tick / exact-preDamage player message
//    exists.
//
// 3. All qualifying messages resolve to one player.
//
// 4. All qualifying messages resolve to one ability signature.
//
// This is deliberately much stricter than Script 38's
// single-break rule.
// ============================================================

const clusterEvidenceByKey =
    new Map();


for (
    const cluster
    of clusters
) {

    const allCandidates =
        [];


    for (
        const member
        of cluster.members
    ) {

        const evidence =
            strictPreDamageByBreakKey.get(
                member.breakKey
            );


        if (
            !evidence
        ) {

            continue;
        }


        allCandidates.push(
            ...evidence.candidates
        );
    }


    const players =
        uniquePlayers(
            allCandidates.map(
                candidate =>
                    candidate.player
            )
        );


    const abilities =
        uniqueAbilities(
            allCandidates
        );


    const citadelTypes =
        uniqueValues(
            allCandidates.map(
                candidate =>
                    candidate.citadelType
            )
        );


    const damageTypes =
        uniqueValues(
            allCandidates.map(
                candidate =>
                    candidate.damageType
            )
        );


    const uniquePlayer =
        players.length ===
        1
            ? players[0]
            : null;


    const uniqueAbility =
        abilities.length ===
        1
            ? abilities[0]
            : null;


    const conservativeCandidate =
        (
            allCandidates.length >
                0
            &&
            uniquePlayer !==
                null
            &&
            uniqueAbility !==
                null
        );


    clusterEvidenceByKey.set(
        cluster.clusterKey,
        {

            clusterKey:
                cluster.clusterKey,

            tick:
                cluster.tick,

            clock:
                cluster.clock,

            memberCount:
                cluster.members.length,

            memberBreakKeys:
                cluster.members.map(
                    member =>
                        member.breakKey
                ),

            impactPosition:
                cluster.impactPosition,

            debrisDamage:
                cluster.debrisDamage,

            candidateMessageCount:
                allCandidates.length,

            uniquePlayerCount:
                players.length,

            players,

            uniqueAbilityCount:
                abilities.length,

            abilities,

            citadelTypes,

            damageTypes,

            player:
                uniquePlayer,

            ability:
                uniqueAbility,

            conservativeCandidate
        }
    );
}


// ============================================================
// FUSE EVIDENCE FOR EACH UNRESOLVED BREAK
// ============================================================

const fusionRows =
    [];


for (
    const row
    of breaks
) {

    if (
        row.attributionStatus ===
        'ATTRIBUTED'
    ) {

        continue;
    }


    const origin =
        exactOriginByBreakKey.get(
            row.breakKey
        )
        ??
        null;


    const ownPreDamage =
        strictPreDamageByBreakKey.get(
            row.breakKey
        )
        ??
        null;


    const cluster =
        clusterByBreakKey.get(
            row.breakKey
        )
        ??
        null;


    const clusterEvidence =
        cluster
            ? clusterEvidenceByKey.get(
                cluster.clusterKey
            )
            : null;


    const originPlayer =
        origin
            ?.player
        ??
        null;


    const ownPreDamagePlayer =
        ownPreDamage
            ?.player
        ??
        null;


    const clusterPlayer =
        clusterEvidence
            ?.conservativeCandidate
            ? clusterEvidence.player
            : null;


    // ========================================================
    // COMBINED PREDAMAGE PLAYER
    //
    // Prefer cluster evidence when available because it has
    // multi-resource support.
    // ========================================================

    const preDamagePlayer =
        clusterPlayer
        ??
        ownPreDamagePlayer
        ??
        null;


    const preDamageEvidenceType =
        clusterPlayer
            ? 'CLUSTER_PREDAMAGE'
            : ownPreDamagePlayer
                ? 'SINGLE_PREDAMAGE'
                : null;


    // ========================================================
    // CLASSIFICATION
    // ========================================================

    let fusionClass =
        'NO_NEW_EVIDENCE';


    let candidatePlayer =
        null;


    let conservativeForV2 =
        false;


    let confidence =
        'UNRESOLVED';


    if (
        originPlayer
        &&
        preDamagePlayer
    ) {

        if (
            samePlayer(
                originPlayer,
                preDamagePlayer
            )
        ) {

            fusionClass =
                clusterPlayer
                    ? 'ORIGIN_PREDAMAGE_CLUSTER_AGREE'
                    : 'ORIGIN_PREDAMAGE_AGREE';


            candidatePlayer =
                originPlayer;


            conservativeForV2 =
                true;


            confidence =
                'VERY_HIGH_MULTI_SIGNAL';


        } else {

            fusionClass =
                'ORIGIN_PREDAMAGE_CONFLICT';


            candidatePlayer =
                null;


            conservativeForV2 =
                false;


            confidence =
                'CONFLICT';
        }


    } else if (
        originPlayer
    ) {

        fusionClass =
            'ORIGIN_ONLY';


        candidatePlayer =
            originPlayer;


        // Keep as candidate for now.
        //
        // Script 39 will report how much independent support
        // exists, but does not make this canonical itself.
        conservativeForV2 =
            true;


        confidence =
            'HIGH_SPATIAL';


    } else if (
        clusterPlayer
    ) {

        fusionClass =
            'PREDAMAGE_CLUSTER_ONLY';


        candidatePlayer =
            clusterPlayer;


        conservativeForV2 =
            true;


        confidence =
            'HIGH_MULTI_BREAK_SIGNATURE';


    } else if (
        ownPreDamagePlayer
    ) {

        fusionClass =
            'PREDAMAGE_SINGLETON_ONLY';


        candidatePlayer =
            ownPreDamagePlayer;


        // Explicitly NOT conservative enough for v2 because
        // Script 38's bullet controls showed many conflicts.
        conservativeForV2 =
            false;


        confidence =
            'DIAGNOSTIC_ONLY';


    } else if (
        origin
        &&
        !originPlayer
    ) {

        fusionClass =
            'ORIGIN_AMBIGUOUS';


        conservativeForV2 =
            false;


        confidence =
            'UNRESOLVED';
    }


    const suspiciousSignature =
        row.debrisDamage !==
            null
        &&
        SUSPICIOUS_SIGNATURES.some(
            value =>
                Math.abs(
                    row.debrisDamage -
                    value
                )
                <=
                PREDAMAGE_EPSILON
        );


    fusionRows.push({

        breakKey:
            row.breakKey,

        entityIndex:
            row.entityIndex,

        resourceType:
            row.resourceType,

        breakTick:
            row.breakTick,

        breakClock:
            row.breakClock,

        debrisDamage:
            row.debrisDamage,

        rewardOutcome:
            row.rewardOutcome,

        previousAttributionStatus:
            row.attributionStatus,

        previousAttributionMethod:
            row.attributionMethod,

        suspiciousSignature,

        sameImpactCluster:
            cluster
                ? {

                    clusterKey:
                        cluster.clusterKey,

                    memberCount:
                        cluster.members.length,

                    breakKeys:
                        cluster.members.map(
                            member =>
                                member.breakKey
                        )
                }

                : null,

        originEvidence:
            origin
                ? {

                    player:
                        originPlayer,

                    candidateCount:
                        origin.candidateCount
                        ??
                        origin
                            ?.candidates
                            ?.length
                        ??
                        null,

                    candidates:
                        origin.candidates
                        ??
                        []
                }

                : null,

        ownPreDamageEvidence:
            ownPreDamage,

        clusterPreDamageEvidence:
            clusterEvidence,

        preDamageEvidenceType,

        fusionClass,

        candidatePlayer,

        conservativeForV2,

        confidence
    });
}


// ============================================================
// FUSION SUMMARY
// ============================================================

const fusionClassCounts =
    countBy(
        fusionRows,
        row =>
            row.fusionClass
    );


const conservativeRows =
    fusionRows.filter(
        row =>
            row.conservativeForV2
            &&
            row.candidatePlayer
    );


const conservativePlayerCounts =
    countBy(
        conservativeRows,
        row =>
            row
                .candidatePlayer
                ?.playerName
            ??
            'UNKNOWN'
    );


// ============================================================
// EXPLICIT CONFLICTS
// ============================================================

const conflictRows =
    fusionRows.filter(
        row =>
            row.fusionClass ===
            'ORIGIN_PREDAMAGE_CONFLICT'
    );


// ============================================================
// SINGLETON PREDAMAGE ROWS
//
// These are deliberately NOT promoted.
// ============================================================

const singletonPreDamageRows =
    fusionRows.filter(
        row =>
            row.fusionClass ===
            'PREDAMAGE_SINGLETON_ONLY'
    );


// ============================================================
// CLUSTER CONTROL VALIDATION
//
// Compare cluster-level preDamage predictions against any
// already-attributed V1 members inside the same cluster.
//
// This is the most important control for the proposed AoE
// channel.
// ============================================================

let controlClustersWithPrediction =
    0;


let controlAttributedMembers =
    0;


let controlAgreements =
    0;


let controlConflicts =
    0;


const clusterControlRows =
    [];


for (
    const cluster
    of clusters
) {

    const evidence =
        clusterEvidenceByKey.get(
            cluster.clusterKey
        );


    if (
        !evidence
        ||
        !evidence.conservativeCandidate
        ||
        !evidence.player
    ) {

        continue;
    }


    const attributedMembers =
        cluster.members.filter(
            member =>
                member.attributionStatus ===
                'ATTRIBUTED'
                &&
                member.existingPlayer
        );


    if (
        attributedMembers.length ===
        0
    ) {

        continue;
    }


    controlClustersWithPrediction++;


    let clusterAgreements =
        0;


    let clusterConflicts =
        0;


    for (
        const member
        of attributedMembers
    ) {

        controlAttributedMembers++;


        if (
            samePlayer(
                evidence.player,
                member.existingPlayer
            )
        ) {

            controlAgreements++;

            clusterAgreements++;


        } else {

            controlConflicts++;

            clusterConflicts++;
        }
    }


    clusterControlRows.push({

        clusterKey:
            cluster.clusterKey,

        tick:
            cluster.tick,

        clock:
            cluster.clock,

        memberCount:
            cluster.members.length,

        predictedPlayer:
            evidence.player,

        predictedAbility:
            evidence.ability,

        attributedControlMembers:
            attributedMembers.map(
                member => ({

                    breakKey:
                        member.breakKey,

                    method:
                        member.attributionMethod,

                    player:
                        member.existingPlayer,

                    agrees:
                        samePlayer(
                            evidence.player,
                            member.existingPlayer
                        )
                })
            ),

        agreementCount:
            clusterAgreements,

        conflictCount:
            clusterConflicts
    });
}


// ============================================================
// ORIGIN ↔ PREDAMAGE AGREEMENT
// ============================================================

let dualEvidenceRows =
    0;


let dualEvidenceAgreements =
    0;


let dualEvidenceConflicts =
    0;


for (
    const row
    of fusionRows
) {

    if (
        !row.originEvidence
        ||
        !row.ownPreDamageEvidence
        ||
        !row.originEvidence.player
        ||
        !row.ownPreDamageEvidence.player
    ) {

        continue;
    }


    dualEvidenceRows++;


    if (
        samePlayer(
            row.originEvidence.player,
            row.ownPreDamageEvidence.player
        )
    ) {

        dualEvidenceAgreements++;

    } else {

        dualEvidenceConflicts++;
    }
}


// ============================================================
// SUSPICIOUS SIGNATURE SUMMARY
// ============================================================

const suspiciousSummary =
    {};


for (
    const signature
    of SUSPICIOUS_SIGNATURES
) {

    const relevant =
        fusionRows.filter(
            row =>
                row.debrisDamage !==
                    null
                &&
                Math.abs(
                    row.debrisDamage -
                    signature
                )
                <=
                PREDAMAGE_EPSILON
        );


    const conservative =
        relevant.filter(
            row =>
                row.conservativeForV2
                &&
                row.candidatePlayer
        );


    suspiciousSummary[
        String(
            signature
        )
    ] =
        {

            unresolvedBreaks:
                relevant.length,

            conservativeRecovered:
                conservative.length,

            recoveryRate:
                rate(
                    conservative.length,
                    relevant.length
                ),

            fusionClasses:
                countBy(
                    relevant,
                    row =>
                        row.fusionClass
                ),

            recoveredPlayers:
                countBy(
                    conservative,
                    row =>
                        row
                            .candidatePlayer
                            ?.playerName
                        ??
                        'UNKNOWN'
                ),

            clocks:
                [
                    ...new Set(
                        relevant.map(
                            row =>
                                row.breakClock
                        )
                    )
                ]
        };
}


// ============================================================
// CLUSTER COVERAGE
// ============================================================

const unresolvedClusterRows =
    fusionRows.filter(
        row =>
            row.sameImpactCluster
    );


const conservativeClusterRows =
    unresolvedClusterRows.filter(
        row =>
            row.conservativeForV2
            &&
            row.candidatePlayer
    );


// ============================================================
// HYPOTHETICAL V2 COVERAGE
//
// Existing V1 attributed rows remain untouched.
//
// Only conservative fused rows are added.
//
// This is still diagnostic; Script 39 does not overwrite V1.
// ============================================================

const existingAttributed =
    breaks.filter(
        row =>
            row.attributionStatus ===
            'ATTRIBUTED'
    ).length;


const newlyConservative =
    conservativeRows.length;


const hypotheticalAttributed =
    existingAttributed +
    newlyConservative;


const hypotheticalCoverage =
    rate(
        hypotheticalAttributed,
        breaks.length
    );


// ============================================================
// AMBIGUOUS BULLET RESOLUTION
// ============================================================

const ambiguousBulletRows =
    fusionRows.filter(
        row =>
            row.previousAttributionMethod ===
            'BULLET_RAY_MULTIPLE_PLAYERS'
    );


const ambiguousBulletSummary =
    {

        total:
            ambiguousBulletRows.length,

        conservativeResolved:
            ambiguousBulletRows.filter(
                row =>
                    row.conservativeForV2
                    &&
                    row.candidatePlayer
            ).length,

        conflicts:
            ambiguousBulletRows.filter(
                row =>
                    row.fusionClass ===
                    'ORIGIN_PREDAMAGE_CONFLICT'
            ).length,

        rows:
            ambiguousBulletRows
    };


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BREAKABLE_EVIDENCE_FUSION_DIAGNOSTIC',

        canonical:
            false,

        purpose:
            [

                'Fuse independent breakable attribution signals conservatively.',

                'Retain V1 melee and bullet-ray attribution unchanged.',

                'Do not use exact preDamage alone for singleton breaks because Script 38 produced substantial conflicts against bullet controls.',

                'Treat agreement between exact damage-origin and exact preDamage as very strong evidence.',

                'Treat same-impact multi-resource clusters with one unique exact-preDamage player and one unique ability as candidate AoE attribution.',

                'Leave conflicting signals unresolved rather than forcing a player.'
            ],

        constants:
            {

                preDamageEpsilon:
                    PREDAMAGE_EPSILON,

                impactRounding:
                    IMPACT_ROUNDING,

                minimumClusterSize:
                    MIN_CLUSTER_SIZE
            },

        sourceCounts:
            {

                totalBreaks:
                    breaks.length,

                existingAttributed,

                unresolved:
                    fusionRows.length,

                exactOriginEvidenceRows:
                    exactOriginByBreakKey.size,

                strictPreDamageEvidenceRows:
                    strictPreDamageByBreakKey.size,

                sameImpactSameDamageClusters:
                    clusters.length
            },

        fusionSummary:
            {

                fusionClassCounts,

                conservativeNewAttributions:
                    conservativeRows.length,

                conservativePlayerCounts,

                explicitConflicts:
                    conflictRows.length,

                preDamageSingletonsHeldBack:
                    singletonPreDamageRows.length
            },

        independentSignalAgreement:
            {

                rowsWithBothOriginAndOwnPreDamage:
                    dualEvidenceRows,

                agreements:
                    dualEvidenceAgreements,

                conflicts:
                    dualEvidenceConflicts,

                agreementRate:
                    rate(
                        dualEvidenceAgreements,
                        dualEvidenceRows
                    )
            },

        clusterControlValidation:
            {

                clustersWithPredictionAndKnownV1Member:
                    controlClustersWithPrediction,

                knownAttributedMembers:
                    controlAttributedMembers,

                agreements:
                    controlAgreements,

                conflicts:
                    controlConflicts,

                agreementRate:
                    rate(
                        controlAgreements,
                        controlAttributedMembers
                    ),

                rows:
                    clusterControlRows
            },

        unresolvedClusterCoverage:
            {

                unresolvedRowsInClusters:
                    unresolvedClusterRows.length,

                conservativeRecovered:
                    conservativeClusterRows.length,

                recoveryRate:
                    rate(
                        conservativeClusterRows.length,
                        unresolvedClusterRows.length
                    )
            },

        suspiciousSignatureSummary:
            suspiciousSummary,

        ambiguousBulletSummary,

        hypotheticalV2Coverage:
            {

                existingAttributed,

                newlyConservative,

                hypotheticalAttributed,

                totalBreaks:
                    breaks.length,

                coverage:
                    hypotheticalCoverage
            },

        conflictRows,

        singletonPreDamageRows,

        clusterEvidence:
            [
                ...clusterEvidenceByKey.values()
            ],

        fusionRows
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

console.log('');

console.log(
    '======================================'
);

console.log(
    'BREAKABLE EVIDENCE FUSION DIAGNOSTIC'
);

console.log(
    '======================================'
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Total breaks: ${breaks.length}`
);

console.log(
    `Existing V1 attributed: ${existingAttributed}`
);

console.log(
    `Unresolved entering fusion: ${fusionRows.length}`
);

console.log('');


// ============================================================
// FUSION CLASSES
// ============================================================

console.log(
    'FUSION CLASSES'
);

console.log(
    '--------------'
);


for (
    const [
        key,
        value
    ]
    of Object.entries(
        fusionClassCounts
    )
) {

    console.log(
        `${
            String(
                key
            ).padEnd(
                38
            )
        } ${value}`
    );
}


console.log('');


// ============================================================
// DUAL SIGNAL
// ============================================================

console.log(
    'ORIGIN ↔ PREDAMAGE AGREEMENT'
);

console.log(
    '----------------------------'
);

console.log(
    `Both signals present: ${dualEvidenceRows}`
);

console.log(
    `Agree: ${dualEvidenceAgreements}`
);

console.log(
    `Conflict: ${dualEvidenceConflicts}`
);

console.log(
    `Agreement rate: ${formatPercent(
        rate(
            dualEvidenceAgreements,
            dualEvidenceRows
        )
    )}`
);

console.log('');


// ============================================================
// CLUSTER CONTROL
// ============================================================

console.log(
    'CLUSTER CONTROL VALIDATION'
);

console.log(
    '--------------------------'
);

console.log(
    `Predicted clusters with V1 controls: ${controlClustersWithPrediction}`
);

console.log(
    `Known control members: ${controlAttributedMembers}`
);

console.log(
    `Agreement: ${controlAgreements}`
);

console.log(
    `Conflict: ${controlConflicts}`
);

console.log(
    `Agreement rate: ${formatPercent(
        rate(
            controlAgreements,
            controlAttributedMembers
        )
    )}`
);

console.log('');


// ============================================================
// HELD-BACK SINGLETONS
// ============================================================

console.log(
    'PREDAMAGE SINGLETONS'
);

console.log(
    '--------------------'
);

console.log(
    `Held back from canonical consideration: ${singletonPreDamageRows.length}`
);

console.log('');


// ============================================================
// CONFLICTS
// ============================================================

console.log(
    'EXPLICIT SIGNAL CONFLICTS'
);

console.log(
    '-------------------------'
);

console.log(
    `Origin vs preDamage conflicts: ${conflictRows.length}`
);


for (
    const row
    of conflictRows
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
        } origin=${
            row
                ?.originEvidence
                ?.player
                ?.playerName
            ??
            'NONE'
        } preDamage=${
            row
                ?.ownPreDamageEvidence
                ?.player
                ?.playerName
            ??
            row
                ?.clusterPreDamageEvidence
                ?.player
                ?.playerName
            ??
            'NONE'
        } damage=${
            row.debrisDamage
        }`
    );
}


console.log('');


// ============================================================
// SUSPICIOUS SIGNATURES
// ============================================================

console.log(
    'MID-BOSS-ERA SIGNATURES'
);

console.log(
    '-----------------------'
);


for (
    const [
        signature,
        summary
    ]
    of Object.entries(
        suspiciousSummary
    )
) {

    console.log(
        `damage=${
            String(
                signature
            ).padEnd(
                20
            )
        } unresolved=${
            String(
                summary.unresolvedBreaks
            ).padStart(
                3
            )
        } recovered=${
            String(
                summary.conservativeRecovered
            ).padStart(
                3
            )
        } rate=${
            formatPercent(
                summary.recoveryRate
            )
        } players=${
            JSON.stringify(
                summary.recoveredPlayers
            )
        }`
    );
}


console.log('');


// ============================================================
// AMBIGUOUS BULLETS
// ============================================================

console.log(
    'AMBIGUOUS BULLET EVENTS'
);

console.log(
    '-----------------------'
);

console.log(
    `Total V1 ambiguous: ${ambiguousBulletSummary.total}`
);

console.log(
    `Conservatively resolved: ${ambiguousBulletSummary.conservativeResolved}`
);

console.log(
    `Signal conflicts: ${ambiguousBulletSummary.conflicts}`
);

console.log('');


// ============================================================
// COVERAGE
// ============================================================

console.log(
    'HYPOTHETICAL V2 COVERAGE'
);

console.log(
    '------------------------'
);

console.log(
    `Existing attributed: ${existingAttributed}/${breaks.length}`
);

console.log(
    `New conservative candidates: ${newlyConservative}`
);

console.log(
    `Potential attributed: ${hypotheticalAttributed}/${breaks.length}`
);

console.log(
    `Potential coverage: ${formatPercent(
        hypotheticalCoverage
    )}`
);

console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


// ============================================================
// CLUSTER KEY
// ============================================================

function buildClusterKey(
    row
) {

    const rounded =
        roundPosition(
            row.impactPosition,
            IMPACT_ROUNDING
        );


    const damage =
        roundNumber(
            row.debrisDamage,
            6
        );


    return (
        `${
            row.breakTick
        }|${
            rounded.x
        }|${
            rounded.y
        }|${
            rounded.z
        }|${
            damage
        }`
    );
}


// ============================================================
// ROUND POSITION
// ============================================================

function roundPosition(
    position,
    increment
) {

    return {

        x:
            roundToIncrement(
                position.x,
                increment
            ),

        y:
            roundToIncrement(
                position.y,
                increment
            ),

        z:
            roundToIncrement(
                position.z
                ??
                0,
                increment
            )
    };
}


// ============================================================
// ROUND TO INCREMENT
// ============================================================

function roundToIncrement(
    value,
    increment
) {

    return (
        Math.round(
            value /
            increment
        )
        *
        increment
    );
}


// ============================================================
// ROUND NUMBER
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
// UNIQUE PLAYERS
// ============================================================

function uniquePlayers(
    players
) {

    const map =
        new Map();


    for (
        const player
        of players
    ) {

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
// UNIQUE VALUES
// ============================================================

function uniqueValues(
    values
) {

    const set =
        new Set();


    for (
        const value
        of values
    ) {

        if (
            value ===
            null
            ||
            value ===
            undefined
        ) {

            continue;
        }


        set.add(
            String(
                value
            )
        );
    }


    return [
        ...set
    ];
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
// NORMALIZE POSITION
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