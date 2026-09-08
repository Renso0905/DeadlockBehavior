import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachEventsToCandidateContexts,
  candidateContextMap,
  diagnoseContextCeiling,
  diagnoseFiringClipDecrements,
  diagnoseReloadExitSettlement,
  extractStaticAmmoProfiles,
  normalizeSemanticWeaponEvent,
  summarizeMagazineSemantics,
} from '../src/player-state/magazine-capacity-semantics.mjs';

function row({
  tick,
  clip,
  inReload = false,
  shotNumber = 0,
  lastAttackTime = 0,
  heroId = 1,
  playerKey = 'P1',
  weaponEntityIndex = 100,
  effectContextId = 'CTX',
}) {
  return normalizeSemanticWeaponEvent({
    tick,
    heroId,
    playerKey,
    weaponEntityIndex,
    effectContextId,
    observedWeaponState: {
      clip,
      bonusClip: 0,
      ammoFraction: 0,
      inReload,
      shotNumber,
      lastAttackTime,
      activeFireMode: 0,
    },
  });
}

test('candidate context map retains only primary eligible calibrated contexts', () => {
  const map = candidateContextMap({
    evaluation: {
      contexts: [
        {
          contextKey: 'P1|100|CTX|0',
          heroId: 1,
          playerKey: 'P1',
          weaponEntityIndex: 100,
          effectContextId: 'CTX',
          activeFireMode: 0,
          primaryEligible: true,
          candidateCapacity: 12,
          completionLikeReloads: 8,
          contextPass: true,
        },
        {
          contextKey: 'P2|200|CTX|0',
          primaryEligible: false,
          candidateCapacity: 20,
        },
      ],
    },
  });

  assert.equal(map.size, 1);
  assert.equal(
    map.get('P1|100|CTX|0').candidateCapacity,
    12,
  );
});

test('candidate equal to maximum observed clip is an exact empirical ceiling', () => {
  const context = {
    contextKey: 'P1|100|CTX|0',
    heroId: 1,
    candidateCapacity: 12,
    events: [
      row({ tick: 1, clip: 4 }),
      row({ tick: 2, clip: 12 }),
      row({ tick: 3, clip: 11 }),
    ],
  };

  const diagnostic =
    diagnoseContextCeiling(context);

  assert.equal(diagnostic.maxObservedClip, 12);
  assert.equal(diagnostic.exactCeiling, true);
  assert.equal(diagnostic.overshoots, 0);
});

test('short-horizon clip increase without new shot is detected as reload-exit settlement', () => {
  const context = {
    events: [
      row({
        tick: 10,
        clip: 2,
        inReload: true,
        shotNumber: 5,
        lastAttackTime: 1,
      }),
      row({
        tick: 11,
        clip: 10,
        inReload: false,
        shotNumber: 5,
        lastAttackTime: 1,
      }),
      row({
        tick: 12,
        clip: 12,
        inReload: false,
        shotNumber: 5,
        lastAttackTime: 1,
      }),
      row({
        tick: 13,
        clip: 11,
        inReload: false,
        shotNumber: 6,
        lastAttackTime: 2,
      }),
    ],
  };

  const diagnostic =
    diagnoseReloadExitSettlement(context, 4);

  assert.equal(diagnostic.comparable, 1);
  assert.equal(
    diagnostic.increasedWithoutShot,
    1,
  );
});

test('firing clip decrement mode is derived only from observed attack advances', () => {
  const context = {
    events: [
      row({
        tick: 1,
        clip: 12,
        shotNumber: 1,
        lastAttackTime: 1,
      }),
      row({
        tick: 2,
        clip: 10,
        shotNumber: 2,
        lastAttackTime: 2,
      }),
      row({
        tick: 3,
        clip: 8,
        shotNumber: 3,
        lastAttackTime: 3,
      }),
      row({
        tick: 4,
        clip: 6,
        shotNumber: 4,
        lastAttackTime: 4,
      }),
    ],
  };

  const diagnostic =
    diagnoseFiringClipDecrements(context);

  assert.equal(diagnostic.modeDecrement, 2);
  assert.equal(diagnostic.modeDominance, 1);
});

test('static ammo profile keeps clip size and ammo consumed per shot separate', () => {
  const profiles = extractStaticAmmoProfiles({
    weapons: [
      {
        heroId: 2,
        displayName: 'Seven',
        fields: {
          m_iClipSize: 29,
          m_iAmmoConsumedPerShot: 2,
        },
      },
    ],
  });

  assert.equal(
    profiles.get(2).staticClipSize,
    29,
  );
  assert.equal(
    profiles.get(2).ammoConsumedPerShot,
    2,
  );
});

test('aggregate semantic classification requires ceiling stability and no reload-exit upward phase', () => {
  const candidates = new Map();

  for (let i = 0; i < 30; i++) {
    const key = `P${i}|${100 + i}|CTX|0`;

    candidates.set(key, {
      contextKey: key,
      heroId: 1,
      playerKey: `P${i}`,
      weaponEntityIndex: 100 + i,
      effectContextId: 'CTX',
      activeFireMode: 0,
      candidateCapacity: 12,
      completionLikeReloads: 10,
      contextPass: true,
    });
  }

  const events = [];

  for (const candidate of candidates.values()) {
    events.push(
      normalizeSemanticWeaponEvent({
        tick: 1,
        heroId: candidate.heroId,
        playerKey: candidate.playerKey,
        weaponEntityIndex:
          candidate.weaponEntityIndex,
        effectContextId:
          candidate.effectContextId,
        observedWeaponState: {
          clip: 2,
          inReload: true,
          shotNumber: 1,
          lastAttackTime: 1,
          activeFireMode: 0,
        },
      }),
    );

    events.push(
      normalizeSemanticWeaponEvent({
        tick: 2,
        heroId: candidate.heroId,
        playerKey: candidate.playerKey,
        weaponEntityIndex:
          candidate.weaponEntityIndex,
        effectContextId:
          candidate.effectContextId,
        observedWeaponState: {
          clip: 12,
          inReload: false,
          shotNumber: 1,
          lastAttackTime: 1,
          activeFireMode: 0,
        },
      }),
    );
  }

  const grouped =
    attachEventsToCandidateContexts(
      events,
      candidates,
    );

  const result =
    summarizeMagazineSemantics(
      grouped,
      new Map(),
    );

  assert.equal(
    result.summary.contextCeilingAgreementRate,
    1,
  );
  assert.equal(
    result.summary.reloadExitUpwardSettlementRate,
    0,
  );
  assert.equal(
    result.classification,
    'RELOAD_EXIT_PLATEAU_SUPPORTED_AS_OBSERVED_RUNTIME_CLIP_CEILING_STATIC_MAPPING_UNRESOLVED',
  );
});
