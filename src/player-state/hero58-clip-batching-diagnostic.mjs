// Script181 helpers.
//
// Frozen evidence entering this diagnostic:
// - Script180 total transitions: 37,571.
// - positive / zero / negative: 30,337 / 7,221 / 13.
// - hero58/mode1: n=9,786, zero=6,535, zeroRate=66.8%.
// - hero58 contributes 90.5% of all zero transitions.
// - hero58 shot advances / positive whole unit = 3.013.
// - hero58 zero-run mode / median = 20 / 24.
// - every hero58 zero transition also advances lastAttackTime.
//
// Scientific question:
// Are hero58's long zero-whole runs followed by multi-unit whole-clip drops,
// such that the ZigZag whole counter is updated in batches relative to attack
// events? If so, hero58 should be treated as a distinct weapon mechanic rather
// than evidence against the generic clip representation.
//
// No authority promotion and no replication-cohort use occur here.

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function normalizeBatchEvent(row, sourceIndex = 0) {
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
    if (Number.isFinite(row.tick)) {
      byTick.set(row.tick, row);
    }
  }

  return [...byTick.values()].sort((a, b) =>
    a.tick - b.tick || a.sourceIndex - b.sourceIndex
  );
}

export function deriveTransitions(settledEvents) {
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

    const lastAttackAdvance = (
      Number.isFinite(previous.lastAttackTime)
      && Number.isFinite(current.lastAttackTime)
    )
      ? current.lastAttackTime - previous.lastAttackTime
      : null;

    rows.push({
      previousTick: previous.tick,
      currentTick: current.tick,
      heroId: current.heroId,
      activeFireMode: current.activeFireMode,
      contextKey: contextKey(current),

      shotAdvance,
      wholeDrop,
      wholeSign:
        wholeDrop > 0 ? 'POSITIVE'
        : wholeDrop < 0 ? 'NEGATIVE'
        : 'ZERO',

      lastAttackAdvance,
      lastAttackConfirmed:
        Number.isFinite(lastAttackAdvance)
        && lastAttackAdvance > 1e-9,

      previousWholeClip: previous.wholeClip,
      currentWholeClip: current.wholeClip,

      previousBurstShotsRemaining: previous.burstShotsRemaining,
      currentBurstShotsRemaining: current.burstShotsRemaining,

      previousContinuousShots: previous.continuousShots,
      currentContinuousShots: current.continuousShots,
    });
  }

  return rows;
}

export function summarizePartition(rows) {
  const positive = rows.filter(row => row.wholeSign === 'POSITIVE');
  const zero = rows.filter(row => row.wholeSign === 'ZERO');
  const negative = rows.filter(row => row.wholeSign === 'NEGATIVE');

  return {
    total: rows.length,
    positive: positive.length,
    zero: zero.length,
    negative: negative.length,
    positiveRate: rate(positive.length, rows.length),
    zeroRate: rate(zero.length, rows.length),
    negativeRate: rate(negative.length, rows.length),

    totalShotAdvance: rows.reduce(
      (sum, row) => sum + row.shotAdvance,
      0,
    ),

    positiveWholeUnits: positive.reduce(
      (sum, row) => sum + row.wholeDrop,
      0,
    ),

    shotAdvancePerPositiveWholeUnit:
      positive.reduce((sum, row) => sum + row.wholeDrop, 0) > 0
        ? rows.reduce((sum, row) => sum + row.shotAdvance, 0)
          / positive.reduce((sum, row) => sum + row.wholeDrop, 0)
        : null,
  };
}

export function decomposeBatchedCycles(rows) {
  const cycles = [];

  let zeroTransitionCount = 0;
  let zeroShotAdvance = 0;
  let cycleStartTick = null;

  for (const row of rows) {
    if (row.wholeSign === 'NEGATIVE') {
      zeroTransitionCount = 0;
      zeroShotAdvance = 0;
      cycleStartTick = null;
      continue;
    }

    if (row.wholeSign === 'ZERO') {
      if (cycleStartTick === null) {
        cycleStartTick = row.previousTick;
      }

      zeroTransitionCount++;
      zeroShotAdvance += row.shotAdvance;
      continue;
    }

    if (row.wholeSign === 'POSITIVE') {
      const totalShotAdvance =
        zeroShotAdvance + row.shotAdvance;

      cycles.push({
        startTick:
          cycleStartTick ?? row.previousTick,
        endTick: row.currentTick,

        zeroTransitionCount,
        zeroShotAdvance,

        positiveTransitionShotAdvance:
          row.shotAdvance,
        positiveWholeDrop:
          row.wholeDrop,

        totalShotAdvance,

        shotAdvancePerWholeUnit:
          row.wholeDrop > 0
            ? totalShotAdvance / row.wholeDrop
            : null,

        previousWholeClip:
          row.previousWholeClip,
        currentWholeClip:
          row.currentWholeClip,

        burstShotsRemaining:
          row.currentBurstShotsRemaining,
        continuousShots:
          row.currentContinuousShots,
      });

      zeroTransitionCount = 0;
      zeroShotAdvance = 0;
      cycleStartTick = null;
    }
  }

  return cycles;
}

export function summarizeCycles(cycles, targetRatio = 3.013) {
  const completed = cycles.filter(
    row =>
      Number.isFinite(row.positiveWholeDrop)
      && row.positiveWholeDrop > 0
      && Number.isFinite(row.totalShotAdvance)
      && row.totalShotAdvance > 0,
  );

  const positiveDrops =
    completed.map(row => row.positiveWholeDrop);

  const zeroShotAdvances =
    completed.map(row => row.zeroShotAdvance);

  const totalShotAdvances =
    completed.map(row => row.totalShotAdvance);

  const ratios =
    completed
      .map(row => row.shotAdvancePerWholeUnit)
      .filter(Number.isFinite);

  const batchedDrops =
    completed.filter(row => row.positiveWholeDrop > 1);

  const closeToTarget =
    completed.filter(
      row =>
        Number.isFinite(row.shotAdvancePerWholeUnit)
        && Math.abs(
          row.shotAdvancePerWholeUnit - targetRatio
        ) <= 0.25,
    );

  const joint = new Map();

  for (const row of completed) {
    const key = `${row.zeroShotAdvance}|${row.positiveWholeDrop}`;
    joint.set(key, (joint.get(key) ?? 0) + 1);
  }

  const jointPatterns =
    [...joint.entries()]
      .map(([key, count]) => {
        const [zeroShotAdvance, positiveWholeDrop] =
          key.split('|').map(Number);

        return {
          zeroShotAdvance,
          positiveWholeDrop,
          count,
          impliedRatio:
            positiveWholeDrop > 0
              ? (zeroShotAdvance + 1)
                / positiveWholeDrop
              : null,
        };
      })
      .sort((a, b) =>
        b.count - a.count
        || a.zeroShotAdvance - b.zeroShotAdvance
      );

  return {
    completedCycles: completed.length,

    positiveWholeDrop: distribution(positiveDrops),
    zeroShotAdvance: distribution(zeroShotAdvances),
    totalShotAdvance: distribution(totalShotAdvances),
    shotAdvancePerWholeUnit:
      continuousDistribution(ratios),

    batchedPositiveDrops:
      batchedDrops.length,
    batchedPositiveDropRate:
      rate(batchedDrops.length, completed.length),

    closeToFrozenAggregateRatio:
      closeToTarget.length,
    closeToFrozenAggregateRatioRate:
      rate(closeToTarget.length, completed.length),

    targetRatio,

    topJointPatterns:
      jointPatterns.slice(0, 20),
  };
}

export function summarizeGenericVsHero58(allRows) {
  const hero58 = allRows.filter(row => row.heroId === 58);
  const generic = allRows.filter(row => row.heroId !== 58);

  return {
    hero58: summarizePartition(hero58),
    excludingHero58: summarizePartition(generic),
  };
}

export function classifyBatching({
  hero58Partition,
  genericPartition,
  cycleSummary,
}) {
  const genericStrong =
    genericPartition.total >= 5000
    && genericPartition.positiveRate >= 0.95
    && genericPartition.negativeRate <= 0.01;

  const hero58Distinct =
    hero58Partition.total >= 5000
    && hero58Partition.zeroRate >= 0.50;

  const batchingStrong =
    cycleSummary.completedCycles >= 100
    && cycleSummary.batchedPositiveDropRate >= 0.90
    && cycleSummary.closeToFrozenAggregateRatioRate >= 0.80;

  if (
    genericStrong
    && hero58Distinct
    && batchingStrong
  ) {
    return 'GENERIC_ZIGZAG_CLIP_COUNTER_STRONG_OUTSIDE_HERO58_HERO58_UPDATES_IN_BATCHED_MULTI_UNIT_STEPS';
  }

  if (genericStrong && hero58Distinct) {
    return 'GENERIC_ZIGZAG_CLIP_COUNTER_STRONG_OUTSIDE_HERO58_HERO58_BATCH_MECHANISM_REQUIRES_DIAGNOSIS';
  }

  return 'CLIP_REPRESENTATION_REMAINS_BROADLY_UNRESOLVED';
}

export function collectHeroStaticEvidence(root, heroId, maxRows = 120) {
  const matches = [];
  const seen = new Set();

  function visit(value, path, inheritedHeroId, depth) {
    if (
      value === null
      || value === undefined
      || depth > 14
    ) {
      return;
    }

    if (typeof value !== 'object') {
      if (
        inheritedHeroId === heroId
        && isRelevantPath(path)
      ) {
        const key = `${path}=${JSON.stringify(value)}`;

        if (!seen.has(key) && matches.length < maxRows) {
          seen.add(key);
          matches.push({
            path,
            value,
          });
        }
      }
      return;
    }

    const localHeroId = finite(
      !Array.isArray(value)
        ? firstDefined(
          value.heroId,
          value.m_nHeroID,
          value.heroID,
        )
        : null,
    );

    const nextHeroId =
      localHeroId !== null
        ? localHeroId
        : inheritedHeroId;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        visit(
          value[i],
          `${path}[${i}]`,
          nextHeroId,
          depth + 1,
        );
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      visit(
        child,
        path ? `${path}.${key}` : key,
        nextHeroId,
        depth + 1,
      );
    }
  }

  visit(root, '', null, 0);

  return matches;
}

function isRelevantPath(path) {
  return /hero|name|record|weapon|primary|clip|ammo|bullet|burst|shot|reload|fire/i.test(
    path,
  );
}

function distribution(values) {
  if (!values.length) {
    return {
      count: 0,
      mode: null,
      median: null,
      min: null,
      max: null,
      unique: [],
    };
  }

  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const mode = [...counts.entries()]
    .sort((a, b) =>
      b[1] - a[1] || a[0] - b[0]
    )[0][0];

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return {
    count: values.length,
    mode,
    median:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0],
    max: sorted.at(-1),
    unique:
      [...counts.keys()]
        .sort((a, b) => a - b)
        .slice(0, 50),
  };
}

function continuousDistribution(values) {
  if (!values.length) {
    return {
      count: 0,
      median: null,
      mean: null,
      min: null,
      max: null,
      p10: null,
      p90: null,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);

  return {
    count: sorted.length,
    median: quantile(sorted, 0.5),
    mean:
      sorted.reduce((sum, value) => sum + value, 0)
      / sorted.length,
    min: sorted[0],
    max: sorted.at(-1),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;

  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;

  if (sorted[base + 1] !== undefined) {
    return sorted[base]
      + rest * (sorted[base + 1] - sorted[base]);
  }

  return sorted[base];
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
