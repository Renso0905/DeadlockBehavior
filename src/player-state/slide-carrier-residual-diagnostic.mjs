// Script185 helpers.
//
// Diagnostic-only decomposition of the carrier-ABSENT residual attack
// transitions that caused Script184's composite replication rule to fail.
//
// Important scientific boundary:
// - Script184 remains a valid contradiction of the composite exclusive model.
// - The carrier is NOT retuned.
// - The cross-replay cohort is NOT treated as fresh discovery evidence.
// - No authority promotion occurs here.
//
// We only ask where carrier-absent ZERO and NEGATIVE whole-clip transitions
// concentrate and what weapon-state features co-occur with them.

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function normalizeDetailedWeaponEvent(
  row,
  sourceIndex = 0,
) {
  const observed =
    row?.observedWeaponState ?? {};

  const rawClip =
    finite(firstDefined(
      observed.clip,
      deepFindExactKey(row, 'clip'),
      deepFindExactKey(row, 'm_iClip'),
    ));

  return {
    sourceIndex,

    tick:
      finite(firstDefined(
        row?.tick,
        row?.demoTick,
        deepFindExactKey(row, 'tick'),
      )),

    heroId:
      finite(firstDefined(
        row?.heroId,
        deepFindExactKey(row, 'heroId'),
      )),

    playerKey:
      stringOrNull(firstDefined(
        row?.playerKey,
        row?.playerName,
        deepFindExactKey(row, 'playerKey'),
        deepFindExactKey(row, 'playerName'),
      )),

    weaponEntityIndex:
      finite(firstDefined(
        row?.weaponEntityIndex,
        deepFindExactKey(row, 'weaponEntityIndex'),
      )),

    effectContextId:
      stringOrNull(firstDefined(
        row?.effectContextId,
        deepFindExactKey(row, 'effectContextId'),
      )) ?? 'NO_EFFECT_CONTEXT_ID',

    activeFireMode:
      finite(firstDefined(
        observed.activeFireMode,
        deepFindExactKey(row, 'activeFireMode'),
        deepFindExactKey(row, 'm_eActiveFireMode'),
      )) ?? 0,

    rawClip,
    wholeClip:
      zigzagReencode(rawClip),

    bonusClip:
      finite(firstDefined(
        observed.bonusClip,
        deepFindExactKey(row, 'bonusClip'),
        deepFindExactKey(row, 'm_iBonusClip'),
      )),

    ammoFraction:
      finite(firstDefined(
        observed.ammoFraction,
        deepFindExactKey(row, 'ammoFraction'),
        deepFindExactKey(row, 'm_flAmmoFrac'),
      )),

    inReload:
      booleanOrNull(firstDefined(
        observed.inReload,
        deepFindExactKey(row, 'inReload'),
        deepFindExactKey(row, 'm_bInReload'),
      )),

    activeFireModeObserved:
      finite(firstDefined(
        observed.activeFireMode,
        deepFindExactKey(row, 'activeFireMode'),
        deepFindExactKey(row, 'm_eActiveFireMode'),
      )),

    shotNumber:
      finite(firstDefined(
        observed.shotNumber,
        deepFindExactKey(row, 'shotNumber'),
        deepFindExactKey(row, 'm_nShotNumber'),
      )),

    lastAttackTime:
      finite(firstDefined(
        observed.lastAttackTime,
        deepFindExactKey(row, 'lastAttackTime'),
        deepFindExactKey(row, 'm_flLastAttackTime'),
      )),

    burstShotsRemaining:
      finite(firstDefined(
        observed.burstShotsRemaining,
        deepFindExactKey(row, 'burstShotsRemaining'),
        deepFindExactKey(row, 'm_nBurstShotsRemaining'),
      )),

    continuousShots:
      finite(firstDefined(
        observed.continuousShots,
        deepFindExactKey(row, 'continuousShots'),
        deepFindExactKey(row, 'm_nNumContinuousShots'),
      )),

    firedRecently:
      booleanOrNull(firstDefined(
        observed.firedRecently,
        deepFindExactKey(row, 'firedRecently'),
        deepFindExactKey(row, 'm_bFiredRecently'),
      )),
  };
}

export function groupDetailedWeaponEvents(events) {
  const map = new Map();

  for (const row of events) {
    const key = contextKey(row);

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push(row);
  }

  for (const rows of map.values()) {
    rows.sort((a, b) =>
      a.tick - b.tick
      || a.sourceIndex - b.sourceIndex
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

  return [...byTick.values()]
    .sort((a, b) =>
      a.tick - b.tick
      || a.sourceIndex - b.sourceIndex
    );
}

export function deriveDetailedAttackTransitions(
  grouped,
) {
  const rows = [];

  for (const contextRows of grouped.values()) {
    const settled =
      coalesceFinalStatePerTick(
        contextRows,
      );

    for (
      let index = 1;
      index < settled.length;
      index++
    ) {
      const previous =
        settled[index - 1];

      const current =
        settled[index];

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

      const shotAdvance =
        current.shotNumber
        - previous.shotNumber;

      if (shotAdvance <= 0) {
        continue;
      }

      const wholeDrop =
        previous.wholeClip
        - current.wholeClip;

      const bonusClipDelta =
        finiteDelta(
          previous.bonusClip,
          current.bonusClip,
        );

      const ammoFractionDelta =
        finiteDelta(
          previous.ammoFraction,
          current.ammoFraction,
        );

      const lastAttackAdvance =
        finiteDelta(
          previous.lastAttackTime,
          current.lastAttackTime,
        );

      rows.push({
        tick:
          current.tick,

        previousTick:
          previous.tick,

        heroId:
          current.heroId,

        playerKey:
          current.playerKey,

        weaponEntityIndex:
          current.weaponEntityIndex,

        effectContextId:
          current.effectContextId,

        activeFireMode:
          current.activeFireMode,

        shotAdvance,
        wholeDrop,

        label:
          wholeDrop > 0
            ? 'POSITIVE'
            : wholeDrop < 0
              ? 'NEGATIVE'
              : 'ZERO',

        previousWholeClip:
          previous.wholeClip,

        currentWholeClip:
          current.wholeClip,

        bonusClipDelta,

        ammoFractionDelta,

        lastAttackAdvance,

        lastAttackConfirmed:
          Number.isFinite(lastAttackAdvance)
          && lastAttackAdvance > 1e-9,

        previousBurstShotsRemaining:
          previous.burstShotsRemaining,

        currentBurstShotsRemaining:
          current.burstShotsRemaining,

        previousContinuousShots:
          previous.continuousShots,

        currentContinuousShots:
          current.continuousShots,

        firedRecently:
          current.firedRecently,

        featureFlags: {
          multiShotAdvance:
            shotAdvance > 1,

          bonusClipChanged:
            Number.isFinite(bonusClipDelta)
            && bonusClipDelta !== 0,

          bonusClipIncreased:
            Number.isFinite(bonusClipDelta)
            && bonusClipDelta > 0,

          ammoFractionChanged:
            Number.isFinite(ammoFractionDelta)
            && Math.abs(ammoFractionDelta) > 1e-9,

          burstRemainingPositive:
            Number.isFinite(current.burstShotsRemaining)
            && current.burstShotsRemaining > 0,

          continuousShotsPositive:
            Number.isFinite(current.continuousShots)
            && current.continuousShots > 0,
        },
      });
    }
  }

  return rows;
}

export function summarizeCarrierAbsentResiduals(rows) {
  const absent =
    rows.filter(
      row =>
        row.covered === true
        && row.carrierPresent === false,
    );

  const positive =
    absent.filter(
      row => row.label === 'POSITIVE',
    );

  const zero =
    absent.filter(
      row => row.label === 'ZERO',
    );

  const negative =
    absent.filter(
      row => row.label === 'NEGATIVE',
    );

  return {
    total:
      absent.length,

    partition: {
      POSITIVE:
        positive.length,
      ZERO:
        zero.length,
      NEGATIVE:
        negative.length,
    },

    residual: {
      total:
        zero.length + negative.length,

      zero:
        zero.length,

      negative:
        negative.length,

      zeroRate:
        absent.length > 0
          ? zero.length / absent.length
          : null,

      negativeRate:
        absent.length > 0
          ? negative.length / absent.length
          : null,
    },

    byHero:
      groupSummary(
        absent,
        row => String(row.heroId),
      ),

    byEffectContext:
      groupSummary(
        absent,
        row => row.effectContextId,
      ),

    byHeroEffectContext:
      groupSummary(
        absent,
        row =>
          `${row.heroId}|${row.effectContextId}`,
      ),

    byFireMode:
      groupSummary(
        absent,
        row =>
          `${row.heroId}|mode=${row.activeFireMode}`,
      ),

    features:
      featureSummary(absent),

    zeroRuns:
      zeroRunSummary(absent),

    negativeWholeDrop:
      distribution(
        negative.map(
          row => row.wholeDrop,
        ),
      ),

    residualExamples:
      [...zero, ...negative]
        .slice(0, 200),
  };
}

export function classifyResidualConcentration(summary) {
  const residualTotal =
    summary?.residual?.total ?? 0;

  if (residualTotal === 0) {
    return 'NO_CARRIER_ABSENT_RESIDUALS';
  }

  const topHero =
    summary.byHero?.[0];

  const topContext =
    summary.byEffectContext?.[0];

  const topHeroShare =
    topHero
      ? topHero.residual / residualTotal
      : 0;

  const topContextShare =
    topContext
      ? topContext.residual / residualTotal
      : 0;

  if (
    topHeroShare >= 0.50
    || topContextShare >= 0.50
  ) {
    return 'CARRIER_ABSENT_RESIDUALS_STRONGLY_CONCENTRATED';
  }

  if (
    topHeroShare >= 0.25
    || topContextShare >= 0.25
  ) {
    return 'CARRIER_ABSENT_RESIDUALS_MODERATELY_CONCENTRATED';
  }

  return 'CARRIER_ABSENT_RESIDUALS_DIFFUSE_ACROSS_HEROES_AND_CONTEXTS';
}

function groupSummary(rows, keyFn) {
  const groups = new Map();

  for (const row of rows) {
    const key =
      keyFn(row);

    if (!groups.has(key)) {
      groups.set(
        key,
        [],
      );
    }

    groups.get(key).push(row);
  }

  const totalResidual =
    rows.filter(
      row =>
        row.label === 'ZERO'
        || row.label === 'NEGATIVE',
    ).length;

  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const zero =
        groupRows.filter(
          row => row.label === 'ZERO',
        ).length;

      const negative =
        groupRows.filter(
          row => row.label === 'NEGATIVE',
        ).length;

      const positive =
        groupRows.filter(
          row => row.label === 'POSITIVE',
        ).length;

      const residual =
        zero + negative;

      return {
        key,
        total:
          groupRows.length,
        positive,
        zero,
        negative,
        residual,

        zeroRate:
          groupRows.length > 0
            ? zero / groupRows.length
            : null,

        negativeRate:
          groupRows.length > 0
            ? negative / groupRows.length
            : null,

        residualShare:
          totalResidual > 0
            ? residual / totalResidual
            : null,
      };
    })
    .sort((a, b) =>
      b.residual - a.residual
      || b.total - a.total
    );
}

function featureSummary(rows) {
  const features = [
    'multiShotAdvance',
    'bonusClipChanged',
    'bonusClipIncreased',
    'ammoFractionChanged',
    'burstRemainingPositive',
    'continuousShotsPositive',
  ];

  const output = {};

  for (const feature of features) {
    output[feature] = compareFeature(
      rows,
      feature,
    );
  }

  return output;
}

function compareFeature(rows, feature) {
  const residual =
    rows.filter(
      row =>
        row.label === 'ZERO'
        || row.label === 'NEGATIVE',
    );

  const positive =
    rows.filter(
      row =>
        row.label === 'POSITIVE',
    );

  const residualPresent =
    residual.filter(
      row =>
        row.featureFlags?.[feature]
        === true,
    ).length;

  const positivePresent =
    positive.filter(
      row =>
        row.featureFlags?.[feature]
        === true,
    ).length;

  const residualRate =
    residual.length > 0
      ? residualPresent / residual.length
      : null;

  const positiveRate =
    positive.length > 0
      ? positivePresent / positive.length
      : null;

  return {
    residualN:
      residual.length,
    positiveN:
      positive.length,

    residualPresent,
    positivePresent,

    residualRate,
    positiveRate,

    riskDifference:
      residualRate !== null
      && positiveRate !== null
        ? residualRate - positiveRate
        : null,
  };
}

function zeroRunSummary(rows) {
  const ordered =
    [...rows]
      .sort((a, b) =>
        contextKey(a).localeCompare(contextKey(b))
        || a.tick - b.tick
      );

  const runs = [];
  let activeContext = null;
  let currentRun = 0;

  for (const row of ordered) {
    const key =
      contextKey(row);

    if (key !== activeContext) {
      if (currentRun > 0) {
        runs.push(currentRun);
      }

      activeContext = key;
      currentRun = 0;
    }

    if (row.label === 'ZERO') {
      currentRun++;
    } else {
      if (currentRun > 0) {
        runs.push(currentRun);
      }

      currentRun = 0;
    }
  }

  if (currentRun > 0) {
    runs.push(currentRun);
  }

  return distribution(runs);
}

function distribution(values) {
  if (!values.length) {
    return {
      count: 0,
      min: null,
      max: null,
      mode: null,
      median: null,
      p90: null,
    };
  }

  const sorted =
    [...values]
      .sort((a, b) => a - b);

  const counts =
    new Map();

  for (const value of sorted) {
    counts.set(
      value,
      (counts.get(value) ?? 0) + 1,
    );
  }

  const mode =
    [...counts.entries()]
      .sort((a, b) =>
        b[1] - a[1]
        || a[0] - b[0]
      )[0][0];

  return {
    count:
      sorted.length,
    min:
      sorted[0],
    max:
      sorted.at(-1),
    mode,
    median:
      quantile(sorted, 0.5),
    p90:
      quantile(sorted, 0.9),
  };
}

function quantile(sorted, q) {
  if (!sorted.length) {
    return null;
  }

  const pos =
    (sorted.length - 1) * q;

  const base =
    Math.floor(pos);

  const rest =
    pos - base;

  if (
    sorted[base + 1]
    !== undefined
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

function contextKey(row) {
  return [
    row.replayName ?? '',
    row.playerKey ?? 'UNKNOWN_PLAYER',
    row.weaponEntityIndex ?? 'UNKNOWN_WEAPON',
    row.effectContextId ?? 'NO_EFFECT_CONTEXT_ID',
    row.activeFireMode ?? 0,
  ].join('|');
}

function finiteDelta(a, b) {
  return (
    Number.isFinite(a)
    && Number.isFinite(b)
  )
    ? b - a
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

  const queue = [
    {
      value: root,
      depth: 0,
    },
  ];

  const seen =
    new Set();

  while (queue.length) {
    const {
      value,
      depth,
    } = queue.shift();

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
      && Object.prototype
        .hasOwnProperty.call(
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

  const number =
    Number(value);

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

  const text =
    String(value);

  return text.length
    ? text
    : null;
}
