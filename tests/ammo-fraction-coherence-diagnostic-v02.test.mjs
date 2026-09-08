import test from 'node:test';
import assert from 'node:assert/strict';

import {
  characterizeNegativeResidualV02,
  characterizeZeroResidualV02,
  inferIntegerCapacityV02,
  summarizeFractionCoherenceV02,
} from '../src/player-state/ammo-fraction-coherence-diagnostic-v02.mjs';

test('float32 hero31 fixture resolves capacity 29', () => {
  assert.equal(
    inferIntegerCapacityV02(
      19,
      0.6206896305084229,
    ),
    29,
  );
});

test('float32 Warden fixture resolves capacity 37', () => {
  assert.equal(
    inferIntegerCapacityV02(
      25,
      0.6486486196517944,
    ),
    37,
  );
});

test('zero step cannot receive a one-unit signature', () => {
  const result =
    characterizeZeroResidualV02({
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

  assert.ok(
    Math.abs(result.stepUnits) <= 1e-4,
  );
  assert.equal(
    result.oneUnitStep,
    false,
  );
  assert.equal(
    result.signature,
    'ZERO_RESIDUAL_OTHER',
  );
});

test('one-unit float32 decrement remains one-unit', () => {
  const result =
    characterizeZeroResidualV02({
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

  assert.equal(
    result.capacity,
    29,
  );
  assert.equal(
    result.oneUnitStep,
    true,
  );
  assert.equal(
    result.rollback,
    true,
  );
});

test('coherent Warden gain fixture resolves whole and fraction together', () => {
  const result =
    characterizeNegativeResidualV02({
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

  assert.equal(
    result.previousCapacity,
    37,
  );
  assert.equal(
    result.currentCapacity,
    37,
  );
  assert.equal(
    result.coherentGain,
    true,
  );
  assert.equal(
    result.grossRestorationIfOneShotConsumed,
    13,
  );
});

test('summary rejects any impossible signature/boolean mismatch', () => {
  const rows = [
    {
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
    },
  ];

  const result =
    summarizeFractionCoherenceV02(rows);

  assert.equal(
    result.zero.inconsistent,
    0,
  );
});
