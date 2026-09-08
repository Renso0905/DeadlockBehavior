import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { requireClaim } from '../src/contracts/claim-registry.mjs';

const VERSION = 'BRIDGE_RUNTIME_INTERVAL_AUTHORITY_V01';

const WORLD_CONTRACT_PATH = resolve('output', 'cross_replay', 'world_stat_buff_resource_contract_v02.json');
const COLLECTION_PATH = resolve('output', 'cross_replay', 'bridge_world_collection_cross_replay_replication_v01.json');
const DURATION_PATH = resolve('output', 'cross_replay', 'bridge_survival_runtime_duration_validation_v01.json');
const MATCH_END_PATH = resolve('output', 'cross_replay', 'bridge_survival_match_end_outlier_diagnostic_v01.json');
const OUTPUT_PATH = resolve('output', 'cross_replay', 'bridge_runtime_interval_authority_v01.json');

for (const path of [WORLD_CONTRACT_PATH, COLLECTION_PATH, DURATION_PATH, MATCH_END_PATH]) {
  if (!existsSync(path)) throw new Error(`Required artifact missing:\n${path}`);
}

const bridgeResourceClaim = requireClaim('bridge_powerup_resource_contract', { requireSemantic: true });
const runtimeBridgeClaim = requireClaim(
  'runtime_bridge_buff_ownership',
  { requireSemantic: true, requireReplication: true }
);

const contract = readJson(WORLD_CONTRACT_PATH);
const collection = readJson(COLLECTION_PATH);
const duration = readJson(DURATION_PATH);
const matchEnd = readJson(MATCH_END_PATH);

const bridgePowerups = contract?.bridgePowerups?.powerups ?? [];
const durations = [...new Set(bridgePowerups.map(row => row?.durationSeconds).filter(Number.isFinite))];

const collectionCounts = collection?.counts ?? {};
const deck = collection?.deckReplication ?? {};
const durationAggregate = duration?.aggregate ?? {};
const hp = durationAggregate?.healthMax ?? {};
const regen = durationAggregate?.healthRegen ?? {};
const death = durationAggregate?.deathBehavior ?? {};
const matchEndClassifications = matchEnd?.counts?.classifications ?? {};

const matchEndCensored =
  (matchEndClassifications.MATCH_ENDED_BEFORE_EXPECTED_EXPIRY_CENSORED ?? 0)
  + (matchEndClassifications.MATCH_ENDED_AT_EXPECTED_EXPIRY_BOUNDARY_CENSORED ?? 0);

// Script152 intentionally classified all replay-observable, non-death anchors as
// "natural" before native match-end censoring was frozen. Script156 showed that
// the sole Script152 natural miss entered PostGame 38.313 s before its expected
// expiry. Therefore the corrected uncensored denominator removes that one case.
const script152Natural = durationAggregate?.naturalExpirationEligible ?? 0;
const directNaturalValidated = hp?.expirationNegative ?? 0;
const correctedUncensoredNatural = script152Natural - matchEndCensored;
const correctedNaturalRate = ratio(directNaturalValidated, correctedUncensoredNatural);

const deathAnchors = death?.anchors ?? 0;
const deathNegative = death?.healthMaxNegativeNearDeath ?? 0;
const deathNegativeRate = ratio(deathNegative, deathAnchors);

const checks = {
  bridgeResourceAuthorityCurrent: check(bridgeResourceClaim.authorityStatus, 'current', bridgeResourceClaim.authorityStatus === 'current'),
  runtimeBridgeAuthorityCurrent: check(runtimeBridgeClaim.authorityStatus, 'current', runtimeBridgeClaim.authorityStatus === 'current'),
  runtimeBridgeSemanticPass: check(runtimeBridgeClaim.semanticValidation, 'pass', runtimeBridgeClaim.semanticValidation === 'pass'),
  runtimeBridgeReplicationFrozen: check(runtimeBridgeClaim.replicationStatus, 'cross_replay_replicated', runtimeBridgeClaim.replicationStatus === 'cross_replay_replicated'),
  worldContractReady: check(contract?.status, 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY', contract?.status === 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY'),
  fourBridgePowerups: check(bridgePowerups.length, 4, bridgePowerups.length === 4),
  sharedDuration160Seconds: check(durations, [160], durations.length === 1 && durations[0] === 160),
  collectionStronglyReplicated: check(
    collection?.status,
    'BRIDGE_WORLD_COLLECTION_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS',
    collection?.status === 'BRIDGE_WORLD_COLLECTION_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS'
  ),
  collectionIndependentReplaysFive: check(collectionCounts.independentReplays, 5, collectionCounts.independentReplays === 5),
  collectionSemanticPassFive: check(collectionCounts.semanticPassReplays, 5, collectionCounts.semanticPassReplays === 5),
  collectionEventsSeventySix: check(collectionCounts.disappearEvents, 76, collectionCounts.disappearEvents === 76),
  collectorGeometryPerfectAt300HU: check(collectionCounts.trueWithin300Count, collectionCounts.trueDistanceRows, collectionCounts.trueWithin300Count === collectionCounts.trueDistanceRows && collectionCounts.trueDistanceRows === 76),
  shiftedPlaceboSeparated: check(collectionCounts.placeboWithin800Rate, '<=0.1', Number.isFinite(collectionCounts.placeboWithin800Rate) && collectionCounts.placeboWithin800Rate <= 0.1),
  deckRuleReplicated: check(deck.exactComplementBlocks, deck.completeBlocks, deck.completeBlocks === 12 && deck.exactComplementBlocks === 12),
  survivalDurationStronglyValidated: check(
    duration?.status,
    'BRIDGE_SURVIVAL_RUNTIME_DURATION_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS',
    duration?.status === 'BRIDGE_SURVIVAL_RUNTIME_DURATION_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS'
  ),
  matchEndDiagnosticResolved: check(matchEnd?.status, 'BRIDGE_SURVIVAL_MATCH_END_OUTLIER_V01_DIAGNOSED', matchEnd?.status === 'BRIDGE_SURVIVAL_MATCH_END_OUTLIER_V01_DIAGNOSED'),
  soleNaturalMissMatchEndCensored: check(matchEndCensored, 1, matchEndCensored === 1),
  correctedNaturalDenominatorEleven: check(correctedUncensoredNatural, 11, correctedUncensoredNatural === 11),
  correctedNaturalExpirationElevenOfEleven: check(directNaturalValidated, correctedUncensoredNatural, directNaturalValidated === 11 && correctedNaturalRate === 1),
  supportiveRegenExpirationEleven: check(regen?.expirationNegative ?? null, 11, regen?.expirationNegative === 11),
  deathTerminationSevenOfSeven: check(deathNegative, deathAnchors, deathAnchors === 7 && deathNegative === 7 && deathNegativeRate === 1),
  survivalExpiryTimingTight: check(hp?.medianExpirationTimingErrorSeconds ?? null, '<=0.125s', Number.isFinite(hp?.medianExpirationTimingErrorSeconds) && hp.medianExpirationTimingErrorSeconds <= 0.125),
};

const validationPass = Object.values(checks).every(row => row.pass);
const status = validationPass
  ? 'BRIDGE_RUNTIME_INTERVAL_AUTHORITY_V01_READY'
  : 'BRIDGE_RUNTIME_INTERVAL_AUTHORITY_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: true,
  createdAt: new Date().toISOString(),
  status,
  claimId: runtimeBridgeClaim.claimId,
  authority: {
    authorityStatus: runtimeBridgeClaim.authorityStatus,
    integrityValidation: runtimeBridgeClaim.integrityValidation,
    semanticValidation: runtimeBridgeClaim.semanticValidation,
    replicationStatus: runtimeBridgeClaim.replicationStatus,
  },
  foundations: {
    bridgeResourceContractArtifact: WORLD_CONTRACT_PATH,
    worldCollectionReplicationArtifact: COLLECTION_PATH,
    survivalDurationValidationArtifact: DURATION_PATH,
    matchEndOutlierDiagnosticArtifact: MATCH_END_PATH,
  },
  bridgePowerups: bridgePowerups.map(row => ({
    recordKey: row.recordKey,
    modifierClass: row.modifierClass,
    durationSeconds: row.durationSeconds,
  })),
  runtimeIntervalContract: {
    representation: 'RECONSTRUCTED_INTERVAL_FROM_VALIDATED_EVENTS_AND_RESOURCE_DURATION',
    acquisition: {
      worldEntityClass: 'CCitadel_Pickup_Modifier',
      identityField: 'm_nSubclassID',
      identityNamespace: 'MurmurHash2(recordKey)',
      collectionTransition: 'm_bActive true -> false UPDATE',
      collectorAttribution: 'nearest resolved player at collection transition under the frozen <=300 HU semantic gate',
    },
    nominalDurationSeconds: 160,
    naturalExpiration: 'acquisition + resource-defined 160-second modifier lifetime during ordinary active gameplay',
    earlyTermination: ['player death'],
    censoring: ['native game state leaves EGameState_GameInProgress before nominal expiry', 'replay ends before nominal expiry'],
    clockBoundary: 'Do not reduce resource GameTime_t lifetime to unconditional raw replay-tick arithmetic when a future interval overlaps pause/time-scale behavior; no pause-shifted validation anchor was available in the frozen cohort.',
  },
  evidenceSummary: {
    independentCollectionReplicationReplays: collectionCounts.independentReplays,
    collectionSemanticPassReplays: collectionCounts.semanticPassReplays,
    collectionEvents: collectionCounts.disappearEvents,
    collectorTrueWithin300Count: collectionCounts.trueWithin300Count,
    collectorTrueWithin300Rate: collectionCounts.trueWithin300Rate,
    shiftedPlaceboWithin800Count: collectionCounts.placeboWithin800Count,
    shiftedPlaceboWithin800Rate: collectionCounts.placeboWithin800Rate,
    twoWaveCompleteBlocks: deck.completeBlocks,
    twoWaveExactComplementBlocks: deck.exactComplementBlocks,
    twoWaveExactComplementRate: deck.exactRate,
    sharedDurationSeconds: durations[0] ?? null,
    directDurationConsequenceBuff: 'survival_powerup_pickup',
    survivalDirectNaturalEvidenceReplays: durationAggregate.replaysWithNaturalEvidence,
    survivalScript152NaturalCandidates: script152Natural,
    survivalMatchEndCensoredCandidates: matchEndCensored,
    survivalUncensoredNaturalExpirations: correctedUncensoredNatural,
    survivalValidatedNaturalExpirations: directNaturalValidated,
    survivalValidatedNaturalExpirationRate: correctedNaturalRate,
    survivalMedianExpirationTimingErrorSeconds: hp?.medianExpirationTimingErrorSeconds ?? null,
    survivalDeathTerminationAnchors: deathAnchors,
    survivalDeathTerminationsWithNegativeMaxHp: deathNegative,
    survivalDeathTerminationRate: deathNegativeRate,
  },
  semanticBoundary: {
    supported: 'Per-player bridge-powerup acquisition is cross-replay replicated for all four bridge types. The current build gives all four the same 160-second resource duration. Survival independently validates that duration in replay consequences at 11/11 uncensored natural expirations and validates death termination at 7/7 observed death-confounded acquisitions. Native match end is censoring, not an expiration failure.',
    scopedGeneralization: 'Gun, Casting, and Movement share the same bridge pickup/modifier resource family and 160-second contract, but their player-side expiration consequences were not independently observed through dedicated stat reversals. Their interval end therefore uses the shared resource contract plus the validated Survival lifetime semantics rather than four separate direct consequence tests.',
    notEstablished: 'Exact 5-to-40-minute effect interpolation and a directly serialized player-side bridge modifier ID remain unresolved. This authority reconstructs ownership intervals; it does not claim a direct modifier handle.',
  },
  validation: { pass: validationPass, checks },
  nextStage: validationPass
    ? 'CONSUME_RUNTIME_BRIDGE_INTERVALS_IN_EFFECTIVE_PLAYER_STATE_COMPOSITION'
    : 'DIAGNOSE_AUTHORITY_SYNTHESIS_MISMATCH_BEFORE_DOWNSTREAM_CONSUMPTION',
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('BRIDGE RUNTIME INTERVAL AUTHORITY V0.1');
console.log('========================================================');
console.log('');
console.log(`status:                           ${status}`);
console.log(`registry authority:               ${runtimeBridgeClaim.authorityStatus}`);
console.log(`replication:                      ${runtimeBridgeClaim.replicationStatus}`);
console.log(`collection replays:               ${collectionCounts.semanticPassReplays}/${collectionCounts.independentReplays}`);
console.log(`collection events <=300 HU:       ${collectionCounts.trueWithin300Count}/${collectionCounts.trueDistanceRows}`);
console.log(`shifted placebo <=800 HU:         ${collectionCounts.placeboWithin800Count}/${collectionCounts.placeboDistanceRows}`);
console.log(`two-wave exact deck blocks:       ${deck.exactComplementBlocks}/${deck.completeBlocks}`);
console.log(`shared resource duration:         ${durations[0] ?? 'n/a'}s`);
console.log(`Survival natural expirations:     ${directNaturalValidated}/${correctedUncensoredNatural} uncensored`);
console.log(`Survival death terminations:      ${deathNegative}/${deathAnchors}`);
console.log(`match-end censored candidates:    ${matchEndCensored}`);
console.log(`median Survival expiry error:     ${formatSeconds(hp?.medianExpirationTimingErrorSeconds)}`);
console.log('');
console.log('VALIDATION');
console.log('----------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(48)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : null;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(4)}s` : 'n/a';
}
