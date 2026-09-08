const TICKS_PER_SECOND = 64;

export function burstStaticCandidates(weaponRow) {
  const cadence = weaponRow?.weaponInfo?.cadenceRegime ?? {};
  const fields = weaponRow?.weaponInfo?.fields ?? {};
  const regime = cadence?.regime ?? 'UNRESOLVED';
  const cycleTimeSeconds = finite(cadence?.cycleTimeSeconds ?? fields.m_flCycleTime);
  const intraBurstCycleTimeSeconds = finite(
    cadence?.intraBurstCycleTimeSeconds ?? fields.m_flIntraBurstCycleTime,
  );
  const burstShotCount = finite(cadence?.burstShotCount ?? fields.m_iBurstShotCount);

  const postBurstRemainderSeconds = (
    regime === 'BURST'
    && Number.isFinite(cycleTimeSeconds)
    && Number.isFinite(intraBurstCycleTimeSeconds)
    && Number.isFinite(burstShotCount)
    && burstShotCount > 1
  )
    ? cycleTimeSeconds - ((burstShotCount - 1) * intraBurstCycleTimeSeconds)
    : null;

  return {
    regime,
    cycleTimeSeconds,
    intraBurstCycleTimeSeconds,
    burstShotCount,
    postBurstRemainderSeconds,
  };
}

export function compareBurstBoundaryCandidates(row, weaponRow, options = {}) {
  const readyDelaySeconds = finite(row?.transition?.readyDelayCandidateSeconds);
  const burstShotsRemaining = finite(row?.observedWeaponState?.burstShotsRemaining);
  const candidates = burstStaticCandidates(weaponRow);

  if (candidates.regime !== 'BURST') {
    return {
      comparable: false,
      reason: 'NOT_STATIC_BURST_WEAPON',
      readyDelaySeconds,
      burstShotsRemaining,
      candidates,
    };
  }
  if (!Number.isFinite(readyDelaySeconds) || readyDelaySeconds < 0) {
    return {
      comparable: false,
      reason: 'READY_DELAY_UNAVAILABLE',
      readyDelaySeconds,
      burstShotsRemaining,
      candidates,
    };
  }
  if (!Number.isFinite(burstShotsRemaining)) {
    return {
      comparable: false,
      reason: 'BURST_REMAINING_UNAVAILABLE',
      readyDelaySeconds,
      burstShotsRemaining,
      candidates,
    };
  }

  const candidateRows = [
    ['FULL_CYCLE_TIME', candidates.cycleTimeSeconds],
    ['INTRA_BURST_CYCLE_TIME', candidates.intraBurstCycleTimeSeconds],
    ['POST_BURST_REMAINDER', candidates.postBurstRemainderSeconds],
  ]
    .map(([kind, seconds]) => compareCandidate(readyDelaySeconds, kind, seconds, options))
    .filter(Boolean);

  const nearest = [...candidateRows]
    .sort((a, b) => a.absoluteErrorSeconds - b.absoluteErrorSeconds || a.kind.localeCompare(b.kind))[0] ?? null;

  return {
    comparable: candidateRows.length > 0,
    reason: candidateRows.length > 0 ? null : 'NO_FINITE_STATIC_BURST_CANDIDATES',
    readyDelaySeconds,
    burstShotsRemaining,
    boundaryCandidate: burstShotsRemaining === 0,
    candidates,
    candidateRows,
    nearestCandidateKind: nearest?.kind ?? null,
    nearestCandidateAligned: nearest?.alignedWithinTolerance ?? false,
  };
}

export function classifyBurstCounterStep(currentRow, nextRow, weaponRow) {
  const burstShotCount = finite(
    weaponRow?.weaponInfo?.cadenceRegime?.burstShotCount
      ?? weaponRow?.weaponInfo?.fields?.m_iBurstShotCount,
  );
  const current = finite(currentRow?.observedWeaponState?.burstShotsRemaining);
  const next = finite(nextRow?.observedWeaponState?.burstShotsRemaining);

  if (!Number.isFinite(burstShotCount) || burstShotCount <= 1) {
    return { comparable: false, classification: 'STATIC_BURST_COUNT_UNAVAILABLE' };
  }
  if (!Number.isFinite(current) || !Number.isFinite(next)) {
    return { comparable: false, classification: 'RUNTIME_BURST_COUNTER_UNAVAILABLE' };
  }

  const expectedResetValue = burstShotCount - 1;
  let classification = 'OTHER_COUNTER_STEP';
  if (current > 0 && next === current - 1) classification = 'DESCEND_ONE';
  else if (current === 0 && next === expectedResetValue) classification = 'ZERO_TO_BURST_RESET';
  else if (current === next) classification = 'UNCHANGED';
  else if (next === expectedResetValue) classification = 'RESET_TO_BURST_START_VALUE';

  return {
    comparable: true,
    classification,
    currentBurstShotsRemaining: current,
    nextBurstShotsRemaining: next,
    burstShotCount,
    expectedResetValue,
    expectedPostShotSequenceStep:
      classification === 'DESCEND_ONE' || classification === 'ZERO_TO_BURST_RESET',
  };
}

export function summarizeCandidateAlignment(rows) {
  const byKind = new Map();
  for (const row of rows ?? []) {
    for (const candidate of row?.diagnostic?.candidateRows ?? []) {
      if (!byKind.has(candidate.kind)) byKind.set(candidate.kind, []);
      byKind.get(candidate.kind).push(candidate);
    }
  }

  return [...byKind.entries()]
    .map(([kind, candidates]) => {
      const aligned = candidates.filter(row => row.alignedWithinTolerance).length;
      return {
        kind,
        comparable: candidates.length,
        aligned,
        alignmentRate: ratio(aligned, candidates.length),
        absoluteErrorSeconds: summarizeNumbers(
          candidates.map(row => row.absoluteErrorSeconds).filter(Number.isFinite),
        ),
        ratioToCandidate: summarizeNumbers(
          candidates.map(row => row.ratioToCandidate).filter(Number.isFinite),
        ),
      };
    })
    .sort((a, b) => b.alignmentRate - a.alignmentRate || b.comparable - a.comparable || a.kind.localeCompare(b.kind));
}

export function summarizeCounterSteps(steps) {
  const comparable = (steps ?? []).filter(row => row?.diagnostic?.comparable === true);
  const counts = {};
  let expected = 0;
  for (const row of comparable) {
    const key = row.diagnostic.classification;
    counts[key] = (counts[key] ?? 0) + 1;
    if (row.diagnostic.expectedPostShotSequenceStep) expected++;
  }
  return {
    comparable: comparable.length,
    expectedPostShotSequenceSteps: expected,
    expectedPostShotSequenceRate: ratio(expected, comparable.length),
    counts,
  };
}

export function classifyBurstBoundarySemantics({ boundaryCandidateSummary, counterSummary }) {
  const summaryByKind = new Map((boundaryCandidateSummary ?? []).map(row => [row.kind, row]));
  const fullCycle = summaryByKind.get('FULL_CYCLE_TIME');
  const intra = summaryByKind.get('INTRA_BURST_CYCLE_TIME');
  const remainder = summaryByKind.get('POST_BURST_REMAINDER');
  const enoughBoundary = (fullCycle?.comparable ?? 0) >= 20;
  const counterStrong = (
    (counterSummary?.comparable ?? 0) >= 20
    && Number.isFinite(counterSummary?.expectedPostShotSequenceRate)
    && counterSummary.expectedPostShotSequenceRate >= 0.90
  );

  if (
    enoughBoundary
    && Number.isFinite(fullCycle?.alignmentRate)
    && fullCycle.alignmentRate >= 0.95
    && (remainder?.alignmentRate ?? 0) <= 0.20
    && counterStrong
  ) {
    return 'BURST_ZERO_REMAINING_IS_POST_SHOT_BOUNDARY_AND_READY_DELAY_MATCHES_FULL_CYCLE_TIME';
  }

  if (
    enoughBoundary
    && Number.isFinite(intra?.alignmentRate)
    && intra.alignmentRate >= 0.95
    && counterStrong
  ) {
    return 'BURST_ZERO_REMAINING_IS_POST_SHOT_BOUNDARY_BUT_READY_DELAY_MATCHES_INTRA_BURST_TIME';
  }

  if (!counterStrong && (counterSummary?.comparable ?? 0) >= 20) {
    return 'BURST_COUNTER_PHASE_NOT_CLEANLY_POST_SHOT_SEQUENCE';
  }

  if (!enoughBoundary) return 'BURST_BOUNDARY_COVERAGE_INSUFFICIENT';
  return 'BURST_BOUNDARY_READY_DELAY_SEMANTICS_REMAIN_UNRESOLVED';
}

function compareCandidate(value, kind, seconds, options) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const absoluteToleranceSeconds = Number.isFinite(options.absoluteToleranceSeconds)
    ? options.absoluteToleranceSeconds
    : 1 / TICKS_PER_SECOND;
  const relativeTolerance = Number.isFinite(options.relativeTolerance)
    ? options.relativeTolerance
    : 0.05;
  const absoluteErrorSeconds = Math.abs(value - seconds);
  const toleranceSeconds = absoluteToleranceSeconds + (relativeTolerance * seconds);
  return {
    kind,
    seconds,
    absoluteErrorSeconds,
    toleranceSeconds,
    ratioToCandidate: value / seconds,
    alignedWithinTolerance: absoluteErrorSeconds <= toleranceSeconds + 1e-12,
  };
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
    mean: xs.reduce((sum, x) => sum + x, 0) / xs.length,
  };
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(a, b) {
  return b > 0 ? a / b : null;
}
