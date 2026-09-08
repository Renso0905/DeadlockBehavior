import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exactCadenceRegimeKey,
  matchExactCadenceRegimes,
  transitionConfounds,
} from '../src/player-state/effective-weapon-cadence-regime.mjs';

test('exact cadence regime distinguishes burst remaining within the same fire mode', () => {
  const a = event({ level: 3, continuous: 2, burst: 1, ready: 0.1 });
  const b = event({ level: 3, continuous: 2, burst: 0, ready: 0.1 });
  assert.notEqual(exactCadenceRegimeKey(a), exactCadenceRegimeKey(b));
});

test('exact cadence regime distinguishes continuous-shot state', () => {
  const a = event({ level: 3, continuous: 2, burst: 0, ready: 0.1 });
  const b = event({ level: 3, continuous: 3, burst: 0, ready: 0.1 });
  assert.notEqual(exactCadenceRegimeKey(a), exactCadenceRegimeKey(b));
});

test('exact matched runtime regime recovers predicted shorter ready delay', () => {
  const before = [event({ level: 3, continuous: 2, burst: 0, ready: 0.10 })];
  const after = [event({ level: 3, continuous: 2, burst: 0, ready: 0.08 })];
  const result = matchExactCadenceRegimes(before, after, 'READY_DELAY_SHOULD_DECREASE');
  assert.equal(result.matchedRegimes, 1);
  assert.equal(result.agreements, 1);
  assert.equal(result.agreementRate, 1);
});

test('level changes prevent level-controlled matching but remain visible without level', () => {
  const before = [event({ level: 3, continuous: 2, burst: 0, ready: 0.10 })];
  const after = [event({ level: 4, continuous: 2, burst: 0, ready: 0.08 })];
  assert.equal(matchExactCadenceRegimes(before, after, 'READY_DELAY_SHOULD_DECREASE', { includeLevel: true }).matchedRegimes, 0);
  assert.equal(matchExactCadenceRegimes(before, after, 'READY_DELAY_SHOULD_DECREASE', { includeLevel: false }).matchedRegimes, 1);
});

test('transition confounds identifies level change and continuous counter reset', () => {
  const before = [event({ tick: 100, level: 3, continuous: 8, burst: 0, ready: 0.1 })];
  const after = [event({ tick: 200, level: 4, continuous: 1, burst: 0, ready: 0.08 })];
  const result = transitionConfounds(before, after);
  assert.equal(result.levelChanged, true);
  assert.equal(result.continuousCounterReset, true);
  assert.equal(result.gapTicks, 100);
});

function event({ tick = 1, level, continuous, burst, ready }) {
  return {
    tick,
    observedPlayerWeaponContext: { level },
    observedWeaponState: { activeFireMode: 0, continuousShots: continuous, burstShotsRemaining: burst },
    transition: { readyDelayCandidateSeconds: ready },
  };
}
