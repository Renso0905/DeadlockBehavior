import test from 'node:test';
import assert from 'node:assert/strict';

import {
  burstStaticCandidates,
  compareBurstBoundaryCandidates,
  classifyBurstCounterStep,
  classifyBurstBoundarySemantics,
  summarizeCandidateAlignment,
  summarizeCounterSteps,
} from '../src/player-state/burst-boundary-diagnostic.mjs';

function weapon() {
  return {
    weaponInfo: {
      cadenceRegime: {
        regime: 'BURST',
        cycleTimeSeconds: 0.60,
        intraBurstCycleTimeSeconds: 0.10,
        burstShotCount: 3,
      },
      fields: {},
    },
  };
}

function row(ready, remaining) {
  return {
    transition: { readyDelayCandidateSeconds: ready },
    observedWeaponState: { burstShotsRemaining: remaining },
  };
}

test('burst static candidates preserve full cycle, intra-burst, and derived remainder hypotheses', () => {
  const out = burstStaticCandidates(weapon());
  assert.equal(out.regime, 'BURST');
  assert.equal(out.cycleTimeSeconds, 0.60);
  assert.equal(out.intraBurstCycleTimeSeconds, 0.10);
  assert.equal(out.burstShotCount, 3);
  assert.ok(Math.abs(out.postBurstRemainderSeconds - 0.40) < 1e-12);
});

test('zero-remaining boundary can support full-cycle timing without forcing the remainder model', () => {
  const out = compareBurstBoundaryCandidates(row(0.60, 0), weapon());
  assert.equal(out.boundaryCandidate, true);
  assert.equal(out.nearestCandidateKind, 'FULL_CYCLE_TIME');
  const full = out.candidateRows.find(candidate => candidate.kind === 'FULL_CYCLE_TIME');
  const remainder = out.candidateRows.find(candidate => candidate.kind === 'POST_BURST_REMAINDER');
  assert.equal(full.alignedWithinTolerance, true);
  assert.equal(remainder.alignedWithinTolerance, false);
});

test('positive burst-remaining row still identifies intra-burst interval', () => {
  const out = compareBurstBoundaryCandidates(row(0.10, 1), weapon());
  assert.equal(out.boundaryCandidate, false);
  assert.equal(out.nearestCandidateKind, 'INTRA_BURST_CYCLE_TIME');
});

test('counter sequence 2 to 1 to 0 to 2 is recognized as post-shot descent and reset', () => {
  const a = classifyBurstCounterStep(row(0.10, 2), row(0.10, 1), weapon());
  const b = classifyBurstCounterStep(row(0.10, 1), row(0.60, 0), weapon());
  const c = classifyBurstCounterStep(row(0.60, 0), row(0.10, 2), weapon());
  assert.equal(a.classification, 'DESCEND_ONE');
  assert.equal(b.classification, 'DESCEND_ONE');
  assert.equal(c.classification, 'ZERO_TO_BURST_RESET');
  assert.equal(a.expectedPostShotSequenceStep, true);
  assert.equal(b.expectedPostShotSequenceStep, true);
  assert.equal(c.expectedPostShotSequenceStep, true);
});

test('strong full-cycle boundary evidence plus clean counter sequence yields explicit classification', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    diagnostic: compareBurstBoundaryCandidates(row(0.60, 0), weapon()),
    index,
  }));
  const candidateSummary = summarizeCandidateAlignment(rows);
  const steps = Array.from({ length: 30 }, () => ({
    diagnostic: classifyBurstCounterStep(row(0.60, 0), row(0.10, 2), weapon()),
  }));
  const counterSummary = summarizeCounterSteps(steps);
  assert.equal(
    classifyBurstBoundarySemantics({
      boundaryCandidateSummary: candidateSummary,
      counterSummary,
    }),
    'BURST_ZERO_REMAINING_IS_POST_SHOT_BOUNDARY_AND_READY_DELAY_MATCHES_FULL_CYCLE_TIME',
  );
});
