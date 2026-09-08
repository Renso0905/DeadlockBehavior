const TICKS_PER_SECOND = 64;

export function isCleanExplicitFireRateBaseline(fireRateContext) {
  return (
    (fireRateContext?.directNumericInputs?.length ?? 0) === 0
    && (fireRateContext?.directUnresolvedInputs?.length ?? 0) === 0
    && (fireRateContext?.nonDirectTokens?.length ?? 0) === 0
    && (fireRateContext?.permanentFireRate?.length ?? 0) === 0
    && fireRateContext?.gunBridgeActive !== true
  );
}

export function selectDominantActiveFireMode(rows) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const mode = Number.isFinite(row?.observedWeaponState?.activeFireMode)
      ? row.observedWeaponState.activeFireMode
      : null;
    const key = mode === null ? 'NULL' : String(mode);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const entries = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) {
    return { activeFireMode: null, samples: 0, total: 0, rate: null };
  }

  const [key, samples] = entries[0];
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return {
    activeFireMode: key === 'NULL' ? null : Number(key),
    samples,
    total,
    rate: total > 0 ? samples / total : null,
  };
}

export function expectedStaticCadence(weaponRow) {
  const cadence = weaponRow?.weaponInfo?.cadenceRegime ?? {};
  const fields = weaponRow?.weaponInfo?.fields ?? {};
  const regime = cadence?.regime ?? 'UNRESOLVED';
  const cycleTimeSeconds = finite(cadence?.cycleTimeSeconds ?? fields.m_flCycleTime);
  const intraBurstCycleTimeSeconds = finite(
    cadence?.intraBurstCycleTimeSeconds ?? fields.m_flIntraBurstCycleTime,
  );
  const burstShotCount = finite(cadence?.burstShotCount ?? fields.m_iBurstShotCount);

  if (regime === 'SPIN_UP') {
    return {
      regime,
      exactComparable: false,
      cycleTimeSeconds,
      intraBurstCycleTimeSeconds,
      burstShotCount,
      expectedIntervals: [],
      reason: 'SPIN_UP_REQUIRES_DYNAMIC_RUNTIME_SPIN_STATE',
    };
  }

  if (regime === 'SINGLE_OR_AUTOMATIC_NON_BURST') {
    return {
      regime,
      exactComparable: Number.isFinite(cycleTimeSeconds) && cycleTimeSeconds > 0,
      cycleTimeSeconds,
      intraBurstCycleTimeSeconds,
      burstShotCount,
      expectedIntervals: Number.isFinite(cycleTimeSeconds) && cycleTimeSeconds > 0
        ? [{ kind: 'NON_BURST_CYCLE', seconds: cycleTimeSeconds }]
        : [],
      reason: null,
    };
  }

  if (regime === 'BURST') {
    const postBurstRemainderSeconds = (
      Number.isFinite(cycleTimeSeconds)
      && Number.isFinite(intraBurstCycleTimeSeconds)
      && Number.isFinite(burstShotCount)
      && burstShotCount > 1
    )
      ? cycleTimeSeconds - ((burstShotCount - 1) * intraBurstCycleTimeSeconds)
      : null;

    const intervals = [];
    if (Number.isFinite(intraBurstCycleTimeSeconds) && intraBurstCycleTimeSeconds > 0) {
      intervals.push({ kind: 'INTRA_BURST', seconds: intraBurstCycleTimeSeconds });
    }
    if (Number.isFinite(postBurstRemainderSeconds) && postBurstRemainderSeconds > 0) {
      intervals.push({ kind: 'POST_BURST_REMAINDER', seconds: postBurstRemainderSeconds });
    }

    return {
      regime,
      exactComparable: intervals.length === 2,
      cycleTimeSeconds,
      intraBurstCycleTimeSeconds,
      burstShotCount,
      postBurstRemainderSeconds,
      expectedIntervals: intervals,
      reason: intervals.length === 2 ? null : 'BURST_STATIC_INTERVALS_INCOMPLETE_OR_NONPOSITIVE',
    };
  }

  return {
    regime,
    exactComparable: false,
    cycleTimeSeconds,
    intraBurstCycleTimeSeconds,
    burstShotCount,
    expectedIntervals: [],
    reason: 'STATIC_CADENCE_REGIME_UNRESOLVED',
  };
}

export function classifyReadyDelayAgainstStatic(row, weaponRow, options = {}) {
  const readyDelaySeconds = finite(row?.transition?.readyDelayCandidateSeconds);
  const expected = expectedStaticCadence(weaponRow);
  const absoluteToleranceSeconds = Number.isFinite(options.absoluteToleranceSeconds)
    ? options.absoluteToleranceSeconds
    : 1 / TICKS_PER_SECOND;
  const relativeTolerance = Number.isFinite(options.relativeTolerance)
    ? options.relativeTolerance
    : 0.05;

  if (!Number.isFinite(readyDelaySeconds) || readyDelaySeconds < 0) {
    return {
      comparable: false,
      regime: expected.regime,
      reason: 'READY_DELAY_UNAVAILABLE',
    };
  }
  if (!expected.exactComparable) {
    return {
      comparable: false,
      regime: expected.regime,
      reason: expected.reason,
      readyDelaySeconds,
    };
  }

  let target = null;
  let targetSelection = null;

  if (expected.regime === 'SINGLE_OR_AUTOMATIC_NON_BURST') {
    target = expected.expectedIntervals[0];
    targetSelection = 'STATIC_NON_BURST_CYCLE';
  } else if (expected.regime === 'BURST') {
    const burstRemaining = finite(row?.observedWeaponState?.burstShotsRemaining);
    if (Number.isFinite(burstRemaining)) {
      const kind = burstRemaining > 0 ? 'INTRA_BURST' : 'POST_BURST_REMAINDER';
      target = expected.expectedIntervals.find(candidate => candidate.kind === kind) ?? null;
      targetSelection = burstRemaining > 0
        ? 'RUNTIME_BURST_REMAINING_GT_ZERO'
        : 'RUNTIME_BURST_REMAINING_ZERO';
    }

    if (!target) {
      target = nearestInterval(readyDelaySeconds, expected.expectedIntervals);
      targetSelection = 'NEAREST_STATIC_BURST_INTERVAL_DIAGNOSTIC';
    }
  }

  if (!target || !Number.isFinite(target.seconds) || target.seconds <= 0) {
    return {
      comparable: false,
      regime: expected.regime,
      reason: 'STATIC_TARGET_INTERVAL_UNAVAILABLE',
      readyDelaySeconds,
    };
  }

  const absoluteErrorSeconds = Math.abs(readyDelaySeconds - target.seconds);
  const toleranceSeconds = absoluteToleranceSeconds + (relativeTolerance * target.seconds);
  const ratioToStatic = readyDelaySeconds / target.seconds;

  return {
    comparable: true,
    regime: expected.regime,
    readyDelaySeconds,
    expectedKind: target.kind,
    expectedSeconds: target.seconds,
    targetSelection,
    absoluteErrorSeconds,
    toleranceSeconds,
    ratioToStatic,
    alignedWithinTolerance: absoluteErrorSeconds <= toleranceSeconds + 1e-12,
    static: expected,
  };
}

export function summarizeAlignment(rows) {
  const comparable = (rows ?? []).filter(row => row?.alignment?.comparable === true);
  const aligned = comparable.filter(row => row.alignment.alignedWithinTolerance === true);
  const errors = comparable.map(row => row.alignment.absoluteErrorSeconds).filter(Number.isFinite);
  const ratios = comparable.map(row => row.alignment.ratioToStatic).filter(Number.isFinite);
  return {
    comparable: comparable.length,
    aligned: aligned.length,
    alignmentRate: ratio(aligned.length, comparable.length),
    absoluteErrorSeconds: summarizeNumbers(errors),
    ratioToStatic: summarizeNumbers(ratios),
  };
}

function nearestInterval(value, intervals) {
  let best = null;
  let bestError = Infinity;
  for (const row of intervals ?? []) {
    if (!Number.isFinite(row?.seconds)) continue;
    const error = Math.abs(value - row.seconds);
    if (error < bestError) {
      best = row;
      bestError = error;
    }
  }
  return best;
}

function summarizeNumbers(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return { n: 0, min: null, median: null, max: null, mean: null };
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return {
    n: xs.length,
    min: xs[0],
    median,
    max: xs[xs.length - 1],
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
  };
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(a, b) {
  return b > 0 ? a / b : null;
}
