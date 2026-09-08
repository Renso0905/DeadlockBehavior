import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildObservedDischargePair,
  classifyObservedSpacing,
  staticCadenceCandidates,
  summarizeCandidateRows,
  summarizeTimingFieldChecks,
} from '../src/player-state/actual-discharge-spacing.mjs';

const burstWeapon = {
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

function row({ tick, remaining, last, nextPrimary, shot = 1, continuous = 1 }) {
  return {
    tick,
    playerKey: 'P1',
    heroId: 2,
    weaponEntityIndex: 100,
    effectContextId: 'CTX',
    observedWeaponState: {
      activeFireMode: 0,
      burstShotsRemaining: remaining,
      lastAttackTime: last,
      nextPrimaryAttack: nextPrimary,
      shotNumber: shot,
      continuousShots: continuous,
    },
    transition: {
      readyDelayCandidateSeconds: nextPrimary - last,
    },
  };
}

test('burst candidates retain prior hypotheses plus pre-registered cycle-plus-intra candidate', () => {
  const result = staticCadenceCandidates(burstWeapon);
  assert.equal(result.cycleTimeSeconds, 0.25);
  assert.equal(result.intraBurstCycleTimeSeconds, 0.08);
  assert.ok(Math.abs(result.postBurstRemainderSeconds - 0.09) < 1e-12);
  assert.ok(Math.abs(result.cyclePlusIntraSeconds - 0.33) < 1e-12);
});

test('actual burst-boundary spacing can align to cycle plus intra and current ready schedule', () => {
  const current = row({ tick: 1000, remaining: 0, last: 10, nextPrimary: 10.33, shot: 3, continuous: 3 });
  const next = row({ tick: 1021, remaining: 2, last: 10.328125, nextPrimary: 10.408125, shot: 4, continuous: 4 });
  const pair = buildObservedDischargePair(current, next, burstWeapon);
  assert.equal(pair.comparable, true);
  assert.equal(pair.script167CompatibleSustained, true);
  const byKind = new Map(pair.candidateRows.map(x => [x.kind, x]));
  assert.equal(byKind.get('CYCLE_PLUS_INTRA').alignedWithinTolerance, true);
  assert.equal(byKind.get('FULL_CYCLE_TIME').alignedWithinTolerance, false);
  assert.equal(byKind.get('CURRENT_READY_DELAY').alignedWithinTolerance, true);
  assert.equal(pair.timingFieldChecks.nextAttackScheduledAtCurrentNextPrimary.alignedWithinTolerance, true);
});

test('positive-remaining burst spacing aligns to intra-burst interval', () => {
  const current = row({ tick: 1000, remaining: 2, last: 10, nextPrimary: 10.08, shot: 1, continuous: 1 });
  const next = row({ tick: 1005, remaining: 1, last: 10.078125, nextPrimary: 10.158125, shot: 2, continuous: 2 });
  const pair = buildObservedDischargePair(current, next, burstWeapon);
  const byKind = new Map(pair.candidateRows.map(x => [x.kind, x]));
  assert.equal(byKind.get('INTRA_BURST_CYCLE_TIME').alignedWithinTolerance, true);
  assert.equal(byKind.get('FULL_CYCLE_TIME').alignedWithinTolerance, false);
});

test('timing-field summary checks successive lastAttack against observed tick spacing', () => {
  const a = buildObservedDischargePair(
    row({ tick: 1000, remaining: 2, last: 10, nextPrimary: 10.08 }),
    row({ tick: 1005, remaining: 1, last: 10.078125, nextPrimary: 10.158125, shot: 2 }),
    burstWeapon,
  );
  const summary = summarizeTimingFieldChecks([a]);
  assert.equal(summary.lastAttackDeltaVsActualSpacing.comparable, 1);
  assert.equal(summary.lastAttackDeltaVsActualSpacing.aligned, 1);
});

test('classification requires observed boundary spacing, ready schedule, and intra-burst controls', () => {
  const makeSummary = (kind, rate, n = 200) => ({ kind, comparable: n, aligned: Math.round(rate * n), alignmentRate: rate });
  const result = classifyObservedSpacing({
    burstPositiveSustained: [makeSummary('INTRA_BURST_CYCLE_TIME', 1)],
    burstBoundarySustained: [
      makeSummary('CYCLE_PLUS_INTRA', 0.96),
      makeSummary('CURRENT_READY_DELAY', 0.99),
      makeSummary('FULL_CYCLE_TIME', 0.02),
    ],
    nonBurstSustained: [],
    boundaryTiming: {
      nextAttackScheduledAtCurrentNextPrimary: { comparable: 200, aligned: 195, alignmentRate: 0.975 },
    },
  });
  assert.equal(result, 'ACTUAL_BURST_SPACING_SUPPORTS_CYCLE_PLUS_INTRA_RUNTIME_BOUNDARY_SCHEDULE');
});
