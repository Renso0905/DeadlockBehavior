import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCadenceV02Summary,
  classifyCadenceAlignmentV02,
  summarizeHeroStaticV02,
  weightedAlignment,
} from '../src/player-state/cadence-alignment-v02.mjs';

test('weighted static model combines boundary, intra-burst, and non-burst evidence', () => {
  const row = weightedAlignment([
    { aligned: 90, comparable: 100 },
    { aligned: 100, comparable: 100 },
    { aligned: 95, comparable: 100 },
  ]);
  assert.equal(row.aligned, 285);
  assert.equal(row.comparable, 300);
  assert.equal(row.alignmentRate, 0.95);
});

test('cadence V02 treats ready schedule as observed carrier and static intervals as explanatory', () => {
  const artifact = fixture();
  const summary = buildCadenceV02Summary(artifact);
  assert.equal(summary.observedRuntimeCarrier.aggregate.aligned, 300);
  assert.equal(summary.observedRuntimeCarrier.aggregate.comparable, 300);
  assert.equal(summary.staticExplanatoryModelV02.burstBoundary.expectedKind, 'CYCLE_PLUS_INTRA');
  assert.equal(summary.staticExplanatoryModelV02.burstPositive.expectedKind, 'INTRA_BURST_CYCLE_TIME');
  assert.equal(summary.staticExplanatoryModelV02.nonBurst.expectedKind, 'NON_BURST_CYCLE');
});

test('strong observed carrier plus frozen-threshold static V02 yields cross-replay-ready classification', () => {
  const summary = buildCadenceV02Summary(fixture());
  assert.equal(
    classifyCadenceAlignmentV02(summary),
    'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_READY_FOR_CROSS_REPLAY_VALIDATION',
  );
});

test('static explanatory weakness does not erase a strong observed runtime carrier', () => {
  const artifact = fixture();
  artifact.actualSpacingCandidateAlignment.burstBoundarySustained[1].aligned = 50;
  artifact.actualSpacingCandidateAlignment.burstBoundarySustained[1].alignmentRate = 0.5;
  const summary = buildCadenceV02Summary(artifact);
  assert.equal(
    classifyCadenceAlignmentV02(summary),
    'OBSERVED_READY_SCHEDULE_STRONG_BUT_STATIC_EXPLANATORY_MODEL_REMAINS_PARTIAL',
  );
});

test('hero composite uses cycle-plus-intra at burst boundary and intra-burst within burst', () => {
  const hero = {
    regime: 'BURST',
    burstBoundarySustainedCandidateSummary: [{ kind: 'CYCLE_PLUS_INTRA', aligned: 90, comparable: 100 }],
    burstPositiveSustainedCandidateSummary: [{ kind: 'INTRA_BURST_CYCLE_TIME', aligned: 200, comparable: 200 }],
  };
  const summary = summarizeHeroStaticV02(hero);
  assert.equal(summary.aligned, 290);
  assert.equal(summary.comparable, 300);
  assert.equal(summary.alignmentRate, 290 / 300);
});

function fixture() {
  return {
    actualSpacingCandidateAlignment: {
      burstBoundarySustained: [
        { kind: 'CURRENT_READY_DELAY', aligned: 100, comparable: 100, alignmentRate: 1 },
        { kind: 'CYCLE_PLUS_INTRA', aligned: 93, comparable: 100, alignmentRate: 0.93 },
      ],
      burstPositiveSustained: [
        { kind: 'CURRENT_READY_DELAY', aligned: 100, comparable: 100, alignmentRate: 1 },
        { kind: 'INTRA_BURST_CYCLE_TIME', aligned: 100, comparable: 100, alignmentRate: 1 },
      ],
      nonBurstSustained: [
        { kind: 'CURRENT_READY_DELAY', aligned: 100, comparable: 100, alignmentRate: 1 },
        { kind: 'NON_BURST_CYCLE', aligned: 95, comparable: 100, alignmentRate: 0.95 },
      ],
    },
    timingFieldCrossChecks: {
      burstBoundarySustained: {
        lastAttackDeltaVsActualSpacing: { aligned: 100, comparable: 100, alignmentRate: 1 },
        nextAttackScheduledAtCurrentNextPrimary: { aligned: 100, comparable: 100, alignmentRate: 1 },
      },
    },
  };
}
