import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPECTED_EFFECT_STATUS,
  buildCensusV03,
  classifyAmmoItemV03,
  getScript139Universe,
} from '../src/player-state/standard-shop-ammo-mechanism-census-v03.mjs';

test('Script139 universe uses exact items array and unique recordKeys', () => {
  const universe =
    getScript139Universe({
      status:
        EXPECTED_EFFECT_STATUS,

      items: [
        {
          recordKey:
            'upgrade_a',
        },
        {
          recordKey:
            'upgrade_b',
        },
      ],
    });

  assert.equal(
    universe.itemCount,
    2,
  );

  assert.equal(
    universe.recordKeyCount,
    2,
  );

  assert.equal(
    universe.uniqueRecordKeyCount,
    2,
  );
});

test('duplicate Script139 recordKey is explicit integrity evidence', () => {
  const universe =
    getScript139Universe({
      items: [
        {
          recordKey:
            'upgrade_a',
        },
        {
          recordKey:
            'upgrade_a',
        },
      ],
    });

  assert.deepEqual(
    universe.duplicateRecordKeys,
    ['upgrade_a'],
  );
});

test('static clip stat remains static when record token repeats it', () => {
  const result =
    classifyAmmoItemV03({
      recordKey:
        'upgrade_magazine',

      meaningfulDirectProvidedStats: [
        {
          propertyKey:
            'BonusClipSizePercent',

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

test('AmmoReloadPercent remains diagnostic current-ammo candidate', () => {
  const result =
    classifyAmmoItemV03({
      recordKey:
        'upgrade_quick_silver',

      weaponStateRelevant: {
        genericRecordFieldNamesDiagnosticOnly: [
          'AmmoReloadPercent',
        ],
      },
    });

  assert.equal(
    result.classification,
    'CURRENT_AMMO_FIELD_CANDIDATE',
  );

  assert.equal(
    result.currentAmmoCandidate,
    true,
  );
});

test('direct reload-speed stat remains static reload-rate effect', () => {
  const result =
    classifyAmmoItemV03({
      recordKey:
        'upgrade_reload_speed',

      meaningfulDirectProvidedStats: [
        {
          propertyKey:
            'ReloadSpeedMultipler',

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

test('complete synthetic Script139 universe is replay independent', () => {
  const result =
    buildCensusV03({
      status:
        EXPECTED_EFFECT_STATUS,

      items: [
        {
          recordKey:
            'upgrade_quick_silver',

          directProvidedStats: [],

          meaningfulDirectProvidedStats: [],

          weaponStateRelevant: {
            genericRecordFieldNamesDiagnosticOnly: [
              'AmmoReloadPercent',
            ],
          },
        },
        {
          recordKey:
            'upgrade_plain',

          directProvidedStats: [],

          meaningfulDirectProvidedStats: [],

          weaponStateRelevant: {},
        },
      ],
    });

  assert.equal(
    result.universe.itemCount,
    2,
  );

  assert.equal(
    result.currentAmmoCandidateCount,
    1,
  );

  assert.equal(
    result.noAmmoEvidenceCount,
    1,
  );
});
