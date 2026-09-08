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
import { applyStateEvent, emptyPlayerState } from '../src/player-state/runtime-state-timeline.mjs';
import {
  buildOwnedCadenceContext,
  summarizeCadenceAuditRows,
  summarizeCatalogCadenceGap,
} from '../src/player-state/cadence-modifier-audit.mjs';

const VERSION = 'HIDDEN_CADENCE_MODIFIER_CONTEXT_AUDIT_V01';
const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayName = basename(resolve(replayArgument), extname(replayArgument));
const TICKS_PER_SECOND = 64;

const PATHS = {
  script139: resolve('output', 'cross_replay', 'standard_shop_item_effect_substrate_v03.json'),
  integrated: resolve('output', replayName, 'integrated_authoritative_player_state_substrate_v01.json'),
  script161: resolve('output', replayName, 'effective_weapon_state_substrate_v01.json'),
  events: resolve('output', replayName, 'effective_weapon_runtime_events_v01.jsonl'),
  script165: resolve('output', 'cross_replay', 'primary_weapon_static_cadence_substrate_v02.json'),
  script166: resolve('output', replayName, 'static_runtime_cadence_alignment_diagnostic_v01.json'),
  output: resolve('output', replayName, 'hidden_cadence_modifier_context_audit_v01.json'),
};

for (const path of Object.values(PATHS).filter(path => path !== PATHS.output)) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const script139 = JSON.parse(readFileSync(PATHS.script139, 'utf8'));
const integrated = JSON.parse(readFileSync(PATHS.integrated, 'utf8'));
const script161 = JSON.parse(readFileSync(PATHS.script161, 'utf8'));
const script165 = JSON.parse(readFileSync(PATHS.script165, 'utf8'));
const script166 = JSON.parse(readFileSync(PATHS.script166, 'utf8'));

if (script139?.status !== 'STANDARD_SHOP_ITEM_EFFECT_SUBSTRATE_V03_READY') throw new Error(`Script139 not ready. Status=${script139?.status}`);
if (integrated?.status !== 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01_READY_FOR_VALIDATION') throw new Error(`Integrated PlayerState artifact not ready. Status=${integrated?.status}`);
if (script161?.status !== 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION') throw new Error(`Script161 not ready. Status=${script161?.status}`);
if (script165?.status !== 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V02_READY_FOR_INTERPRETATION') throw new Error(`Script165 V02 not ready. Status=${script165?.status}`);
if (script166?.status !== 'STATIC_RUNTIME_CADENCE_ALIGNMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION') throw new Error(`Script166 not ready. Status=${script166?.status}`);

const effects = script139.items ?? [];
const effectsByKey = new Map(effects.map(row => [row.recordKey, row]));
const catalogGap = summarizeCatalogCadenceGap(effects);
const contextsById = new Map((script161.effectContextSignatures ?? []).map(row => [row.id, row]));
const weaponByHeroId = new Map((script165.heroes ?? []).map(row => [Number(row.heroId), row]));

const integratedPlayerByKey = new Map((integrated.players ?? []).map(player => [player.playerKey, player]));

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
  const mode = Number.isFinite(row?.observedWeaponState?.activeFireMode) ? row.observedWeaponState.activeFireMode : null;
  return mode === dominant.activeFireMode;
});

const stateAtStrictTick = new Map();
for (const [playerKey, playerRows] of groupBy(strictRows, row => row.playerKey)) {
  const player = integratedPlayerByKey.get(playerKey) ?? null;
  if (!player) continue;
  const wantedTicks = uniqueSortedNumbers(playerRows.map(row => row.tick));
  const events = [...(player.events ?? [])].sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
  let current = emptyPlayerState(playerKey);
  let eventIndex = 0;
  for (const tick of wantedTicks) {
    while (eventIndex < events.length && Number(events[eventIndex]?.tick) <= tick) {
      current = applyStateEvent(current, events[eventIndex]);
      eventIndex++;
    }
    stateAtStrictTick.set(`${playerKey}|${tick}`, current);
  }
}

const auditedRows = strictRows.map(row => {
  const state = stateAtStrictTick.get(`${row.playerKey}|${row.tick}`) ?? null;
  const cadenceContext = state ? buildOwnedCadenceContext(state, effectsByKey) : null;
  const weapon = weaponByHeroId.get(Number(row.heroId));
  const alignment = classifyReadyDelayAgainstStatic(row, weapon, {
    absoluteToleranceSeconds: 1 / TICKS_PER_SECOND,
    relativeTolerance: 0.05,
  });
  return {
    heroId: row.heroId,
    playerKey: row.playerKey,
    weaponEntityIndex: row.weaponEntityIndex,
    tick: row.tick,
    burstShotsRemaining: row?.observedWeaponState?.burstShotsRemaining ?? null,
    staticCadenceRegime: row.staticCadenceRegime,
    cadenceContext,
    alignment,
  };
});

const timelineJoinMissing = auditedRows.filter(row => !row.cadenceContext).length;
const directFree = auditedRows.filter(row => row.cadenceContext && !row.cadenceContext.hasDirectCadenceEvidence);
const anyEvidenceFree = auditedRows.filter(row => row.cadenceContext && !row.cadenceContext.hasAnyCadenceEvidence);

const strictAudit = summarizeCadenceAuditRows(auditedRows);
const burstBoundary = auditedRows.filter(row => row.staticCadenceRegime === 'BURST' && Number(row.burstShotsRemaining) === 0);
const burstPositive = auditedRows.filter(row => row.staticCadenceRegime === 'BURST' && Number(row.burstShotsRemaining) > 0);
const nonBurst = auditedRows.filter(row => row.staticCadenceRegime === 'SINGLE_OR_AUTOMATIC_NON_BURST');

const sensitivity = {
  originalStrictBaseline: summarizeAlignment(auditedRows),
  directCadenceEvidenceExcluded: summarizeAlignment(directFree),
  anyCadenceEvidenceExcludedConservative: summarizeAlignment(anyEvidenceFree),
  burstBoundaryOriginal: summarizeAlignment(burstBoundary),
  burstBoundaryDirectExcluded: summarizeAlignment(burstBoundary.filter(row => row.cadenceContext && !row.cadenceContext.hasDirectCadenceEvidence)),
  burstBoundaryAnyEvidenceExcluded: summarizeAlignment(burstBoundary.filter(row => row.cadenceContext && !row.cadenceContext.hasAnyCadenceEvidence)),
  burstPositiveOriginal: summarizeAlignment(burstPositive),
  burstPositiveAnyEvidenceExcluded: summarizeAlignment(burstPositive.filter(row => row.cadenceContext && !row.cadenceContext.hasAnyCadenceEvidence)),
  nonBurstOriginal: summarizeAlignment(nonBurst),
  nonBurstAnyEvidenceExcluded: summarizeAlignment(nonBurst.filter(row => row.cadenceContext && !row.cadenceContext.hasAnyCadenceEvidence)),
};

const byHero = [];
for (const [heroId, heroRows] of groupBy(auditedRows, row => Number(row.heroId))) {
  const weapon = weaponByHeroId.get(Number(heroId));
  const all = summarizeCadenceAuditRows(heroRows);
  const boundaryRows = heroRows.filter(row => row.staticCadenceRegime === 'BURST' && Number(row.burstShotsRemaining) === 0);
  byHero.push({
    heroId,
    displayName: weapon?.displayName ?? null,
    regime: weapon?.weaponInfo?.cadenceRegime?.regime ?? null,
    rows: heroRows.length,
    cadenceEvidence: all,
    boundaryCadenceEvidence: summarizeCadenceAuditRows(boundaryRows),
    originalAlignment: summarizeAlignment(heroRows),
    anyCadenceEvidenceExcludedAlignment: summarizeAlignment(heroRows.filter(row => row.cadenceContext && !row.cadenceContext.hasAnyCadenceEvidence)),
    cadenceItemsObserved: uniqueSorted(heroRows.flatMap(row => row.cadenceContext?.itemEvidence?.map(item => item.recordKey) ?? [])),
    hiddenCadenceItemsObserved: uniqueSorted(heroRows.flatMap(row => row.cadenceContext?.hiddenItems?.map(item => item.recordKey) ?? [])),
  });
}
byHero.sort((a, b) => b.rows - a.rows || a.heroId - b.heroId);

const strictCountExpected = script166?.counts?.strictDominantModeRows ?? null;
const checks = {
  script166StrictBaselineReproduced: check(strictRows.length, strictCountExpected, strictRows.length === strictCountExpected),
  integratedPlayersAvailable: check(integratedPlayerByKey.size, script166?.counts?.heroesInStrictBaseline ? '>=heroesInStrictBaseline' : '>0', integratedPlayerByKey.size > 0),
  allStrictRowsJoinPlayerState: check(timelineJoinMissing, 0, timelineJoinMissing === 0),
  script139CatalogLoaded: check(effects.length, 156, effects.length === 156),
  cadenceTokenAuditFound: check(catalogGap.cadenceItems, '>0', catalogGap.cadenceItems > 0),
};
const integrityPass = Object.values(checks).every(row => row.pass);
const classification = classify({ integrityPass, catalogGap, strictAudit, sensitivity });

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status: integrityPass
    ? 'HIDDEN_CADENCE_MODIFIER_CONTEXT_AUDIT_V01_READY_FOR_INTERPRETATION'
    : 'HIDDEN_CADENCE_MODIFIER_CONTEXT_AUDIT_V01_REQUIRES_DIAGNOSIS',
  replay: replayName,
  inputs: PATHS,
  design: {
    purpose: 'Audit whether Script166 clean Fire Rate baseline omitted cadence-affecting item modifier families such as cycle-time, intra-burst, burst-count, and spin-up overrides.',
    replayParsing: 'NONE',
    oldFilterBoundary: 'Script166 filtered FIRE_RATE-family evidence only through Script161 effect contexts. Script169 re-joins authoritative full item ownership to full Script139 item records.',
    directEvidencePolicy: 'Direct provided cadence properties are a stronger resource confound and are excluded in the direct-free sensitivity analysis.',
    nonDirectEvidencePolicy: 'Non-direct cadence tokens remain unresolved conditional/passive/active/proc/internal evidence. Their ownership is used only for conservative sensitivity analysis, not assumed activation.',
    thresholdRetuning: 'NONE',
    authorityPromotion: 'NONE',
  },
  cadenceModifierFamiliesAudited: [
    'FIRE_RATE', 'FIRE_RATE_SLOW', 'CYCLE_TIME', 'CYCLE_TIME_PERCENTAGE',
    'INTRA_BURST_SHOT_CYCLE_TIME_OVERRIDE', 'BONUS_BURST_SHOT_PERCENT',
    'BONUS_BURST_SHOT_CONSTANT', 'SPIN_UP_RATE_OVERRIDE', 'SPIN_UP_DECAY_OVERRIDE',
    'SPIN_UP_MAX_CYCLE_TIME_OVERRIDE', 'SPIN_UP_MAX_BURST_FIRE_COOLDOWN_OVERRIDE',
  ],
  catalogGap,
  counts: {
    runtimeDischargesWithReadyDelay: rows.length,
    script166StrictBaselineRows: strictRows.length,
    timelineJoinMissing,
    burstBoundaryRows: burstBoundary.length,
    burstPositiveRows: burstPositive.length,
    nonBurstRows: nonBurst.length,
  },
  strictBaselineCadenceEvidence: strictAudit,
  subgroupCadenceEvidence: {
    burstBoundary: summarizeCadenceAuditRows(burstBoundary),
    burstPositive: summarizeCadenceAuditRows(burstPositive),
    nonBurst: summarizeCadenceAuditRows(nonBurst),
  },
  sensitivityAlignment: sensitivity,
  byHero,
  integrityValidation: checks,
  diagnosticClassification: classification,
  interpretation: {
    supported: 'Whether Script166 baseline rows carry cadence-relevant item effect evidence that the earlier FIRE_RATE-only classifier could not see.',
    notSupported: 'Ownership of non-direct cadence tokens does not prove runtime activation, stacking order, or exact cycle-time composition.',
  },
  nextStage: nextStage(classification),
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('HIDDEN CADENCE MODIFIER CONTEXT AUDIT V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                              ${replayName}`);
console.log('Replay parsing:                      NONE');
console.log('Script166 thresholds retuned:        NO');
console.log('Non-direct token activation assumed: NO');
console.log('');
console.log('INTEGRITY REPRODUCTION');
console.log('----------------------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log('SCRIPT139 CADENCE CLASSIFIER GAP');
console.log('--------------------------------');
console.log(`catalog cadence-evidence items:      ${catalogGap.cadenceItems}`);
console.log(`old operation-classifier items:      ${catalogGap.oldOperationClassifierItems}`);
console.log(`hidden cadence-evidence items:       ${catalogGap.hiddenFromOldOperationClassifierItems}`);
console.log(`direct cadence items:                ${catalogGap.directCadenceItems}`);
console.log(`non-direct cadence items:            ${catalogGap.nonDirectCadenceItems}`);
console.log('');
console.log('SCRIPT166 STRICT BASELINE AUDIT');
console.log('-------------------------------');
printAudit('strict rows', strictAudit);
printAudit('burst boundary', summarizeCadenceAuditRows(burstBoundary));
printAudit('burst positive', summarizeCadenceAuditRows(burstPositive));
printAudit('non-burst', summarizeCadenceAuditRows(nonBurst));
console.log('');
console.log('ALIGNMENT SENSITIVITY');
console.log('---------------------');
printAlignment('original strict baseline', sensitivity.originalStrictBaseline);
printAlignment('exclude direct cadence evidence', sensitivity.directCadenceEvidenceExcluded);
printAlignment('exclude ANY cadence evidence', sensitivity.anyCadenceEvidenceExcludedConservative);
printAlignment('burst boundary original', sensitivity.burstBoundaryOriginal);
printAlignment('burst boundary exclude ANY', sensitivity.burstBoundaryAnyEvidenceExcluded);
console.log('');
console.log('BY HERO');
console.log('-------');
for (const row of byHero) {
  console.log(`hero=${String(row.heroId).padEnd(4)} ${String(row.displayName ?? '').padEnd(18)} n=${String(row.rows).padEnd(6)} hidden=${String(row.cadenceEvidence.withHiddenCadenceEvidence).padEnd(6)} any=${String(row.cadenceEvidence.withAnyCadenceEvidence).padEnd(6)} align=${percent(row.originalAlignment.alignmentRate).padEnd(7)} cleanAny=${percent(row.anyCadenceEvidenceExcludedAlignment.alignmentRate).padEnd(7)} items=${row.hiddenCadenceItemsObserved.join(',') || '-'}`);
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

function classify({ integrityPass, catalogGap, strictAudit, sensitivity }) {
  if (!integrityPass) return 'CADENCE_MODIFIER_AUDIT_INTEGRITY_FAILURE';
  if ((catalogGap.hiddenFromOldOperationClassifierItems ?? 0) === 0) return 'NO_HIDDEN_CADENCE_MODIFIER_CLASSIFIER_GAP_FOUND';
  const anyRate = strictAudit.anyCadenceEvidenceRate ?? 0;
  const original = sensitivity.originalStrictBaseline?.alignmentRate;
  const cleaned = sensitivity.anyCadenceEvidenceExcludedConservative?.alignmentRate;
  if (anyRate >= 0.05 && Number.isFinite(original) && Number.isFinite(cleaned) && cleaned >= original + 0.05) {
    return 'HIDDEN_CADENCE_ITEM_EVIDENCE_MATERIALLY_CONFOUNDS_SCRIPT166_BASELINE';
  }
  if (anyRate > 0) return 'HIDDEN_CADENCE_ITEM_EVIDENCE_PRESENT_BUT_DOES_NOT_YET_EXPLAIN_SCRIPT166_MISALIGNMENT';
  return 'SCRIPT166_STRICT_ROWS_HAVE_NO_OWNED_HIDDEN_CADENCE_ITEM_EVIDENCE';
}

function nextStage(classification) {
  if (classification === 'HIDDEN_CADENCE_ITEM_EVIDENCE_MATERIALLY_CONFOUNDS_SCRIPT166_BASELINE') {
    return 'BUILD_CADENCE_CONTEXT_V02_WITH_EXPANDED_MODIFIER_FAMILIES_THEN_RERUN_STATIC_ALIGNMENT_WITHOUT_RETUNING_THRESHOLDS';
  }
  if (classification === 'HIDDEN_CADENCE_ITEM_EVIDENCE_PRESENT_BUT_DOES_NOT_YET_EXPLAIN_SCRIPT166_MISALIGNMENT') {
    return 'DIAGNOSE_ACTUAL_NEXT_DISCHARGE_SPACING_AND_HERO_SPECIFIC_RUNTIME_CADENCE_FIELDS_AFTER ACCOUNTING_FOR_HIDDEN_CADENCE_CONTEXT';
  }
  if (classification === 'SCRIPT166_STRICT_ROWS_HAVE_NO_OWNED_HIDDEN_CADENCE_ITEM_EVIDENCE' || classification === 'NO_HIDDEN_CADENCE_MODIFIER_CLASSIFIER_GAP_FOUND') {
    return 'DIAGNOSE_ACTUAL_NEXT_DISCHARGE_SPACING_VERSUS_STATIC_BURST_CANDIDATES_AND_ADDITIONAL_RUNTIME_TIMING_FIELDS';
  }
  return 'DIAGNOSE_AUDIT_INPUT_OR_COHORT_REPRODUCTION_BEFORE_FURTHER_CADENCE_INTERPRETATION';
}

function printAudit(label, row) {
  console.log(`${label.padEnd(30)} n=${String(row.total).padEnd(6)} direct=${String(row.withDirectCadenceEvidence).padEnd(6)} any=${String(row.withAnyCadenceEvidence).padEnd(6)} hidden=${String(row.withHiddenCadenceEvidence).padEnd(6)}`);
}

function printAlignment(label, row) {
  console.log(`${label.padEnd(36)} ${row.aligned}/${row.comparable} (${percent(row.alignmentRate)}) medRatio=${format(row.ratioToStatic?.median)}`);
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

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
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
