import test from 'node:test';
import assert from 'node:assert/strict';

import {
  characterizeNegativeResidual,
  characterizeZeroResidual,
  inferIntegerCapacity,
  summarizeFractionCoherence,
} from '../src/player-state/ammo-fraction-coherence-diagnostic.mjs';

test('settled fraction recovers integer capacity from logical main minus one', () => {
  assert.equal(
    inferIntegerCapacity(
      19,
      18 / 29,
    ),
    29,
  );
});

test('zero residual identifies one-unit fraction prediction and rollback', () => {
  const row = {
    heroId: 31,
    tick: 100,
    previous: {
      logicalMain: 19,
      logicalBonus: 1,
      ammoFraction: 18 / 29,
    },
    current: {
      logicalMain: 19,
      logicalBonus: 1,
      ammoFraction: 17 / 29,
      shotNumber: 10,
    },
    neighborhood: [
      {
        tick: 100,
        logicalMain: 19,
        ammoFraction: 17 / 29,
        shotNumber: 10,
      },
      {
        tick: 101,
        logicalMain: 19,
        ammoFraction: 18 / 29,
        shotNumber: 10,
      },
    ],
  };

  const result =
    characterizeZeroResidual(row);

  assert.equal(
    result.previousCapacity,
    29,
  );

  assert.ok(
    Math.abs(
      result.previousStep - 1,
    ) < 1e-5,
  );

  assert.equal(
    result.immediateRollback,
    true,
  );

  assert.equal(
    result.signature,
    'ONE_UNIT_FRACTION_PREDICTION_WITH_IMMEDIATE_ROLLBACK',
  );
});

test('coherent ammo gain moves whole and normalized fraction by same units', () => {
  const row = {
    heroId: 25,
    tick: 200,
    previous: {
      logicalMain: 25,
      ammoFraction: 24 / 37,
    },
    current: {
      logicalMain: 37,
      ammoFraction: 36 / 37,
    },
  };

  const result =
    characterizeNegativeResidual(row);

  assert.equal(
    result.stableCapacity,
    true,
  );

  assert.equal(
    result.logicalGain,
    12,
  );

  assert.ok(
    Math.abs(
      result.fractionGainUnits - 12,
    ) < 1e-5,
  );

  assert.equal(
    result.coherentNetGain,
    true,
  );

  assert.equal(
    result.grossRestorationIfOneShotConsumed,
    13,
  );
});

test('fraction mismatch does not invent coherent gain', () => {
  const row = {
    previous: {
      logicalMain: 25,
      ammoFraction: 24 / 37,
    },
    current: {
      logicalMain: 37,
      ammoFraction: 30 / 37,
    },
  };

  const result =
    characterizeNegativeResidual(row);

  assert.equal(
    result.coherentNetGain,
    false,
  );
});

test('summary separates rollback-style zeros from coherent gains', () => {
  const zero = {
    residualClass: 'ZERO_CONSUMPTION',
    heroId: 31,
    tick: 100,
    previous: {
      logicalMain: 19,
      logicalBonus: 1,
      ammoFraction: 18 / 29,
    },
    current: {
      logicalMain: 19,
      logicalBonus: 1,
      ammoFraction: 17 / 29,
      shotNumber: 10,
    },
    neighborhood: [
      {
        tick: 100,
        logicalMain: 19,
        ammoFraction: 17 / 29,
        shotNumber: 10,
      },
      {
        tick: 101,
        logicalMain: 19,
        ammoFraction: 18 / 29,
        shotNumber: 10,
      },
    ],
  };

  const gain = {
    residualClass:
      'ATTACK_COUPLED_AMMO_GAIN',
    heroId: 25,
    tick: 200,
    previous: {
      logicalMain: 25,
      ammoFraction: 24 / 37,
    },
    current: {
      logicalMain: 37,
      ammoFraction: 36 / 37,
    },
  };

  const rows = [
    ...Array.from(
      { length: 11 },
      () => structuredClone(zero),
    ),
    {
      ...structuredClone(zero),
      current: {
        ...zero.current,
        ammoFraction:
          zero.previous.ammoFraction,
      },
      neighborhood: [],
    },
    ...Array.from(
      { length: 8 },
      () => structuredClone(gain),
    ),
  ];

  const result =
    summarizeFractionCoherence(rows);

  assert.equal(
    result.zero.total,
    12,
  );

  assert.equal(
    result.negative.total,
    8,
  );

  assert.equal(
    result.classification,
    'RESIDUALS_SPLIT_INTO_FRACTION_PREDICTION_ROLLBACK_AND_COHERENT_AMMO_RESTORATION',
  );
});
