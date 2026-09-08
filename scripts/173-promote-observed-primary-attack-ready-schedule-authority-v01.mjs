import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  getClaim,
  loadClaimRegistry,
  requireClaim,
} from '../src/contracts/claim-registry.mjs';

const VERSION = 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_AUTHORITY_V01';
const CLAIM_ID = 'runtime_primary_attack_ready_schedule';

const PATHS = {
  registry: resolve('contracts', 'claim_registry_v03.json'),
  script172: resolve(
    'output',
    'cross_replay',
    'observed_primary_attack_ready_schedule_cross_replay_validation_v01.json',
  ),
  authority: resolve(
    'output',
    'cross_replay',
    'observed_primary_attack_ready_schedule_authority_v01.json',
  ),
};

for (const path of [PATHS.registry, PATHS.script172]) {
  if (!existsSync(path)) {
    throw new Error(`Required input missing:\n${path}`);
  }
}

const registry = loadClaimRegistry(PATHS.registry);
const replication = readJson(PATHS.script172);

const playerStateClaim = getClaim('player_state_t_v1', registry);
const effectiveWeaponClaim = getClaim('effective_weapon_state', registry);

const EXPECTED_REPLAYS = ['rep01', 'rep02', 'rep03', 'rep04', 'rep05'];
const EXPECTED_STATUS =
  'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS';

const cross = replication?.crossReplayReplication ?? {};
const pooledObserved = cross?.pooled?.observed ?? {};
const pooledStatic = cross?.pooled?.staticModelV02 ?? {};

const checks = {
  script172StatusStrong: check(
    replication?.status,
    EXPECTED_STATUS,
    replication?.status === EXPECTED_STATUS,
  ),

  script172IntegrityPass: check(
    replication?.validation?.integrityValidation,
    'pass',
    replication?.validation?.integrityValidation === 'pass',
  ),

  script172SemanticPass: check(
    replication?.validation?.semanticValidation,
    'pass',
    replication?.validation?.semanticValidation === 'pass',
  ),

  script172CrossReplayReplicated: check(
    replication?.validation?.replicationStatus,
    'cross_replay_replicated',
    replication?.validation?.replicationStatus === 'cross_replay_replicated',
  ),

  exactIndependentCohort: check(
    replication?.cohort?.independentReplays,
    EXPECTED_REPLAYS,
    deepEqual(replication?.cohort?.independentReplays, EXPECTED_REPLAYS),
  ),

  discoveryReplayExcluded: check(
    replication?.cohort?.discoveryReplayExcluded,
    true,
    replication?.cohort?.discoveryReplayExcluded === true
      && replication?.cohort?.discoveryReplay === 'test',
  ),

  fiveReplayPrimaryPass: check(
    cross?.perReplay?.filter(row => row?.pass === true)?.length ?? 0,
    5,
    Array.isArray(cross?.perReplay)
      && cross.perReplay.length === 5
      && cross.perReplay.every(row => row?.pass === true),
  ),

  strongReplicationClassification: check(
    cross?.classification,
    EXPECTED_STATUS,
    cross?.classification === EXPECTED_STATUS
      && cross?.strongReplication === true,
  ),

  pooledObservedCountsFrozen: check(
    summarize(pooledObserved?.aggregate),
    { aligned: 27459, comparable: 27465 },
    pooledObserved?.aggregate?.aligned === 27459
      && pooledObserved?.aggregate?.comparable === 27465,
  ),

  burstBoundaryCountsFrozen: check(
    summarize(pooledObserved?.burstBoundary),
    { aligned: 1463, comparable: 1463 },
    pooledObserved?.burstBoundary?.aligned === 1463
      && pooledObserved?.burstBoundary?.comparable === 1463,
  ),

  burstPositiveCountsFrozen: check(
    summarize(pooledObserved?.burstPositive),
    { aligned: 5043, comparable: 5043 },
    pooledObserved?.burstPositive?.aligned === 5043
      && pooledObserved?.burstPositive?.comparable === 5043,
  ),

  nonBurstCountsFrozen: check(
    summarize(pooledObserved?.nonBurst),
    { aligned: 20953, comparable: 20959 },
    pooledObserved?.nonBurst?.aligned === 20953
      && pooledObserved?.nonBurst?.comparable === 20959,
  ),

  boundaryReplaySpacingCrossCheckFrozen: check(
    summarize(pooledObserved?.lastAttackDeltaVsReplaySpacing),
    { aligned: 1463, comparable: 1463 },
    pooledObserved?.lastAttackDeltaVsReplaySpacing?.aligned === 1463
      && pooledObserved?.lastAttackDeltaVsReplaySpacing?.comparable === 1463,
  ),

  boundaryNextPrimaryCrossCheckFrozen: check(
    summarize(pooledObserved?.nextLastAttackVsCurrentNextPrimary),
    { aligned: 1463, comparable: 1463 },
    pooledObserved?.nextLastAttackVsCurrentNextPrimary?.aligned === 1463
      && pooledObserved?.nextLastAttackVsCurrentNextPrimary?.comparable === 1463,
  ),

  pooledObservedRateMeetsFrozenGate: check(
    pooledObserved?.aggregate?.alignmentRate ?? null,
    '>=0.95',
    Number.isFinite(pooledObserved?.aggregate?.alignmentRate)
      && pooledObserved.aggregate.alignmentRate >= 0.95,
  ),

  playerStateAuthorityCurrentReplicated: check(
    `${playerStateClaim?.authorityStatus}/${playerStateClaim?.semanticValidation}/${playerStateClaim?.replicationStatus}`,
    'current/pass/cross_replay_replicated',
    playerStateClaim?.authorityStatus === 'current'
      && playerStateClaim?.semanticValidation === 'pass'
      && playerStateClaim?.replicationStatus === 'cross_replay_replicated',
  ),

  effectiveWeaponStillMissingBeforePromotion: check(
    effectiveWeaponClaim?.authorityStatus,
    'missing',
    effectiveWeaponClaim?.authorityStatus === 'missing',
  ),
};

const integrityPass = Object.values(checks).every(row => row.pass);
if (!integrityPass) {
  printHeader();
  printChecks(checks);
  throw new Error(
    'Script173 promotion guards failed. Registry was NOT modified.',
  );
}

const authority = {
  version: VERSION,
  canonical: true,
  createdAt: new Date().toISOString(),
  status: 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_AUTHORITY_V01_READY',
  claimId: CLAIM_ID,

  authorityBoundary: {
    construct:
      'Observed primary-attack next-discharge readiness schedule carried by m_flNextPrimaryAttack - m_flLastAttackTime.',
    scope:
      'Sustained consecutive primary-weapon discharge pairs on the same player, weapon entity, effect context, and active fire mode under the frozen Script172 fixed-regime strict-baseline semantics.',
    excluded: [
      'full effective_weapon_state composition',
      'magazine capacity semantics',
      'spin-up dynamic cadence authority',
      'projectile travel authority',
      'damage composition',
      'conditional/non-direct item activation semantics',
      'static cycle/intra-burst formulas as runtime authority',
    ],
    observedCarrier:
      'm_flNextPrimaryAttack - m_flLastAttackTime at an observed discharge event',
    observedMeaning:
      'Runtime schedule for the next sustained primary-weapon discharge within the validated pair scope.',
    staticCadenceRole:
      'Build-bound explanatory diagnostic only. Static V02 does not define the promoted runtime carrier.',
  },

  evidence: {
    discoveryReplay: 'test',
    independentReplicationReplays: EXPECTED_REPLAYS,
    independentReplayCount: 5,
    sourceScripts: [
      '161-build-effective-weapon-state-substrate-v01',
      '170-diagnose-actual-discharge-spacing-vs-static-cadence-v01',
      '171-freeze-observed-primary-attack-ready-schedule-v01',
      '172-validate-observed-primary-attack-ready-schedule-cross-replay-v01',
      '173-promote-observed-primary-attack-ready-schedule-authority-v01',
    ],
    replicationArtifact:
      'output/cross_replay/observed_primary_attack_ready_schedule_cross_replay_validation_v01.json',

    observedRuntimeCarrier: {
      aggregate: pooledObserved.aggregate,
      burstBoundary: pooledObserved.burstBoundary,
      burstPositive: pooledObserved.burstPositive,
      nonBurst: pooledObserved.nonBurst,
      lastAttackDeltaVsReplaySpacing:
        pooledObserved.lastAttackDeltaVsReplaySpacing,
      nextLastAttackVsCurrentNextPrimary:
        pooledObserved.nextLastAttackVsCurrentNextPrimary,
    },

    staticExplanatoryModelV02DiagnosticOnly: {
      aggregate: pooledStatic.aggregate,
      burstBoundary: pooledStatic.burstBoundary,
      burstPositive: pooledStatic.burstPositive,
      nonBurst: pooledStatic.nonBurst,
      note:
        'Pooled static explanatory fit is not a semantic gate for the observed runtime schedule authority.',
    },

    perReplayPrimary: cross.perReplay,
  },

  validation: {
    integrityValidation: 'pass',
    semanticValidation: 'pass',
    replicationStatus: 'cross_replay_replicated',
    promotionChecks: checks,
  },

  interpretation: {
    primaryConclusion:
      'The observed nextPrimaryAttack-lastAttackTime schedule strongly predicts the next sustained primary-weapon discharge across the frozen five-replay independent cohort.',
    staticModelConclusion:
      'Static cycle/intra-burst fields remain useful explanatory inputs but are not promoted as the runtime cadence authority because pooled static fit is materially weaker and hero/replay-specific outliers remain.',
    effectiveWeaponBoundary:
      'This authority resolves one dedicated readiness/cadence subclaim only. effective_weapon_state remains missing.',
  },
};

const claim = {
  claimId: CLAIM_ID,
  domain: 'player_state_runtime',
  construct:
    'Observed runtime primary-attack readiness/cadence schedule for the next sustained discharge',
  authorityStatus: 'current',
  integrityValidation: 'pass',
  semanticValidation: 'pass',
  replicationStatus: 'cross_replay_replicated',
  scope:
    'Within sustained consecutive primary-weapon discharge pairs on the same player, weapon entity, effect context, and active fire mode under the frozen Script172 fixed-regime strict-baseline semantics, m_flNextPrimaryAttack - m_flLastAttackTime is authoritative as the observed schedule for the next discharge. This does not promote static cadence formulas, spin-up cadence, ammo capacity, projectile state, damage composition, or the broader effective_weapon_state.',
  sourceScripts: authority.evidence.sourceScripts,
  currentArtifacts: [
    'output/cross_replay/observed_primary_attack_ready_schedule_cross_replay_validation_v01.json',
    'output/cross_replay/observed_primary_attack_ready_schedule_authority_v01.json',
  ],
  downstreamUses: [
    'primary-weapon action readiness',
    'cadence-aware attempt timing',
    'cadence-aware opportunity timing',
    'future effective weapon state composition',
  ],
  valueSummary: {
    independentReplicationReplays: 5,
    semanticStrongReplays: 5,
    pooledSustainedPairs: pooledObserved.aggregate.comparable,
    pooledObservedReadyAligned: pooledObserved.aggregate.aligned,
    pooledObservedReadyAlignmentRate:
      pooledObserved.aggregate.alignmentRate,

    burstBoundaryPairs: pooledObserved.burstBoundary.comparable,
    burstBoundaryReadyAlignmentRate:
      pooledObserved.burstBoundary.alignmentRate,

    burstPositivePairs: pooledObserved.burstPositive.comparable,
    burstPositiveReadyAlignmentRate:
      pooledObserved.burstPositive.alignmentRate,

    nonBurstPairs: pooledObserved.nonBurst.comparable,
    nonBurstReadyAlignmentRate:
      pooledObserved.nonBurst.alignmentRate,

    boundaryLastAttackReplaySpacingAlignmentRate:
      pooledObserved.lastAttackDeltaVsReplaySpacing.alignmentRate,

    boundaryNextLastAttackVsCurrentNextPrimaryAlignmentRate:
      pooledObserved.nextLastAttackVsCurrentNextPrimary.alignmentRate,

    staticExplanatoryModelV02PooledAlignmentRate:
      pooledStatic?.aggregate?.alignmentRate ?? null,
  },
  supersedes: [],
  supersededBy: null,
  notes:
    'Observed runtime schedule authority only. Static cadence V02 is explanatory and materially weaker pooled; rep04/non-burst static mismatch does not contradict the directly observed schedule. Keep effective_weapon_state missing until its remaining dimensions are independently validated.',
};

const existingIndex = registry.claims.findIndex(row => row?.claimId === CLAIM_ID);

if (existingIndex >= 0) {
  const existing = registry.claims[existingIndex];

  for (const key of [
    'authorityStatus',
    'integrityValidation',
    'semanticValidation',
    'replicationStatus',
  ]) {
    if (existing?.[key] !== claim[key]) {
      throw new Error(
        `Refusing to overwrite existing ${CLAIM_ID}: ${key}=${existing?.[key]} expected=${claim[key]}`,
      );
    }
  }

  registry.claims[existingIndex] = claim;
} else {
  const effectiveIndex = registry.claims.findIndex(
    row => row?.claimId === 'effective_weapon_state',
  );

  if (effectiveIndex >= 0) {
    registry.claims.splice(effectiveIndex, 0, claim);
  } else {
    registry.claims.push(claim);
  }
}

const effectiveAfter = getClaim('effective_weapon_state', registry);
if (effectiveAfter?.authorityStatus !== 'missing') {
  throw new Error(
    `Refusing registry write: effective_weapon_state must remain missing, got ${effectiveAfter?.authorityStatus}`,
  );
}

mkdirSync(dirname(PATHS.authority), { recursive: true });
writeFileSync(
  PATHS.authority,
  `${JSON.stringify(authority, null, 2)}\n`,
  'utf8',
);

writeFileSync(
  PATHS.registry,
  `${JSON.stringify(registry, null, 2)}\n`,
  'utf8',
);

const promotedRegistry = loadClaimRegistry(PATHS.registry);
const promoted = requireClaim(
  CLAIM_ID,
  { requireSemantic: true, requireReplication: true },
  promotedRegistry,
);
const effectiveFinal = getClaim('effective_weapon_state', promotedRegistry);

printHeader();

console.log('status:                           OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_AUTHORITY_V01_READY');
console.log(`registry claim:                   ${promoted.claimId}`);
console.log(`registry authority:               ${promoted.authorityStatus}`);
console.log(`integrity:                        ${promoted.integrityValidation}`);
console.log(`semantic:                         ${promoted.semanticValidation}`);
console.log(`replication:                      ${promoted.replicationStatus}`);
console.log(`independent replays:              ${promoted.valueSummary.independentReplicationReplays}`);
console.log(
  `pooled sustained pairs:           ${promoted.valueSummary.pooledObservedReadyAligned}/${promoted.valueSummary.pooledSustainedPairs} (${formatPercent(promoted.valueSummary.pooledObservedReadyAlignmentRate)})`,
);
console.log(
  `burst boundary schedule:          ${pooledObserved.burstBoundary.aligned}/${pooledObserved.burstBoundary.comparable} (${formatPercent(pooledObserved.burstBoundary.alignmentRate)})`,
);
console.log(
  `burst positive schedule:          ${pooledObserved.burstPositive.aligned}/${pooledObserved.burstPositive.comparable} (${formatPercent(pooledObserved.burstPositive.alignmentRate)})`,
);
console.log(
  `non-burst schedule:               ${pooledObserved.nonBurst.aligned}/${pooledObserved.nonBurst.comparable} (${formatPercent(pooledObserved.nonBurst.alignmentRate)})`,
);
console.log(
  `static V02 diagnostic only:       ${pooledStatic.aggregate.aligned}/${pooledStatic.aggregate.comparable} (${formatPercent(pooledStatic.aggregate.alignmentRate)})`,
);
console.log(`effective_weapon_state:            ${effectiveFinal.authorityStatus}`);
console.log('');

console.log('PROMOTION VALIDATION');
console.log('--------------------');
printChecks(checks);

console.log('');
console.log(`Authority JSON:\n${PATHS.authority}`);
console.log('');
console.log(`Registry:\n${PATHS.registry}`);
console.log('');
console.log(
  'NEXT STAGE: KEEP_EFFECTIVE_WEAPON_STATE_MISSING_AND_MOVE_TO_THE_NEXT_UNRESOLVED_WEAPON_DIMENSION',
);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function summarize(row) {
  return {
    aligned: row?.aligned ?? null,
    comparable: row?.comparable ?? null,
  };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function printHeader() {
  console.log('');
  console.log('========================================================');
  console.log('OBSERVED PRIMARY-ATTACK READY SCHEDULE AUTHORITY V0.1');
  console.log('========================================================');
  console.log('');
}

function printChecks(rows) {
  for (const [name, row] of Object.entries(rows)) {
    console.log(
      `${name.padEnd(48)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
    );
  }
}

function formatPercent(rate) {
  return Number.isFinite(rate)
    ? `${(rate * 100).toFixed(2)}%`
    : 'n/a';
}
