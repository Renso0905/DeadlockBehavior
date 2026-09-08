import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyBatching,
  decomposeBatchedCycles,
  summarizeCycles,
  summarizePartition,
} from '../src/player-state/hero58-clip-batching-diagnostic.mjs';

test('twenty zero shot advances followed by a seven-unit drop yields near-3 ratio cycle', () => {
  const rows = [];

  for (let i = 0; i < 20; i++) {
    rows.push({
      previousTick: i,
      currentTick: i + 1,
      shotAdvance: 1,
      wholeDrop: 0,
      wholeSign: 'ZERO',
    });
  }

  rows.push({
    previousTick: 20,
    currentTick: 21,
    shotAdvance: 1,
    wholeDrop: 7,
    wholeSign: 'POSITIVE',
  });

  const cycles = decomposeBatchedCycles(rows);

  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].zeroShotAdvance, 20);
  assert.equal(cycles[0].positiveWholeDrop, 7);
  assert.equal(cycles[0].totalShotAdvance, 21);
  assert.equal(cycles[0].shotAdvancePerWholeUnit, 3);
});

test('cycle summary identifies batched positive whole drops', () => {
  const cycles = Array.from(
    { length: 120 },
    (_, index) => ({
      zeroShotAdvance: 20 + (index % 2),
      positiveTransitionShotAdvance: 1,
      totalShotAdvance: 21 + (index % 2),
      positiveWholeDrop: 7,
      shotAdvancePerWholeUnit:
        (21 + (index % 2)) / 7,
    }),
  );

  const summary = summarizeCycles(cycles, 3.013);

  assert.equal(summary.completedCycles, 120);
  assert.equal(summary.positiveWholeDrop.mode, 7);
  assert.equal(summary.batchedPositiveDropRate, 1);
  assert.ok(
    summary.closeToFrozenAggregateRatioRate >= 0.8,
  );
});

test('generic partition can be strong while hero58 remains distinct', () => {
  const generic = [
    ...Array.from({ length: 970 }, () => ({
      wholeSign: 'POSITIVE',
      shotAdvance: 1,
      wholeDrop: 1,
    })),
    ...Array.from({ length: 25 }, () => ({
      wholeSign: 'ZERO',
      shotAdvance: 1,
      wholeDrop: 0,
    })),
    ...Array.from({ length: 5 }, () => ({
      wholeSign: 'NEGATIVE',
      shotAdvance: 1,
      wholeDrop: -1,
    })),
  ];

  const summary = summarizePartition(generic);

  assert.equal(summary.total, 1000);
  assert.equal(summary.positiveRate, 0.97);
  assert.equal(summary.zeroRate, 0.025);
  assert.equal(summary.negativeRate, 0.005);
});

test('strong generic scope plus stable hero58 batching yields explicit classification', () => {
  const classification = classifyBatching({
    genericPartition: {
      total: 27785,
      positiveRate: 0.975,
      negativeRate: 0.001,
    },
    hero58Partition: {
      total: 9786,
      zeroRate: 0.668,
    },
    cycleSummary: {
      completedCycles: 500,
      batchedPositiveDropRate: 0.95,
      closeToFrozenAggregateRatioRate: 0.90,
    },
  });

  assert.equal(
    classification,
    'GENERIC_ZIGZAG_CLIP_COUNTER_STRONG_OUTSIDE_HERO58_HERO58_UPDATES_IN_BATCHED_MULTI_UNIT_STEPS',
  );
});

test('hero58 distinct behavior without stable batching remains diagnostic-only', () => {
  const classification = classifyBatching({
    genericPartition: {
      total: 27785,
      positiveRate: 0.975,
      negativeRate: 0.001,
    },
    hero58Partition: {
      total: 9786,
      zeroRate: 0.668,
    },
    cycleSummary: {
      completedCycles: 500,
      batchedPositiveDropRate: 0.5,
      closeToFrozenAggregateRatioRate: 0.5,
    },
  });

  assert.equal(
    classification,
    'GENERIC_ZIGZAG_CLIP_COUNTER_STRONG_OUTSIDE_HERO58_HERO58_BATCH_MECHANISM_REQUIRES_DIAGNOSIS',
  );
});
