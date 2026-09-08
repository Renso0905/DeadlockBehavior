import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFireRateContext,
  classifyFireRateContextChange,
  buildDischargeSegments,
  buildAdjacentFireRateTransitions,
} from '../src/player-state/effective-weapon-fire-rate-context.mjs';

test('extracts direct, permanent, and Gun bridge fire-rate inputs without composing them', () => {
  const context = extractFireRateContext({
    itemInputs: [{ recordKey: 'item_a', directProvidedStats: [{ providedPropertyType: 'FireRateBonus', numericValue: 12 }], nonDirectModifierTokens: [] }],
    permanentWeaponBuffs: { fire_rate: { totalValue: 2, inferredUnits: 1 } },
    gunBridge: [{ recordKey: 'gun_powerup_pickup' }],
  });
  assert.equal(context.directNumericInputs.length, 1);
  assert.equal(context.permanentFireRate.length, 1);
  assert.equal(context.gunBridgeActive, true);
});

test('positive fire-rate input change predicts shorter ready delay', () => {
  const before = extractFireRateContext({ itemInputs: [], permanentWeaponBuffs: {}, gunBridge: [] });
  const after = extractFireRateContext({ itemInputs: [{ recordKey: 'item_a', directProvidedStats: [{ providedPropertyType: 'FireRateBonus', numericValue: 10 }], nonDirectModifierTokens: [] }], permanentWeaponBuffs: {}, gunBridge: [] });
  const change = classifyFireRateContextChange(before, after);
  assert.equal(change.expectedReadyDirection, 'READY_DELAY_SHOULD_DECREASE');
  assert.equal(change.directional, true);
});

test('mixed positive and negative fire-rate changes remain ambiguous for direction', () => {
  const before = extractFireRateContext({ itemInputs: [{ recordKey: 'a', directProvidedStats: [{ providedPropertyType: 'FireRateBonus', numericValue: 10 }], nonDirectModifierTokens: [] }], permanentWeaponBuffs: {}, gunBridge: [] });
  const after = extractFireRateContext({ itemInputs: [{ recordKey: 'b', directProvidedStats: [{ providedPropertyType: 'FireRateBonus', numericValue: 5 }], nonDirectModifierTokens: [] }], permanentWeaponBuffs: {}, gunBridge: [] });
  const change = classifyFireRateContextChange(before, after);
  assert.equal(change.expectedReadyDirection, 'MIXED_DIRECTION_FIRE_RATE_CHANGE');
  assert.equal(change.directional, false);
});

test('adjacent same-fire-mode context transition compares local ready-delay medians', () => {
  const contexts = new Map([
    ['a', { id: 'a', itemInputs: [], permanentWeaponBuffs: {}, gunBridge: [] }],
    ['b', { id: 'b', itemInputs: [{ recordKey: 'boost', directProvidedStats: [{ providedPropertyType: 'FireRateBonus', numericValue: 10 }], nonDirectModifierTokens: [] }], permanentWeaponBuffs: {}, gunBridge: [] }],
  ]);
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push(event(i + 1, 'a', 0.10));
  for (let i = 0; i < 4; i++) rows.push(event(i + 10, 'b', 0.08));
  const segments = buildDischargeSegments(rows, contexts);
  const transitions = buildAdjacentFireRateTransitions(segments, 4, 3);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].directionAgreement, true);
  assert.equal(transitions[0].beforeReadyMedianSeconds, 0.10);
  assert.equal(transitions[0].afterReadyMedianSeconds, 0.08);
});

function event(tick, effectContextId, ready) {
  return {
    tick,
    playerKey: 'p1',
    heroId: 1,
    weaponEntityIndex: 99,
    effectContextId,
    transition: { actualDischargeSignal: true, readyDelayCandidateSeconds: ready },
    observedWeaponState: { activeFireMode: 0, burstShotsRemaining: 0 },
  };
}
