// Script198 V02
//
// Successor to V01 because the pasted V01 output contained an impossible
// internal mismatch:
//   previousStep=0.000000
//   signature=ONE_UNIT_FRACTION_PREDICTION_WITHOUT_OBSERVED_ROLLBACK
//
// V02 keeps the same scientific question but adds explicit self-consistency
// guards and a slightly more tolerant integer-capacity reconstruction to
// accommodate float32 serialization noise.

export const FRACTION_TOLERANCE_V02 = 1e-4;

export function inferIntegerCapacityV02(
  logicalMain,
  ammoFraction,
  tolerance = FRACTION_TOLERANCE_V02,
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

export function fractionStepUnitsV02(
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

export function characterizeZeroResidualV02(
  row,
  tolerance = FRACTION_TOLERANCE_V02,
) {
  const previous =
    row?.previous ?? {};

  const current =
    row?.current ?? {};

  const capacity =
    inferIntegerCapacityV02(
      Number(previous.logicalMain),
      Number(previous.ammoFraction),
      tolerance,
    );

  const stepUnits =
    fractionStepUnitsV02(
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
    findRollbackV02(
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

  const selfConsistency = {
    oneUnitBooleanMatchesNumericStep:
      oneUnitStep
      === (
        Number.isFinite(stepUnits)
        && Math.abs(stepUnits - 1)
          <= tolerance
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
  };

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
    selfConsistency,
  };
}

export function characterizeNegativeResidualV02(
  row,
  tolerance = FRACTION_TOLERANCE_V02,
) {
  const previous =
    row?.previous ?? {};

  const current =
    row?.current ?? {};

  const previousCapacity =
    inferIntegerCapacityV02(
      Number(previous.logicalMain),
      Number(previous.ammoFraction),
      tolerance,
    );

  const currentCapacity =
    inferIntegerCapacityV02(
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
  };
}

export function summarizeFractionCoherenceV02(
  exactRows,
) {
  const zeroRows =
    exactRows
      .filter(
        row =>
          row.residualClass
          === 'ZERO_CONSUMPTION',
      )
      .map(
        characterizeZeroResidualV02,
      );

  const negativeRows =
    exactRows
      .filter(
        row =>
          row.residualClass
          === 'ATTACK_COUPLED_AMMO_GAIN',
      )
      .map(
        characterizeNegativeResidualV02,
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
      row => row.coherentGain === true,
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
      rows:
        negativeRows,
    },

    classification:
      inconsistentZeroRows.length === 0
      && oneUnit.length >= 10
      && coherent.length >= 7
        ? 'FRACTION_ROLLBACK_AND_COHERENT_RESTORATION_PARTITION_SELF_CONSISTENT_V02'
        : 'FRACTION_COHERENCE_V02_REQUIRES_DIAGNOSIS',
  };
}

function findRollbackV02(
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
