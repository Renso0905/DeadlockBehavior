import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { getClaim, requireClaim } from '../src/contracts/claim-registry.mjs';

const VERSION = 'INTEGRATED_PLAYER_STATE_AUTHORITY_V01';
const READY_STATUS = 'INTEGRATED_PLAYER_STATE_AUTHORITY_V01_READY';
const VALIDATION_STATUS = 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS';

const VALIDATION_PATH = resolve(
  'output',
  'cross_replay',
  'integrated_authoritative_player_state_cross_replay_validation_v01.json'
);
const OUTPUT_PATH = resolve(
  'output',
  'cross_replay',
  'integrated_player_state_authority_v01.json'
);

if (!existsSync(VALIDATION_PATH)) {
  throw new Error(`Required Script159 artifact missing:\n${VALIDATION_PATH}`);
}

// Script160 runs only AFTER the registry promotion patch has been applied.
const playerStateClaim = requireClaim(
  'player_state_t_v1',
  { requireSemantic: true, requireReplication: true }
);
const effectiveWeaponClaim = getClaim('effective_weapon_state');

// Freeze the current upstream runtime authorities consumed by Script158.
const upstreamClaims = {
  playerIdentity: requireClaim('player_controller_pawn_identity', { requireSemantic: true }),
  standardShopCatalog: requireClaim('standard_shop_catalog_v02', { requireSemantic: true }),
  itemEffects: requireClaim('shop_item_effect_contract', { requireSemantic: true }),
  itemOwnership: requireClaim('runtime_item_ownership', { requireSemantic: true, requireReplication: true }),
  permanentOwnership: requireClaim('runtime_permanent_buff_ownership', { requireSemantic: true, requireReplication: true }),
  bridgeOwnership: requireClaim('runtime_bridge_buff_ownership', { requireSemantic: true, requireReplication: true }),
};

const validation = readJson(VALIDATION_PATH);
const cohort = validation?.cohort ?? {};
const coverage = validation?.coverageDiagnostics ?? {};
const permanentFamilies = Array.isArray(cohort?.permanentFamiliesAcrossCohort)
  ? cohort.permanentFamiliesAcrossCohort
  : [];

const checks = {
  playerStateAuthorityCurrent: check(
    playerStateClaim.authorityStatus,
    'current',
    playerStateClaim.authorityStatus === 'current'
  ),
  playerStateIntegrityPass: check(
    playerStateClaim.integrityValidation,
    'pass',
    playerStateClaim.integrityValidation === 'pass'
  ),
  playerStateSemanticPass: check(
    playerStateClaim.semanticValidation,
    'pass',
    playerStateClaim.semanticValidation === 'pass'
  ),
  playerStateReplicationFrozen: check(
    playerStateClaim.replicationStatus,
    'cross_replay_replicated',
    playerStateClaim.replicationStatus === 'cross_replay_replicated'
  ),
  effectiveWeaponStillMissing: check(
    effectiveWeaponClaim?.authorityStatus,
    'missing',
    effectiveWeaponClaim?.authorityStatus === 'missing'
  ),
  script159StronglyValidated: check(
    validation?.status,
    VALIDATION_STATUS,
    validation?.status === VALIDATION_STATUS
  ),
  script159IntegrityPass: check(
    validation?.integrityValidation?.pass,
    true,
    validation?.integrityValidation?.pass === true
  ),
  script159SemanticPass: check(
    validation?.semanticValidation?.pass,
    true,
    validation?.semanticValidation?.pass === true
  ),
  script159ReplicationCrossReplay: check(
    validation?.replicationStatus,
    'cross_replay_replicated',
    validation?.replicationStatus === 'cross_replay_replicated'
  ),
  independentCohortFive: check(
    cohort?.requestedReplays,
    5,
    cohort?.requestedReplays === 5
  ),
  integrityFiveOfFive: check(
    cohort?.integrityPassReplays,
    5,
    cohort?.integrityPassReplays === 5
  ),
  semanticFiveOfFive: check(
    cohort?.semanticPassReplays,
    5,
    cohort?.semanticPassReplays === 5
  ),
  coverageFiveOfFive: check(
    cohort?.coverageCompleteReplays,
    5,
    cohort?.coverageCompleteReplays === 5 && coverage?.adequateForCrossReplayReplication === true
  ),
  zeroContradictions: check(
    cohort?.totalContradictions,
    0,
    cohort?.totalContradictions === 0
  ),
  playersSixty: check(
    cohort?.totalPlayers,
    60,
    cohort?.totalPlayers === 60
  ),
  timelineEventsExpected: check(
    cohort?.totalTimelineEvents,
    604530,
    cohort?.totalTimelineEvents === 604530
  ),
  itemTransitionsExpected: check(
    cohort?.totalItemTransitions,
    1518,
    cohort?.totalItemTransitions === 1518
  ),
  bridgeIntervalsExpected: check(
    cohort?.totalBridgeIntervals,
    76,
    cohort?.totalBridgeIntervals === 76
  ),
  permanentFamiliesSix: check(
    permanentFamilies.length,
    6,
    permanentFamilies.length === 6
  ),
  upstreamItemOwnershipReplicated: check(
    upstreamClaims.itemOwnership.replicationStatus,
    'cross_replay_replicated',
    upstreamClaims.itemOwnership.replicationStatus === 'cross_replay_replicated'
  ),
  upstreamPermanentOwnershipReplicated: check(
    upstreamClaims.permanentOwnership.replicationStatus,
    'cross_replay_replicated',
    upstreamClaims.permanentOwnership.replicationStatus === 'cross_replay_replicated'
  ),
  upstreamBridgeOwnershipReplicated: check(
    upstreamClaims.bridgeOwnership.replicationStatus,
    'cross_replay_replicated',
    upstreamClaims.bridgeOwnership.replicationStatus === 'cross_replay_replicated'
  ),
};

const validationPass = Object.values(checks).every(row => row.pass);
const status = validationPass
  ? READY_STATUS
  : 'INTEGRATED_PLAYER_STATE_AUTHORITY_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: true,
  createdAt: new Date().toISOString(),
  status,
  claim: {
    claimId: playerStateClaim.claimId,
    authorityStatus: playerStateClaim.authorityStatus,
    integrityValidation: playerStateClaim.integrityValidation,
    semanticValidation: playerStateClaim.semanticValidation,
    replicationStatus: playerStateClaim.replicationStatus,
  },
  foundations: {
    script159Artifact: VALIDATION_PATH,
    script159Status: validation?.status ?? null,
    upstreamClaims: Object.fromEntries(
      Object.entries(upstreamClaims).map(([key, claim]) => [key, {
        claimId: claim.claimId,
        authorityStatus: claim.authorityStatus,
        semanticValidation: claim.semanticValidation,
        replicationStatus: claim.replicationStatus,
      }])
    ),
  },
  frozenEvidence: {
    independentReplicationReplays: cohort?.requestedReplays ?? null,
    integrityPassReplays: cohort?.integrityPassReplays ?? null,
    semanticPassReplays: cohort?.semanticPassReplays ?? null,
    coverageCompleteReplays: cohort?.coverageCompleteReplays ?? null,
    totalContradictions: cohort?.totalContradictions ?? null,
    players: cohort?.totalPlayers ?? null,
    timelineEvents: cohort?.totalTimelineEvents ?? null,
    itemTransitions: cohort?.totalItemTransitions ?? null,
    bridgeIntervals: cohort?.totalBridgeIntervals ?? null,
    permanentFamiliesAcrossCohort: permanentFamilies,
  },
  authoritySemantics: {
    runtimeModel:
      'Event-sourced per-player PlayerState(t): the latest authoritative state event at or before query time, with standard-shop ownership, cumulative permanent world-buff state, and reconstructed active bridge intervals composed as independent runtime layers.',
    resourceInputs:
      'Hero progression, standard-shop item-effect definitions, and world-buff resource definitions are attached as provenance/resource inputs. Their presence in PlayerState(t) does not by itself establish every numeric composition, stacking order, conditional activation rule, or formula.',
    noFutureLeakage:
      'Time-indexed queries consume only events at or before t; Script159 validates deterministic final-state replay and active bridge projection across all saved event boundaries.',
    effectiveWeaponBoundary:
      'This authority does not establish effective_weapon_state. Weapon cadence, ammo/reload, projectile, and damage/power composition remain a separate downstream claim requiring dedicated semantic validation.',
  },
  validation: {
    pass: validationPass,
    checks,
  },
  nextStage: validationPass
    ? 'BUILD_AND_VALIDATE_EFFECTIVE_WEAPON_STATE_ON_TOP_OF_CURRENT_PLAYER_STATE_T_V1_AUTHORITY'
    : 'DIAGNOSE_ONLY_FAILED_AUTHORITY_FREEZE_CHECKS',
  output: OUTPUT_PATH,
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('INTEGRATED PLAYER-STATE AUTHORITY V0.1');
console.log('========================================================');
console.log('');
console.log(`status:                           ${status}`);
console.log(`registry authority:               ${playerStateClaim.authorityStatus}`);
console.log(`semantic:                         ${playerStateClaim.semanticValidation}`);
console.log(`replication:                      ${playerStateClaim.replicationStatus}`);
console.log(`independent replays:              ${cohort?.requestedReplays ?? 'n/a'}`);
console.log(`integrity pass replays:           ${cohort?.integrityPassReplays ?? 'n/a'}`);
console.log(`semantic pass replays:            ${cohort?.semanticPassReplays ?? 'n/a'}`);
console.log(`coverage complete replays:        ${cohort?.coverageCompleteReplays ?? 'n/a'}`);
console.log(`contradictions:                   ${cohort?.totalContradictions ?? 'n/a'}`);
console.log(`players:                          ${cohort?.totalPlayers ?? 'n/a'}`);
console.log(`timeline events:                  ${cohort?.totalTimelineEvents ?? 'n/a'}`);
console.log(`item transitions:                 ${cohort?.totalItemTransitions ?? 'n/a'}`);
console.log(`bridge intervals:                 ${cohort?.totalBridgeIntervals ?? 'n/a'}`);
console.log(`permanent families:               ${permanentFamilies.length}/6`);
console.log(`effective weapon authority:       ${effectiveWeaponClaim?.authorityStatus ?? 'unknown'}`);
console.log('');
console.log('VALIDATION');
console.log('----------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(46)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

if (!validationPass) process.exitCode = 1;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}
