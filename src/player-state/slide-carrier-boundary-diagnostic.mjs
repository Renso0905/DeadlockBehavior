// Script194 helpers.
//
// Diagnostic-only question on test.dem:
// Do strict carrier-absent zero-consumption attacks cluster immediately before
// or after the frozen primary slide carrier is present?
//
// This tests carrier phase/boundary timing. It does NOT retune the carrier.

export const BOUNDARY_HORIZONS = Object.freeze([1, 2, 4, 8]);

export function stateAtTick(timeline, tick) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return {
      covered: false,
      present: false,
    };
  }

  let low = 0;
  let high = timeline.length - 1;
  let best = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const row = timeline[mid];

    if (row.tick <= tick) {
      best = row;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best ?? {
    covered: false,
    present: false,
  };
}

export function inspectCarrierBoundary(
  timeline,
  attackTick,
  horizons = BOUNDARY_HORIZONS,
) {
  const result = {};

  for (const horizon of horizons) {
    let before = false;
    let after = false;

    for (let delta = 1; delta <= horizon; delta++) {
      const prior =
        stateAtTick(
          timeline,
          attackTick - delta,
        );

      const future =
        stateAtTick(
          timeline,
          attackTick + delta,
        );

      if (
        prior.covered === true
        && prior.present === true
      ) {
        before = true;
      }

      if (
        future.covered === true
        && future.present === true
      ) {
        after = true;
      }
    }

    result[String(horizon)] = {
      horizon,
      before,
      after,
      either: before || after,
      both: before && after,
    };
  }

  return result;
}

export function summarizeBoundaryTiming(
  rows,
  timelineByPawn,
  horizons = BOUNDARY_HORIZONS,
) {
  const eligible =
    rows.filter(
      row =>
        row.primaryCovered === true
        && row.primaryPresent === false
        && (
          row.combinedLabel === 'ZERO'
          || row.combinedLabel === 'POSITIVE'
        ),
    )
    .map(row => ({
      ...row,
      boundary:
        inspectCarrierBoundary(
          timelineByPawn.get(
            row.pawnEntityIndex,
          ) ?? [],
          row.tick,
          horizons,
        ),
    }));

  const zeros =
    eligible.filter(
      row => row.combinedLabel === 'ZERO',
    );

  const positives =
    eligible.filter(
      row => row.combinedLabel === 'POSITIVE',
    );

  const byHorizon = {};

  for (const horizon of horizons) {
    const key = String(horizon);

    byHorizon[key] = compareBoundaryFlag(
      zeros,
      positives,
      row => row.boundary[key].either,
      {
        zeroBefore:
          rateCount(
            zeros,
            row => row.boundary[key].before,
          ),
        zeroAfter:
          rateCount(
            zeros,
            row => row.boundary[key].after,
          ),
        zeroBoth:
          rateCount(
            zeros,
            row => row.boundary[key].both,
          ),
      },
    );
  }

  return {
    zeroSamples:
      zeros.length,

    positiveControls:
      positives.length,

    byHorizon,

    byHero:
      summarizeByHero(
        zeros,
        timelineByPawn,
        horizons,
      ),

    topZeroBoundaryPatterns:
      topPatterns(zeros, horizons),

    classification:
      classifyBoundary(byHorizon),
  };
}

function classifyBoundary(byHorizon) {
  const h2 = byHorizon['2'];
  const h4 = byHorizon['4'];

  if (
    h2
    && h2.zeroRate >= 0.50
    && h2.riskDifference >= 0.25
  ) {
    return 'SLIDE_CARRIER_BOUNDARY_PHASE_EXPLAINS_SUBSTANTIAL_STRICT_ZEROS';
  }

  if (
    h4
    && h4.zeroRate >= 0.25
    && h4.riskDifference >= 0.10
  ) {
    return 'SLIDE_CARRIER_BOUNDARY_PHASE_EXPLAINS_MINOR_STRICT_ZEROS';
  }

  return 'STRICT_ZEROS_ARE_NOT_EXPLAINED_BY_PRIMARY_CARRIER_BOUNDARY_TIMING';
}

function compareBoundaryFlag(
  zeros,
  positives,
  predicate,
  extras = {},
) {
  const zeroTrue =
    zeros.filter(predicate).length;

  const positiveTrue =
    positives.filter(predicate).length;

  const zeroRate =
    zeros.length > 0
      ? zeroTrue / zeros.length
      : null;

  const positiveRate =
    positives.length > 0
      ? positiveTrue / positives.length
      : null;

  return {
    zeroTrue,
    positiveTrue,
    zeroRate,
    positiveRate,
    riskDifference:
      Number.isFinite(zeroRate)
      && Number.isFinite(positiveRate)
        ? zeroRate - positiveRate
        : null,
    ...extras,
  };
}

function rateCount(rows, predicate) {
  const count =
    rows.filter(predicate).length;

  return {
    count,
    rate:
      rows.length > 0
        ? count / rows.length
        : null,
  };
}

function summarizeByHero(
  zeros,
  timelineByPawn,
  horizons,
) {
  const groups = new Map();

  for (const row of zeros) {
    const key = String(row.heroId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([heroId, heroRows]) => {
      const result = {
        heroId,
        zero:
          heroRows.length,
      };

      for (const horizon of horizons) {
        const key = String(horizon);
        const captured =
          heroRows.filter(
            row =>
              row.boundary[key].either,
          ).length;

        result[`within${horizon}`] =
          captured;

        result[`within${horizon}Rate`] =
          heroRows.length > 0
            ? captured / heroRows.length
            : null;
      }

      return result;
    })
    .sort(
      (a, b) =>
        b.zero - a.zero,
    );
}

function topPatterns(rows, horizons) {
  const maxH =
    Math.max(...horizons);

  const counts = new Map();

  for (const row of rows) {
    const b =
      row.boundary[String(maxH)];

    const key = [
      `hero=${row.heroId}`,
      `before=${b.before}`,
      `after=${b.after}`,
      `both=${b.both}`,
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
