// Script190 helpers.
//
// Diagnostic question:
// Did Scripts185-189 create false residuals by grouping weapon events by
// effectContextId and then comparing non-contiguous visits to the same context?
//
// Strict chronology groups only by player + weapon entity, coalesces final state
// per tick, and compares consecutive states in time. This is diagnostic-only.

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function strictWeaponKey(row) {
  return [
    row.playerKey ?? 'UNKNOWN_PLAYER',
    row.weaponEntityIndex ?? 'UNKNOWN_WEAPON',
  ].join('|');
}

export function groupStrictWeaponChronology(events) {
  const groups = new Map();

  for (const row of events) {
    const key = strictWeaponKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const rows of groups.values()) {
    rows.sort(
      (a, b) =>
        a.tick - b.tick
        || a.sourceIndex - b.sourceIndex,
    );
  }

  return groups;
}

export function coalesceFinalPerTick(rows) {
  const byTick = new Map();

  for (const row of rows) {
    if (Number.isFinite(row.tick)) {
      byTick.set(row.tick, row);
    }
  }

  return [...byTick.values()]
    .sort(
      (a, b) =>
        a.tick - b.tick
        || a.sourceIndex - b.sourceIndex,
    );
}

export function deriveStrictAttackTransitions(groups) {
  const transitions = [];

  for (const rows of groups.values()) {
    const settled = coalesceFinalPerTick(rows);

    for (let i = 1; i < settled.length; i++) {
      const previous = settled[i - 1];
      const current = settled[i];

      if (
        previous.inReload === true
        || current.inReload === true
        || !Number.isFinite(previous.shotNumber)
        || !Number.isFinite(current.shotNumber)
        || !Number.isFinite(previous.rawClip)
        || !Number.isFinite(current.rawClip)
        || !Number.isFinite(previous.bonusClip)
        || !Number.isFinite(current.bonusClip)
      ) {
        continue;
      }

      const shotAdvance =
        current.shotNumber - previous.shotNumber;

      if (shotAdvance <= 0) continue;

      const previousMain = zigzagReencode(previous.rawClip);
      const currentMain = zigzagReencode(current.rawClip);
      const previousBonus = zigzagReencode(previous.bonusClip);
      const currentBonus = zigzagReencode(current.bonusClip);

      const mainDrop = previousMain - currentMain;
      const bonusDrop = previousBonus - currentBonus;
      const combinedDrop = mainDrop + bonusDrop;

      transitions.push({
        tick: current.tick,
        previousTick: previous.tick,
        tickGap: current.tick - previous.tick,

        heroId: current.heroId,
        playerKey: current.playerKey,
        weaponEntityIndex: current.weaponEntityIndex,

        previousEffectContextId: previous.effectContextId,
        currentEffectContextId: current.effectContextId,
        effectContextChanged:
          previous.effectContextId !== current.effectContextId,

        previousActiveFireMode: previous.activeFireMode,
        currentActiveFireMode: current.activeFireMode,
        fireModeChanged:
          previous.activeFireMode !== current.activeFireMode,

        shotAdvance,

        previousRawClip: previous.rawClip,
        currentRawClip: current.rawClip,
        previousBonusClip: previous.bonusClip,
        currentBonusClip: current.bonusClip,

        mainDrop,
        bonusDrop,
        combinedDrop,

        combinedLabel:
          combinedDrop > 0
            ? 'POSITIVE'
            : combinedDrop < 0
              ? 'NEGATIVE'
              : 'ZERO',

        reloadAvailableTimeChanged:
          changedFinite(
            previous.reloadAvailableTime,
            current.reloadAvailableTime,
          ),

        lastReloadStartTimeChanged:
          changedFinite(
            previous.lastReloadStartTime,
            current.lastReloadStartTime,
          ),

        reloadQueuedStartTimeChanged:
          changedFinite(
            previous.reloadQueuedStartTime,
            current.reloadQueuedStartTime,
          ),
      });
    }
  }

  return transitions;
}

export function summarizeStrictChronology(rows) {
  const absent =
    rows.filter(
      row =>
        row.covered === true
        && row.carrierPresent === false,
    );

  const positive =
    absent.filter(row => row.combinedLabel === 'POSITIVE');

  const zero =
    absent.filter(row => row.combinedLabel === 'ZERO');

  const negative =
    absent.filter(row => row.combinedLabel === 'NEGATIVE');

  const residual = [...zero, ...negative];

  return {
    total: absent.length,
    positive: positive.length,
    zero: zero.length,
    negative: negative.length,

    positiveRate:
      absent.length > 0
        ? positive.length / absent.length
        : null,

    zeroRate:
      absent.length > 0
        ? zero.length / absent.length
        : null,

    negativeRate:
      absent.length > 0
        ? negative.length / absent.length
        : null,

    residual: residual.length,
    residualRate:
      absent.length > 0
        ? residual.length / absent.length
        : null,

    shotAdvance:
      distribution(
        absent.map(row => row.shotAdvance),
      ),

    residualShotAdvance:
      distribution(
        residual.map(row => row.shotAdvance),
      ),

    tickGap:
      distribution(
        absent.map(row => row.tickGap),
      ),

    residualTickGap:
      distribution(
        residual.map(row => row.tickGap),
      ),

    contextChanged: compareFlag(
      residual,
      positive,
      row => row.effectContextChanged,
    ),

    fireModeChanged: compareFlag(
      residual,
      positive,
      row => row.fireModeChanged,
    ),

    lastReloadStartTimeChanged: compareFlag(
      residual,
      positive,
      row => row.lastReloadStartTimeChanged,
    ),

    reloadAvailableTimeChanged: compareFlag(
      residual,
      positive,
      row => row.reloadAvailableTimeChanged,
    ),

    byHero:
      groupResiduals(
        residual,
        row => String(row.heroId),
      ),

    byReplay:
      groupResiduals(
        residual,
        row => row.replayName,
      ),

    topResidualPatterns:
      topPatterns(residual),
  };
}

export function compareLegacyAndStrict({
  legacyResidual,
  strictResidual,
}) {
  const reduction =
    legacyResidual > 0
      ? 1 - strictResidual / legacyResidual
      : null;

  return {
    legacyResidual,
    strictResidual,
    reduction,

    classification:
      Number.isFinite(reduction)
      && reduction >= 0.50
        ? 'NONCONTIGUOUS_CONTEXT_GROUPING_EXPLAINS_SUBSTANTIAL_LEGACY_RESIDUALS'
        : 'STRICT_CHRONOLOGY_DOES_NOT_EXPLAIN_MOST_LEGACY_RESIDUALS',
  };
}

function compareFlag(residual, positive, predicate) {
  const residualTrue =
    residual.filter(predicate).length;

  const positiveTrue =
    positive.filter(predicate).length;

  const residualRate =
    residual.length > 0
      ? residualTrue / residual.length
      : null;

  const positiveRate =
    positive.length > 0
      ? positiveTrue / positive.length
      : null;

  return {
    residualTrue,
    positiveTrue,
    residualRate,
    positiveRate,
    riskDifference:
      Number.isFinite(residualRate)
      && Number.isFinite(positiveRate)
        ? residualRate - positiveRate
        : null,
  };
}

function groupResiduals(rows, keyFn) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([key, groupRows]) => ({
      key,
      total: groupRows.length,
      zero:
        groupRows.filter(
          row => row.combinedLabel === 'ZERO',
        ).length,
      negative:
        groupRows.filter(
          row => row.combinedLabel === 'NEGATIVE',
        ).length,
      multiShot:
        groupRows.filter(
          row => row.shotAdvance > 1,
        ).length,
      contextChanged:
        groupRows.filter(
          row => row.effectContextChanged,
        ).length,
      reloadStartChanged:
        groupRows.filter(
          row => row.lastReloadStartTimeChanged,
        ).length,
    }))
    .sort((a, b) => b.total - a.total);
}

function topPatterns(rows) {
  const counts = new Map();

  for (const row of rows) {
    const key = [
      `replay=${row.replayName}`,
      `hero=${row.heroId}`,
      `label=${row.combinedLabel}`,
      `shots=${row.shotAdvance}`,
      `drop=${row.combinedDrop}`,
      `tickGap=${row.tickGap}`,
      `ctxChanged=${row.effectContextChanged}`,
      `modeChanged=${row.fireModeChanged}`,
      `reloadStartChanged=${row.lastReloadStartTimeChanged}`,
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
      p99: null,
    };
  }

  const counts = new Map();
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
    count: clean.length,
    min: clean[0],
    max: clean.at(-1),
    mode,
    median: quantile(clean, 0.5),
    p90: quantile(clean, 0.9),
    p99: quantile(clean, 0.99),
  };
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;

  if (sorted[base + 1] !== undefined) {
    return sorted[base]
      + rest
      * (sorted[base + 1] - sorted[base]);
  }

  return sorted[base];
}

function changedFinite(a, b) {
  return (
    Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) > 1e-9
  );
}
