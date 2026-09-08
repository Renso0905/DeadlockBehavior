import test from 'node:test';
import assert from 'node:assert/strict';

import {
  READY_SCHEDULE_REPLICATION_THRESHOLDS,
  summarizeReadyScheduleReplication,
  weightedAlignment,
} from '../src/player-state/ready-schedule-replication.mjs';

function alignment(aligned, comparable) {
  return { aligned, comparable, alignmentRate: comparable > 0 ? aligned / comparable : null };
}

function replay(name, {
  sustained = 1000,
  readyRate = 0.99,
  boundaryN = 200,
  boundaryRate = 0.99,
  positiveN = 300,
  positiveRate = 0.99,
  nonBurstN = 500,
  nonBurstRate = 0.99,
  timingRate = 0.99,
  staticRate = 0.70,
  integrityPass = true,
} = {}) {
  const a = (n, rate) => alignment(Math.round(n * rate), n);
  return {
    replay: name,
    integrityPass,
    counts: { sustainedPairs: sustained },
    observed: {
      aggregate: a(sustained, readyRate),
      burstBoundary: a(boundaryN, boundaryRate),
      burstPositive: a(positiveN, positiveRate),
      nonBurst: a(nonBurstN, nonBurstRate),
      lastAttackDeltaVsReplaySpacing: a(boundaryN, timingRate),
      nextLastAttackVsCurrentNextPrimary: a(boundaryN, timingRate),
    },
    staticModelV02: {
      aggregate: a(sustained, staticRate),
      burstBoundary: a(boundaryN, staticRate),
      burstPositive: a(positiveN, staticRate),
      nonBurst: a(nonBurstN, staticRate),
    },
  };
}

test('weighted alignment pools counts rather than averaging replay percentages', () => {
  assert.deepEqual(weightedAlignment([alignment(90, 100), alignment(1, 1)]), {
    aligned: 91,
    comparable: 101,
    alignmentRate: 91 / 101,
  });
});

test('five strong independent replays replicate observed carrier even when static model is weak', () => {
  const rows = ['rep01', 'rep02', 'rep03', 'rep04', 'rep05'].map(name => replay(name, { staticRate: 0.50 }));
  const summary = summarizeReadyScheduleReplication(rows);
  assert.equal(summary.strongReplication, true);
  assert.equal(summary.classification, 'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS');
});

test('one replay below frozen observed-ready threshold blocks cross-replay replication', () => {
  const rows = ['rep01', 'rep02', 'rep03', 'rep04', 'rep05'].map(name => replay(name));
  rows[3] = replay('rep04', { readyRate: 0.94 });
  const summary = summarizeReadyScheduleReplication(rows);
  assert.equal(summary.strongReplication, false);
  assert.equal(summary.perReplay.find(row => row.replay === 'rep04').pass, false);
});

test('an underpowered replay cannot silently count as an independent replication', () => {
  const rows = ['rep01', 'rep02', 'rep03', 'rep04', 'rep05'].map(name => replay(name));
  rows[1] = replay('rep02', { sustained: READY_SCHEDULE_REPLICATION_THRESHOLDS.minimumReplaySustainedPairs - 1 });
  const summary = summarizeReadyScheduleReplication(rows);
  assert.equal(summary.strongReplication, false);
  assert.equal(summary.perReplay[1].enoughPairs, false);
});

test('unsampled regime is neutral but a sufficiently sampled contradictory regime blocks replication', () => {
  const unsampled = ['rep01', 'rep02', 'rep03', 'rep04', 'rep05'].map(name => replay(name, { boundaryN: 0 }));
  assert.equal(summarizeReadyScheduleReplication(unsampled).sampledRegimeChecks.find(row => row.name === 'burstBoundary').pass, true);

  const contradictory = ['rep01', 'rep02', 'rep03', 'rep04', 'rep05'].map(name => replay(name, { boundaryRate: 0.80 }));
  const summary = summarizeReadyScheduleReplication(contradictory);
  assert.equal(summary.sampledRegimeChecks.find(row => row.name === 'burstBoundary').sampled, true);
  assert.equal(summary.strongReplication, false);
});
