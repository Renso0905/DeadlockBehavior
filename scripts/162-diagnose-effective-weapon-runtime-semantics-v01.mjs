import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const VERSION = 'EFFECTIVE_WEAPON_RUNTIME_SEMANTICS_DIAGNOSTIC_V01';
const TICK_RATE = 64;
const ONE_TICK_SECONDS = 1 / TICK_RATE;

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayName = basename(resolve(replayArgument), extname(replayArgument));

const PATHS = {
  summary: resolve('output', replayName, 'effective_weapon_state_substrate_v01.json'),
  events: resolve('output', replayName, 'effective_weapon_runtime_events_v01.jsonl'),
  output: resolve('output', replayName, 'effective_weapon_runtime_semantics_diagnostic_v01.json'),
};

for (const path of [PATHS.summary, PATHS.events]) {
  if (!existsSync(path)) throw new Error(`Required Script161 input missing:\n${path}`);
}

const script161 = JSON.parse(readFileSync(PATHS.summary, 'utf8'));
if (script161?.status !== 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION') {
  throw new Error(`Script161 not ready: ${script161?.status}`);
}

const contexts = new Map(
  (script161.effectContextSignatures ?? []).map(row => [row.id, row])
);

console.log('');
console.log('========================================================');
console.log('EFFECTIVE WEAPON RUNTIME SEMANTICS DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                         ${replayName}`);
console.log('Replay parsing:                 NONE (Script161 JSONL only)');
console.log('Ammo question:                  does PlayerState maxAmmo track reload-complete clip capacity?');
console.log('Cadence question:               is nextPrimaryAttack-lastAttackTime a lower bound on next discharge?');
console.log('Formula composition:            NONE');
console.log('Authority promotion:            NONE');
console.log('');

const rows = [];
const rl = createInterface({ input: createReadStream(PATHS.events), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  rows.push(JSON.parse(line));
}
rows.sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));

const comparable = [];
const reloadComparable = [];
const reloadBaselineComparable = [];
const reloadModifiedComparable = [];
const maxAmmoValues = [];
const clipValues = [];
const bonusClipValues = [];
const clipMinusMax = [];
const clipMinusAugmented = [];

for (const row of rows) {
  const clip = finite(row?.observedWeaponState?.clip);
  const bonusClip = finite(row?.observedWeaponState?.bonusClip);
  const maxAmmo = finite(row?.observedPlayerWeaponContext?.maxAmmo);
  if (clip === null || maxAmmo === null) continue;

  const augmented = maxAmmo + (bonusClip !== null && bonusClip > 0 ? bonusClip : 0);
  const sample = {
    tick: row.tick,
    playerKey: row.playerKey,
    heroId: row.heroId,
    effectContextId: row.effectContextId,
    clip,
    bonusClip,
    maxAmmo,
    augmented,
    clipMinusMax: clip - maxAmmo,
    clipMinusAugmented: clip - augmented,
  };
  comparable.push(sample);
  maxAmmoValues.push(maxAmmo);
  clipValues.push(clip);
  if (bonusClip !== null) bonusClipValues.push(bonusClip);
  clipMinusMax.push(sample.clipMinusMax);
  clipMinusAugmented.push(sample.clipMinusAugmented);

  if (row?.transition?.reloadTransition === 'RELOAD_EXIT') {
    const context = contexts.get(row.effectContextId) ?? null;
    sample.potentialAmmoModifier = contextHasPotentialAmmoModifier(context);
    reloadComparable.push(sample);
    if (sample.potentialAmmoModifier) reloadModifiedComparable.push(sample);
    else reloadBaselineComparable.push(sample);
  }
}

const allWithinMax = comparable.filter(row => row.clip >= 0 && row.clip <= row.maxAmmo + 1e-6).length;
const allWithinAugmented = comparable.filter(row => row.clip >= 0 && row.clip <= row.augmented + 1e-6).length;

const reloadExactMax = reloadComparable.filter(row => near(row.clip, row.maxAmmo, 1e-6)).length;
const reloadExactAugmented = reloadComparable.filter(row => near(row.clip, row.augmented, 1e-6)).length;
const reloadWithinOneMax = reloadComparable.filter(row => Math.abs(row.clip - row.maxAmmo) <= 1 + 1e-6).length;
const reloadWithinOneAugmented = reloadComparable.filter(row => Math.abs(row.clip - row.augmented) <= 1 + 1e-6).length;

const baselineExactMax = reloadBaselineComparable.filter(row => near(row.clip, row.maxAmmo, 1e-6)).length;
const baselineExactAugmented = reloadBaselineComparable.filter(row => near(row.clip, row.augmented, 1e-6)).length;

const ammoClassification = classifyAmmo({
  reloadComparable,
  reloadExactMax,
  reloadExactAugmented,
  reloadWithinOneMax,
  reloadWithinOneAugmented,
  reloadBaselineComparable,
  baselineExactMax,
  baselineExactAugmented,
});

// Discharge-to-next-discharge readiness-floor audit.
const byWeapon = new Map();
for (const row of rows) {
  if (row?.transition?.actualDischargeSignal !== true) continue;
  const entity = row.weaponEntityIndex;
  if (!Number.isInteger(entity)) continue;
  if (!byWeapon.has(entity)) byWeapon.set(entity, []);
  byWeapon.get(entity).push(row);
}

const cadencePairs = [];
for (const weaponRows of byWeapon.values()) {
  weaponRows.sort((a, b) => a.tick - b.tick);
  for (let i = 0; i + 1 < weaponRows.length; i++) {
    const current = weaponRows[i];
    const next = weaponRows[i + 1];
    const ready = finite(current?.transition?.readyDelayCandidateSeconds);
    if (ready === null || ready < 0 || ready > 5) continue;
    const tickDelta = finite(next.tick) !== null && finite(current.tick) !== null
      ? next.tick - current.tick
      : null;
    if (!Number.isFinite(tickDelta) || tickDelta <= 0) continue;
    const spacing = tickDelta / TICK_RATE;
    cadencePairs.push({
      heroId: current.heroId ?? null,
      playerKey: current.playerKey ?? null,
      weaponEntityIndex: current.weaponEntityIndex,
      tick: current.tick,
      nextTick: next.tick,
      readyDelaySeconds: ready,
      observedNextSpacingSeconds: spacing,
      residualSeconds: spacing - ready,
      lowerBoundViolationOneTick: spacing + ONE_TICK_SECONDS + 1e-9 < ready,
      sameEffectContext: current.effectContextId === next.effectContextId,
      currentEffectContextId: current.effectContextId ?? null,
      nextEffectContextId: next.effectContextId ?? null,
      activeFireMode: current?.observedWeaponState?.activeFireMode ?? null,
      continuousShots: current?.observedWeaponState?.continuousShots ?? null,
      burstShotsRemaining: current?.observedWeaponState?.burstShotsRemaining ?? null,
    });
  }
}

const sameContextPairs = cadencePairs.filter(row => row.sameEffectContext);
const cadenceViolations = cadencePairs.filter(row => row.lowerBoundViolationOneTick);
const sameContextViolations = sameContextPairs.filter(row => row.lowerBoundViolationOneTick);
const cadenceLowerBoundPassRate = ratio(cadencePairs.length - cadenceViolations.length, cadencePairs.length);
const sameContextLowerBoundPassRate = ratio(
  sameContextPairs.length - sameContextViolations.length,
  sameContextPairs.length
);

const byHero = summarizeCadenceByHero(cadencePairs);
const cadenceClassification = classifyCadence({
  cadencePairs,
  cadenceLowerBoundPassRate,
  sameContextPairs,
  sameContextLowerBoundPassRate,
});

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status: 'EFFECTIVE_WEAPON_RUNTIME_SEMANTICS_V01_DIAGNOSED',
  replay: replayName,
  inputs: {
    script161Summary: PATHS.summary,
    script161Events: PATHS.events,
    script161Status: script161.status,
  },
  ammoCapacitySemantic: {
    question: 'Does PlayerState observedRuntime.maxAmmo behave as current effective primary-weapon magazine capacity?',
    allComparableEvents: comparable.length,
    allClipWithinMaxAmmo: allWithinMax,
    allClipWithinMaxAmmoRate: ratio(allWithinMax, comparable.length),
    allClipWithinMaxAmmoPlusBonusClip: allWithinAugmented,
    allClipWithinMaxAmmoPlusBonusClipRate: ratio(allWithinAugmented, comparable.length),
    reloadExitComparable: reloadComparable.length,
    reloadExitExactMaxAmmo: reloadExactMax,
    reloadExitExactMaxAmmoRate: ratio(reloadExactMax, reloadComparable.length),
    reloadExitExactAugmented: reloadExactAugmented,
    reloadExitExactAugmentedRate: ratio(reloadExactAugmented, reloadComparable.length),
    reloadExitWithinOneMaxAmmoRate: ratio(reloadWithinOneMax, reloadComparable.length),
    reloadExitWithinOneAugmentedRate: ratio(reloadWithinOneAugmented, reloadComparable.length),
    reloadExitWithoutPotentialAmmoModifier: reloadBaselineComparable.length,
    baselineReloadExactMaxAmmoRate: ratio(baselineExactMax, reloadBaselineComparable.length),
    baselineReloadExactAugmentedRate: ratio(baselineExactAugmented, reloadBaselineComparable.length),
    reloadExitWithPotentialAmmoModifier: reloadModifiedComparable.length,
    maxAmmoDistribution: summarizeNumbers(maxAmmoValues),
    clipDistribution: summarizeNumbers(clipValues),
    bonusClipDistribution: summarizeNumbers(bonusClipValues),
    clipMinusMaxAmmo: summarizeNumbers(clipMinusMax),
    clipMinusAugmentedCapacity: summarizeNumbers(clipMinusAugmented),
    topMaxAmmoValues: topValues(maxAmmoValues, 20),
    perPlayerReloadComparison: summarizeReloadByPlayer(reloadComparable),
    classification: ammoClassification,
    interpretation:
      ammoClassification === 'PLAYER_MAX_AMMO_NOT_VALIDATED_AS_MAGAZINE_CAPACITY'
        ? 'Do not use PlayerState m_iMaxAmmo as effective primary-weapon clip capacity until a separate runtime semantic is established.'
        : 'PlayerState maxAmmo remains a plausible capacity carrier under this diagnostic, but still requires cross-replay validation before authority promotion.',
  },
  cadenceReadyDelaySemantic: {
    question: 'Does current m_flNextPrimaryAttack-current m_flLastAttackTime behave as a lower bound on the next observed primary-weapon discharge?',
    comparableConsecutiveDischargePairs: cadencePairs.length,
    lowerBoundViolationsBeyondOneTick: cadenceViolations.length,
    lowerBoundPassRateOneTickTolerance: cadenceLowerBoundPassRate,
    sameEffectContextPairs: sameContextPairs.length,
    sameEffectContextViolationsBeyondOneTick: sameContextViolations.length,
    sameEffectContextPassRateOneTickTolerance: sameContextLowerBoundPassRate,
    readyDelaySeconds: summarizeNumbers(cadencePairs.map(row => row.readyDelaySeconds)),
    nextObservedSpacingSeconds: summarizeNumbers(cadencePairs.map(row => row.observedNextSpacingSeconds)),
    spacingMinusReadyDelaySeconds: summarizeNumbers(cadencePairs.map(row => row.residualSeconds)),
    byHero,
    largestViolations: cadencePairs
      .filter(row => row.lowerBoundViolationOneTick)
      .sort((a, b) => a.residualSeconds - b.residualSeconds)
      .slice(0, 30),
    classification: cadenceClassification,
    interpretation:
      cadenceClassification === 'READY_DELAY_STRONG_LOWER_BOUND_CANDIDATE'
        ? 'The engine ready-delay candidate survives a behavioral lower-bound falsification test in this replay; next step is context-change validation against Fire Rate inputs.'
        : 'The ready-delay candidate has material cases where the next discharge occurs earlier than the proposed readiness interval; diagnose hero/fire-mode/burst semantics before using it as effective cadence.',
  },
  nextStage: chooseNextStage(ammoClassification, cadenceClassification),
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('========================================================');
console.log('RUNTIME SEMANTICS RESULT');
console.log('========================================================');
console.log('');
console.log('AMMO / CLIP');
console.log('-----------');
console.log(`all comparable events:                  ${comparable.length}`);
console.log(`clip <= maxAmmo:                        ${allWithinMax}/${comparable.length} (${percent(ratio(allWithinMax, comparable.length))})`);
console.log(`clip <= maxAmmo+bonusClip:              ${allWithinAugmented}/${comparable.length} (${percent(ratio(allWithinAugmented, comparable.length))})`);
console.log(`reload-exit comparable:                 ${reloadComparable.length}`);
console.log(`reload clip == maxAmmo:                 ${reloadExactMax}/${reloadComparable.length} (${percent(ratio(reloadExactMax, reloadComparable.length))})`);
console.log(`reload clip == maxAmmo+bonusClip:       ${reloadExactAugmented}/${reloadComparable.length} (${percent(ratio(reloadExactAugmented, reloadComparable.length))})`);
console.log(`baseline reloads (no ammo modifier):    ${reloadBaselineComparable.length}`);
console.log(`baseline reload == maxAmmo:             ${baselineExactMax}/${reloadBaselineComparable.length} (${percent(ratio(baselineExactMax, reloadBaselineComparable.length))})`);
console.log(`maxAmmo median/range:                   ${distText(output.ammoCapacitySemantic.maxAmmoDistribution)}`);
console.log(`reload clip-maxAmmo median/range:       ${distText(summarizeNumbers(reloadComparable.map(row => row.clipMinusMax)))}`);
console.log(`classification:                         ${ammoClassification}`);
console.log('');
console.log('READY DELAY / CADENCE');
console.log('---------------------');
console.log(`consecutive discharge pairs:            ${cadencePairs.length}`);
console.log(`lower-bound violations >1 tick:         ${cadenceViolations.length}/${cadencePairs.length} (${percent(ratio(cadenceViolations.length, cadencePairs.length))})`);
console.log(`lower-bound pass rate:                   ${percent(cadenceLowerBoundPassRate)}`);
console.log(`same-context pairs:                      ${sameContextPairs.length}`);
console.log(`same-context lower-bound pass rate:      ${percent(sameContextLowerBoundPassRate)}`);
console.log(`ready-delay median:                      ${fmt(output.cadenceReadyDelaySemantic.readyDelaySeconds.median)}s`);
console.log(`observed next-spacing median:            ${fmt(output.cadenceReadyDelaySemantic.nextObservedSpacingSeconds.median)}s`);
console.log(`classification:                         ${cadenceClassification}`);
console.log('');
console.log('BY HERO READY-DELAY LOWER-BOUND');
console.log('--------------------------------');
for (const row of byHero) {
  console.log(
    `hero=${String(row.heroId ?? 'UNKNOWN').padEnd(7)} pairs=${String(row.pairs).padEnd(6)} ` +
    `pass=${percent(row.passRate).padEnd(8)} medReady=${fmt(row.readyDelay.median).padEnd(9)} ` +
    `medSpacing=${fmt(row.spacing.median)}`
  );
}
console.log('');
console.log(`NEXT STAGE: ${output.nextStage}`);
console.log('');
console.log(`JSON:\n${PATHS.output}`);
console.log('');

function contextHasPotentialAmmoModifier(context) {
  if (!context) return false;
  if ((context.gunBridge ?? []).length > 0) return true;
  for (const family of Object.keys(context.permanentWeaponBuffs ?? {})) {
    if (/ammo|clip/i.test(family)) return true;
  }
  for (const item of context.itemInputs ?? []) {
    const text = JSON.stringify(item);
    if (/ammo|clip/i.test(text)) return true;
  }
  return false;
}

function classifyAmmo(args) {
  if (args.reloadComparable.length < 10) return 'INSUFFICIENT_RELOAD_EXIT_EVIDENCE';
  const exact = Math.max(
    ratio(args.reloadExactMax, args.reloadComparable.length) ?? 0,
    ratio(args.reloadExactAugmented, args.reloadComparable.length) ?? 0
  );
  const withinOne = Math.max(
    ratio(args.reloadWithinOneMax, args.reloadComparable.length) ?? 0,
    ratio(args.reloadWithinOneAugmented, args.reloadComparable.length) ?? 0
  );
  const baselineExact = Math.max(
    ratio(args.baselineExactMax, args.reloadBaselineComparable.length) ?? 0,
    ratio(args.baselineExactAugmented, args.reloadBaselineComparable.length) ?? 0
  );
  if (exact >= 0.80 || withinOne >= 0.90 || (args.reloadBaselineComparable.length >= 10 && baselineExact >= 0.80)) {
    return 'PLAYER_MAX_AMMO_PLAUSIBLE_MAGAZINE_CAPACITY_CANDIDATE';
  }
  return 'PLAYER_MAX_AMMO_NOT_VALIDATED_AS_MAGAZINE_CAPACITY';
}

function classifyCadence(args) {
  if (args.cadencePairs.length < 100) return 'INSUFFICIENT_CONSECUTIVE_DISCHARGE_EVIDENCE';
  if (
    Number.isFinite(args.cadenceLowerBoundPassRate) &&
    Number.isFinite(args.sameEffectContextLowerBoundPassRate) &&
    args.cadenceLowerBoundPassRate >= 0.98 &&
    args.sameEffectContextLowerBoundPassRate >= 0.98
  ) return 'READY_DELAY_STRONG_LOWER_BOUND_CANDIDATE';
  return 'READY_DELAY_REQUIRES_HERO_FIRE_MODE_DIAGNOSIS';
}

function chooseNextStage(ammo, cadence) {
  if (cadence === 'READY_DELAY_STRONG_LOWER_BOUND_CANDIDATE') {
    return ammo === 'PLAYER_MAX_AMMO_NOT_VALIDATED_AS_MAGAZINE_CAPACITY'
      ? 'WITHDRAW_MAX_AMMO_CAPACITY_INTERPRETATION_AND_VALIDATE_READY_DELAY_AGAINST_FIRE_RATE_CONTEXT_CHANGES'
      : 'VALIDATE_READY_DELAY_AND_AMMO_CAPACITY_CANDIDATES_ACROSS_FIRE_RATE_AND_AMMO_CONTEXT_CHANGES';
  }
  return 'DIAGNOSE_READY_DELAY_BY_HERO_FIRE_MODE_AND_BURST_STATE_BEFORE_EFFECT_COMPOSITION';
}

function summarizeCadenceByHero(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.heroId ?? 'UNKNOWN');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, group]) => {
    const violations = group.filter(row => row.lowerBoundViolationOneTick).length;
    return {
      heroId: key === 'UNKNOWN' ? null : Number(key),
      pairs: group.length,
      violations,
      passRate: ratio(group.length - violations, group.length),
      readyDelay: summarizeNumbers(group.map(row => row.readyDelaySeconds)),
      spacing: summarizeNumbers(group.map(row => row.observedNextSpacingSeconds)),
      residual: summarizeNumbers(group.map(row => row.residualSeconds)),
    };
  }).sort((a, b) => b.pairs - a.pairs || Number(a.heroId ?? 0) - Number(b.heroId ?? 0));
}

function summarizeReloadByPlayer(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.playerKey ?? 'UNKNOWN';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([playerKey, group]) => ({
    playerKey,
    heroId: group.find(row => Number.isFinite(row.heroId))?.heroId ?? null,
    reloads: group.length,
    maxAmmo: summarizeNumbers(group.map(row => row.maxAmmo)),
    reloadClip: summarizeNumbers(group.map(row => row.clip)),
    clipMinusMaxAmmo: summarizeNumbers(group.map(row => row.clipMinusMax)),
    exactMaxRate: ratio(group.filter(row => near(row.clip, row.maxAmmo, 1e-6)).length, group.length),
    exactAugmentedRate: ratio(group.filter(row => near(row.clip, row.augmented, 1e-6)).length, group.length),
  })).sort((a, b) => b.reloads - a.reloads || a.playerKey.localeCompare(b.playerKey));
}

function topValues(values, n) {
  const counts = new Map();
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || a.value - b.value)
    .slice(0, n);
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

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function near(a, b, tolerance) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(4) : 'n/a';
}

function percent(value) {
  return Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : 'n/a';
}

function distText(row) {
  if (!row || row.n === 0) return 'n/a';
  return `${fmt(row.median)} [${fmt(row.min)}, ${fmt(row.max)}] n=${row.n}`;
}
