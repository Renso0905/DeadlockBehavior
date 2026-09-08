import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import {
  buildDischargeSegments,
  classifyFireRateContextChange,
} from '../src/player-state/effective-weapon-fire-rate-context.mjs';
import {
  directionAgreement,
  matchExactCadenceRegimes,
  transitionConfounds,
} from '../src/player-state/effective-weapon-cadence-regime.mjs';

const VERSION = 'READY_DELAY_FIRE_RATE_REGIME_CONFOUND_DIAGNOSTIC_V01';
const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayName = basename(resolve(replayArgument), extname(replayArgument));
const WINDOW = 8;
const MIN_WINDOW = 3;

const PATHS = {
  script161: resolve('output', replayName, 'effective_weapon_state_substrate_v01.json'),
  events: resolve('output', replayName, 'effective_weapon_runtime_events_v01.jsonl'),
  script163: resolve('output', replayName, 'ready_delay_fire_rate_context_response_discovery_v01.json'),
  output: resolve('output', replayName, 'ready_delay_fire_rate_regime_confound_diagnostic_v01.json'),
};
for (const path of [PATHS.script161, PATHS.events, PATHS.script163]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const script161 = JSON.parse(readFileSync(PATHS.script161, 'utf8'));
const script163 = JSON.parse(readFileSync(PATHS.script163, 'utf8'));
if (script161?.status !== 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION') {
  throw new Error(`Script161 not ready: ${script161?.status}`);
}
if (script163?.status !== 'READY_DELAY_FIRE_RATE_CONTEXT_RESPONSE_V01_READY_FOR_INTERPRETATION') {
  throw new Error(`Script163 not ready: ${script163?.status}`);
}

const contextsById = new Map((script161.effectContextSignatures ?? []).map(row => [row.id, row]));
const rows = [];
const rl = createInterface({ input: createReadStream(PATHS.events), crlfDelay: Infinity });
for await (const line of rl) {
  if (line.trim()) rows.push(JSON.parse(line));
}
const segments = buildDischargeSegments(rows, contextsById);
const transitions = [];
const byWeapon = new Map();
for (const segment of segments) {
  if (!byWeapon.has(segment.weaponEntityIndex)) byWeapon.set(segment.weaponEntityIndex, []);
  byWeapon.get(segment.weaponEntityIndex).push(segment);
}

for (const weaponSegments of byWeapon.values()) {
  weaponSegments.sort((a, b) => firstTick(a) - firstTick(b));
  for (let i = 0; i + 1 < weaponSegments.length; i++) {
    const before = weaponSegments[i];
    const after = weaponSegments[i + 1];
    if (before.fireRateContext.signature === after.fireRateContext.signature) continue;
    if (before.activeFireMode !== after.activeFireMode) continue;
    const change = classifyFireRateContextChange(before.fireRateContext, after.fireRateContext);
    if (!change.directional) continue;

    const beforeLocal = before.rows.slice(-WINDOW);
    const afterLocal = after.rows.slice(0, WINDOW);
    if (beforeLocal.length < MIN_WINDOW || afterLocal.length < MIN_WINDOW) continue;
    const beforeMedian = median(beforeLocal.map(ready));
    const afterMedian = median(afterLocal.map(ready));
    const localAgreement = directionAgreement(beforeMedian, afterMedian, change.expectedReadyDirection);
    const confounds = transitionConfounds(beforeLocal, afterLocal);
    const immediateAgreement = directionAgreement(
      confounds.immediateBeforeReadySeconds,
      confounds.immediateAfterReadySeconds,
      change.expectedReadyDirection,
    );
    const exact = matchExactCadenceRegimes(before.rows, after.rows, change.expectedReadyDirection, { includeLevel: true });
    const exactNoLevel = matchExactCadenceRegimes(before.rows, after.rows, change.expectedReadyDirection, { includeLevel: false });
    const exactTransitionAgreement = exact.matchedRegimes > 0
      ? exact.agreementRate >= 0.5
      : null;

    transitions.push({
      weaponEntityIndex: before.weaponEntityIndex,
      playerKey: before.playerKey ?? after.playerKey ?? null,
      heroId: before.heroId ?? after.heroId ?? null,
      activeFireMode: before.activeFireMode,
      boundaryTick: firstTick(after),
      sourceKinds: change.sourceKinds,
      expectedReadyDirection: change.expectedReadyDirection,
      evidence: change.evidence,
      local: {
        beforeSamples: beforeLocal.length,
        afterSamples: afterLocal.length,
        beforeMedianSeconds: beforeMedian,
        afterMedianSeconds: afterMedian,
        relativeChange: Number.isFinite(beforeMedian) && Math.abs(beforeMedian) > 1e-12 ? (afterMedian - beforeMedian) / beforeMedian : null,
        directionAgreement: localAgreement,
      },
      immediateDirectionAgreement: immediateAgreement,
      confounds,
      exactRegimeWithLevel: exact,
      exactRegimeWithoutLevel: exactNoLevel,
      exactTransitionAgreement,
    });
  }
}

const localAgreements = transitions.filter(row => row.local.directionAgreement === true).length;
const immediateComparable = transitions.filter(row => row.immediateDirectionAgreement !== null);
const immediateAgreements = immediateComparable.filter(row => row.immediateDirectionAgreement === true).length;
const exactMatchable = transitions.filter(row => row.exactRegimeWithLevel.matchedRegimes > 0);
const exactRegimeMatches = exactMatchable.flatMap(row => row.exactRegimeWithLevel.matches);
const exactRegimeAgreements = exactRegimeMatches.filter(row => row.directionAgreement === true).length;
const noLevelMatchable = transitions.filter(row => row.exactRegimeWithoutLevel.matchedRegimes > 0);
const noLevelMatches = noLevelMatchable.flatMap(row => row.exactRegimeWithoutLevel.matches);
const noLevelAgreements = noLevelMatches.filter(row => row.directionAgreement === true).length;

const confoundCounts = {
  levelChanged: countTrue(transitions, row => row.confounds.levelChanged),
  continuousCounterReset: countTrue(transitions, row => row.confounds.continuousCounterReset),
  continuousCounterChanged: countTrue(transitions, row => row.confounds.continuousCounterChanged),
  burstCounterChanged: countTrue(transitions, row => row.confounds.burstCounterChanged),
  gapOver10ReadyIntervals: countTrue(transitions, row => Number.isFinite(row.confounds.gapReadyUnits) && row.confounds.gapReadyUnits > 10),
};

const bySourceKind = summarizeGroups(transitions, row => row.sourceKinds.join('+') || 'UNKNOWN');
const byHero = summarizeGroups(transitions, row => String(row.heroId ?? 'UNKNOWN'));
const classification = classify({
  exactRegimeMatches: exactRegimeMatches.length,
  exactRegimeAgreementRate: ratio(exactRegimeAgreements, exactRegimeMatches.length),
  noLevelMatches: noLevelMatches.length,
  noLevelAgreementRate: ratio(noLevelAgreements, noLevelMatches.length),
});

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status: 'READY_DELAY_FIRE_RATE_REGIME_CONFOUND_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION',
  replay: replayName,
  inputs: {
    script161: PATHS.script161,
    script163: PATHS.script163,
    script163DirectionalTransitions: script163?.counts?.directionalTransitionsWithWindow ?? null,
    script163DirectionalAgreementRate: script163?.directionalAgreementRate ?? null,
  },
  design: {
    purpose: 'Diagnose whether Script163 Fire Rate directional disagreements are explained by comparing different internal weapon cadence regimes.',
    noReplayParsing: true,
    localWindowDischargesPerSide: WINDOW,
    exactRuntimeRegime: 'activeFireMode + m_nNumContinuousShots + m_nBurstShotsRemaining + player level',
    secondaryRuntimeRegime: 'activeFireMode + m_nNumContinuousShots + m_nBurstShotsRemaining (level omitted only as a diagnostic contrast)',
    thresholds: 'No Script163 thresholds are retuned. Exact-regime results are diagnostic evidence only.',
  },
  counts: {
    directionalTransitions: transitions.length,
    localDirectionalAgreements: localAgreements,
    immediateComparable: immediateComparable.length,
    immediateAgreements,
    exactLevelControlledMatchableTransitions: exactMatchable.length,
    exactLevelControlledRegimeMatches: exactRegimeMatches.length,
    exactLevelControlledRegimeAgreements: exactRegimeAgreements,
    exactNoLevelMatchableTransitions: noLevelMatchable.length,
    exactNoLevelRegimeMatches: noLevelMatches.length,
    exactNoLevelRegimeAgreements: noLevelAgreements,
  },
  rates: {
    localDirectionalAgreement: ratio(localAgreements, transitions.length),
    immediateDirectionalAgreement: ratio(immediateAgreements, immediateComparable.length),
    exactLevelControlledRegimeAgreement: ratio(exactRegimeAgreements, exactRegimeMatches.length),
    exactNoLevelRegimeAgreement: ratio(noLevelAgreements, noLevelMatches.length),
  },
  confoundCounts,
  bySourceKind,
  byHero,
  diagnosticClassification: classification,
  transitions,
  interpretation: {
    publicSchemaContext: 'Deadlock CCitadelWeaponInfo distinguishes cycle time from intra-burst cycle time; same active fire mode therefore need not imply the same cadence regime.',
    semanticLimit: 'A strong exact-regime result would support re-testing Fire Rate response while conditioning on internal firing state. It would not by itself establish a final Fire Rate formula.',
  },
  nextStage: nextStage(classification),
};
mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('READY-DELAY FIRE-RATE REGIME CONFOUND DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                              ${replayName}`);
console.log('Replay parsing:                      NONE');
console.log('Script163 thresholds retuned:        NO');
console.log('Exact regime:                        level + fire mode + continuous shots + burst remaining');
console.log('');
console.log('SCRIPT163 REPRODUCTION');
console.log('----------------------');
console.log(`directional transitions:             ${transitions.length}`);
console.log(`local median agreements:             ${localAgreements}/${transitions.length} (${percent(ratio(localAgreements, transitions.length))})`);
console.log(`immediate boundary agreements:       ${immediateAgreements}/${immediateComparable.length} (${percent(ratio(immediateAgreements, immediateComparable.length))})`);
console.log('');
console.log('EXACT INTERNAL-REGIME MATCHING');
console.log('------------------------------');
console.log(`matchable transitions (+level):      ${exactMatchable.length}/${transitions.length}`);
console.log(`exact regime pairs (+level):         ${exactRegimeMatches.length}`);
console.log(`exact regime directional agreement:  ${exactRegimeAgreements}/${exactRegimeMatches.length} (${percent(ratio(exactRegimeAgreements, exactRegimeMatches.length))})`);
console.log(`matchable transitions (no level):    ${noLevelMatchable.length}/${transitions.length}`);
console.log(`exact regime agreement (no level):   ${noLevelAgreements}/${noLevelMatches.length} (${percent(ratio(noLevelAgreements, noLevelMatches.length))})`);
console.log('');
console.log('BOUNDARY CONFOUNDS');
console.log('------------------');
for (const [key, value] of Object.entries(confoundCounts)) console.log(`${key.padEnd(34)} ${value}/${transitions.length}`);
console.log('');
console.log('BY SOURCE KIND');
console.log('--------------');
for (const row of bySourceKind) {
  console.log(`${row.key.padEnd(36)} n=${String(row.transitions).padEnd(3)} local=${percent(row.localAgreementRate).padEnd(7)} exact=${percent(row.exactAgreementRate).padEnd(7)} exactPairs=${row.exactRegimeMatches}`);
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

function summarizeGroups(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, group]) => {
    const local = group.filter(row => row.local.directionAgreement === true).length;
    const exact = group.flatMap(row => row.exactRegimeWithLevel.matches);
    const exactAgreements = exact.filter(row => row.directionAgreement === true).length;
    return {
      key,
      transitions: group.length,
      localAgreements: local,
      localAgreementRate: ratio(local, group.length),
      exactRegimeMatches: exact.length,
      exactRegimeAgreements: exactAgreements,
      exactAgreementRate: ratio(exactAgreements, exact.length),
    };
  }).sort((a, b) => b.transitions - a.transitions || a.key.localeCompare(b.key));
}

function classify({ exactRegimeMatches, exactRegimeAgreementRate, noLevelMatches, noLevelAgreementRate }) {
  if (exactRegimeMatches >= 8 && Number.isFinite(exactRegimeAgreementRate) && exactRegimeAgreementRate >= 0.90) {
    return 'FIRE_RATE_DIRECTIONAL_RESPONSE_RECOVERS_UNDER_EXACT_RUNTIME_REGIME_CONTROL';
  }
  if (exactRegimeMatches < 8 && noLevelMatches >= 8 && Number.isFinite(noLevelAgreementRate) && noLevelAgreementRate >= 0.90) {
    return 'LEVEL_CONTROL_LIMITS_MATCHING_BUT_WEAPON_REGIME_CONTROL_IS_PROMISING';
  }
  if (exactRegimeMatches === 0 && noLevelMatches === 0) {
    return 'NO_SHARED_INTERNAL_REGIMES_ACROSS_FIRE_RATE_TRANSITIONS';
  }
  return 'FIRE_RATE_DIRECTIONAL_RESPONSE_REMAINS_UNRESOLVED_AFTER_RUNTIME_REGIME_CONTROL';
}

function nextStage(classification) {
  if (classification === 'FIRE_RATE_DIRECTIONAL_RESPONSE_RECOVERS_UNDER_EXACT_RUNTIME_REGIME_CONTROL') {
    return 'FREEZE_REGIME_CONTROLLED_DISCOVERY_DESIGN_THEN_REPLICATE_ACROSS_REP01_REP05';
  }
  if (classification === 'LEVEL_CONTROL_LIMITS_MATCHING_BUT_WEAPON_REGIME_CONTROL_IS_PROMISING') {
    return 'DIAGNOSE_HERO_PROGRESSION_EFFECT_ON_READY_DELAY_BEFORE_REPLICATION';
  }
  return 'JOIN_STATIC_CYCLE_TIME_AND_INTRA_BURST_CYCLE_TIME_THEN_MODEL_HERO_SPECIFIC_CADENCE_REGIMES';
}

function ready(row) { return row?.transition?.readyDelayCandidateSeconds; }
function firstTick(segment) { return segment?.rows?.[0]?.tick ?? Infinity; }
function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
function ratio(a, b) { return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null; }
function countTrue(rows, fn) { return rows.filter(row => fn(row) === true).length; }
function percent(value) { return Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : 'n/a'; }
