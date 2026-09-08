import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichBonusLogicalTransition,
  evaluateBonusZigzag,
  zigzagReencode,
} from '../src/player-state/bonus-clip-zigzag-diagnostic.mjs';

test('bonus counter uses the same frozen ZigZag mapping', () => {
  assert.equal(
    zigzagReencode(-5),
    9,
  );

  assert.equal(
    zigzagReencode(4),
    8,
  );

  assert.equal(
    zigzagReencode(-4),
    7,
  );

  assert.equal(
    zigzagReencode(3),
    6,
  );
});

test('odd-positive raw delta can be one logical bonus decrement', () => {
  const row =
    enrichBonusLogicalTransition({
      wholeDrop: 0,
      previousBonusClip: -5,
      currentBonusClip: 4,
    });

  assert.equal(
    row.bonusLogicalDrop,
    1,
  );

  assert.equal(
    row.combinedDrop,
    1,
  );
});

test('even-negative raw delta can also be one logical bonus decrement', () => {
  const row =
    enrichBonusLogicalTransition({
      wholeDrop: 0,
      previousBonusClip: 4,
      currentBonusClip: -4,
    });

  assert.equal(
    row.bonusLogicalDrop,
    1,
  );

  assert.equal(
    row.combinedDrop,
    1,
  );
});

test('main and bonus logical drops compose additively by transition', () => {
  const row =
    enrichBonusLogicalTransition({
      wholeDrop: 1,
      previousBonusClip: -5,
      currentBonusClip: 4,
    });

  assert.equal(
    row.bonusLogicalDrop,
    1,
  );

  assert.equal(
    row.combinedDrop,
    2,
  );
});

test('strong logical bonus counter passes synthetic diagnostic gates', () => {
  const rows = [];

  for (let i = 0; i < 40; i++) {
    rows.push({
      covered: true,
      carrierPresent: false,
      heroId: 13,
      shotAdvance: 1,
      wholeDrop: 0,
      previousBonusClip:
        i % 2 === 0 ? -5 : 4,
      currentBonusClip:
        i % 2 === 0 ? 4 : -4,
      bonusClipDelta:
        i % 2 === 0 ? 9 : -8,
    });
  }

  for (let i = 0; i < 6000; i++) {
    rows.push({
      covered: true,
      carrierPresent: false,
      heroId: 1,
      shotAdvance: 1,
      wholeDrop: 1,
      previousBonusClip: 0,
      currentBonusClip: 0,
      bonusClipDelta: 0,
    });
  }

  const result =
    evaluateBonusZigzag(
      rows,
      {
        minCarrierAbsentTransitions: 5000,
        minBonusChangingTransitions: 30,
        minMainZeroBonusChangingTransitions: 20,
        minBonusLogicalPositiveRate: 0.95,
        minBonusLogicalOneUnitRate: 0.90,
        minCombinedPositiveRate: 0.99,
        maxCombinedNegativeRate: 0.001,
      },
    );

  assert.equal(
    result.sufficientlyPowered,
    true,
  );

  assert.equal(
    result.strongCandidate,
    true,
  );

  assert.equal(
    result.classification,
    'BONUS_CLIP_ZIGZAG_IS_STRONG_SECOND_LOGICAL_AMMO_COUNTER_CANDIDATE',
  );
});
