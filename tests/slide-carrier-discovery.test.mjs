import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCandidateAccumulator,
  finalizeCandidates,
  flattenPrimitiveChanges,
  observePawnSample,
  zigzagReencode,
} from '../src/player-state/slide-carrier-discovery.mjs';

test('ZigZag transform stays frozen from Scripts177-181', () => {
  assert.equal(
    zigzagReencode(-17),
    33,
  );

  assert.equal(
    zigzagReencode(16),
    32,
  );
});

test('primitive change flattener preserves scalar movement and flag fields', () => {
  const result =
    flattenPrimitiveChanges({
      m_bSliding: true,
      m_fFlags: 5,
      m_vecVelocity: {
        x: 10,
        y: 20,
        z: 0,
      },
    });

  assert.equal(
    result.m_bSliding,
    true,
  );

  assert.equal(
    result.m_fFlags,
    5,
  );

  assert.equal(
    result['m_vecVelocity.x'],
    10,
  );
});

test('universal candidate survives excluding Vyper and within multiple heroes', () => {
  const acc =
    createCandidateAccumulator({
      minFieldCoverageRate: 0.9,
      minPooledPresent: 10,
      minNonVyperPresent: 10,
      minNonVyperPresentZeroRate: 0.7,
      maxNonVyperAbsentZeroRate: 0.1,
      minNonVyperRiskDifference: 0.6,
      minSupportingNonVyperHeroes: 2,
      minPerHeroPresent: 4,
      minPerHeroPresentZeroRate: 0.7,
      maxExactDistinctValuesPerField: 64,
    });

  for (const heroId of [1, 2, 58]) {
    for (let i = 0; i < 10; i++) {
      observePawnSample(acc, {
        heroId,
        label: 'ZERO',
        fields: {
          m_bSliding: true,
          m_iTeamNum: heroId === 58 ? 3 : 2,
        },
      });
    }

    for (let i = 0; i < 40; i++) {
      observePawnSample(acc, {
        heroId,
        label: 'POSITIVE',
        fields: {
          m_bSliding: false,
          m_iTeamNum: heroId === 58 ? 3 : 2,
        },
      });
    }
  }

  const result =
    finalizeCandidates(
      acc,
      acc.thresholds,
    );

  const slide =
    result.ranked.find(
      row =>
        row.field === 'm_bSliding'
        && row.kind === 'EXACT'
        && row.value === true,
    );

  assert.ok(slide);
  assert.equal(
    slide.seriousUniversalSlideCandidate,
    true,
  );
  assert.equal(
    slide.supportingNonVyperHeroCount,
    2,
  );
});

test('Vyper-only identity correlate cannot become universal slide candidate', () => {
  const acc =
    createCandidateAccumulator({
      minFieldCoverageRate: 0.9,
      minPooledPresent: 10,
      minNonVyperPresent: 5,
      minNonVyperPresentZeroRate: 0.7,
      maxNonVyperAbsentZeroRate: 0.1,
      minNonVyperRiskDifference: 0.6,
      minSupportingNonVyperHeroes: 2,
      minPerHeroPresent: 2,
      minPerHeroPresentZeroRate: 0.7,
      maxExactDistinctValuesPerField: 64,
    });

  for (let i = 0; i < 30; i++) {
    observePawnSample(acc, {
      heroId: 58,
      label: 'ZERO',
      fields: {
        heroSpecificState: 999,
      },
    });
  }

  for (const heroId of [1, 2]) {
    for (let i = 0; i < 30; i++) {
      observePawnSample(acc, {
        heroId,
        label: 'POSITIVE',
        fields: {
          heroSpecificState: 0,
        },
      });
    }
  }

  const result =
    finalizeCandidates(
      acc,
      acc.thresholds,
    );

  const fake =
    result.ranked.find(
      row =>
        row.field === 'heroSpecificState'
        && row.value === 999,
    );

  assert.ok(fake);
  assert.equal(
    fake.seriousUniversalSlideCandidate,
    false,
  );
});

test('integer flag bit can emerge as carrier even when full bitmask varies', () => {
  const acc =
    createCandidateAccumulator({
      minFieldCoverageRate: 0.9,
      minPooledPresent: 8,
      minNonVyperPresent: 8,
      minNonVyperPresentZeroRate: 0.7,
      maxNonVyperAbsentZeroRate: 0.1,
      minNonVyperRiskDifference: 0.6,
      minSupportingNonVyperHeroes: 2,
      minPerHeroPresent: 4,
      minPerHeroPresentZeroRate: 0.7,
      maxExactDistinctValuesPerField: 64,
    });

  for (const heroId of [1, 2]) {
    for (let i = 0; i < 8; i++) {
      observePawnSample(acc, {
        heroId,
        label: 'ZERO',
        fields: {
          m_fFlags:
            8 | (i % 2 ? 1 : 2),
        },
      });
    }

    for (let i = 0; i < 30; i++) {
      observePawnSample(acc, {
        heroId,
        label: 'POSITIVE',
        fields: {
          m_fFlags:
            i % 2 ? 1 : 2,
        },
      });
    }
  }

  const result =
    finalizeCandidates(
      acc,
      acc.thresholds,
    );

  const bit3 =
    result.ranked.find(
      row =>
        row.field === 'm_fFlags'
        && row.kind === 'BIT_SET'
        && row.bit === 3,
    );

  assert.ok(bit3);
  assert.equal(
    bit3.seriousUniversalSlideCandidate,
    true,
  );
});
