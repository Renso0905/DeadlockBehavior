import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichCombinedTransition,
  summarizeCombinedAmmoRows,
  zigzagReencode,
} from '../src/player-state/combined-ammo-counter-consumed-cohort.mjs';

test('bonus uses same ZigZag encoding as main clip', () => {
  assert.equal(
    zigzagReencode(-5),
    9,
  );

  assert.equal(
    zigzagReencode(4),
    8,
  );
});

test('main-zero raw alternating bonus transition becomes one combined decrement', () => {
  const row =
    enrichCombinedTransition({
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

test('combined counter preserves ordinary main-only decrement', () => {
  const row =
    enrichCombinedTransition({
      wholeDrop: 1,
      previousBonusClip: 0,
      currentBonusClip: 0,
    });

  assert.equal(
    row.bonusLogicalDrop,
    0,
  );

  assert.equal(
    row.combinedDrop,
    1,
  );
});

test('multiple heroes can independently support the bonus ZigZag hypothesis', () => {
  const rows = [];

  for (
    const heroId
    of [13, 63, 65]
  ) {
    for (let i = 0; i < 30; i++) {
      rows.push({
        covered: true,
        carrierPresent: false,
        heroId,
        replayName: 'rep01',
        wholeDrop: 0,
        previousBonusClip:
          i % 2 === 0 ? -5 : 4,
        currentBonusClip:
          i % 2 === 0 ? 4 : -4,
        bonusClipDelta:
          i % 2 === 0 ? 9 : -8,
        shotAdvance: 1,
      });
    }
  }

  for (let i = 0; i < 1000; i++) {
    rows.push({
      covered: true,
      carrierPresent: false,
      heroId: 1,
      replayName: 'rep01',
      wholeDrop: 1,
      previousBonusClip: 0,
      currentBonusClip: 0,
      bonusClipDelta: 0,
      shotAdvance: 1,
    });
  }

  const result =
    summarizeCombinedAmmoRows(
      rows,
    );

  assert.equal(
    result.supportingHeroCount,
    3,
  );

  assert.equal(
    result.classification,
    'BONUS_CLIP_ZIGZAG_GENERALIZES_ACROSS_MULTIPLE_HEROES_IN_CONSUMED_COHORT',
  );
});

test('remaining combined residuals stay visible rather than disappearing', () => {
  const rows = [
    {
      covered: true,
      carrierPresent: false,
      heroId: 35,
      replayName: 'rep01',
      wholeDrop: -5,
      previousBonusClip: 0,
      currentBonusClip: 0,
      bonusClipDelta: 0,
      shotAdvance: 1,
    },
  ];

  const result =
    summarizeCombinedAmmoRows(
      rows,
    );

  assert.equal(
    result.combined.negative,
    1,
  );

  assert.equal(
    result.remainingResidualByHero[0].key,
    '35',
  );
});
