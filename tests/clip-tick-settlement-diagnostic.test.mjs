import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coalesceFinalStatePerTick,
  diagnoseSettledShotTransitions,
  normalizeSettlementEvent,
  summarizePhaseRows,
  zigzagReencode,
} from '../src/player-state/clip-tick-settlement-diagnostic.mjs';

function rawForUnsigned(value) {
  return value % 2 === 0
    ? value / 2
    : -(value + 1) / 2;
}

function row({
  sourceIndex,
  tick,
  unsignedClip,
  shotNumber,
  changedFields = [],
  inReload = false,
}) {
  return normalizeSettlementEvent({
    tick,
    playerKey: 'P1',
    heroId: 1,
    weaponEntityIndex: 100,
    effectContextId: 'CTX',
    changedFields,
    observedWeaponState: {
      clip: rawForUnsigned(unsignedClip),
      shotNumber,
      inReload,
      activeFireMode: 0,
      lastAttackTime: shotNumber,
    },
  }, sourceIndex);
}

test('ZigZag transform remains frozen from Script177', () => {
  assert.equal(zigzagReencode(-17), 33);
  assert.equal(zigzagReencode(16), 32);
});

test('final state per tick removes intermediate shot-new clip-old mutation phase', () => {
  const events = [
    row({
      sourceIndex: 0,
      tick: 10,
      unsignedClip: 33,
      shotNumber: 10,
      changedFields: [],
    }),

    // Same tick: shot number updates first while clip is still old.
    row({
      sourceIndex: 1,
      tick: 11,
      unsignedClip: 33,
      shotNumber: 11,
      changedFields: ['m_nShotNumber'],
    }),

    // Same tick: clip then settles to the new post-shot value.
    row({
      sourceIndex: 2,
      tick: 11,
      unsignedClip: 32,
      shotNumber: 11,
      changedFields: ['m_iClip'],
    }),
  ];

  const { settled, phaseRows } =
    coalesceFinalStatePerTick(events);

  assert.equal(settled.length, 2);
  assert.equal(settled[1].transformedClip, 32);
  assert.equal(settled[1].shotNumber, 11);

  const summary =
    diagnoseSettledShotTransitions(settled);

  assert.equal(summary.observations, 1);
  assert.equal(
    summary.transformed.positiveIntegerPerShotRate,
    1,
  );

  const phase = summarizePhaseRows(phaseRows);
  assert.equal(phase.bothFieldsChangedTicks, 1);
  assert.equal(phase.splitFieldMutationTicks, 1);
  assert.equal(phase.splitAmongBothRate, 1);
});

test('same-mutation clip and shot update is not falsely called split phase', () => {
  const events = [
    row({
      sourceIndex: 0,
      tick: 20,
      unsignedClip: 20,
      shotNumber: 5,
    }),
    row({
      sourceIndex: 1,
      tick: 21,
      unsignedClip: 19,
      shotNumber: 6,
      changedFields: ['m_iClip', 'm_nShotNumber'],
    }),
  ];

  const { phaseRows } =
    coalesceFinalStatePerTick(events);

  const phase = summarizePhaseRows(phaseRows);

  assert.equal(phase.bothFieldsChangedTicks, 1);
  assert.equal(phase.splitFieldMutationTicks, 0);
});

test('tick-settled multi-shot transition computes per-shot transformed decrement', () => {
  const events = [
    row({
      sourceIndex: 0,
      tick: 30,
      unsignedClip: 40,
      shotNumber: 10,
    }),
    row({
      sourceIndex: 1,
      tick: 31,
      unsignedClip: 36,
      shotNumber: 12,
      changedFields: ['m_iClip', 'm_nShotNumber'],
    }),
  ];

  const { settled } =
    coalesceFinalStatePerTick(events);

  const result =
    diagnoseSettledShotTransitions(settled);

  assert.equal(result.observations, 1);
  assert.equal(
    result.rows[0].transformedDropPerShot,
    2,
  );
  assert.equal(
    result.transformed.positiveIntegerPerShotRate,
    1,
  );
});

test('reload endpoints are not treated as firing clip-consumption transitions', () => {
  const events = [
    row({
      sourceIndex: 0,
      tick: 40,
      unsignedClip: 2,
      shotNumber: 10,
      inReload: true,
    }),
    row({
      sourceIndex: 1,
      tick: 41,
      unsignedClip: 30,
      shotNumber: 10,
      inReload: false,
      changedFields: ['m_iClip', 'm_bInReload'],
    }),
  ];

  const { settled } =
    coalesceFinalStatePerTick(events);

  const result =
    diagnoseSettledShotTransitions(settled);

  assert.equal(result.observations, 0);
});
