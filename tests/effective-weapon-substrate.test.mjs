import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWeaponEffectContext,
  clipCapacityDiagnostic,
  compareObservedWeaponState,
  classifyReloadTransition,
} from '../src/player-state/effective-weapon-substrate.mjs';

test('discharge signal remains observed telemetry rather than inferred item behavior', () => {
  const signal = compareObservedWeaponState(
    { shotNumber: 5, lastAttackTime: 10, clip: 20, firedRecently: false },
    { shotNumber: 6, lastAttackTime: 10.1, nextPrimaryAttack: 10.3, clip: 19, firedRecently: true }
  );
  assert.equal(signal.actualDischargeSignal, true);
  assert.equal(signal.shotNumberDelta, 1);
  assert.equal(signal.clipDelta, -1);
  assert.ok(Math.abs(signal.readyDelayCandidateSeconds - 0.2) < 1e-9);
});

test('weapon effect context separates direct item effects from unresolved non-direct semantics', () => {
  const state = {
    identity: { heroId: 7 },
    authoritativeOwnership: {
      standardShopItems: [{ itemId: 1, recordKey: 'upgrade_test' }],
      permanentWorldBuffs: { fire_rate: { totalValue: 4, inferredUnits: 2, rows: [] }, health_max: { totalValue: 30, rows: [] } },
      activeBridgeBuffs: [{ intervalId: 'b1', recordKey: 'gun_powerup_pickup', startTick: 100, stateEndTick: 200 }],
    },
  };
  const effects = new Map([['upgrade_test', {
    weaponStateRelevant: {
      hasMechanicEffectEvidence: true,
      directProvidedStats: [{ providedPropertyType: 'MODIFIER_VALUE_FIRE_RATE', numericValue: 10, value: '10' }],
      nonDirectModifierTokens: ['MODIFIER_VALUE_WEAPON_DAMAGE'],
      operation: { hasEffectEvidence: true },
      damageOrPower: { hasEffectEvidence: true },
    },
  }]]);
  const context = buildWeaponEffectContext(state, effects);
  assert.equal(context.itemInputs.length, 1);
  assert.equal(context.itemInputs[0].semanticClass, 'MIXED_DIRECT_AND_OR_NON_DIRECT_EFFECT_INPUT');
  assert.deepEqual(Object.keys(context.permanentWeaponBuffs), ['fire_rate']);
  assert.equal(context.gunBridge.length, 1);
});

test('clip capacity diagnostic uses observed PlayerState max ammo without inventing a formula', () => {
  assert.deepEqual(
    clipCapacityDiagnostic({ clip: 31, bonusClip: 2 }, { observedRuntime: { maxAmmo: 30 } }),
    { comparable: true, withinObservedCapacity: true, capacityCeiling: 32 }
  );
});

test('reload transition classifier preserves enter/exit semantics', () => {
  assert.equal(classifyReloadTransition({ inReload: false, clip: 0 }, { inReload: true, clip: 0 }), 'RELOAD_ENTER');
  assert.equal(classifyReloadTransition({ inReload: true, clip: 0 }, { inReload: false, clip: 30 }), 'RELOAD_EXIT');
});

test('weapon events join to latest integrated state without future leakage', async () => {
  const { joinWeaponEventsToIntegratedState } = await import('../src/player-state/effective-weapon-substrate.mjs');
  const player = {
    playerKey: 'P',
    events: [
      { tick: 10, playerKey: 'P', observedRuntime: { maxAmmo: 20 } },
      { tick: 30, playerKey: 'P', observedRuntime: { maxAmmo: 25 } },
    ],
  };
  const joined = joinWeaponEventsToIntegratedState([{ tick: 20 }, { tick: 29 }, { tick: 30 }], player);
  assert.equal(joined[0].integratedPlayerState.observedRuntime.maxAmmo, 20);
  assert.equal(joined[1].integratedPlayerState.observedRuntime.maxAmmo, 20);
  assert.equal(joined[2].integratedPlayerState.observedRuntime.maxAmmo, 25);
});
