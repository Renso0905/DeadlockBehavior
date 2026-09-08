import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diagnoseShotTransitions,
  normalizeClipEvent,
  transformedOvershootPhase,
  zigzagReencode,
} from '../src/player-state/clip-integer-representation-diagnostic.mjs';

function rawForUnsigned(value) {
  return value % 2 === 0
    ? value / 2
    : -(value + 1) / 2;
}

function row({
  tick,
  unsignedClip,
  shotNumber,
  inReload = false,
}) {
  return normalizeClipEvent({
    tick,
    heroId: 1,
    playerKey: 'P1',
    weaponEntityIndex: 100,
    effectContextId: 'CTX',
    observedWeaponState: {
      clip: rawForUnsigned(unsignedClip),
      inReload,
      shotNumber,
      lastAttackTime: shotNumber,
      activeFireMode: 0,
    },
  });
}

test('pre-registered ZigZag re-encode maps -17 to 33 and +16 to 32', () => {
  assert.equal(zigzagReencode(-17), 33);
  assert.equal(zigzagReencode(16), 32);
});

test('ZigZag transformed clip recovers one-unit shot decrements across sign changes', () => {
  const events = [
    row({
      tick: 1,
      unsignedClip: 33,
      shotNumber: 10,
    }),
    row({
      tick: 2,
      unsignedClip: 32,
      shotNumber: 11,
    }),
    row({
      tick: 3,
      unsignedClip: 31,
      shotNumber: 12,
    }),
    row({
      tick: 4,
      unsignedClip: 30,
      shotNumber: 13,
    }),
  ];

  const result =
    diagnoseShotTransitions(events);

  assert.equal(result.observations, 3);
  assert.equal(
    result.transformed.positiveIntegerPerShotRate,
    1,
  );
  assert.equal(
    result.transformed.mode,
    1,
  );
  assert.equal(
    result.transformed.median,
    1,
  );
});

test('multi-shot serialized mutation recovers per-shot transformed consumption', () => {
  const events = [
    row({
      tick: 1,
      unsignedClip: 40,
      shotNumber: 100,
    }),
    row({
      tick: 2,
      unsignedClip: 36,
      shotNumber: 102,
    }),
  ];

  const result =
    diagnoseShotTransitions(events);

  assert.equal(result.observations, 1);
  assert.equal(
    result.rows[0]
      .transformedDropPerShot,
    2,
  );
});

test('transformed overshoot phase distinguishes inherited pre-reload state', () => {
  const events = [
    row({
      tick: 1,
      unsignedClip: 33,
      shotNumber: 1,
    }),
    row({
      tick: 2,
      unsignedClip: 32,
      shotNumber: 2,
    }),
    row({
      tick: 3,
      unsignedClip: 20,
      shotNumber: 2,
      inReload: true,
    }),
    row({
      tick: 4,
      unsignedClip: 24,
      shotNumber: 2,
      inReload: false,
    }),
    row({
      tick: 5,
      unsignedClip: 23,
      shotNumber: 3,
    }),
  ];

  const result =
    transformedOvershootPhase(
      {
        contextKey: 'P1|100|CTX|0',
        heroId: 1,
        transformedCandidate: 24,
      },
      events,
    );

  assert.equal(result.overshoots, 2);
  assert.equal(result.beforeFirstReload, 2);
  assert.equal(result.atOrAfterFirstReload, 0);
});

test('raw representation itself is not a monotonic shot counter across alternating sign', () => {
  const events = [
    row({
      tick: 1,
      unsignedClip: 33,
      shotNumber: 1,
    }),
    row({
      tick: 2,
      unsignedClip: 32,
      shotNumber: 2,
    }),
  ];

  const result =
    diagnoseShotTransitions(events);

  assert.equal(
    result.rows[0].previousRawClip,
    -17,
  );
  assert.equal(
    result.rows[0].currentRawClip,
    16,
  );
  assert.equal(
    result.rows[0].rawDrop,
    -33,
  );
  assert.equal(
    result.rows[0].transformedDrop,
    1,
  );
});
