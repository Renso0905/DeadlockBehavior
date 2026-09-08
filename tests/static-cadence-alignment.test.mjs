import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyReadyDelayAgainstStatic,
  expectedStaticCadence,
  isCleanExplicitFireRateBaseline,
  selectDominantActiveFireMode,
} from '../src/player-state/static-cadence-alignment.mjs';

function weapon(regime, fields = {}) {
  return {
    weaponInfo: {
      fields,
      cadenceRegime: {
        regime,
        cycleTimeSeconds: fields.m_flCycleTime ?? null,
        intraBurstCycleTimeSeconds: fields.m_flIntraBurstCycleTime ?? null,
        burstShotCount: fields.m_iBurstShotCount ?? null,
      },
    },
  };
}

function row(readyDelayCandidateSeconds, burstShotsRemaining = null) {
  return {
    transition: { readyDelayCandidateSeconds },
    observedWeaponState: { burstShotsRemaining },
  };
}

test('clean Fire Rate baseline requires no explicit, unresolved, permanent, or Gun bridge input', () => {
  const clean = {
    directNumericInputs: [],
    directUnresolvedInputs: [],
    nonDirectTokens: [],
    permanentFireRate: [],
    gunBridgeActive: false,
  };
  assert.equal(isCleanExplicitFireRateBaseline(clean), true);
  assert.equal(isCleanExplicitFireRateBaseline({ ...clean, gunBridgeActive: true }), false);
  assert.equal(isCleanExplicitFireRateBaseline({ ...clean, permanentFireRate: [{ family: 'fire rate' }] }), false);
});

test('dominant active fire mode is selected without hardcoding mode zero', () => {
  const result = selectDominantActiveFireMode([
    { observedWeaponState: { activeFireMode: 2 } },
    { observedWeaponState: { activeFireMode: 2 } },
    { observedWeaponState: { activeFireMode: 1 } },
  ]);
  assert.equal(result.activeFireMode, 2);
  assert.equal(result.samples, 2);
  assert.equal(result.total, 3);
});

test('non-burst ready delay compares directly to static cycle time', () => {
  const w = weapon('SINGLE_OR_AUTOMATIC_NON_BURST', {
    m_flCycleTime: 0.1,
    m_iBurstShotCount: 1,
  });
  const result = classifyReadyDelayAgainstStatic(row(0.101), w);
  assert.equal(result.comparable, true);
  assert.equal(result.expectedKind, 'NON_BURST_CYCLE');
  assert.equal(result.alignedWithinTolerance, true);
});

test('burst post-burst expectation uses burst-start cycle remainder', () => {
  const w = weapon('BURST', {
    m_flCycleTime: 0.5,
    m_flIntraBurstCycleTime: 0.1,
    m_iBurstShotCount: 3,
  });
  const expected = expectedStaticCadence(w);
  assert.ok(Math.abs(expected.postBurstRemainderSeconds - 0.3) < 1e-12);

  const within = classifyReadyDelayAgainstStatic(row(0.1, 2), w);
  assert.equal(within.expectedKind, 'INTRA_BURST');
  assert.equal(within.alignedWithinTolerance, true);

  const after = classifyReadyDelayAgainstStatic(row(0.3, 0), w);
  assert.equal(after.expectedKind, 'POST_BURST_REMAINDER');
  assert.equal(after.alignedWithinTolerance, true);
});

test('spin-up weapon is deliberately excluded from fixed-cycle alignment', () => {
  const w = weapon('SPIN_UP', {
    m_flCycleTime: 0.1,
    m_iBurstShotCount: 1,
    m_bSpinsUp: true,
  });
  const result = classifyReadyDelayAgainstStatic(row(0.1), w);
  assert.equal(result.comparable, false);
  assert.equal(result.reason, 'SPIN_UP_REQUIRES_DYNAMIC_RUNTIME_SPIN_STATE');
});
