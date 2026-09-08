import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyResidual,
  enrichCombinedTransition,
  summarizeResidualProvenance,
} from '../src/player-state/ammo-residual-provenance-diagnostic.mjs';

test('main and bonus ZigZag components compose into positive consumption', () => {
  const row =
    enrichCombinedTransition({
      previousRawClip: -5,
      currentRawClip: 4,
      previousBonusClip: 0,
      currentBonusClip: 0,
    });

  assert.equal(row.mainDrop, 1);
  assert.equal(row.bonusDrop, 0);
  assert.equal(row.combinedDrop, 1);
  assert.equal(row.combinedLabel, 'POSITIVE');
});

test('single-shot zero is classified as suppressed consumption', () => {
  const row = {
    combinedLabel: 'ZERO',
    shotAdvance: 1,
  };

  assert.equal(
    classifyResidual(row),
    'SINGLE_SHOT_NO_AMMO_CONSUMPTION',
  );
});

test('multi-shot zero remains separate from single-shot suppression', () => {
  const row = {
    combinedLabel: 'ZERO',
    shotAdvance: 8,
  };

  assert.equal(
    classifyResidual(row),
    'MULTI_SHOT_NO_AMMO_CONSUMPTION',
  );
});

test('negative main drop is classified as attack-coupled main ammo gain', () => {
  const row = {
    combinedLabel: 'NEGATIVE',
    mainDrop: -10,
    bonusDrop: 0,
  };

  assert.equal(
    classifyResidual(row),
    'ATTACK_COUPLED_MAIN_AMMO_GAIN',
  );
});

test('summary preserves zero and negative residual provenance separately', () => {
  const rows = [
    {
      covered: true,
      carrierPresent: false,
      replayName: 'rep01',
      heroId: 35,
      effectContextId: 'ctx',
      shotAdvance: 8,
      previousRawClip: 5,
      currentRawClip: 5,
      previousBonusClip: 0,
      currentBonusClip: 0,
      reloadAvailableTimeChanged: false,
      lastReloadStartTimeChanged: false,
      reloadQueuedStartTimeChanged: false,
      canActiveReload: false,
      singleShotReloadFirstBullet: false,
      firedRecently: true,
    },
    {
      covered: true,
      carrierPresent: false,
      replayName: 'rep01',
      heroId: 27,
      effectContextId: 'ctx',
      shotAdvance: 2,
      previousRawClip: 5,
      currentRawClip: 10,
      previousBonusClip: 0,
      currentBonusClip: 0,
      reloadAvailableTimeChanged: false,
      lastReloadStartTimeChanged: false,
      reloadQueuedStartTimeChanged: false,
      canActiveReload: false,
      singleShotReloadFirstBullet: false,
      firedRecently: true,
    },
  ];

  const result =
    summarizeResidualProvenance(rows);

  assert.equal(result.residual, 2);
  assert.equal(
    result.classes.find(
      row =>
        row.key === 'MULTI_SHOT_NO_AMMO_CONSUMPTION',
    ).count,
    1,
  );
  assert.equal(
    result.classes.find(
      row =>
        row.key === 'ATTACK_COUPLED_MAIN_AMMO_GAIN',
    ).count,
    1,
  );
});
