import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getClaim,
  isClaimUsable,
  loadClaimRegistry,
  requireClaim,
} from '../src/contracts/claim-registry.mjs';

test('runtime primary-attack ready schedule is current cross-replay authority', () => {
  const registry = loadClaimRegistry();

  const ready = requireClaim(
    'runtime_primary_attack_ready_schedule',
    { requireSemantic: true, requireReplication: true },
    registry,
  );

  assert.equal(ready.authorityStatus, 'current');
  assert.equal(ready.integrityValidation, 'pass');
  assert.equal(ready.semanticValidation, 'pass');
  assert.equal(ready.replicationStatus, 'cross_replay_replicated');

  assert.equal(ready.valueSummary.independentReplicationReplays, 5);
  assert.equal(ready.valueSummary.semanticStrongReplays, 5);

  assert.equal(ready.valueSummary.pooledSustainedPairs, 27465);
  assert.equal(ready.valueSummary.pooledObservedReadyAligned, 27459);
  assert.ok(ready.valueSummary.pooledObservedReadyAlignmentRate >= 0.999);

  assert.equal(ready.valueSummary.burstBoundaryPairs, 1463);
  assert.equal(ready.valueSummary.burstBoundaryReadyAlignmentRate, 1);

  assert.equal(ready.valueSummary.burstPositivePairs, 5043);
  assert.equal(ready.valueSummary.burstPositiveReadyAlignmentRate, 1);

  assert.equal(ready.valueSummary.nonBurstPairs, 20959);
  assert.ok(ready.valueSummary.nonBurstReadyAlignmentRate >= 0.999);

  assert.equal(
    ready.valueSummary.boundaryLastAttackReplaySpacingAlignmentRate,
    1,
  );
  assert.equal(
    ready.valueSummary.boundaryNextLastAttackVsCurrentNextPrimaryAlignmentRate,
    1,
  );

  assert.ok(
    ready.sourceScripts.includes(
      '172-validate-observed-primary-attack-ready-schedule-cross-replay-v01',
    ),
  );
});

test('primary-attack readiness promotion does not promote full effective weapon state', () => {
  const registry = loadClaimRegistry();
  const effectiveWeapon = getClaim('effective_weapon_state', registry);

  assert.equal(effectiveWeapon.authorityStatus, 'missing');
  assert.equal(isClaimUsable(effectiveWeapon), false);
});

test('primary-attack ready schedule authority artifact freezes observed/static boundary', () => {
  const path = resolve(
    'output',
    'cross_replay',
    'observed_primary_attack_ready_schedule_authority_v01.json',
  );

  const artifact = JSON.parse(readFileSync(path, 'utf8'));

  assert.equal(
    artifact.status,
    'OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_AUTHORITY_V01_READY',
  );
  assert.equal(artifact.canonical, true);
  assert.equal(
    artifact.validation.replicationStatus,
    'cross_replay_replicated',
  );

  assert.equal(
    artifact.evidence.observedRuntimeCarrier.aggregate.aligned,
    27459,
  );
  assert.equal(
    artifact.evidence.observedRuntimeCarrier.aggregate.comparable,
    27465,
  );

  assert.ok(
    artifact.evidence.staticExplanatoryModelV02DiagnosticOnly.aggregate
      .alignmentRate < 0.90,
  );

  assert.match(
    artifact.interpretation.effectiveWeaponBoundary,
    /effective_weapon_state remains missing/i,
  );
});
