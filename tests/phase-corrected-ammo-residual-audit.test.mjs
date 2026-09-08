import test from 'node:test';
import assert from 'node:assert/strict';

import {
  auditPhaseCorrectedResiduals,
  buildChronologicalAttackTransitions,
  combinedLogicalAmmo,
  phaseCorrectedCarrierPresent,
} from '../src/player-state/phase-corrected-ammo-residual-audit.mjs';

test('combined logical ammo uses both ZigZag counters', () => {
  assert.equal(
    combinedLogicalAmmo({
      rawClip: -5,
      bonusClip: 4,
    }),
    17,
  );
});

test('exact exit is treated as phase-corrected carrier present', () => {
  assert.equal(
    phaseCorrectedCarrierPresent({
      primaryPresent: false,
      exactExitAtAttack: true,
    }),
    true,
  );
});

test('chronological attack transition keeps exact neighboring states', () => {
  const groups =
    new Map([
      [
        'p|1',
        [
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
            rawClip: 4,
            bonusClip: 0,
          },
        ],
      ],
    ]);

  const rows =
    buildChronologicalAttackTransitions(
      groups,
    );

  assert.equal(
    rows.length,
    1,
  );

  assert.equal(
    rows[0].combinedDrop,
    1,
  );

  assert.equal(
    rows[0].previous.tick,
    1,
  );

  assert.equal(
    rows[0].current.tick,
    2,
  );
});

test('audit excludes exact-exit zero from residual set', () => {
  const settled = [
    {
      tick: 1,
      sourceIndex: 0,
      heroId: 58,
      playerKey: 'p',
      weaponEntityIndex: 1,
      effectContextId: 'ctx',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 1,
      rawClip: -5,
      bonusClip: 0,
    },
    {
      tick: 2,
      sourceIndex: 1,
      heroId: 58,
      playerKey: 'p',
      weaponEntityIndex: 1,
      effectContextId: 'ctx',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 2,
      rawClip: -5,
      bonusClip: 0,
    },
  ];

  const result =
    auditPhaseCorrectedResiduals([
      {
        replayName: 'test',
        tick: 2,
        previousTick: 1,
        tickGap: 1,
        heroId: 58,
        playerKey: 'p',
        weaponEntityIndex: 1,
        effectContextId: 'ctx',
        activeFireMode: 1,
        shotAdvance: 1,
        combinedDrop: 0,
        combinedLabel: 'ZERO',
        primaryCovered: true,
        primaryPresent: false,
        exactExitAtAttack: true,
        settled,
        currentIndex: 1,
        previous: {
          ammoFraction: 0,
        },
        current: {
          ammoFraction: 0,
        },
      },
    ]);

  assert.equal(
    result.residual,
    0,
  );
});

test('audit preserves zero and negative residual classes separately', () => {
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
    },
    {
      tick: 3,
      sourceIndex: 2,
      heroId: 25,
      playerKey: 'q',
      weaponEntityIndex: 2,
      effectContextId: 'ctx2',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 2,
      rawClip: -10,
      bonusClip: 0,
    },
  ];

  const rows = [
    {
      replayName: 'test',
      tick: 2,
      previousTick: 1,
      tickGap: 1,
      heroId: 1,
      playerKey: 'p',
      weaponEntityIndex: 1,
      effectContextId: 'ctx',
      activeFireMode: 1,
      shotAdvance: 1,
      combinedDrop: 0,
      combinedLabel: 'ZERO',
      primaryCovered: true,
      primaryPresent: false,
      exactExitAtAttack: false,
      settled,
      currentIndex: 1,
      previous: {
        ammoFraction: 0,
      },
      current: {
        ammoFraction: 0,
      },
    },
    {
      replayName: 'test',
      tick: 3,
      previousTick: 2,
      tickGap: 1,
      heroId: 25,
      playerKey: 'q',
      weaponEntityIndex: 2,
      effectContextId: 'ctx2',
      activeFireMode: 1,
      shotAdvance: 1,
      combinedDrop: -5,
      combinedLabel: 'NEGATIVE',
      primaryCovered: true,
      primaryPresent: false,
      exactExitAtAttack: false,
      settled,
      currentIndex: 2,
      previous: {
        ammoFraction: 0,
      },
      current: {
        ammoFraction: 0,
      },
    },
  ];

  const result =
    auditPhaseCorrectedResiduals(
      rows,
    );

  assert.equal(
    result.zero,
    1,
  );

  assert.equal(
    result.negative,
    1,
  );

  assert.equal(
    result.negativeGainDistribution.count,
    1,
  );
});
