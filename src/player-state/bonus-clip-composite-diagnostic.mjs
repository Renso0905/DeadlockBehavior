// Script186 diagnostic helpers.
//
// Scientific question:
// Does m_iBonusClip form a second component of the runtime ammo counter such
// that one of the two natural composites below restores ordinary positive
// ammo consumption on carrier-absent attacks?
//
//   Z_PLUS_B  = ZigZag(m_iClip) + m_iBonusClip
//   Z_MINUS_B = ZigZag(m_iClip) - m_iBonusClip
//
// For transition drops, with bonusDelta = currentBonus - previousBonus:
//
//   drop(Z_PLUS_B)  = wholeDrop - bonusDelta
//   drop(Z_MINUS_B) = wholeDrop + bonusDelta
//
// This is diagnostic-only. The rep01-rep05 cohort has already been consumed
// by Script184 and is not fresh validation evidence for a new transform.

export const BONUS_COMPOSITE_DIAGNOSTIC_THRESHOLDS = Object.freeze({
  minBonusDeltaCoverageRate: 0.80,
  minResidualWithBonusChange: 100,
  minResidualResolutionRate: 0.80,
  maxPositiveControlHarmRate: 0.001,
  minOverallPositiveRateGain: 0.005,
});

export const COMPOSITE_FORMULAS = Object.freeze({
  BASELINE_Z: Object.freeze({
    name: 'BASELINE_Z',
    coefficient: 0,
  }),
  Z_PLUS_B: Object.freeze({
    name: 'Z_PLUS_B',
    coefficient: 1,
  }),
  Z_MINUS_B: Object.freeze({
    name: 'Z_MINUS_B',
    coefficient: -1,
  }),
});

export function adjustedDrop(
  wholeDrop,
  bonusDelta,
  formulaName,
) {
  if (!Number.isFinite(wholeDrop)) {
    return null;
  }

  if (formulaName === 'BASELINE_Z') {
    return wholeDrop;
  }

  if (!Number.isFinite(bonusDelta)) {
    return null;
  }

  if (formulaName === 'Z_PLUS_B') {
    return wholeDrop - bonusDelta;
  }

  if (formulaName === 'Z_MINUS_B') {
    return wholeDrop + bonusDelta;
  }

  throw new Error(
    `Unknown formula: ${formulaName}`,
  );
}

export function evaluateCompositeFormulas(
  rows,
  thresholds =
    BONUS_COMPOSITE_DIAGNOSTIC_THRESHOLDS,
) {
  const absent =
    rows.filter(
      row =>
        row.covered === true
        && row.carrierPresent === false,
    );

  const bonusCovered =
    absent.filter(
      row =>
        Number.isFinite(row.bonusClipDelta),
    );

  const bonusDeltaCoverageRate =
    absent.length > 0
      ? bonusCovered.length / absent.length
      : null;

  const baselineResidual =
    absent.filter(
      row =>
        row.label === 'ZERO'
        || row.label === 'NEGATIVE',
    );

  const baselinePositive =
    absent.filter(
      row => row.label === 'POSITIVE',
    );

  const residualWithBonusChange =
    baselineResidual.filter(
      row =>
        Number.isFinite(row.bonusClipDelta)
        && row.bonusClipDelta !== 0,
    );

  const results = {};

  for (
    const formulaName
    of ['BASELINE_Z', 'Z_PLUS_B', 'Z_MINUS_B']
  ) {
    const evaluable =
      formulaName === 'BASELINE_Z'
        ? absent
        : bonusCovered;

    const classified =
      classifyAdjusted(
        evaluable,
        formulaName,
      );

    const resolvedResidual =
      formulaName === 'BASELINE_Z'
        ? 0
        : residualWithBonusChange.filter(
          row =>
            adjustedDrop(
              row.wholeDrop,
              row.bonusClipDelta,
              formulaName,
            ) > 0,
        ).length;

    const harmedPositive =
      formulaName === 'BASELINE_Z'
        ? 0
        : baselinePositive.filter(
          row =>
            Number.isFinite(
              row.bonusClipDelta,
            )
            && adjustedDrop(
              row.wholeDrop,
              row.bonusClipDelta,
              formulaName,
            ) <= 0,
        ).length;

    const residualResolutionRate =
      residualWithBonusChange.length > 0
        ? resolvedResidual
          / residualWithBonusChange.length
        : null;

    const positiveControlHarmRate =
      baselinePositive.length > 0
        ? harmedPositive
          / baselinePositive.length
        : null;

    results[formulaName] = {
      ...classified,

      resolvedResidual,
      residualWithBonusChange:
        residualWithBonusChange.length,
      residualResolutionRate,

      harmedPositive,
      baselinePositive:
        baselinePositive.length,
      positiveControlHarmRate,
    };
  }

  const baselinePositiveRate =
    results.BASELINE_Z.positiveRate;

  for (
    const formulaName
    of ['Z_PLUS_B', 'Z_MINUS_B']
  ) {
    results[formulaName].positiveRateGain =
      (
        Number.isFinite(
          results[formulaName].positiveRate,
        )
        && Number.isFinite(
          baselinePositiveRate,
        )
      )
        ? results[formulaName].positiveRate
          - baselinePositiveRate
        : null;
  }

  const candidates =
    ['Z_PLUS_B', 'Z_MINUS_B']
      .map(
        formulaName => ({
          formulaName,
          ...results[formulaName],

          strongCandidate:
            bonusDeltaCoverageRate !== null
            && bonusDeltaCoverageRate
              >= thresholds.minBonusDeltaCoverageRate
            && residualWithBonusChange.length
              >= thresholds.minResidualWithBonusChange
            && results[
              formulaName
            ].residualResolutionRate !== null
            && results[
              formulaName
            ].residualResolutionRate
              >= thresholds.minResidualResolutionRate
            && results[
              formulaName
            ].positiveControlHarmRate !== null
            && results[
              formulaName
            ].positiveControlHarmRate
              <= thresholds.maxPositiveControlHarmRate
            && results[
              formulaName
            ].positiveRateGain !== null
            && results[
              formulaName
            ].positiveRateGain
              >= thresholds.minOverallPositiveRateGain,
        }),
      )
      .sort(
        (a, b) =>
          Number(b.strongCandidate)
          - Number(a.strongCandidate)
          || (b.residualResolutionRate ?? -1)
            - (a.residualResolutionRate ?? -1)
          || (a.positiveControlHarmRate ?? 1)
            - (b.positiveControlHarmRate ?? 1),
      );

  const strong =
    candidates.filter(
      row => row.strongCandidate,
    );

  const classification =
    strong.length === 1
      ? `BONUS_CLIP_${strong[0].formulaName}_STRONG_REPRESENTATION_CORRECTION_CANDIDATE`
      : strong.length > 1
        ? 'MULTIPLE_BONUS_CLIP_COMPOSITES_REMAIN_PLAUSIBLE'
        : 'BONUS_CLIP_COMPOSITE_COUNTER_REMAINS_UNRESOLVED';

  return {
    totalCarrierAbsent:
      absent.length,

    bonusDeltaCovered:
      bonusCovered.length,

    bonusDeltaCoverageRate,

    baselineResidual:
      baselineResidual.length,

    baselinePositive:
      baselinePositive.length,

    residualWithBonusChange:
      residualWithBonusChange.length,

    results,
    candidates,
    classification,

    byHero:
      summarizeByGroup(
        absent,
        row => String(row.heroId),
      ),

    topJointPatterns:
      jointPatternSummary(
        absent,
      ),
  };
}

export function summarizeByGroup(
  rows,
  keyFn,
) {
  const groups =
    new Map();

  for (const row of rows) {
    const key =
      keyFn(row);

    if (!groups.has(key)) {
      groups.set(
        key,
        [],
      );
    }

    groups.get(key).push(
      row,
    );
  }

  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const result =
        evaluateGroup(
          groupRows,
        );

      return {
        key,
        ...result,
      };
    })
    .sort(
      (a, b) =>
        b.baselineResidual
        - a.baselineResidual
        || b.total - a.total,
    );
}

function evaluateGroup(rows) {
  const residual =
    rows.filter(
      row =>
        row.label === 'ZERO'
        || row.label === 'NEGATIVE',
    );

  const withBonus =
    residual.filter(
      row =>
        Number.isFinite(row.bonusClipDelta)
        && row.bonusClipDelta !== 0,
    );

  const plusResolved =
    withBonus.filter(
      row =>
        adjustedDrop(
          row.wholeDrop,
          row.bonusClipDelta,
          'Z_PLUS_B',
        ) > 0,
    ).length;

  const minusResolved =
    withBonus.filter(
      row =>
        adjustedDrop(
          row.wholeDrop,
          row.bonusClipDelta,
          'Z_MINUS_B',
        ) > 0,
    ).length;

  return {
    total:
      rows.length,

    baselineResidual:
      residual.length,

    residualWithBonusChange:
      withBonus.length,

    plusResolved,
    minusResolved,

    plusResolutionRate:
      withBonus.length > 0
        ? plusResolved / withBonus.length
        : null,

    minusResolutionRate:
      withBonus.length > 0
        ? minusResolved / withBonus.length
        : null,
  };
}

function classifyAdjusted(
  rows,
  formulaName,
) {
  let positive = 0;
  let zero = 0;
  let negative = 0;
  let nonInteger = 0;

  for (const row of rows) {
    const drop =
      adjustedDrop(
        row.wholeDrop,
        row.bonusClipDelta,
        formulaName,
      );

    if (!Number.isFinite(drop)) {
      continue;
    }

    if (!Number.isInteger(drop)) {
      nonInteger++;
    }

    if (drop > 0) {
      positive++;
    } else if (drop < 0) {
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
    nonInteger,

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

function jointPatternSummary(rows) {
  const counts =
    new Map();

  for (const row of rows) {
    if (
      row.label !== 'ZERO'
      && row.label !== 'NEGATIVE'
    ) {
      continue;
    }

    const key =
      [
        `hero=${row.heroId}`,
        `wholeDrop=${row.wholeDrop}`,
        `bonusDelta=${Number.isFinite(row.bonusClipDelta) ? row.bonusClipDelta : 'null'}`,
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
