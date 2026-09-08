export const READY_SCHEDULE_REPLICATION_THRESHOLDS = Object.freeze({
  requiredIndependentReplays: 5,
  minimumReplaySustainedPairs: 100,
  observedReadyAlignmentRate: 0.95,
  timingCrossCheckRate: 0.90,
  minimumPooledRegimePairs: 100,
});

export function weightedAlignment(rows) {
  const usable = (rows ?? []).filter(row => Number.isFinite(row?.comparable) && row.comparable > 0);
  const comparable = usable.reduce((sum, row) => sum + row.comparable, 0);
  const aligned = usable.reduce((sum, row) => sum + (Number.isFinite(row?.aligned) ? row.aligned : 0), 0);
  return {
    aligned,
    comparable,
    alignmentRate: comparable > 0 ? aligned / comparable : null,
  };
}

export function summarizeReadyScheduleReplication(replays, thresholds = READY_SCHEDULE_REPLICATION_THRESHOLDS) {
  const rows = replays ?? [];
  const pooled = {
    observed: {
      aggregate: weightedAlignment(rows.map(row => row?.observed?.aggregate)),
      burstBoundary: weightedAlignment(rows.map(row => row?.observed?.burstBoundary)),
      burstPositive: weightedAlignment(rows.map(row => row?.observed?.burstPositive)),
      nonBurst: weightedAlignment(rows.map(row => row?.observed?.nonBurst)),
      lastAttackDeltaVsReplaySpacing: weightedAlignment(rows.map(row => row?.observed?.lastAttackDeltaVsReplaySpacing)),
      nextLastAttackVsCurrentNextPrimary: weightedAlignment(rows.map(row => row?.observed?.nextLastAttackVsCurrentNextPrimary)),
    },
    staticModelV02: {
      aggregate: weightedAlignment(rows.map(row => row?.staticModelV02?.aggregate)),
      burstBoundary: weightedAlignment(rows.map(row => row?.staticModelV02?.burstBoundary)),
      burstPositive: weightedAlignment(rows.map(row => row?.staticModelV02?.burstPositive)),
      nonBurst: weightedAlignment(rows.map(row => row?.staticModelV02?.nonBurst)),
    },
  };

  const perReplay = rows.map(row => {
    const enoughPairs = (row?.counts?.sustainedPairs ?? 0) >= thresholds.minimumReplaySustainedPairs;
    const observedStrong = strong(row?.observed?.aggregate, thresholds.observedReadyAlignmentRate, thresholds.minimumReplaySustainedPairs);
    return {
      replay: row?.replay ?? null,
      enoughPairs,
      observedStrong,
      pass: row?.integrityPass === true && enoughPairs && observedStrong,
      sustainedPairs: row?.counts?.sustainedPairs ?? 0,
      observedAlignmentRate: row?.observed?.aggregate?.alignmentRate ?? null,
    };
  });

  const sampledRegimeChecks = [
    ['burstBoundary', pooled.observed.burstBoundary],
    ['burstPositive', pooled.observed.burstPositive],
    ['nonBurst', pooled.observed.nonBurst],
  ].map(([name, row]) => ({
    name,
    sampled: (row?.comparable ?? 0) >= thresholds.minimumPooledRegimePairs,
    pass: (row?.comparable ?? 0) < thresholds.minimumPooledRegimePairs
      ? true
      : strong(row, thresholds.observedReadyAlignmentRate, thresholds.minimumPooledRegimePairs),
    summary: row,
  }));

  const boundaryTimingSampled = (
    (pooled.observed.lastAttackDeltaVsReplaySpacing?.comparable ?? 0) >= thresholds.minimumPooledRegimePairs
    && (pooled.observed.nextLastAttackVsCurrentNextPrimary?.comparable ?? 0) >= thresholds.minimumPooledRegimePairs
  );

  const boundaryTimingPass = !boundaryTimingSampled || (
    strong(
      pooled.observed.lastAttackDeltaVsReplaySpacing,
      thresholds.timingCrossCheckRate,
      thresholds.minimumPooledRegimePairs,
    )
    && strong(
      pooled.observed.nextLastAttackVsCurrentNextPrimary,
      thresholds.timingCrossCheckRate,
      thresholds.minimumPooledRegimePairs,
    )
  );

  const replayCountPass = rows.length === thresholds.requiredIndependentReplays;
  const allReplayPrimaryPass = perReplay.length === thresholds.requiredIndependentReplays
    && perReplay.every(row => row.pass);
  const pooledObservedPass = strong(
    pooled.observed.aggregate,
    thresholds.observedReadyAlignmentRate,
    thresholds.minimumReplaySustainedPairs * thresholds.requiredIndependentReplays,
  );
  const sampledRegimesPass = sampledRegimeChecks.every(row => row.pass);

  const strongReplication = (
    replayCountPass
    && allReplayPrimaryPass
    && pooledObservedPass
    && sampledRegimesPass
    && boundaryTimingPass
  );

  return {
    thresholds,
    replayCount: rows.length,
    replayCountPass,
    perReplay,
    pooled,
    sampledRegimeChecks,
    boundaryTiming: {
      sampled: boundaryTimingSampled,
      pass: boundaryTimingPass,
      lastAttackDeltaVsReplaySpacing: pooled.observed.lastAttackDeltaVsReplaySpacing,
      nextLastAttackVsCurrentNextPrimary: pooled.observed.nextLastAttackVsCurrentNextPrimary,
    },
    gates: {
      allReplayPrimaryPass,
      pooledObservedPass,
      sampledRegimesPass,
      boundaryTimingPass,
    },
    strongReplication,
    classification: strongReplication
      ? 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS'
      : 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_CROSS_REPLAY_REPLICATION_REQUIRES_DIAGNOSIS',
  };
}

function strong(row, threshold, minimumN) {
  return (
    (row?.comparable ?? 0) >= minimumN
    && Number.isFinite(row?.alignmentRate)
    && row.alignmentRate >= threshold
  );
}
