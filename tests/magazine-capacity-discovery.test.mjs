import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStaticWeaponProfiles,
  discoverReloadEpisodes,
  evaluateMagazineContext,
  findHeroClipScalingIds,
  normalizeWeaponEvent,
  uniqueMode,
} from '../src/player-state/magazine-capacity-discovery.mjs';

function event({
  tick,
  heroId = 1,
  weaponEntityIndex = 100,
  effectContextId = 'ctx',
  fireMode = 0,
  clip,
  bonusClip = 0,
  ammoFrac = 0,
  inReload,
}) {
  return normalizeWeaponEvent({
    tick,
    heroId,
    weaponEntityIndex,
    effectContextId,
    observed: {
      m_eActiveFireMode: fireMode,
      m_iClip: clip,
      m_iBonusClip: bonusClip,
      m_flAmmoFrac: ammoFrac,
      m_bInReload: inReload,
    },
  });
}

function buildMagazineReloadSeries({
  terminalClips,
  startClip = 2,
  heroId = 1,
}) {
  const rows = [];
  let tick = 0;

  for (const terminalClip of terminalClips) {
    rows.push(event({
      tick: tick++,
      heroId,
      clip: startClip,
      inReload: false,
    }));

    rows.push(event({
      tick: tick++,
      heroId,
      clip: startClip,
      inReload: true,
    }));

    rows.push(event({
      tick: tick++,
      heroId,
      clip: terminalClip,
      inReload: false,
    }));

    rows.push(event({
      tick: tick++,
      heroId,
      clip: Math.max(0, terminalClip - 1),
      inReload: false,
    }));
  }

  return rows;
}

test('reload-exit calibration plateau predicts held-out magazine exits', () => {
  const profiles = new Map([
    [1, {
      heroId: 1,
      staticClipSize: 10,
      reloadSingleBullets: false,
    }],
  ]);

  const rows = buildMagazineReloadSeries({
    terminalClips: [12, 12, 12, 12, 12, 12, 12, 12],
  });

  const discovery = discoverReloadEpisodes(
    rows,
    profiles,
    new Set(),
  );

  const result = evaluateMagazineContext(
    discovery.contexts[0],
  );

  assert.equal(result.primaryEligible, true);
  assert.equal(result.candidateCapacity, 12);
  assert.equal(result.holdoutExactAgreementRate, 1);
  assert.equal(result.postCalibrationOvershootRate, 0);
  assert.equal(result.contextPass, true);
});

test('reload exit without clip gain is not completion-like evidence', () => {
  const profiles = new Map([
    [1, {
      heroId: 1,
      staticClipSize: 10,
      reloadSingleBullets: false,
    }],
  ]);

  const rows = [
    event({ tick: 0, clip: 5, inReload: false }),
    event({ tick: 1, clip: 5, inReload: true }),
    event({ tick: 2, clip: 5, inReload: false }),
  ];

  const discovery = discoverReloadEpisodes(
    rows,
    profiles,
    new Set(),
  );

  assert.equal(discovery.allReloadExits.length, 1);
  assert.equal(
    discovery.allReloadExits[0].completionLike,
    false,
  );
});

test('static single-bullet reload weapon is excluded from primary plateau gate', () => {
  const profiles = new Map([
    [1, {
      heroId: 1,
      staticClipSize: 8,
      reloadSingleBullets: true,
    }],
  ]);

  const rows = buildMagazineReloadSeries({
    terminalClips: [8, 8, 8, 8, 8, 8],
  });

  const discovery = discoverReloadEpisodes(
    rows,
    profiles,
    new Set(),
  );

  const result = evaluateMagazineContext(
    discovery.contexts[0],
  );

  assert.equal(result.primaryEligible, false);
  assert.equal(
    result.exclusionReason,
    'STATIC_SINGLE_BULLET_RELOAD',
  );
});

test('Script131 EClipSize scaling hero is excluded from primary plateau gate', () => {
  const script131 = {
    heroes: [
      {
        heroId: 13,
        scalingStats: [
          {
            recordKey: 'EClipSize',
            scalingStat: 'ETechPower',
            scale: 0.5,
          },
        ],
      },
    ],
  };

  const ids = findHeroClipScalingIds(script131);
  assert.equal(ids.has(13), true);

  const profiles = new Map([
    [13, {
      heroId: 13,
      staticClipSize: 40,
      reloadSingleBullets: false,
    }],
  ]);

  const rows = buildMagazineReloadSeries({
    heroId: 13,
    terminalClips: [40, 40, 40, 40, 40, 40],
  });

  const discovery = discoverReloadEpisodes(
    rows,
    profiles,
    ids,
  );

  const result = evaluateMagazineContext(
    discovery.contexts[0],
  );

  assert.equal(result.primaryEligible, false);
  assert.equal(
    result.exclusionReason,
    'SCRIPT131_ECLIPSIZE_SCALING_HERO',
  );
});

test('post-calibration clip overshoot blocks a plateau capacity candidate', () => {
  const profiles = new Map([
    [1, {
      heroId: 1,
      staticClipSize: 10,
      reloadSingleBullets: false,
    }],
  ]);

  const rows = buildMagazineReloadSeries({
    terminalClips: [10, 10, 10, 10, 10, 10],
  });

  rows.push(
    event({
      tick: 1000,
      clip: 12,
      inReload: false,
    }),
  );

  const discovery = discoverReloadEpisodes(
    rows,
    profiles,
    new Set(),
  );

  const result = evaluateMagazineContext(
    discovery.contexts[0],
  );

  assert.equal(result.candidateCapacity, 10);
  assert.ok(result.postCalibrationOvershootRate > 0);
  assert.equal(result.contextPass, false);
});

test('uniqueMode refuses an exact tie instead of inventing a plateau', () => {
  assert.equal(
    uniqueMode([10, 10, 12, 12]),
    null,
  );
});

test('static weapon profile extraction finds clip size and single-bullet reload flag', () => {
  const profiles = buildStaticWeaponProfiles({
    weaponProfiles: [
      {
        heroId: 25,
        displayName: 'Warden',
        fields: {
          m_iClipSize: 17,
          m_bReloadSingleBullets: false,
        },
      },
    ],
  });

  assert.equal(
    profiles.get(25).staticClipSize,
    17,
  );
  assert.equal(
    profiles.get(25).reloadSingleBullets,
    false,
  );
});
