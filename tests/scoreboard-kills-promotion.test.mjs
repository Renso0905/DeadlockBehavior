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

test('scoreboard kill-credit counter is current cross-replay authority', () => {
  const registry = loadClaimRegistry();

  const claim = requireClaim(
    'scoreboard_kill_credit_counter',
    { requireSemantic: true, requireReplication: true },
    registry
  );

  assert.equal(claim.authorityStatus, 'current');
  assert.equal(claim.integrityValidation, 'pass');
  assert.equal(claim.semanticValidation, 'pass');
  assert.equal(claim.replicationStatus, 'cross_replay_replicated');

  assert.equal(claim.valueSummary.cohortReplays, 6);
  assert.equal(claim.valueSummary.independentReplicationReplays, 5);
  assert.equal(claim.valueSummary.scoreboardKillCredits, 557);
  assert.equal(claim.valueSummary.directEnemyFatalGroups, 570);
  assert.equal(claim.valueSummary.deathConfirmedDirectFatalAnchors, 537);
  assert.equal(claim.valueSummary.directFatalAnchorKillAgreementRate, 1);
  assert.equal(claim.valueSummary.directFatalAnchorKillAgreementCount, 537);
  assert.equal(claim.valueSummary.tenSecondPlaceboAgreementPercent, 1.49);
  assert.equal(claim.valueSummary.thirtySecondPlaceboAgreementPercent, 0);

  assert.equal(claim.valueSummary.residualKillCredits, 20);
  assert.equal(
    claim.valueSummary.residualKillCreditsWithDeathConfirmedTerminalContext,
    20
  );
  assert.equal(
    claim.valueSummary.residualKillCreditsWithDirectKnownPlayerAttackerMatch,
    3
  );
  assert.equal(claim.valueSummary.independentlyAttackerMatchedKillCredits, 540);
  assert.ok(
    claim.valueSummary.independentlyAttackerMatchedKillCreditRate >= 0.969
  );

  assert.match(claim.scope, /game-awarded per-player kill credits/i);
  assert.match(claim.scope, /not.*direct final-blow/i);
  assert.match(claim.notes, /victimHealthNew <= 0/i);
  assert.match(claim.notes, /17 residual kill credits/i);
});

test('kills is A through the canonical contract and core production capability', () => {
  assert.equal(isAuthoritativeProductionMetric('kills'), true);

  const metric = getProductionMetric('kills');
  assert.ok(metric);
  assert.equal(metric.status, 'A');
  assert.equal(metric.primaryClaimId, 'scoreboard_kill_credit_counter');
  assert.deepEqual(
    metric.dependencyClaimIds,
    ['player_controller_pawn_identity', 'player_state_t_v1']
  );
  assert.equal(metric.capabilityId, 'core_state_economy');
  assert.equal(metric.producerStageId, 'core-player-state');
  assert.equal(metric.authorityLayer, 'core');

  const registryMetric = METRIC_REGISTRY
    .flatMap((section) => section.metrics)
    .find((row) => row.id === 'kills');

  assert.ok(registryMetric);
  assert.equal(registryMetric.status, 'A');

  const core = PRODUCTION_CAPABILITIES.find(
    (capability) => capability.id === 'core_state_economy'
  );

  assert.ok(core);
  assert.equal(core.productionStatus, 'supported');
  assert.ok(core.metricIds.includes('kills'));
});

test('kills production and Authoritative Stats display paths remain wired', () => {
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
    /kills:\s*controller\.getField\(\s*['"]m_iPlayerKills['"]\s*\)/
  );

  assert.match(
    replayModel,
    /kills:c\.kills/
  );

  assert.match(
    replayModel,
    /scoreboard=\{kills:f\.kills\?\?0/
  );

  assert.match(
    authoritativeUi,
    /['"]kills['"]/
  );

  assert.match(
    authoritativeUi,
    /case ['"]kills['"]\s*:/
  );
});
