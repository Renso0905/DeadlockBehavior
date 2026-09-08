import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bitIsSet,
  evaluateAttackRows,
  evaluateCarrierState,
  PRIMARY_SLIDE_AMMO_CARRIER,
} from '../src/player-state/slide-infinite-ammo-validation.mjs';

test('frozen primary carrier is mask0002 bit5', () => {
  assert.equal(
    PRIMARY_SLIDE_AMMO_CARRIER.field,
    'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
  );

  assert.equal(
    PRIMARY_SLIDE_AMMO_CARRIER.bit,
    5,
  );

  assert.equal(
    PRIMARY_SLIDE_AMMO_CARRIER.mask,
    32,
  );
});

test('bit helper detects the frozen carrier in values 32, 34, and 38', () => {
  assert.equal(
    bitIsSet(32, 5),
    true,
  );

  assert.equal(
    bitIsSet(34, 5),
    true,
  );

  assert.equal(
    bitIsSet(38, 5),
    true,
  );

  assert.equal(
    bitIsSet(2, 5),
    false,
  );
});

test('carrier evaluation distinguishes missing field from explicit absence', () => {
  const missing =
    evaluateCarrierState(
      {},
    );

  assert.equal(
    missing.covered,
    false,
  );

  const absent =
    evaluateCarrierState({
      [PRIMARY_SLIDE_AMMO_CARRIER.field]:
        2,
    });

  assert.equal(
    absent.covered,
    true,
  );

  assert.equal(
    absent.present,
    false,
  );
});

test('strong universal carrier makes residual counter nearly all positive', () => {
  const rows =
    [];

  for (
    const heroId
    of [1, 2, 3, 4, 5, 6, 58]
  ) {
    const carrierN =
      heroId === 58
        ? 200
        : 30;

    for (
      let i = 0;
      i < carrierN;
      i++
    ) {
      rows.push({
        heroId,
        label:
          i === 0
          && heroId !== 58
            ? 'POSITIVE'
            : 'ZERO',
        state: {
          [PRIMARY_SLIDE_AMMO_CARRIER.field]:
            34,
          'm_pModifierProp.m_bvEnabledPredictedStateMask.0007':
            2,
        },
      });
    }

    for (
      let i = 0;
      i < 1000;
      i++
    ) {
      rows.push({
        heroId,
        label:
          i === 0
            ? 'ZERO'
            : 'POSITIVE',
        state: {
          [PRIMARY_SLIDE_AMMO_CARRIER.field]:
            0,
          'm_pModifierProp.m_bvEnabledPredictedStateMask.0007':
            0,
        },
      });
    }
  }

  const result =
    evaluateAttackRows(
      rows,
      {
        thresholds: {
          minFieldCoverageRate: 0.95,
          minNonVyperCarrierPresent: 100,
          minNonVyperZeroRateGivenCarrier: 0.90,
          maxNonVyperZeroRateWithoutCarrier: 0.01,
          minNonVyperZeroRecall: 0.80,
          minSupportingNonVyperHeroes: 6,
          minVyperCarrierPresent: 100,
          minVyperZeroRateGivenCarrier: 0.95,
          minResidualTransitions: 5000,
          minResidualPositiveWholeDropRate: 0.99,
          maxResidualNegativeWholeDropRate: 0.001,
          minCompanionJaccardDiagnostic: 0.95,
        },
      },
    );

  assert.equal(
    result.semanticPass,
    true,
  );

  assert.ok(
    result.residual.positiveRate
      >= 0.99,
  );
});

test('Vyper-only state fails universal support even with perfect Vyper consequence', () => {
  const rows = [];

  for (let i = 0; i < 500; i++) {
    rows.push({
      heroId: 58,
      label: 'ZERO',
      state: {
        [PRIMARY_SLIDE_AMMO_CARRIER.field]:
          32,
        'm_pModifierProp.m_bvEnabledPredictedStateMask.0007':
          2,
      },
    });
  }

  for (
    const heroId
    of [1, 2, 3, 4, 5, 6]
  ) {
    for (let i = 0; i < 1000; i++) {
      rows.push({
        heroId,
        label:
          i < 10
            ? 'ZERO'
            : 'POSITIVE',
        state: {
          [PRIMARY_SLIDE_AMMO_CARRIER.field]:
            0,
          'm_pModifierProp.m_bvEnabledPredictedStateMask.0007':
            0,
        },
      });
    }
  }

  const result =
    evaluateAttackRows(
      rows,
    );

  assert.equal(
    result.semanticPass,
    false,
  );

  assert.equal(
    result.byHero
      .supportingNonVyperHeroCount,
    0,
  );
});
