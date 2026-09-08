import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAmmoMechanismCensus,
  classifyAmmoEvidence,
} from '../src/player-state/standard-shop-ammo-mechanism-census.mjs';

test('bullet speed alone is not ammo-mechanism evidence', () => {
  const result =
    classifyAmmoEvidence({
      recordKey:
        'upgrade_pristine_emblem',

      meaningfulDirectProvidedStats: [
        {
          propertyKey:
            'BonusBulletSpeedPercent',
          providedPropertyType:
            'MODIFIER_VALUE_BONUS_BULLET_SPEED_PERCENT',
        },
      ],

      weaponStateRelevant: {
        genericRecordFieldNamesDiagnosticOnly: [
          'm_flBulletSpeed',
        ],
      },
    });

  assert.equal(
    result.classification,
    'NO_AMMO_MECHANISM_EVIDENCE',
  );
});

test('meaningful clip-size stat is capacity effect, not current-ammo restore', () => {
  const result =
    classifyAmmoEvidence({
      recordKey:
        'upgrade_titan_round',

      meaningfulDirectProvidedStats: [
        {
          propertyKey:
            'BonusClipSizePercent',
          providedPropertyType:
            'MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT',
          value: 20,
        },
      ],
    });

  assert.equal(
    result.classification,
    'CLIP_OR_MAGAZINE_CAPACITY_EFFECT_ONLY',
  );

  assert.equal(
    result
      .evidence
      .currentAmmoRestore
      .length,
    0,
  );
});

test('AmmoReloadPercent is retained as diagnostic current-ammo candidate', () => {
  const result =
    classifyAmmoEvidence({
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
    'CURRENT_AMMO_RESTORATION_OR_RELOAD_PERCENT_CANDIDATE',
  );

  assert.equal(
    result.evidenceStrength,
    'DIAGNOSTIC_FIELD_NAME_ONLY',
  );
});

test('direct reload speed is not silently treated as current-ammo restoration', () => {
  const result =
    classifyAmmoEvidence({
      recordKey:
        'upgrade_enchanted_holsters',

      meaningfulDirectProvidedStats: [
        {
          propertyKey:
            'ReloadSpeedMultipler',
          providedPropertyType:
            'MODIFIER_VALUE_RELOAD_SPEED',
          value: 0.2,
        },
      ],
    });

  assert.equal(
    result.classification,
    'RELOAD_RATE_EFFECT_ONLY',
  );
});

test('complete synthetic catalog/effect join defines resource universe independent of replay', () => {
  const catalog = {
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
  };

  const effects = {
    items: [
      {
        recordKey:
          'upgrade_a',
        directProvidedStats: [],
        meaningfulDirectProvidedStats: [],
        recordModifierTokens: [],
        weaponStateRelevant: {
          genericRecordFieldNamesDiagnosticOnly: [
            'AmmoReloadPercent',
          ],
        },
      },
      {
        recordKey:
          'upgrade_b',
        directProvidedStats: [],
        meaningfulDirectProvidedStats: [],
        recordModifierTokens: [],
      },
    ],
  };

  const census =
    buildAmmoMechanismCensus({
      catalog,
      effects,
    });

  assert.equal(
    census.catalogRows,
    2,
  );

  assert.equal(
    census.joinedItems,
    2,
  );

  assert.equal(
    census.restorationCandidateCount,
    1,
  );

  assert.equal(
    census.missingEffects.length,
    0,
  );
});
