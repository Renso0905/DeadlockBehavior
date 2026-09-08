// Script184 cross-replay helpers.
//
// Frozen semantic carrier from Script183:
//   m_pModifierProp.m_bvEnabledPredictedStateMask.0002 bit 5 (mask 32)
//
// Cross-replay validation changes neither the carrier nor the consequence
// interpretation. It only asks whether the same rule replicates independently
// on the frozen rep01-rep05 cohort.
//
// An underpowered replay is neutral. A sufficiently powered replay that fails
// a semantic gate is contradictory.

export const CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS = Object.freeze({
  expectedReplayCount: 5,

  minAttackTransitionsPerReplay: 3000,
  minCarrierPresentPerReplay: 100,
  minCarrierAbsentPerReplay: 1000,
  minFieldCoverageRatePerReplay: 0.95,

  minZeroRateGivenCarrierPerReplay: 0.98,
  maxZeroRateWithoutCarrierPerReplay: 0.01,
  minResidualPositiveRatePerReplay: 0.99,
  maxResidualNegativeRatePerReplay: 0.001,

  minPooledCarrierPresent: 500,
  minPooledZeroRateGivenCarrier: 0.98,
  maxPooledZeroRateWithoutCarrier: 0.01,
  minPooledResidualPositiveRate: 0.99,
  maxPooledResidualNegativeRate: 0.001,

  minDistinctSupportingHeroesAcrossCohort: 10,
  minHeroCarrierPresentAcrossCohort: 8,
  minHeroZeroRateGivenCarrierAcrossCohort: 0.90,
});

export function summarizeReplayRows(
  rows,
  thresholds = CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS,
) {
  const covered = rows.filter(row => row.covered === true);

  const coverageRate =
    rows.length > 0
      ? covered.length / rows.length
      : null;

  const present = covered.filter(row => row.carrierPresent === true);
  const absent = covered.filter(row => row.carrierPresent === false);

  const presentPartition = partition(present);
  const absentPartition = partition(absent);

  const sufficientlyPowered =
    rows.length >= thresholds.minAttackTransitionsPerReplay
    && present.length >= thresholds.minCarrierPresentPerReplay
    && absent.length >= thresholds.minCarrierAbsentPerReplay
    && coverageRate !== null
    && coverageRate >= thresholds.minFieldCoverageRatePerReplay;

  const semanticPass =
    sufficientlyPowered
    && presentPartition.zeroRate !== null
    && presentPartition.zeroRate
      >= thresholds.minZeroRateGivenCarrierPerReplay
    && absentPartition.zeroRate !== null
    && absentPartition.zeroRate
      <= thresholds.maxZeroRateWithoutCarrierPerReplay
    && absentPartition.positiveRate !== null
    && absentPartition.positiveRate
      >= thresholds.minResidualPositiveRatePerReplay
    && absentPartition.negativeRate !== null
    && absentPartition.negativeRate
      <= thresholds.maxResidualNegativeRatePerReplay;

  const contradiction =
    sufficientlyPowered
    && !semanticPass;

  return {
    totalRows: rows.length,
    coveredRows: covered.length,
    coverageRate,

    present: presentPartition,
    absent: absentPartition,

    sufficientlyPowered,
    semanticPass,
    contradiction,
  };
}

export function summarizePooledRows(
  replayRows,
  thresholds = CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS,
) {
  const allRows =
    replayRows.flatMap(row => row.rows ?? []);

  const summary =
    summarizeReplayRowsWithPooledThresholds(
      allRows,
      thresholds,
    );

  const heroSupport =
    summarizeHeroSupport(
      allRows,
      thresholds,
    );

  return {
    ...summary,
    heroSupport,
  };
}

export function evaluateCrossReplayReplication(
  replayResults,
  thresholds = CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS,
) {
  const expectedCount =
    thresholds.expectedReplayCount;

  const allReplayNames =
    replayResults.map(row => row.replayName);

  const usable =
    replayResults.filter(row => row.integrityPass === true);

  const powered =
    replayResults.filter(
      row =>
        row.integrityPass === true
        && row.summary?.sufficientlyPowered === true,
    );

  const strong =
    replayResults.filter(
      row =>
        row.integrityPass === true
        && row.summary?.semanticPass === true,
    );

  const contradictory =
    replayResults.filter(
      row =>
        row.integrityPass === true
        && row.summary?.contradiction === true,
    );

  const pooled =
    summarizePooledRows(
      replayResults
        .filter(row => row.integrityPass === true)
        .map(row => ({
          rows: row.rows,
        })),
      thresholds,
    );

  const allFiveUsable =
    replayResults.length === expectedCount
    && usable.length === expectedCount;

  const allFivePowered =
    powered.length === expectedCount;

  const noContradictions =
    contradictory.length === 0;

  const allFiveStrong =
    strong.length === expectedCount;

  const pooledPass =
    pooled.semanticPass === true
    && pooled.heroSupport.supportingHeroCount
      >= thresholds.minDistinctSupportingHeroesAcrossCohort;

  const crossReplayReplicated =
    allFiveUsable
    && allFivePowered
    && noContradictions
    && allFiveStrong
    && pooledPass;

  return {
    replayCount: replayResults.length,
    replayNames: allReplayNames,

    usableReplays: usable.map(row => row.replayName),
    poweredReplays: powered.map(row => row.replayName),
    strongReplays: strong.map(row => row.replayName),
    contradictoryReplays:
      contradictory.map(row => row.replayName),

    allFiveUsable,
    allFivePowered,
    noContradictions,
    allFiveStrong,

    pooled,
    pooledPass,

    crossReplayReplicated,

    classification:
      crossReplayReplicated
        ? 'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS'
        : (
          contradictory.length > 0
            ? 'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_CONTRADICTED_IN_INDEPENDENT_REPLAY'
            : 'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_NOT_YET_CROSS_REPLAY_REPLICATED'
        ),
  };
}

export function summarizeHeroSupport(
  rows,
  thresholds = CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS,
) {
  const groups = new Map();

  for (const row of rows) {
    if (!row.covered) continue;

    if (!groups.has(row.heroId)) {
      groups.set(row.heroId, []);
    }

    groups.get(row.heroId).push(row);
  }

  const heroes =
    [...groups.entries()]
      .map(([heroId, heroRows]) => {
        const present =
          heroRows.filter(
            row => row.carrierPresent === true,
          );

        const absent =
          heroRows.filter(
            row => row.carrierPresent === false,
          );

        const presentPartition =
          partition(present);

        const absentPartition =
          partition(absent);

        const support =
          present.length
            >= thresholds.minHeroCarrierPresentAcrossCohort
          && presentPartition.zeroRate !== null
          && presentPartition.zeroRate
            >= thresholds.minHeroZeroRateGivenCarrierAcrossCohort;

        return {
          heroId,
          total: heroRows.length,
          present: presentPartition,
          absent: absentPartition,
          support,
        };
      })
      .sort(
        (a, b) =>
          b.present.total
          - a.present.total,
      );

  return {
    heroes,
    supportingHeroes:
      heroes
        .filter(row => row.support)
        .map(row => row.heroId),
    supportingHeroCount:
      heroes.filter(row => row.support).length,
  };
}

function summarizeReplayRowsWithPooledThresholds(
  rows,
  thresholds,
) {
  const covered = rows.filter(row => row.covered === true);

  const coverageRate =
    rows.length > 0
      ? covered.length / rows.length
      : null;

  const present =
    covered.filter(row => row.carrierPresent === true);

  const absent =
    covered.filter(row => row.carrierPresent === false);

  const presentPartition =
    partition(present);

  const absentPartition =
    partition(absent);

  const sufficientlyPowered =
    rows.length >= thresholds.minAttackTransitionsPerReplay
    && present.length >= thresholds.minPooledCarrierPresent
    && absent.length >= thresholds.minCarrierAbsentPerReplay
    && coverageRate !== null
    && coverageRate >= thresholds.minFieldCoverageRatePerReplay;

  const semanticPass =
    sufficientlyPowered
    && presentPartition.zeroRate !== null
    && presentPartition.zeroRate
      >= thresholds.minPooledZeroRateGivenCarrier
    && absentPartition.zeroRate !== null
    && absentPartition.zeroRate
      <= thresholds.maxPooledZeroRateWithoutCarrier
    && absentPartition.positiveRate !== null
    && absentPartition.positiveRate
      >= thresholds.minPooledResidualPositiveRate
    && absentPartition.negativeRate !== null
    && absentPartition.negativeRate
      <= thresholds.maxPooledResidualNegativeRate;

  return {
    totalRows: rows.length,
    coveredRows: covered.length,
    coverageRate,
    present: presentPartition,
    absent: absentPartition,
    sufficientlyPowered,
    semanticPass,
  };
}

function partition(rows) {
  let POSITIVE = 0;
  let ZERO = 0;
  let NEGATIVE = 0;

  for (const row of rows) {
    if (row.label === 'POSITIVE') POSITIVE++;
    if (row.label === 'ZERO') ZERO++;
    if (row.label === 'NEGATIVE') NEGATIVE++;
  }

  const semantic =
    POSITIVE + ZERO;

  const total =
    POSITIVE + ZERO + NEGATIVE;

  return {
    POSITIVE,
    ZERO,
    NEGATIVE,
    total,

    zeroRate:
      semantic > 0
        ? ZERO / semantic
        : null,

    positiveRate:
      total > 0
        ? POSITIVE / total
        : null,

    negativeRate:
      total > 0
        ? NEGATIVE / total
        : null,
  };
}
