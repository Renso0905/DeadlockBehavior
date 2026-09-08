import { burstStaticCandidates, compareBurstBoundaryCandidates } from './burst-boundary-diagnostic.mjs';

const TICKS_PER_SECOND = 64;

export function classifyDischargeSignalProvenance(row) {
  const shot = Number(row?.transition?.shotNumberDelta) > 0;
  const last = row?.transition?.lastAttackTimeAdvanced === true;
  const clip = Number(row?.transition?.clipDelta) < 0;

  let classification = 'OTHER_DISCHARGE_SIGNAL';
  if (shot && last) classification = 'SHOT_NUMBER_AND_LAST_ATTACK';
  else if (shot) classification = 'SHOT_NUMBER_ONLY';
  else if (last) classification = 'LAST_ATTACK_ONLY';

  return {
    classification,
    shotNumberAdvanced: shot,
    lastAttackTimeAdvanced: last,
    clipDecreased: clip,
    changedLastAttackField: changedField(row, 'm_flLastAttackTime'),
    changedNextPrimaryField: changedField(row, 'm_flNextPrimaryAttack'),
    changedBurstRemainingField: changedField(row, 'm_nBurstShotsRemaining'),
    changedShotNumberField: changedField(row, 'm_nShotNumber'),
  };
}

export function findShortHorizonSameShotSettlement(rows, index, options = {}) {
  const current = rows?.[index] ?? null;
  if (!current) return { comparable: false, reason: 'CURRENT_ROW_MISSING' };

  const currentShot = finite(current?.observedWeaponState?.shotNumber);
  if (!Number.isFinite(currentShot)) {
    return { comparable: false, reason: 'SHOT_NUMBER_UNAVAILABLE' };
  }

  const maxTickOffset = Number.isFinite(options.maxTickOffset)
    ? Math.max(0, options.maxTickOffset)
    : 4;

  let settled = current;
  let subsequentSameShotEvents = 0;
  let timeMutationEvents = 0;
  let lastAttackAdvanced = false;
  let nextPrimaryChanged = false;

  const currentLast = finite(current?.observedWeaponState?.lastAttackTime);
  const currentNext = finite(current?.observedWeaponState?.nextPrimaryAttack);

  for (let j = index + 1; j < (rows?.length ?? 0); j++) {
    const candidate = rows[j];
    if (!candidate) break;
    if ((candidate.tick - current.tick) > maxTickOffset) break;
    if (candidate.effectContextId !== current.effectContextId) break;
    if (candidate?.observedWeaponState?.activeFireMode !== current?.observedWeaponState?.activeFireMode) break;

    const shot = finite(candidate?.observedWeaponState?.shotNumber);
    if (!Number.isFinite(shot) || shot !== currentShot) break;

    subsequentSameShotEvents++;
    settled = candidate;

    if (changedField(candidate, 'm_flLastAttackTime') || changedField(candidate, 'm_flNextPrimaryAttack')) {
      timeMutationEvents++;
    }

    const last = finite(candidate?.observedWeaponState?.lastAttackTime);
    const next = finite(candidate?.observedWeaponState?.nextPrimaryAttack);
    if (Number.isFinite(last) && Number.isFinite(currentLast) && last > currentLast + 1e-6) {
      lastAttackAdvanced = true;
    }
    if (Number.isFinite(next) && Number.isFinite(currentNext) && Math.abs(next - currentNext) > 1e-6) {
      nextPrimaryChanged = true;
    }
  }

  const readyDelaySeconds = readyDelayFromState(settled?.observedWeaponState);

  return {
    comparable: true,
    reason: null,
    maxTickOffset,
    currentTick: current.tick,
    settledTick: settled.tick,
    tickOffset: settled.tick - current.tick,
    subsequentSameShotEvents,
    timeMutationEvents,
    lastAttackAdvanced,
    nextPrimaryChanged,
    readyDelaySeconds,
    settledRow: settled,
  };
}

export function oneIntraOffsetCorrection(row, weaponRow, options = {}) {
  const staticFields = burstStaticCandidates(weaponRow);
  const currentReady = finite(row?.transition?.readyDelayCandidateSeconds);
  const intra = finite(staticFields?.intraBurstCycleTimeSeconds);

  if (!Number.isFinite(currentReady) || !Number.isFinite(intra)) {
    return {
      comparable: false,
      reason: 'READY_OR_INTRA_UNAVAILABLE',
      currentReadyDelaySeconds: currentReady,
      intraBurstCycleTimeSeconds: intra,
      correctedReadyDelaySeconds: null,
      fullCycleComparison: null,
    };
  }

  const corrected = currentReady - intra;
  const fullCycle = finite(staticFields?.cycleTimeSeconds);
  const comparison = compareScalar(corrected, fullCycle, options);

  return {
    comparable: Number.isFinite(corrected) && corrected >= 0 && comparison !== null,
    reason: comparison ? null : 'FULL_CYCLE_UNAVAILABLE',
    currentReadyDelaySeconds: currentReady,
    intraBurstCycleTimeSeconds: intra,
    correctedReadyDelaySeconds: corrected,
    fullCycleSeconds: fullCycle,
    fullCycleComparison: comparison,
  };
}

export function compareSettledReadyToBurstCandidates(settlement, boundaryRow, weaponRow, options = {}) {
  if (!settlement?.comparable || !Number.isFinite(settlement?.readyDelaySeconds)) {
    return {
      comparable: false,
      reason: settlement?.reason ?? 'SETTLED_READY_UNAVAILABLE',
      candidateRows: [],
    };
  }

  return compareBurstBoundaryCandidates(
    {
      transition: { readyDelayCandidateSeconds: settlement.readyDelaySeconds },
      observedWeaponState: {
        burstShotsRemaining: boundaryRow?.observedWeaponState?.burstShotsRemaining ?? 0,
      },
    },
    weaponRow,
    options,
  );
}

export function summarizeOneIntraCorrections(rows) {
  const comparable = (rows ?? []).filter(row => row?.oneIntra?.comparable === true);
  const aligned = comparable.filter(row => row.oneIntra.fullCycleComparison?.alignedWithinTolerance === true);
  return {
    comparable: comparable.length,
    alignedToFullCycle: aligned.length,
    alignmentRate: ratio(aligned.length, comparable.length),
    correctedRatioToFullCycle: summarizeNumbers(
      comparable
        .map(row => row.oneIntra.fullCycleComparison?.ratioToCandidate)
        .filter(Number.isFinite),
    ),
    correctedAbsoluteErrorSeconds: summarizeNumbers(
      comparable
        .map(row => row.oneIntra.fullCycleComparison?.absoluteErrorSeconds)
        .filter(Number.isFinite),
    ),
  };
}

export function summarizeSignalProvenance(rows) {
  const counts = {};
  let changedLast = 0;
  let changedNext = 0;
  let changedBoth = 0;
  let shotNumberAdvanced = 0;
  let lastAttackAdvanced = 0;

  for (const row of rows ?? []) {
    const p = row?.signalProvenance ?? classifyDischargeSignalProvenance(row);
    counts[p.classification] = (counts[p.classification] ?? 0) + 1;
    if (p.changedLastAttackField) changedLast++;
    if (p.changedNextPrimaryField) changedNext++;
    if (p.changedLastAttackField && p.changedNextPrimaryField) changedBoth++;
    if (p.shotNumberAdvanced) shotNumberAdvanced++;
    if (p.lastAttackTimeAdvanced) lastAttackAdvanced++;
  }

  return {
    total: (rows ?? []).length,
    counts,
    changedLastAttackField: changedLast,
    changedNextPrimaryField: changedNext,
    changedBothTimingFields: changedBoth,
    shotNumberAdvanced,
    lastAttackTimeAdvanced: lastAttackAdvanced,
  };
}

export function summarizeSettlements(rows) {
  const comparable = (rows ?? []).filter(row => row?.settlement?.comparable === true);
  const withSubsequent = comparable.filter(row => row.settlement.subsequentSameShotEvents > 0);
  const withTimeMutation = comparable.filter(row => row.settlement.timeMutationEvents > 0);
  const lastAdvanced = comparable.filter(row => row.settlement.lastAttackAdvanced === true);
  const nextChanged = comparable.filter(row => row.settlement.nextPrimaryChanged === true);

  return {
    comparable: comparable.length,
    withSubsequentSameShotEvent: withSubsequent.length,
    withTimingMutationEvent: withTimeMutation.length,
    lastAttackAdvancedWithinWindow: lastAdvanced.length,
    nextPrimaryChangedWithinWindow: nextChanged.length,
    tickOffset: summarizeNumbers(
      withSubsequent.map(row => row.settlement.tickOffset).filter(Number.isFinite),
    ),
  };
}

export function classifyBoundaryPhaseDiagnostic({
  boundaryCount,
  currentFullCycleAlignmentRate,
  oneIntraSummary,
  settledFullCycleAlignmentRate,
  settledComparable,
  timingMutationCount,
}) {
  if ((boundaryCount ?? 0) < 20) return 'BURST_BOUNDARY_PHASE_COVERAGE_INSUFFICIENT';

  const oneIntraStrong = (
    (oneIntraSummary?.comparable ?? 0) >= 20
    && Number.isFinite(oneIntraSummary?.alignmentRate)
    && oneIntraSummary.alignmentRate >= 0.95
  );
  const currentPoor = !Number.isFinite(currentFullCycleAlignmentRate)
    || currentFullCycleAlignmentRate <= 0.20;
  const settledStrong = (
    (settledComparable ?? 0) >= 20
    && Number.isFinite(settledFullCycleAlignmentRate)
    && settledFullCycleAlignmentRate >= 0.90
  );
  const mutationObserved = (timingMutationCount ?? 0) >= 20;

  if (currentPoor && oneIntraStrong && settledStrong && mutationObserved) {
    return 'BURST_BOUNDARY_ONE_INTRA_OFFSET_CONFIRMED_BY_SHORT_HORIZON_FIELD_SETTLEMENT';
  }
  if (currentPoor && oneIntraStrong && !settledStrong) {
    return 'BURST_BOUNDARY_ONE_INTRA_OFFSET_PATTERN_WITHOUT_FIELD_SETTLEMENT_CONFIRMATION';
  }
  if (settledStrong && mutationObserved) {
    return 'BURST_BOUNDARY_SHORT_HORIZON_FIELD_SETTLEMENT_RECOVERS_FULL_CYCLE_WITHOUT_EXACT_ONE_INTRA_PATTERN';
  }
  return 'BURST_BOUNDARY_NOT_EXPLAINED_BY_ONE_INTRA_OFFSET_OR_SHORT_HORIZON_FIELD_PHASE';
}

function readyDelayFromState(state) {
  const last = finite(state?.lastAttackTime);
  const next = finite(state?.nextPrimaryAttack);
  if (!Number.isFinite(last) || !Number.isFinite(next) || next < last) return null;
  return next - last;
}

function changedField(row, suffix) {
  return (row?.changedFields ?? []).some(field => String(field).endsWith(suffix));
}

function compareScalar(value, candidate, options = {}) {
  if (!Number.isFinite(value) || !Number.isFinite(candidate) || candidate <= 0) return null;
  const absoluteToleranceSeconds = Number.isFinite(options.absoluteToleranceSeconds)
    ? options.absoluteToleranceSeconds
    : 1 / TICKS_PER_SECOND;
  const relativeTolerance = Number.isFinite(options.relativeTolerance)
    ? options.relativeTolerance
    : 0.05;
  const absoluteErrorSeconds = Math.abs(value - candidate);
  const toleranceSeconds = absoluteToleranceSeconds + (relativeTolerance * candidate);
  return {
    candidateSeconds: candidate,
    absoluteErrorSeconds,
    toleranceSeconds,
    ratioToCandidate: value / candidate,
    alignedWithinTolerance: absoluteErrorSeconds <= toleranceSeconds + 1e-12,
  };
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
