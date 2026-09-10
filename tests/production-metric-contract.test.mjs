import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { METRIC_REGISTRY } from '../inspector-v04/lib/metric-registry.mjs';
import {
  PRODUCTION_CAPABILITIES,
  AUTHORITATIVE_PRODUCTION_METRIC_IDS,
} from '../inspector-v04/lib/production-capabilities.mjs';
import {
  loadClaimRegistry,
  isClaimUsable,
} from '../src/contracts/claim-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(__dirname, '../contracts/production_metric_registry_v01.json');
const pipelinePath = path.resolve(__dirname, '../inspector-v04/pipeline.json');

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const pipeline = JSON.parse(fs.readFileSync(pipelinePath, 'utf8'));

function sorted(values) {
  return [...values].sort();
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

test('production metric contract freezes the current 77 A metrics', () => {
  assert.equal(contract.version, 'DEADLOCK_PRODUCTION_METRIC_CONTRACT_V01');
  assert.equal(contract.canonical, true);
  assert.equal(contract.expectedAuthoritativeMetricCount, 77);
  assert.equal(contract.expectedProducerCount, 9);
  assert.equal(contract.metrics.length, 77);
  assert.equal(contract.producers.length, 9);

  assert.deepEqual(
    duplicateValues(contract.metrics.map((metric) => metric.metricId)),
    [],
    'contract contains duplicate metric IDs'
  );
  assert.deepEqual(
    duplicateValues(contract.producers.map((producer) => producer.producerStageId)),
    [],
    'contract contains duplicate producer stage IDs'
  );
  assert.deepEqual(
    duplicateValues(contract.producers.map((producer) => producer.capabilityId)),
    [],
    'contract contains duplicate producer capability IDs'
  );

  for (const metric of contract.metrics) {
    assert.equal(metric.status, 'A', `${metric.metricId}: contract status must be A`);
    assert.ok(metric.primaryClaimId, `${metric.metricId}: missing primaryClaimId`);
    assert.ok(Array.isArray(metric.dependencyClaimIds), `${metric.metricId}: dependencyClaimIds must be an array`);
    assert.ok(metric.capabilityId, `${metric.metricId}: missing capabilityId`);
    assert.ok(metric.producerStageId, `${metric.metricId}: missing producerStageId`);
    assert.ok(['core', 'extended'].includes(metric.authorityLayer), `${metric.metricId}: invalid authorityLayer`);
  }
});

test('metric registry A set exactly equals the canonical production metric contract', () => {
  const registryA = METRIC_REGISTRY
    .flatMap((section) => section.metrics)
    .filter((metric) => metric.status === 'A')
    .map((metric) => metric.id);

  const contractA = contract.metrics.map((metric) => metric.metricId);

  assert.equal(
    registryA.length,
    contract.expectedAuthoritativeMetricCount,
    'A-metric count changed; update the canonical production metric contract intentionally'
  );
  assert.deepEqual(
    sorted(contractA),
    sorted(registryA),
    'metric-registry A set drifted from the canonical production metric contract'
  );
});

test('production capability A set exactly equals the canonical production metric contract', () => {
  const contractA = contract.metrics.map((metric) => metric.metricId);

  assert.equal(
    AUTHORITATIVE_PRODUCTION_METRIC_IDS.length,
    contract.expectedAuthoritativeMetricCount,
    'production capability A count changed'
  );
  assert.deepEqual(
    sorted(AUTHORITATIVE_PRODUCTION_METRIC_IDS),
    sorted(contractA),
    'production capability metric set drifted from the canonical production metric contract'
  );
});

test('every contracted A metric has exactly one supported production capability owner', () => {
  for (const metric of contract.metrics) {
    const owners = PRODUCTION_CAPABILITIES.filter((capability) =>
      capability.metricIds.includes(metric.metricId)
    );

    assert.equal(
      owners.length,
      1,
      `${metric.metricId}: expected exactly one production capability owner, found ${owners.length}`
    );

    const owner = owners[0];
    assert.equal(owner.id, metric.capabilityId, `${metric.metricId}: capabilityId drift`);
    assert.equal(owner.productionStatus, 'supported', `${metric.metricId}: capability must remain supported`);
    assert.equal(owner.authorityLayer, metric.authorityLayer, `${metric.metricId}: authorityLayer drift`);
  }
});

test('every contracted A metric resolves only usable current claims under the frozen policy', () => {
  const registry = loadClaimRegistry();
  const claimsById = new Map(registry.claims.map((claim) => [claim.claimId, claim]));

  for (const metric of contract.metrics) {
    const claimIds = [metric.primaryClaimId, ...metric.dependencyClaimIds];

    assert.equal(
      new Set(claimIds).size,
      claimIds.length,
      `${metric.metricId}: duplicate claim IDs in authority chain`
    );

    for (const claimId of claimIds) {
      const claim = claimsById.get(claimId);
      assert.ok(claim, `${metric.metricId}: unknown claimId ${claimId}`);
      assert.equal(
        isClaimUsable(claim, contract.claimPolicy),
        true,
        `${metric.metricId}: claim ${claimId} is not usable under the production A policy ` +
          `(authority=${claim.authorityStatus}, integrity=${claim.integrityValidation}, ` +
          `semantic=${claim.semanticValidation}, replication=${claim.replicationStatus})`
      );
    }
  }
});

test('each contracted capability maps to exactly one required replay-generic pipeline producer', () => {
  const stagesById = new Map(pipeline.steps.map((step) => [step.id, step]));

  assert.equal(pipeline.version, 'DEADLOCK_PRODUCTION_PIPELINE_V01');
  assert.equal(pipeline.steps.length, contract.expectedProducerCount);

  for (const producer of contract.producers) {
    const matchingCapabilityStages = pipeline.steps.filter(
      (step) => step.capability === producer.capabilityId
    );
    assert.equal(
      matchingCapabilityStages.length,
      1,
      `${producer.capabilityId}: expected exactly one pipeline producer, found ${matchingCapabilityStages.length}`
    );

    const stage = stagesById.get(producer.producerStageId);
    assert.ok(stage, `${producer.producerStageId}: missing pipeline stage`);
    assert.equal(stage.capability, producer.capabilityId, `${producer.producerStageId}: capability drift`);
    assert.equal(stage.required, true, `${producer.producerStageId}: authoritative producer must remain required`);
    assert.equal(stage.args?.[0], producer.entrypoint, `${producer.producerStageId}: entrypoint drift`);
    assert.deepEqual(
      stage.expectedOutputs,
      producer.expectedOutputs,
      `${producer.producerStageId}: expected-output contract drift`
    );
  }
});

test('every contracted metric points to the producer that owns its capability', () => {
  const producersByStage = new Map(
    contract.producers.map((producer) => [producer.producerStageId, producer])
  );

  for (const metric of contract.metrics) {
    const producer = producersByStage.get(metric.producerStageId);
    assert.ok(producer, `${metric.metricId}: unknown producerStageId ${metric.producerStageId}`);
    assert.equal(
      producer.capabilityId,
      metric.capabilityId,
      `${metric.metricId}: metric capability does not match producer capability`
    );
    assert.equal(
      producer.authorityLayer,
      metric.authorityLayer,
      `${metric.metricId}: metric authority layer does not match producer authority layer`
    );
  }
});

test('pipeline contains no uncontracted authoritative producer capability', () => {
  const contractCapabilities = sorted(contract.producers.map((producer) => producer.capabilityId));
  const pipelineCapabilities = sorted(pipeline.steps.map((step) => step.capability));

  assert.deepEqual(
    pipelineCapabilities,
    contractCapabilities,
    'pipeline capability set drifted from the canonical production metric contract'
  );
});
