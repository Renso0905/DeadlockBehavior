import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareLegacyAndStrict,
  deriveStrictAttackTransitions,
  groupStrictWeaponChronology,
  summarizeStrictChronology,
} from '../src/player-state/strict-ammo-chronology-diagnostic.mjs';

test('strict chronology does not reconnect repeated effect contexts', () => {
  const events = [
    {
      sourceIndex: 0,
      tick: 1,
      playerKey: 'p',
      weaponEntityIndex: 10,
      heroId: 1,
      effectContextId: 'A',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 1,
      rawClip: -5,
      bonusClip: 0,
    },
    {
      sourceIndex: 1,
      tick: 2,
      playerKey: 'p',
      weaponEntityIndex: 10,
      heroId: 1,
      effectContextId: 'B',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 2,
      rawClip: 4,
      bonusClip: 0,
    },
    {
      sourceIndex: 2,
      tick: 3,
      playerKey: 'p',
      weaponEntityIndex: 10,
      heroId: 1,
      effectContextId: 'A',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 3,
      rawClip: -4,
      bonusClip: 0,
    },
  ];

  const rows =
    deriveStrictAttackTransitions(
      groupStrictWeaponChronology(events),
    );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].previousEffectContextId, 'A');
  assert.equal(rows[0].currentEffectContextId, 'B');
  assert.equal(rows[1].previousEffectContextId, 'B');
  assert.equal(rows[1].currentEffectContextId, 'A');
});

test('strict chronological ordinary shots remain positive', () => {
  const events = [
    {
      sourceIndex: 0,
      tick: 1,
      playerKey: 'p',
      weaponEntityIndex: 10,
      heroId: 1,
      effectContextId: 'A',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 1,
      rawClip: -5,
      bonusClip: 0,
    },
    {
      sourceIndex: 1,
      tick: 2,
      playerKey: 'p',
      weaponEntityIndex: 10,
      heroId: 1,
      effectContextId: 'A',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 2,
      rawClip: 4,
      bonusClip: 0,
    },
  ];

  const rows =
    deriveStrictAttackTransitions(
      groupStrictWeaponChronology(events),
    );

  assert.equal(rows[0].combinedDrop, 1);
  assert.equal(rows[0].combinedLabel, 'POSITIVE');
});

test('reload state between shots prevents a false cross-reload attack transition', () => {
  const events = [
    {
      sourceIndex: 0,
      tick: 1,
      playerKey: 'p',
      weaponEntityIndex: 10,
      heroId: 1,
      effectContextId: 'A',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 1,
      rawClip: -5,
      bonusClip: 0,
    },
    {
      sourceIndex: 1,
      tick: 2,
      playerKey: 'p',
      weaponEntityIndex: 10,
      heroId: 1,
      effectContextId: 'B',
      activeFireMode: 1,
      inReload: true,
      shotNumber: 1,
      rawClip: -5,
      bonusClip: 0,
    },
    {
      sourceIndex: 2,
      tick: 3,
      playerKey: 'p',
      weaponEntityIndex: 10,
      heroId: 1,
      effectContextId: 'A',
      activeFireMode: 1,
      inReload: false,
      shotNumber: 2,
      rawClip: -20,
      bonusClip: 0,
    },
  ];

  const rows =
    deriveStrictAttackTransitions(
      groupStrictWeaponChronology(events),
    );

  assert.equal(rows.length, 0);
});

test('strict summary preserves residuals that remain genuinely adjacent', () => {
  const summary =
    summarizeStrictChronology([
      {
        replayName: 'rep01',
        heroId: 35,
        covered: true,
        carrierPresent: false,
        combinedLabel: 'ZERO',
        combinedDrop: 0,
        shotAdvance: 8,
        tickGap: 1,
        effectContextChanged: false,
        fireModeChanged: false,
        lastReloadStartTimeChanged: false,
        reloadAvailableTimeChanged: false,
      },
    ]);

  assert.equal(summary.residual, 1);
  assert.equal(summary.zero, 1);
});

test('large residual collapse is classified as context-grouping artifact', () => {
  const result =
    compareLegacyAndStrict({
      legacyResidual: 490,
      strictResidual: 100,
    });

  assert.ok(result.reduction > 0.5);
  assert.equal(
    result.classification,
    'NONCONTIGUOUS_CONTEXT_GROUPING_EXPLAINS_SUBSTANTIAL_LEGACY_RESIDUALS',
  );
});
