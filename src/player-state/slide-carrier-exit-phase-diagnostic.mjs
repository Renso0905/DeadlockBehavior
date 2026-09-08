// Script195 helpers.
//
// Diagnostic-only refinement of Script194:
// for carrier-absent attacks, determine whether the frozen primary carrier
// transitioned present -> absent on the exact attack tick.
//
// This tests packet/state phase ordering. It does not retune the carrier.

export function summarizeExitPhase(rows) {
  const eligible =
    rows.filter(
      row =>
        row.primaryCovered === true
        && row.primaryPresent === false
        && (
          row.combinedLabel === 'ZERO'
          || row.combinedLabel === 'POSITIVE'
        ),
    );

  const zeros =
    eligible.filter(
      row => row.combinedLabel === 'ZERO',
    );

  const positives =
    eligible.filter(
      row => row.combinedLabel === 'POSITIVE',
    );

  const zeroExactExit =
    zeros.filter(
      row => row.exactExitAtAttack === true,
    );

  const positiveExactExit =
    positives.filter(
      row => row.exactExitAtAttack === true,
    );

  const exactExitAll =
    [...zeroExactExit, ...positiveExactExit];

  const zeroRecentExit1 =
    zeros.filter(
      row =>
        Number.isFinite(row.ticksSinceExit)
        && row.ticksSinceExit >= 0
        && row.ticksSinceExit <= 1,
    );

  const positiveRecentExit1 =
    positives.filter(
      row =>
        Number.isFinite(row.ticksSinceExit)
        && row.ticksSinceExit >= 0
        && row.ticksSinceExit <= 1,
    );

  const exactExitZeroRate =
    exactExitAll.length > 0
      ? zeroExactExit.length / exactExitAll.length
      : null;

  const exactExitRecall =
    zeros.length > 0
      ? zeroExactExit.length / zeros.length
      : null;

  const exactExitPositiveRate =
    positives.length > 0
      ? positiveExactExit.length / positives.length
      : null;

  return {
    zeroSamples:
      zeros.length,

    positiveControls:
      positives.length,

    exactExit: {
      zero:
        zeroExactExit.length,

      positive:
        positiveExactExit.length,

      total:
        exactExitAll.length,

      pZeroGivenExactExit:
        exactExitZeroRate,

      zeroRecall:
        exactExitRecall,

      positiveControlRate:
        exactExitPositiveRate,
    },

    recentExitWithin1: {
      zero:
        zeroRecentExit1.length,

      positive:
        positiveRecentExit1.length,

      pZeroGivenRecentExit:
        (
          zeroRecentExit1.length
          + positiveRecentExit1.length
        ) > 0
          ? zeroRecentExit1.length
            / (
              zeroRecentExit1.length
              + positiveRecentExit1.length
            )
          : null,
    },

    byHero:
      summarizeByHero(
        zeros,
        positives,
      ),

    exitAgeZero:
      distribution(
        zeros
          .map(row => row.ticksSinceExit)
          .filter(Number.isFinite),
      ),

    exitAgePositive:
      distribution(
        positives
          .map(row => row.ticksSinceExit)
          .filter(Number.isFinite),
      ),

    remainingZeros:
      zeros
        .filter(
          row =>
            row.exactExitAtAttack !== true,
        )
        .map(row => ({
          tick:
            row.tick,
          heroId:
            row.heroId,
          playerKey:
            row.playerKey,
          tickGap:
            row.tickGap,
          ticksSinceExit:
            row.ticksSinceExit,
          lastTransition:
            row.lastCarrierTransition ?? null,
        }))
        .slice(0, 150),

    classification:
      (
        exactExitRecall !== null
        && exactExitRecall >= 0.75
        && exactExitZeroRate !== null
        && exactExitZeroRate >= 0.80
        && exactExitPositiveRate !== null
        && exactExitPositiveRate <= 0.001
      )
        ? 'EXACT_CARRIER_EXIT_TICK_STRONGLY_EXPLAINS_STRICT_ZERO_PHASE'
        : 'EXACT_CARRIER_EXIT_TICK_DOES_NOT_FULLY_EXPLAIN_STRICT_ZEROS',
  };
}

function summarizeByHero(zeros, positives) {
  const heroIds =
    new Set([
      ...zeros.map(row => String(row.heroId)),
      ...positives.map(row => String(row.heroId)),
    ]);

  return [...heroIds]
    .map(heroId => {
      const heroZeros =
        zeros.filter(
          row => String(row.heroId) === heroId,
        );

      const heroPositives =
        positives.filter(
          row => String(row.heroId) === heroId,
        );

      const zeroExact =
        heroZeros.filter(
          row => row.exactExitAtAttack === true,
        ).length;

      const positiveExact =
        heroPositives.filter(
          row => row.exactExitAtAttack === true,
        ).length;

      return {
        heroId,

        zero:
          heroZeros.length,

        zeroExactExit:
          zeroExact,

        zeroExactExitRate:
          heroZeros.length > 0
            ? zeroExact / heroZeros.length
            : null,

        positive:
          heroPositives.length,

        positiveExactExit:
          positiveExact,

        positiveExactExitRate:
          heroPositives.length > 0
            ? positiveExact / heroPositives.length
            : null,
      };
    })
    .filter(
      row =>
        row.zero > 0
        || row.positiveExactExit > 0,
    )
    .sort(
      (a, b) =>
        b.zero - a.zero
        || b.zeroExactExit - a.zeroExactExit,
    );
}

function distribution(values) {
  const clean =
    values
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

  if (!clean.length) {
    return {
      count: 0,
      min: null,
      max: null,
      mode: null,
      median: null,
      p90: null,
    };
  }

  const counts =
    new Map();

  for (const value of clean) {
    counts.set(
      value,
      (counts.get(value) ?? 0) + 1,
    );
  }

  const mode =
    [...counts.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1]
          || a[0] - b[0],
      )[0][0];

  return {
    count:
      clean.length,
    min:
      clean[0],
    max:
      clean.at(-1),
    mode,
    median:
      quantile(clean, 0.5),
    p90:
      quantile(clean, 0.9),
  };
}

function quantile(sorted, q) {
  const pos =
    (sorted.length - 1) * q;

  const base =
    Math.floor(pos);

  const rest =
    pos - base;

  if (
    sorted[base + 1] !== undefined
  ) {
    return sorted[base]
      + rest
      * (
        sorted[base + 1]
        - sorted[base]
      );
  }

  return sorted[base];
}
