const DEFAULT_TICKS_PER_SECOND = 64;

export function staticCadenceCandidates(weaponRow) {
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

  const cyclePlusIntraSeconds = (
    regime === 'BURST'
    && Number.isFinite(cycleTimeSeconds)
    && Number.isFinite(intraBurstCycleTimeSeconds)
  )
    ? cycleTimeSeconds + intraBurstCycleTimeSeconds
    : null;

  return {
    regime,
    cycleTimeSeconds,
    intraBurstCycleTimeSeconds,
    burstShotCount,
    postBurstRemainderSeconds,
    cyclePlusIntraSeconds,
  };
}

export function buildObservedDischargePair(currentRow, nextRow, weaponRow, options = {}) {
  const ticksPerSecond = Number.isFinite(options.ticksPerSecond)
    ? options.ticksPerSecond
    : DEFAULT_TICKS_PER_SECOND;

  if (!currentRow || !nextRow) return { comparable: false, reason: 'PAIR_MISSING' };
  if (currentRow.playerKey !== nextRow.playerKey) return { comparable: false, reason: 'PLAYER_CHANGED' };
  if (currentRow.weaponEntityIndex !== nextRow.weaponEntityIndex) return { comparable: false, reason: 'WEAPON_ENTITY_CHANGED' };
  if (currentRow.effectContextId !== nextRow.effectContextId) return { comparable: false, reason: 'EFFECT_CONTEXT_CHANGED' };

  const currentMode = finite(currentRow?.observedWeaponState?.activeFireMode);
  const nextMode = finite(nextRow?.observedWeaponState?.activeFireMode);
  if (currentMode !== nextMode) return { comparable: false, reason: 'ACTIVE_FIRE_MODE_CHANGED' };

  const tickDelta = finite(nextRow.tick) - finite(currentRow.tick);
  if (!Number.isFinite(tickDelta) || tickDelta <= 0) {
    return { comparable: false, reason: 'NONPOSITIVE_DISCHARGE_TICK_DELTA' };
  }

  const actualSpacingSeconds = tickDelta / ticksPerSecond;
  const readyDelaySeconds = finite(currentRow?.transition?.readyDelayCandidateSeconds);
  const burstShotsRemaining = finite(currentRow?.observedWeaponState?.burstShotsRemaining);
  const staticCandidates = staticCadenceCandidates(weaponRow);

  const currentLastAttack = finite(currentRow?.observedWeaponState?.lastAttackTime);
  const nextLastAttack = finite(nextRow?.observedWeaponState?.lastAttackTime);
  const currentNextPrimary = finite(currentRow?.observedWeaponState?.nextPrimaryAttack);

  const lastAttackDeltaSeconds = (
    Number.isFinite(currentLastAttack)
    && Number.isFinite(nextLastAttack)
  )
    ? nextLastAttack - currentLastAttack
    : null;

  const nextLastAttackMinusCurrentNextPrimarySeconds = (
    Number.isFinite(nextLastAttack)
    && Number.isFinite(currentNextPrimary)
  )
    ? nextLastAttack - currentNextPrimary
    : null;

  const sustainedUpperTicks = Number.isFinite(readyDelaySeconds)
    ? (readyDelaySeconds * ticksPerSecond) + 2
    : null;

  const script167CompatibleSustained = Number.isFinite(sustainedUpperTicks)
    ? tickDelta <= sustainedUpperTicks + 1e-12
    : false;

  const candidateRows = buildCandidateRows({
    actualSpacingSeconds,
    readyDelaySeconds,
    staticCandidates,
    burstShotsRemaining,
    options,
  });

  return {
    comparable: true,
    reason: null,
    heroId: currentRow.heroId ?? null,
    playerKey: currentRow.playerKey,
    weaponEntityIndex: currentRow.weaponEntityIndex,
    currentTick: currentRow.tick,
    nextTick: nextRow.tick,
    tickDelta,
    actualSpacingSeconds,
    readyDelaySeconds,
    script167CompatibleSustained,
    burstShotsRemaining,
    currentContinuousShots: finite(currentRow?.observedWeaponState?.continuousShots),
    nextContinuousShots: finite(nextRow?.observedWeaponState?.continuousShots),
    currentShotNumber: finite(currentRow?.observedWeaponState?.shotNumber),
    nextShotNumber: finite(nextRow?.observedWeaponState?.shotNumber),
    staticCandidates,
    candidateRows,
    timingFieldChecks: {
      lastAttackDeltaSeconds,
      lastAttackDeltaVsActualSpacing: compareValue(
        lastAttackDeltaSeconds,
        actualSpacingSeconds,
        options,
      ),
      nextLastAttackMinusCurrentNextPrimarySeconds,
      nextAttackScheduledAtCurrentNextPrimary: compareZero(
        nextLastAttackMinusCurrentNextPrimarySeconds,
        readyDelaySeconds,
        options,
      ),
    },
  };
}

export function summarizeCandidateRows(pairs, options = {}) {
  const byKind = new Map();
  for (const pair of pairs ?? []) {
    for (const row of pair?.candidateRows ?? []) {
      if (!byKind.has(row.kind)) byKind.set(row.kind, []);
      byKind.get(row.kind).push(row);
    }
  }

  return [...byKind.entries()]
    .map(([kind, rows]) => summarizeOneCandidate(kind, rows))
    .sort((a, b) => b.alignmentRate - a.alignmentRate || b.comparable - a.comparable || a.kind.localeCompare(b.kind));
}

export function summarizeTimingFieldChecks(pairs) {
  const comparablePairs = (pairs ?? []).filter(row => row?.comparable === true);
  const lastAttack = comparablePairs
    .map(row => row?.timingFieldChecks?.lastAttackDeltaVsActualSpacing)
    .filter(row => row?.comparable === true);
  const scheduled = comparablePairs
    .map(row => row?.timingFieldChecks?.nextAttackScheduledAtCurrentNextPrimary)
    .filter(row => row?.comparable === true);

  return {
    lastAttackDeltaVsActualSpacing: summarizeBooleanComparisons(lastAttack),
    nextAttackScheduledAtCurrentNextPrimary: summarizeBooleanComparisons(scheduled),
  };
}

export function classifyObservedSpacing({
  burstPositiveSustained,
  burstBoundarySustained,
  nonBurstSustained,
  boundaryTiming,
}) {
  const positive = candidateMap(burstPositiveSustained);
  const boundary = candidateMap(burstBoundarySustained);

  const intraStrong = strong(positive.get('INTRA_BURST_CYCLE_TIME'), 0.95, 100);
  const boundaryCyclePlusIntraStrong = strong(boundary.get('CYCLE_PLUS_INTRA'), 0.90, 100);
  const boundaryReadyStrong = strong(boundary.get('CURRENT_READY_DELAY'), 0.95, 100);
  const boundaryFullWeak = weak(boundary.get('FULL_CYCLE_TIME'), 0.20, 100);
  const scheduleStrong = strongBoolean(
    boundaryTiming?.nextAttackScheduledAtCurrentNextPrimary,
    0.90,
    100,
  );

  if (
    intraStrong
    && boundaryCyclePlusIntraStrong
    && boundaryReadyStrong
    && boundaryFullWeak
    && scheduleStrong
  ) {
    return 'ACTUAL_BURST_SPACING_SUPPORTS_CYCLE_PLUS_INTRA_RUNTIME_BOUNDARY_SCHEDULE';
  }

  const boundaryFullStrong = strong(boundary.get('FULL_CYCLE_TIME'), 0.90, 100);
  if (intraStrong && boundaryFullStrong && scheduleStrong) {
    return 'ACTUAL_BURST_SPACING_SUPPORTS_FULL_CYCLE_RUNTIME_BOUNDARY_SCHEDULE';
  }

  const boundaryReadyOnly = boundaryReadyStrong && scheduleStrong;
  if (intraStrong && boundaryReadyOnly) {
    return 'ACTUAL_BURST_SPACING_SUPPORTS_READY_CARRIER_BUT_STATIC_BOUNDARY_MAPPING_REMAINS_UNRESOLVED';
  }

  const nonBurst = candidateMap(nonBurstSustained);
  if (strong(nonBurst.get('NON_BURST_CYCLE'), 0.90, 100)) {
    return 'NON_BURST_STATIC_ALIGNMENT_STRONG_BUT_BURST_BOUNDARY_REMAINS_UNRESOLVED';
  }

  return 'ACTUAL_DISCHARGE_SPACING_REQUIRES_FURTHER_CADENCE_DIAGNOSIS';
}

function buildCandidateRows({
  actualSpacingSeconds,
  readyDelaySeconds,
  staticCandidates,
  burstShotsRemaining,
  options,
}) {
  const rows = [];

  if (Number.isFinite(readyDelaySeconds) && readyDelaySeconds >= 0) {
    const row = compareCandidate(actualSpacingSeconds, 'CURRENT_READY_DELAY', readyDelaySeconds, options);
    if (row) rows.push(row);
  }

  if (staticCandidates.regime === 'SINGLE_OR_AUTOMATIC_NON_BURST') {
    const row = compareCandidate(
      actualSpacingSeconds,
      'NON_BURST_CYCLE',
      staticCandidates.cycleTimeSeconds,
      options,
    );
    if (row) rows.push(row);
    return rows;
  }

  if (staticCandidates.regime !== 'BURST') return rows;

  const candidates = [
    ['FULL_CYCLE_TIME', staticCandidates.cycleTimeSeconds],
    ['INTRA_BURST_CYCLE_TIME', staticCandidates.intraBurstCycleTimeSeconds],
    ['POST_BURST_REMAINDER', staticCandidates.postBurstRemainderSeconds],
    ['CYCLE_PLUS_INTRA', staticCandidates.cyclePlusIntraSeconds],
  ];

  for (const [kind, seconds] of candidates) {
    const row = compareCandidate(actualSpacingSeconds, kind, seconds, options);
    if (!row) continue;
    row.runtimeBoundaryClass = Number.isFinite(burstShotsRemaining)
      ? (burstShotsRemaining === 0 ? 'ZERO_REMAINING_BOUNDARY' : 'POSITIVE_REMAINING')
      : 'UNKNOWN';
    rows.push(row);
  }

  return rows;
}

function compareCandidate(value, kind, seconds, options = {}) {
  if (!Number.isFinite(value) || !Number.isFinite(seconds) || seconds <= 0) return null;
  const absoluteToleranceSeconds = Number.isFinite(options.absoluteToleranceSeconds)
    ? options.absoluteToleranceSeconds
    : 1 / DEFAULT_TICKS_PER_SECOND;
  const relativeTolerance = Number.isFinite(options.relativeTolerance)
    ? options.relativeTolerance
    : 0.05;
  const absoluteErrorSeconds = Math.abs(value - seconds);
  const toleranceSeconds = absoluteToleranceSeconds + (relativeTolerance * seconds);
  return {
    kind,
    seconds,
    actualSpacingSeconds: value,
    absoluteErrorSeconds,
    toleranceSeconds,
    ratioToCandidate: value / seconds,
    alignedWithinTolerance: absoluteErrorSeconds <= toleranceSeconds + 1e-12,
  };
}

function compareValue(observed, expected, options = {}) {
  if (!Number.isFinite(observed) || !Number.isFinite(expected)) {
    return { comparable: false, alignedWithinTolerance: false };
  }
  const absoluteToleranceSeconds = Number.isFinite(options.absoluteToleranceSeconds)
    ? options.absoluteToleranceSeconds
    : 1 / DEFAULT_TICKS_PER_SECOND;
  const relativeTolerance = Number.isFinite(options.relativeTolerance)
    ? options.relativeTolerance
    : 0.05;
  const absoluteErrorSeconds = Math.abs(observed - expected);
  const toleranceSeconds = absoluteToleranceSeconds + (relativeTolerance * Math.max(Math.abs(expected), 1e-9));
  return {
    comparable: true,
    observed,
    expected,
    absoluteErrorSeconds,
    toleranceSeconds,
    alignedWithinTolerance: absoluteErrorSeconds <= toleranceSeconds + 1e-12,
  };
}

function compareZero(observedDifference, scale, options = {}) {
  if (!Number.isFinite(observedDifference)) {
    return { comparable: false, alignedWithinTolerance: false };
  }
  const absoluteToleranceSeconds = Number.isFinite(options.absoluteToleranceSeconds)
    ? options.absoluteToleranceSeconds
    : 1 / DEFAULT_TICKS_PER_SECOND;
  const relativeTolerance = Number.isFinite(options.relativeTolerance)
    ? options.relativeTolerance
    : 0.05;
  const toleranceSeconds = absoluteToleranceSeconds + (
    relativeTolerance * Math.max(Number.isFinite(scale) ? Math.abs(scale) : 0, 1e-9)
  );
  return {
    comparable: true,
    observedDifference,
    absoluteErrorSeconds: Math.abs(observedDifference),
    toleranceSeconds,
    alignedWithinTolerance: Math.abs(observedDifference) <= toleranceSeconds + 1e-12,
  };
}

function summarizeOneCandidate(kind, rows) {
  const aligned = rows.filter(row => row.alignedWithinTolerance).length;
  return {
    kind,
    comparable: rows.length,
    aligned,
    alignmentRate: ratio(aligned, rows.length),
    absoluteErrorSeconds: summarizeNumbers(rows.map(row => row.absoluteErrorSeconds)),
    ratioToCandidate: summarizeNumbers(rows.map(row => row.ratioToCandidate)),
  };
}

function summarizeBooleanComparisons(rows) {
  const comparable = rows.length;
  const aligned = rows.filter(row => row.alignedWithinTolerance).length;
  return {
    comparable,
    aligned,
    alignmentRate: ratio(aligned, comparable),
    absoluteErrorSeconds: summarizeNumbers(rows.map(row => row.absoluteErrorSeconds)),
  };
}

function candidateMap(summary) {
  return new Map((summary ?? []).map(row => [row.kind, row]));
}

function strong(row, threshold, minimumN) {
  return (
    (row?.comparable ?? 0) >= minimumN
    && Number.isFinite(row?.alignmentRate)
    && row.alignmentRate >= threshold
  );
}

function weak(row, threshold, minimumN) {
  return (
    (row?.comparable ?? 0) >= minimumN
    && Number.isFinite(row?.alignmentRate)
    && row.alignmentRate <= threshold
  );
}

function strongBoolean(row, threshold, minimumN) {
  return (
    (row?.comparable ?? 0) >= minimumN
    && Number.isFinite(row?.alignmentRate)
    && row.alignmentRate >= threshold
  );
}

function summarizeNumbers(values) {
  const xs = (values ?? []).filter(Number.isFinite).sort((a, b) => a - b);
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
