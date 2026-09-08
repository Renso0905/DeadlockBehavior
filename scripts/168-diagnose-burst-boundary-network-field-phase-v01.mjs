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
  summarizeCandidateAlignment,
} from '../src/player-state/burst-boundary-diagnostic.mjs';
import {
  classifyDischargeSignalProvenance,
  findShortHorizonSameShotSettlement,
  oneIntraOffsetCorrection,
  compareSettledReadyToBurstCandidates,
  summarizeOneIntraCorrections,
  summarizeSignalProvenance,
  summarizeSettlements,
  classifyBoundaryPhaseDiagnostic,
} from '../src/player-state/burst-boundary-phase-diagnostic.mjs';

const VERSION = 'BURST_BOUNDARY_NETWORK_FIELD_PHASE_DIAGNOSTIC_V01';
const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayName = basename(resolve(replayArgument), extname(replayArgument));
const TICKS_PER_SECOND = 64;
const SETTLEMENT_WINDOW_TICKS = 4;
const OPTIONS = { absoluteToleranceSeconds: 1 / TICKS_PER_SECOND, relativeTolerance: 0.05 };

const PATHS = {
  script131: resolve('output', 'cross_replay', 'hero_stat_progression_schema_discovery_v01.json'),
  script161: resolve('output', replayName, 'effective_weapon_state_substrate_v01.json'),
  events: resolve('output', replayName, 'effective_weapon_runtime_events_v01.jsonl'),
  script165: resolve('output', 'cross_replay', 'primary_weapon_static_cadence_substrate_v02.json'),
  script166: resolve('output', replayName, 'static_runtime_cadence_alignment_diagnostic_v01.json'),
  script167: resolve('output', replayName, 'burst_boundary_ready_delay_semantics_diagnostic_v01.json'),
  output: resolve('output', replayName, 'burst_boundary_network_field_phase_diagnostic_v01.json'),
};

for (const path of Object.values(PATHS).filter(path => path !== PATHS.output)) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const script131 = JSON.parse(readFileSync(PATHS.script131, 'utf8'));
const script161 = JSON.parse(readFileSync(PATHS.script161, 'utf8'));
const script165 = JSON.parse(readFileSync(PATHS.script165, 'utf8'));
const script166 = JSON.parse(readFileSync(PATHS.script166, 'utf8'));
const script167 = JSON.parse(readFileSync(PATHS.script167, 'utf8'));

const requiredStatuses = [
  [script131, 'HERO_INTRINSIC_AND_PROGRESSION_STAT_SCHEMA_READY_FOR_INTERPRETATION', 'Script131'],
  [script161, 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION', 'Script161'],
  [script165, 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V02_READY_FOR_INTERPRETATION', 'Script165 V02'],
  [script166, 'STATIC_RUNTIME_CADENCE_ALIGNMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION', 'Script166'],
  [script167, 'BURST_BOUNDARY_READY_DELAY_SEMANTICS_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION', 'Script167'],
];
for (const [artifact, expected, label] of requiredStatuses) {
  if (artifact?.status !== expected) throw new Error(`${label} not ready. Status=${artifact?.status}`);
}

const purchaseFireRateRows = [];
for (const hero of script131?.heroes ?? []) {
  for (const bonus of hero?.purchaseBonuses ?? []) {
    const valueType = String(bonus?.valueType ?? bonus?.raw?.m_ValueType ?? '');
    if (/FIRE.?RATE/i.test(valueType)) {
      purchaseFireRateRows.push({ heroId: hero.heroId, displayName: hero.displayName, ...bonus });
    }
  }
}

const contextsById = new Map((script161.effectContextSignatures ?? []).map(row => [row.id, row]));
const weaponByHeroId = new Map((script165.heroes ?? []).map(row => [Number(row.heroId), row]));

const allEvents = [];
const rl = createInterface({ input: createReadStream(PATHS.events), crlfDelay: Infinity });
let ordinal = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  row.__ordinal = ordinal++;
  allEvents.push(row);
}

const cleanBurstDischarges = [];
for (const row of allEvents) {
  if (row?.transition?.actualDischargeSignal !== true) continue;
  if (!Number.isFinite(row?.transition?.readyDelayCandidateSeconds)) continue;
  if (!Number.isFinite(row?.heroId)) continue;

  const weapon = weaponByHeroId.get(Number(row.heroId)) ?? null;
  if (weapon?.weaponInfo?.cadenceRegime?.regime !== 'BURST') continue;
  if ((weapon?.fireRateScaling?.length ?? 0) > 0) continue;

  const context = contextsById.get(row.effectContextId) ?? null;
  const fireRateContext = context ? extractFireRateContext(context) : null;
  if (!fireRateContext || !isCleanExplicitFireRateBaseline(fireRateContext)) continue;
  cleanBurstDischarges.push(row);
}

const modeByHero = new Map();
for (const [heroId, rows] of groupBy(cleanBurstDischarges, row => Number(row.heroId))) {
  modeByHero.set(heroId, selectDominantActiveFireMode(rows));
}

const strictRows = cleanBurstDischarges
  .filter(row => {
    const dominant = modeByHero.get(Number(row.heroId));
    const mode = finite(row?.observedWeaponState?.activeFireMode);
    return dominant && mode === dominant.activeFireMode;
  })
  .sort(compareRows);

const boundaryRows = strictRows.filter(row => finite(row?.observedWeaponState?.burstShotsRemaining) === 0);
const positiveRows = strictRows.filter(row => finite(row?.observedWeaponState?.burstShotsRemaining) > 0);

const eventsByWeapon = groupBy(
  allEvents,
  row => `${row.playerKey ?? 'NA'}:${row.weaponEntityIndex ?? 'NA'}`,
);
const indexByOrdinal = new Map();
for (const [, rows] of eventsByWeapon) {
  rows.sort((a, b) => a.__ordinal - b.__ordinal);
  rows.forEach((row, index) => indexByOrdinal.set(row.__ordinal, { rows, index }));
}

const diagnosedBoundary = boundaryRows.map(row => diagnoseRow(row));
const diagnosedPositive = positiveRows.map(row => diagnoseRow(row));

const currentBoundarySummary = summarizeCandidateAlignment(
  diagnosedBoundary.map(row => ({ diagnostic: row.currentDiagnostic })),
);
const settledBoundarySummary = summarizeCandidateAlignment(
  diagnosedBoundary
    .filter(row => row.settledDiagnostic?.comparable === true)
    .map(row => ({ diagnostic: row.settledDiagnostic })),
);
const oneIntraBoundarySummary = summarizeOneIntraCorrections(diagnosedBoundary);
const signalBoundarySummary = summarizeSignalProvenance(diagnosedBoundary);
const settlementBoundarySummary = summarizeSettlements(diagnosedBoundary);

const currentPositiveSummary = summarizeCandidateAlignment(
  diagnosedPositive.map(row => ({ diagnostic: row.currentDiagnostic })),
);
const oneIntraPositiveSummary = summarizeOneIntraCorrections(diagnosedPositive);
const signalPositiveSummary = summarizeSignalProvenance(diagnosedPositive);
const settlementPositiveSummary = summarizeSettlements(diagnosedPositive);

const byHero = [];
for (const [heroId, rows] of groupBy(diagnosedBoundary, row => Number(row.heroId))) {
  const weapon = weaponByHeroId.get(Number(heroId));
  const current = summarizeCandidateAlignment(rows.map(row => ({ diagnostic: row.currentDiagnostic })));
  const settled = summarizeCandidateAlignment(
    rows.filter(row => row.settledDiagnostic?.comparable === true).map(row => ({ diagnostic: row.settledDiagnostic })),
  );
  byHero.push({
    heroId,
    displayName: weapon?.displayName ?? null,
    boundaryRows: rows.length,
    currentCandidateSummary: current,
    oneIntraCorrection: summarizeOneIntraCorrections(rows),
    signalProvenance: summarizeSignalProvenance(rows),
    settlement: summarizeSettlements(rows),
    settledCandidateSummary: settled,
  });
}
byHero.sort((a, b) => b.boundaryRows - a.boundaryRows || a.heroId - b.heroId);

const currentFull = findKind(currentBoundarySummary, 'FULL_CYCLE_TIME');
const settledFull = findKind(settledBoundarySummary, 'FULL_CYCLE_TIME');
const classification = classifyBoundaryPhaseDiagnostic({
  boundaryCount: boundaryRows.length,
  currentFullCycleAlignmentRate: currentFull?.alignmentRate ?? null,
  oneIntraSummary: oneIntraBoundarySummary,
  settledFullCycleAlignmentRate: settledFull?.alignmentRate ?? null,
  settledComparable: settledFull?.comparable ?? 0,
  timingMutationCount: settlementBoundarySummary.withTimingMutationEvent,
});

const checks = {
  script167BurstCohortReproduced: check(
    strictRows.length,
    script167?.counts?.strictBurstDischarges ?? null,
    strictRows.length === script167?.counts?.strictBurstDischarges,
  ),
  script167BoundaryCohortReproduced: check(
    boundaryRows.length,
    script167?.counts?.boundaryRowsZeroRemaining ?? null,
    boundaryRows.length === script167?.counts?.boundaryRowsZeroRemaining,
  ),
  script167PositiveCohortReproduced: check(
    positiveRows.length,
    script167?.counts?.nonBoundaryRowsPositiveRemaining ?? null,
    positiveRows.length === script167?.counts?.nonBoundaryRowsPositiveRemaining,
  ),
  noScript131PurchaseFireRateRows: check(
    purchaseFireRateRows.length,
    0,
    purchaseFireRateRows.length === 0,
  ),
  script167CurrentFullCycleResultReproduced: check(
    { aligned: currentFull?.aligned ?? null, comparable: currentFull?.comparable ?? null },
    {
      aligned: findKind(script167?.boundaryCandidateSummary, 'FULL_CYCLE_TIME')?.aligned ?? null,
      comparable: findKind(script167?.boundaryCandidateSummary, 'FULL_CYCLE_TIME')?.comparable ?? null,
    },
    currentFull?.aligned === findKind(script167?.boundaryCandidateSummary, 'FULL_CYCLE_TIME')?.aligned
      && currentFull?.comparable === findKind(script167?.boundaryCandidateSummary, 'FULL_CYCLE_TIME')?.comparable,
  ),
};
const integrityPass = Object.values(checks).every(row => row.pass);
const status = integrityPass
  ? 'BURST_BOUNDARY_NETWORK_FIELD_PHASE_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
  : 'BURST_BOUNDARY_NETWORK_FIELD_PHASE_DIAGNOSTIC_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  replay: replayName,
  inputs: PATHS,
  design: {
    purpose: 'Test whether Script167 zero-remaining burst-boundary ready-delay inflation is caused by independently networked lastAttackTime / nextPrimaryAttack fields settling on different mutation boundaries.',
    replayParsing: 'NONE',
    fieldPhaseHypothesis: 'Script167 medians imply ready/cycle=1.3009 and ready/intra=4.0654; algebraically subtracting one intra interval predicts approximately 0.981 cycle. This is treated as a falsifiable hypothesis, not a correction.',
    shortHorizonSettlementWindowTicks: SETTLEMENT_WINDOW_TICKS,
    shortHorizonSettlementWindowSeconds: SETTLEMENT_WINDOW_TICKS / TICKS_PER_SECOND,
    settlementRule: 'Within same player/weapon, effect context, active fire mode, and unchanged shotNumber, inspect up to four replay ticks after the discharge event for timing-field mutations.',
    tolerance: OPTIONS,
    fireRateProgressionGuard: 'Script131 purchase bonuses are scanned explicitly for FIRE_RATE rows; any such rows fail integrity rather than being silently ignored.',
    authorityPromotion: 'NONE',
  },
  counts: {
    allWeaponEvents: allEvents.length,
    cleanBurstDischarges: cleanBurstDischarges.length,
    strictBurstDischarges: strictRows.length,
    boundaryRowsZeroRemaining: boundaryRows.length,
    positiveRows: positiveRows.length,
    script131PurchaseFireRateRows: purchaseFireRateRows.length,
  },
  purchaseFireRateRows,
  boundary: {
    currentCandidateSummary: currentBoundarySummary,
    oneIntraCorrection: oneIntraBoundarySummary,
    signalProvenance: signalBoundarySummary,
    shortHorizonSettlement: settlementBoundarySummary,
    settledCandidateSummary: settledBoundarySummary,
  },
  positiveRemainingControl: {
    currentCandidateSummary: currentPositiveSummary,
    oneIntraCorrection: oneIntraPositiveSummary,
    signalProvenance: signalPositiveSummary,
    shortHorizonSettlement: settlementPositiveSummary,
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
    guardrail: 'A one-intra algebraic correction is not accepted as semantics by itself. Promotion requires observed short-horizon field settlement or another independently observed runtime carrier.',
  },
  nextStage: nextStage(classification),
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('BURST BOUNDARY NETWORK-FIELD PHASE DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                              ${replayName}`);
console.log('Replay parsing:                      NONE');
console.log(`Short-horizon settlement window:     ${SETTLEMENT_WINDOW_TICKS} ticks (${(SETTLEMENT_WINDOW_TICKS / TICKS_PER_SECOND).toFixed(4)}s)`);
console.log('Thresholds retuned:                  NO');
console.log('Authority promotion:                 NONE');
console.log('');
console.log('INTEGRITY REPRODUCTION');
console.log('----------------------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(43)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log('BURST COHORT');
console.log('------------');
console.log(`strict burst discharges:              ${strictRows.length}`);
console.log(`zero-remaining boundary rows:         ${boundaryRows.length}`);
console.log(`positive-remaining control rows:      ${positiveRows.length}`);
console.log(`Script131 purchase Fire Rate rows:    ${purchaseFireRateRows.length}`);
console.log('');
console.log('BOUNDARY CURRENT READY-DELAY');
console.log('----------------------------');
for (const row of currentBoundarySummary) printCandidate(row);
console.log('');
console.log('ONE-INTRA OFFSET HYPOTHESIS');
console.log('---------------------------');
console.log(`corrected -> full cycle:              ${oneIntraBoundarySummary.alignedToFullCycle}/${oneIntraBoundarySummary.comparable} (${percent(oneIntraBoundarySummary.alignmentRate)})`);
console.log(`corrected/full-cycle median ratio:    ${format(oneIntraBoundarySummary.correctedRatioToFullCycle?.median)}`);
console.log(`corrected median absolute error:      ${format(oneIntraBoundarySummary.correctedAbsoluteErrorSeconds?.median)}s`);
console.log('');
console.log('BOUNDARY SIGNAL / FIELD PHASE');
console.log('-----------------------------');
console.log(`signal provenance:                    ${JSON.stringify(signalBoundarySummary.counts)}`);
console.log(`current event changed lastAttack:     ${signalBoundarySummary.changedLastAttackField}/${signalBoundarySummary.total}`);
console.log(`current event changed nextPrimary:    ${signalBoundarySummary.changedNextPrimaryField}/${signalBoundarySummary.total}`);
console.log(`current event changed both timing:    ${signalBoundarySummary.changedBothTimingFields}/${signalBoundarySummary.total}`);
console.log(`same-shot follow-up <=4t:             ${settlementBoundarySummary.withSubsequentSameShotEvent}/${settlementBoundarySummary.comparable}`);
console.log(`timing mutation follow-up <=4t:       ${settlementBoundarySummary.withTimingMutationEvent}/${settlementBoundarySummary.comparable}`);
console.log(`lastAttack advances <=4t:             ${settlementBoundarySummary.lastAttackAdvancedWithinWindow}/${settlementBoundarySummary.comparable}`);
console.log(`nextPrimary changes <=4t:             ${settlementBoundarySummary.nextPrimaryChangedWithinWindow}/${settlementBoundarySummary.comparable}`);
console.log('');
console.log('SETTLED SAME-SHOT READY-DELAY');
console.log('-----------------------------');
for (const row of settledBoundarySummary) printCandidate(row);
console.log('');
console.log('BY HERO BOUNDARY');
console.log('----------------');
for (const row of byHero) {
  const current = findKind(row.currentCandidateSummary, 'FULL_CYCLE_TIME');
  const settled = findKind(row.settledCandidateSummary, 'FULL_CYCLE_TIME');
  console.log(
    `hero=${String(row.heroId).padEnd(4)} ${String(row.displayName ?? '').padEnd(18)}`
    + ` n=${String(row.boundaryRows).padEnd(5)}`
    + ` currentFull=${percent(current?.alignmentRate).padEnd(7)}`
    + ` minusIntra=${percent(row.oneIntraCorrection?.alignmentRate).padEnd(7)}`
    + ` settledFull=${percent(settled?.alignmentRate).padEnd(7)}`
    + ` timingMut=${String(row.settlement?.withTimingMutationEvent ?? 0)}`
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

function diagnoseRow(row) {
  const weapon = weaponByHeroId.get(Number(row.heroId));
  const ref = indexByOrdinal.get(row.__ordinal);
  const settlement = ref
    ? findShortHorizonSameShotSettlement(ref.rows, ref.index, { maxTickOffset: SETTLEMENT_WINDOW_TICKS })
    : { comparable: false, reason: 'EVENT_INDEX_UNRESOLVED' };
  return {
    heroId: row.heroId,
    playerKey: row.playerKey ?? null,
    weaponEntityIndex: row.weaponEntityIndex,
    tick: row.tick,
    signalProvenance: classifyDischargeSignalProvenance(row),
    currentDiagnostic: compareBurstBoundaryCandidates(row, weapon, OPTIONS),
    oneIntra: oneIntraOffsetCorrection(row, weapon, OPTIONS),
    settlement,
    settledDiagnostic: compareSettledReadyToBurstCandidates(settlement, row, weapon, OPTIONS),
  };
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

function compareRows(a, b) {
  return (a.tick - b.tick)
    || String(a.playerKey ?? '').localeCompare(String(b.playerKey ?? ''))
    || ((a.weaponEntityIndex ?? 0) - (b.weaponEntityIndex ?? 0))
    || ((a.__ordinal ?? 0) - (b.__ordinal ?? 0));
}

function findKind(summary, kind) {
  return (summary ?? []).find(row => row.kind === kind) ?? null;
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

function nextStage(classification) {
  if (classification === 'BURST_BOUNDARY_ONE_INTRA_OFFSET_CONFIRMED_BY_SHORT_HORIZON_FIELD_SETTLEMENT') {
    return 'BUILD_NEW_RUNTIME_CADENCE_CARRIER_USING_SETTLED_POST_SHOT_TIMING_STATE_THEN_REVALIDATE_BURST_AND_NON_BURST_ALIGNMENT';
  }
  if (classification === 'BURST_BOUNDARY_ONE_INTRA_OFFSET_PATTERN_WITHOUT_FIELD_SETTLEMENT_CONFIRMATION') {
    return 'DO_NOT_CORRECT_ALGEBRAICALLY; INSPECT_RAW_ENTITY_MUTATION_ORDER_OR_ADDITIONAL_WEAPON_TIMING_FIELDS_AT_BURST_BOUNDARY';
  }
  if (classification === 'BURST_BOUNDARY_SHORT_HORIZON_FIELD_SETTLEMENT_RECOVERS_FULL_CYCLE_WITHOUT_EXACT_ONE_INTRA_PATTERN') {
    return 'BUILD_SETTLED_POST_SHOT_READY_CARRIER_AND_REVALIDATE_STATIC_ALIGNMENT';
  }
  return 'DIAGNOSE_HERO_WEAPON_RESOURCE_OR_ADDITIONAL_RUNTIME_TIMING_FIELDS; DO_NOT RETUNE SCRIPT166_THRESHOLDS';
}

function check(actual, expected, pass) { return { actual, expected, pass: Boolean(pass) }; }
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function percent(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a'; }
function format(value) { return Number.isFinite(value) ? Number(value).toFixed(4) : 'n/a'; }
