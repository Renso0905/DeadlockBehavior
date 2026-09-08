import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combinedLogicalAmmo,
  deriveStrictAttackTransitionsWithIndex,
  inspectShortHorizonSettlement,
  summarizeZeroSettlements,
} from '../src/player-state/strict-zero-settlement-diagnostic.mjs';

test('combined logical ammo uses main plus bonus ZigZag counters', () => {
  assert.equal(
    combinedLogicalAmmo({
      rawClip: -5,
      bonusClip: 4,
    }),
    17,
  );
});

test('strict zero attack can settle one tick later without a new shot', () => {
  const settled = [
    {
      tick: 1,
      sourceIndex: 0,
      heroId: 1,
      playerKey: 'p',
      weaponEntityIndex: 1,
      effectContextId: 'ctx',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 1,
      rawClip: -5,
      bonusClip: 0,
      ammoFraction: 0,
    },
    {
      tick: 2,
      sourceIndex: 1,
      heroId: 1,
      playerKey: 'p',
      weaponEntityIndex: 1,
      effectContextId: 'ctx',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 2,
      rawClip: -5,
      bonusClip: 0,
      ammoFraction: 0,
    },
    {
      tick: 3,
      sourceIndex: 2,
      heroId: 1,
      playerKey: 'p',
      weaponEntityIndex: 1,
      effectContextId: 'ctx',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 2,
      rawClip: 4,
      bonusClip: 0,
      ammoFraction: 0,
    },
  ];

  const groups = new Map([
    ['p|1', settled],
  ]);

  const rows =
    deriveStrictAttackTransitionsWithIndex(
      groups,
    );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].combinedLabel, 'ZERO');

  const result =
    inspectShortHorizonSettlement(
      rows[0],
      8,
    );

  assert.equal(
    result.settledPositive,
    true,
  );

  assert.equal(
    result.firstPositiveDelay,
    1,
  );

  assert.equal(
    result.settledDrop,
    1,
  );
});

test('new shot terminates settlement window', () => {
  const transition = {
    settled: [
      {
        tick: 1,
        shotNumber: 2,
        rawClip: -5,
        bonusClip: 0,
        inReload: false,
        ammoFraction: 0,
      },
      {
        tick: 2,
        shotNumber: 3,
        rawClip: 4,
        bonusClip: 0,
        inReload: false,
        ammoFraction: 0,
      },
    ],
    currentIndex: 0,
    currentAmmo:
      combinedLogicalAmmo({
        rawClip: -5,
        bonusClip: 0,
      }),
  };

  const result =
    inspectShortHorizonSettlement(
      transition,
      8,
    );

  assert.equal(
    result.settledPositive,
    false,
  );
});

test('reload terminates settlement window', () => {
  const transition = {
    settled: [
      {
        tick: 1,
        shotNumber: 2,
        rawClip: -5,
        bonusClip: 0,
        inReload: false,
        ammoFraction: 0,
      },
      {
        tick: 2,
        shotNumber: 2,
        rawClip: 10,
        bonusClip: 0,
        inReload: true,
        ammoFraction: 0,
      },
    ],
    currentIndex: 0,
    currentAmmo:
      combinedLogicalAmmo({
        rawClip: -5,
        bonusClip: 0,
      }),
  };

  const result =
    inspectShortHorizonSettlement(
      transition,
      8,
    );

  assert.equal(
    result.settledPositive,
    false,
  );
});

test('summary reports substantial settlement when majority resolve', () => {
  const baseTransition = {
    primaryCovered: true,
    primaryPresent: false,
    combinedLabel: 'ZERO',
    heroId: 1,
    ammoFractionChangedAtAttack: false,
  };

  const rows = [];

  for (let i = 0; i < 6; i++) {
    rows.push({
      ...baseTransition,
      settled: [
        {
          tick: 1,
          shotNumber: 2,
          rawClip: -5,
          bonusClip: 0,
          inReload: false,
          ammoFraction: 0,
        },
        {
          tick: 2,
          shotNumber: 2,
          rawClip: 4,
          bonusClip: 0,
          inReload: false,
          ammoFraction: 0,
        },
      ],
      currentIndex: 0,
      currentAmmo:
        combinedLogicalAmmo({
          rawClip: -5,
          bonusClip: 0,
        }),
    });
  }

  for (let i = 0; i < 4; i++) {
    rows.push({
      ...baseTransition,
      settled: [
        {
          tick: 1,
          shotNumber: 2,
          rawClip: -5,
          bonusClip: 0,
          inReload: false,
          ammoFraction: 0,
        },
      ],
      currentIndex: 0,
      currentAmmo:
        combinedLogicalAmmo({
          rawClip: -5,
          bonusClip: 0,
        }),
    });
  }

  const result =
    summarizeZeroSettlements(rows);

  assert.equal(
    result.classification,
    'SHORT_HORIZON_SETTLEMENT_EXPLAINS_SUBSTANTIAL_STRICT_ZEROS',
  );
});
