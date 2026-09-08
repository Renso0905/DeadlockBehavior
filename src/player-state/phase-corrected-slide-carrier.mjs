// Script196 helpers.
//
// Frozen candidate attack-tick phase rule from Scripts194-195:
//
//   phaseCorrectedCarrierPresent =
//     currentCarrierPresent
//     OR exact present->absent transition on the attack tick
//
// This is deliberately NOT a +/- tick grace window.
// It is a same-tick pre-transition phase hypothesis only.

export function phaseCorrectedCarrierPresent({
  currentCarrierPresent,
  exactExitAtAttack,
}) {
  return (
    currentCarrierPresent === true
    || exactExitAtAttack === true
  );
}

export function summarizePhaseCorrectedCarrier(rows) {
  const evaluable =
    rows.filter(
      row => row.primaryCovered === true,
    );

  const rawAbsent =
    evaluable.filter(
      row => row.primaryPresent === false,
    );

  const correctedAbsent =
    evaluable.filter(
      row =>
        phaseCorrectedCarrierPresent({
          currentCarrierPresent:
            row.primaryPresent,
          exactExitAtAttack:
            row.exactExitAtAttack,
        }) === false,
    );

  const exactExitRows =
    rawAbsent.filter(
      row => row.exactExitAtAttack === true,
    );

  const exactExitZero =
    exactExitRows.filter(
      row => row.combinedLabel === 'ZERO',
    );

  const exactExitPositive =
    exactExitRows.filter(
      row => row.combinedLabel === 'POSITIVE',
    );

  const exactExitNegative =
    exactExitRows.filter(
      row => row.combinedLabel === 'NEGATIVE',
    );

  const rawPartition =
    partition(rawAbsent);

  const correctedPartition =
    partition(correctedAbsent);

  const remainingZeros =
    correctedAbsent.filter(
      row => row.combinedLabel === 'ZERO',
    );

  const remainingNegatives =
    correctedAbsent.filter(
      row => row.combinedLabel === 'NEGATIVE',
    );

  return {
    evaluable:
      evaluable.length,

    rawAbsent:
      rawAbsent.length,

    correctedAbsent:
      correctedAbsent.length,

    exactExit: {
      total:
        exactExitRows.length,
      zero:
        exactExitZero.length,
      positive:
        exactExitPositive.length,
      negative:
        exactExitNegative.length,

      pZeroGivenExactExit:
        exactExitRows.length > 0
          ? exactExitZero.length
            / exactExitRows.length
          : null,

      zeroRecallAmongRawAbsentZeros:
        rawPartition.zero > 0
          ? exactExitZero.length
            / rawPartition.zero
          : null,
    },

    rawPartition,
    correctedPartition,

    residualReduction:
      rawPartition.residual > 0
        ? 1 - (
          correctedPartition.residual
          / rawPartition.residual
        )
        : null,

    zeroReduction:
      rawPartition.zero > 0
        ? 1 - (
          correctedPartition.zero
          / rawPartition.zero
        )
        : null,

    remainingZeros:
      remainingZeros.map(
        compactRow,
      ),

    remainingNegatives:
      remainingNegatives.map(
        compactRow,
      ),

    remainingZerosByHero:
      groupByHero(
        remainingZeros,
      ),

    remainingNegativesByHero:
      groupByHero(
        remainingNegatives,
      ),

    classification:
      (
        exactExitRows.length >= 20
        && exactExitPositive.length === 0
        && exactExitNegative.length === 0
        && exactExitZero.length
          / exactExitRows.length >= 0.99
        && exactExitZero.length
          / Math.max(1, rawPartition.zero)
          >= 0.75
      )
        ? 'PRE_TRANSITION_CARRIER_ATTACK_TICK_PHASE_RULE_STRONGLY_SUPPORTED_ON_TEST'
        : 'PRE_TRANSITION_CARRIER_ATTACK_TICK_PHASE_RULE_REMAINS_UNRESOLVED',
  };
}

function partition(rows) {
  const positive =
    rows.filter(
      row => row.combinedLabel === 'POSITIVE',
    ).length;

  const zero =
    rows.filter(
      row => row.combinedLabel === 'ZERO',
    ).length;

  const negative =
    rows.filter(
      row => row.combinedLabel === 'NEGATIVE',
    ).length;

  const total =
    positive + zero + negative;

  return {
    total,
    positive,
    zero,
    negative,
    residual:
      zero + negative,

    positiveRate:
      total > 0 ? positive / total : null,

    zeroRate:
      total > 0 ? zero / total : null,

    negativeRate:
      total > 0 ? negative / total : null,
  };
}

function compactRow(row) {
  return {
    tick:
      row.tick,
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
    tickGap:
      row.tickGap,
    shotAdvance:
      row.shotAdvance,
    combinedDrop:
      row.combinedDrop,
    ammoFractionChangedAtAttack:
      row.ammoFractionChangedAtAttack ?? null,
    ticksSinceExit:
      row.ticksSinceExit ?? null,
    lastCarrierTransition:
      row.lastCarrierTransition ?? null,
  };
}

function groupByHero(rows) {
  const groups =
    new Map();

  for (const row of rows) {
    const key =
      String(row.heroId);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([heroId, heroRows]) => ({
      heroId,
      count:
        heroRows.length,
    }))
    .sort(
      (a, b) =>
        b.count - a.count,
    );
}
