import test from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeExitPhase,
} from '../src/player-state/slide-carrier-exit-phase-diagnostic.mjs';

test('exact exit tick can strongly predict zero consumption', () => {
  const rows = [];

  for (let i = 0; i < 80; i++) {
    rows.push({
      heroId: 58,
      primaryCovered: true,
      primaryPresent: false,
      combinedLabel: 'ZERO',
      exactExitAtAttack: true,
      ticksSinceExit: 0,
    });
  }

  for (let i = 0; i < 20; i++) {
    rows.push({
      heroId: 58,
      primaryCovered: true,
      primaryPresent: false,
      combinedLabel: 'ZERO',
      exactExitAtAttack: false,
      ticksSinceExit: null,
    });
  }

  for (let i = 0; i < 10000; i++) {
    rows.push({
      heroId: 1,
      primaryCovered: true,
      primaryPresent: false,
      combinedLabel: 'POSITIVE',
      exactExitAtAttack:
        i < 5,
      ticksSinceExit:
        i < 5 ? 0 : null,
    });
  }

  const result =
    summarizeExitPhase(rows);

  assert.equal(
    result.exactExit.zero,
    80,
  );

  assert.equal(
    result.exactExit.positive,
    5,
  );

  assert.equal(
    result.classification,
    'EXACT_CARRIER_EXIT_TICK_STRONGLY_EXPLAINS_STRICT_ZERO_PHASE',
  );
});

test('ordinary zeros without exit timing do not pass exact-exit classification', () => {
  const rows = [];

  for (let i = 0; i < 100; i++) {
    rows.push({
      heroId: 1,
      primaryCovered: true,
      primaryPresent: false,
      combinedLabel: 'ZERO',
      exactExitAtAttack: false,
      ticksSinceExit: null,
    });
  }

  for (let i = 0; i < 10000; i++) {
    rows.push({
      heroId: 1,
      primaryCovered: true,
      primaryPresent: false,
      combinedLabel: 'POSITIVE',
      exactExitAtAttack: false,
      ticksSinceExit: null,
    });
  }

  const result =
    summarizeExitPhase(rows);

  assert.equal(
    result.classification,
    'EXACT_CARRIER_EXIT_TICK_DOES_NOT_FULLY_EXPLAIN_STRICT_ZEROS',
  );
});

test('hero summary keeps exact-exit zeros separate from positive exit controls', () => {
  const result =
    summarizeExitPhase([
      {
        heroId: 58,
        primaryCovered: true,
        primaryPresent: false,
        combinedLabel: 'ZERO',
        exactExitAtAttack: true,
        ticksSinceExit: 0,
      },
      {
        heroId: 58,
        primaryCovered: true,
        primaryPresent: false,
        combinedLabel: 'POSITIVE',
        exactExitAtAttack: true,
        ticksSinceExit: 0,
      },
    ]);

  assert.equal(
    result.byHero[0].zeroExactExit,
    1,
  );

  assert.equal(
    result.byHero[0].positiveExactExit,
    1,
  );
});
