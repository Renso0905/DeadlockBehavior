// Script192 helpers.
//
// Discovery-only scan on test.dem for OTHER runtime pawn modifier bits
// associated with strict, carrier-absent, combined-counter ZERO-consumption
// attacks.
//
// Known slide-family bits are excluded:
//   primary .0002 bit5
//   companion .0002 bit1
//   companion .0007 bit1
//
// Negative combined drops are deliberately excluded from this discovery and
// remain a separate ammo-gain/refill question.

export const KNOWN_SLIDE_BITS = Object.freeze([
  Object.freeze({
    field: 'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
    bit: 5,
  }),
  Object.freeze({
    field: 'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
    bit: 1,
  }),
  Object.freeze({
    field: 'm_pModifierProp.m_bvEnabledPredictedStateMask.0007',
    bit: 1,
  }),
]);

export const ZERO_MODIFIER_DISCOVERY_THRESHOLDS = Object.freeze({
  minZeroSamples: 20,
  minPositiveControls: 5000,
  minCandidatePresent: 10,
  minZeroCaptured: 5,
  minZeroRateGivenPresent: 0.25,
  minRiskDifference: 0.20,
  maxPositivePresentRate: 0.01,
  minSupportingHeroes: 3,
});

const MASK_FIELD_PATTERN =
  /^m_pModifierProp\..*(?:Mask|StateMask)\./i;

export function extractModifierMaskSnapshot(state) {
  const result = {};

  for (const [field, raw] of Object.entries(state ?? {})) {
    if (!MASK_FIELD_PATTERN.test(field)) continue;

    const value = Number(raw);

    if (
      !Number.isFinite(value)
      || !Number.isInteger(value)
    ) {
      continue;
    }

    result[field] = value >>> 0;
  }

  return result;
}

export function candidateId(field, bit) {
  return `${field}#bit${bit}`;
}

export function isKnownSlideBit(field, bit) {
  return KNOWN_SLIDE_BITS.some(
    row =>
      row.field === field
      && row.bit === bit,
  );
}

export function activeBitCandidates(maskSnapshot) {
  const result = [];

  for (
    const [field, unsignedValue]
    of Object.entries(maskSnapshot ?? {})
  ) {
    const value = Number(unsignedValue) >>> 0;

    for (let bit = 0; bit < 32; bit++) {
      if (isKnownSlideBit(field, bit)) {
        continue;
      }

      const mask = (1 << bit) >>> 0;

      if ((value & mask) !== 0) {
        result.push({
          id: candidateId(field, bit),
          field,
          bit,
          mask,
        });
      }
    }
  }

  return result;
}

export function evaluateModifierBitCandidates(
  samples,
  thresholds =
    ZERO_MODIFIER_DISCOVERY_THRESHOLDS,
) {
  const eligible =
    samples.filter(
      row =>
        row.outcome === 'ZERO'
        || row.outcome === 'POSITIVE',
    );

  const zeroSamples =
    eligible.filter(
      row => row.outcome === 'ZERO',
    );

  const positiveSamples =
    eligible.filter(
      row => row.outcome === 'POSITIVE',
    );

  const candidateDefs =
    new Map();

  for (const row of eligible) {
    for (
      const candidate
      of activeBitCandidates(
        row.modifierMasks,
      )
    ) {
      candidateDefs.set(
        candidate.id,
        candidate,
      );
    }
  }

  const candidates = [];

  for (
    const candidate
    of candidateDefs.values()
  ) {
    let covered = 0;
    let present = 0;
    let zeroCovered = 0;
    let zeroPresent = 0;
    let positiveCovered = 0;
    let positivePresent = 0;

    const heroStats = new Map();

    for (const row of eligible) {
      if (
        !Object.prototype
          .hasOwnProperty.call(
            row.modifierMasks ?? {},
            candidate.field,
          )
      ) {
        continue;
      }

      covered++;

      const value =
        Number(
          row.modifierMasks[
            candidate.field
          ],
        ) >>> 0;

      const isPresent =
        (value & candidate.mask) !== 0;

      if (row.outcome === 'ZERO') {
        zeroCovered++;
        if (isPresent) zeroPresent++;
      } else {
        positiveCovered++;
        if (isPresent) positivePresent++;
      }

      if (isPresent) {
        present++;

        const heroKey =
          String(row.heroId);

        if (!heroStats.has(heroKey)) {
          heroStats.set(
            heroKey,
            {
              present: 0,
              zero: 0,
              positive: 0,
            },
          );
        }

        const stats =
          heroStats.get(heroKey);

        stats.present++;

        if (row.outcome === 'ZERO') {
          stats.zero++;
        } else {
          stats.positive++;
        }
      }
    }

    if (present === 0) {
      continue;
    }

    const absent =
      covered - present;

    const zeroAbsent =
      zeroCovered - zeroPresent;

    const pZeroGivenPresent =
      present > 0
        ? zeroPresent / present
        : null;

    const pZeroGivenAbsent =
      absent > 0
        ? zeroAbsent / absent
        : null;

    const riskDifference =
      Number.isFinite(pZeroGivenPresent)
      && Number.isFinite(pZeroGivenAbsent)
        ? pZeroGivenPresent
          - pZeroGivenAbsent
        : null;

    const zeroRecall =
      zeroCovered > 0
        ? zeroPresent / zeroCovered
        : null;

    const positivePresentRate =
      positiveCovered > 0
        ? positivePresent / positiveCovered
        : null;

    const supportingHeroes =
      [...heroStats.entries()]
        .filter(
          ([, stats]) =>
            stats.present >= 2
            && stats.zero >= 2
            && (
              stats.zero
              / stats.present
            ) >= 0.50,
        )
        .map(([heroId]) => heroId);

    const strongCandidate =
      zeroSamples.length
        >= thresholds.minZeroSamples
      && positiveSamples.length
        >= thresholds.minPositiveControls
      && present
        >= thresholds.minCandidatePresent
      && zeroPresent
        >= thresholds.minZeroCaptured
      && pZeroGivenPresent
        >= thresholds.minZeroRateGivenPresent
      && riskDifference
        >= thresholds.minRiskDifference
      && positivePresentRate
        <= thresholds.maxPositivePresentRate
      && supportingHeroes.length
        >= thresholds.minSupportingHeroes;

    const score =
      (
        (riskDifference ?? 0)
        * 1000
      )
      + (
        (zeroRecall ?? 0)
        * 500
      )
      + (
        supportingHeroes.length
        * 25
      )
      - (
        (positivePresentRate ?? 1)
        * 1000
      );

    candidates.push({
      ...candidate,

      covered,
      present,
      absent,

      zeroCovered,
      zeroPresent,
      zeroAbsent,

      positiveCovered,
      positivePresent,

      pZeroGivenPresent,
      pZeroGivenAbsent,
      riskDifference,
      zeroRecall,
      positivePresentRate,

      supportingHeroes,
      supportingHeroCount:
        supportingHeroes.length,

      strongCandidate,
      score,
    });
  }

  candidates.sort(
    (a, b) =>
      Number(b.strongCandidate)
      - Number(a.strongCandidate)
      || b.score - a.score
      || b.zeroPresent - a.zeroPresent,
  );

  const strongCandidates =
    candidates.filter(
      row => row.strongCandidate,
    );

  return {
    eligible:
      eligible.length,
    zeroSamples:
      zeroSamples.length,
    positiveControls:
      positiveSamples.length,

    candidateCount:
      candidates.length,

    strongCandidateCount:
      strongCandidates.length,

    strongCandidates:
      strongCandidates.slice(0, 50),

    topCandidates:
      candidates.slice(0, 100),

    classification:
      strongCandidates.length > 0
        ? 'OTHER_RUNTIME_MODIFIER_BIT_CANDIDATE_DISCOVERED_ON_TEST'
        : 'NO_STRONG_OTHER_RUNTIME_MODIFIER_BIT_CANDIDATE_ON_TEST',
  };
}
