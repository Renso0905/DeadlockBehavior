import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STANDARD_CLASS,
  buildCensusV02,
  classifyAmmoItem,
  collectStandardCatalogItems,
} from '../src/player-state/standard-shop-ammo-mechanism-census-v02.mjs';

test('catalog adapter selects exact Script138 standard classification only', () => {
  const rows =
    collectStandardCatalogItems({
      structural: [
        {
          recordKey: 'upgrade_standard',
          classification: STANDARD_CLASS,
        },
        {
          recordKey: 'upgrade_street',
          classification: 'NON_STANDARD_MODE_ITEM',
        },
        {
          recordKey: 'upgrade_infra',
          classification: 'ITEM_SYSTEM_INFRASTRUCTURE',
        },
      ],
    });

  assert.deepEqual(
    rows.map(row => row.recordKey),
    ['upgrade_standard'],
  );
});

test('recordModifierToken duplicating direct clip stat stays static', () => {
  const result =
    classifyAmmoItem({
      recordKey: 'upgrade_magazine',

      meaningfulDirectProvidedStats: [
        {
          propertyKey: 'BonusClipSizePercent',
          providedPropertyType:
            'MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT',
          modifierValueTokens: [
            'MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT',
          ],
        },
      ],

      recordModifierTokens: [
        'MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT',
      ],
    });

  assert.equal(
    result.classification,
    'STATIC_CLIP_OR_MAGAZINE_CAPACITY_EFFECT',
  );

  assert.equal(
    result.currentAmmoCandidate,
    false,
  );
});

test('dynamic metadata can elevate an otherwise static capacity item to unresolved', () => {
  const result =
    classifyAmmoItem({
      recordKey: 'upgrade_active_reload',

      meaningfulDirectProvidedStats: [
        {
          propertyKey: 'BonusClipSizePercent',
          providedPropertyType:
            'MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT',
        },
      ],
    });

  assert.equal(
    result.classification,
    'AMMO_NAMED_RESOURCE_EVIDENCE_UNRESOLVED',
  );

  assert.equal(
    result.currentAmmoCandidate,
    true,
  );
});

test('AmmoReloadPercent remains current-ammo candidate', () => {
  const result =
    classifyAmmoItem({
      recordKey: 'upgrade_quick_silver',
      weaponStateRelevant: {
        genericRecordFieldNamesDiagnosticOnly: [
          'AmmoReloadPercent',
        ],
      },
    });

  assert.equal(
    result.classification,
    'CURRENT_AMMO_RESTORATION_FIELD_CANDIDATE',
  );

  assert.equal(
    result.currentAmmoCandidate,
    true,
  );
});

test('direct reload speed stays static reload-rate effect', () => {
  const result =
    classifyAmmoItem({
      recordKey: 'upgrade_reload_speed',
      meaningfulDirectProvidedStats: [
        {
          propertyKey: 'ReloadSpeedMultipler',
          providedPropertyType:
            'MODIFIER_VALUE_RELOAD_SPEED',
          modifierValueTokens: [
            'MODIFIER_VALUE_RELOAD_SPEED',
          ],
        },
      ],
    });

  assert.equal(
    result.classification,
    'STATIC_RELOAD_RATE_EFFECT',
  );
});

test('complete synthetic join is defined by exact standard classification', () => {
  const result =
    buildCensusV02({
      catalog: {
        structural: [
          {
            recordKey: 'upgrade_a',
            classification: STANDARD_CLASS,
          },
          {
            recordKey: 'upgrade_b',
            classification: STANDARD_CLASS,
          },
          {
            recordKey: 'upgrade_nonstandard',
            classification: 'NON_STANDARD_MODE_ITEM',
          },
        ],
      },

      effects: {
        items: [
          {
            recordKey: 'upgrade_a',
            directProvidedStats: [],
            meaningfulDirectProvidedStats: [],
            weaponStateRelevant: {
              genericRecordFieldNamesDiagnosticOnly: [
                'AmmoReloadPercent',
              ],
            },
          },
          {
            recordKey: 'upgrade_b',
            directProvidedStats: [],
            meaningfulDirectProvidedStats: [],
            weaponStateRelevant: {},
          },
        ],
      },
    });

  assert.equal(
    result.standardCatalogRows,
    2,
  );

  assert.equal(
    result.effectItems,
    2,
  );

  assert.equal(
    result.joinedItems,
    2,
  );

  assert.equal(
    result.missingEffects.length,
    0,
  );

  assert.equal(
    result.extraEffects.length,
    0,
  );

  assert.equal(
    result.currentAmmoCandidateCount,
    1,
  );
});
