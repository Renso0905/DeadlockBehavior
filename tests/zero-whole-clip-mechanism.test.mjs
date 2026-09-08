import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyZeroDropPattern,
  deriveShotTransitions,
  normalizeZeroDropEvent,
  summarizeZeroDropMechanism,
  zeroRunLengths,
} from '../src/player-state/zero-whole-clip-mechanism.mjs';

function rawForWhole(value) {
  return value % 2 === 0
    ? value / 2
    : -(value + 1) / 2;
}

function row({
  tick,
  whole,
  shotNumber,
  lastAttackTime,
  heroId = 58,
  mode = 1,
}) {
  return normalizeZeroDropEvent({
    tick,
    heroId,
    playerKey: 'P1',
    weaponEntityIndex: 100,
    effectContextId: 'CTX',
    observedWeaponState: {
      clip: rawForWhole(whole),
      shotNumber,
      lastAttackTime,
      activeFireMode: mode,
      inReload: false,
      burstShotsRemaining: 0,
      continuousShots: shotNumber,
    },
  });
}

test('two zero drops followed by one whole decrement produces zero-run mode 2', () => {
  const transitions = [
    { wholeSign: 'ZERO', shotAdvance: 1 },
    { wholeSign: 'ZERO', shotAdvance: 1 },
    { wholeSign: 'POSITIVE', shotAdvance: 1 },
    { wholeSign: 'ZERO', shotAdvance: 1 },
    { wholeSign: 'ZERO', shotAdvance: 1 },
    { wholeSign: 'POSITIVE', shotAdvance: 1 },
  ];

  const result = zeroRunLengths(transitions);

  assert.equal(result.mode, 2);
  assert.equal(result.median, 2);
});

test('shotNumber advance with unchanged whole clip is retained as zero-drop transition', () => {
  const events = [
    row({
      tick: 1,
      whole: 10,
      shotNumber: 1,
      lastAttackTime: 1,
    }),
    row({
      tick: 2,
      whole: 10,
      shotNumber: 2,
      lastAttackTime: 2,
    }),
  ];

  const transitions = deriveShotTransitions(events);

  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].wholeSign, 'ZERO');
  assert.equal(transitions[0].lastAttackConfirmed, true);
});

test('summary identifies a dominant hero-specific zero-drop group', () => {
  const rows = [];

  for (let i = 0; i < 90; i++) {
    rows.push({
      heroId: 58,
      activeFireMode: 1,
      shotAdvance: 1,
      wholeDrop: i % 3 === 2 ? 1 : 0,
      wholeSign: i % 3 === 2 ? 'POSITIVE' : 'ZERO',
      lastAttackConfirmed: true,
      signalProvenance: 'SHOT_NUMBER_AND_LAST_ATTACK',
    });
  }

  for (let i = 0; i < 20; i++) {
    rows.push({
      heroId: 1,
      activeFireMode: 1,
      shotAdvance: 1,
      wholeDrop: 1,
      wholeSign: 'POSITIVE',
      lastAttackConfirmed: true,
      signalProvenance: 'SHOT_NUMBER_AND_LAST_ATTACK',
    });
  }

  const summary = summarizeZeroDropMechanism(rows);

  assert.equal(summary.topZeroGroup.heroId, 58);
  assert.equal(summary.topZeroGroup.zeroRate, 2 / 3);
  assert.equal(summary.topZeroShare, 1);
});

test('static multiplicity matching observed 3-to-1 ratio yields multi-element classification', () => {
  const summary = {
    topZeroShare: 0.9,
  };

  const rowsWithStatic = [
    {
      heroId: 58,
      activeFireMode: 1,
      zeroRate: 2 / 3,
      shotAdvancePerPositiveWholeUnit: 3,
      closestStaticMultiplicity: {
        value: 3,
        error: 0,
      },
    },
  ];

  assert.equal(
    classifyZeroDropPattern(summary, rowsWithStatic),
    'ZERO_WHOLE_DROPS_DOMINATED_BY_HERO_SPECIFIC_MULTI_ELEMENT_SHOT_MECHANIC',
  );
});

test('concentrated zero drops without static match remain hero-specific but unresolved', () => {
  const summary = {
    topZeroShare: 0.9,
  };

  const rowsWithStatic = [
    {
      heroId: 58,
      activeFireMode: 1,
      zeroRate: 2 / 3,
      shotAdvancePerPositiveWholeUnit: 3,
      closestStaticMultiplicity: null,
    },
  ];

  assert.equal(
    classifyZeroDropPattern(summary, rowsWithStatic),
    'ZERO_WHOLE_DROPS_DOMINATED_BY_HERO_SPECIFIC_WEAPON_MECHANIC_STATIC_MAPPING_UNRESOLVED',
  );
});
