import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const meleeIds = [
  'melee_attacks',
  'melee_hits',
  'melee_hit_rate',
  'light_melee',
  'heavy_melee',
  'air_heavy_melee',
  'melee_type_share',
  'melee_per_alive_min',
];

const validation = json('output/cross_replay/melee_family_validation_v01.json');
const claims = json('contracts/claim_registry_v03.json');
const contract = json('contracts/production_metric_registry_v01.json');
const pipeline = json('inspector-v04/pipeline.json');
const registrySource = text('inspector-v04/lib/metric-registry.mjs');
const modelSource = text('inspector-v04/lib/replay-model.mjs');
const authSource = text('inspector-v04/public/authoritative.js');
const extractorSource = text('inspector-v04/production/extract-runtime-melee.mjs');

test('Script 227 complete Melee-family evidence passes', () => {
  assert.equal(validation.version, 'MELEE_FAMILY_VALIDATION_V01');
  assert.equal(validation.validationPass, true);
  assert.equal(validation.aggregate.successfulReplays, 6);
  assert.equal(validation.aggregate.playerReplayCount, 72);
  assert.equal(validation.gates.sixOfSixReplays, true);
  assert.equal(validation.gates.completePostStartOwnerResolution, true);
  assert.equal(validation.gates.knownPostStartAttackTypes, true);
  assert.equal(validation.gates.uniqueExecutionKeys, true);
  assert.equal(validation.gates.summaryEventReconciliation, true);
  assert.equal(validation.gates.playerSummaryReconciliation, true);
  assert.equal(validation.gates.movementAuthorityPass, true);
  assert.equal(validation.gates.movementJoinComplete, true);
  assert.equal(validation.gates.syntheticZeroDenominatorContract, true);
});

test('calibration exactly reproduces the historical direct melee carrier before deliberate pre-match exclusion', () => {
  assert.equal(validation.calibration.rawExactReproductionPass, true);
  assert.equal(validation.calibration.frozenMatchExclusionPass, true);
  assert.equal(validation.calibration.historicalRawAttacks, 1598);
  assert.equal(validation.calibration.productionRawAttacks, 1598);
  assert.equal(validation.calibration.exactRows, 1598);
  assert.equal(validation.calibration.productionRawHits, 1577);
  assert.equal(validation.calibration.productionPreMatchAttacks, 16);
  assert.equal(validation.calibration.productionPreMatchHits, 0);
  assert.equal(validation.calibration.productionMatchAttacks, 1582);
  assert.equal(validation.calibration.productionMatchHits, 1577);
  assert.deepEqual(validation.calibration.productionMatchByType, {
    HEAVY_AIR: 74,
    LIGHT: 635,
    HEAVY: 873,
  });
});

test('Melee claims are current/pass/pass/cross-replay', () => {
  for (const claimId of [
    'runtime_melee_execution_state_v01',
    'runtime_melee_hit_flag_v01',
    'melee_derived_metrics_v01',
  ]) {
    const claim = claims.claims.find(row => row.claimId === claimId);
    assert.ok(claim, `${claimId} missing`);
    assert.equal(claim.authorityStatus, 'current');
    assert.equal(claim.integrityValidation, 'pass');
    assert.equal(claim.semanticValidation, 'pass');
    assert.equal(claim.replicationStatus, 'cross_replay_replicated');
  }
});

test('all eight Melee metrics are canonical core A metrics owned by runtime-melee', () => {
  assert.equal(contract.expectedAuthoritativeMetricCount, contract.metrics.length);
  for (const id of meleeIds) {
    const metric = contract.metrics.find(row => row.metricId === id);
    assert.ok(metric, `${id} missing from canonical contract`);
    assert.equal(metric.status, 'A');
    assert.equal(metric.capabilityId, 'runtime_melee_execution');
    assert.equal(metric.producerStageId, 'runtime-melee');
    assert.equal(metric.authorityLayer, 'core');
  }
});

test('metric registry no longer leaves any Melee metric at B', () => {
  for (const id of meleeIds) {
    const line = registrySource.split(/\r?\n/).find(row => row.includes(`m('${id}'`));
    assert.ok(line, `${id} missing from metric registry`);
    assert.match(line, /,A,/);
  }
});

test('production pipeline has a required runtime-melee stage with fresh-output requirements', () => {
  const stage = pipeline.steps.find(step => step.id === 'runtime-melee');
  assert.ok(stage, 'runtime-melee stage missing');
  assert.equal(stage.capability, 'runtime_melee_execution');
  assert.equal(stage.required, true);
  assert.deepEqual(stage.dependsOn, ['core-player-state']);
  assert.deepEqual(stage.args, [
    'inspector-v04/production/extract-runtime-melee.mjs',
    'replays/{replay}.dem',
  ]);
  assert.deepEqual(stage.expectedOutputs.map(row => row.path), [
    'output/{replay}/runtime_melee_production_v01.json',
    'output/{replay}/runtime_melee_events_v01.jsonl',
  ]);
});

test('replay model uses dedicated runtime Melee authority and Movement denominator', () => {
  assert.match(modelSource, /runtime_melee_production_v01\.json/);
  assert.match(modelSource, /runtime_melee_events_v01\.jsonl/);
  assert.match(modelSource, /applyRuntimeMelee\(playerByName,runtimeMelee\)/);
  assert.match(modelSource, /function applyRuntimeMelee/);
  assert.match(modelSource, /movementCore\?\.movementAliveSeconds/);
  assert.match(modelSource, /attacksPerAliveMinute:safeDiv\(attacks,movementAliveSeconds\/60\)/);
  assert.match(modelSource, /source:'runtime_melee_production_v01\.json'/);
});

test('runtime extractor uses direct ability execution, hit, type, and Source-2 owner-handle carriers', () => {
  assert.match(extractorSource, /CCitadel_Ability_HoldMelee/);
  assert.match(extractorSource, /m_flAttackTriggeredTime/);
  assert.match(extractorSource, /m_eCurrentAttackType/);
  assert.match(extractorSource, /m_bHitWithThisAttack/);
  assert.match(extractorSource, /ENTITY_INDEX_MASK = 0x3fff/);
  assert.match(extractorSource, /m_hOwnerEntity/);
  assert.match(extractorSource, /eligibleForMatchStats/);
  assert.match(extractorSource, /firstObservedMatchTimeSeconds >= 0/);
});

test('all eight Melee metrics are explicitly visible in Authoritative Stats', () => {
  for (const id of meleeIds) {
    assert.ok(authSource.includes(`'${id}'`), `${id} missing from AUTH_IDS`);
    assert.ok(authSource.includes(`case '${id}':`), `${id} missing from metricValue`);
  }
});

test('formula boundary remains literal and semantic exclusions stay explicit', () => {
  assert.equal(validation.operationalContract.zeroDenominator, 'null');
  assert.equal(validation.formulas.melee_hit_rate, 'melee_hits / melee_attacks');
  assert.match(validation.formulas.melee_per_alive_min, /movementAliveSeconds/);
  assert.ok(validation.semanticBoundary.some(row => /not raw input/i.test(row)));
  assert.ok(validation.semanticBoundary.some(row => /target identity/i.test(row)));
  assert.equal(validation.gates.hitRateFormulaExact, true);
  assert.equal(validation.gates.typeShareFormulaExact, true);
  assert.equal(validation.gates.attacksPerAliveMinuteFormulaExact, true);
});

function json(relative) {
  return JSON.parse(readFileSync(resolve(root, relative), 'utf8'));
}
function text(relative) {
  return readFileSync(resolve(root, relative), 'utf8');
}
