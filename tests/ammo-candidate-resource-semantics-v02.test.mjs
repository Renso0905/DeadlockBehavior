import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSemanticAuditV02,
  collectDirectAmmoStatRecords,
  collectRawAmmoScalarFields,
  summarizeCandidateV02,
} from '../src/player-state/ammo-candidate-resource-semantics-v02.mjs';

test('propertyKey declaration without supplied value is not value-bearing', () => {
  const rows =
    collectDirectAmmoStatRecords({
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
    });

  assert.equal(
    rows.length,
    1,
  );

  assert.equal(
    rows[0].suppliedValuePresent,
    false,
  );
});

test('numericValue on ammo direct stat is strict value-bearing evidence', () => {
  const result =
    summarizeCandidateV02({
      candidate: {
        recordKey:
          'upgrade_test',
        runtimeItemId:
          1,
        resourceClassification:
          'CURRENT_AMMO_FIELD_CANDIDATE',
      },

      item: {
        meaningfulDirectProvidedStats: [
          {
            propertyKey:
              'AmmoReloadPercent',
            providedPropertyType:
              'MODIFIER_VALUE_AMMO_RELOAD_PERCENT',
            numericValue:
              25,
            value:
              '25%',
          },
        ],
      },
    });

  assert.equal(
    result.currentAmmoValueCount,
    1,
  );

  assert.equal(
    result.evidenceDepth,
    'EXPLICIT_CURRENT_AMMO_VALUE_PRESENT',
  );
});

test('icon path containing reload is never a raw supplied ammo scalar', () => {
  const rows =
    collectRawAmmoScalarFields({
      selectedTopLevelMetadata: {
        m_strShopIconLarge:
          'panorama:"file://items/quicksilver_reload.psd"',
      },
    });

  assert.equal(
    rows.length,
    0,
  );
});

test('raw scalar keyed AmmoReloadPercent is explicit value evidence', () => {
  const rows =
    collectRawAmmoScalarFields({
      rawConfig: {
        AmmoReloadPercent:
          0.5,
      },
    });

  assert.equal(
    rows.length,
    1,
  );

  assert.equal(
    rows[0].semanticClass,
    'CURRENT_AMMO',
  );

  assert.equal(
    rows[0].numericValue,
    0.5,
  );
});

test('diagnostic current-ammo field plus watcher remains no-value trigger candidate', () => {
  const result =
    summarizeCandidateV02({
      candidate: {
        recordKey:
          'upgrade_quick_silver',
        runtimeItemId:
          1,
        resourceClassification:
          'CURRENT_AMMO_FIELD_CANDIDATE',
      },

      item: {
        weaponStateRelevant: {
          genericRecordFieldNamesDiagnosticOnly: [
            'AmmoReloadPercent',
          ],
        },

        nestedModifierClasses: [
          'modifier_quick_silver_watcher',
        ],

        selectedTopLevelMetadata: {
          m_strShopIconLarge:
            'quicksilver_reload.psd',
        },
      },
    });

  assert.equal(
    result.currentAmmoValueCount,
    0,
  );

  assert.equal(
    result.currentAmmoFieldNameCount,
    1,
  );

  assert.equal(
    result.evidenceDepth,
    'CURRENT_AMMO_FIELD_WITH_TRIGGER_HINT_NO_VALUE',
  );
});

test('complete synthetic audit keeps missing item explicit', () => {
  const result =
    buildSemanticAuditV02({
      candidates: [
        {
          recordKey:
            'upgrade_a',
          runtimeItemId:
            1,
          resourceClassification:
            'CURRENT_AMMO_FIELD_CANDIDATE',
        },
        {
          recordKey:
            'upgrade_missing',
          runtimeItemId:
            2,
          resourceClassification:
            'CURRENT_AMMO_FIELD_CANDIDATE',
        },
      ],

      effects: {
        items: [
          {
            recordKey:
              'upgrade_a',
            rawConfig: {
              AmmoReloadPercent:
                0.25,
            },
          },
        ],
      },
    });

  assert.equal(
    result.candidateCount,
    2,
  );

  assert.equal(
    result.missingItemCount,
    1,
  );
});
