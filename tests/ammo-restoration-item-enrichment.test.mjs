import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContextIndex,
  computeItemEnrichment,
  extractItemIds,
  summarizeAttackExposure,
  summarizeCandidates,
} from '../src/player-state/ammo-restoration-item-enrichment.mjs';

test('extracts nested item ids without duplication', () => {
  assert.deepEqual(
    extractItemIds({
      itemInputs: [
        { itemId: 10 },
        { itemId: 20 },
        { itemId: 10 },
      ],
    }),
    [10, 20],
  );
});

test('builds context index with hero and item set', () => {
  const index =
    buildContextIndex({
      effectContextSignatures: [
        {
          effectContextId:
            'weapon-context-1',
          heroId: 25,
          itemInputs: [
            { itemId: 100 },
          ],
        },
      ],
    });

  assert.equal(index.size, 1);
  assert.deepEqual(
    index
      .get('weapon-context-1')
      .itemIds,
    [100],
  );
});

test('attack exposure counts shot-number mutation rows', () => {
  const exposure =
    summarizeAttackExposure([
      {
        heroId: 25,
        effectContextId:
          'weapon-context-1',
        changedFields: [
          'm_nShotNumber',
        ],
      },
      {
        heroId: 25,
        effectContextId:
          'weapon-context-1',
        changedFields: [
          'm_flAmmoFrac',
        ],
      },
    ]);

  assert.equal(
    exposure.get(
      '25|weapon-context-1',
    ),
    1,
  );
});

test('item enrichment compares present versus absent exposure within hero', () => {
  const contextIndex =
    new Map([
      [
        'weapon-context-a',
        {
          effectContextId:
            'weapon-context-a',
          heroId: 25,
          itemIds: [100],
        },
      ],
      [
        'weapon-context-b',
        {
          effectContextId:
            'weapon-context-b',
          heroId: 25,
          itemIds: [],
        },
      ],
    ]);

  const rows =
    computeItemEnrichment({
      restorationEvents: [
        {
          heroId: 25,
          tick: 10,
          effectContextId:
            'weapon-context-a',
        },
        {
          heroId: 25,
          tick: 20,
          effectContextId:
            'weapon-context-a',
        },
      ],

      contextIndex,

      attackExposure:
        new Map([
          [
            '25|weapon-context-a',
            100,
          ],
          [
            '25|weapon-context-b',
            100,
          ],
        ]),
    });

  assert.equal(
    rows[0].restorationPresent,
    2,
  );
  assert.equal(
    rows[0].restorationAbsent,
    0,
  );
  assert.equal(
    rows[0].riskRatio,
    Infinity,
  );
});

test('cross-hero classification requires ammo effect evidence', () => {
  const result =
    summarizeCandidates([
      {
        heroId: 25,
        itemId: 100,
        restorationPresent: 2,
        restorationEvents: 2,
        attacksPresent: 100,
        ammoEffectEvidence: [
          'modifier=ammo_restore',
        ],
        catalogIdentity: {
          recordKey:
            'upgrade_test',
        },
      },
      {
        heroId: 4,
        itemId: 100,
        restorationPresent: 1,
        restorationEvents: 1,
        attacksPresent: 50,
        ammoEffectEvidence: [
          'modifier=ammo_restore',
        ],
        catalogIdentity: {
          recordKey:
            'upgrade_test',
        },
      },
    ]);

  assert.equal(
    result.classification,
    'CROSS_HERO_ITEM_WITH_AMMO_EFFECT_EVIDENCE_AVAILABLE_FOR_SPECIFIC_HYPOTHESIS',
  );
});
