import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';

import { getClaim, loadClaimRegistry } from '../src/contracts/claim-registry.mjs';
import { extractFireRateContext } from '../src/player-state/effective-weapon-fire-rate-context.mjs';
import {
  isCleanExplicitFireRateBaseline,
  selectDominantActiveFireMode,
} from '../src/player-state/static-cadence-alignment.mjs';
import {
  buildObservedDischargePair,
  summarizeCandidateRows,
  summarizeTimingFieldChecks,
} from '../src/player-state/actual-discharge-spacing.mjs';
import { findCandidate } from '../src/player-state/cadence-alignment-v02.mjs';
import {
  READY_SCHEDULE_REPLICATION_THRESHOLDS,
  summarizeReadyScheduleReplication,
  weightedAlignment,
} from '../src/player-state/ready-schedule-replication.mjs';

const VERSION = 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_CROSS_REPLAY_VALIDATION_V01';
const TICKS_PER_SECOND = 64;
const REPLAY_NAMES = ['rep01', 'rep02', 'rep03', 'rep04', 'rep05'];
const forceRefresh = process.argv.includes('--refresh');

const PATHS = {
  script161: resolve('scripts', '161-build-effective-weapon-state-substrate-v01.mjs'),
  script165: resolve('output', 'cross_replay', 'primary_weapon_static_cadence_substrate_v02.json'),
  script171Test: resolve('output', 'test', 'observed_primary_attack_ready_schedule_candidate_v01.json'),
  output: resolve('output', 'cross_replay', 'observed_primary_attack_ready_schedule_cross_replay_validation_v01.json'),
};

for (const path of [PATHS.script161, PATHS.script165, PATHS.script171Test]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const script165 = readJson(PATHS.script165);
const script171Test = readJson(PATHS.script171Test);
if (script165?.status !== 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V02_READY_FOR_INTERPRETATION') {
  throw new Error(`Script165 V02 not ready. Status=${script165?.status}`);
}
if (script171Test?.status !== 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_READY_FOR_CROSS_REPLAY_VALIDATION') {
  throw new Error(`Script171 test candidate not ready. Status=${script171Test?.status}`);
}

const registry = loadClaimRegistry();
const playerStateClaim = getClaim('player_state_t_v1', registry);
const effectiveWeaponClaim = getClaim('effective_weapon_state', registry);

console.log('');
console.log('========================================================');
console.log('OBSERVED PRIMARY-ATTACK READY SCHEDULE CROSS-REPLAY V0.1');
console.log('========================================================');
console.log('');
console.log(`Independent cohort:                 ${REPLAY_NAMES.join(', ')}`);
console.log('Discovery replay included:          NO');
console.log('Observed carrier:                    nextPrimaryAttack - lastAttackTime');
console.log('Primary replication gate:           observed next-discharge schedule');
console.log('Static cadence model:                SECONDARY DIAGNOSTIC ONLY');
console.log(`Script161 refresh forced:            ${forceRefresh ? 'YES' : 'NO'}`);
console.log('Registry mutation:                   NONE');
console.log('');

const weaponByHeroId = new Map((script165.heroes ?? []).map(row => [Number(row.heroId), row]));
const replayResults = [];
const provenance = [];

for (const replayName of REPLAY_NAMES) {
  const replayPath = resolve('replays', `${replayName}.dem`);
  const summaryPath = resolve('output', replayName, 'effective_weapon_state_substrate_v01.json');
  const eventsPath = resolve('output', replayName, 'effective_weapon_runtime_events_v01.jsonl');

  if (!existsSync(replayPath)) throw new Error(`Frozen replication replay missing:\n${replayPath}`);

  const reusable = !forceRefresh && isReusableScript161(summaryPath, eventsPath);
  if (!reusable) {
    console.log(`[${replayName}] generating Script161 observed weapon stream...`);
    const run = spawnSync(process.execPath, [PATHS.script161, replayPath], {
      stdio: 'inherit',
      windowsHide: true,
    });
    if (run.status !== 0) {
      throw new Error(`Script161 failed for ${replayName}. Exit=${run.status}`);
    }
  } else {
    console.log(`[${replayName}] reusing ready Script161 observed weapon stream.`);
  }

  const script161 = readJson(summaryPath);
  if (script161?.status !== 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION') {
    throw new Error(`Script161 not ready for ${replayName}. Status=${script161?.status}`);
  }

  const result = await evaluateReplay({
    replayName,
    script161,
    eventsPath,
    weaponByHeroId,
  });
  replayResults.push(result);
  provenance.push({
    replay: replayName,
    replayPath,
    script161SummaryPath: summaryPath,
    script161EventsPath: eventsPath,
    script161Execution: reusable ? 'REUSED_READY_ARTIFACT' : 'GENERATED_THIS_RUN',
  });
}

const replication = summarizeReadyScheduleReplication(replayResults);

const playerStateAuthorityPass = (
  playerStateClaim?.authorityStatus === 'current'
  && playerStateClaim?.replicationStatus === 'cross_replay_replicated'
);
const effectiveWeaponStillMissing = effectiveWeaponClaim?.authorityStatus === 'missing';
const independentReplayNamesExact = (
  replayResults.length === REPLAY_NAMES.length
  && replayResults.every((row, index) => row.replay === REPLAY_NAMES[index])
);
const allReplayIntegrityPass = replayResults.every(row => row.integrityPass === true);

const integrityChecks = {
  script165V02Ready: check(script165?.status, 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V02_READY_FOR_INTERPRETATION', true),
  script171DiscoveryCandidateReady: check(script171Test?.status, 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_READY_FOR_CROSS_REPLAY_VALIDATION', true),
  playerStateAuthorityCurrentReplicated: check(
    `${playerStateClaim?.authorityStatus}/${playerStateClaim?.replicationStatus}`,
    'current/cross_replay_replicated',
    playerStateAuthorityPass,
  ),
  effectiveWeaponClaimStillMissing: check(effectiveWeaponClaim?.authorityStatus, 'missing', effectiveWeaponStillMissing),
  frozenIndependentReplayNamesExact: check(replayResults.map(row => row.replay), REPLAY_NAMES, independentReplayNamesExact),
  allReplaySubstratesIntegrityPass: check(
    replayResults.filter(row => row.integrityPass).length,
    REPLAY_NAMES.length,
    allReplayIntegrityPass,
  ),
  noDiscoveryReplayInReplicationCohort: check(replayResults.some(row => row.replay === 'test'), false, !replayResults.some(row => row.replay === 'test')),
};

const integrityPass = Object.values(integrityChecks).every(row => row.pass);
const semanticPass = integrityPass && replication.strongReplication;
const status = semanticPass
  ? 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS'
  : 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_CROSS_REPLAY_REPLICATION_REQUIRES_DIAGNOSIS';

const staticOutliers = buildCrossReplayHeroOutliers(replayResults);

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  cohort: {
    discoveryReplay: 'test',
    discoveryReplayExcluded: true,
    independentReplays: REPLAY_NAMES,
    independentReplayCount: REPLAY_NAMES.length,
  },
  provenance,
  design: {
    frozenFrom: 'Script171 V01 single-replay candidate',
    observedCarrier: 'm_flNextPrimaryAttack - m_flLastAttackTime at observed discharge events',
    pairSemantics: 'next actual discharge on same player, weapon entity, effect context, and active fire mode',
    sustainedCriterion: 'same Script167-compatible criterion used by Script170: next discharge <= readyDelay*64 + 2 ticks',
    primaryScope: 'fixed-regime primary weapons under the frozen Script170 strict baseline; spin-up remains outside the validated fixed-regime scope',
    strictBaseline: [
      'observed discharge with finite ready-delay candidate',
      'Script161 effect context resolves',
      'no explicit Fire Rate item/permanent/Gun bridge input',
      'no Script165 hero-special EFireRate scaling',
      'dominant observed active fire mode for that hero in the replay',
    ],
    primaryReplicationTarget: 'observed runtime carrier predicting actual next discharge',
    staticModelV02Role: 'secondary explanatory diagnostic only; static weakness cannot veto observed-carrier replication',
    frozenThresholds: READY_SCHEDULE_REPLICATION_THRESHOLDS,
    registryMutation: 'NONE',
    effectiveWeaponStatePromotion: 'NONE',
  },
  discoveryReference: {
    status: script171Test.status,
    observedRuntimeCarrier: script171Test.observedRuntimeCarrier,
    staticExplanatoryModelV02: script171Test.staticExplanatoryModelV02,
  },
  replays: replayResults,
  crossReplayReplication: replication,
  crossReplayStaticHeroOutliers: staticOutliers,
  validation: {
    integrityValidation: integrityPass ? 'pass' : 'fail',
    semanticValidation: semanticPass ? 'pass' : 'requires_diagnosis',
    replicationStatus: semanticPass ? 'cross_replay_replicated' : 'not_replicated',
    integrityChecks,
  },
  interpretation: {
    observedAuthorityBoundary: semanticPass
      ? 'The observed nextPrimaryAttack-lastAttackTime carrier replicated across the frozen five-replay cohort under the pre-frozen sustained-pair semantics. This supports a dedicated cadence/readiness subclaim, not the entire effective_weapon_state claim.'
      : 'The observed carrier did not satisfy the frozen cross-replay gates; inspect per-replay contradictions before promotion.',
    staticBoundary: 'Static cycle/intra-burst values remain build-bound explanatory inputs. Their cross-replay fit is reported but is not the primary replication gate.',
    spinUpBoundary: 'Spin-up weapons remain outside the fixed-regime carrier replication scope and require a separate dynamic-state validation.',
    registryBoundary: 'This script does not mutate contracts/claim_registry_v03.json and does not promote effective_weapon_state.',
  },
  nextStage: semanticPass
    ? 'PROMOTE_A_DEDICATED_PRIMARY_ATTACK_READY_SCHEDULE_SUBCLAIM_WITH_REGISTRY_REGRESSION_TEST;_KEEP_EFFECTIVE_WEAPON_STATE_MISSING'
    : 'DIAGNOSE_REPLAY_LEVEL_READY_SCHEDULE_CONTRADICTIONS_WITHOUT_RETUNING_FROZEN_THRESHOLDS',
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('CROSS-REPLAY READY-SCHEDULE RESULT');
console.log('========================================================');
console.log('');
for (const row of replayResults) printReplay(row);
console.log('');
console.log('POOLED OBSERVED RUNTIME CARRIER');
console.log('-------------------------------');
printAlignment('all sustained', replication.pooled.observed.aggregate);
printAlignment('burst boundary', replication.pooled.observed.burstBoundary);
printAlignment('burst positive', replication.pooled.observed.burstPositive);
printAlignment('non-burst', replication.pooled.observed.nonBurst);
printAlignment('lastAttack delta vs replay spacing', replication.pooled.observed.lastAttackDeltaVsReplaySpacing);
printAlignment('next lastAttack vs current nextPrimary', replication.pooled.observed.nextLastAttackVsCurrentNextPrimary);
console.log('');
console.log('POOLED STATIC EXPLANATORY MODEL V02 (SECONDARY)');
console.log('-----------------------------------------------');
printAlignment('aggregate', replication.pooled.staticModelV02.aggregate);
printAlignment('burst boundary: cycle + intra', replication.pooled.staticModelV02.burstBoundary);
printAlignment('burst positive: intra', replication.pooled.staticModelV02.burstPositive);
printAlignment('non-burst: cycle', replication.pooled.staticModelV02.nonBurst);
console.log('');
console.log('REPLICATION GATES');
console.log('-----------------');
console.log(`independent replays:                  ${replication.replayCount}/${READY_SCHEDULE_REPLICATION_THRESHOLDS.requiredIndependentReplays}`);
console.log(`per-replay primary pass:              ${replication.perReplay.filter(row => row.pass).length}/${replication.perReplay.length}`);
console.log(`pooled observed carrier pass:         ${replication.gates.pooledObservedPass}`);
console.log(`sampled regime checks pass:           ${replication.gates.sampledRegimesPass}`);
console.log(`boundary timing cross-check pass:     ${replication.gates.boundaryTimingPass}`);
console.log('');
console.log('INTEGRITY VALIDATION');
console.log('--------------------');
for (const [name, row] of Object.entries(integrityChecks)) {
  console.log(`${name.padEnd(44)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log('CLASSIFICATION');
console.log('--------------');
console.log(replication.classification);
console.log('');
console.log(`status: ${status}`);
console.log(`replicationStatus: ${output.validation.replicationStatus}`);
console.log(`effective_weapon_state: ${effectiveWeaponClaim?.authorityStatus ?? 'UNKNOWN'}`);
console.log(`NEXT STAGE: ${output.nextStage}`);
console.log('');
console.log(`JSON:\n${PATHS.output}`);
console.log('');

async function evaluateReplay({ replayName, script161, eventsPath, weaponByHeroId }) {
  const contextsById = new Map((script161.effectContextSignatures ?? []).map(row => [row.id, row]));
  const rows = [];
  const rl = createInterface({ input: createReadStream(eventsPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row?.transition?.actualDischargeSignal !== true) continue;
    if (!Number.isFinite(row?.transition?.readyDelayCandidateSeconds)) continue;
    if (!Number.isFinite(row?.heroId)) continue;

    const context = contextsById.get(row.effectContextId) ?? null;
    const fireRateContext = context ? extractFireRateContext(context) : null;
    const weapon = weaponByHeroId.get(Number(row.heroId)) ?? null;
    const specialFireRateScaling = (weapon?.fireRateScaling?.length ?? 0) > 0;

    rows.push({
      ...row,
      fireRateContext,
      cleanExplicitFireRateBaseline: Boolean(fireRateContext) && isCleanExplicitFireRateBaseline(fireRateContext),
      staticWeaponResolved: Boolean(weapon),
      staticCadenceRegime: weapon?.weaponInfo?.cadenceRegime?.regime ?? null,
      specialFireRateScaling,
    });
  }

  const cleanRows = rows.filter(row => row.cleanExplicitFireRateBaseline && row.staticWeaponResolved);
  const cleanNoSpecialScalingRows = cleanRows.filter(row => !row.specialFireRateScaling);
  const modeByHero = new Map();
  for (const [heroId, heroRows] of groupBy(cleanNoSpecialScalingRows, row => Number(row.heroId))) {
    modeByHero.set(heroId, selectDominantActiveFireMode(heroRows));
  }

  const strictRows = cleanNoSpecialScalingRows.filter(row => {
    const dominant = modeByHero.get(Number(row.heroId));
    if (!dominant) return false;
    return finite(row?.observedWeaponState?.activeFireMode) === dominant.activeFireMode;
  });
  const strictKeySet = new Set(strictRows.map(rowKey));

  const pairs = [];
  for (const [, weaponRows] of groupBy(rows, row => `${row.playerKey}|${row.weaponEntityIndex}`)) {
    weaponRows.sort(compareRows);
    for (let i = 0; i + 1 < weaponRows.length; i++) {
      const current = weaponRows[i];
      const next = weaponRows[i + 1];
      if (!strictKeySet.has(rowKey(current))) continue;
      const regime = current.staticCadenceRegime;
      if (regime !== 'BURST' && regime !== 'SINGLE_OR_AUTOMATIC_NON_BURST') continue;
      const weapon = weaponByHeroId.get(Number(current.heroId)) ?? null;
      const diagnostic = buildObservedDischargePair(current, next, weapon, {
        ticksPerSecond: TICKS_PER_SECOND,
        absoluteToleranceSeconds: 1 / TICKS_PER_SECOND,
        relativeTolerance: 0.05,
      });
      if (!diagnostic.comparable) continue;
      pairs.push({
        heroId: current.heroId,
        displayName: weapon?.displayName ?? null,
        regime,
        diagnostic,
      });
    }
  }

  const sustained = pairs.filter(row => row.diagnostic.script167CompatibleSustained);
  const boundary = sustained.filter(row => row.regime === 'BURST' && row.diagnostic.burstShotsRemaining === 0);
  const positive = sustained.filter(row => row.regime === 'BURST' && Number(row.diagnostic.burstShotsRemaining) > 0);
  const nonBurst = sustained.filter(row => row.regime === 'SINGLE_OR_AUTOMATIC_NON_BURST');

  const allSummary = summarizeCandidateRows(sustained.map(row => row.diagnostic));
  const boundarySummary = summarizeCandidateRows(boundary.map(row => row.diagnostic));
  const positiveSummary = summarizeCandidateRows(positive.map(row => row.diagnostic));
  const nonBurstSummary = summarizeCandidateRows(nonBurst.map(row => row.diagnostic));
  const boundaryTiming = summarizeTimingFieldChecks(boundary.map(row => row.diagnostic));

  const observed = {
    aggregate: findCandidate(allSummary, 'CURRENT_READY_DELAY'),
    burstBoundary: findCandidate(boundarySummary, 'CURRENT_READY_DELAY'),
    burstPositive: findCandidate(positiveSummary, 'CURRENT_READY_DELAY'),
    nonBurst: findCandidate(nonBurstSummary, 'CURRENT_READY_DELAY'),
    lastAttackDeltaVsReplaySpacing: boundaryTiming.lastAttackDeltaVsActualSpacing,
    nextLastAttackVsCurrentNextPrimary: boundaryTiming.nextAttackScheduledAtCurrentNextPrimary,
  };

  const staticBoundary = findCandidate(boundarySummary, 'CYCLE_PLUS_INTRA');
  const staticPositive = findCandidate(positiveSummary, 'INTRA_BURST_CYCLE_TIME');
  const staticNonBurst = findCandidate(nonBurstSummary, 'NON_BURST_CYCLE');
  const staticModelV02 = {
    aggregate: weightedAlignment([staticBoundary, staticPositive, staticNonBurst]),
    burstBoundary: staticBoundary,
    burstPositive: staticPositive,
    nonBurst: staticNonBurst,
  };

  const byHero = [];
  for (const [heroId, heroPairs] of groupBy(sustained, row => Number(row.heroId))) {
    const heroBoundary = heroPairs.filter(row => row.regime === 'BURST' && row.diagnostic.burstShotsRemaining === 0);
    const heroPositive = heroPairs.filter(row => row.regime === 'BURST' && Number(row.diagnostic.burstShotsRemaining) > 0);
    const heroNonBurst = heroPairs.filter(row => row.regime === 'SINGLE_OR_AUTOMATIC_NON_BURST');
    const heroReady = findCandidate(summarizeCandidateRows(heroPairs.map(row => row.diagnostic)), 'CURRENT_READY_DELAY');
    const staticSummary = weightedAlignment([
      findCandidate(summarizeCandidateRows(heroBoundary.map(row => row.diagnostic)), 'CYCLE_PLUS_INTRA'),
      findCandidate(summarizeCandidateRows(heroPositive.map(row => row.diagnostic)), 'INTRA_BURST_CYCLE_TIME'),
      findCandidate(summarizeCandidateRows(heroNonBurst.map(row => row.diagnostic)), 'NON_BURST_CYCLE'),
    ]);
    byHero.push({
      heroId,
      displayName: heroPairs[0]?.displayName ?? null,
      regime: heroPairs[0]?.regime ?? null,
      sustainedPairs: heroPairs.length,
      observedReady: heroReady,
      staticV02: staticSummary,
    });
  }
  byHero.sort((a, b) => b.sustainedPairs - a.sustainedPairs || a.heroId - b.heroId);

  const integrityChecks = {
    script161Ready: script161?.status === 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION',
    dischargeRowsObserved: rows.length > 100,
    strictRowsObserved: strictRows.length > 100,
    comparablePairsObserved: pairs.length > 100,
    sustainedPairsObserved: sustained.length > 100,
    everyStrictHeroHasStaticWeapon: strictRows.every(row => row.staticWeaponResolved),
  };

  return {
    replay: replayName,
    integrityPass: Object.values(integrityChecks).every(Boolean),
    integrityChecks,
    counts: {
      dischargeRowsWithReadyDelay: rows.length,
      cleanExplicitFireRateRows: cleanRows.length,
      strictRows: strictRows.length,
      comparablePairs: pairs.length,
      sustainedPairs: sustained.length,
      burstBoundarySustainedPairs: boundary.length,
      burstPositiveSustainedPairs: positive.length,
      nonBurstSustainedPairs: nonBurst.length,
    },
    observed,
    staticModelV02,
    byHero,
  };
}

function buildCrossReplayHeroOutliers(replayResults) {
  const rows = [];
  for (const replay of replayResults) {
    for (const hero of replay.byHero ?? []) {
      rows.push({ replay: replay.replay, ...hero });
    }
  }
  const groups = groupBy(rows, row => Number(row.heroId));
  const out = [];
  for (const [heroId, heroRows] of groups) {
    const observedReady = weightedAlignment(heroRows.map(row => row.observedReady));
    const staticV02 = weightedAlignment(heroRows.map(row => row.staticV02));
    if (staticV02.comparable < 100) continue;
    if (!Number.isFinite(staticV02.alignmentRate) || staticV02.alignmentRate >= 0.90) continue;
    out.push({
      heroId,
      displayName: heroRows.find(row => row.displayName)?.displayName ?? null,
      replaysObserved: [...new Set(heroRows.map(row => row.replay))],
      observedReady,
      staticV02,
    });
  }
  return out.sort((a, b) => a.staticV02.alignmentRate - b.staticV02.alignmentRate || a.heroId - b.heroId);
}

function isReusableScript161(summaryPath, eventsPath) {
  if (!existsSync(summaryPath) || !existsSync(eventsPath)) return false;
  try {
    return readJson(summaryPath)?.status === 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION';
  } catch {
    return false;
  }
}

function printReplay(row) {
  const observed = row.observed.aggregate;
  const staticModel = row.staticModelV02.aggregate;
  console.log(
    `${row.replay.padEnd(6)} sustained=${String(row.counts.sustainedPairs).padEnd(6)}`
    + ` ready=${percent(observed?.alignmentRate).padEnd(8)}`
    + ` static=${percent(staticModel?.alignmentRate).padEnd(8)}`
    + ` integrity=${row.integrityPass ? 'PASS' : 'FAIL'}`,
  );
}
function printAlignment(label, row) {
  console.log(`${label.padEnd(40)} ${String(row?.aligned ?? 0).padStart(6)}/${String(row?.comparable ?? 0).padEnd(6)} (${percent(row?.alignmentRate)})`);
}
function compareRows(a, b) {
  return (finite(a?.tick) ?? 0) - (finite(b?.tick) ?? 0)
    || String(a?.playerKey ?? '').localeCompare(String(b?.playerKey ?? ''));
}
function rowKey(row) {
  return `${row.playerKey}|${row.weaponEntityIndex}|${row.tick}|${row.effectContextId ?? 'NULL'}`;
}
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows ?? []) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}
function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function check(actual, expected, pass) { return { actual, expected, pass: Boolean(pass) }; }
function percent(value) { return Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : 'n/a'; }
