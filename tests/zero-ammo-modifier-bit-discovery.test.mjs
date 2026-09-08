import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeBitCandidates,
  candidateId,
  evaluateModifierBitCandidates,
  extractModifierMaskSnapshot,
  isKnownSlideBit,
} from '../src/player-state/zero-ammo-modifier-bit-discovery.mjs';

test('modifier mask snapshot keeps only integer mask/state fields', () => {
  const snapshot =
    extractModifierMaskSnapshot({
      'm_pModifierProp.m_bvEnabledPredictedStateMask.0002': 34,
      'm_pModifierProp.otherFloat': 1.5,
      'm_iHealth': 500,
    });

  assert.deepEqual(
    snapshot,
    {
      'm_pModifierProp.m_bvEnabledPredictedStateMask.0002': 34,
    },
  );
});

test('known primary and companion slide bits are excluded', () => {
  assert.equal(
    isKnownSlideBit(
      'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
      5,
    ),
    true,
  );

  assert.equal(
    isKnownSlideBit(
      'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
      1,
    ),
    true,
  );

  assert.equal(
    isKnownSlideBit(
      'm_pModifierProp.m_bvEnabledPredictedStateMask.0007',
      1,
    ),
    true,
  );
});

test('active candidate extraction finds other set bits', () => {
  const candidates =
    activeBitCandidates({
      'm_pModifierProp.m_bvEnabledPredictedStateMask.0002':
        32 + 8 + 2,
    });

  assert.ok(
    candidates.some(
      row =>
        row.id === candidateId(
          'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
          3,
        ),
    ),
  );

  assert.equal(
    candidates.some(
      row => row.bit === 5,
    ),
    false,
  );

  assert.equal(
    candidates.some(
      row => row.bit === 1,
    ),
    false,
  );
});

test('strong zero-specific cross-hero bit is discovered', () => {
  const field =
    'm_pModifierProp.m_bvEnabledPredictedStateMask.0004';

  const samples = [];

  for (
    const heroId
    of [1, 2, 3]
  ) {
    for (let i = 0; i < 10; i++) {
      samples.push({
        heroId,
        outcome: 'ZERO',
        modifierMasks: {
          [field]: 8,
        },
      });
    }
  }

  for (let i = 0; i < 6000; i++) {
    samples.push({
      heroId: 10,
      outcome: 'POSITIVE',
      modifierMasks: {
        [field]: 0,
      },
    });
  }

  const result =
    evaluateModifierBitCandidates(
      samples,
      {
        minZeroSamples: 20,
        minPositiveControls: 5000,
        minCandidatePresent: 10,
        minZeroCaptured: 5,
        minZeroRateGivenPresent: 0.25,
        minRiskDifference: 0.20,
        maxPositivePresentRate: 0.01,
        minSupportingHeroes: 3,
      },
    );

  assert.equal(
    result.strongCandidateCount,
    1,
  );

  assert.equal(
    result.strongCandidates[0].bit,
    3,
  );
});

test('hero-specific correlate does not pass cross-hero support gate', () => {
  const field =
    'm_pModifierProp.m_bvEnabledPredictedStateMask.0004';

  const samples = [];

  for (let i = 0; i < 30; i++) {
    samples.push({
      heroId: 1,
      outcome: 'ZERO',
      modifierMasks: {
        [field]: 8,
      },
    });
  }

  for (let i = 0; i < 6000; i++) {
    samples.push({
      heroId: 2,
      outcome: 'POSITIVE',
      modifierMasks: {
        [field]: 0,
      },
    });
  }

  const result =
    evaluateModifierBitCandidates(samples);

  assert.equal(
    result.strongCandidateCount,
    0,
  );
});
