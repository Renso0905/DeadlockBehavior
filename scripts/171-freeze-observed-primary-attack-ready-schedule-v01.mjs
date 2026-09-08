import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';

import { getClaim, loadClaimRegistry } from '../src/contracts/claim-registry.mjs';
import {
  CADENCE_ALIGNMENT_V02_THRESHOLDS,
  buildCadenceV02Summary,
  classifyCadenceAlignmentV02,
  summarizeHeroStaticV02,
} from '../src/player-state/cadence-alignment-v02.mjs';

const VERSION = 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_AUTHORITY_CANDIDATE_V01';
const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayName = basename(resolve(replayArgument), extname(replayArgument));

const PATHS = {
  script170: resolve('output', replayName, 'actual_discharge_spacing_vs_static_cadence_diagnostic_v01.json'),
  output: resolve('output', replayName, 'observed_primary_attack_ready_schedule_candidate_v01.json'),
};

if (!existsSync(PATHS.script170)) throw new Error(`Required input missing:\n${PATHS.script170}`);
const script170 = JSON.parse(readFileSync(PATHS.script170, 'utf8'));
if (script170?.status !== 'ACTUAL_DISCHARGE_SPACING_VS_STATIC_CADENCE_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION') {
  throw new Error(`Script170 not ready. Status=${script170?.status}`);
}

const registry = loadClaimRegistry();
const effectiveWeaponClaim = getClaim('effective_weapon_state', registry);
const playerStateClaim = getClaim('player_state_t_v1', registry);

const cadence = buildCadenceV02Summary(script170);
const classification = classifyCadenceAlignmentV02(cadence);

const heroRows = (script170.byHero ?? []).map(row => ({
  heroId: row.heroId,
  displayName: row.displayName ?? null,
  regime: row.regime ?? null,
  sustainedPairs: row.sustainedPairs ?? 0,
  observedReady: findCandidate(row?.sustainedCandidateSummary, 'CURRENT_READY_DELAY'),
  staticV02: summarizeHeroStaticV02(row),
}));

const heroOutliers = heroRows.filter(row =>
  row.staticV02.comparable >= CADENCE_ALIGNMENT_V02_THRESHOLDS.minimumRegimePairs
  && Number.isFinite(row.staticV02.alignmentRate)
  && row.staticV02.alignmentRate < CADENCE_ALIGNMENT_V02_THRESHOLDS.perRegimeStaticAlignmentRate
);

const observed = cadence.observedRuntimeCarrier;
const staticModel = cadence.staticExplanatoryModelV02;

const checks = {
  script170ExpectedClassification: check(
    script170?.diagnosticClassification,
    'ACTUAL_BURST_SPACING_SUPPORTS_CYCLE_PLUS_INTRA_RUNTIME_BOUNDARY_SCHEDULE',
    script170?.diagnosticClassification === 'ACTUAL_BURST_SPACING_SUPPORTS_CYCLE_PLUS_INTRA_RUNTIME_BOUNDARY_SCHEDULE',
  ),
  playerStateAuthorityCurrent: check(playerStateClaim?.authorityStatus, 'current', playerStateClaim?.authorityStatus === 'current'),
  playerStateReplicated: check(playerStateClaim?.replicationStatus, 'cross_replay_replicated', playerStateClaim?.replicationStatus === 'cross_replay_replicated'),
  effectiveWeaponStillMissing: check(effectiveWeaponClaim?.authorityStatus, 'missing', effectiveWeaponClaim?.authorityStatus === 'missing'),
  sustainedPairsExpected: check(script170?.counts?.sustainedPairs, 4568, script170?.counts?.sustainedPairs === 4568),
  boundaryPairsExpected: check(script170?.counts?.burstBoundarySustainedPairs, 603, script170?.counts?.burstBoundarySustainedPairs === 603),
  positiveBurstPairsExpected: check(script170?.counts?.burstPositiveSustainedPairs, 1725, script170?.counts?.burstPositiveSustainedPairs === 1725),
  nonBurstPairsExpected: check(script170?.counts?.nonBurstSustainedPairs, 2240, script170?.counts?.nonBurstSustainedPairs === 2240),
  observedReadyAllSustainedStrong: checkRate(observed?.aggregate, '>=95%', observed?.aggregate?.alignmentRate >= 0.95),
  observedBoundaryReadyStrong: checkRate(observed?.burstBoundary, '>=95%', observed?.burstBoundary?.alignmentRate >= 0.95),
  observedPositiveReadyStrong: checkRate(observed?.burstPositive, '>=95%', observed?.burstPositive?.alignmentRate >= 0.95),
  observedNonBurstReadyStrong: checkRate(observed?.nonBurst, '>=95%', observed?.nonBurst?.alignmentRate >= 0.95),
  lastAttackMatchesReplaySpacing: checkRate(observed?.lastAttackDeltaVsReplaySpacing, '>=90%', observed?.lastAttackDeltaVsReplaySpacing?.alignmentRate >= 0.90),
  nextPrimarySchedulesNextLastAttack: checkRate(observed?.nextLastAttackVsCurrentNextPrimary, '>=90%', observed?.nextLastAttackVsCurrentNextPrimary?.alignmentRate >= 0.90),
  staticV02AggregateMeetsFrozenGate: checkRate(staticModel?.aggregate, '>=95%', staticModel?.aggregate?.alignmentRate >= 0.95),
  staticV02BoundaryMeetsFrozenRegimeGate: checkRate(staticModel?.burstBoundary?.summary, '>=90%', staticModel?.burstBoundary?.summary?.alignmentRate >= 0.90),
  staticV02PositiveMeetsFrozenRegimeGate: checkRate(staticModel?.burstPositive?.summary, '>=90%', staticModel?.burstPositive?.summary?.alignmentRate >= 0.90),
  staticV02NonBurstMeetsFrozenRegimeGate: checkRate(staticModel?.nonBurst?.summary, '>=90%', staticModel?.nonBurst?.summary?.alignmentRate >= 0.90),
  crossReplayPromotionNotClaimed: check('SINGLE_REPLAY', 'SINGLE_REPLAY', true),
};

const integrityPass = Object.values(checks).every(row => row.pass);
const status = integrityPass && classification === 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_READY_FOR_CROSS_REPLAY_VALIDATION'
  ? 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_READY_FOR_CROSS_REPLAY_VALIDATION'
  : 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  replay: replayName,
  inputs: PATHS,
  design: {
    purpose: 'Freeze the single-replay semantic distinction established by Script170: nextPrimaryAttack-lastAttackTime is the observed runtime primary-attack readiness carrier; static cycle fields are explanatory resource inputs rather than the runtime authority.',
    observedCarrier: 'm_flNextPrimaryAttack - m_flLastAttackTime at observed discharge events',
    observedValidationChain: [
      'current ready delay predicts next actual discharge spacing under sustained fire',
      'next lastAttackTime agrees with replay-tick discharge spacing',
      'next lastAttackTime agrees with current nextPrimaryAttack at burst boundaries',
    ],
    staticModelV02: {
      burstPositive: 'm_flIntraBurstCycleTime',
      burstBoundary: 'm_flCycleTime + m_flIntraBurstCycleTime (empirical explanatory candidate supported by actual spacing; not promoted as universal formula)',
      nonBurst: 'm_flCycleTime',
      spinUp: 'excluded from fixed-cycle model',
    },
    frozenThresholds: CADENCE_ALIGNMENT_V02_THRESHOLDS,
    authorityPromotion: 'NONE — requires independent replay replication first',
    effectiveWeaponStatePromotion: 'NONE',
  },
  observedRuntimeCarrier: observed,
  staticExplanatoryModelV02: staticModel,
  byHero: heroRows,
  staticModelHeroOutliers: heroOutliers,
  diagnosticClassification: classification,
  validation: {
    integrityPass,
    semanticValidation: status === 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_READY_FOR_CROSS_REPLAY_VALIDATION'
      ? 'SINGLE_REPLAY_STRONG_SEMANTIC_CANDIDATE'
      : 'REQUIRES_DIAGNOSIS',
    replicationStatus: 'SINGLE_REPLAY_DISCOVERY',
    checks,
  },
  interpretation: {
    observedAuthorityBoundary: 'The runtime schedule carrier is directly observed and behaviorally validated against the next actual discharge. This does not yet make it cross-replay authority.',
    staticBoundary: 'Static cycle fields explain the sustained cadence structure well in aggregate under the V02 mapping, but remain resource-level explanatory inputs. Apollo remains an explicit hero-level static-model outlier rather than being silently fit away.',
    fireRateBoundary: 'No Fire Rate stacking/composition formula is established by this artifact. The next stage is cross-replay replication of the observed runtime carrier before returning to effect-composition tests.',
  },
  nextStage: 'CROSS_REPLAY_REPLICATE_OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_ACROSS_REP01_TO_REP05_THEN_CONSIDER_CADENCE_CARRIER_PROMOTION',
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('OBSERVED PRIMARY-ATTACK READY SCHEDULE V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                              ${replayName}`);
console.log('Observed carrier:                    nextPrimaryAttack - lastAttackTime');
console.log('Static cadence role:                 explanatory input, not runtime authority');
console.log('Thresholds retuned:                  NO');
console.log('Cross-replay promotion:              NO');
console.log('');
console.log('OBSERVED RUNTIME CARRIER');
console.log('------------------------');
printAlignment('all sustained', observed.aggregate);
printAlignment('burst boundary', observed.burstBoundary);
printAlignment('burst positive', observed.burstPositive);
printAlignment('non-burst', observed.nonBurst);
printAlignment('lastAttack delta vs replay spacing', observed.lastAttackDeltaVsReplaySpacing);
printAlignment('next lastAttack vs current nextPrimary', observed.nextLastAttackVsCurrentNextPrimary);
console.log('');
console.log('STATIC EXPLANATORY MODEL V02');
console.log('----------------------------');
printAlignment('aggregate', staticModel.aggregate);
printAlignment('burst boundary: cycle + intra', staticModel.burstBoundary.summary);
printAlignment('burst positive: intra', staticModel.burstPositive.summary);
printAlignment('non-burst: cycle', staticModel.nonBurst.summary);
console.log('');
console.log('HERO STATIC-MODEL OUTLIERS (<90%, n>=100)');
console.log('------------------------------------------');
if (heroOutliers.length === 0) console.log('none');
for (const row of heroOutliers) {
  console.log(`hero=${String(row.heroId).padEnd(4)} ${String(row.displayName ?? '').padEnd(18)} n=${String(row.staticV02.comparable).padEnd(6)} static=${percent(row.staticV02.alignmentRate)} ready=${percent(row.observedReady?.alignmentRate)}`);
}
console.log('');
console.log('INTEGRITY / SEMANTIC FREEZE');
console.log('---------------------------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(44)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log('CLASSIFICATION');
console.log('--------------');
console.log(classification);
console.log('');
console.log(`status: ${status}`);
console.log(`NEXT STAGE: ${output.nextStage}`);
console.log('');
console.log(`JSON:\n${PATHS.output}`);
console.log('');

function findCandidate(rows, kind) {
  return (rows ?? []).find(row => row?.kind === kind) ?? null;
}
function printAlignment(label, row) {
  console.log(`${label.padEnd(40)} ${String(row?.aligned ?? 0).padStart(5)}/${String(row?.comparable ?? 0).padEnd(5)} (${percent(row?.alignmentRate)})`);
}
function check(actual, expected, pass) { return { actual, expected, pass: Boolean(pass) }; }
function checkRate(row, expected, pass) {
  return check({ aligned: row?.aligned ?? null, comparable: row?.comparable ?? null, rate: row?.alignmentRate ?? null }, expected, pass);
}
function percent(value) { return Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : 'n/a'; }
