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

const __dirname =
  path.dirname(
    fileURLToPath(import.meta.url)
  );

test('scoreboard death-credit counter is current cross-replay authority', () => {
  const registry =
    loadClaimRegistry();

  const claim =
    requireClaim(
      'scoreboard_death_credit_counter',
      {
        requireSemantic: true,
        requireReplication: true
      },
      registry
    );

  assert.equal(
    claim.authorityStatus,
    'current'
  );

  assert.equal(
    claim.integrityValidation,
    'pass'
  );

  assert.equal(
    claim.semanticValidation,
    'pass'
  );

  assert.equal(
    claim.replicationStatus,
    'cross_replay_replicated'
  );

  assert.equal(
    claim.valueSummary.cohortReplays,
    6
  );

  assert.equal(
    claim.valueSummary.deathCredits,
    563
  );

  assert.equal(
    claim.valueSummary.creditToAliveDeathAgreementRate,
    1
  );

  assert.equal(
    claim.valueSummary.unmatchedDeathCredits,
    0
  );

  assert.ok(
    claim.valueSummary.extraAliveToDeadTransitions > 0
  );

  assert.ok(
    claim.valueSummary.tenSecondPlaceboRate <= 0.01
  );

  assert.ok(
    claim.valueSummary.thirtySecondPlaceboRate <= 0.01
  );

  assert.match(
    claim.scope,
    /game-awarded per-player scored deaths/i
  );

  assert.match(
    claim.scope,
    /death_count/i
  );
});

test('deaths_scoreboard is A through the canonical contract and core production capability', () => {
  assert.equal(
    isAuthoritativeProductionMetric(
      'deaths_scoreboard'
    ),
    true
  );

  const metric =
    getProductionMetric(
      'deaths_scoreboard'
    );

  assert.ok(metric);

  assert.equal(
    metric.status,
    'A'
  );

  assert.equal(
    metric.primaryClaimId,
    'scoreboard_death_credit_counter'
  );

  assert.deepEqual(
    metric.dependencyClaimIds,
    [
      'player_controller_pawn_identity',
      'player_state_t_v1'
    ]
  );

  assert.equal(
    metric.capabilityId,
    'core_state_economy'
  );

  assert.equal(
    metric.producerStageId,
    'core-player-state'
  );

  assert.equal(
    metric.authorityLayer,
    'core'
  );

  const registryMetric =
    METRIC_REGISTRY
      .flatMap(
        section =>
          section.metrics
      )
      .find(
        row =>
          row.id ===
          'deaths_scoreboard'
      );

  assert.ok(registryMetric);
  assert.equal(
    registryMetric.status,
    'A'
  );

  const core =
    PRODUCTION_CAPABILITIES.find(
      capability =>
        capability.id ===
        'core_state_economy'
    );

  assert.ok(core);

  assert.ok(
    core.metricIds.includes(
      'deaths_scoreboard'
    )
  );
});

test('deaths_scoreboard production and Authoritative Stats display paths remain wired', () => {
  const extractor =
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../scripts/03-extract-player-state.mjs'
      ),
      'utf8'
    );

  const replayModel =
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../inspector-v04/lib/replay-model.mjs'
      ),
      'utf8'
    );

  const authoritativeUi =
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../inspector-v04/public/authoritative.js'
      ),
      'utf8'
    );

  assert.match(
    extractor,
    /deaths:\s*controller\.getField\(\s*['"]m_iDeaths['"]\s*\)/
  );

  assert.match(
    replayModel,
    /deaths:c\.deaths/
  );

  assert.match(
    replayModel,
    /const deaths=f\.deaths\?\?p\.deathsObserved\.length/
  );

  assert.match(
    authoritativeUi,
    /['"]deaths_scoreboard['"]/
  );

  assert.match(
    authoritativeUi,
    /case ['"]deaths_scoreboard['"]\s*:/
  );
});
