export const CADENCE_ALIGNMENT_V02_THRESHOLDS = Object.freeze({
  aggregateStaticAlignmentRate: 0.95,
  perRegimeStaticAlignmentRate: 0.90,
  observedReadyAlignmentRate: 0.95,
  timingCrossCheckRate: 0.90,
  minimumRegimePairs: 100,
});

export function findCandidate(summaryRows, kind) {
  return (summaryRows ?? []).find(row => row?.kind === kind) ?? null;
}

export function weightedAlignment(rows) {
  const comparableRows = (rows ?? []).filter(row => Number.isFinite(row?.comparable) && row.comparable > 0);
  const comparable = comparableRows.reduce((sum, row) => sum + row.comparable, 0);
  const aligned = comparableRows.reduce((sum, row) => sum + (Number.isFinite(row?.aligned) ? row.aligned : 0), 0);
  return {
    aligned,
    comparable,
    alignmentRate: comparable > 0 ? aligned / comparable : null,
  };
}

export function buildCadenceV02Summary(script170) {
  const spacing = script170?.actualSpacingCandidateAlignment ?? {};
  const timing = script170?.timingFieldCrossChecks ?? {};

  const boundaryReady = findCandidate(spacing?.burstBoundarySustained, 'CURRENT_READY_DELAY');
  const boundaryStatic = findCandidate(spacing?.burstBoundarySustained, 'CYCLE_PLUS_INTRA');
  const positiveReady = findCandidate(spacing?.burstPositiveSustained, 'CURRENT_READY_DELAY');
  const positiveStatic = findCandidate(spacing?.burstPositiveSustained, 'INTRA_BURST_CYCLE_TIME');
  const nonBurstReady = findCandidate(spacing?.nonBurstSustained, 'CURRENT_READY_DELAY');
  const nonBurstStatic = findCandidate(spacing?.nonBurstSustained, 'NON_BURST_CYCLE');

  const observedReady = weightedAlignment([boundaryReady, positiveReady, nonBurstReady]);
  const staticV02 = weightedAlignment([boundaryStatic, positiveStatic, nonBurstStatic]);

  const boundaryTiming = timing?.burstBoundarySustained ?? {};

  return {
    observedRuntimeCarrier: {
      aggregate: observedReady,
      burstBoundary: boundaryReady,
      burstPositive: positiveReady,
      nonBurst: nonBurstReady,
      lastAttackDeltaVsReplaySpacing: boundaryTiming?.lastAttackDeltaVsActualSpacing ?? null,
      nextLastAttackVsCurrentNextPrimary: boundaryTiming?.nextAttackScheduledAtCurrentNextPrimary ?? null,
    },
    staticExplanatoryModelV02: {
      aggregate: staticV02,
      burstBoundary: {
        expectedKind: 'CYCLE_PLUS_INTRA',
        summary: boundaryStatic,
      },
      burstPositive: {
        expectedKind: 'INTRA_BURST_CYCLE_TIME',
        summary: positiveStatic,
      },
      nonBurst: {
        expectedKind: 'NON_BURST_CYCLE',
        summary: nonBurstStatic,
      },
    },
  };
}

export function summarizeHeroStaticV02(heroRow) {
  const regime = heroRow?.regime ?? null;
  if (regime === 'BURST') {
    const boundary = findCandidate(heroRow?.burstBoundarySustainedCandidateSummary, 'CYCLE_PLUS_INTRA');
    const positive = findCandidate(heroRow?.burstPositiveSustainedCandidateSummary, 'INTRA_BURST_CYCLE_TIME');
    return weightedAlignment([boundary, positive]);
  }
  if (regime === 'SINGLE_OR_AUTOMATIC_NON_BURST') {
    const nonBurst = findCandidate(heroRow?.nonBurstSustainedCandidateSummary, 'NON_BURST_CYCLE');
    return weightedAlignment([nonBurst]);
  }
  return { aligned: 0, comparable: 0, alignmentRate: null };
}

export function classifyCadenceAlignmentV02(summary, thresholds = CADENCE_ALIGNMENT_V02_THRESHOLDS) {
  const observed = summary?.observedRuntimeCarrier ?? {};
  const staticModel = summary?.staticExplanatoryModelV02 ?? {};

  const observedRows = [observed.burstBoundary, observed.burstPositive, observed.nonBurst];
  const observedStrong = observedRows.every(row => strong(row, thresholds.observedReadyAlignmentRate, thresholds.minimumRegimePairs));
  const observedAggregateStrong = strong(observed.aggregate, thresholds.observedReadyAlignmentRate, thresholds.minimumRegimePairs);

  const timingStrong = strongBoolean(observed.lastAttackDeltaVsReplaySpacing, thresholds.timingCrossCheckRate, thresholds.minimumRegimePairs)
    && strongBoolean(observed.nextLastAttackVsCurrentNextPrimary, thresholds.timingCrossCheckRate, thresholds.minimumRegimePairs);

  const staticRows = [
    staticModel?.burstBoundary?.summary,
    staticModel?.burstPositive?.summary,
    staticModel?.nonBurst?.summary,
  ];
  const staticRegimesStrong = staticRows.every(row => strong(row, thresholds.perRegimeStaticAlignmentRate, thresholds.minimumRegimePairs));
  const staticAggregateStrong = strong(staticModel.aggregate, thresholds.aggregateStaticAlignmentRate, thresholds.minimumRegimePairs);

  if (observedStrong && observedAggregateStrong && timingStrong && staticRegimesStrong && staticAggregateStrong) {
    return 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_READY_FOR_CROSS_REPLAY_VALIDATION';
  }
  if (observedStrong && observedAggregateStrong && timingStrong) {
    return 'OBSERVED_READY_SCHEDULE_STRONG_BUT_STATIC_EXPLANATORY_MODEL_REMAINS_PARTIAL';
  }
  return 'CADENCE_ALIGNMENT_V02_REQUIRES_FURTHER_DIAGNOSIS';
}

function strong(row, threshold, minN) {
  return Number.isFinite(row?.alignmentRate)
    && row.alignmentRate >= threshold
    && Number.isFinite(row?.comparable)
    && row.comparable >= minN;
}

function strongBoolean(row, threshold, minN) {
  return Number.isFinite(row?.alignmentRate)
    && row.alignmentRate >= threshold
    && Number.isFinite(row?.comparable)
    && row.comparable >= minN;
}
