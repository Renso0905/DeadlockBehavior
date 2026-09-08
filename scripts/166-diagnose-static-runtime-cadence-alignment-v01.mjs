import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { extractFireRateContext } from '../src/player-state/effective-weapon-fire-rate-context.mjs';
import {
  classifyReadyDelayAgainstStatic,
  isCleanExplicitFireRateBaseline,
  selectDominantActiveFireMode,
  summarizeAlignment,
} from '../src/player-state/static-cadence-alignment.mjs';

const VERSION = 'STATIC_RUNTIME_CADENCE_ALIGNMENT_DIAGNOSTIC_V01';
const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayName = basename(resolve(replayArgument), extname(replayArgument));
const TICKS_PER_SECOND = 64;

const PATHS = {
  script161: resolve('output', replayName, 'effective_weapon_state_substrate_v01.json'),
  events: resolve('output', replayName, 'effective_weapon_runtime_events_v01.jsonl'),
  script165: resolve('output', 'cross_replay', 'primary_weapon_static_cadence_substrate_v02.json'),
  output: resolve('output', replayName, 'static_runtime_cadence_alignment_diagnostic_v01.json'),
};

for (const path of [PATHS.script161, PATHS.events, PATHS.script165]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const script161 = JSON.parse(readFileSync(PATHS.script161, 'utf8'));
const script165 = JSON.parse(readFileSync(PATHS.script165, 'utf8'));

if (script161?.status !== 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION') {
  throw new Error(`Script161 not ready. Status=${script161?.status}`);
}
if (script165?.status !== 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V02_READY_FOR_INTERPRETATION') {
  throw new Error(`Script165 V02 not ready. Status=${script165?.status}`);
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
  const mode = Number.isFinite(row?.observedWeaponState?.activeFireMode)
    ? row.observedWeaponState.activeFireMode
    : null;
  return mode === dominant.activeFireMode;
});

const alignedRows = strictRows.map(row => {
  const weapon = weaponByHeroId.get(Number(row.heroId));
  return {
    heroId: row.heroId,
    playerKey: row.playerKey ?? null,
    weaponEntityIndex: row.weaponEntityIndex,
    tick: row.tick,
    activeFireMode: row?.observedWeaponState?.activeFireMode ?? null,
    burstShotsRemaining: row?.observedWeaponState?.burstShotsRemaining ?? null,
    continuousShots: row?.observedWeaponState?.continuousShots ?? null,
    alignment: classifyReadyDelayAgainstStatic(row, weapon, {
      absoluteToleranceSeconds: 1 / TICKS_PER_SECOND,
      relativeTolerance: 0.05,
    }),
  };
});

const exactComparableRows = alignedRows.filter(row => row.alignment.comparable === true);
const spinRows = alignedRows.filter(row => row.alignment.regime === 'SPIN_UP');
const nonBurstRows = alignedRows.filter(row => row.alignment.regime === 'SINGLE_OR_AUTOMATIC_NON_BURST');
const burstRows = alignedRows.filter(row => row.alignment.regime === 'BURST');

const overall = summarizeAlignment(alignedRows);
const nonBurst = summarizeAlignment(nonBurstRows);
const burst = summarizeAlignment(burstRows);

const byHero = [];
for (const [heroId, heroRows] of groupBy(alignedRows, row => Number(row.heroId))) {
  const weapon = weaponByHeroId.get(Number(heroId));
  const mode = modeByHero.get(Number(heroId)) ?? null;
  const summary = summarizeAlignment(heroRows);
  byHero.push({
    heroId,
    displayName: weapon?.displayName ?? null,
    primaryWeaponRecordKey: weapon?.primaryWeaponRecordKey ?? null,
    staticCadenceRegime: weapon?.weaponInfo?.cadenceRegime ?? null,
    dominantActiveFireMode: mode,
    rows: heroRows.length,
    ...summary,
  });
}
byHero.sort((a, b) => b.rows - a.rows || a.heroId - b.heroId);

const burstByExpectedKind = summarizeGroups(
  burstRows.filter(row => row.alignment.comparable),
  row => row.alignment.expectedKind ?? 'UNKNOWN',
);

const exclusions = {
  allDischargeRowsWithReadyDelay: rows.length,
  staticWeaponUnresolved: rows.filter(row => !row.staticWeaponResolved).length,
  explicitOrUnresolvedFireRateContextPresent: rows.filter(row => row.staticWeaponResolved && !row.cleanExplicitFireRateBaseline).length,
  specialHeroFireRateScalingExcluded: cleanRows.filter(row => row.specialFireRateScaling).length,
  nonDominantFireModeExcluded: cleanNoSpecialScalingRows.length - strictRows.length,
  spinUpRowsDescriptiveOnly: spinRows.length,
};

const classification = classify({
  exactComparable: overall.comparable,
  overallRate: overall.alignmentRate,
  nonBurstComparable: nonBurst.comparable,
  nonBurstRate: nonBurst.alignmentRate,
  burstComparable: burst.comparable,
  burstRate: burst.alignmentRate,
});

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status: 'STATIC_RUNTIME_CADENCE_ALIGNMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION',
  replay: replayName,
  inputs: {
    script161: PATHS.script161,
    script165V02: PATHS.script165,
    runtimeEvents: PATHS.events,
  },
  design: {
    purpose: 'Test whether directly observed ready-delay telemetry naturally partitions according to the build-bound primary-weapon static cadence regime before returning to Fire Rate effect composition.',
    replayParsing: 'NONE',
    baselineFilter: 'Exclude every context with direct, unresolved, non-direct, permanent, or Gun-bridge Fire Rate evidence; also exclude heroes with Script131 special EFireRate scaling from strict baseline alignment.',
    activeFireModeControl: 'Use each hero weapon\'s dominant active-fire-mode among clean baseline discharges; alternate modes are diagnostic exclusions rather than silently mixed.',
    nonBurstExpectation: 'readyDelayCandidateSeconds compared to m_flCycleTime.',
    burstExpectation: 'If m_nBurstShotsRemaining > 0 compare to m_flIntraBurstCycleTime; if zero compare to m_flCycleTime - (burstCount-1)*m_flIntraBurstCycleTime. This follows the resource definition that m_flCycleTime is burst-start to next-burst-start.',
    spinUpExpectation: 'No fixed-cycle semantic test. Static spin-up weapons are retained descriptively for a later dynamic spin-state model.',
    tolerance: {
      absoluteSeconds: 1 / TICKS_PER_SECOND,
      relativeOfStaticInterval: 0.05,
      rationale: 'Frozen before viewing Script166 output; one replay tick plus 5% of the static interval.',
    },
    authorityPromotion: 'NONE',
  },
  counts: {
    runtimeDischargesWithReadyDelay: rows.length,
    cleanExplicitFireRateBaselineRows: cleanRows.length,
    cleanRowsAfterSpecialScalingExclusion: cleanNoSpecialScalingRows.length,
    strictDominantModeRows: strictRows.length,
    exactComparableRows: exactComparableRows.length,
    nonBurstRows: nonBurstRows.length,
    burstRows: burstRows.length,
    spinUpRows: spinRows.length,
    heroesInStrictBaseline: byHero.length,
  },
  exclusions,
  alignment: {
    overall,
    nonBurst,
    burst,
    burstByExpectedKind,
  },
  dominantFireModeByHero: [...modeByHero.entries()].map(([heroId, mode]) => ({ heroId, ...mode })),
  byHero,
  diagnosticClassification: classification,
  interpretation: {
    staticResourceSemantics: 'CCitadelWeaponInfo m_flCycleTime is a static build resource. It is not itself claimed to be runtime effective cadence.',
    readyDelaySemantics: 'Script162 established nextPrimaryAttack-lastAttackTime as an extremely strong lower-bound candidate on the next observed discharge. Script166 tests its static-regime organization, not final Fire Rate stacking semantics.',
    fireRateGuardrail: 'A strong result here would justify a regime-specific return to Fire Rate interventions. It would not validate a universal Fire Rate formula.',
  },
  nextStage: nextStage(classification),
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('STATIC / RUNTIME CADENCE ALIGNMENT DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                              ${replayName}`);
console.log('Replay parsing:                      NONE');
console.log('Static authority:                    Script165 V02');
console.log('Runtime carrier:                     Script161 ready-delay candidate');
console.log('Fire Rate effects composed:          NO');
console.log('Spin-up fixed-cycle assumption:      NO');
console.log('');
console.log('BASELINE FILTER');
console.log('---------------');
console.log(`runtime discharges with ready delay: ${rows.length}`);
console.log(`clean explicit-Fire-Rate rows:        ${cleanRows.length}`);
console.log(`special-scaling rows excluded:        ${exclusions.specialHeroFireRateScalingExcluded}`);
console.log(`alternate-mode rows excluded:         ${exclusions.nonDominantFireModeExcluded}`);
console.log(`strict baseline rows:                 ${strictRows.length}`);
console.log('');
console.log('STATIC ALIGNMENT');
console.log('----------------');
printSummary('overall exact-comparable', overall);
printSummary('non-burst', nonBurst);
printSummary('burst', burst);
console.log(`spin-up descriptive rows:             ${spinRows.length}`);
console.log('');
console.log('BURST EXPECTED INTERVAL');
console.log('-----------------------');
for (const row of burstByExpectedKind) {
  console.log(`${row.key.padEnd(28)} n=${String(row.comparable).padEnd(6)} aligned=${String(row.aligned).padEnd(6)} rate=${percent(row.alignmentRate)}`);
}
console.log('');
console.log('BY HERO');
console.log('-------');
for (const row of byHero) {
  const regime = row.staticCadenceRegime?.regime ?? 'UNRESOLVED';
  console.log(`hero=${String(row.heroId).padEnd(4)} ${String(row.displayName ?? '').padEnd(18)} regime=${regime.padEnd(30)} n=${String(row.comparable).padEnd(6)} aligned=${percent(row.alignmentRate).padEnd(7)} medRatio=${format(row.ratioToStatic?.median)}`);
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

function summarizeGroups(groupRows, keyFn) {
  const groups = new Map();
  for (const row of groupRows ?? []) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .map(([key, rows]) => ({ key, ...summarizeAlignment(rows) }))
    .sort((a, b) => b.comparable - a.comparable || a.key.localeCompare(b.key));
}

function groupBy(groupRows, keyFn) {
  const groups = new Map();
  for (const row of groupRows ?? []) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function classify({ exactComparable, overallRate, nonBurstComparable, nonBurstRate, burstComparable, burstRate }) {
  const enoughOverall = exactComparable >= 100;
  const observedRegimeRates = [];
  if (nonBurstComparable >= 20 && Number.isFinite(nonBurstRate)) observedRegimeRates.push(nonBurstRate);
  if (burstComparable >= 20 && Number.isFinite(burstRate)) observedRegimeRates.push(burstRate);

  if (
    enoughOverall
    && Number.isFinite(overallRate)
    && overallRate >= 0.95
    && observedRegimeRates.length > 0
    && observedRegimeRates.every(rate => rate >= 0.90)
  ) {
    return 'STATIC_CADENCE_REGIMES_STRONGLY_ALIGN_WITH_CLEAN_RUNTIME_READY_DELAY';
  }
  if (enoughOverall && Number.isFinite(overallRate) && overallRate >= 0.80) {
    return 'STATIC_CADENCE_REGIMES_PARTIALLY_ALIGN_RUNTIME_READY_DELAY';
  }
  if (!enoughOverall) {
    return 'STATIC_CADENCE_ALIGNMENT_BASELINE_COVERAGE_INSUFFICIENT';
  }
  return 'STATIC_CADENCE_REGIMES_DO_NOT_DIRECTLY_EXPLAIN_RUNTIME_READY_DELAY';
}

function nextStage(classification) {
  if (classification === 'STATIC_CADENCE_REGIMES_STRONGLY_ALIGN_WITH_CLEAN_RUNTIME_READY_DELAY') {
    return 'RETEST_FIRE_RATE_CONTEXT_RESPONSE_WITH_STATIC_REGIME_NORMALIZATION_AND_SPECIAL_EFIRERATE_SCALING_CONTROL';
  }
  if (classification === 'STATIC_CADENCE_REGIMES_PARTIALLY_ALIGN_RUNTIME_READY_DELAY') {
    return 'DIAGNOSE_BY_HERO_AND_REGIME_OUTLIERS_BEFORE_ANY_FIRE_RATE_RETEST';
  }
  if (classification === 'STATIC_CADENCE_ALIGNMENT_BASELINE_COVERAGE_INSUFFICIENT') {
    return 'EXPAND_CLEAN_BASELINE_COVERAGE_OR_USE_REPLICATION_COHORT_FOR_STATIC_ALIGNMENT_DISCOVERY';
  }
  return 'DIAGNOSE_HIDDEN_RUNTIME_CADENCE_MODIFIERS_OR_WEAPON_SPECIFIC_CYCLE_SEMANTICS';
}

function printSummary(label, summary) {
  console.log(`${label.padEnd(36)} ${summary.aligned}/${summary.comparable} (${percent(summary.alignmentRate)}) medRatio=${format(summary.ratioToStatic?.median)} medErr=${format(summary.absoluteErrorSeconds?.median)}s`);
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function format(value) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : 'n/a';
}
