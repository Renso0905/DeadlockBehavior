import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadClaimRegistry,
  requireClaim,
} from '../src/contracts/claim-registry.mjs';

import {
  getProductionMetric,
  isAuthoritativeProductionMetric,
} from '../src/contracts/production-metric-contract.mjs';

import {
  METRIC_REGISTRY,
} from '../inspector-v04/lib/metric-registry.mjs';

import {
  PRODUCTION_CAPABILITIES,
} from '../inspector-v04/lib/production-capabilities.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('scoreboard last-hit counter is current cross-replay authority', () => {
  const registry = loadClaimRegistry();

  const claim = requireClaim(
    'scoreboard_last_hit_credit_counter',
    { requireSemantic: true, requireReplication: true },
    registry
  );

  assert.equal(claim.authorityStatus, 'current');
  assert.equal(claim.integrityValidation, 'pass');
  assert.equal(claim.semanticValidation, 'pass');
  assert.equal(claim.replicationStatus, 'cross_replay_replicated');

  assert.equal(claim.valueSummary.cohortReplays, 6);
  assert.equal(claim.valueSummary.independentReplicationReplays, 5);
  assert.equal(claim.valueSummary.observedLastHitCredits, 14196);
  assert.equal(claim.valueSummary.positiveControlEvents, 5666);
  assert.equal(claim.valueSummary.positiveControlExactOpposing, 5664);
  assert.ok(claim.valueSummary.positiveControlExactOpposingRate >= 0.999);
  assert.ok(claim.valueSummary.uniqueExactOpposingRate >= 0.993);
  assert.ok(claim.valueSummary.economicNoAssignedGoldControlRate <= 0.09);
  assert.ok(claim.valueSummary.nonEconomicControlRate <= 0.043);

  assert.match(claim.scope, /game-awarded per-player last-hit credits/i);
  assert.match(claim.scope, /does not establish/i);
  assert.match(claim.notes, /99\.96%/i);
  assert.match(claim.notes, /eligibility/i);
});

test('last_hits is A through the canonical contract and core production capability', () => {
  assert.equal(isAuthoritativeProductionMetric('last_hits'), true);

  const metric = getProductionMetric('last_hits');
  assert.ok(metric);
  assert.equal(metric.status, 'A');
  assert.equal(metric.primaryClaimId, 'scoreboard_last_hit_credit_counter');
  assert.deepEqual(
    metric.dependencyClaimIds,
    ['player_controller_pawn_identity', 'player_state_t_v1']
  );
  assert.equal(metric.capabilityId, 'core_state_economy');
  assert.equal(metric.producerStageId, 'core-player-state');
  assert.equal(metric.authorityLayer, 'core');

  const registryMetric = METRIC_REGISTRY
    .flatMap((section) => section.metrics)
    .find((row) => row.id === 'last_hits');

  assert.ok(registryMetric);
  assert.equal(registryMetric.status, 'A');

  const core = PRODUCTION_CAPABILITIES.find(
    (capability) => capability.id === 'core_state_economy'
  );

  assert.ok(core);
  assert.equal(core.productionStatus, 'supported');
  assert.ok(core.metricIds.includes('last_hits'));
});

test('last_hits production and Authoritative Stats display paths remain wired', () => {
  const extractor = fs.readFileSync(
    path.resolve(__dirname, '../scripts/03-extract-player-state.mjs'),
    'utf8'
  );

  const replayModel = fs.readFileSync(
    path.resolve(__dirname, '../inspector-v04/lib/replay-model.mjs'),
    'utf8'
  );

  const authoritativeUi = fs.readFileSync(
    path.resolve(__dirname, '../inspector-v04/public/authoritative.js'),
    'utf8'
  );

  assert.match(
    extractor,
    /lastHits:\s*controller\.getField\(\s*['"]m_iLastHits['"]\s*\)/
  );

  assert.match(
    replayModel,
    /lastHits:c\.lastHits/
  );

  assert.match(
    replayModel,
    /lastHits:f\.lastHits\?\?0/
  );

  assert.match(
    authoritativeUi,
    /['"]last_hits['"]/
  );

  assert.match(
    authoritativeUi,
    /case ['"]last_hits['"]\s*:/
  );
});
