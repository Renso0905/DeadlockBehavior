import test from 'node:test';
import assert from 'node:assert/strict';

import {
  annotateEnrichmentRows,
  buildCatalogHashIndex,
  DEADLOCK_MURMUR_SEED,
  murmurHash2,
  resolveRuntimeItems,
} from '../src/player-state/ammo-restoration-item-enrichment-v02.mjs';

test('Deadlock MurmurHash2 fixture matches Script140', () => {
  assert.equal(
    DEADLOCK_MURMUR_SEED,
    0x31415926,
  );

  assert.equal(
    murmurHash2(
      'upgrade_magic_reach',
    ),
    754480263,
  );
});

test('catalog recordKey hashes to runtime item id', () => {
  const catalog = {
    standardCatalog: [
      {
        recordKey:
          'upgrade_magic_reach',
        itemTier: 2,
      },
    ],
  };

  const index =
    buildCatalogHashIndex(
      catalog,
    );

  assert.equal(
    index.byHash
      .get(754480263)
      .recordKey,
    'upgrade_magic_reach',
  );
});

test('runtime id resolves catalog then effects by recordKey', () => {
  const result =
    resolveRuntimeItems({
      runtimeItemIds: [
        754480263,
      ],

      catalog: {
        rows: [
          {
            recordKey:
              'upgrade_magic_reach',
          },
        ],
      },

      effects: {
        rows: [
          {
            recordKey:
              'upgrade_magic_reach',
            directProvidedStats: [
              {
                token:
                  'MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT',
                value: 10,
              },
            ],
          },
        ],
      },
    });

  assert.deepEqual(
    result.unresolved,
    [],
  );

  assert.equal(
    result.resolved[0]
      .recordKey,
    'upgrade_magic_reach',
  );

  assert.ok(
    result.resolved[0]
      .ammoEffectEvidence
      .some(
        value =>
          value.includes(
            'AMMO_CLIP_SIZE',
          ),
      ),
  );
});

test('annotation preserves enrichment metrics while attaching resolution', () => {
  const result =
    annotateEnrichmentRows({
      enrichmentRows: [
        {
          heroId: 25,
          itemId: 754480263,
          restorationPresent: 2,
          restorationEvents: 2,
          attacksPresent: 100,
        },
      ],

      catalog: {
        rows: [
          {
            recordKey:
              'upgrade_magic_reach',
          },
        ],
      },

      effects: {
        rows: [
          {
            recordKey:
              'upgrade_magic_reach',
          },
        ],
      },
    });

  assert.equal(
    result.rows[0]
      .restorationPresent,
    2,
  );

  assert.equal(
    result.rows[0]
      .itemResolution
      .recordKey,
    'upgrade_magic_reach',
  );
});
