import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyDischargeSignalProvenance,
  findShortHorizonSameShotSettlement,
  oneIntraOffsetCorrection,
  compareSettledReadyToBurstCandidates,
  classifyBoundaryPhaseDiagnostic,
} from '../src/player-state/burst-boundary-phase-diagnostic.mjs';

function weapon() {
  return {
    weaponInfo: {
      cadenceRegime: {
        regime: 'BURST',
        cycleTimeSeconds: 0.25,
        intraBurstCycleTimeSeconds: 0.08,
        burstShotCount: 3,
      },
      fields: {},
    },
  };
}

function row({ tick, shot = 10, last = 1.00, next = 1.33, remaining = 0, changed = [], shotDelta = 1, lastAdvanced = false }) {
  return {
    tick,
    effectContextId: 'ctx',
    changedFields: changed,
    observedWeaponState: {
      shotNumber: shot,
      lastAttackTime: last,
      nextPrimaryAttack: next,
      burstShotsRemaining: remaining,
      activeFireMode: 0,
    },
    transition: {
      shotNumberDelta: shotDelta,
      lastAttackTimeAdvanced: lastAdvanced,
      readyDelayCandidateSeconds: next - last,
      clipDelta: -1,
    },
  };
}

test('boundary signal provenance distinguishes shot-number-only timing phase', () => {
  const out = classifyDischargeSignalProvenance(row({
    tick: 100,
    changed: ['m_nShotNumber', 'm_nBurstShotsRemaining', 'm_flNextPrimaryAttack'],
    shotDelta: 1,
    lastAdvanced: false,
  }));
  assert.equal(out.classification, 'SHOT_NUMBER_ONLY');
  assert.equal(out.changedNextPrimaryField, true);
  assert.equal(out.changedLastAttackField, false);
});

test('one intra-burst subtraction can recover a full-cycle interval without promoting it', () => {
  const current = row({ tick: 100, last: 1.00, next: 1.33 }); // 0.33 = 0.25 + 0.08
  const out = oneIntraOffsetCorrection(current, weapon());
  assert.equal(out.comparable, true);
  assert.ok(Math.abs(out.correctedReadyDelaySeconds - 0.25) < 1e-12);
  assert.equal(out.fullCycleComparison.alignedWithinTolerance, true);
});

test('short-horizon same-shot settlement captures delayed last-attack update', () => {
  const rows = [
    row({ tick: 100, shot: 10, last: 1.00, next: 1.33 }),
    row({ tick: 101, shot: 10, last: 1.08, next: 1.33, changed: ['m_flLastAttackTime'], shotDelta: 0, lastAdvanced: true }),
    row({ tick: 108, shot: 11, last: 1.33, next: 1.41 }),
  ];
  const settled = findShortHorizonSameShotSettlement(rows, 0, { maxTickOffset: 4 });
  assert.equal(settled.lastAttackAdvanced, true);
  assert.equal(settled.tickOffset, 1);
  assert.ok(Math.abs(settled.readyDelaySeconds - 0.25) < 1e-12);
});

test('settled same-shot timing can align to full cycle after current boundary value does not', () => {
  const current = row({ tick: 100, shot: 10, last: 1.00, next: 1.33 });
  const settled = findShortHorizonSameShotSettlement([
    current,
    row({ tick: 101, shot: 10, last: 1.08, next: 1.33, changed: ['m_flLastAttackTime'], shotDelta: 0, lastAdvanced: true }),
  ], 0, { maxTickOffset: 4 });
  const compared = compareSettledReadyToBurstCandidates(settled, current, weapon());
  const full = compared.candidateRows.find(candidate => candidate.kind === 'FULL_CYCLE_TIME');
  assert.equal(full.alignedWithinTolerance, true);
});

test('strong one-intra pattern plus observed settlement yields explicit field-phase classification', () => {
  assert.equal(classifyBoundaryPhaseDiagnostic({
    boundaryCount: 844,
    currentFullCycleAlignmentRate: 0,
    oneIntraSummary: { comparable: 844, alignmentRate: 0.99 },
    settledFullCycleAlignmentRate: 0.96,
    settledComparable: 700,
    timingMutationCount: 700,
  }), 'BURST_BOUNDARY_ONE_INTRA_OFFSET_CONFIRMED_BY_SHORT_HORIZON_FIELD_SETTLEMENT');
});
