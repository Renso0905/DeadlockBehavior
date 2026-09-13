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
  PRODUCTION_CAPABILITIES,
} from '../inspector-v04/lib/production-capabilities.mjs';

const __dirname =
  path.dirname(
    fileURLToPath(import.meta.url)
  );

test('K/D and KDA derived formula authority is current', () => {
  const registry =
    loadClaimRegistry();

  const claim =
    requireClaim(
      'scoreboard_kd_kda_formula_v01',
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
    claim.valueSummary.zeroDeathConvention,
    'null'
  );

  assert.equal(
    claim.valueSummary.kdFormula,
    'kills / deaths_scoreboard'
  );

  assert.equal(
    claim.valueSummary.kdaFormula,
    '(kills + assists) / deaths_scoreboard'
  );
});

test('kd and kda are A through canonical core production', () => {
  for (
    const metricId
    of [
      'kd',
      'kda'
    ]
  ) {
    assert.equal(
      isAuthoritativeProductionMetric(metricId),
      true
    );

    const metric =
      getProductionMetric(metricId);

    assert.ok(metric);

    assert.equal(
      metric.status,
      'A'
    );

    assert.equal(
      metric.primaryClaimId,
      'scoreboard_kd_kda_formula_v01'
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
  }

  assert.deepEqual(
    getProductionMetric('kd').dependencyClaimIds,
    [
      'scoreboard_kill_credit_counter',
      'scoreboard_death_credit_counter'
    ]
  );

  assert.deepEqual(
    getProductionMetric('kda').dependencyClaimIds,
    [
      'scoreboard_kill_credit_counter',
      'scoreboard_assist_credit_counter',
      'scoreboard_death_credit_counter'
    ]
  );

  const core =
    PRODUCTION_CAPABILITIES.find(
      capability =>
        capability.id ===
        'core_state_economy'
    );

  assert.ok(core);
  assert.ok(core.metricIds.includes('kd'));
  assert.ok(core.metricIds.includes('kda'));
});

test('runtime formula is literal division and zero deaths remain null', () => {
  const replayModel =
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../inspector-v04/lib/replay-model.mjs'
      ),
      'utf8'
    );

  assert.match(
    replayModel,
    /kd:safeDiv\(f\.kills\?\?null,deaths\)/
  );

  assert.match(
    replayModel,
    /kda:safeDiv\(Number\.isFinite\(f\.kills\)&&Number\.isFinite\(f\.assists\)\?f\.kills\+f\.assists:null,deaths\)/
  );

  assert.doesNotMatch(
    replayModel,
    /kd:safeDiv\(f\.kills\?\?null,Math\.max\(deaths,1\)\)/
  );

  assert.doesNotMatch(
    replayModel,
    /kda:safeDiv\(\(f\.kills\?\?null\)\+\(f\.assists\?\?null\),Math\.max\(deaths,1\)\)/
  );
});

test('Authoritative Stats exposes K/D and KDA with explicit zero-death presentation', () => {
  const ui =
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../inspector-v04/public/metric-values.mjs'
      ),
      'utf8'
    );

  assert.match(
    ui,
    /['"]kd['"]/
  );

  assert.match(
    ui,
    /['"]kda['"]/
  );

  assert.match(
    ui,
    /case ['"]kd['"]\s*:/
  );

  assert.match(
    ui,
    /case ['"]kda['"]\s*:/
  );

  assert.match(
    ui,
    /N\/A · 0 deaths/
  );
});
