export function exactCadenceRegimeKey(row, { includeLevel = true } = {}) {
  if (!row) return null;
  const state = row.observedWeaponState ?? {};
  const level = finite(row?.observedPlayerWeaponContext?.level);
  const continuousShots = finite(state.continuousShots);
  const burstShotsRemaining = finite(state.burstShotsRemaining);
  const activeFireMode = finite(state.activeFireMode);
  if (activeFireMode === null || continuousShots === null || burstShotsRemaining === null) return null;
  const parts = [`mode:${activeFireMode}`, `continuous:${continuousShots}`, `burstRemaining:${burstShotsRemaining}`];
  if (includeLevel) {
    if (level === null) return null;
    parts.unshift(`level:${level}`);
  }
  return parts.join('|');
}

export function matchExactCadenceRegimes(beforeRows, afterRows, expectedReadyDirection, options = {}) {
  const before = groupReadyByRegime(beforeRows, options);
  const after = groupReadyByRegime(afterRows, options);
  const matches = [];
  for (const [key, beforeValues] of before.entries()) {
    const afterValues = after.get(key);
    if (!afterValues) continue;
    const beforeMedian = median(beforeValues);
    const afterMedian = median(afterValues);
    if (!Number.isFinite(beforeMedian) || !Number.isFinite(afterMedian)) continue;
    const delta = afterMedian - beforeMedian;
    const agreement = expectedReadyDirection === 'READY_DELAY_SHOULD_DECREASE'
      ? delta < -1e-9
      : expectedReadyDirection === 'READY_DELAY_SHOULD_INCREASE'
        ? delta > 1e-9
        : null;
    matches.push({
      regimeKey: key,
      beforeSamples: beforeValues.length,
      afterSamples: afterValues.length,
      beforeMedianSeconds: beforeMedian,
      afterMedianSeconds: afterMedian,
      deltaSeconds: delta,
      relativeChange: Math.abs(beforeMedian) > 1e-12 ? delta / beforeMedian : null,
      directionAgreement: agreement,
    });
  }
  matches.sort((a, b) => (b.beforeSamples + b.afterSamples) - (a.beforeSamples + a.afterSamples) || a.regimeKey.localeCompare(b.regimeKey));
  const agreements = matches.filter(row => row.directionAgreement === true).length;
  return {
    matches,
    matchedRegimes: matches.length,
    agreements,
    agreementRate: ratio(agreements, matches.length),
  };
}

export function transitionConfounds(beforeRows, afterRows) {
  const beforeLast = beforeRows?.[beforeRows.length - 1] ?? null;
  const afterFirst = afterRows?.[0] ?? null;
  const beforeReady = ready(beforeLast);
  const afterReady = ready(afterFirst);
  const gapTicks = Number.isFinite(beforeLast?.tick) && Number.isFinite(afterFirst?.tick)
    ? afterFirst.tick - beforeLast.tick
    : null;
  const scaleSeconds = [beforeReady, afterReady].filter(x => Number.isFinite(x) && x > 1e-9);
  const cadenceScale = scaleSeconds.length ? Math.max(...scaleSeconds) : null;
  const gapReadyUnits = Number.isFinite(gapTicks) && Number.isFinite(cadenceScale)
    ? (gapTicks / 64) / cadenceScale
    : null;

  const beforeLevel = finite(beforeLast?.observedPlayerWeaponContext?.level);
  const afterLevel = finite(afterFirst?.observedPlayerWeaponContext?.level);
  const beforeContinuous = finite(beforeLast?.observedWeaponState?.continuousShots);
  const afterContinuous = finite(afterFirst?.observedWeaponState?.continuousShots);
  const beforeBurst = finite(beforeLast?.observedWeaponState?.burstShotsRemaining);
  const afterBurst = finite(afterFirst?.observedWeaponState?.burstShotsRemaining);

  return {
    gapTicks,
    gapSeconds: Number.isFinite(gapTicks) ? gapTicks / 64 : null,
    gapReadyUnits,
    levelChanged: beforeLevel !== null && afterLevel !== null ? beforeLevel !== afterLevel : null,
    continuousCounterReset: beforeContinuous !== null && afterContinuous !== null ? afterContinuous < beforeContinuous : null,
    continuousCounterChanged: beforeContinuous !== null && afterContinuous !== null ? afterContinuous !== beforeContinuous : null,
    burstCounterChanged: beforeBurst !== null && afterBurst !== null ? afterBurst !== beforeBurst : null,
    beforeLevel,
    afterLevel,
    beforeContinuousShots: beforeContinuous,
    afterContinuousShots: afterContinuous,
    beforeBurstShotsRemaining: beforeBurst,
    afterBurstShotsRemaining: afterBurst,
    immediateBeforeReadySeconds: beforeReady,
    immediateAfterReadySeconds: afterReady,
  };
}

export function directionAgreement(beforeValue, afterValue, expectedReadyDirection) {
  if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) return null;
  const delta = afterValue - beforeValue;
  if (expectedReadyDirection === 'READY_DELAY_SHOULD_DECREASE') return delta < -1e-9;
  if (expectedReadyDirection === 'READY_DELAY_SHOULD_INCREASE') return delta > 1e-9;
  return null;
}

function groupReadyByRegime(rows, options) {
  const out = new Map();
  for (const row of rows ?? []) {
    const key = exactCadenceRegimeKey(row, options);
    const value = ready(row);
    if (!key || !Number.isFinite(value)) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(value);
  }
  return out;
}

function ready(row) {
  return finite(row?.transition?.readyDelayCandidateSeconds);
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function median(values) {
  const xs = (values ?? []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function ratio(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null;
}
