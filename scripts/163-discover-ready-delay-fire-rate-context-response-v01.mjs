import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import {
  buildDischargeSegments,
  buildAdjacentFireRateTransitions,
  extractFireRateContext,
} from '../src/player-state/effective-weapon-fire-rate-context.mjs';

const VERSION = 'READY_DELAY_FIRE_RATE_CONTEXT_RESPONSE_DISCOVERY_V01';
const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayName = basename(resolve(replayArgument), extname(replayArgument));

const PATHS = {
  script161: resolve('output', replayName, 'effective_weapon_state_substrate_v01.json'),
  events: resolve('output', replayName, 'effective_weapon_runtime_events_v01.jsonl'),
  script162: resolve('output', replayName, 'effective_weapon_runtime_semantics_diagnostic_v01.json'),
  output: resolve('output', replayName, 'ready_delay_fire_rate_context_response_discovery_v01.json'),
};

for (const path of [PATHS.script161, PATHS.events, PATHS.script162]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const script161 = JSON.parse(readFileSync(PATHS.script161, 'utf8'));
const script162 = JSON.parse(readFileSync(PATHS.script162, 'utf8'));
if (script161?.status !== 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION') {
  throw new Error(`Script161 not ready: ${script161?.status}`);
}

const lowerBoundRate = script162?.cadenceReadyDelaySemantic?.lowerBoundPassRateOneTickTolerance;
const sameContextRate = script162?.cadenceReadyDelaySemantic?.sameEffectContextPassRateOneTickTolerance;
if (!(Number.isFinite(lowerBoundRate) && lowerBoundRate >= 0.98 && Number.isFinite(sameContextRate) && sameContextRate >= 0.98)) {
  throw new Error(`Script162 lower-bound evidence does not satisfy frozen 0.98/0.98 gate: overall=${lowerBoundRate} sameContext=${sameContextRate}`);
}

const contextsById = new Map((script161.effectContextSignatures ?? []).map(row => [row.id, row]));
const fireRateContextCount = new Set(
  [...contextsById.values()].map(context => extractFireRateContext(context).signature)
).size;

console.log('');
console.log('========================================================');
console.log('READY-DELAY FIRE-RATE CONTEXT RESPONSE DISCOVERY V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                         ${replayName}`);
console.log('Replay parsing:                 NONE (Script161/162 artifacts only)');
console.log('Primary design:                 within-weapon adjacent fire-rate context changes');
console.log('Held constant:                  hero + weapon entity + active fire mode');
console.log('Composition policy:             signs only; NO additive fire-rate formula');
console.log('Authority promotion:            NONE');
console.log('');

const rows = [];
const rl = createInterface({ input: createReadStream(PATHS.events), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  rows.push(JSON.parse(line));
}

const segments = buildDischargeSegments(rows, contextsById);
const transitions = buildAdjacentFireRateTransitions(segments, 8, 3);
const directional = transitions.filter(row => row.enoughWindow && row.change.directional && row.directionAgreement !== null);
const agreements = directional.filter(row => row.directionAgreement === true);
const disagreements = directional.filter(row => row.directionAgreement === false);
const positive = directional.filter(row => row.change.expectedReadyDirection === 'READY_DELAY_SHOULD_DECREASE');
const negative = directional.filter(row => row.change.expectedReadyDirection === 'READY_DELAY_SHOULD_INCREASE');
const ambiguous = transitions.filter(row => !row.change.directional);

const bySourceKind = summarizeBySourceKind(directional);
const byHero = summarizeByHero(directional);
const agreementRate = ratio(agreements.length, directional.length);
const classification = classify({ directional, agreementRate, positive, negative });

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status: 'READY_DELAY_FIRE_RATE_CONTEXT_RESPONSE_V01_READY_FOR_INTERPRETATION',
  replay: replayName,
  inputs: {
    script161: PATHS.script161,
    script161Status: script161.status,
    script162: PATHS.script162,
    script162Status: script162.status,
    readyDelayLowerBoundPassRate: lowerBoundRate,
    sameEffectContextLowerBoundPassRate: sameContextRate,
  },
  design: {
    windowDischargesPerSide: 8,
    minimumDischargesPerSide: 3,
    sameWeaponEntityRequired: true,
    sameActiveFireModeRequired: true,
    directionOnlyComposition:
      'Direct numeric Fire Rate item inputs, permanent Fire Rate accumulation, and Gun bridge enter/exit provide expected direction only. Values are not added across sources and no final Fire Rate formula is assumed.',
    unresolvedFireRateModifiers:
      'Transitions changing non-direct or non-numeric Fire Rate inputs are classified ambiguous and excluded from the primary directional agreement rate.',
  },
  counts: {
    weaponEventRows: rows.length,
    effectContextSignatures: contextsById.size,
    distinctFireRateContexts: fireRateContextCount,
    dischargeSegments: segments.length,
    adjacentFireRateContextTransitions: transitions.length,
    directionalTransitionsWithWindow: directional.length,
    directionalAgreements: agreements.length,
    directionalDisagreements: disagreements.length,
    positiveFireRateInputTransitions: positive.length,
    negativeFireRateInputTransitions: negative.length,
    ambiguousOrMixedTransitions: ambiguous.length,
  },
  directionalAgreementRate: agreementRate,
  readyDelayChange: {
    positiveFireRateInputExpectedShorter: summarizeNumbers(positive.map(row => row.relativeReadyChange)),
    negativeFireRateInputExpectedLonger: summarizeNumbers(negative.map(row => row.relativeReadyChange)),
    agreeingTransitions: summarizeNumbers(agreements.map(row => row.relativeReadyChange)),
  },
  bySourceKind,
  byHero,
  disagreements: disagreements.slice(0, 50),
  ambiguousExamples: ambiguous.slice(0, 50),
  allDirectionalTransitions: directional,
  diagnosticClassification: classification,
  semanticLimits: {
    readyDelay:
      'Script162 establishes an extremely strong lower-bound candidate in this discovery replay, not yet cross-replay effective-cadence authority.',
    fireRate:
      'Script163 tests directional response of the observed engine ready-delay to known Fire Rate input changes. It does not establish an additive/multiplicative stacking formula.',
    ammo:
      'PlayerState maxAmmo is excluded from magazine-capacity composition because Script162 observed maxAmmo=0 throughout the comparable test-replay events.',
  },
  nextStage:
    classification === 'DIRECTIONAL_FIRE_RATE_RESPONSE_STRONG_IN_DISCOVERY_REPLAY'
      ? 'REPLICATE_READY_DELAY_FIRE_RATE_CONTEXT_RESPONSE_ACROSS_REP01_REP05'
      : 'DIAGNOSE_DISAGREEING_OR_INSUFFICIENT_FIRE_RATE_CONTEXT_TRANSITIONS',
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('========================================================');
console.log('FIRE-RATE CONTEXT RESPONSE RESULT');
console.log('========================================================');
console.log('');
console.log(`Script162 lower-bound pass:     ${percent(lowerBoundRate)}`);
console.log(`same-context lower-bound pass:  ${percent(sameContextRate)}`);
console.log(`effect-context signatures:      ${contextsById.size}`);
console.log(`distinct fire-rate contexts:    ${fireRateContextCount}`);
console.log(`discharge segments:             ${segments.length}`);
console.log(`fire-rate context transitions:  ${transitions.length}`);
console.log(`directional clean transitions:  ${directional.length}`);
console.log(`directional agreements:         ${agreements.length}/${directional.length} (${percent(agreementRate)})`);
console.log(`positive-input transitions:     ${positive.length}`);
console.log(`negative-input transitions:     ${negative.length}`);
console.log(`ambiguous/mixed transitions:    ${ambiguous.length}`);
console.log(`classification:                 ${classification}`);
console.log('');
console.log('BY SOURCE KIND');
console.log('--------------');
for (const row of bySourceKind) {
  console.log(`${row.sourceKind.padEnd(28)} n=${String(row.transitions).padEnd(4)} agree=${percent(row.agreementRate).padEnd(8)} medReadyChange=${fmtPercentSigned(row.relativeReadyChange.median)}`);
}
console.log('');
console.log('BY HERO');
console.log('-------');
for (const row of byHero) {
  console.log(`hero=${String(row.heroId ?? 'UNKNOWN').padEnd(7)} n=${String(row.transitions).padEnd(4)} agree=${percent(row.agreementRate).padEnd(8)} medReadyChange=${fmtPercentSigned(row.relativeReadyChange.median)}`);
}
console.log('');
console.log(`NEXT STAGE: ${output.nextStage}`);
console.log('');
console.log(`JSON:\n${PATHS.output}`);
console.log('');

function summarizeBySourceKind(rows) {
  const groups = new Map();
  for (const row of rows) {
    const kinds = row.change.sourceKinds.length > 0 ? row.change.sourceKinds : ['UNKNOWN'];
    const key = kinds.join('+');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([sourceKind, group]) => summarizeGroup({ sourceKind }, group))
    .sort((a, b) => b.transitions - a.transitions || a.sourceKind.localeCompare(b.sourceKind));
}

function summarizeByHero(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.heroId ?? 'UNKNOWN');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, group]) => summarizeGroup({ heroId: key === 'UNKNOWN' ? null : Number(key) }, group))
    .sort((a, b) => b.transitions - a.transitions || Number(a.heroId ?? 0) - Number(b.heroId ?? 0));
}

function summarizeGroup(base, rows) {
  const agreements = rows.filter(row => row.directionAgreement === true).length;
  return {
    ...base,
    transitions: rows.length,
    agreements,
    agreementRate: ratio(agreements, rows.length),
    relativeReadyChange: summarizeNumbers(rows.map(row => row.relativeReadyChange)),
  };
}

function classify({ directional, agreementRate, positive, negative }) {
  if (directional.length < 8) return 'INSUFFICIENT_DIRECTIONAL_FIRE_RATE_TRANSITIONS';
  if (!Number.isFinite(agreementRate) || agreementRate < 0.90) return 'FIRE_RATE_DIRECTIONAL_RESPONSE_REQUIRES_DIAGNOSIS';
  if (positive.length === 0) return 'NO_POSITIVE_FIRE_RATE_INPUT_TRANSITIONS';
  return 'DIRECTIONAL_FIRE_RATE_RESPONSE_STRONG_IN_DISCOVERY_REPLAY';
}

function summarizeNumbers(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0, min: null, p25: null, median: null, p75: null, max: null, mean: null };
  return {
    n: xs.length,
    min: xs[0],
    p25: quantile(xs, 0.25),
    median: quantile(xs, 0.5),
    p75: quantile(xs, 0.75),
    max: xs[xs.length - 1],
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
  };
}

function quantile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const f = pos - lo;
  return sorted[lo] * (1 - f) + sorted[hi] * f;
}

function ratio(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null;
}

function percent(value) {
  return Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : 'n/a';
}

function fmtPercentSigned(value) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(100 * value).toFixed(2)}%` : 'n/a';
}
