import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOwnedCadenceContext,
  classifyItemCadenceEvidence,
  isCadenceModifierToken,
  summarizeCatalogCadenceGap,
} from '../src/player-state/cadence-modifier-audit.mjs';

test('cycle-time modifiers are cadence evidence even when old operation classifier misses them', () => {
  const row = classifyItemCadenceEvidence({
    recordKey: 'item_cycle',
    meaningfulDirectProvidedStats: [{ providedPropertyType: 'MODIFIER_VALUE_CYCLE_TIME_PERCENTAGE', numericValue: -10 }],
    nonDirectModifierTokens: [],
    recordModifierTokens: ['MODIFIER_VALUE_CYCLE_TIME_PERCENTAGE'],
    weaponStateRelevant: { operation: { hasEffectEvidence: false } },
  });
  assert.equal(row.hasDirectCadenceEvidence, true);
  assert.equal(row.hiddenFromOldOperationClassifier, true);
});

test('intra-burst and bonus-burst modifier tokens are retained as unresolved cadence evidence', () => {
  assert.equal(isCadenceModifierToken('MODIFIER_VALUE_INTRA_BURST_SHOT_CYCLE_TIME_OVERRIDE'), true);
  assert.equal(isCadenceModifierToken('MODIFIER_VALUE_BONUS_BURST_SHOT_CONSTANT'), true);
  const row = classifyItemCadenceEvidence({
    recordKey: 'burst_item',
    meaningfulDirectProvidedStats: [],
    nonDirectModifierTokens: ['MODIFIER_VALUE_INTRA_BURST_SHOT_CYCLE_TIME_OVERRIDE'],
    recordModifierTokens: ['MODIFIER_VALUE_INTRA_BURST_SHOT_CYCLE_TIME_OVERRIDE'],
    weaponStateRelevant: { operation: { hasEffectEvidence: false } },
  });
  assert.equal(row.hasNonDirectCadenceEvidence, true);
  assert.equal(row.hiddenFromOldOperationClassifier, true);
});

test('weapon damage alone is not cadence evidence', () => {
  const row = classifyItemCadenceEvidence({
    recordKey: 'damage_only',
    meaningfulDirectProvidedStats: [{ providedPropertyType: 'MODIFIER_VALUE_WEAPON_DAMAGE_INCREASE', numericValue: 12 }],
    nonDirectModifierTokens: [],
    recordModifierTokens: ['MODIFIER_VALUE_WEAPON_DAMAGE_INCREASE'],
    weaponStateRelevant: { operation: { hasEffectEvidence: false } },
  });
  assert.equal(row.hasAnyCadenceEvidence, false);
});

test('owned cadence context recovers hidden cadence items from full effect records', () => {
  const effects = new Map([
    ['cycle_item', {
      recordKey: 'cycle_item',
      meaningfulDirectProvidedStats: [{ providedPropertyType: 'MODIFIER_VALUE_CYCLE_TIME', numericValue: -0.02 }],
      nonDirectModifierTokens: [],
      recordModifierTokens: ['MODIFIER_VALUE_CYCLE_TIME'],
      weaponStateRelevant: { operation: { hasEffectEvidence: false } },
    }],
    ['damage_item', {
      recordKey: 'damage_item',
      meaningfulDirectProvidedStats: [{ providedPropertyType: 'MODIFIER_VALUE_WEAPON_DAMAGE_INCREASE', numericValue: 10 }],
      nonDirectModifierTokens: [],
      recordModifierTokens: ['MODIFIER_VALUE_WEAPON_DAMAGE_INCREASE'],
      weaponStateRelevant: { operation: { hasEffectEvidence: false } },
    }],
  ]);
  const context = buildOwnedCadenceContext({
    authoritativeOwnership: { standardShopItems: [{ recordKey: 'cycle_item' }, { recordKey: 'damage_item' }] },
  }, effects);
  assert.equal(context.itemEvidence.length, 1);
  assert.equal(context.hiddenItems.length, 1);
  assert.equal(context.hiddenItems[0].recordKey, 'cycle_item');
});

test('catalog gap summary separates recognized and hidden cadence items', () => {
  const summary = summarizeCatalogCadenceGap([
    {
      recordKey: 'fire_rate',
      meaningfulDirectProvidedStats: [{ providedPropertyType: 'MODIFIER_VALUE_FIRE_RATE', numericValue: 8 }],
      nonDirectModifierTokens: [],
      recordModifierTokens: ['MODIFIER_VALUE_FIRE_RATE'],
      weaponStateRelevant: { operation: { hasEffectEvidence: true } },
    },
    {
      recordKey: 'cycle_time',
      meaningfulDirectProvidedStats: [],
      nonDirectModifierTokens: ['MODIFIER_VALUE_CYCLE_TIME_PERCENTAGE'],
      recordModifierTokens: ['MODIFIER_VALUE_CYCLE_TIME_PERCENTAGE'],
      weaponStateRelevant: { operation: { hasEffectEvidence: false } },
    },
  ]);
  assert.equal(summary.cadenceItems, 2);
  assert.equal(summary.oldOperationClassifierItems, 1);
  assert.equal(summary.hiddenFromOldOperationClassifierItems, 1);
});
