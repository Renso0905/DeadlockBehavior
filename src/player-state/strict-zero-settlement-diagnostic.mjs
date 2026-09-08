// Script193 helpers.
//
// Diagnostic-only question on test.dem:
// Are strict carrier-absent combined-counter ZERO attacks followed by a
// short-horizon ammo decrement while shotNumber remains unchanged?
//
// This tests serialization/settlement timing before introducing a new
// gameplay-mechanic hypothesis.
//
// Frozen combined counter:
//   ZigZag(m_iClip) + ZigZag(m_iBonusClip)

export const ZERO_SETTLEMENT_HORIZONS = Object.freeze([
  1,
  2,
  4,
  8,
]);

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function combinedLogicalAmmo(row) {
  const main =
    zigzagReencode(row.rawClip);

  const bonus =
    zigzagReencode(row.bonusClip);

  return (
    Number.isFinite(main)
    && Number.isFinite(bonus)
  )
    ? main + bonus
    : null;
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

export function deriveStrictAttackTransitionsWithIndex(groups) {
  const transitions = [];

  for (
    const [weaponKey, rows]
    of groups.entries()
  ) {
    const settled =
      coalesceFinalPerTick(rows);

    for (let i = 1; i < settled.length; i++) {
      const previous =
        settled[i - 1];

      const current =
        settled[i];

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
        currentIndex: i,

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
        previousAmmo,
        currentAmmo,
        combinedDrop,

        combinedLabel:
          combinedDrop > 0
            ? 'POSITIVE'
            : combinedDrop < 0
              ? 'NEGATIVE'
              : 'ZERO',

        previousAmmoFraction:
          previous.ammoFraction,

        currentAmmoFraction:
          current.ammoFraction,

        ammoFractionChangedAtAttack:
          changedFinite(
            previous.ammoFraction,
            current.ammoFraction,
          ),
      });
    }
  }

  return transitions;
}

export function inspectShortHorizonSettlement(
  transition,
  maxTicks = 8,
) {
  const {
    settled,
    currentIndex,
    currentAmmo,
  } = transition;

  const current =
    settled[currentIndex];

  const details = [];

  for (
    let i = currentIndex + 1;
    i < settled.length;
    i++
  ) {
    const future =
      settled[i];

    const tickDelay =
      future.tick - current.tick;

    if (tickDelay > maxTicks) {
      break;
    }

    if (
      future.inReload === true
      || (
        Number.isFinite(future.shotNumber)
        && Number.isFinite(current.shotNumber)
        && future.shotNumber
          !== current.shotNumber
      )
    ) {
      break;
    }

    const futureAmmo =
      combinedLogicalAmmo(future);

    if (!Number.isFinite(futureAmmo)) {
      continue;
    }

    const settledDrop =
      currentAmmo - futureAmmo;

    const ammoFractionChanged =
      changedFinite(
        current.ammoFraction,
        future.ammoFraction,
      );

    details.push({
      tick:
        future.tick,
      tickDelay,
      futureAmmo,
      settledDrop,
      ammoFractionChanged,
      futureAmmoFraction:
        future.ammoFraction,
    });
  }

  const firstPositive =
    details.find(
      row => row.settledDrop > 0,
    ) ?? null;

  const firstNegative =
    details.find(
      row => row.settledDrop < 0,
    ) ?? null;

  const firstFractionChange =
    details.find(
      row =>
        row.ammoFractionChanged === true,
    ) ?? null;

  return {
    details,

    settledPositive:
      firstPositive !== null,

    firstPositiveDelay:
      firstPositive?.tickDelay ?? null,

    settledDrop:
      firstPositive?.settledDrop ?? null,

    settledNegative:
      firstNegative !== null,

    firstNegativeDelay:
      firstNegative?.tickDelay ?? null,

    ammoFractionChangedAfterAttack:
      firstFractionChange !== null,

    firstAmmoFractionChangeDelay:
      firstFractionChange?.tickDelay ?? null,
  };
}

export function summarizeZeroSettlements(
  rows,
  horizons =
    ZERO_SETTLEMENT_HORIZONS,
) {
  const zeros =
    rows.filter(
      row =>
        row.primaryCovered === true
        && row.primaryPresent === false
        && row.combinedLabel === 'ZERO',
    );

  const positives =
    rows.filter(
      row =>
        row.primaryCovered === true
        && row.primaryPresent === false
        && row.combinedLabel === 'POSITIVE',
    );

  const inspected =
    zeros.map(row => ({
      ...row,
      settlement:
        inspectShortHorizonSettlement(
          row,
          Math.max(...horizons),
        ),
    }));

  const byHorizon = {};

  for (const horizon of horizons) {
    const resolved =
      inspected.filter(
        row =>
          row.settlement.details.some(
            detail =>
              detail.tickDelay <= horizon
              && detail.settledDrop > 0,
          ),
      );

    byHorizon[String(horizon)] = {
      horizonTicks:
        horizon,
      resolved:
        resolved.length,
      resolutionRate:
        inspected.length > 0
          ? resolved.length / inspected.length
          : null,
    };
  }

  const attackFractionChanged =
    inspected.filter(
      row =>
        row.ammoFractionChangedAtAttack === true,
    ).length;

  const futureFractionChanged =
    inspected.filter(
      row =>
        row.settlement
          .ammoFractionChangedAfterAttack === true,
    ).length;

  return {
    zeroSamples:
      inspected.length,

    positiveControls:
      positives.length,

    byHorizon,

    anyPositiveSettlement:
      inspected.filter(
        row =>
          row.settlement
            .settledPositive === true,
      ).length,

    anyPositiveSettlementRate:
      inspected.length > 0
        ? inspected.filter(
          row =>
            row.settlement
              .settledPositive === true,
        ).length / inspected.length
        : null,

    attackAmmoFractionChanged:
      attackFractionChanged,

    attackAmmoFractionChangedRate:
      inspected.length > 0
        ? attackFractionChanged / inspected.length
        : null,

    futureAmmoFractionChanged:
      futureFractionChanged,

    futureAmmoFractionChangedRate:
      inspected.length > 0
        ? futureFractionChanged / inspected.length
        : null,

    positiveControlAmmoFractionChangedAtAttack:
      positives.filter(
        row =>
          row.ammoFractionChangedAtAttack === true,
      ).length,

    positiveControlAmmoFractionChangedRate:
      positives.length > 0
        ? positives.filter(
          row =>
            row.ammoFractionChangedAtAttack === true,
        ).length / positives.length
        : null,

    byHero:
      summarizeByHero(inspected),

    delayDistribution:
      distribution(
        inspected
          .map(
            row =>
              row.settlement
                .firstPositiveDelay,
          )
          .filter(Number.isFinite),
      ),

    settlementDropDistribution:
      distribution(
        inspected
          .map(
            row =>
              row.settlement
                .settledDrop,
          )
          .filter(Number.isFinite),
      ),

    examples:
      inspected.slice(0, 150),

    classification:
      inspected.length > 0
      && inspected.filter(
        row =>
          row.settlement
            .settledPositive === true,
      ).length
        / inspected.length >= 0.50
        ? 'SHORT_HORIZON_SETTLEMENT_EXPLAINS_SUBSTANTIAL_STRICT_ZEROS'
        : 'SHORT_HORIZON_SETTLEMENT_DOES_NOT_EXPLAIN_MOST_STRICT_ZEROS',
  };
}

function summarizeByHero(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key =
      String(row.heroId);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([heroId, heroRows]) => {
      const settled =
        heroRows.filter(
          row =>
            row.settlement
              .settledPositive === true,
        ).length;

      const attackFraction =
        heroRows.filter(
          row =>
            row.ammoFractionChangedAtAttack === true,
        ).length;

      return {
        heroId,
        zero:
          heroRows.length,
        settled,
        settlementRate:
          heroRows.length > 0
            ? settled / heroRows.length
            : null,
        attackFractionChanged:
          attackFraction,
        attackFractionChangedRate:
          heroRows.length > 0
            ? attackFraction / heroRows.length
            : null,
      };
    })
    .sort(
      (a, b) =>
        b.zero - a.zero,
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
