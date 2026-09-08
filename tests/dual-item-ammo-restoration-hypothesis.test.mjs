import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ETHEREAL_BULLETS_ID,
  QUICK_SILVER_ID,
  buildRestorationPairMatrix,
  classifyPairState,
  summarizeDualItemHypothesis,
} from '../src/player-state/dual-item-ammo-restoration-hypothesis.mjs';

test('pair-state classifier distinguishes neither, each singleton, and both', () => {
  assert.equal(
    classifyPairState([]),
    'NEITHER',
  );

  assert.equal(
    classifyPairState([
      QUICK_SILVER_ID,
    ]),
    'QUICK_SILVER_ONLY',
  );

  assert.equal(
    classifyPairState([
      ETHEREAL_BULLETS_ID,
    ]),
    'ETHEREAL_BULLETS_ONLY',
  );

  assert.equal(
    classifyPairState([
      QUICK_SILVER_ID,
      ETHEREAL_BULLETS_ID,
    ]),
    'BOTH',
  );
});

test('eight-event exact XOR partition is measured explicitly', () => {
  const contextIndex =
    new Map();

  const restorationEvents = [];

  for (let i = 0; i < 4; i++) {
    const id =
      `weapon-context-q${i}`;

    contextIndex.set(
      id,
      {
        itemIds: [
          QUICK_SILVER_ID,
        ],
      },
    );

    restorationEvents.push({
      heroId: i < 2 ? 4 : 25,
      tick: 100 + i,
      effectContextId: id,
    });
  }

  for (let i = 0; i < 4; i++) {
    const id =
      `weapon-context-e${i}`;

    contextIndex.set(
      id,
      {
        itemIds: [
          ETHEREAL_BULLETS_ID,
        ],
      },
    );

    restorationEvents.push({
      heroId: i < 2 ? 4 : 25,
      tick: 200 + i,
      effectContextId: id,
    });
  }

  const matrix =
    buildRestorationPairMatrix({
      restorationEvents,
      contextIndex,
    });

  assert.equal(
    matrix.quickSilver,
    4,
  );

  assert.equal(
    matrix.etherealBullets,
    4,
  );

  assert.equal(
    matrix.xor,
    8,
  );

  assert.equal(
    matrix.both,
    0,
  );

  assert.equal(
    matrix.neither,
    0,
  );
});

test('strong classification requires exact partition and multi-hero support for both items', () => {
  const matrix = {
    rows: [
      {
        heroId: 4,
        pairState:
          'QUICK_SILVER_ONLY',
      },
      {
        heroId: 18,
        pairState:
          'QUICK_SILVER_ONLY',
      },
      {
        heroId: 4,
        pairState:
          'ETHEREAL_BULLETS_ONLY',
      },
      {
        heroId: 25,
        pairState:
          'ETHEREAL_BULLETS_ONLY',
      },
      {
        heroId: 25,
        pairState:
          'QUICK_SILVER_ONLY',
      },
      {
        heroId: 25,
        pairState:
          'ETHEREAL_BULLETS_ONLY',
      },
      {
        heroId: 4,
        pairState:
          'QUICK_SILVER_ONLY',
      },
      {
        heroId: 25,
        pairState:
          'ETHEREAL_BULLETS_ONLY',
      },
    ],
    xor: 8,
    both: 0,
    neither: 0,
  };

  const result =
    summarizeDualItemHypothesis({
      matrix,
      exposureRows: [],
      quickEvidence: [{}],
      etherealEvidence: [{}],
    });

  assert.equal(
    result.classification,
    'QUICK_SILVER_AND_ETHEREAL_BULLETS_EXACTLY_PARTITION_ALL_EIGHT_TEST_RESTORATIONS',
  );
});
