// Script176 helpers.
//
// Purpose:
// Diagnose the exact Script175 contexts in which the stable reload-exit
// plateau is lower than a later observed m_iClip value.
//
// No thresholds are retuned and no capacity semantics are promoted here.

export function normalizeOutlierEvent(row, index = 0) {
  const observed = row?.observedWeaponState ?? {};

  return {
    sourceIndex: index,
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

    clip: finite(firstDefined(
      observed?.clip,
      deepFindExactKey(row, 'clip'),
      deepFindExactKey(row, 'm_iClip'),
    )),
    bonusClip: finite(firstDefined(
      observed?.bonusClip,
      deepFindExactKey(row, 'bonusClip'),
      deepFindExactKey(row, 'm_iBonusClip'),
    )),
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

    changedFields: Array.isArray(row?.changedFields)
      ? row.changedFields
      : [],
    transition:
      row?.transition
      && typeof row.transition === 'object'
        ? row.transition
        : {},
    raw: row,
  };
}

export function failingCeilingContexts(script175) {
  const rows =
    script175?.evaluation?.rows ?? [];

  return rows
    .filter(
      row =>
        row?.ceiling?.exactCeiling === false
        && Number.isFinite(row?.candidateCapacity),
    )
    .map(row => ({
      contextKey: row.contextKey,
      heroId: finite(row.heroId),
      candidateCapacity:
        finite(row.candidateCapacity),
      maxObservedClip:
        finite(row?.ceiling?.maxObservedClip),
      overshoots:
        finite(row?.ceiling?.overshoots) ?? 0,
      completionLikeReloads:
        finite(row?.completionLikeReloads) ?? 0,
    }));
}

export function groupEventsByContext(events) {
  const map = new Map();

  for (const row of events) {
    const key = contextKey(row);

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push(row);
  }

  for (const rows of map.values()) {
    rows.sort(
      (a, b) =>
        a.tick - b.tick
        || a.sourceIndex - b.sourceIndex,
    );
  }

  return map;
}

export function diagnoseCeilingOutlier(
  failure,
  events,
  neighborhood = 3,
) {
  const candidate = failure.candidateCapacity;
  const overshootIndexes = [];

  for (let index = 0; index < events.length; index++) {
    const row = events[index];

    if (
      Number.isFinite(row.clip)
      && Number.isFinite(candidate)
      && row.clip > candidate
    ) {
      overshootIndexes.push(index);
    }
  }

  const overshootEvents =
    overshootIndexes.map(index => {
      const current = events[index];
      const previous =
        index > 0 ? events[index - 1] : null;
      const next =
        index + 1 < events.length
          ? events[index + 1]
          : null;

      const shotAdvance =
        numericAdvance(
          previous?.shotNumber,
          current?.shotNumber,
        );

      const lastAttackAdvance =
        numericAdvance(
          previous?.lastAttackTime,
          current?.lastAttackTime,
        );

      const clipDelta =
        numericDelta(
          previous?.clip,
          current?.clip,
        );

      const bonusClipDelta =
        numericDelta(
          previous?.bonusClip,
          current?.bonusClip,
        );

      const classification =
        classifyOvershootEvent({
          current,
          previous,
          clipDelta,
          bonusClipDelta,
          shotAdvance,
          lastAttackAdvance,
        });

      return {
        index,
        tick: current.tick,
        clip: current.clip,
        candidateCapacity: candidate,
        excess:
          current.clip - candidate,

        previous:
          compactEvent(previous),
        current:
          compactEvent(current),
        next:
          compactEvent(next),

        deltas: {
          clip: clipDelta,
          bonusClip: bonusClipDelta,
          shotNumber: shotAdvance,
          lastAttackTime: lastAttackAdvance,
        },

        classification,

        neighborhood:
          events
            .slice(
              Math.max(0, index - neighborhood),
              Math.min(
                events.length,
                index + neighborhood + 1,
              ),
            )
            .map(compactEvent),
      };
    });

  const maxObservedClip =
    maxFinite(
      events
        .map(row => row.clip)
        .filter(Number.isFinite),
    );

  return {
    ...failure,
    eventCount: events.length,
    observedMaxClip: maxObservedClip,
    overshootEventCount:
      overshootEvents.length,
    overshootEvents,
    overshootClassifications:
      countBy(
        overshootEvents.map(
          row => row.classification,
        ),
      ),
  };
}

export function classifyOvershootEvent({
  current,
  previous,
  clipDelta,
  bonusClipDelta,
  shotAdvance,
  lastAttackAdvance,
}) {
  if (!previous) {
    return 'CONTEXT_ENTRY_ABOVE_CANDIDATE';
  }

  if (
    current?.inReload === false
    && previous?.inReload === true
  ) {
    return 'RELOAD_EXIT_ABOVE_CANDIDATE';
  }

  if (
    Number.isFinite(bonusClipDelta)
    && bonusClipDelta > 0
    && Number.isFinite(clipDelta)
    && clipDelta > 0
  ) {
    return 'CLIP_AND_BONUS_CLIP_INCREASE';
  }

  if (
    Number.isFinite(clipDelta)
    && clipDelta > 0
    && (
      !Number.isFinite(shotAdvance)
      || shotAdvance <= 0
    )
    && (
      !Number.isFinite(lastAttackAdvance)
      || lastAttackAdvance <= 0
    )
    && current?.inReload !== true
  ) {
    return 'NON_RELOAD_NO_SHOT_CLIP_INCREASE';
  }

  if (
    Number.isFinite(clipDelta)
    && clipDelta > 0
    && current?.inReload === true
  ) {
    return 'DURING_RELOAD_CLIP_INCREASE';
  }

  if (
    Number.isFinite(shotAdvance)
    && shotAdvance > 0
  ) {
    return 'SHOT_ASSOCIATED_OVERSHOOT_STATE';
  }

  return 'OTHER_OR_UNRESOLVED';
}

export function observedPerShotClipConsumption(events) {
  const rows = [];

  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1];
    const current = events[index];

    if (
      previous.inReload === true
      || current.inReload === true
      || !Number.isFinite(previous.clip)
      || !Number.isFinite(current.clip)
      || !Number.isFinite(previous.shotNumber)
      || !Number.isFinite(current.shotNumber)
    ) {
      continue;
    }

    const shotAdvance =
      current.shotNumber - previous.shotNumber;
    const clipDrop =
      previous.clip - current.clip;

    if (
      shotAdvance <= 0
      || clipDrop <= 0
    ) {
      continue;
    }

    rows.push({
      tick: current.tick,
      shotAdvance,
      clipDrop,
      clipDropPerShot:
        clipDrop / shotAdvance,
      integerPerShot:
        Number.isInteger(
          clipDrop / shotAdvance,
        ),
    });
  }

  const perShotValues =
    rows.map(row => row.clipDropPerShot);

  const mode =
    uniqueMode(perShotValues);

  return {
    observations: rows.length,
    modePerShotClipDrop:
      mode?.value ?? null,
    modeCount:
      mode?.count ?? 0,
    modeDominance:
      rows.length > 0 && mode
        ? mode.count / rows.length
        : null,
    medianPerShotClipDrop:
      median(perShotValues),
    integerPerShotRate:
      rows.length > 0
        ? rows.filter(
          row => row.integerPerShot,
        ).length / rows.length
        : null,
    uniquePerShotClipDrops:
      [...new Set(perShotValues)]
        .sort((a, b) => a - b),
    rows,
  };
}

export function summarizeAllContextPerShotConsumption(
  contextRows,
) {
  const perContext =
    contextRows.map(context => ({
      contextKey: context.contextKey,
      heroId: context.heroId,
      candidateCapacity:
        context.candidateCapacity,
      diagnostic:
        observedPerShotClipConsumption(
          context.events,
        ),
    }));

  const allRows =
    perContext.flatMap(
      row => row.diagnostic.rows,
    );

  const values =
    allRows.map(
      row => row.clipDropPerShot,
    );

  const mode =
    uniqueMode(values);

  return {
    perContext,
    pooled: {
      observations: allRows.length,
      modePerShotClipDrop:
        mode?.value ?? null,
      modeCount:
        mode?.count ?? 0,
      modeDominance:
        allRows.length > 0 && mode
          ? mode.count / allRows.length
          : null,
      medianPerShotClipDrop:
        median(values),
      integerPerShotRate:
        allRows.length > 0
          ? allRows.filter(
            row => row.integerPerShot,
          ).length / allRows.length
          : null,
    },
  };
}

export function buildCandidateContextsFromScript175(
  script175,
  groupedEvents,
) {
  const rows =
    script175?.evaluation?.rows ?? [];

  return rows
    .filter(
      row =>
        Number.isFinite(row?.candidateCapacity),
    )
    .map(row => ({
      contextKey: row.contextKey,
      heroId: finite(row.heroId),
      candidateCapacity:
        finite(row.candidateCapacity),
      contextPass:
        row?.contextPass === true,
      events:
        groupedEvents.get(row.contextKey)
        ?? [],
    }));
}

function compactEvent(row) {
  if (!row) return null;

  return {
    tick: row.tick,
    clip: row.clip,
    bonusClip: row.bonusClip,
    ammoFraction: row.ammoFraction,
    inReload: row.inReload,
    shotNumber: row.shotNumber,
    lastAttackTime: row.lastAttackTime,
    changedFields: row.changedFields,
    transition: row.transition,
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

function countBy(values) {
  const result = {};

  for (const value of values) {
    result[value] =
      (result[value] ?? 0) + 1;
  }

  return result;
}

function numericDelta(a, b) {
  if (
    !Number.isFinite(a)
    || !Number.isFinite(b)
  ) {
    return null;
  }

  return b - a;
}

function numericAdvance(a, b) {
  return numericDelta(a, b);
}

function uniqueMode(values) {
  const counts = new Map();

  for (
    const value
    of values.filter(Number.isFinite)
  ) {
    const key =
      Number(value.toFixed(6));

    counts.set(
      key,
      (counts.get(key) ?? 0) + 1,
    );
  }

  if (counts.size === 0) return null;

  const ordered =
    [...counts.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1]
          || a[0] - b[0],
      );

  if (
    ordered.length > 1
    && ordered[0][1] === ordered[1][1]
  ) {
    return null;
  }

  return {
    value: ordered[0][0],
    count: ordered[0][1],
  };
}

function median(values) {
  const sorted =
    values
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

  if (sorted.length === 0) return null;

  const middle =
    Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (
      sorted[middle - 1]
      + sorted[middle]
    ) / 2;
}

function maxFinite(values) {
  const finite =
    values.filter(Number.isFinite);

  return finite.length > 0
    ? Math.max(...finite)
    : null;
}

export function deepFindExactKey(
  root,
  key,
  maxDepth = 8,
) {
  if (
    !root
    || typeof root !== 'object'
  ) {
    return undefined;
  }

  const seen = new Set();
  const queue = [
    { value: root, depth: 0 },
  ];

  while (queue.length) {
    const { value, depth } =
      queue.shift();

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
      && Object.prototype.hasOwnProperty.call(
        value,
        key,
      )
    ) {
      return value[key];
    }

    for (
      const child
      of (
        Array.isArray(value)
          ? value
          : Object.values(value)
      )
    ) {
      if (
        child
        && typeof child === 'object'
      ) {
        queue.push({
          value: child,
          depth: depth + 1,
        });
      }
    }
  }

  return undefined;
}

function firstDefined(...values) {
  return values.find(
    value =>
      value !== undefined
      && value !== null,
  );
}

function finite(value) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function booleanOrNull(value) {
  if (
    value === true
    || value === false
  ) {
    return value;
  }

  if (
    value === 1
    || value === '1'
    || value === 'true'
  ) {
    return true;
  }

  if (
    value === 0
    || value === '0'
    || value === 'false'
  ) {
    return false;
  }

  return null;
}

function stringOrNull(value) {
  if (
    value === null
    || value === undefined
  ) {
    return null;
  }

  const text = String(value);

  return text.length > 0
    ? text
    : null;
}
