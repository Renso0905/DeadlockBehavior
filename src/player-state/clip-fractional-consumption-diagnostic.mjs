// Script179 helpers.
//
// Frozen findings entering this diagnostic:
// - Script177 ZigZag re-encode: raw>=0 ? 2*raw : -2*raw-1.
// - Script178 tick settlement does not change the result.
// - Tick-settled shot transitions: 37,571.
// - ZigZag transformed positive-integer consumption: 30,335 (80.7%).
// - Remaining failures are non-negative, dominated by zero integer drop.
//
// Scientific question:
// Does m_flAmmoFrac carry a fractional component that, together with the
// ZigZag-reencoded whole counter, yields a continuous ammo-consumption state?
//
// Two sign conventions are tested symmetrically:
//   PLUS  = Z + ammoFraction
//   MINUS = Z - ammoFraction
//
// Constant offsets (for example a later -1 sentinel correction) cancel in
// transition differences and are deliberately not solved here.

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function normalizeFractionEvent(row, sourceIndex = 0) {
  const observed = row?.observedWeaponState ?? {};

  const rawClip = finite(firstDefined(
    observed?.clip,
    deepFindExactKey(row, 'clip'),
    deepFindExactKey(row, 'm_iClip'),
  ));

  return {
    sourceIndex,
    tick: finite(firstDefined(
      row?.tick,
      row?.demoTick,
      deepFindExactKey(row, 'tick'),
    )),
    heroId: finite(firstDefined(
      row?.heroId,
      deepFindExactKey(row, 'heroId'),
    )),
    playerKey: stringOrNull(firstDefined(
      row?.playerKey,
      row?.playerName,
      deepFindExactKey(row, 'playerKey'),
      deepFindExactKey(row, 'playerName'),
    )),
    weaponEntityIndex: finite(firstDefined(
      row?.weaponEntityIndex,
      deepFindExactKey(row, 'weaponEntityIndex'),
    )),
    effectContextId: stringOrNull(firstDefined(
      row?.effectContextId,
      deepFindExactKey(row, 'effectContextId'),
    )) ?? 'NO_EFFECT_CONTEXT_ID',
    activeFireMode: finite(firstDefined(
      observed?.activeFireMode,
      deepFindExactKey(row, 'activeFireMode'),
      deepFindExactKey(row, 'm_eActiveFireMode'),
    )) ?? 0,

    rawClip,
    wholeClip: zigzagReencode(rawClip),

    ammoFraction: finite(firstDefined(
      observed?.ammoFraction,
      deepFindExactKey(row, 'ammoFraction'),
      deepFindExactKey(row, 'm_flAmmoFrac'),
    )),

    inReload: booleanOrNull(firstDefined(
      observed?.inReload,
      deepFindExactKey(row, 'inReload'),
      deepFindExactKey(row, 'm_bInReload'),
    )),

    shotNumber: finite(firstDefined(
      observed?.shotNumber,
      deepFindExactKey(row, 'shotNumber'),
      deepFindExactKey(row, 'm_nShotNumber'),
    )),

    lastAttackTime: finite(firstDefined(
      observed?.lastAttackTime,
      deepFindExactKey(row, 'lastAttackTime'),
      deepFindExactKey(row, 'm_flLastAttackTime'),
    )),

    burstShotsRemaining: finite(firstDefined(
      observed?.burstShotsRemaining,
      deepFindExactKey(row, 'burstShotsRemaining'),
      deepFindExactKey(row, 'm_nBurstShotsRemaining'),
    )),

    continuousShots: finite(firstDefined(
      observed?.continuousShots,
      deepFindExactKey(row, 'continuousShots'),
      deepFindExactKey(row, 'm_nNumContinuousShots'),
    )),
  };
}

export function groupByContext(events) {
  const map = new Map();

  for (const row of events) {
    const key = contextKey(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }

  for (const rows of map.values()) {
    rows.sort((a, b) =>
      a.tick - b.tick || a.sourceIndex - b.sourceIndex
    );
  }

  return map;
}

export function coalesceFinalStatePerTick(events) {
  const byTick = new Map();

  for (const row of events) {
    if (!Number.isFinite(row.tick)) continue;
    byTick.set(row.tick, row);
  }

  return [...byTick.values()]
    .sort((a, b) =>
      a.tick - b.tick || a.sourceIndex - b.sourceIndex
    );
}

export function diagnoseFractionalShotTransitions(settledEvents) {
  const rows = [];

  for (let index = 1; index < settledEvents.length; index++) {
    const previous = settledEvents[index - 1];
    const current = settledEvents[index];

    if (
      previous.inReload === true
      || current.inReload === true
      || !Number.isFinite(previous.shotNumber)
      || !Number.isFinite(current.shotNumber)
      || !Number.isFinite(previous.wholeClip)
      || !Number.isFinite(current.wholeClip)
    ) {
      continue;
    }

    const shotAdvance = current.shotNumber - previous.shotNumber;
    if (shotAdvance <= 0) continue;

    const wholeDrop = previous.wholeClip - current.wholeClip;
    const wholeDropPerShot = wholeDrop / shotAdvance;

    const fractionComparable =
      Number.isFinite(previous.ammoFraction)
      && Number.isFinite(current.ammoFraction);

    const fractionDelta = fractionComparable
      ? current.ammoFraction - previous.ammoFraction
      : null;

    const plusDrop = fractionComparable
      ? (
        previous.wholeClip + previous.ammoFraction
      ) - (
        current.wholeClip + current.ammoFraction
      )
      : null;

    const minusDrop = fractionComparable
      ? (
        previous.wholeClip - previous.ammoFraction
      ) - (
        current.wholeClip - current.ammoFraction
      )
      : null;

    rows.push({
      previousTick: previous.tick,
      currentTick: current.tick,

      heroId: current.heroId,
      activeFireMode: current.activeFireMode,
      burstShotsRemaining: current.burstShotsRemaining,
      continuousShots: current.continuousShots,

      shotAdvance,

      wholeDrop,
      wholeDropPerShot,

      zeroWholeDrop: wholeDrop === 0,
      positiveWholeDrop: wholeDrop > 0,
      negativeWholeDrop: wholeDrop < 0,

      fractionComparable,
      previousAmmoFraction: previous.ammoFraction,
      currentAmmoFraction: current.ammoFraction,
      fractionDelta,
      fractionChanged:
        fractionComparable
        && Math.abs(fractionDelta) > 1e-9,

      plusDrop,
      plusDropPerShot:
        Number.isFinite(plusDrop)
          ? plusDrop / shotAdvance
          : null,

      minusDrop,
      minusDropPerShot:
        Number.isFinite(minusDrop)
          ? minusDrop / shotAdvance
          : null,
    });
  }

  return summarizeFractionRows(rows);
}

export function summarizeFractionRows(rows) {
  const zeroRows = rows.filter(row => row.zeroWholeDrop);
  const positiveRows = rows.filter(row => row.positiveWholeDrop);
  const negativeRows = rows.filter(row => row.negativeWholeDrop);
  const fractionComparable = rows.filter(row => row.fractionComparable);
  const zeroComparable = zeroRows.filter(row => row.fractionComparable);

  return {
    observations: rows.length,
    rows,

    whole: {
      zero: zeroRows.length,
      zeroRate: rate(zeroRows.length, rows.length),
      positive: positiveRows.length,
      positiveRate: rate(positiveRows.length, rows.length),
      negative: negativeRows.length,
      negativeRate: rate(negativeRows.length, rows.length),
      exactOnePerShot: rows.filter(
        row => near(row.wholeDropPerShot, 1),
      ).length,
      exactOnePerShotRate: rate(
        rows.filter(row => near(row.wholeDropPerShot, 1)).length,
        rows.length,
      ),
    },

    fraction: {
      comparable: fractionComparable.length,
      comparableRate: rate(fractionComparable.length, rows.length),
      changed: fractionComparable.filter(row => row.fractionChanged).length,
      changedRate: rate(
        fractionComparable.filter(row => row.fractionChanged).length,
        fractionComparable.length,
      ),

      zeroWholeComparable: zeroComparable.length,
      zeroWholeFractionChanged:
        zeroComparable.filter(row => row.fractionChanged).length,
      zeroWholeFractionChangedRate: rate(
        zeroComparable.filter(row => row.fractionChanged).length,
        zeroComparable.length,
      ),

      range: fractionRange(rows),
    },

    plusCandidate: summarizeComposite(rows, 'plusDropPerShot'),
    minusCandidate: summarizeComposite(rows, 'minusDropPerShot'),

    zeroWholeResolution: {
      plus: summarizeZeroResolution(zeroComparable, 'plusDropPerShot'),
      minus: summarizeZeroResolution(zeroComparable, 'minusDropPerShot'),
    },
  };
}

export function summarizeByHeroAndRegime(rows) {
  const groups = new Map();

  for (const row of rows) {
    const regime = [
      row.heroId ?? 'UNKNOWN',
      row.activeFireMode ?? 'UNKNOWN',
      Number.isFinite(row.burstShotsRemaining)
        ? (row.burstShotsRemaining > 0 ? 'BURST_POSITIVE' : 'BURST_ZERO')
        : 'BURST_UNKNOWN',
    ].join('|');

    if (!groups.has(regime)) groups.set(regime, []);
    groups.get(regime).push(row);
  }

  return [...groups.entries()]
    .map(([regime, groupRows]) => {
      const summary = summarizeFractionRows(groupRows);
      const [heroId, activeFireMode, burstRegime] = regime.split('|');

      return {
        heroId: heroId === 'UNKNOWN' ? null : Number(heroId),
        activeFireMode:
          activeFireMode === 'UNKNOWN'
            ? null
            : Number(activeFireMode),
        burstRegime,
        observations: summary.observations,
        wholeZeroRate: summary.whole.zeroRate,
        wholeExactOneRate: summary.whole.exactOnePerShotRate,
        fractionComparableRate: summary.fraction.comparableRate,
        zeroWholeFractionChangedRate:
          summary.fraction.zeroWholeFractionChangedRate,
        plusPositiveRate:
          summary.plusCandidate.positiveRate,
        minusPositiveRate:
          summary.minusCandidate.positiveRate,
        plusZeroResolutionRate:
          summary.zeroWholeResolution.plus.positiveRate,
        minusZeroResolutionRate:
          summary.zeroWholeResolution.minus.positiveRate,
      };
    })
    .sort((a, b) =>
      b.observations - a.observations
      || (a.heroId ?? 0) - (b.heroId ?? 0)
    );
}

function summarizeComposite(rows, key) {
  const comparable = rows.filter(row => Number.isFinite(row[key]));
  const values = comparable.map(row => row[key]);

  const positive = comparable.filter(row => row[key] > 1e-9).length;
  const zero = comparable.filter(row => Math.abs(row[key]) <= 1e-9).length;
  const negative = comparable.filter(row => row[key] < -1e-9).length;

  return {
    comparable: comparable.length,
    comparableRate: rate(comparable.length, rows.length),

    positive,
    positiveRate: rate(positive, comparable.length),

    zero,
    zeroRate: rate(zero, comparable.length),

    negative,
    negativeRate: rate(negative, comparable.length),

    exactOnePerShot:
      comparable.filter(row => near(row[key], 1)).length,
    exactOnePerShotRate: rate(
      comparable.filter(row => near(row[key], 1)).length,
      comparable.length,
    ),

    mode: mode(values),
    median: median(values),
    mean: mean(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
  };
}

function summarizeZeroResolution(rows, key) {
  const comparable = rows.filter(row => Number.isFinite(row[key]));
  const positive = comparable.filter(row => row[key] > 1e-9).length;
  const zero = comparable.filter(row => Math.abs(row[key]) <= 1e-9).length;
  const negative = comparable.filter(row => row[key] < -1e-9).length;

  return {
    comparable: comparable.length,
    positive,
    positiveRate: rate(positive, comparable.length),
    zero,
    zeroRate: rate(zero, comparable.length),
    negative,
    negativeRate: rate(negative, comparable.length),
    median: median(comparable.map(row => row[key])),
  };
}

function fractionRange(rows) {
  const values = [];

  for (const row of rows) {
    if (Number.isFinite(row.previousAmmoFraction)) {
      values.push(row.previousAmmoFraction);
    }
    if (Number.isFinite(row.currentAmmoFraction)) {
      values.push(row.currentAmmoFraction);
    }
  }

  return {
    count: values.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    median: median(values),
  };
}

function contextKey(row) {
  return [
    row.playerKey ?? 'UNKNOWN_PLAYER',
    row.weaponEntityIndex ?? 'UNKNOWN_WEAPON',
    row.effectContextId ?? 'NO_EFFECT_CONTEXT_ID',
    row.activeFireMode ?? 0,
  ].join('|');
}

function rate(n, d) {
  return d > 0 ? n / d : null;
}

function near(a, b, tolerance = 1e-6) {
  return Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) <= tolerance;
}

function mode(values) {
  if (!values.length) return null;

  const counts = new Map();
  for (const value of values) {
    const key = Number(Number(value).toFixed(6));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function deepFindExactKey(root, key, maxDepth = 8) {
  if (!root || typeof root !== 'object') return undefined;

  const seen = new Set();
  const queue = [{ value: root, depth: 0 }];

  while (queue.length) {
    const { value, depth } = queue.shift();

    if (
      !value
      || typeof value !== 'object'
      || seen.has(value)
      || depth > maxDepth
    ) {
      continue;
    }

    seen.add(value);

    if (
      !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(value, key)
    ) {
      return value[key];
    }

    for (
      const child
      of (Array.isArray(value) ? value : Object.values(value))
    ) {
      if (child && typeof child === 'object') {
        queue.push({ value: child, depth: depth + 1 });
      }
    }
  }

  return undefined;
}

function firstDefined(...values) {
  return values.find(
    value => value !== undefined && value !== null,
  );
}

function finite(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function stringOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length ? text : null;
}
