import test from 'node:test';
import assert from 'node:assert/strict';

import {
  phaseCorrectedCarrierPresent,
  summarizePhaseCorrectedCarrier,
} from '../src/player-state/phase-corrected-slide-carrier.mjs';

test('current present carrier remains present under phase correction', () => {
  assert.equal(
    phaseCorrectedCarrierPresent({
      currentCarrierPresent: true,
      exactExitAtAttack: false,
    }),
    true,
  );
});

test('exact same-tick exit preserves pre-transition carrier semantics', () => {
  assert.equal(
    phaseCorrectedCarrierPresent({
      currentCarrierPresent: false,
      exactExitAtAttack: true,
    }),
    true,
  );
});

test('ordinary absent carrier remains absent', () => {
  assert.equal(
    phaseCorrectedCarrierPresent({
      currentCarrierPresent: false,
      exactExitAtAttack: false,
    }),
    false,
  );
});

test('strong exact-exit zero pattern supports phase rule', () => {
  const rows = [];

  for (let i = 0; i < 56; i++) {
    rows.push({
      primaryCovered: true,
      primaryPresent: false,
      exactExitAtAttack: true,
      combinedLabel: 'ZERO',
      heroId: 58,
    });
  }

  for (let i = 0; i < 12; i++) {
    rows.push({
      primaryCovered: true,
      primaryPresent: false,
      exactExitAtAttack: false,
      combinedLabel: 'ZERO',
      heroId: 1,
    });
  }

  for (let i = 0; i < 30000; i++) {
    rows.push({
      primaryCovered: true,
      primaryPresent: false,
      exactExitAtAttack: false,
      combinedLabel: 'POSITIVE',
      heroId: 1,
    });
  }

  const result =
    summarizePhaseCorrectedCarrier(
      rows,
    );

  assert.equal(
    result.exactExit.zero,
    56,
  );

  assert.equal(
    result.exactExit.positive,
    0,
  );

  assert.equal(
    result.correctedPartition.zero,
    12,
  );

  assert.equal(
    result.classification,
    'PRE_TRANSITION_CARRIER_ATTACK_TICK_PHASE_RULE_STRONGLY_SUPPORTED_ON_TEST',
  );
});

test('exact-exit positive controls block strong phase classification', () => {
  const rows = [];

  for (let i = 0; i < 56; i++) {
    rows.push({
      primaryCovered: true,
      primaryPresent: false,
      exactExitAtAttack: true,
      combinedLabel: 'ZERO',
      heroId: 58,
    });
  }

  rows.push({
    primaryCovered: true,
    primaryPresent: false,
    exactExitAtAttack: true,
    combinedLabel: 'POSITIVE',
    heroId: 1,
  });

  const result =
    summarizePhaseCorrectedCarrier(
      rows,
    );

  assert.equal(
    result.classification,
    'PRE_TRANSITION_CARRIER_ATTACK_TICK_PHASE_RULE_REMAINS_UNRESOLVED',
  );
});
