import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FRACTION_TOLERANCE_V03,
  characterizeNegativeResidualV03,
  characterizeZeroResidualV03,
  inferIntegerCapacityV03,
  summarizeFractionCoherenceV03,
} from '../src/player-state/ammo-fraction-coherence-diagnostic-v03.mjs';

test('float32 Hero31 fixture resolves capacity 29', () => {
  assert.equal(
    inferIntegerCapacityV03(
      19,
      0.6206896305084229,
    ),
    29,
  );
});

test('float32 Warden fixture resolves capacity 37', () => {
  assert.equal(
    inferIntegerCapacityV03(
      25,
      0.6486486196517944,
    ),
    37,
  );
});

test('zero step cannot receive one-unit signature', () => {
  const row =
    characterizeZeroResidualV03({
      heroId: 25,
      tick: 174961,
      previous: {
        logicalMain: 43,
        logicalBonus: 1,
        ammoFraction: 0.9767441749572754,
      },
      current: {
        logicalMain: 43,
        logicalBonus: 1,
        ammoFraction: 0.9767441749572754,
        shotNumber: 3926,
      },
      neighborhood: [],
    });

  assert.equal(row.capacity, 43);
  assert.equal(row.stepUnits, 0);
  assert.equal(row.oneUnitStep, false);
  assert.equal(row.signature, 'ZERO_RESIDUAL_OTHER');
  assert.equal(
    row.selfConsistency.tolerance,
    FRACTION_TOLERANCE_V03,
  );
});

test('Hero31 tick5806 full float fixture is one-unit with rollback', () => {
  const row =
    characterizeZeroResidualV03({
      heroId: 31,
      tick: 5806,
      previous: {
        logicalMain: 19,
        logicalBonus: 1,
        ammoFraction: 0.6206896305084229,
      },
      current: {
        logicalMain: 19,
        logicalBonus: 1,
        ammoFraction: 0.5862069129943848,
        shotNumber: 57,
      },
      neighborhood: [
        {
          tick: 5807,
          logicalMain: 19,
          ammoFraction: 0.6206896305084229,
          shotNumber: 57,
        },
      ],
    });

  assert.equal(row.capacity, 29);
  assert.equal(row.oneUnitStep, true);
  assert.equal(row.rollback, true);
});

test('Warden tick85449 full float fixture is coherent +12 gain', () => {
  const row =
    characterizeNegativeResidualV03({
      heroId: 25,
      tick: 85449,
      previous: {
        logicalMain: 25,
        ammoFraction: 0.6486486196517944,
      },
      current: {
        logicalMain: 37,
        ammoFraction: 0.9729729890823364,
      },
    });

  assert.equal(row.previousCapacity, 37);
  assert.equal(row.currentCapacity, 37);
  assert.equal(row.logicalGain, 12);
  assert.equal(row.coherentGain, true);
  assert.equal(row.grossRestorationIfOneShotConsumed, 13);
});

test('summary callback does not leak Array.map index into tolerance', () => {
  const fixture = {
    residualClass: 'ZERO_CONSUMPTION',
    heroId: 31,
    tick: 5806,
    previous: {
      logicalMain: 19,
      logicalBonus: 1,
      ammoFraction: 0.6206896305084229,
    },
    current: {
      logicalMain: 19,
      logicalBonus: 1,
      ammoFraction: 0.5862069129943848,
      shotNumber: 57,
    },
    neighborhood: [
      {
        tick: 5807,
        logicalMain: 19,
        ammoFraction: 0.6206896305084229,
        shotNumber: 57,
      },
    ],
  };

  const zeroOther = {
    residualClass: 'ZERO_CONSUMPTION',
    heroId: 25,
    tick: 174961,
    previous: {
      logicalMain: 43,
      logicalBonus: 1,
      ammoFraction: 0.9767441749572754,
    },
    current: {
      logicalMain: 43,
      logicalBonus: 1,
      ammoFraction: 0.9767441749572754,
      shotNumber: 3926,
    },
    neighborhood: [],
  };

  // Put the zero-step row at index 10. Under V02's bug, tolerance=10
  // would incorrectly classify step=0 as "one unit".
  const rows = [
    fixture,
    ...Array.from(
      { length: 9 },
      (_, i) => ({
        ...structuredClone(fixture),
        tick: 6000 + i,
      }),
    ),
    zeroOther,
  ];

  const result =
    summarizeFractionCoherenceV03(
      rows,
    );

  assert.equal(
    result.callbackIntegrity.toleranceLeakCount,
    0,
  );

  assert.deepEqual(
    result.callbackIntegrity.observedTolerances,
    [FRACTION_TOLERANCE_V03],
  );

  const row =
    result.zero.rows.find(
      candidate =>
        candidate.tick === 174961,
    );

  assert.equal(row.stepUnits, 0);
  assert.equal(row.oneUnitStep, false);
  assert.equal(row.signature, 'ZERO_RESIDUAL_OTHER');
});
