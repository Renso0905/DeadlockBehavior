import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coalesceFinalStatePerTick,
  diagnoseFractionalShotTransitions,
  normalizeFractionEvent,
  zigzagReencode,
} from '../src/player-state/clip-fractional-consumption-diagnostic.mjs';

function rawForWhole(value) {
  return value % 2 === 0
    ? value / 2
    : -(value + 1) / 2;
}

function row({
  sourceIndex,
  tick,
  whole,
  fraction,
  shotNumber,
  inReload = false,
  burstShotsRemaining = 0,
}) {
  return normalizeFractionEvent({
    tick,
    playerKey: 'P1',
    heroId: 1,
    weaponEntityIndex: 100,
    effectContextId: 'CTX',
    observedWeaponState: {
      clip: rawForWhole(whole),
      ammoFraction: fraction,
      shotNumber,
      inReload,
      activeFireMode: 0,
      burstShotsRemaining,
      continuousShots: shotNumber,
      lastAttackTime: shotNumber,
    },
  }, sourceIndex);
}

test('ZigZag whole transform remains frozen', () => {
  assert.equal(zigzagReencode(-17), 33);
  assert.equal(zigzagReencode(16), 32);
});

test('whole minus ammoFraction resolves fractional consumption when fraction tracks amount consumed', () => {
  const events = [
    row({
      sourceIndex: 0,
      tick: 1,
      whole: 10,
      fraction: 0.0,
      shotNumber: 1,
    }),
    row({
      sourceIndex: 1,
      tick: 2,
      whole: 10,
      fraction: 0.5,
      shotNumber: 2,
    }),
    row({
      sourceIndex: 2,
      tick: 3,
      whole: 9,
      fraction: 0.0,
      shotNumber: 3,
    }),
  ];

  const result =
    diagnoseFractionalShotTransitions(events);

  assert.equal(result.whole.zero, 1);
  assert.equal(
    result.zeroWholeResolution.minus.positiveRate,
    1,
  );
  assert.equal(
    result.zeroWholeResolution.plus.negativeRate,
    1,
  );
});

test('whole plus ammoFraction resolves fractional consumption when fraction tracks remaining subunit', () => {
  const events = [
    row({
      sourceIndex: 0,
      tick: 1,
      whole: 10,
      fraction: 0.5,
      shotNumber: 1,
    }),
    row({
      sourceIndex: 1,
      tick: 2,
      whole: 10,
      fraction: 0.0,
      shotNumber: 2,
    }),
    row({
      sourceIndex: 2,
      tick: 3,
      whole: 9,
      fraction: 0.5,
      shotNumber: 3,
    }),
  ];

  const result =
    diagnoseFractionalShotTransitions(events);

  assert.equal(result.whole.zero, 1);
  assert.equal(
    result.zeroWholeResolution.plus.positiveRate,
    1,
  );
  assert.equal(
    result.zeroWholeResolution.minus.negativeRate,
    1,
  );
});

test('tick coalescing preserves final fractional state', () => {
  const events = [
    row({
      sourceIndex: 0,
      tick: 10,
      whole: 8,
      fraction: 0.0,
      shotNumber: 1,
    }),
    row({
      sourceIndex: 1,
      tick: 11,
      whole: 8,
      fraction: 0.0,
      shotNumber: 2,
    }),
    row({
      sourceIndex: 2,
      tick: 11,
      whole: 8,
      fraction: 0.25,
      shotNumber: 2,
    }),
  ];

  const settled =
    coalesceFinalStatePerTick(events);

  assert.equal(settled.length, 2);
  assert.equal(settled[1].ammoFraction, 0.25);
  assert.equal(settled[1].shotNumber, 2);
});

test('reload transitions are excluded from fractional shot consumption', () => {
  const events = [
    row({
      sourceIndex: 0,
      tick: 20,
      whole: 2,
      fraction: 0,
      shotNumber: 5,
      inReload: true,
    }),
    row({
      sourceIndex: 1,
      tick: 21,
      whole: 10,
      fraction: 0,
      shotNumber: 5,
      inReload: false,
    }),
  ];

  const result =
    diagnoseFractionalShotTransitions(events);

  assert.equal(result.observations, 0);
});
