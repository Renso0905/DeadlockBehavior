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

test('scoreboard assist-credit counter is current cross-replay authority', () => {
  const registry = loadClaimRegistry();

  const claim = requireClaim(
    'scoreboard_assist_credit_counter',
    { requireSemantic: true, requireReplication: true },
    registry
  );

  assert.equal(claim.authorityStatus, 'current');
  assert.equal(claim.integrityValidation, 'pass');
  assert.equal(claim.semanticValidation, 'pass');
  assert.equal(claim.replicationStatus, 'cross_replay_replicated');

  assert.equal(claim.valueSummary.cohortReplays, 6);
  assert.equal(claim.valueSummary.independentReplicationReplays, 5);
  assert.equal(claim.valueSummary.assistCredits, 1113);
  assert.equal(claim.valueSummary.opposingScoredDeathAgreementRate, 1);
  assert.equal(claim.valueSummary.unmatchedAssistCredits, 0);
  assert.equal(claim.valueSummary.victimTeamConflictRate, 0);
  assert.ok(claim.valueSummary.sameTeamKillContextRate >= 0.987);
  assert.ok(claim.valueSummary.tenSecondPlaceboAgreementRate <= 0.043);
  assert.ok(claim.valueSummary.thirtySecondPlaceboAgreementRate <= 0.016);

  assert.match(claim.scope, /game-awarded per-player assist credits/i);
  assert.match(claim.scope, /does not establish.*eligibility/i);
  assert.match(claim.notes, /1,113/i);
  assert.match(claim.notes, /100%/i);
});

test('assists is A through the canonical contract and core production capability', () => {
  assert.equal(isAuthoritativeProductionMetric('assists'), true);

  const metric = getProductionMetric('assists');
  assert.ok(metric);
  assert.equal(metric.status, 'A');
  assert.equal(metric.primaryClaimId, 'scoreboard_assist_credit_counter');
  assert.deepEqual(
    metric.dependencyClaimIds,
    ['player_controller_pawn_identity', 'player_state_t_v1']
  );
  assert.equal(metric.capabilityId, 'core_state_economy');
  assert.equal(metric.producerStageId, 'core-player-state');
  assert.equal(metric.authorityLayer, 'core');

  const registryMetric = METRIC_REGISTRY
    .flatMap((section) => section.metrics)
    .find((row) => row.id === 'assists');

  assert.ok(registryMetric);
  assert.equal(registryMetric.status, 'A');

  const core = PRODUCTION_CAPABILITIES.find(
    (capability) => capability.id === 'core_state_economy'
  );

  assert.ok(core);
  assert.equal(core.productionStatus, 'supported');
  assert.ok(core.metricIds.includes('assists'));
});

test('assists production and Authoritative Stats display paths remain wired', () => {
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
    /assists:\s*controller\.getField\(\s*['"]m_iPlayerAssists['"]\s*\)/
  );

  assert.match(
    replayModel,
    /assists:c\.assists/
  );

  assert.match(
    replayModel,
    /assists:f\.assists\?\?0/
  );

  assert.match(
    authoritativeUi,
    /['"]assists['"]/
  );

  assert.match(
    authoritativeUi,
    /case ['"]assists['"]\s*:/
  );
});
