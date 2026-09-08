// Script198 V03
//
// Successor to V02.
//
// V02 integrity failure root cause:
// Array.map(characterizeZeroResidualV02) and
// Array.map(characterizeNegativeResidualV02) passed each row's array index as
// the callback's second positional argument, silently overriding the intended
// default tolerance.
//
// V03 freezes tolerance inside summary callbacks:
//
//   rows.map(row => characterizeZeroResidualV03(row))
//
// Scientific question is unchanged.

export const FRACTION_TOLERANCE_V03 = 1e-4;

export function inferIntegerCapacityV03(
  logicalMain,
  ammoFraction,
  tolerance = FRACTION_TOLERANCE_V03,
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
    (logicalMain - 1) / ammoFraction;

  const rounded =
    Math.round(raw);

  if (
    rounded <= 0
    || Math.abs(raw - rounded) > tolerance
  ) {
    return null;
  }

  return rounded;
}

export function fractionStepUnitsV03(
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
    previousFraction - currentFraction
  ) * capacity;
}

export function characterizeZeroResidualV03(
  row,
  tolerance = FRACTION_TOLERANCE_V03,
) {
  const previous =
    row?.previous ?? {};

  const current =
    row?.current ?? {};

  const capacity =
    inferIntegerCapacityV03(
      Number(previous.logicalMain),
      Number(previous.ammoFraction),
      tolerance,
    );

  const stepUnits =
    fractionStepUnitsV03(
      Number(previous.ammoFraction),
      Number(current.ammoFraction),
      capacity,
    );

  const wholeStayedFlat =
    Number(previous.logicalMain)
      === Number(current.logicalMain)
    && Number(previous.logicalBonus)
      === Number(current.logicalBonus);

  const oneUnitStep =
    Number.isFinite(stepUnits)
    && Math.abs(stepUnits - 1) <= tolerance;

  const rollback =
    findRollbackV03(
      row,
      tolerance,
    );

  let signature =
    'ZERO_RESIDUAL_OTHER';

  if (
    wholeStayedFlat
    && oneUnitStep
  ) {
    signature =
      rollback.observed
        ? 'ONE_UNIT_FRACTION_PREDICTION_WITH_IMMEDIATE_ROLLBACK'
        : 'ONE_UNIT_FRACTION_PREDICTION_WITHOUT_OBSERVED_ROLLBACK';
  }

  return {
    heroId:
      row.heroId,
    tick:
      row.tick,
    capacity,
    stepUnits,
    wholeStayedFlat,
    oneUnitStep,
    rollback:
      rollback.observed,
    rollbackTickDelay:
      rollback.tickDelay,
    signature,

    selfConsistency: {
      tolerance:
        tolerance,

      oneUnitBooleanMatchesNumericStep:
        oneUnitStep === (
          Number.isFinite(stepUnits)
          && Math.abs(stepUnits - 1) <= tolerance
        ),

      signatureMatchesBoolean:
        signature.startsWith(
          'ONE_UNIT_FRACTION_PREDICTION_',
        )
          ? wholeStayedFlat
            && oneUnitStep
          : !(
            wholeStayedFlat
            && oneUnitStep
          ),
    },
  };
}

export function characterizeNegativeResidualV03(
  row,
  tolerance = FRACTION_TOLERANCE_V03,
) {
  const previous =
    row?.previous ?? {};

  const current =
    row?.current ?? {};

  const previousCapacity =
    inferIntegerCapacityV03(
      Number(previous.logicalMain),
      Number(previous.ammoFraction),
      tolerance,
    );

  const currentCapacity =
    inferIntegerCapacityV03(
      Number(current.logicalMain),
      Number(current.ammoFraction),
      tolerance,
    );

  const stableCapacity =
    Number.isFinite(previousCapacity)
    && previousCapacity === currentCapacity;

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

  const coherentGain =
    stableCapacity
    && logicalGain > 0
    && Number.isFinite(fractionGainUnits)
    && Math.abs(
      logicalGain - fractionGainUnits,
    ) <= tolerance;

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
    coherentGain,
    grossRestorationIfOneShotConsumed:
      coherentGain
        ? logicalGain + 1
        : null,

    selfConsistency: {
      tolerance:
        tolerance,
    },
  };
}

export function summarizeFractionCoherenceV03(
  exactRows,
) {
  // IMPORTANT: explicit unary wrappers prevent Array.map's index argument
  // from being interpreted as the tolerance parameter.
  const zeroRows =
    exactRows
      .filter(
        row =>
          row.residualClass
          === 'ZERO_CONSUMPTION',
      )
      .map(
        row =>
          characterizeZeroResidualV03(
            row,
          ),
      );

  const negativeRows =
    exactRows
      .filter(
        row =>
          row.residualClass
          === 'ATTACK_COUPLED_AMMO_GAIN',
      )
      .map(
        row =>
          characterizeNegativeResidualV03(
            row,
          ),
      );

  const toleranceLeaks =
    [
      ...zeroRows.map(
        row =>
          row.selfConsistency?.tolerance,
      ),
      ...negativeRows.map(
        row =>
          row.selfConsistency?.tolerance,
      ),
    ]
      .filter(
        value =>
          value !== FRACTION_TOLERANCE_V03,
      );

  const inconsistentZeroRows =
    zeroRows.filter(
      row =>
        !row.selfConsistency
          .oneUnitBooleanMatchesNumericStep
        || !row.selfConsistency
          .signatureMatchesBoolean,
    );

  const oneUnit =
    zeroRows.filter(
      row =>
        row.oneUnitStep === true
        && row.wholeStayedFlat === true,
    );

  const rollback =
    zeroRows.filter(
      row =>
        row.signature
        === 'ONE_UNIT_FRACTION_PREDICTION_WITH_IMMEDIATE_ROLLBACK',
    );

  const coherent =
    negativeRows.filter(
      row =>
        row.coherentGain === true,
    );

  return {
    zero: {
      total:
        zeroRows.length,
      oneUnit:
        oneUnit.length,
      oneUnitRate:
        zeroRows.length
          ? oneUnit.length / zeroRows.length
          : null,
      rollback:
        rollback.length,
      rollbackRate:
        zeroRows.length
          ? rollback.length / zeroRows.length
          : null,
      inconsistent:
        inconsistentZeroRows.length,
      rows:
        zeroRows,
    },

    negative: {
      total:
        negativeRows.length,
      coherent:
        coherent.length,
      coherentRate:
        negativeRows.length
          ? coherent.length / negativeRows.length
          : null,
      grossRestorationCandidates:
        groupCount(
          coherent,
          row =>
            String(
              row.grossRestorationIfOneShotConsumed,
            ),
        ),
      rows:
        negativeRows,
    },

    callbackIntegrity: {
      expectedTolerance:
        FRACTION_TOLERANCE_V03,
      toleranceLeakCount:
        toleranceLeaks.length,
      observedTolerances:
        [
          ...new Set([
            ...zeroRows.map(
              row =>
                row.selfConsistency
                  ?.tolerance,
            ),
            ...negativeRows.map(
              row =>
                row.selfConsistency
                  ?.tolerance,
            ),
          ]),
        ],
    },

    classification:
      toleranceLeaks.length === 0
      && inconsistentZeroRows.length === 0
      && oneUnit.length >= 10
      && coherent.length >= 7
        ? 'FRACTION_ROLLBACK_AND_COHERENT_RESTORATION_PARTITION_SELF_CONSISTENT_V03'
        : 'FRACTION_COHERENCE_V03_REQUIRES_DIAGNOSIS',
  };
}

function findRollbackV03(
  row,
  tolerance,
) {
  const currentTick =
    Number(row?.tick);

  const currentShot =
    Number(row?.current?.shotNumber);

  const currentMain =
    Number(row?.current?.logicalMain);

  const previousFraction =
    Number(row?.previous?.ammoFraction);

  for (
    const state
    of Array.isArray(row?.neighborhood)
      ? row.neighborhood
      : []
  ) {
    if (
      !Number.isFinite(state?.tick)
      || state.tick <= currentTick
      || state.tick - currentTick > 2
    ) {
      continue;
    }

    if (
      Number(state.shotNumber) !== currentShot
      || Number(state.logicalMain) !== currentMain
    ) {
      continue;
    }

    if (
      Number.isFinite(state.ammoFraction)
      && Math.abs(
        Number(state.ammoFraction)
        - previousFraction,
      ) <= tolerance
    ) {
      return {
        observed: true,
        tickDelay:
          state.tick - currentTick,
      };
    }
  }

  return {
    observed: false,
    tickDelay: null,
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
