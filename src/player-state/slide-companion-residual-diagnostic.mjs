// Script191 helpers.
//
// Diagnostic-only application of the two Script183 companion bits to the
// strict-chronology residuals from Script190.
//
// Primary carrier remains:
//   .0002 bit5
//
// Frozen companions from Script183:
//   .0002 bit1
//   .0007 bit1
//
// This does NOT retune the carrier or promote a union rule.

export const PRIMARY = Object.freeze({
  field: 'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
  bit: 5,
  mask: 32,
});

export const COMPANIONS = Object.freeze([
  Object.freeze({
    id: 'mask0002_bit1',
    field: 'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
    bit: 1,
    mask: 2,
  }),
  Object.freeze({
    id: 'mask0007_bit1',
    field: 'm_pModifierProp.m_bvEnabledPredictedStateMask.0007',
    bit: 1,
    mask: 2,
  }),
]);

export function hasBit(value, bit) {
  if (!Number.isFinite(value)) return null;
  const mask = 1 << bit;
  return (Number(value) & mask) !== 0;
}

export function evaluateBitState(state, carrier) {
  const value =
    state?.[carrier.field];

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
      hasBit(
        Number(value),
        carrier.bit,
      ) === true,
    value: Number(value),
  };
}

export function summarizeCompanionResiduals(rows) {
  const primaryAbsent =
    rows.filter(
      row =>
        row.primaryCovered === true
        && row.primaryPresent === false,
    );

  const positive =
    primaryAbsent.filter(
      row => row.combinedLabel === 'POSITIVE',
    );

  const zero =
    primaryAbsent.filter(
      row => row.combinedLabel === 'ZERO',
    );

  const negative =
    primaryAbsent.filter(
      row => row.combinedLabel === 'NEGATIVE',
    );

  const companions = {};

  for (const companion of COMPANIONS) {
    companions[companion.id] =
      summarizeOne(
        primaryAbsent,
        positive,
        zero,
        negative,
        companion.id,
      );
  }

  const unionRows =
    primaryAbsent.filter(
      row =>
        COMPANIONS.some(
          c =>
            row.companions?.[c.id]
              ?.covered === true
            && row.companions?.[c.id]
              ?.present === true,
        ),
    );

  const unionZero =
    zero.filter(
      row =>
        COMPANIONS.some(
          c =>
            row.companions?.[c.id]
              ?.covered === true
            && row.companions?.[c.id]
              ?.present === true,
        ),
    );

  const unionNegative =
    negative.filter(
      row =>
        COMPANIONS.some(
          c =>
            row.companions?.[c.id]
              ?.covered === true
            && row.companions?.[c.id]
              ?.present === true,
        ),
    );

  const unionPositive =
    positive.filter(
      row =>
        COMPANIONS.some(
          c =>
            row.companions?.[c.id]
              ?.covered === true
            && row.companions?.[c.id]
              ?.present === true,
        ),
    );

  return {
    primaryAbsent:
      primaryAbsent.length,

    baseline: {
      positive:
        positive.length,
      zero:
        zero.length,
      negative:
        negative.length,
    },

    companions,

    union: {
      present:
        unionRows.length,

      zeroCaptured:
        unionZero.length,

      zeroCaptureRate:
        zero.length > 0
          ? unionZero.length / zero.length
          : null,

      negativeCaptured:
        unionNegative.length,

      negativeCaptureRate:
        negative.length > 0
          ? unionNegative.length / negative.length
          : null,

      positivePresent:
        unionPositive.length,

      positivePresentRate:
        positive.length > 0
          ? unionPositive.length / positive.length
          : null,

      pZeroGivenUnionPresent:
        unionRows.length > 0
          ? unionZero.length / unionRows.length
          : null,
    },

    byHero:
      summarizeByHero(
        primaryAbsent,
      ),

    topCompanionOnlyPatterns:
      topPatterns(
        primaryAbsent.filter(
          row =>
            COMPANIONS.some(
              c =>
                row.companions?.[c.id]
                  ?.present === true,
            ),
        ),
      ),
  };
}

function summarizeOne(
  all,
  positive,
  zero,
  negative,
  companionId,
) {
  const covered =
    all.filter(
      row =>
        row.companions?.[companionId]
          ?.covered === true,
    );

  const present =
    covered.filter(
      row =>
        row.companions?.[companionId]
          ?.present === true,
    );

  const zeroPresent =
    zero.filter(
      row =>
        row.companions?.[companionId]
          ?.present === true,
    );

  const negativePresent =
    negative.filter(
      row =>
        row.companions?.[companionId]
          ?.present === true,
    );

  const positivePresent =
    positive.filter(
      row =>
        row.companions?.[companionId]
          ?.present === true,
    );

  return {
    covered:
      covered.length,

    present:
      present.length,

    zeroCaptured:
      zeroPresent.length,

    zeroCaptureRate:
      zero.length > 0
        ? zeroPresent.length / zero.length
        : null,

    negativeCaptured:
      negativePresent.length,

    negativeCaptureRate:
      negative.length > 0
        ? negativePresent.length / negative.length
        : null,

    positivePresent:
      positivePresent.length,

    positivePresentRate:
      positive.length > 0
        ? positivePresent.length / positive.length
        : null,

    pZeroGivenPresent:
      present.length > 0
        ? zeroPresent.length / present.length
        : null,
  };
}

function summarizeByHero(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = String(row.heroId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([heroId, heroRows]) => {
      const zero =
        heroRows.filter(
          row => row.combinedLabel === 'ZERO',
        );

      const companionZero =
        zero.filter(
          row =>
            COMPANIONS.some(
              c =>
                row.companions?.[c.id]
                  ?.present === true,
            ),
        );

      return {
        heroId,
        total:
          heroRows.length,
        zero:
          zero.length,
        companionZero:
          companionZero.length,
        zeroCaptureRate:
          zero.length > 0
            ? companionZero.length / zero.length
            : null,
      };
    })
    .filter(row => row.zero > 0)
    .sort(
      (a, b) =>
        b.zero - a.zero,
    );
}

function topPatterns(rows) {
  const counts = new Map();

  for (const row of rows) {
    const ids =
      COMPANIONS
        .filter(
          c =>
            row.companions?.[c.id]
              ?.present === true,
        )
        .map(c => c.id)
        .join('+');

    const key = [
      `replay=${row.replayName}`,
      `hero=${row.heroId}`,
      `label=${row.combinedLabel}`,
      `companions=${ids || 'none'}`,
      `tickGap=${row.tickGap}`,
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
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);
}
