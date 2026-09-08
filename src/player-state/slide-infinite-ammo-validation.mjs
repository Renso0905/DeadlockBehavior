// Script183 helpers.
//
// Script182 V02 discovered a universal runtime state strongly associated with
// attacks that do not consume the ZigZag-transformed whole clip counter.
//
// Primary frozen empirical carrier:
//   m_pModifierProp.m_bvEnabledPredictedStateMask.0002 bit 5 (mask 32)
//
// Companion correlated states are retained as redundancy diagnostics:
//   .0002 bit 1 (mask 2)
//   .0007 bit 1 (mask 2)
//
// Script183 validates the narrow consequence semantics:
//
//   carrier ON  -> primary attack usually consumes zero whole-clip units
//   carrier OFF -> primary attack normally consumes positive whole-clip units
//
// Because Deadlock sliding universally grants infinite ammo, this is a
// candidate for the slide-infinite-ammo runtime state. This script does NOT
// promote the bit as the canonical locomotion "sliding" state for unrelated
// movement analyses.

export const PRIMARY_SLIDE_AMMO_CARRIER = Object.freeze({
  field:
    'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
  bit: 5,
  mask: 32,
});

export const COMPANION_CARRIERS = Object.freeze([
  Object.freeze({
    name: 'mask0002_bit1',
    field:
      'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
    bit: 1,
    mask: 2,
  }),
  Object.freeze({
    name: 'mask0007_bit1',
    field:
      'm_pModifierProp.m_bvEnabledPredictedStateMask.0007',
    bit: 1,
    mask: 2,
  }),
]);

export const SLIDE_AMMO_VALIDATION_THRESHOLDS = Object.freeze({
  minFieldCoverageRate: 0.95,

  minNonVyperCarrierPresent: 100,
  minNonVyperZeroRateGivenCarrier: 0.98,
  maxNonVyperZeroRateWithoutCarrier: 0.01,
  minNonVyperZeroRecall: 0.90,
  minSupportingNonVyperHeroes: 6,

  minVyperCarrierPresent: 100,
  minVyperZeroRateGivenCarrier: 0.95,

  minResidualTransitions: 5000,
  minResidualPositiveWholeDropRate: 0.99,
  maxResidualNegativeWholeDropRate: 0.001,

  minCompanionJaccardDiagnostic: 0.95,
});

export function bitIsSet(value, bit) {
  if (
    !Number.isFinite(value)
    || !Number.isInteger(value)
    || value < 0
    || !Number.isInteger(bit)
    || bit < 0
    || bit > 30
  ) {
    return false;
  }

  const mask = 2 ** bit;
  return (value & mask) !== 0;
}

export function evaluateCarrierState(
  state,
  carrier = PRIMARY_SLIDE_AMMO_CARRIER,
) {
  const value =
    Number(state?.[carrier.field]);

  if (!Number.isFinite(value)) {
    return {
      covered: false,
      present: false,
      value: null,
    };
  }

  return {
    covered: true,
    present:
      bitIsSet(
        value,
        carrier.bit,
      ),
    value,
  };
}

export function evaluateAttackRows(
  rows,
  {
    primaryCarrier =
      PRIMARY_SLIDE_AMMO_CARRIER,
    companions =
      COMPANION_CARRIERS,
    thresholds =
      SLIDE_AMMO_VALIDATION_THRESHOLDS,
  } = {},
) {
  const evaluated =
    rows.map(row => {
      const primary =
        evaluateCarrierState(
          row.state,
          primaryCarrier,
        );

      const companionStates =
        Object.fromEntries(
          companions.map(
            companion => [
              companion.name,
              evaluateCarrierState(
                row.state,
                companion,
              ),
            ],
          ),
        );

      return {
        ...row,
        primary,
        companionStates,
      };
    });

  const covered =
    evaluated.filter(
      row => row.primary.covered,
    );

  const coverageRate =
    evaluated.length > 0
      ? covered.length / evaluated.length
      : null;

  const pooled =
    carrierMetrics(covered);

  const nonVyper =
    carrierMetrics(
      covered.filter(
        row => row.heroId !== 58,
      ),
    );

  const vyper =
    carrierMetrics(
      covered.filter(
        row => row.heroId === 58,
      ),
    );

  const byHero =
    summarizeByHero(
      covered,
      thresholds,
    );

  const residual =
    residualCounterMetrics(
      covered,
    );

  const companionsResult =
    summarizeCompanions(
      covered,
      companions,
    );

  const semanticPass =
    coverageRate !== null
    && coverageRate
      >= thresholds.minFieldCoverageRate

    && nonVyper.present.total
      >= thresholds.minNonVyperCarrierPresent

    && nonVyper.present.zeroRate
      >= thresholds.minNonVyperZeroRateGivenCarrier

    && nonVyper.absent.zeroRate
      <= thresholds.maxNonVyperZeroRateWithoutCarrier

    && nonVyper.zeroRecall
      >= thresholds.minNonVyperZeroRecall

    && byHero.supportingNonVyperHeroes.length
      >= thresholds.minSupportingNonVyperHeroes

    && vyper.present.total
      >= thresholds.minVyperCarrierPresent

    && vyper.present.zeroRate
      >= thresholds.minVyperZeroRateGivenCarrier

    && residual.total
      >= thresholds.minResidualTransitions

    && residual.positiveRate
      >= thresholds.minResidualPositiveWholeDropRate

    && residual.negativeRate
      <= thresholds.maxResidualNegativeWholeDropRate;

  return {
    coverage: {
      total: evaluated.length,
      covered: covered.length,
      coverageRate,
    },

    pooled,
    nonVyper,
    vyper,
    byHero,
    residual,
    companions:
      companionsResult,

    semanticPass,

    classification:
      semanticPass
        ? 'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_STRONGLY_SUPPORTED_SINGLE_REPLAY'
        : 'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_REQUIRES_DIAGNOSIS',
  };
}

export function carrierMetrics(rows) {
  const present =
    rows.filter(
      row => row.primary.present,
    );

  const absent =
    rows.filter(
      row => !row.primary.present,
    );

  const zeroTotal =
    rows.filter(
      row => row.label === 'ZERO',
    ).length;

  const zeroPresent =
    present.filter(
      row => row.label === 'ZERO',
    ).length;

  return {
    total:
      rows.length,

    present:
      partition(present),

    absent:
      partition(absent),

    zeroRecall:
      zeroTotal > 0
        ? zeroPresent / zeroTotal
        : null,

    carrierPrevalence:
      rows.length > 0
        ? present.length / rows.length
        : null,
  };
}

export function residualCounterMetrics(rows) {
  const residual =
    rows.filter(
      row => !row.primary.present,
    );

  const counts =
    partition(residual);

  return {
    ...counts,

    positiveRate:
      counts.total > 0
        ? counts.POSITIVE / counts.total
        : null,

    zeroRate:
      counts.total > 0
        ? counts.ZERO / counts.total
        : null,

    negativeRate:
      counts.total > 0
        ? counts.NEGATIVE / counts.total
        : null,
  };
}

export function summarizeByHero(
  rows,
  thresholds =
    SLIDE_AMMO_VALIDATION_THRESHOLDS,
) {
  const groups =
    new Map();

  for (const row of rows) {
    if (!groups.has(row.heroId)) {
      groups.set(
        row.heroId,
        [],
      );
    }

    groups.get(row.heroId).push(
      row,
    );
  }

  const heroes =
    [...groups.entries()]
      .map(([heroId, heroRows]) => {
        const metrics =
          carrierMetrics(heroRows);

        const support =
          heroId !== 58
          && metrics.present.total >= 8
          && metrics.present.zeroRate !== null
          && metrics.present.zeroRate >= 0.90
          && metrics.absent.zeroRate !== null
          && metrics.absent.zeroRate <= 0.10;

        return {
          heroId,
          ...metrics,
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

    supportingNonVyperHeroes:
      heroes
        .filter(
          row => row.support,
        )
        .map(
          row => row.heroId,
        ),

    supportingNonVyperHeroCount:
      heroes.filter(
        row => row.support,
      ).length,

    vyperExposure:
      heroes.find(
        row => row.heroId === 58,
      )?.carrierPrevalence
      ?? null,

    maxNonVyperExposure:
      maxFinite(
        heroes
          .filter(
            row => row.heroId !== 58,
          )
          .map(
            row => row.carrierPrevalence,
          ),
      ),
  };
}

export function summarizeCompanions(
  rows,
  companions =
    COMPANION_CARRIERS,
) {
  return companions.map(
    companion => {
      const comparable =
        rows.filter(
          row =>
            row.primary.covered
            && row.companionStates
              ?.[companion.name]
              ?.covered,
        );

      let primaryPresent = 0;
      let companionPresent = 0;
      let intersection = 0;
      let union = 0;
      let disagreement = 0;

      for (const row of comparable) {
        const a =
          row.primary.present;

        const b =
          row.companionStates[
            companion.name
          ].present;

        if (a) primaryPresent++;
        if (b) companionPresent++;
        if (a && b) intersection++;
        if (a || b) union++;
        if (a !== b) disagreement++;
      }

      return {
        name:
          companion.name,
        field:
          companion.field,
        bit:
          companion.bit,

        comparable:
          comparable.length,

        primaryPresent,
        companionPresent,
        intersection,
        union,

        jaccard:
          union > 0
            ? intersection / union
            : null,

        disagreement,
        disagreementRate:
          comparable.length > 0
            ? disagreement
              / comparable.length
            : null,
      };
    },
  );
}

function partition(rows) {
  const result = {
    POSITIVE: 0,
    ZERO: 0,
    NEGATIVE: 0,
    total: rows.length,
    zeroRate: null,
  };

  for (const row of rows) {
    if (
      row.label === 'POSITIVE'
      || row.label === 'ZERO'
      || row.label === 'NEGATIVE'
    ) {
      result[row.label]++;
    }
  }

  const semantic =
    result.POSITIVE
    + result.ZERO;

  result.zeroRate =
    semantic > 0
      ? result.ZERO / semantic
      : null;

  return result;
}

function maxFinite(values) {
  const finite =
    values.filter(
      Number.isFinite,
    );

  return finite.length
    ? Math.max(...finite)
    : null;
}
