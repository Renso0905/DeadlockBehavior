import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adjustedDrop,
  evaluateCompositeFormulas,
} from '../src/player-state/bonus-clip-composite-diagnostic.mjs';

test('Z plus Bonus uses wholeDrop minus bonusDelta', () => {
  assert.equal(
    adjustedDrop(
      0,
      -1,
      'Z_PLUS_B',
    ),
    1,
  );

  assert.equal(
    adjustedDrop(
      -5,
      -6,
      'Z_PLUS_B',
    ),
    1,
  );
});

test('Z minus Bonus uses wholeDrop plus bonusDelta', () => {
  assert.equal(
    adjustedDrop(
      0,
      1,
      'Z_MINUS_B',
    ),
    1,
  );

  assert.equal(
    adjustedDrop(
      -5,
      6,
      'Z_MINUS_B',
    ),
    1,
  );
});

test('strong plus composite resolves residuals without harming positives', () => {
  const rows = [];

  for (let i = 0; i < 200; i++) {
    rows.push({
      covered: true,
      carrierPresent: false,
      label: 'ZERO',
      wholeDrop: 0,
      bonusClipDelta: -1,
      heroId: 13,
    });
  }

  for (let i = 0; i < 5000; i++) {
    rows.push({
      covered: true,
      carrierPresent: false,
      label: 'POSITIVE',
      wholeDrop: 1,
      bonusClipDelta: 0,
      heroId: 1,
    });
  }

  const result =
    evaluateCompositeFormulas(
      rows,
      {
        minBonusDeltaCoverageRate: 0.8,
        minResidualWithBonusChange: 100,
        minResidualResolutionRate: 0.8,
        maxPositiveControlHarmRate: 0.001,
        minOverallPositiveRateGain: 0.005,
      },
    );

  assert.equal(
    result.candidates[0].formulaName,
    'Z_PLUS_B',
  );

  assert.equal(
    result.candidates[0].strongCandidate,
    true,
  );
});

test('a composite that fixes residuals but harms clean positives is rejected', () => {
  const rows = [];

  for (let i = 0; i < 200; i++) {
    rows.push({
      covered: true,
      carrierPresent: false,
      label: 'ZERO',
      wholeDrop: 0,
      bonusClipDelta: -1,
      heroId: 13,
    });
  }

  for (let i = 0; i < 5000; i++) {
    rows.push({
      covered: true,
      carrierPresent: false,
      label: 'POSITIVE',
      wholeDrop: 1,
      bonusClipDelta: 2,
      heroId: 1,
    });
  }

  const result =
    evaluateCompositeFormulas(
      rows,
      {
        minBonusDeltaCoverageRate: 0.8,
        minResidualWithBonusChange: 100,
        minResidualResolutionRate: 0.8,
        maxPositiveControlHarmRate: 0.001,
        minOverallPositiveRateGain: 0.005,
      },
    );

  const plus =
    result.candidates.find(
      row =>
        row.formulaName
        === 'Z_PLUS_B',
    );

  assert.equal(
    plus.strongCandidate,
    false,
  );

  assert.ok(
    plus.positiveControlHarmRate
      > 0.001,
  );
});

test('missing bonus delta is not silently treated as zero for composite formulas', () => {
  assert.equal(
    adjustedDrop(
      1,
      null,
      'Z_PLUS_B',
    ),
    null,
  );

  assert.equal(
    adjustedDrop(
      1,
      undefined,
      'Z_MINUS_B',
    ),
    null,
  );
});
