import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPANIONS,
  PRIMARY,
  evaluateBitState,
  hasBit,
  summarizeCompanionResiduals,
} from '../src/player-state/slide-companion-residual-diagnostic.mjs';

test('frozen primary and companions are exact Script183 bits', () => {
  assert.equal(PRIMARY.bit, 5);
  assert.equal(PRIMARY.mask, 32);
  assert.equal(COMPANIONS[0].bit, 1);
  assert.equal(COMPANIONS[1].bit, 1);
});

test('bit helper detects companion bit in integer mask', () => {
  assert.equal(hasBit(2, 1), true);
  assert.equal(hasBit(34, 1), true);
  assert.equal(hasBit(32, 1), false);
});

test('missing carrier field remains uncovered rather than absent', () => {
  const result =
    evaluateBitState(
      {},
      COMPANIONS[0],
    );

  assert.equal(result.covered, false);
  assert.equal(result.present, false);
});

test('companion can capture a primary-absent zero residual', () => {
  const result =
    summarizeCompanionResiduals([
      {
        heroId: 1,
        combinedLabel: 'ZERO',
        primaryCovered: true,
        primaryPresent: false,
        companions: {
          mask0002_bit1: {
            covered: true,
            present: true,
          },
          mask0007_bit1: {
            covered: true,
            present: false,
          },
        },
      },
    ]);

  assert.equal(
    result.union.zeroCaptured,
    1,
  );

  assert.equal(
    result.union.zeroCaptureRate,
    1,
  );
});

test('positive companion-only controls remain visible as false-positive pressure', () => {
  const rows = [];

  for (let i = 0; i < 100; i++) {
    rows.push({
      heroId: 1,
      combinedLabel: 'POSITIVE',
      primaryCovered: true,
      primaryPresent: false,
      companions: {
        mask0002_bit1: {
          covered: true,
          present: i < 10,
        },
        mask0007_bit1: {
          covered: true,
          present: false,
        },
      },
    });
  }

  const result =
    summarizeCompanionResiduals(rows);

  assert.equal(
    result.union.positivePresent,
    10,
  );

  assert.equal(
    result.union.positivePresentRate,
    0.1,
  );
});
