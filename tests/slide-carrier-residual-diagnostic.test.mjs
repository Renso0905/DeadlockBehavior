import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyResidualConcentration,
  deriveDetailedAttackTransitions,
  groupDetailedWeaponEvents,
  normalizeDetailedWeaponEvent,
  summarizeCarrierAbsentResiduals,
} from '../src/player-state/slide-carrier-residual-diagnostic.mjs';

test('detailed transition preserves zero and negative whole-clip outcomes', () => {
  const events = [
    normalizeDetailedWeaponEvent({
      tick: 1,
      heroId: 1,
      playerKey: 'p',
      weaponEntityIndex: 10,
      effectContextId: 'ctx',
      observedWeaponState: {
        clip: 5,
        inReload: false,
        shotNumber: 1,
        lastAttackTime: 1,
      },
    }),
    normalizeDetailedWeaponEvent({
      tick: 2,
      heroId: 1,
      playerKey: 'p',
      weaponEntityIndex: 10,
      effectContextId: 'ctx',
      observedWeaponState: {
        clip: 5,
        inReload: false,
        shotNumber: 2,
        lastAttackTime: 2,
      },
    }),
    normalizeDetailedWeaponEvent({
      tick: 3,
      heroId: 1,
      playerKey: 'p',
      weaponEntityIndex: 10,
      effectContextId: 'ctx',
      observedWeaponState: {
        clip: 6,
        inReload: false,
        shotNumber: 3,
        lastAttackTime: 3,
      },
    }),
  ];

  const rows =
    deriveDetailedAttackTransitions(
      groupDetailedWeaponEvents(events),
    );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, 'ZERO');
  assert.equal(rows[1].label, 'NEGATIVE');
});

test('residual summary excludes carrier-present attacks', () => {
  const rows = [
    {
      replayName: 'rep01',
      heroId: 1,
      label: 'ZERO',
      covered: true,
      carrierPresent: true,
      effectContextId: 'a',
      activeFireMode: 1,
      featureFlags: {},
    },
    {
      replayName: 'rep01',
      heroId: 1,
      label: 'ZERO',
      covered: true,
      carrierPresent: false,
      effectContextId: 'a',
      activeFireMode: 1,
      featureFlags: {},
    },
    {
      replayName: 'rep01',
      heroId: 2,
      label: 'POSITIVE',
      covered: true,
      carrierPresent: false,
      effectContextId: 'b',
      activeFireMode: 1,
      featureFlags: {},
    },
  ];

  const summary =
    summarizeCarrierAbsentResiduals(rows);

  assert.equal(summary.total, 2);
  assert.equal(summary.partition.ZERO, 1);
  assert.equal(summary.partition.POSITIVE, 1);
});

test('feature enrichment compares residual against positive carrier-absent controls', () => {
  const rows = [];

  for (let i = 0; i < 20; i++) {
    rows.push({
      replayName: 'rep',
      heroId: 1,
      label: 'ZERO',
      covered: true,
      carrierPresent: false,
      effectContextId: 'x',
      activeFireMode: 1,
      featureFlags: {
        bonusClipChanged: true,
      },
    });
  }

  for (let i = 0; i < 100; i++) {
    rows.push({
      replayName: 'rep',
      heroId: 1,
      label: 'POSITIVE',
      covered: true,
      carrierPresent: false,
      effectContextId: 'x',
      activeFireMode: 1,
      featureFlags: {
        bonusClipChanged: false,
      },
    });
  }

  const summary =
    summarizeCarrierAbsentResiduals(rows);

  assert.equal(
    summary.features
      .bonusClipChanged
      .residualRate,
    1,
  );

  assert.equal(
    summary.features
      .bonusClipChanged
      .positiveRate,
    0,
  );
});

test('strong single-hero concentration is explicit', () => {
  const summary = {
    residual: {
      total: 100,
    },
    byHero: [
      {
        residual: 70,
      },
    ],
    byEffectContext: [
      {
        residual: 20,
      },
    ],
  };

  assert.equal(
    classifyResidualConcentration(summary),
    'CARRIER_ABSENT_RESIDUALS_STRONGLY_CONCENTRATED',
  );
});

test('diffuse residuals remain diagnostic-only', () => {
  const summary = {
    residual: {
      total: 100,
    },
    byHero: [
      {
        residual: 10,
      },
    ],
    byEffectContext: [
      {
        residual: 10,
      },
    ],
  };

  assert.equal(
    classifyResidualConcentration(summary),
    'CARRIER_ABSENT_RESIDUALS_DIFFUSE_ACROSS_HEROES_AND_CONTEXTS',
  );
});
