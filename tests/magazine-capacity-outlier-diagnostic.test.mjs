import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyOvershootEvent,
  diagnoseCeilingOutlier,
  observedPerShotClipConsumption,
  normalizeOutlierEvent,
} from '../src/player-state/magazine-capacity-outlier-diagnostic.mjs';

function row({
  tick,
  clip,
  bonusClip = 0,
  inReload = false,
  shotNumber = 0,
  lastAttackTime = 0,
}) {
  return normalizeOutlierEvent({
    tick,
    heroId: 1,
    playerKey: 'P1',
    weaponEntityIndex: 100,
    effectContextId: 'CTX',
    observedWeaponState: {
      clip,
      bonusClip,
      ammoFraction: 0,
      inReload,
      shotNumber,
      lastAttackTime,
      activeFireMode: 0,
    },
  });
}

test('non-reload clip increase without a shot is classified explicitly', () => {
  const previous = row({
    tick: 1,
    clip: 10,
    shotNumber: 5,
    lastAttackTime: 1,
  });

  const current = row({
    tick: 2,
    clip: 12,
    shotNumber: 5,
    lastAttackTime: 1,
  });

  assert.equal(
    classifyOvershootEvent({
      previous,
      current,
      clipDelta: 2,
      bonusClipDelta: 0,
      shotAdvance: 0,
      lastAttackAdvance: 0,
    }),
    'NON_RELOAD_NO_SHOT_CLIP_INCREASE',
  );
});

test('bonus clip increase is separated from generic no-shot clip increase', () => {
  const previous = row({
    tick: 1,
    clip: 10,
    bonusClip: 0,
  });

  const current = row({
    tick: 2,
    clip: 14,
    bonusClip: 4,
  });

  assert.equal(
    classifyOvershootEvent({
      previous,
      current,
      clipDelta: 4,
      bonusClipDelta: 4,
      shotAdvance: 0,
      lastAttackAdvance: 0,
    }),
    'CLIP_AND_BONUS_CLIP_INCREASE',
  );
});

test('reload exit above candidate is classified before generic clip increase', () => {
  const previous = row({
    tick: 1,
    clip: 2,
    inReload: true,
  });

  const current = row({
    tick: 2,
    clip: 14,
    inReload: false,
  });

  assert.equal(
    classifyOvershootEvent({
      previous,
      current,
      clipDelta: 12,
      bonusClipDelta: 0,
      shotAdvance: 0,
      lastAttackAdvance: 0,
    }),
    'RELOAD_EXIT_ABOVE_CANDIDATE',
  );
});

test('ceiling outlier diagnostic recovers exact above-candidate event', () => {
  const events = [
    row({ tick: 1, clip: 5 }),
    row({ tick: 2, clip: 10 }),
    row({ tick: 3, clip: 12 }),
    row({ tick: 4, clip: 9 }),
  ];

  const result =
    diagnoseCeilingOutlier(
      {
        contextKey: 'P1|100|CTX|0',
        heroId: 1,
        candidateCapacity: 10,
        maxObservedClip: 12,
        overshoots: 1,
      },
      events,
    );

  assert.equal(
    result.overshootEventCount,
    1,
  );
  assert.equal(
    result.overshootEvents[0].clip,
    12,
  );
});

test('per-shot clip consumption divides multi-shot mutation by shot-number advance', () => {
  const events = [
    row({
      tick: 1,
      clip: 20,
      shotNumber: 10,
      lastAttackTime: 1,
    }),
    row({
      tick: 2,
      clip: 16,
      shotNumber: 14,
      lastAttackTime: 2,
    }),
    row({
      tick: 3,
      clip: 13,
      shotNumber: 17,
      lastAttackTime: 3,
    }),
  ];

  const diagnostic =
    observedPerShotClipConsumption(
      events,
    );

  assert.equal(
    diagnostic.observations,
    2,
  );
  assert.equal(
    diagnostic.modePerShotClipDrop,
    1,
  );
  assert.equal(
    diagnostic.modeDominance,
    1,
  );
  assert.equal(
    diagnostic.medianPerShotClipDrop,
    1,
  );
});

test('per-shot diagnostic ignores reload transitions', () => {
  const events = [
    row({
      tick: 1,
      clip: 2,
      inReload: true,
      shotNumber: 10,
    }),
    row({
      tick: 2,
      clip: 12,
      inReload: false,
      shotNumber: 10,
    }),
  ];

  const diagnostic =
    observedPerShotClipConsumption(
      events,
    );

  assert.equal(
    diagnostic.observations,
    0,
  );
});
