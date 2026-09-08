// Script198 helpers.
//
// Descriptive diagnostic over Script197's exact 20-row residual audit.
// It asks whether:
//
// ZERO residuals:
//   m_flAmmoFrac takes exactly one normalized-ammo step downward while the
//   authoritative ZigZag whole counter stays unchanged, then rolls back.
//
// NEGATIVE residuals:
//   m_flAmmoFrac and the whole counter move coherently upward together.
//
// This is representation/provenance characterization only.

export const FRACTION_TOLERANCE = 1e-5;

export function inferIntegerCapacity(
  logicalMain,
  ammoFraction,
  tolerance = FRACTION_TOLERANCE,
) {
  if (
    !Number.isFinite(logicalMain)
    || !Number.isFinite(ammoFraction)
    || ammoFraction <= 0
    || logicalMain <= 1
  ) {
    return null;
  }

  const raw =
    (logicalMain - 1)
    / ammoFraction;

  const rounded =
    Math.round(raw);

  if (
    rounded <= 0
    || Math.abs(raw - rounded)
      > tolerance
  ) {
    return null;
  }

  return rounded;
}

export function fractionStep(
  previousFraction,
  currentFraction,
  capacity,
) {
  if (
    !Number.isFinite(previousFraction)
    || !Number.isFinite(currentFraction)
    || !Number.isFinite(capacity)
    || capacity <= 0
  ) {
    return null;
  }

  return (
    previousFraction
    - currentFraction
  ) * capacity;
}

export function findImmediateFractionRollback(
  row,
  {
    maxTickDelay = 2,
    tolerance = FRACTION_TOLERANCE,
  } = {},
) {
  const neighborhood =
    Array.isArray(row?.neighborhood)
      ? row.neighborhood
      : [];

  const currentTick =
    Number(row?.tick);

  const currentShot =
    Number(row?.current?.shotNumber);

  const currentMain =
    Number(row?.current?.logicalMain);

  const previousFraction =
    Number(row?.previous?.ammoFraction);

  if (
    !Number.isFinite(currentTick)
    || !Number.isFinite(currentShot)
    || !Number.isFinite(currentMain)
    || !Number.isFinite(previousFraction)
  ) {
    return {
      observed: false,
      tickDelay: null,
      state: null,
    };
  }

  for (const state of neighborhood) {
    if (
      !Number.isFinite(state?.tick)
      || state.tick <= currentTick
      || state.tick - currentTick
        > maxTickDelay
    ) {
      continue;
    }

    if (
      Number(state.shotNumber)
        !== currentShot
      || Number(state.logicalMain)
        !== currentMain
    ) {
      continue;
    }

    if (
      Number.isFinite(
        state.ammoFraction,
      )
      && Math.abs(
        state.ammoFraction
        - previousFraction,
      ) <= tolerance
    ) {
      return {
        observed: true,
        tickDelay:
          state.tick - currentTick,
        state,
      };
    }
  }

  return {
    observed: false,
    tickDelay: null,
    state: null,
  };
}

export function characterizeZeroResidual(
  row,
  tolerance = FRACTION_TOLERANCE,
) {
  const previous =
    row?.previous ?? {};

  const current =
    row?.current ?? {};

  const previousCapacity =
    inferIntegerCapacity(
      previous.logicalMain,
      previous.ammoFraction,
      tolerance,
    );

  const previousStep =
    fractionStep(
      previous.ammoFraction,
      current.ammoFraction,
      previousCapacity,
    );

  const oneUnitPredictedStep =
    Number.isFinite(previousStep)
    && Math.abs(previousStep - 1)
      <= tolerance;

  const wholeStayedFlat =
    Number(previous.logicalMain)
      === Number(current.logicalMain)
    && Number(previous.logicalBonus)
      === Number(current.logicalBonus);

  const rollback =
    findImmediateFractionRollback(
      row,
      {
        tolerance,
      },
    );

  return {
    heroId:
      row.heroId,
    tick:
      row.tick,

    previousCapacity,

    previousStep,

    wholeStayedFlat,

    oneUnitPredictedStep,

    immediateRollback:
      rollback.observed,

    rollbackTickDelay:
      rollback.tickDelay,

    signature:
      wholeStayedFlat
      && oneUnitPredictedStep
        ? rollback.observed
          ? 'ONE_UNIT_FRACTION_PREDICTION_WITH_IMMEDIATE_ROLLBACK'
          : 'ONE_UNIT_FRACTION_PREDICTION_WITHOUT_OBSERVED_ROLLBACK'
        : 'ZERO_RESIDUAL_OTHER',
  };
}

export function characterizeNegativeResidual(
  row,
  tolerance = FRACTION_TOLERANCE,
) {
  const previous =
    row?.previous ?? {};

  const current =
    row?.current ?? {};

  const previousCapacity =
    inferIntegerCapacity(
      previous.logicalMain,
      previous.ammoFraction,
      tolerance,
    );

  const currentCapacity =
    inferIntegerCapacity(
      current.logicalMain,
      current.ammoFraction,
      tolerance,
    );

  const stableCapacity =
    Number.isFinite(previousCapacity)
    && previousCapacity
      === currentCapacity;

  const logicalGain =
    Number(current.logicalMain)
    - Number(previous.logicalMain);

  const fractionGainUnits =
    stableCapacity
      ? (
        Number(current.ammoFraction)
        - Number(previous.ammoFraction)
      ) * previousCapacity
      : null;

  const coherentNetGain =
    stableCapacity
    && Number.isFinite(logicalGain)
    && Number.isFinite(fractionGainUnits)
    && logicalGain > 0
    && Math.abs(
      logicalGain - fractionGainUnits,
    ) <= tolerance;

  // Purely a candidate decomposition:
  // if an ordinary attack would consume one unit on the same transition,
  // gross restoration would be net gain + 1.
  const grossRestorationIfOneShotConsumed =
    coherentNetGain
      ? logicalGain + 1
      : null;

  return {
    heroId:
      row.heroId,
    tick:
      row.tick,

    previousCapacity,
    currentCapacity,
    stableCapacity,

    logicalGain,
    fractionGainUnits,

    coherentNetGain,

    grossRestorationIfOneShotConsumed,

    signature:
      coherentNetGain
        ? 'WHOLE_AND_FRACTION_COHERENT_AMMO_GAIN'
        : 'NEGATIVE_RESIDUAL_OTHER',
  };
}

export function summarizeFractionCoherence(
  exactRows,
) {
  const zeros =
    exactRows.filter(
      row =>
        row.residualClass
        === 'ZERO_CONSUMPTION',
    );

  const negatives =
    exactRows.filter(
      row =>
        row.residualClass
        === 'ATTACK_COUPLED_AMMO_GAIN',
    );

  const zeroRows =
    zeros.map(
      characterizeZeroResidual,
    );

  const negativeRows =
    negatives.map(
      characterizeNegativeResidual,
    );

  const zeroOneUnit =
    zeroRows.filter(
      row =>
        row.oneUnitPredictedStep
        === true
        && row.wholeStayedFlat
        === true,
    );

  const zeroRollback =
    zeroRows.filter(
      row =>
        row.signature
        === 'ONE_UNIT_FRACTION_PREDICTION_WITH_IMMEDIATE_ROLLBACK',
    );

  const coherentNegative =
    negativeRows.filter(
      row =>
        row.coherentNetGain
        === true,
    );

  return {
    zero: {
      total:
        zeroRows.length,

      oneUnitFractionPrediction:
        zeroOneUnit.length,

      oneUnitFractionPredictionRate:
        zeroRows.length > 0
          ? zeroOneUnit.length
            / zeroRows.length
          : null,

      immediateRollback:
        zeroRollback.length,

      immediateRollbackRate:
        zeroRows.length > 0
          ? zeroRollback.length
            / zeroRows.length
          : null,

      rows:
        zeroRows,
    },

    negative: {
      total:
        negativeRows.length,

      coherentWholeAndFractionGain:
        coherentNegative.length,

      coherentWholeAndFractionGainRate:
        negativeRows.length > 0
          ? coherentNegative.length
            / negativeRows.length
          : null,

      grossRestorationCandidates:
        groupCount(
          coherentNegative,
          row =>
            String(
              row
                .grossRestorationIfOneShotConsumed,
            ),
        ),

      rows:
        negativeRows,
    },

    classification:
      (
        zeroRows.length === 12
        && zeroOneUnit.length >= 10
        && negativeRows.length === 8
        && coherentNegative.length >= 7
      )
        ? 'RESIDUALS_SPLIT_INTO_FRACTION_PREDICTION_ROLLBACK_AND_COHERENT_AMMO_RESTORATION'
        : 'RESIDUAL_FRACTION_SEMANTICS_REMAIN_MIXED',
  };
}

function groupCount(rows, keyFn) {
  const counts =
    new Map();

  for (const row of rows) {
    const key =
      keyFn(row);

    counts.set(
      key,
      (counts.get(key) ?? 0) + 1,
    );
  }

  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count
        || a.key.localeCompare(b.key),
    );
}
