import test from 'node:test';
import assert from 'node:assert/strict';

import {
  discoverReloadEpisodes,
  evaluateMagazineContext,
  normalizeWeaponEvent,
} from '../src/player-state/magazine-capacity-discovery-v02.mjs';

function script161Row({
  tick,
  heroId = 1,
  playerKey = 'P1',
  weaponEntityIndex = 100,
  effectContextId = 'CTX_A',
  clip,
  bonusClip = 0,
  ammoFraction = 0,
  inReload,
  activeFireMode = 0,
}) {
  return {
    schemaVersion: 1,
    replay: 'test',
    tick,
    demoSeconds: tick / 64,
    playerKey,
    heroId,
    weaponEntityIndex,
    weaponClass: 'CCitadel_Ability_PrimaryWeapon',
    weaponSubclassId: 123,
    changedFields: [],
    observedWeaponState: {
      subclassId: 123,
      clip,
      bonusClip,
      ammoFraction,
      inReload,
      shotNumber: 0,
      continuousShots: 0,
      burstShotsRemaining: 0,
      lastAttackTime: 0,
      nextPrimaryAttack: 0,
      nextAttackDelayStart: 0,
      nextAttackDelayEnd: 0,
      reloadAvailableTime: 0,
      lastReloadStartTime: 0,
      reloadQueuedStartTime: 0,
      firedRecently: false,
      activeFireMode,
    },
    transition: {},
    integratedStateTick: tick,
    observedPlayerWeaponContext: {
      level: 1,
      alive: true,
      maxAmmo: 0,
    },
    effectContextId,
  };
}

test('V02 adapter reads exact Script161 observedWeaponState serialization', () => {
  const normalized = normalizeWeaponEvent(
    script161Row({
      tick: 100,
      clip: 17,
      bonusClip: 3,
      ammoFraction: 0.25,
      inReload: true,
      activeFireMode: 2,
    }),
  );

  assert.equal(normalized.tick, 100);
  assert.equal(normalized.heroId, 1);
  assert.equal(normalized.playerKey, 'P1');
  assert.equal(normalized.weaponEntityIndex, 100);
  assert.equal(normalized.effectContextId, 'CTX_A');

  assert.equal(normalized.clip, 17);
  assert.equal(normalized.bonusClip, 3);
  assert.equal(normalized.ammoFrac, 0.25);
  assert.equal(normalized.inReload, true);
  assert.equal(normalized.activeFireMode, 2);
});

test('V02 adapter discovers reload exits from exact Script161 rows', () => {
  const profiles = new Map([
    [1, {
      heroId: 1,
      staticClipSize: 10,
      reloadSingleBullets: false,
    }],
  ]);

  const rows = [];
  let tick = 0;

  for (let i = 0; i < 8; i++) {
    rows.push(normalizeWeaponEvent(script161Row({
      tick: tick++,
      clip: 2,
      inReload: false,
    }), rows.length));

    rows.push(normalizeWeaponEvent(script161Row({
      tick: tick++,
      clip: 2,
      inReload: true,
    }), rows.length));

    rows.push(normalizeWeaponEvent(script161Row({
      tick: tick++,
      clip: 12,
      inReload: false,
    }), rows.length));

    rows.push(normalizeWeaponEvent(script161Row({
      tick: tick++,
      clip: 11,
      inReload: false,
    }), rows.length));
  }

  const discovery = discoverReloadEpisodes(
    rows,
    profiles,
    new Set(),
  );

  assert.equal(discovery.allReloadExits.length, 8);
  assert.equal(
    discovery.allReloadExits.filter(row => row.completionLike).length,
    8,
  );

  const context = discovery.contexts.find(
    row => row.completionLikeReloadExits.length === 8,
  );

  const result = evaluateMagazineContext(context);

  assert.equal(result.candidateCapacity, 12);
  assert.equal(result.holdoutExactAgreementRate, 1);
  assert.equal(result.contextPass, true);
});

test('V02 still accepts raw Source2 aliases used by synthetic V01 tests', () => {
  const normalized = normalizeWeaponEvent({
    tick: 1,
    heroId: 2,
    weaponEntityIndex: 200,
    effectContextId: 'CTX',
    observed: {
      m_iClip: 9,
      m_iBonusClip: 1,
      m_flAmmoFrac: 0.5,
      m_bInReload: false,
      m_eActiveFireMode: 1,
    },
  });

  assert.equal(normalized.clip, 9);
  assert.equal(normalized.bonusClip, 1);
  assert.equal(normalized.ammoFrac, 0.5);
  assert.equal(normalized.inReload, false);
  assert.equal(normalized.activeFireMode, 1);
});
