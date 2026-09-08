import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { extractFireRateContext } from '../src/player-state/effective-weapon-fire-rate-context.mjs';
import {
  isCleanExplicitFireRateBaseline,
  selectDominantActiveFireMode,
} from '../src/player-state/static-cadence-alignment.mjs';
import {
  compareBurstBoundaryCandidates,
  classifyBurstCounterStep,
  classifyBurstBoundarySemantics,
  summarizeCandidateAlignment,
  summarizeCounterSteps,
} from '../src/player-state/burst-boundary-diagnostic.mjs';

const VERSION = 'BURST_BOUNDARY_READY_DELAY_SEMANTICS_DIAGNOSTIC_V01';
const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayName = basename(resolve(replayArgument), extname(replayArgument));
const TICKS_PER_SECOND = 64;

const PATHS = {
  script161: resolve('output', replayName, 'effective_weapon_state_substrate_v01.json'),
  events: resolve('output', replayName, 'effective_weapon_runtime_events_v01.jsonl'),
  script165: resolve('output', 'cross_replay', 'primary_weapon_static_cadence_substrate_v02.json'),
  script166: resolve('output', replayName, 'static_runtime_cadence_alignment_diagnostic_v01.json'),
  output: resolve('output', replayName, 'burst_boundary_ready_delay_semantics_diagnostic_v01.json'),
};

for (const path of [PATHS.script161, PATHS.events, PATHS.script165, PATHS.script166]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const script161 = JSON.parse(readFileSync(PATHS.script161, 'utf8'));
const script165 = JSON.parse(readFileSync(PATHS.script165, 'utf8'));
const script166 = JSON.parse(readFileSync(PATHS.script166, 'utf8'));

if (script161?.status !== 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION') {
  throw new Error(`Script161 not ready. Status=${script161?.status}`);
}
if (script165?.status !== 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V02_READY_FOR_INTERPRETATION') {
  throw new Error(`Script165 V02 not ready. Status=${script165?.status}`);
}
if (script166?.status !== 'STATIC_RUNTIME_CADENCE_ALIGNMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION') {
  throw new Error(`Script166 not ready. Status=${script166?.status}`);
}

const contextsById = new Map((script161.effectContextSignatures ?? []).map(row => [row.id, row]));
const weaponByHeroId = new Map((script165.heroes ?? []).map(row => [Number(row.heroId), row]));

const burstDischarges = [];
const rl = createInterface({ input: createReadStream(PATHS.events), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row?.transition?.actualDischargeSignal !== true) continue;
  if (!Number.isFinite(row?.transition?.readyDelayCandidateSeconds)) continue;
  if (!Number.isFinite(row?.heroId)) continue;

  const weapon = weaponByHeroId.get(Number(row.heroId)) ?? null;
  if (weapon?.weaponInfo?.cadenceRegime?.regime !== 'BURST') continue;
  if ((weapon?.fireRateScaling?.length ?? 0) > 0) continue;

  const context = contextsById.get(row.effectContextId) ?? null;
  const fireRateContext = context ? extractFireRateContext(context) : null;
  if (!fireRateContext || !isCleanExplicitFireRateBaseline(fireRateContext)) continue;

  burstDischarges.push(row);
}

const modeByHero = new Map();
for (const [heroId, heroRows] of groupBy(burstDischarges, row => Number(row.heroId))) {
  modeByHero.set(heroId, selectDominantActiveFireMode(heroRows));
}

const strictRows = burstDischarges
  .filter(row => {
    const dominant = modeByHero.get(Number(row.heroId));
    if (!dominant) return false;
    const mode = Number.isFinite(row?.observedWeaponState?.activeFireMode)
      ? row.observedWeaponState.activeFireMode
      : null;
    return mode === dominant.activeFireMode;
  })
  .sort(compareRows);

const diagnosed = strictRows.map(row => ({
  heroId: row.heroId,
  playerKey: row.playerKey ?? null,
  weaponEntityIndex: row.weaponEntityIndex,
  tick: row.tick,
  effectContextId: row.effectContextId ?? null,
  burstShotsRemaining: row?.observedWeaponState?.burstShotsRemaining ?? null,
  continuousShots: row?.observedWeaponState?.continuousShots ?? null,
  shotNumber: row?.observedWeaponState?.shotNumber ?? null,
  readyDelaySeconds: row?.transition?.readyDelayCandidateSeconds ?? null,
  diagnostic: compareBurstBoundaryCandidates(
    row,
    weaponByHeroId.get(Number(row.heroId)),
    { absoluteToleranceSeconds: 1 / TICKS_PER_SECOND, relativeTolerance: 0.05 },
  ),
}));

const boundaryRows = diagnosed.filter(row => row.diagnostic.boundaryCandidate === true);
const nonBoundaryRows = diagnosed.filter(row => row.diagnostic.boundaryCandidate === false);
const boundaryCandidateSummary = summarizeCandidateAlignment(boundaryRows);
const nonBoundaryCandidateSummary = summarizeCandidateAlignment(nonBoundaryRows);

const sequenceSteps = [];
for (const [, weaponRows] of groupBy(strictRows, row => `${row.playerKey ?? 'NA'}:${row.weaponEntityIndex}`)) {
  const ordered = [...weaponRows].sort(compareRows);
  for (let i = 0; i + 1 < ordered.length; i++) {
    const current = ordered[i];
    const next = ordered[i + 1];
    if (next.tick <= current.tick) continue;
    if (current.effectContextId !== next.effectContextId) continue;
    if (current?.observedWeaponState?.activeFireMode !== next?.observedWeaponState?.activeFireMode) continue;

    const weapon = weaponByHeroId.get(Number(current.heroId));
    const diagnostic = classifyBurstCounterStep(current, next, weapon);
    const gapSeconds = (next.tick - current.tick) / TICKS_PER_SECOND;
    const readyDelaySeconds = Number(current?.transition?.readyDelayCandidateSeconds);
    const sustainedBoundaryComparable = Number.isFinite(readyDelaySeconds)
      && gapSeconds <= readyDelaySeconds + (2 / TICKS_PER_SECOND);

    sequenceSteps.push({
      heroId: current.heroId,
      playerKey: current.playerKey ?? null,
      weaponEntityIndex: current.weaponEntityIndex,
      currentTick: current.tick,
      nextTick: next.tick,
      gapSeconds,
      currentReadyDelaySeconds: readyDelaySeconds,
      sustainedBoundaryComparable,
      diagnostic,
    });
  }
}

const sustainedSequenceSteps = sequenceSteps.filter(row => row.sustainedBoundaryComparable);
const counterSummaryAllSameContext = summarizeCounterSteps(sequenceSteps);
const counterSummarySustained = summarizeCounterSteps(sustainedSequenceSteps);

const byHero = [];
for (const [heroId, heroRows] of groupBy(diagnosed, row => Number(row.heroId))) {
  const boundary = heroRows.filter(row => row.diagnostic.boundaryCandidate === true);
  const nonBoundary = heroRows.filter(row => row.diagnostic.boundaryCandidate === false);
  const weapon = weaponByHeroId.get(Number(heroId));
  const heroSteps = sequenceSteps.filter(row => Number(row.heroId) === Number(heroId));
  const heroSustainedSteps = heroSteps.filter(row => row.sustainedBoundaryComparable);
  byHero.push({
    heroId,
    displayName: weapon?.displayName ?? null,
    primaryWeaponRecordKey: weapon?.primaryWeaponRecordKey ?? null,
    staticCadenceRegime: weapon?.weaponInfo?.cadenceRegime ?? null,
    dominantActiveFireMode: modeByHero.get(Number(heroId)) ?? null,
    strictDischarges: heroRows.length,
    boundaryRows: boundary.length,
    nonBoundaryRows: nonBoundary.length,
    boundaryCandidateSummary: summarizeCandidateAlignment(boundary),
    nonBoundaryCandidateSummary: summarizeCandidateAlignment(nonBoundary),
    counterSummaryAllSameContext: summarizeCounterSteps(heroSteps),
    counterSummarySustained: summarizeCounterSteps(heroSustainedSteps),
  });
}
byHero.sort((a, b) => b.strictDischarges - a.strictDischarges || a.heroId - b.heroId);

const script166Intra = (script166?.alignment?.burstByExpectedKind ?? [])
  .find(row => row?.key === 'INTRA_BURST') ?? null;
const script166Post = (script166?.alignment?.burstByExpectedKind ?? [])
  .find(row => row?.key === 'POST_BURST_REMAINDER') ?? null;

const checks = {
  script161Ready: check(
    script161.status,
    'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION',
    true,
  ),
  script165V02Ready: check(
    script165.status,
    'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V02_READY_FOR_INTERPRETATION',
    true,
  ),
  script166Ready: check(
    script166.status,
    'STATIC_RUNTIME_CADENCE_ALIGNMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION',
    true,
  ),
  script166BurstCohortReproduced: check(
    strictRows.length,
    script166?.counts?.burstRows ?? null,
    Number.isFinite(script166?.counts?.burstRows) && strictRows.length === script166.counts.burstRows,
  ),
  script166IntraRowsReproduced: check(
    nonBoundaryRows.length,
    script166Intra?.comparable ?? null,
    Number.isFinite(script166Intra?.comparable) && nonBoundaryRows.length === script166Intra.comparable,
  ),
  script166BoundaryRowsReproduced: check(
    boundaryRows.length,
    script166Post?.comparable ?? null,
    Number.isFinite(script166Post?.comparable) && boundaryRows.length === script166Post.comparable,
  ),
};
const integrityPass = Object.values(checks).every(row => row.pass);

const classification = classifyBurstBoundarySemantics({
  boundaryCandidateSummary,
  counterSummary: counterSummarySustained.comparable >= 20
    ? counterSummarySustained
    : counterSummaryAllSameContext,
});

const status = integrityPass
  ? 'BURST_BOUNDARY_READY_DELAY_SEMANTICS_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
  : 'BURST_BOUNDARY_READY_DELAY_SEMANTICS_DIAGNOSTIC_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  replay: replayName,
  inputs: {
    script161: PATHS.script161,
    script165V02: PATHS.script165,
    script166: PATHS.script166,
    runtimeEvents: PATHS.events,
  },
  design: {
    purpose: 'Resolve Script166 burst-only failure by separating a wrong post-burst interval formula from a wrong runtime burst-counter phase.',
    replayParsing: 'NONE',
    cohort: 'Same clean explicit-Fire-Rate, no-special-EFireRate-scaling, dominant-fire-mode burst baseline used by Script166.',
    competingBoundaryHypotheses: [
      'FULL_CYCLE_TIME = m_flCycleTime',
      'INTRA_BURST_CYCLE_TIME = m_flIntraBurstCycleTime',
      'POST_BURST_REMAINDER = m_flCycleTime - (burstCount-1)*m_flIntraBurstCycleTime',
    ],
    burstCounterPhaseTest: 'Within same effect context and active fire mode, test whether discharge-state m_nBurstShotsRemaining descends by one and resets 0 -> burstCount-1.',
    sustainedSequenceDefinition: 'Next observed discharge occurs no later than current readyDelay + two replay ticks; used as the stronger counter-sequence subset.',
    tolerance: {
      absoluteSeconds: 1 / TICKS_PER_SECOND,
      relativeOfCandidateInterval: 0.05,
      rationale: 'Same frozen tolerance used by Script166; no threshold retuning after seeing its result.',
    },
    authorityPromotion: 'NONE',
  },
  counts: {
    cleanBurstDischargesBeforeDominantMode: burstDischarges.length,
    strictBurstDischarges: strictRows.length,
    boundaryRowsZeroRemaining: boundaryRows.length,
    nonBoundaryRowsPositiveRemaining: nonBoundaryRows.length,
    sameContextSequenceSteps: sequenceSteps.length,
    sustainedSequenceSteps: sustainedSequenceSteps.length,
  },
  boundaryCandidateSummary,
  nonBoundaryCandidateSummary,
  counterSummary: {
    allSameContext: counterSummaryAllSameContext,
    sustained: counterSummarySustained,
  },
  byHero,
  diagnosticClassification: classification,
  validation: {
    integrityPass,
    semanticValidation: 'DIAGNOSTIC_ONLY_NOT_AUTHORITY_PROMOTION',
    replicationStatus: 'SINGLE_REPLAY_DISCOVERY',
    checks,
  },
  interpretation: {
    script166BoundaryFailure: 'Script166 observed 0/844 alignment for its derived post-burst remainder while intra-burst rows aligned 1771/1771. Script167 does not revise Script166; it diagnoses the competing semantics explicitly.',
    guardrail: 'A strong full-cycle result would validate a runtime/static relation for this ready-delay carrier at burst boundaries. It would not by itself establish a universal external definition of m_flCycleTime or final effective Fire Rate composition.',
  },
  nextStage: nextStage(classification),
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('BURST BOUNDARY READY-DELAY SEMANTICS DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                              ${replayName}`);
console.log('Replay parsing:                      NONE');
console.log('Thresholds retuned after Script166:  NO');
console.log('Boundary hypotheses:                full cycle vs intra-burst vs derived remainder');
console.log('Authority promotion:                 NONE');
console.log('');
console.log('BURST BASELINE');
console.log('--------------');
console.log(`clean burst discharges:              ${burstDischarges.length}`);
console.log(`strict dominant-mode discharges:     ${strictRows.length}`);
console.log(`zero-remaining boundary rows:        ${boundaryRows.length}`);
console.log(`positive-remaining rows:             ${nonBoundaryRows.length}`);
console.log('');
console.log('INTEGRITY REPRODUCTION');
console.log('----------------------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(38)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log('ZERO-REMAINING BOUNDARY CANDIDATES');
console.log('----------------------------------');
for (const row of boundaryCandidateSummary) printCandidate(row);
console.log('');
console.log('POSITIVE-REMAINING CANDIDATES');
console.log('-----------------------------');
for (const row of nonBoundaryCandidateSummary) printCandidate(row);
console.log('');
console.log('BURST COUNTER SEQUENCE');
console.log('----------------------');
printCounter('same-context pairs', counterSummaryAllSameContext);
printCounter('sustained-fire pairs', counterSummarySustained);
console.log('');
console.log('BY HERO');
console.log('-------');
for (const row of byHero) {
  const boundaryBest = row.boundaryCandidateSummary[0] ?? null;
  const counter = row.counterSummarySustained.comparable >= 10
    ? row.counterSummarySustained
    : row.counterSummaryAllSameContext;
  console.log(
    `hero=${String(row.heroId).padEnd(4)} ${String(row.displayName ?? '').padEnd(18)}`
    + ` n=${String(row.strictDischarges).padEnd(6)}`
    + ` boundary=${String(row.boundaryRows).padEnd(5)}`
    + ` best=${String(boundaryBest?.kind ?? 'n/a').padEnd(25)}`
    + ` bestRate=${percent(boundaryBest?.alignmentRate).padEnd(7)}`
    + ` counterSeq=${percent(counter?.expectedPostShotSequenceRate)}`
  );
}
console.log('');
console.log('CLASSIFICATION');
console.log('--------------');
console.log(classification);
console.log('');
console.log(`NEXT STAGE: ${output.nextStage}`);
console.log('');
console.log(`JSON:\n${PATHS.output}`);
console.log('');

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows ?? []) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function compareRows(a, b) {
  return (a.tick - b.tick)
    || String(a.playerKey ?? '').localeCompare(String(b.playerKey ?? ''))
    || ((a.weaponEntityIndex ?? 0) - (b.weaponEntityIndex ?? 0));
}

function printCandidate(row) {
  console.log(
    `${row.kind.padEnd(28)}`
    + ` ${String(row.aligned).padStart(5)}/${String(row.comparable).padEnd(5)}`
    + ` (${percent(row.alignmentRate).padEnd(6)})`
    + ` medRatio=${format(row.ratioToCandidate?.median)}`
    + ` medErr=${format(row.absoluteErrorSeconds?.median)}s`
  );
}

function printCounter(label, row) {
  console.log(
    `${label.padEnd(28)}`
    + ` ${String(row.expectedPostShotSequenceSteps).padStart(5)}/${String(row.comparable).padEnd(5)}`
    + ` (${percent(row.expectedPostShotSequenceRate)})`
    + ` steps=${JSON.stringify(row.counts)}`
  );
}

function nextStage(classification) {
  if (classification === 'BURST_ZERO_REMAINING_IS_POST_SHOT_BOUNDARY_AND_READY_DELAY_MATCHES_FULL_CYCLE_TIME') {
    return 'REVISE_BURST_RUNTIME_ALIGNMENT_MODEL_IN_A_NEW_SCRIPT_USING_FULL_CYCLE_TIME_AT_ZERO_REMAINING_THEN_DIAGNOSE_REMAINING_NON_BURST_OUTLIERS';
  }
  if (classification === 'BURST_ZERO_REMAINING_IS_POST_SHOT_BOUNDARY_BUT_READY_DELAY_MATCHES_INTRA_BURST_TIME') {
    return 'MODEL_READY_DELAY_AS_INTRA_BURST_AT_ZERO_REMAINING_AND_VALIDATE_ACTUAL_NEXT_BURST_START_SEPARATELY';
  }
  if (classification === 'BURST_COUNTER_PHASE_NOT_CLEANLY_POST_SHOT_SEQUENCE') {
    return 'DIAGNOSE_M_NBURSTSHOTSREMAINING_UPDATE_PHASE_AGAINST_SHOT_NUMBER_AND_NEXT_DISCHARGE';
  }
  if (classification === 'BURST_BOUNDARY_COVERAGE_INSUFFICIENT') {
    return 'EXPAND_BURST_BASELINE_COVERAGE_USING_FROZEN_REPLICATION_COHORT';
  }
  return 'DIAGNOSE_HERO_SPECIFIC_BURST_BOUNDARY_SEMANTICS_WITHOUT_RETUNING_THRESHOLDS';
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function format(value) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : 'n/a';
}
