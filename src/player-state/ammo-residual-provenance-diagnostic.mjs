// Script189 helpers.
//
// Diagnostic-only provenance classification for the residual transitions left
// after:
//   1. excluding the frozen slide/infinite-ammo carrier, and
//   2. composing ZigZag(m_iClip) + ZigZag(m_iBonusClip).
//
// The rep01-rep05 cohort is already consumed evidence. This script cannot
// promote or independently replicate a new mechanic.

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function enrichCombinedTransition(row) {
  const previousMain =
    zigzagReencode(row.previousRawClip);

  const currentMain =
    zigzagReencode(row.currentRawClip);

  const previousBonus =
    zigzagReencode(row.previousBonusClip);

  const currentBonus =
    zigzagReencode(row.currentBonusClip);

  const mainDrop =
    Number.isFinite(previousMain)
    && Number.isFinite(currentMain)
      ? previousMain - currentMain
      : null;

  const bonusDrop =
    Number.isFinite(previousBonus)
    && Number.isFinite(currentBonus)
      ? previousBonus - currentBonus
      : null;

  const combinedDrop =
    Number.isFinite(mainDrop)
    && Number.isFinite(bonusDrop)
      ? mainDrop + bonusDrop
      : null;

  const combinedLabel =
    !Number.isFinite(combinedDrop)
      ? 'UNEVALUABLE'
      : combinedDrop > 0
        ? 'POSITIVE'
        : combinedDrop < 0
          ? 'NEGATIVE'
          : 'ZERO';

  return {
    ...row,
    previousMain,
    currentMain,
    previousBonus,
    currentBonus,
    mainDrop,
    bonusDrop,
    combinedDrop,
    combinedLabel,
  };
}

export function classifyResidual(row) {
  if (row.combinedLabel === 'ZERO') {
    if (row.shotAdvance > 1) {
      return 'MULTI_SHOT_NO_AMMO_CONSUMPTION';
    }

    return 'SINGLE_SHOT_NO_AMMO_CONSUMPTION';
  }

  if (row.combinedLabel === 'NEGATIVE') {
    const mainGain =
      Number.isFinite(row.mainDrop)
      && row.mainDrop < 0;

    const bonusGain =
      Number.isFinite(row.bonusDrop)
      && row.bonusDrop < 0;

    if (mainGain && bonusGain) {
      return 'ATTACK_COUPLED_MAIN_AND_BONUS_AMMO_GAIN';
    }

    if (mainGain) {
      return 'ATTACK_COUPLED_MAIN_AMMO_GAIN';
    }

    if (bonusGain) {
      return 'ATTACK_COUPLED_BONUS_AMMO_GAIN';
    }

    return 'ATTACK_COUPLED_AMMO_GAIN_UNRESOLVED_COMPONENT';
  }

  return 'NOT_RESIDUAL';
}

export function summarizeResidualProvenance(rows) {
  const absent =
    rows
      .filter(
        row =>
          row.covered === true
          && row.carrierPresent === false,
      )
      .map(enrichCombinedTransition)
      .filter(
        row =>
          Number.isFinite(row.combinedDrop),
      );

  const residuals =
    absent
      .filter(
        row =>
          row.combinedLabel === 'ZERO'
          || row.combinedLabel === 'NEGATIVE',
      )
      .map(row => ({
        ...row,
        residualClass:
          classifyResidual(row),
      }));

  const positive =
    absent.filter(
      row =>
        row.combinedLabel === 'POSITIVE',
    );

  return {
    carrierAbsent:
      absent.length,

    positive:
      positive.length,

    residual:
      residuals.length,

    residualRate:
      absent.length > 0
        ? residuals.length / absent.length
        : null,

    classes:
      countBy(
        residuals,
        row => row.residualClass,
      ),

    byHero:
      groupResiduals(
        residuals,
        row => String(row.heroId),
      ),

    byReplay:
      groupResiduals(
        residuals,
        row => row.replayName,
      ),

    byHeroEffectContext:
      groupResiduals(
        residuals,
        row =>
          `${row.heroId}|${row.effectContextId}`,
      ),

    shotAdvance:
      distribution(
        residuals.map(
          row => row.shotAdvance,
        ),
      ),

    zeroShotAdvance:
      distribution(
        residuals
          .filter(
            row =>
              row.combinedLabel === 'ZERO',
          )
          .map(
            row => row.shotAdvance,
          ),
      ),

    negativeGainMagnitude:
      distribution(
        residuals
          .filter(
            row =>
              row.combinedLabel === 'NEGATIVE',
          )
          .map(
            row => -row.combinedDrop,
          ),
      ),

    reloadFieldSignals:
      summarizeReloadFields(
        residuals,
        positive,
      ),

    topPatterns:
      topPatterns(
        residuals,
      ),

    examples:
      residuals.slice(0, 250),
  };
}

function summarizeReloadFields(
  residuals,
  positive,
) {
  const fields = [
    'reloadAvailableTimeChanged',
    'lastReloadStartTimeChanged',
    'reloadQueuedStartTimeChanged',
    'canActiveReload',
    'singleShotReloadFirstBullet',
    'firedRecently',
  ];

  const result = {};

  for (const field of fields) {
    result[field] =
      compareFlag(
        residuals,
        positive,
        field,
      );
  }

  return result;
}

function compareFlag(
  residuals,
  positive,
  field,
) {
  const residualKnown =
    residuals.filter(
      row =>
        row[field] === true
        || row[field] === false,
    );

  const positiveKnown =
    positive.filter(
      row =>
        row[field] === true
        || row[field] === false,
    );

  const residualTrue =
    residualKnown.filter(
      row => row[field] === true,
    ).length;

  const positiveTrue =
    positiveKnown.filter(
      row => row[field] === true,
    ).length;

  const residualRate =
    residualKnown.length > 0
      ? residualTrue / residualKnown.length
      : null;

  const positiveRate =
    positiveKnown.length > 0
      ? positiveTrue / positiveKnown.length
      : null;

  return {
    residualKnown:
      residualKnown.length,
    positiveKnown:
      positiveKnown.length,

    residualTrue,
    positiveTrue,

    residualRate,
    positiveRate,

    riskDifference:
      residualRate !== null
      && positiveRate !== null
        ? residualRate - positiveRate
        : null,
  };
}

function groupResiduals(
  residuals,
  keyFn,
) {
  const groups =
    new Map();

  for (const row of residuals) {
    const key =
      keyFn(row);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key)
      .push(row);
  }

  return [...groups.entries()]
    .map(([key, groupRows]) => ({
      key,

      total:
        groupRows.length,

      zero:
        groupRows.filter(
          row =>
            row.combinedLabel === 'ZERO',
        ).length,

      negative:
        groupRows.filter(
          row =>
            row.combinedLabel === 'NEGATIVE',
        ).length,

      multiShotZero:
        groupRows.filter(
          row =>
            row.residualClass
            === 'MULTI_SHOT_NO_AMMO_CONSUMPTION',
        ).length,

      singleShotZero:
        groupRows.filter(
          row =>
            row.residualClass
            === 'SINGLE_SHOT_NO_AMMO_CONSUMPTION',
        ).length,

      mainGain:
        groupRows.filter(
          row =>
            row.residualClass
            === 'ATTACK_COUPLED_MAIN_AMMO_GAIN',
        ).length,

      bonusGain:
        groupRows.filter(
          row =>
            row.residualClass
            === 'ATTACK_COUPLED_BONUS_AMMO_GAIN',
        ).length,

      bothGain:
        groupRows.filter(
          row =>
            row.residualClass
            === 'ATTACK_COUPLED_MAIN_AND_BONUS_AMMO_GAIN',
        ).length,
    }))
    .sort(
      (a, b) =>
        b.total - a.total,
    );
}

function countBy(rows, keyFn) {
  const counts =
    new Map();

  for (const row of rows) {
    const key =
      keyFn(row);

    counts.set(
      key,
      (counts.get(key) ?? 0) + 1,
    );
  }

  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      count,
      rate:
        rows.length > 0
          ? count / rows.length
          : null,
    }))
    .sort(
      (a, b) =>
        b.count - a.count,
    );
}

function topPatterns(rows) {
  const counts =
    new Map();

  for (const row of rows) {
    const key =
      [
        `replay=${row.replayName}`,
        `hero=${row.heroId}`,
        `class=${row.residualClass}`,
        `shots=${row.shotAdvance}`,
        `mainDrop=${row.mainDrop}`,
        `bonusDrop=${row.bonusDrop}`,
        `combined=${row.combinedDrop}`,
        `reloadAvailChanged=${row.reloadAvailableTimeChanged}`,
        `lastReloadChanged=${row.lastReloadStartTimeChanged}`,
        `reloadQueuedChanged=${row.reloadQueuedStartTimeChanged}`,
        `canActiveReload=${row.canActiveReload}`,
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
    .sort(
      (a, b) =>
        b.count - a.count,
    )
    .slice(0, 120);
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
