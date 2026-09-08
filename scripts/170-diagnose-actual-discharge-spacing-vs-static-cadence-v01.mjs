import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { extractFireRateContext } from '../src/player-state/effective-weapon-fire-rate-context.mjs';
import {
  isCleanExplicitFireRateBaseline,
  selectDominantActiveFireMode,
} from '../src/player-state/static-cadence-alignment.mjs';
import {
  buildObservedDischargePair,
  classifyObservedSpacing,
  summarizeCandidateRows,
  summarizeTimingFieldChecks,
} from '../src/player-state/actual-discharge-spacing.mjs';

const VERSION = 'ACTUAL_DISCHARGE_SPACING_VS_STATIC_CADENCE_DIAGNOSTIC_V01';
const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayName = basename(resolve(replayArgument), extname(replayArgument));
const TICKS_PER_SECOND = 64;

const PATHS = {
  script161: resolve('output', replayName, 'effective_weapon_state_substrate_v01.json'),
  events: resolve('output', replayName, 'effective_weapon_runtime_events_v01.jsonl'),
  script165: resolve('output', 'cross_replay', 'primary_weapon_static_cadence_substrate_v02.json'),
  script166: resolve('output', replayName, 'static_runtime_cadence_alignment_diagnostic_v01.json'),
  script168: resolve('output', replayName, 'burst_boundary_network_field_phase_diagnostic_v01.json'),
  script169: resolve('output', replayName, 'hidden_cadence_modifier_context_audit_v01.json'),
  output: resolve('output', replayName, 'actual_discharge_spacing_vs_static_cadence_diagnostic_v01.json'),
};

for (const path of Object.values(PATHS).filter(path => path !== PATHS.output)) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const script161 = JSON.parse(readFileSync(PATHS.script161, 'utf8'));
const script165 = JSON.parse(readFileSync(PATHS.script165, 'utf8'));
const script166 = JSON.parse(readFileSync(PATHS.script166, 'utf8'));
const script168 = JSON.parse(readFileSync(PATHS.script168, 'utf8'));
const script169 = JSON.parse(readFileSync(PATHS.script169, 'utf8'));

if (script161?.status !== 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION') {
  throw new Error(`Script161 not ready. Status=${script161?.status}`);
}
if (script165?.status !== 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V02_READY_FOR_INTERPRETATION') {
  throw new Error(`Script165 V02 not ready. Status=${script165?.status}`);
}
if (script166?.status !== 'STATIC_RUNTIME_CADENCE_ALIGNMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION') {
  throw new Error(`Script166 not ready. Status=${script166?.status}`);
}
if (script168?.status !== 'BURST_BOUNDARY_NETWORK_FIELD_PHASE_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION') {
  throw new Error(`Script168 not ready. Status=${script168?.status}`);
}
if (script169?.status !== 'HIDDEN_CADENCE_MODIFIER_CONTEXT_AUDIT_V01_READY_FOR_INTERPRETATION') {
  throw new Error(`Script169 not ready. Status=${script169?.status}`);
}

const contextsById = new Map((script161.effectContextSignatures ?? []).map(row => [row.id, row]));
const weaponByHeroId = new Map((script165.heroes ?? []).map(row => [Number(row.heroId), row]));

const rows = [];
const rl = createInterface({ input: createReadStream(PATHS.events), crlfDelay: Infinity });
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
  const mode = finite(row?.observedWeaponState?.activeFireMode);
  return mode === dominant.activeFireMode;
});

const strictKeySet = new Set(strictRows.map(rowKey));
const strictBurstRows = strictRows.filter(row => row.staticCadenceRegime === 'BURST');
const strictBoundaryRows = strictBurstRows.filter(row => finite(row?.observedWeaponState?.burstShotsRemaining) === 0);
const strictPositiveRows = strictBurstRows.filter(row => finite(row?.observedWeaponState?.burstShotsRemaining) > 0);
const strictNonBurstRows = strictRows.filter(row => row.staticCadenceRegime === 'SINGLE_OR_AUTOMATIC_NON_BURST');

const pairs = [];
for (const [, weaponRows] of groupBy(rows, row => `${row.playerKey}|${row.weaponEntityIndex}`)) {
  weaponRows.sort(compareRows);
  for (let i = 0; i + 1 < weaponRows.length; i++) {
    const current = weaponRows[i];
    const next = weaponRows[i + 1];
    if (!strictKeySet.has(rowKey(current))) continue;
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
      primaryWeaponRecordKey: weapon?.primaryWeaponRecordKey ?? null,
      staticCadenceRegime: current.staticCadenceRegime,
      currentTick: current.tick,
      nextTick: next.tick,
      effectContextId: current.effectContextId,
      diagnostic,
    });
  }
}

const burstPairs = pairs.filter(row => row.staticCadenceRegime === 'BURST');
const burstBoundaryPairs = burstPairs.filter(row => row.diagnostic.burstShotsRemaining === 0);
const burstPositivePairs = burstPairs.filter(row => Number(row.diagnostic.burstShotsRemaining) > 0);
const nonBurstPairs = pairs.filter(row => row.staticCadenceRegime === 'SINGLE_OR_AUTOMATIC_NON_BURST');

const sustainedPairs = pairs.filter(row => row.diagnostic.script167CompatibleSustained);
const burstBoundarySustained = burstBoundaryPairs.filter(row => row.diagnostic.script167CompatibleSustained);
const burstPositiveSustained = burstPositivePairs.filter(row => row.diagnostic.script167CompatibleSustained);
const nonBurstSustained = nonBurstPairs.filter(row => row.diagnostic.script167CompatibleSustained);

const summaries = {
  allPairs: summarizeCandidateRows(pairs.map(row => row.diagnostic)),
  sustainedPairs: summarizeCandidateRows(sustainedPairs.map(row => row.diagnostic)),
  burstBoundaryAll: summarizeCandidateRows(burstBoundaryPairs.map(row => row.diagnostic)),
  burstBoundarySustained: summarizeCandidateRows(burstBoundarySustained.map(row => row.diagnostic)),
  burstPositiveAll: summarizeCandidateRows(burstPositivePairs.map(row => row.diagnostic)),
  burstPositiveSustained: summarizeCandidateRows(burstPositiveSustained.map(row => row.diagnostic)),
  nonBurstAll: summarizeCandidateRows(nonBurstPairs.map(row => row.diagnostic)),
  nonBurstSustained: summarizeCandidateRows(nonBurstSustained.map(row => row.diagnostic)),
};

const timing = {
  allPairs: summarizeTimingFieldChecks(pairs.map(row => row.diagnostic)),
  sustainedPairs: summarizeTimingFieldChecks(sustainedPairs.map(row => row.diagnostic)),
  burstBoundaryAll: summarizeTimingFieldChecks(burstBoundaryPairs.map(row => row.diagnostic)),
  burstBoundarySustained: summarizeTimingFieldChecks(burstBoundarySustained.map(row => row.diagnostic)),
  burstPositiveSustained: summarizeTimingFieldChecks(burstPositiveSustained.map(row => row.diagnostic)),
  nonBurstSustained: summarizeTimingFieldChecks(nonBurstSustained.map(row => row.diagnostic)),
};

const byHero = [];
for (const [heroId, heroPairs] of groupBy(pairs, row => Number(row.heroId))) {
  const sustained = heroPairs.filter(row => row.diagnostic.script167CompatibleSustained);
  const boundary = sustained.filter(row => row.staticCadenceRegime === 'BURST' && row.diagnostic.burstShotsRemaining === 0);
  const positive = sustained.filter(row => row.staticCadenceRegime === 'BURST' && Number(row.diagnostic.burstShotsRemaining) > 0);
  const nonBurst = sustained.filter(row => row.staticCadenceRegime === 'SINGLE_OR_AUTOMATIC_NON_BURST');
  byHero.push({
    heroId,
    displayName: heroPairs[0]?.displayName ?? null,
    primaryWeaponRecordKey: heroPairs[0]?.primaryWeaponRecordKey ?? null,
    regime: heroPairs[0]?.staticCadenceRegime ?? null,
    comparablePairs: heroPairs.length,
    sustainedPairs: sustained.length,
    sustainedRate: ratio(sustained.length, heroPairs.length),
    sustainedCandidateSummary: summarizeCandidateRows(sustained.map(row => row.diagnostic)),
    burstBoundarySustainedCandidateSummary: summarizeCandidateRows(boundary.map(row => row.diagnostic)),
    burstPositiveSustainedCandidateSummary: summarizeCandidateRows(positive.map(row => row.diagnostic)),
    nonBurstSustainedCandidateSummary: summarizeCandidateRows(nonBurst.map(row => row.diagnostic)),
    sustainedTiming: summarizeTimingFieldChecks(sustained.map(row => row.diagnostic)),
  });
}
byHero.sort((a, b) => b.sustainedPairs - a.sustainedPairs || a.heroId - b.heroId);

const strictExpected = script166?.counts?.strictDominantModeRows ?? null;
const burstExpected = script166?.counts?.burstRows ?? null;
const nonBurstExpected = script166?.counts?.nonBurstRows ?? null;
const boundaryExpected = findGroup(script166?.alignment?.burstByExpectedKind, 'POST_BURST_REMAINDER')?.comparable ?? null;
const positiveExpected = findGroup(script166?.alignment?.burstByExpectedKind, 'INTRA_BURST')?.comparable ?? null;
const script169AnyCadence = script169?.strictBaselineCadenceEvidence?.withAnyCadenceEvidence ?? null;

const checks = {
  script166StrictBaselineReproduced: check(strictRows.length, strictExpected, strictRows.length === strictExpected),
  script166BurstRowsReproduced: check(strictBurstRows.length, burstExpected, strictBurstRows.length === burstExpected),
  script166NonBurstRowsReproduced: check(strictNonBurstRows.length, nonBurstExpected, strictNonBurstRows.length === nonBurstExpected),
  script166BoundaryRowsReproduced: check(strictBoundaryRows.length, boundaryExpected, strictBoundaryRows.length === boundaryExpected),
  script166PositiveBurstRowsReproduced: check(strictPositiveRows.length, positiveExpected, strictPositiveRows.length === positiveExpected),
  script169NoOwnedCadenceEvidence: check(script169AnyCadence, 0, script169AnyCadence === 0),
  script169ExpectedClassification: check(
    script169?.diagnosticClassification,
    'SCRIPT166_STRICT_ROWS_HAVE_NO_OWNED_HIDDEN_CADENCE_ITEM_EVIDENCE',
    script169?.diagnosticClassification === 'SCRIPT166_STRICT_ROWS_HAVE_NO_OWNED_HIDDEN_CADENCE_ITEM_EVIDENCE',
  ),
  script168FieldPhaseHypothesisRejected: check(
    script168?.diagnosticClassification,
    'BURST_BOUNDARY_NOT_EXPLAINED_BY_ONE_INTRA_OFFSET_OR_SHORT_HORIZON_FIELD_PHASE',
    script168?.diagnosticClassification === 'BURST_BOUNDARY_NOT_EXPLAINED_BY_ONE_INTRA_OFFSET_OR_SHORT_HORIZON_FIELD_PHASE',
  ),
  comparableActualSpacingObserved: check(pairs.length, '>100', pairs.length > 100),
  sustainedActualSpacingObserved: check(sustainedPairs.length, '>100', sustainedPairs.length > 100),
  burstBoundaryActualSpacingObserved: check(burstBoundaryPairs.length, '>100', burstBoundaryPairs.length > 100),
};
const integrityPass = Object.values(checks).every(row => row.pass);

const classification = integrityPass
  ? classifyObservedSpacing({
      burstPositiveSustained: summaries.burstPositiveSustained,
      burstBoundarySustained: summaries.burstBoundarySustained,
      nonBurstSustained: summaries.nonBurstSustained,
      boundaryTiming: timing.burstBoundarySustained,
    })
  : 'ACTUAL_DISCHARGE_SPACING_DIAGNOSTIC_INTEGRITY_FAILURE';

const status = integrityPass
  ? 'ACTUAL_DISCHARGE_SPACING_VS_STATIC_CADENCE_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
  : 'ACTUAL_DISCHARGE_SPACING_VS_STATIC_CADENCE_DIAGNOSTIC_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  replay: replayName,
  inputs: PATHS,
  design: {
    purpose: 'Separate a ready-delay-carrier problem from a static/runtime cadence-mapping problem by comparing actual next observed discharge spacing against the same static weapon intervals.',
    replayParsing: 'NONE',
    cohort: 'Exact Script166 strict baseline, with Script169 confirming zero owned cadence-item evidence.',
    pairControl: 'Consecutive actual discharges from the same player and weapon entity; effectContextId and active fire mode must remain unchanged.',
    sustainedSubset: 'Preserve Script167 definition: next observed discharge occurs no later than current readyDelay + two replay ticks. Used to reduce voluntary input-delay contamination without fitting to static resource intervals.',
    burstCandidates: [
      'FULL_CYCLE_TIME',
      'INTRA_BURST_CYCLE_TIME',
      'POST_BURST_REMAINDER',
      'CYCLE_PLUS_INTRA (pre-registered from Script168 one-intra offset observation)',
      'CURRENT_READY_DELAY (observed runtime schedule carrier)',
    ],
    timingCrossChecks: [
      'next.lastAttackTime - current.lastAttackTime versus actual replay-tick discharge spacing',
      'next.lastAttackTime versus current.nextPrimaryAttack',
    ],
    tolerance: {
      absoluteSeconds: 1 / TICKS_PER_SECOND,
      relativeOfCandidate: 0.05,
      rationale: 'Same one-tick + 5% tolerance family used by Scripts166-169. No retuning after observing prior failures.',
    },
    authorityPromotion: 'NONE',
  },
  counts: {
    runtimeDischargesWithReadyDelay: rows.length,
    script166StrictRowsReproduced: strictRows.length,
    strictBurstRows: strictBurstRows.length,
    strictBurstBoundaryRows: strictBoundaryRows.length,
    strictBurstPositiveRows: strictPositiveRows.length,
    strictNonBurstRows: strictNonBurstRows.length,
    comparableConsecutivePairs: pairs.length,
    sustainedPairs: sustainedPairs.length,
    burstBoundaryPairs: burstBoundaryPairs.length,
    burstBoundarySustainedPairs: burstBoundarySustained.length,
    burstPositivePairs: burstPositivePairs.length,
    burstPositiveSustainedPairs: burstPositiveSustained.length,
    nonBurstPairs: nonBurstPairs.length,
    nonBurstSustainedPairs: nonBurstSustained.length,
  },
  actualSpacingCandidateAlignment: summaries,
  timingFieldCrossChecks: timing,
  byHero,
  diagnosticClassification: classification,
  validation: {
    integrityPass,
    semanticValidation: 'DIAGNOSTIC_ONLY_NOT_AUTHORITY_PROMOTION',
    replicationStatus: 'SINGLE_REPLAY_DISCOVERY',
    checks,
  },
  interpretation: {
    readyDelayBoundary: 'Script168 rejected a delayed-network-field settlement mechanism. Script170 therefore tests whether the boundary ready-delay itself matches the timing of the next actual discharge.',
    cyclePlusIntraGuardrail: 'cycle + intra is included because Script168 pre-registered the one-intra offset pattern. It is a candidate to test against actual behavior, not a post-hoc correction applied to the carrier.',
    voluntaryDelayGuardrail: 'All consecutive pairs are reported. Strong static semantic conclusions should rely primarily on the Script167-compatible sustained subset because arbitrary player input can only lengthen actual shot spacing.',
  },
  nextStage: nextStage(classification),
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('ACTUAL DISCHARGE SPACING VS STATIC CADENCE V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                              ${replayName}`);
console.log('Replay parsing:                      NONE');
console.log('Strict baseline:                     Script166 reproduced');
console.log('Hidden cadence item evidence:        Script169 = NONE');
console.log('Field-phase correction applied:      NO');
console.log('');
console.log('INTEGRITY REPRODUCTION');
console.log('----------------------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log('PAIR COVERAGE');
console.log('-------------');
console.log(`strict baseline rows:                 ${strictRows.length}`);
console.log(`comparable consecutive pairs:         ${pairs.length}`);
console.log(`Script167-compatible sustained pairs: ${sustainedPairs.length}`);
console.log(`burst boundary sustained:             ${burstBoundarySustained.length}`);
console.log(`burst positive sustained:             ${burstPositiveSustained.length}`);
console.log(`non-burst sustained:                  ${nonBurstSustained.length}`);
console.log('');
console.log('BURST BOUNDARY ACTUAL SPACING — SUSTAINED');
console.log('------------------------------------------');
printCandidates(summaries.burstBoundarySustained);
console.log('');
console.log('BURST POSITIVE ACTUAL SPACING — SUSTAINED');
console.log('------------------------------------------');
printCandidates(summaries.burstPositiveSustained);
console.log('');
console.log('NON-BURST ACTUAL SPACING — SUSTAINED');
console.log('------------------------------------');
printCandidates(summaries.nonBurstSustained);
console.log('');
console.log('TIMING FIELD CROSS-CHECK — BURST BOUNDARY SUSTAINED');
console.log('---------------------------------------------------');
printTiming('lastAttack delta ~= replay spacing', timing.burstBoundarySustained.lastAttackDeltaVsActualSpacing);
printTiming('next lastAttack ~= current nextPrimary', timing.burstBoundarySustained.nextAttackScheduledAtCurrentNextPrimary);
console.log('');
console.log('BY HERO — SUSTAINED');
console.log('-------------------');
for (const row of byHero) {
  const keyKind = row.regime === 'BURST'
    ? (findCandidate(row.burstBoundarySustainedCandidateSummary, 'CYCLE_PLUS_INTRA') ? 'CYCLE_PLUS_INTRA' : 'INTRA_BURST_CYCLE_TIME')
    : 'NON_BURST_CYCLE';
  const summary = row.regime === 'BURST'
    ? (findCandidate(row.burstBoundarySustainedCandidateSummary, keyKind) ?? findCandidate(row.burstPositiveSustainedCandidateSummary, 'INTRA_BURST_CYCLE_TIME'))
    : findCandidate(row.nonBurstSustainedCandidateSummary, keyKind);
  const ready = findCandidate(row.sustainedCandidateSummary, 'CURRENT_READY_DELAY');
  console.log(
    `hero=${String(row.heroId).padEnd(4)} ${String(row.displayName ?? '').padEnd(18)}`
    + ` regime=${String(row.regime ?? '').padEnd(30)}`
    + ` pairs=${String(row.sustainedPairs).padEnd(6)}`
    + ` static=${percent(summary?.alignmentRate).padEnd(7)}`
    + ` ready=${percent(ready?.alignmentRate)}`
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

function nextStage(value) {
  if (value === 'ACTUAL_BURST_SPACING_SUPPORTS_CYCLE_PLUS_INTRA_RUNTIME_BOUNDARY_SCHEDULE') {
    return 'BUILD_CADENCE_ALIGNMENT_V02_USING_OBSERVED_BURST_BOUNDARY_SCHEDULE_SEMANTICS_THEN_REASSESS_NON_BURST_OUTLIERS_WITHOUT_RETUNING_THRESHOLDS';
  }
  if (value === 'ACTUAL_BURST_SPACING_SUPPORTS_FULL_CYCLE_RUNTIME_BOUNDARY_SCHEDULE') {
    return 'BUILD_CADENCE_ALIGNMENT_V02_WITH_FULL_CYCLE_BURST_BOUNDARY_SEMANTICS_THEN_REASSESS_NON_BURST_OUTLIERS';
  }
  if (value === 'ACTUAL_BURST_SPACING_SUPPORTS_READY_CARRIER_BUT_STATIC_BOUNDARY_MAPPING_REMAINS_UNRESOLVED') {
    return 'AUDIT_FULL_PRIMARY_WEAPON_RESOURCE_FIELDS_FOR_BURST_COOLDOWN_OR_SCHEDULING_FIELDS_BEFORE_ANY_FORMULA REVISION';
  }
  if (value === 'NON_BURST_STATIC_ALIGNMENT_STRONG_BUT_BURST_BOUNDARY_REMAINS_UNRESOLVED') {
    return 'AUDIT_BURST_SPECIFIC_STATIC_RESOURCE_FIELDS_AND_RUNTIME_SCHEDULE_CARRIERS';
  }
  return 'DIAGNOSE_ACTUAL_SPACING_BY_HERO_AND_FULL_WEAPON_RESOURCE_FIELDS_BEFORE_FIRE_RATE_RETEST';
}

function printCandidates(rows) {
  for (const row of rows ?? []) {
    console.log(
      `${row.kind.padEnd(28)}`
      + ` ${String(row.aligned).padStart(5)}/${String(row.comparable).padEnd(5)}`
      + ` (${percent(row.alignmentRate).padEnd(7)})`
      + ` medRatio=${format(row.ratioToCandidate?.median)}`
      + ` medErr=${format(row.absoluteErrorSeconds?.median)}s`
    );
  }
}

function printTiming(label, row) {
  console.log(
    `${label.padEnd(40)}`
    + ` ${String(row?.aligned ?? 0).padStart(5)}/${String(row?.comparable ?? 0).padEnd(5)}`
    + ` (${percent(row?.alignmentRate).padEnd(7)})`
    + ` medErr=${format(row?.absoluteErrorSeconds?.median)}s`
  );
}

function rowKey(row) {
  return [
    row?.playerKey ?? '',
    row?.weaponEntityIndex ?? '',
    row?.tick ?? '',
    finite(row?.observedWeaponState?.shotNumber) ?? 'NULL',
  ].join('|');
}

function compareRows(a, b) {
  return (a.tick - b.tick)
    || String(a.playerKey ?? '').localeCompare(String(b.playerKey ?? ''))
    || ((a.weaponEntityIndex ?? 0) - (b.weaponEntityIndex ?? 0));
}

function groupBy(groupRows, keyFn) {
  const map = new Map();
  for (const row of groupRows ?? []) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function findGroup(rows, key) {
  return (rows ?? []).find(row => row?.key === key) ?? null;
}

function findCandidate(rows, kind) {
  return (rows ?? []).find(row => row?.kind === kind) ?? null;
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(a, b) {
  return b > 0 ? a / b : null;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function percent(value) {
  return Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : 'n/a';
}

function format(value) {
  return Number.isFinite(value) ? value.toFixed(4) : 'n/a';
}
