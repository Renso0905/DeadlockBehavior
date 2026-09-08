import test from 'node:test';
import assert from 'node:assert/strict';

import {
  eventKey,
  indexObjectsByScalar,
  mergeCoherentRestorationRows,
  summarizeRestorationContextsV02,
} from '../src/player-state/ammo-restoration-context-discovery-v02.mjs';

test('event key freezes hero plus tick', () => {
  assert.equal(
    eventKey({
      heroId: 25,
      tick: 85449,
    }),
    '25|85449',
  );
});

test('merges coherent V03 rows to Script197 provenance', () => {
  const result =
    mergeCoherentRestorationRows({
      script197Rows: [
        {
          residualClass:
            'ATTACK_COUPLED_AMMO_GAIN',
          heroId: 25,
          tick: 85449,
          effectContextId: 'ctx-a',
        },
      ],

      script198v03Rows: [
        {
          heroId: 25,
          tick: 85449,
          coherentGain: true,
          logicalGain: 12,
          grossRestorationIfOneShotConsumed: 13,
        },
      ],
    });

  assert.equal(result.coherentCount, 1);
  assert.equal(result.mergedCount, 1);
  assert.equal(result.missingCount, 0);
  assert.equal(
    result.merged[0].effectContextId,
    'ctx-a',
  );
});

test('missing coherent provenance is surfaced', () => {
  const result =
    mergeCoherentRestorationRows({
      script197Rows: [],
      script198v03Rows: [
        {
          heroId: 25,
          tick: 85449,
          coherentGain: true,
        },
      ],
    });

  assert.equal(
    result.missingCount,
    1,
  );
});

test('indexes exact context scalar', () => {
  const index =
    indexObjectsByScalar(
      {
        contexts: [
          {
            id: 'ctx-a',
            ownedItems: ['item_a'],
          },
        ],
      },
      new Set(['ctx-a']),
    );

  assert.equal(
    index.get('ctx-a').length,
    1,
  );
});

test('repeated context is attribution candidate only', () => {
  const result =
    summarizeRestorationContextsV02({
      coherentRows: [
        {
          heroId: 25,
          tick: 100,
          effectContextId: 'ctx-a',
          logicalGain: 19,
          grossRestorationIfOneShotConsumed: 20,
        },
        {
          heroId: 25,
          tick: 200,
          effectContextId: 'ctx-a',
          logicalGain: 19,
          grossRestorationIfOneShotConsumed: 20,
        },
      ],

      contextMatches:
        new Map([
          ['ctx-a', []],
        ]),

      rawEventMatches: [],
    });

  assert.equal(
    result.repeatedContextCount,
    1,
  );

  assert.equal(
    result.classification,
    'REPEATED_RESTORATION_CONTEXTS_AVAILABLE_FOR_ATTRIBUTION_V02',
  );
});
