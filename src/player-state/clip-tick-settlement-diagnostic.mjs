// Script178 helpers.
//
// Scientific question:
// Does the Script177 ZigZag representation hypothesis fail mainly because
// Script161 emits intermediate entity mutations rather than one settled state
// per replay tick?
//
// Frozen transform from Script177:
//   raw >= 0 ? 2 * raw : -2 * raw - 1
//
// Script178 changes only the sampling unit:
//   adjacent mutation rows -> final state per context per replay tick.

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function normalizeSettlementEvent(row, sourceIndex = 0) {
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
    transformedClip: zigzagReencode(rawClip),

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

    changedFields: Array.isArray(row?.changedFields)
      ? row.changedFields
      : [],
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

    if (!byTick.has(row.tick)) {
      byTick.set(row.tick, {
        tick: row.tick,
        rows: [],
      });
    }

    byTick.get(row.tick).rows.push(row);
  }

  const settled = [];
  const phaseRows = [];

  for (const tick of [...byTick.keys()].sort((a, b) => a - b)) {
    const bucket = byTick.get(tick);
    bucket.rows.sort((a, b) => a.sourceIndex - b.sourceIndex);

    const first = bucket.rows[0];
    const last = bucket.rows.at(-1);

    const clipMutationRows = bucket.rows.filter(
      row => row.changedFields.includes('m_iClip'),
    );
    const shotMutationRows = bucket.rows.filter(
      row => row.changedFields.includes('m_nShotNumber'),
    );
    const bothSameMutationRows = bucket.rows.filter(
      row =>
        row.changedFields.includes('m_iClip')
        && row.changedFields.includes('m_nShotNumber'),
    );

    const phase = {
      tick,
      mutationRows: bucket.rows.length,
      clipMutationRows: clipMutationRows.length,
      shotMutationRows: shotMutationRows.length,
      bothSameMutationRows: bothSameMutationRows.length,

      bothFieldsChangedThisTick:
        clipMutationRows.length > 0
        && shotMutationRows.length > 0,

      splitFieldMutationThisTick:
        clipMutationRows.length > 0
        && shotMutationRows.length > 0
        && bothSameMutationRows.length === 0,

      mixedFieldPhaseThisTick:
        clipMutationRows.length > 0
        && shotMutationRows.length > 0
        && bothSameMutationRows.length > 0
        && (
          clipMutationRows.length > bothSameMutationRows.length
          || shotMutationRows.length > bothSameMutationRows.length
        ),

      firstRawClip: first.rawClip,
      lastRawClip: last.rawClip,
      firstShotNumber: first.shotNumber,
      lastShotNumber: last.shotNumber,
    };

    phaseRows.push(phase);

    settled.push({
      ...last,
      tickMutationRows: bucket.rows.length,
      tickPhase: phase,
    });
  }

  return { settled, phaseRows };
}

export function diagnoseSettledShotTransitions(settledEvents) {
  const rows = [];

  for (let index = 1; index < settledEvents.length; index++) {
    const previous = settledEvents[index - 1];
    const current = settledEvents[index];

    if (
      previous.inReload === true
      || current.inReload === true
      || !Number.isFinite(previous.shotNumber)
      || !Number.isFinite(current.shotNumber)
      || !Number.isFinite(previous.rawClip)
      || !Number.isFinite(current.rawClip)
      || !Number.isFinite(previous.transformedClip)
      || !Number.isFinite(current.transformedClip)
    ) {
      continue;
    }

    const shotAdvance =
      current.shotNumber - previous.shotNumber;

    if (shotAdvance <= 0) continue;

    const rawDrop =
      previous.rawClip - current.rawClip;
    const transformedDrop =
      previous.transformedClip - current.transformedClip;
    const absDrop =
      Math.abs(previous.rawClip) - Math.abs(current.rawClip);

    rows.push({
      previousTick: previous.tick,
      currentTick: current.tick,
      shotAdvance,

      rawDrop,
      rawDropPerShot: rawDrop / shotAdvance,

      transformedDrop,
      transformedDropPerShot:
        transformedDrop / shotAdvance,

      absDrop,
      absDropPerShot: absDrop / shotAdvance,

      transformedPositiveIntegerPerShot:
        transformedDrop > 0
        && Number.isInteger(transformedDrop / shotAdvance),

      rawPositiveIntegerPerShot:
        rawDrop > 0
        && Number.isInteger(rawDrop / shotAdvance),

      absPositiveIntegerPerShot:
        absDrop > 0
        && Number.isInteger(absDrop / shotAdvance),

      previousRawClip: previous.rawClip,
      currentRawClip: current.rawClip,
      previousTransformedClip: previous.transformedClip,
      currentTransformedClip: current.transformedClip,
    });
  }

  return summarizeTransitionRows(rows);
}

export function summarizeTransitionRows(rows) {
  return {
    observations: rows.length,
    rows,

    transformed: summarizeRepresentation(
      rows,
      'transformedDropPerShot',
      'transformedPositiveIntegerPerShot',
    ),

    raw: summarizeRepresentation(
      rows,
      'rawDropPerShot',
      'rawPositiveIntegerPerShot',
    ),

    absoluteValue: summarizeRepresentation(
      rows,
      'absDropPerShot',
      'absPositiveIntegerPerShot',
    ),
  };
}

export function summarizePhaseRows(phaseRows) {
  const both = phaseRows.filter(row => row.bothFieldsChangedThisTick);
  const split = phaseRows.filter(row => row.splitFieldMutationThisTick);
  const mixed = phaseRows.filter(row => row.mixedFieldPhaseThisTick);

  return {
    ticks: phaseRows.length,
    multiMutationTicks:
      phaseRows.filter(row => row.mutationRows > 1).length,

    bothFieldsChangedTicks: both.length,
    splitFieldMutationTicks: split.length,
    mixedFieldPhaseTicks: mixed.length,

    splitAmongBothRate:
      both.length > 0 ? split.length / both.length : null,

    anyNonAtomicAmongBothRate:
      both.length > 0
        ? phaseRows.filter(
          row =>
            row.bothFieldsChangedThisTick
            && (
              row.splitFieldMutationThisTick
              || row.mixedFieldPhaseThisTick
            ),
        ).length / both.length
        : null,
  };
}

export function compareMutationVsSettled(script177, settledSummary) {
  const priorComparable =
    script177?.pooledShotTransitions?.observations ?? null;
  const priorAligned =
    script177?.pooledShotTransitions
      ?.transformed?.positiveIntegerPerShot ?? null;
  const priorRate =
    script177?.pooledShotTransitions
      ?.transformed?.positiveIntegerPerShotRate ?? null;

  return {
    mutationLevel: {
      comparable: priorComparable,
      aligned: priorAligned,
      rate: priorRate,
    },
    tickSettled: {
      comparable: settledSummary.observations,
      aligned:
        settledSummary.transformed.positiveIntegerPerShot,
      rate:
        settledSummary.transformed.positiveIntegerPerShotRate,
    },
    rateDelta:
      Number.isFinite(priorRate)
      && Number.isFinite(
        settledSummary.transformed.positiveIntegerPerShotRate,
      )
        ? settledSummary.transformed.positiveIntegerPerShotRate
          - priorRate
        : null,
  };
}

function summarizeRepresentation(rows, valueKey, boolKey) {
  const values = rows
    .map(row => row[valueKey])
    .filter(Number.isFinite);

  const positiveInteger =
    rows.filter(row => row[boolKey] === true).length;

  return {
    positiveIntegerPerShot: positiveInteger,
    positiveIntegerPerShotRate:
      rows.length > 0 ? positiveInteger / rows.length : null,
    mode: mode(values),
    median: median(values),
    negativeRate:
      rows.length > 0
        ? rows.filter(row => row[valueKey] < 0).length / rows.length
        : null,
    zeroRate:
      rows.length > 0
        ? rows.filter(row => row[valueKey] === 0).length / rows.length
        : null,
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

function mode(values) {
  if (!values.length) return null;

  const counts = new Map();
  for (const value of values) {
    const key = round6(value);
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

function round6(value) {
  return Number(Number(value).toFixed(6));
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
