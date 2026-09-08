// Script188 helpers.
//
// Diagnostic-only application of the Script187 frozen hypothesis to the
// already-consumed rep01-rep05 cohort:
//
//   logicalMain  = ZigZag(m_iClip)
//   logicalBonus = ZigZag(m_iBonusClip)
//   combinedDrop = drop(logicalMain) + drop(logicalBonus)
//
// This is NOT independent replication. rep01-rep05 were used to form the
// bonus-ZigZag hypothesis through Scripts185-186.

export const COMBINED_AMMO_DIAGNOSTIC_THRESHOLDS = Object.freeze({
  minInformativeBonusTransitionsPerHero: 20,
  minBonusLogicalPositiveRate: 0.95,
  minBonusLogicalOneUnitRate: 0.90,
  minSupportingHeroes: 3,
});

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function enrichCombinedTransition(row) {
  const previousBonusLogical =
    zigzagReencode(row.previousBonusClip);

  const currentBonusLogical =
    zigzagReencode(row.currentBonusClip);

  const bonusLogicalDrop =
    Number.isFinite(previousBonusLogical)
    && Number.isFinite(currentBonusLogical)
      ? previousBonusLogical - currentBonusLogical
      : null;

  const combinedDrop =
    Number.isFinite(row.wholeDrop)
    && Number.isFinite(bonusLogicalDrop)
      ? row.wholeDrop + bonusLogicalDrop
      : null;

  return {
    ...row,
    previousBonusLogical,
    currentBonusLogical,
    bonusLogicalDrop,
    combinedDrop,
    combinedLabel:
      !Number.isFinite(combinedDrop)
        ? 'UNEVALUABLE'
        : combinedDrop > 0
          ? 'POSITIVE'
          : combinedDrop < 0
            ? 'NEGATIVE'
            : 'ZERO',
  };
}

export function summarizeCombinedAmmoRows(
  rows,
  thresholds = COMBINED_AMMO_DIAGNOSTIC_THRESHOLDS,
) {
  const absent =
    rows.filter(
      row =>
        row.covered === true
        && row.carrierPresent === false,
    )
    .map(enrichCombinedTransition)
    .filter(
      row =>
        Number.isFinite(row.bonusLogicalDrop)
        && Number.isFinite(row.combinedDrop),
    );

  const baseline =
    partition(absent, row => row.wholeDrop);

  const combined =
    partition(absent, row => row.combinedDrop);

  const mainZeroBonusChanging =
    absent.filter(
      row =>
        row.wholeDrop === 0
        && Number.isFinite(row.bonusClipDelta)
        && row.bonusClipDelta !== 0,
    );

  const bonusPositive =
    mainZeroBonusChanging.filter(
      row => row.bonusLogicalDrop > 0,
    );

  const bonusOne =
    mainZeroBonusChanging.filter(
      row => row.bonusLogicalDrop === 1,
    );

  const byHero =
    summarizeByHero(
      absent,
      thresholds,
    );

  const byReplay =
    summarizeByReplay(
      absent,
    );

  const residualRows =
    absent.filter(
      row =>
        row.combinedLabel === 'ZERO'
        || row.combinedLabel === 'NEGATIVE',
    );

  const supportingHeroes =
    byHero
      .filter(row => row.support)
      .map(row => row.heroId);

  return {
    carrierAbsent:
      absent.length,

    baseline,
    combined,

    positiveRateGain:
      Number.isFinite(combined.positiveRate)
      && Number.isFinite(baseline.positiveRate)
        ? combined.positiveRate - baseline.positiveRate
        : null,

    baselineResidual:
      baseline.zero + baseline.negative,

    combinedResidual:
      combined.zero + combined.negative,

    residualReduction:
      (baseline.zero + baseline.negative) > 0
        ? 1 - (
          (combined.zero + combined.negative)
          / (baseline.zero + baseline.negative)
        )
        : null,

    mainZeroBonusChanging:
      mainZeroBonusChanging.length,

    bonusLogicalPositive:
      bonusPositive.length,

    bonusLogicalOne:
      bonusOne.length,

    bonusLogicalPositiveRate:
      mainZeroBonusChanging.length > 0
        ? bonusPositive.length
          / mainZeroBonusChanging.length
        : null,

    bonusLogicalOneUnitRate:
      mainZeroBonusChanging.length > 0
        ? bonusOne.length
          / mainZeroBonusChanging.length
        : null,

    byHero,
    byReplay,

    supportingHeroes,
    supportingHeroCount:
      supportingHeroes.length,

    classification:
      supportingHeroes.length
        >= thresholds.minSupportingHeroes
      && mainZeroBonusChanging.length > 0
      && bonusPositive.length
        / mainZeroBonusChanging.length
        >= thresholds.minBonusLogicalPositiveRate
      && bonusOne.length
        / mainZeroBonusChanging.length
        >= thresholds.minBonusLogicalOneUnitRate
        ? 'BONUS_CLIP_ZIGZAG_GENERALIZES_ACROSS_MULTIPLE_HEROES_IN_CONSUMED_COHORT'
        : 'BONUS_CLIP_ZIGZAG_GENERALIZATION_REMAINS_DIAGNOSTIC',

    remainingResidualByHero:
      residualGroup(
        residualRows,
        row => String(row.heroId),
      ),

    remainingResidualByReplay:
      residualGroup(
        residualRows,
        row => row.replayName,
      ),

    topRemainingPatterns:
      topPatterns(
        residualRows,
      ),
  };
}

function summarizeByHero(rows, thresholds) {
  const groups = new Map();

  for (const row of rows) {
    if (!groups.has(row.heroId)) {
      groups.set(row.heroId, []);
    }
    groups.get(row.heroId).push(row);
  }

  return [...groups.entries()]
    .map(([heroId, heroRows]) => {
      const informative =
        heroRows.filter(
          row =>
            row.wholeDrop === 0
            && Number.isFinite(row.bonusClipDelta)
            && row.bonusClipDelta !== 0,
        );

      const positive =
        informative.filter(
          row => row.bonusLogicalDrop > 0,
        ).length;

      const one =
        informative.filter(
          row => row.bonusLogicalDrop === 1,
        ).length;

      const positiveRate =
        informative.length > 0
          ? positive / informative.length
          : null;

      const oneRate =
        informative.length > 0
          ? one / informative.length
          : null;

      const support =
        informative.length
          >= thresholds.minInformativeBonusTransitionsPerHero
        && positiveRate
          >= thresholds.minBonusLogicalPositiveRate
        && oneRate
          >= thresholds.minBonusLogicalOneUnitRate;

      return {
        heroId,
        total:
          heroRows.length,
        informative:
          informative.length,
        positive,
        one,
        positiveRate,
        oneRate,
        support,
      };
    })
    .sort(
      (a, b) =>
        b.informative - a.informative
        || b.total - a.total,
    );
}

function summarizeByReplay(rows) {
  const groups = new Map();

  for (const row of rows) {
    if (!groups.has(row.replayName)) {
      groups.set(row.replayName, []);
    }
    groups.get(row.replayName).push(row);
  }

  return [...groups.entries()]
    .map(([replayName, replayRows]) => {
      const baseline =
        partition(replayRows, row => row.wholeDrop);

      const combined =
        partition(replayRows, row => row.combinedDrop);

      return {
        replayName,
        total:
          replayRows.length,
        baseline,
        combined,
      };
    })
    .sort(
      (a, b) =>
        a.replayName.localeCompare(b.replayName),
    );
}

function partition(rows, valueFn) {
  let positive = 0;
  let zero = 0;
  let negative = 0;

  for (const row of rows) {
    const value = valueFn(row);

    if (!Number.isFinite(value)) continue;

    if (value > 0) positive++;
    else if (value < 0) negative++;
    else zero++;
  }

  const total =
    positive + zero + negative;

  return {
    total,
    positive,
    zero,
    negative,
    positiveRate:
      total > 0 ? positive / total : null,
    zeroRate:
      total > 0 ? zero / total : null,
    negativeRate:
      total > 0 ? negative / total : null,
  };
}

function residualGroup(rows, keyFn) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([key, groupRows]) => ({
      key,
      total:
        groupRows.length,
      zero:
        groupRows.filter(
          row => row.combinedLabel === 'ZERO',
        ).length,
      negative:
        groupRows.filter(
          row => row.combinedLabel === 'NEGATIVE',
        ).length,
    }))
    .sort(
      (a, b) =>
        b.total - a.total,
    );
}

function topPatterns(rows) {
  const counts = new Map();

  for (const row of rows) {
    const key =
      [
        `replay=${row.replayName}`,
        `hero=${row.heroId}`,
        `mainDrop=${row.wholeDrop}`,
        `bonusDrop=${row.bonusLogicalDrop}`,
        `combined=${row.combinedDrop}`,
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
