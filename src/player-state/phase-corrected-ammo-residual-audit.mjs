// Script197 helpers.
//
// Exact descriptive audit of the tiny residual set that remains on test.dem
// after:
//   - strict weapon chronology
//   - ZigZag(m_iClip) + ZigZag(m_iBonusClip)
//   - frozen primary slide carrier
//   - exact same-tick present->absent phase correction
//
// No new semantic rule is formed here.

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function combinedLogicalAmmo(row) {
  const main = zigzagReencode(row.rawClip);
  const bonus = zigzagReencode(row.bonusClip);

  if (
    !Number.isFinite(main)
    || !Number.isFinite(bonus)
  ) {
    return null;
  }

  return main + bonus;
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

export function buildChronologicalAttackTransitions(groups) {
  const transitions = [];

  for (
    const [weaponKey, rows]
    of groups.entries()
  ) {
    const settled =
      coalesceFinalPerTick(rows);

    for (
      let currentIndex = 1;
      currentIndex < settled.length;
      currentIndex++
    ) {
      const previous =
        settled[currentIndex - 1];

      const current =
        settled[currentIndex];

      if (
        previous.inReload === true
        || current.inReload === true
        || !Number.isFinite(previous.shotNumber)
        || !Number.isFinite(current.shotNumber)
      ) {
        continue;
      }

      const previousAmmo =
        combinedLogicalAmmo(previous);

      const currentAmmo =
        combinedLogicalAmmo(current);

      if (
        !Number.isFinite(previousAmmo)
        || !Number.isFinite(currentAmmo)
      ) {
        continue;
      }

      const shotAdvance =
        current.shotNumber
        - previous.shotNumber;

      if (shotAdvance <= 0) {
        continue;
      }

      const combinedDrop =
        previousAmmo - currentAmmo;

      transitions.push({
        weaponKey,
        settled,
        currentIndex,

        tick:
          current.tick,

        previousTick:
          previous.tick,

        tickGap:
          current.tick - previous.tick,

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

        previousAmmo,
        currentAmmo,
        combinedDrop,

        combinedLabel:
          combinedDrop > 0
            ? 'POSITIVE'
            : combinedDrop < 0
              ? 'NEGATIVE'
              : 'ZERO',

        previous:
          compactWeaponState(previous),

        current:
          compactWeaponState(current),
      });
    }
  }

  return transitions;
}

export function phaseCorrectedCarrierPresent(row) {
  return (
    row.primaryPresent === true
    || row.exactExitAtAttack === true
  );
}

export function auditPhaseCorrectedResiduals(
  rows,
  {
    neighborhoodRadius = 4,
    reloadWindowTicks = 64,
  } = {},
) {
  const correctedAbsent =
    rows.filter(
      row =>
        row.primaryCovered === true
        && phaseCorrectedCarrierPresent(row) === false,
    );

  const residuals =
    correctedAbsent.filter(
      row =>
        row.combinedLabel === 'ZERO'
        || row.combinedLabel === 'NEGATIVE',
    );

  const audited =
    residuals.map(row => {
      const neighborhood =
        buildNeighborhood(
          row.settled,
          row.currentIndex,
          neighborhoodRadius,
        );

      const currentTick =
        row.tick;

      const nearbyReload =
        neighborhood.some(
          state =>
            state.inReload === true
            && Math.abs(
              state.tick - currentTick,
            ) <= reloadWindowTicks,
        );

      const nearbyReloadStartChange =
        neighborhood.some(
          (state, index) => {
            if (index === 0) return false;

            const prior =
              neighborhood[index - 1];

            return (
              Number.isFinite(
                prior.lastReloadStartTime,
              )
              && Number.isFinite(
                state.lastReloadStartTime,
              )
              && prior.lastReloadStartTime
                !== state.lastReloadStartTime
            );
          },
        );

      const nearbyEffectContextChange =
        neighborhood.some(
          (state, index) => {
            if (index === 0) return false;
            const prior = neighborhood[index - 1];
            return (
              prior.effectContextId
              !== state.effectContextId
            );
          },
        );

      const nearbyFireModeChange =
        neighborhood.some(
          (state, index) => {
            if (index === 0) return false;
            const prior = neighborhood[index - 1];
            return (
              prior.activeFireMode
              !== state.activeFireMode
            );
          },
        );

      const ammoFractionChangedAtAttack =
        changedFinite(
          row.previous?.ammoFraction,
          row.current?.ammoFraction,
        );

      return {
        replayName:
          row.replayName ?? 'test',

        tick:
          row.tick,

        previousTick:
          row.previousTick,

        tickGap:
          row.tickGap,

        heroId:
          row.heroId,

        playerKey:
          row.playerKey,

        weaponEntityIndex:
          row.weaponEntityIndex,

        effectContextId:
          row.effectContextId,

        activeFireMode:
          row.activeFireMode,

        shotAdvance:
          row.shotAdvance,

        combinedDrop:
          row.combinedDrop,

        residualClass:
          row.combinedLabel === 'ZERO'
            ? 'ZERO_CONSUMPTION'
            : 'ATTACK_COUPLED_AMMO_GAIN',

        ammoGainMagnitude:
          row.combinedLabel === 'NEGATIVE'
            ? -row.combinedDrop
            : 0,

        primaryPresent:
          row.primaryPresent,

        exactExitAtAttack:
          row.exactExitAtAttack,

        ticksSinceExit:
          row.ticksSinceExit ?? null,

        lastCarrierTransition:
          row.lastCarrierTransition ?? null,

        ammoFractionChangedAtAttack,

        nearbyReload,

        nearbyReloadStartChange,

        nearbyEffectContextChange,

        nearbyFireModeChange,

        previous:
          row.previous,

        current:
          row.current,

        neighborhood,
      };
    });

  const zeroRows =
    audited.filter(
      row =>
        row.residualClass
        === 'ZERO_CONSUMPTION',
    );

  const negativeRows =
    audited.filter(
      row =>
        row.residualClass
        === 'ATTACK_COUPLED_AMMO_GAIN',
    );

  return {
    correctedAbsent:
      correctedAbsent.length,

    residual:
      audited.length,

    zero:
      zeroRows.length,

    negative:
      negativeRows.length,

    zeroByHero:
      groupCount(
        zeroRows,
        row => String(row.heroId),
      ),

    negativeByHero:
      groupCount(
        negativeRows,
        row => String(row.heroId),
      ),

    zeroByContext:
      groupCount(
        zeroRows,
        row =>
          `${row.heroId}|${row.effectContextId}`,
      ),

    negativeByContext:
      groupCount(
        negativeRows,
        row =>
          `${row.heroId}|${row.effectContextId}`,
      ),

    negativeGainDistribution:
      distribution(
        negativeRows.map(
          row => row.ammoGainMagnitude,
        ),
      ),

    featureSummary: {
      zero: summarizeFlags(zeroRows),
      negative: summarizeFlags(negativeRows),
    },

    exactRows:
      audited,

    classification:
      'PHASE_CORRECTED_AMMO_RESIDUALS_EXACTLY_AUDITED',
  };
}

export function compactWeaponState(row) {
  return {
    tick:
      row.tick,

    sourceIndex:
      row.sourceIndex,

    heroId:
      row.heroId,

    playerKey:
      row.playerKey,

    weaponEntityIndex:
      row.weaponEntityIndex,

    effectContextId:
      row.effectContextId,

    activeFireMode:
      row.activeFireMode,

    shotNumber:
      row.shotNumber,

    continuousShots:
      row.continuousShots ?? null,

    burstRemaining:
      row.burstRemaining ?? null,

    rawClip:
      row.rawClip,

    bonusClip:
      row.bonusClip,

    logicalMain:
      zigzagReencode(
        row.rawClip,
      ),

    logicalBonus:
      zigzagReencode(
        row.bonusClip,
      ),

    combinedAmmo:
      combinedLogicalAmmo(row),

    ammoFraction:
      row.ammoFraction ?? null,

    inReload:
      row.inReload,

    reloadAvailableTime:
      row.reloadAvailableTime ?? null,

    lastReloadStartTime:
      row.lastReloadStartTime ?? null,

    reloadQueuedStartTime:
      row.reloadQueuedStartTime ?? null,

    lastAttackTime:
      row.lastAttackTime ?? null,

    nextPrimaryAttack:
      row.nextPrimaryAttack ?? null,

    firedRecently:
      row.firedRecently ?? null,
  };
}

function buildNeighborhood(
  settled,
  currentIndex,
  radius,
) {
  const start =
    Math.max(
      0,
      currentIndex - radius,
    );

  const end =
    Math.min(
      settled.length,
      currentIndex + radius + 1,
    );

  return settled
    .slice(start, end)
    .map(
      compactWeaponState,
    );
}

function summarizeFlags(rows) {
  const total = rows.length;

  const count =
    predicate =>
      rows.filter(predicate).length;

  const metric =
    predicate => {
      const trueCount =
        count(predicate);

      return {
        count:
          trueCount,

        rate:
          total > 0
            ? trueCount / total
            : null,
      };
    };

  return {
    total,

    ammoFractionChangedAtAttack:
      metric(
        row =>
          row.ammoFractionChangedAtAttack
          === true,
      ),

    nearbyReload:
      metric(
        row =>
          row.nearbyReload === true,
      ),

    nearbyReloadStartChange:
      metric(
        row =>
          row.nearbyReloadStartChange
          === true,
      ),

    nearbyEffectContextChange:
      metric(
        row =>
          row.nearbyEffectContextChange
          === true,
      ),

    nearbyFireModeChange:
      metric(
        row =>
          row.nearbyFireModeChange
          === true,
      ),
  };
}

function groupCount(rows, keyFn) {
  const counts =
    new Map();

  for (const row of rows) {
    const key = keyFn(row);

    counts.set(
      key,
      (counts.get(key) ?? 0) + 1,
    );
  }

  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count
        || a.key.localeCompare(b.key),
    );
}

function changedFinite(a, b) {
  return (
    Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) > 1e-9
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
