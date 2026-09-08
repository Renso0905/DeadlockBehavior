// Script180 helpers.
//
// Frozen inputs:
// - ZigZag whole counter candidate: raw>=0 ? 2*raw : -2*raw-1.
// - Script179 V02 transformed whole-drop partition:
//     positive=30,337; zero=7,221; negative=13; total=37,571.
// - m_flAmmoFrac does not explain the zero-whole-drop transitions.
//
// Scientific question:
// Are zero-whole-drop shotNumber advances concentrated in a hero/weapon
// mechanic where shotNumber advances more frequently than whole clip
// consumption (multi-element shot, subshot, burst element, projectile, etc.)?
//
// No gameplay semantics are promoted here.

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function normalizeZeroDropEvent(row, sourceIndex = 0) {
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
    firedRecently: booleanOrNull(firstDefined(
      observed?.firedRecently,
      deepFindExactKey(row, 'firedRecently'),
      deepFindExactKey(row, 'm_bFiredRecently'),
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
    if (Number.isFinite(row.tick)) byTick.set(row.tick, row);
  }
  return [...byTick.values()].sort((a, b) =>
    a.tick - b.tick || a.sourceIndex - b.sourceIndex
  );
}

export function deriveShotTransitions(settledEvents) {
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
      shotAdvance,
      wholeDrop,
      wholeDropPerShot: wholeDrop / shotAdvance,
      wholeSign:
        wholeDrop > 0 ? 'POSITIVE'
        : wholeDrop < 0 ? 'NEGATIVE'
        : 'ZERO',

      lastAttackAdvance,
      lastAttackConfirmed:
        Number.isFinite(lastAttackAdvance)
        && lastAttackAdvance > 1e-9,

      signalProvenance:
        Number.isFinite(lastAttackAdvance)
        && lastAttackAdvance > 1e-9
          ? 'SHOT_NUMBER_AND_LAST_ATTACK'
          : 'SHOT_NUMBER_ONLY',

      previousBurstShotsRemaining:
        previous.burstShotsRemaining,
      currentBurstShotsRemaining:
        current.burstShotsRemaining,

      previousContinuousShots:
        previous.continuousShots,
      currentContinuousShots:
        current.continuousShots,

      previousFiredRecently:
        previous.firedRecently,
      currentFiredRecently:
        current.firedRecently,
    });
  }

  return rows;
}

export function summarizeZeroDropMechanism(rows) {
  const zeroRows = rows.filter(row => row.wholeSign === 'ZERO');
  const positiveRows = rows.filter(row => row.wholeSign === 'POSITIVE');
  const negativeRows = rows.filter(row => row.wholeSign === 'NEGATIVE');

  const groups = new Map();

  for (const row of rows) {
    const key = [
      row.heroId ?? 'UNKNOWN',
      row.activeFireMode ?? 'UNKNOWN',
    ].join('|');

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }

  const byHeroMode = [...groups.entries()]
    .map(([key, groupRows]) => {
      const [heroText, modeText] = key.split('|');
      const heroId = heroText === 'UNKNOWN' ? null : Number(heroText);
      const activeFireMode = modeText === 'UNKNOWN' ? null : Number(modeText);
      const zero = groupRows.filter(row => row.wholeSign === 'ZERO');
      const positive = groupRows.filter(row => row.wholeSign === 'POSITIVE');
      const negative = groupRows.filter(row => row.wholeSign === 'NEGATIVE');

      const totalShotAdvance = groupRows.reduce(
        (sum, row) => sum + row.shotAdvance,
        0,
      );
      const totalPositiveWholeDrop = groupRows.reduce(
        (sum, row) => sum + Math.max(0, row.wholeDrop),
        0,
      );

      return {
        heroId,
        activeFireMode,
        observations: groupRows.length,
        zero: zero.length,
        zeroRate: rate(zero.length, groupRows.length),
        positive: positive.length,
        negative: negative.length,

        zeroLastAttackConfirmed:
          zero.filter(row => row.lastAttackConfirmed).length,
        zeroLastAttackConfirmedRate:
          rate(
            zero.filter(row => row.lastAttackConfirmed).length,
            zero.length,
          ),

        zeroShotNumberOnly:
          zero.filter(
            row => row.signalProvenance === 'SHOT_NUMBER_ONLY',
          ).length,
        zeroShotNumberOnlyRate:
          rate(
            zero.filter(
              row => row.signalProvenance === 'SHOT_NUMBER_ONLY',
            ).length,
            zero.length,
          ),

        totalShotAdvance,
        totalPositiveWholeDrop,
        shotAdvancePerPositiveWholeUnit:
          totalPositiveWholeDrop > 0
            ? totalShotAdvance / totalPositiveWholeDrop
            : null,

        zeroRunLengths:
          zeroRunLengths(groupRows),
      };
    })
    .sort((a, b) =>
      b.zero - a.zero
      || b.observations - a.observations
    );

  const top = byHeroMode[0] ?? null;

  return {
    observations: rows.length,
    positive: positiveRows.length,
    zero: zeroRows.length,
    negative: negativeRows.length,

    byHeroMode,

    topZeroGroup: top,

    topZeroShare:
      top && zeroRows.length > 0
        ? top.zero / zeroRows.length
        : null,

    zeroSignalProvenance: {
      shotNumberAndLastAttack:
        zeroRows.filter(row => row.lastAttackConfirmed).length,
      shotNumberAndLastAttackRate:
        rate(
          zeroRows.filter(row => row.lastAttackConfirmed).length,
          zeroRows.length,
        ),
      shotNumberOnly:
        zeroRows.filter(
          row => row.signalProvenance === 'SHOT_NUMBER_ONLY',
        ).length,
      shotNumberOnlyRate:
        rate(
          zeroRows.filter(
            row => row.signalProvenance === 'SHOT_NUMBER_ONLY',
          ).length,
          zeroRows.length,
        ),
    },
  };
}

export function zeroRunLengths(rows) {
  const lengths = [];
  let current = 0;

  for (const row of rows) {
    if (row.wholeSign === 'ZERO') {
      current += row.shotAdvance;
      continue;
    }

    if (row.wholeSign === 'POSITIVE') {
      if (current > 0) lengths.push(current);
      current = 0;
      continue;
    }

    // Negative transition breaks the simple run.
    current = 0;
  }

  return summarizeIntegerDistribution(lengths);
}

export function extractStaticMultiElementProfiles(script165) {
  const profiles = new Map();

  walk(script165, value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const heroId = finite(value.heroId);
    if (heroId === null) return;

    const bullets = finite(firstDefined(
      value.bullets,
      deepFindExactKey(value, 'm_iBullets'),
    ));
    const burstShotCount = finite(firstDefined(
      value.burstShotCount,
      deepFindExactKey(value, 'm_iBurstShotCount'),
    ));
    const ammoConsumedPerShot = finite(firstDefined(
      value.ammoConsumedPerShot,
      deepFindExactKey(value, 'm_iAmmoConsumedPerShot'),
    ));
    const clipSize = finite(firstDefined(
      value.clipSize,
      deepFindExactKey(value, 'm_iClipSize'),
    ));

    if (
      bullets === null
      && burstShotCount === null
      && ammoConsumedPerShot === null
      && clipSize === null
    ) {
      return;
    }

    const prior = profiles.get(heroId) ?? {
      heroId,
      displayName: stringOrNull(value.displayName),
      bullets: null,
      burstShotCount: null,
      ammoConsumedPerShot: null,
      clipSize: null,
    };

    if (prior.bullets === null && bullets !== null) prior.bullets = bullets;
    if (
      prior.burstShotCount === null
      && burstShotCount !== null
    ) {
      prior.burstShotCount = burstShotCount;
    }
    if (
      prior.ammoConsumedPerShot === null
      && ammoConsumedPerShot !== null
    ) {
      prior.ammoConsumedPerShot = ammoConsumedPerShot;
    }
    if (prior.clipSize === null && clipSize !== null) {
      prior.clipSize = clipSize;
    }

    profiles.set(heroId, prior);
  });

  return profiles;
}

export function attachStaticProfiles(summary, profiles) {
  return summary.byHeroMode.map(row => {
    const profile = profiles.get(row.heroId) ?? null;

    const observedRatio = row.shotAdvancePerPositiveWholeUnit;

    const candidateStaticCounts = [
      profile?.bullets,
      profile?.burstShotCount,
    ].filter(value => Number.isFinite(value) && value > 0);

    const closestStaticCount = (
      Number.isFinite(observedRatio)
      && candidateStaticCounts.length
    )
      ? candidateStaticCounts
          .map(value => ({
            value,
            error: Math.abs(observedRatio - value),
          }))
          .sort((a, b) => a.error - b.error)[0]
      : null;

    return {
      ...row,
      static: profile,
      closestStaticMultiplicity: closestStaticCount,
    };
  });
}

export function classifyZeroDropPattern(summary, rowsWithStatic) {
  const top = rowsWithStatic[0] ?? null;

  if (
    !top
    || !Number.isFinite(summary.topZeroShare)
  ) {
    return 'ZERO_WHOLE_DROP_MECHANISM_UNRESOLVED';
  }

  const concentrated =
    summary.topZeroShare >= 0.80
    && top.zeroRate >= 0.50;

  const staticMultiplicityMatch =
    concentrated
    && Number.isFinite(top.shotAdvancePerPositiveWholeUnit)
    && Number.isFinite(top.closestStaticMultiplicity?.value)
    && top.closestStaticMultiplicity.error <= 0.25;

  if (staticMultiplicityMatch) {
    return 'ZERO_WHOLE_DROPS_DOMINATED_BY_HERO_SPECIFIC_MULTI_ELEMENT_SHOT_MECHANIC';
  }

  if (concentrated) {
    return 'ZERO_WHOLE_DROPS_DOMINATED_BY_HERO_SPECIFIC_WEAPON_MECHANIC_STATIC_MAPPING_UNRESOLVED';
  }

  return 'ZERO_WHOLE_DROP_MECHANISM_UNRESOLVED';
}

function summarizeIntegerDistribution(values) {
  if (!values.length) {
    return {
      count: 0,
      mode: null,
      median: null,
      values: [],
    };
  }

  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const mode = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;

  return {
    count: values.length,
    mode,
    median,
    values: [...new Set(values)].sort((a, b) => a - b),
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

function walk(root, visitor, maxDepth = 10) {
  const seen = new Set();

  function visit(value, depth) {
    if (
      !value
      || typeof value !== 'object'
      || seen.has(value)
      || depth > maxDepth
    ) {
      return;
    }

    seen.add(value);
    visitor(value);

    for (const child of Object.values(value)) {
      visit(child, depth + 1);
    }
  }

  visit(root, 0);
}

function firstDefined(...values) {
  return values.find(
    value => value !== undefined && value !== null,
  );
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
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
