// Script187 helpers.
//
// Frozen new hypothesis from Script186 interpretation:
//
//   logicalMain  = ZigZag(m_iClip)
//   logicalBonus = ZigZag(m_iBonusClip)
//
// Candidate logical ammo consumption for a transition:
//
//   combinedDrop = mainLogicalDrop + bonusLogicalDrop
//
// This script does not establish a magazine capacity or absolute zero-point.
// Sentinel offsets cancel in transition differences.

export const BONUS_ZIGZAG_THRESHOLDS = Object.freeze({
  minCarrierAbsentTransitions: 5000,
  minBonusChangingTransitions: 30,
  minMainZeroBonusChangingTransitions: 20,

  minBonusLogicalPositiveRate: 0.95,
  minBonusLogicalOneUnitRate: 0.90,

  minCombinedPositiveRate: 0.99,
  maxCombinedNegativeRate: 0.001,
});

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0
    ? 2 * raw
    : -2 * raw - 1;
}

export function enrichBonusLogicalTransition(row) {
  const previousBonusLogical =
    zigzagReencode(
      row.previousBonusClip,
    );

  const currentBonusLogical =
    zigzagReencode(
      row.currentBonusClip,
    );

  const bonusLogicalDrop =
    Number.isFinite(previousBonusLogical)
    && Number.isFinite(currentBonusLogical)
      ? previousBonusLogical
        - currentBonusLogical
      : null;

  const combinedDrop =
    Number.isFinite(row.wholeDrop)
    && Number.isFinite(bonusLogicalDrop)
      ? row.wholeDrop
        + bonusLogicalDrop
      : null;

  return {
    ...row,

    previousBonusLogical,
    currentBonusLogical,
    bonusLogicalDrop,
    combinedDrop,

    combinedLabel:
      Number.isFinite(combinedDrop)
        ? (
          combinedDrop > 0
            ? 'POSITIVE'
            : combinedDrop < 0
              ? 'NEGATIVE'
              : 'ZERO'
        )
        : 'UNEVALUABLE',
  };
}

export function evaluateBonusZigzag(
  rows,
  thresholds =
    BONUS_ZIGZAG_THRESHOLDS,
) {
  const absent =
    rows.filter(
      row =>
        row.covered === true
        && row.carrierPresent === false,
    );

  const evaluable =
    absent
      .map(
        enrichBonusLogicalTransition,
      )
      .filter(
        row =>
          Number.isFinite(
            row.bonusLogicalDrop,
          )
          && Number.isFinite(
            row.combinedDrop,
          ),
      );

  const bonusChanging =
    evaluable.filter(
      row =>
        Number.isFinite(
          row.bonusClipDelta,
        )
        && row.bonusClipDelta !== 0,
    );

  const mainZeroBonusChanging =
    bonusChanging.filter(
      row =>
        row.wholeDrop === 0,
    );

  const bonusLogicalPositive =
    mainZeroBonusChanging.filter(
      row =>
        row.bonusLogicalDrop > 0,
    );

  const bonusLogicalOneUnit =
    mainZeroBonusChanging.filter(
      row =>
        row.bonusLogicalDrop === 1,
    );

  const baseline =
    partitionBy(
      evaluable,
      row => row.wholeDrop,
    );

  const combined =
    partitionBy(
      evaluable,
      row => row.combinedDrop,
    );

  const bonusLogicalPositiveRate =
    mainZeroBonusChanging.length > 0
      ? bonusLogicalPositive.length
        / mainZeroBonusChanging.length
      : null;

  const bonusLogicalOneUnitRate =
    mainZeroBonusChanging.length > 0
      ? bonusLogicalOneUnit.length
        / mainZeroBonusChanging.length
      : null;

  const sufficientlyPowered =
    absent.length
      >= thresholds.minCarrierAbsentTransitions
    && bonusChanging.length
      >= thresholds.minBonusChangingTransitions
    && mainZeroBonusChanging.length
      >= thresholds.minMainZeroBonusChangingTransitions;

  const strongCandidate =
    sufficientlyPowered
    && bonusLogicalPositiveRate !== null
    && bonusLogicalPositiveRate
      >= thresholds.minBonusLogicalPositiveRate
    && bonusLogicalOneUnitRate !== null
    && bonusLogicalOneUnitRate
      >= thresholds.minBonusLogicalOneUnitRate
    && combined.positiveRate !== null
    && combined.positiveRate
      >= thresholds.minCombinedPositiveRate
    && combined.negativeRate !== null
    && combined.negativeRate
      <= thresholds.maxCombinedNegativeRate;

  return {
    totalRows:
      rows.length,

    carrierAbsent:
      absent.length,

    evaluable:
      evaluable.length,

    bonusChanging:
      bonusChanging.length,

    mainZeroBonusChanging:
      mainZeroBonusChanging.length,

    bonusLogicalPositive:
      bonusLogicalPositive.length,

    bonusLogicalOneUnit:
      bonusLogicalOneUnit.length,

    bonusLogicalPositiveRate,
    bonusLogicalOneUnitRate,

    baseline,
    combined,

    sufficientlyPowered,
    strongCandidate,

    classification:
      strongCandidate
        ? 'BONUS_CLIP_ZIGZAG_IS_STRONG_SECOND_LOGICAL_AMMO_COUNTER_CANDIDATE'
        : (
          sufficientlyPowered
            ? 'BONUS_CLIP_ZIGZAG_REPRESENTATION_REQUIRES_DIAGNOSIS'
            : 'TEST_REPLAY_UNDERPOWERED_FOR_BONUS_CLIP_ZIGZAG'
        ),

    byHero:
      summarizeByHero(
        evaluable,
      ),

    topRawDeltaPatterns:
      rawDeltaPatterns(
        mainZeroBonusChanging,
      ),

    examples:
      mainZeroBonusChanging
        .slice(0, 100),
  };
}

function summarizeByHero(rows) {
  const groups =
    new Map();

  for (const row of rows) {
    const heroId =
      row.heroId;

    if (!groups.has(heroId)) {
      groups.set(
        heroId,
        [],
      );
    }

    groups.get(heroId).push(
      row,
    );
  }

  return [...groups.entries()]
    .map(([heroId, heroRows]) => {
      const bonusChanging =
        heroRows.filter(
          row =>
            Number.isFinite(
              row.bonusClipDelta,
            )
            && row.bonusClipDelta !== 0,
        );

      const mainZero =
        bonusChanging.filter(
          row =>
            row.wholeDrop === 0,
        );

      const positive =
        mainZero.filter(
          row =>
            row.bonusLogicalDrop > 0,
        ).length;

      const one =
        mainZero.filter(
          row =>
            row.bonusLogicalDrop === 1,
        ).length;

      return {
        heroId,
        total:
          heroRows.length,

        bonusChanging:
          bonusChanging.length,

        mainZeroBonusChanging:
          mainZero.length,

        bonusLogicalPositiveRate:
          mainZero.length > 0
            ? positive / mainZero.length
            : null,

        bonusLogicalOneUnitRate:
          mainZero.length > 0
            ? one / mainZero.length
            : null,
      };
    })
    .sort(
      (a, b) =>
        b.mainZeroBonusChanging
        - a.mainZeroBonusChanging
        || b.bonusChanging
        - a.bonusChanging,
    );
}

function rawDeltaPatterns(rows) {
  const counts =
    new Map();

  for (const row of rows) {
    const key =
      [
        `hero=${row.heroId}`,
        `rawBonusDelta=${row.bonusClipDelta}`,
        `bonusLogicalDrop=${row.bonusLogicalDrop}`,
        `shots=${row.shotAdvance}`,
      ].join('|');

    counts.set(
      key,
      (counts.get(key) ?? 0) + 1,
    );
  }

  return [...counts.entries()]
    .map(([pattern, count]) => ({
      pattern,
      count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count,
    )
    .slice(0, 100);
}

function partitionBy(rows, valueFn) {
  let positive = 0;
  let zero = 0;
  let negative = 0;

  for (const row of rows) {
    const value =
      valueFn(row);

    if (!Number.isFinite(value)) {
      continue;
    }

    if (value > 0) {
      positive++;
    } else if (value < 0) {
      negative++;
    } else {
      zero++;
    }
  }

  const total =
    positive + zero + negative;

  return {
    total,
    positive,
    zero,
    negative,

    positiveRate:
      total > 0
        ? positive / total
        : null,

    zeroRate:
      total > 0
        ? zero / total
        : null,

    negativeRate:
      total > 0
        ? negative / total
        : null,
  };
}
