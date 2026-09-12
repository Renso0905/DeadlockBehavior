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

const RATE_IDS = [
  'kills_rate',
  'assists_rate',
  'last_hits_rate',
  'denies_rate'
];

test('scoreboard per-minute rate formula authority is current', () => {
  const registry =
    loadClaimRegistry();

  const claim =
    requireClaim(
      'scoreboard_per_minute_rate_formula_v01',
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
    claim.valueSummary.denominatorMetric,
    'match_duration'
  );

  assert.equal(
    claim.valueSummary.denominatorUnit,
    'minutes'
  );

  assert.equal(
    claim.valueSummary.zeroOrNonpositiveDurationConvention,
    'null'
  );

  assert.equal(
    claim.valueSummary.killsRateFormula,
    'kills / match_duration_minutes'
  );

  assert.equal(
    claim.valueSummary.assistsRateFormula,
    'assists / match_duration_minutes'
  );

  assert.equal(
    claim.valueSummary.lastHitsRateFormula,
    'last_hits / match_duration_minutes'
  );

  assert.equal(
    claim.valueSummary.deniesRateFormula,
    'denies / match_duration_minutes'
  );
});

test('all four scoreboard rates are A through canonical core production', () => {
  for (
    const metricId
    of RATE_IDS
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
      'scoreboard_per_minute_rate_formula_v01'
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

    assert.ok(
      metric.dependencyClaimIds.includes(
        'player_state_t_v1'
      )
    );
  }

  const core =
    PRODUCTION_CAPABILITIES.find(
      capability =>
        capability.id ===
        'core_state_economy'
    );

  assert.ok(core);

  for (
    const metricId
    of RATE_IDS
  ) {
    assert.ok(
      core.metricIds.includes(metricId)
    );
  }
});

test('runtime scoreboard rates use literal safe division by observed match minutes', () => {
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
    /const minutes=core\.matchEndSeconds>0\?core\.matchEndSeconds\/60:null/
  );

  assert.match(
    replayModel,
    /killsPerMinute:safeDiv\(\(f\.kills\?\?0\),minutes\)/
  );

  assert.match(
    replayModel,
    /assistsPerMinute:safeDiv\(\(f\.assists\?\?0\),minutes\)/
  );

  assert.match(
    replayModel,
    /lastHitsPerMinute:safeDiv\(\(f\.lastHits\?\?0\),minutes\)/
  );

  assert.match(
    replayModel,
    /deniesPerMinute:safeDiv\(\(f\.denies\?\?0\),minutes\)/
  );

  assert.doesNotMatch(
    replayModel,
    /Math\.max\(core\.matchEndSeconds\/60,1e-9\)/
  );
});

test('Authoritative Stats exposes all four scoreboard rates', () => {
  const ui =
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../inspector-v04/public/authoritative.js'
      ),
      'utf8'
    );

  for (
    const metricId
    of RATE_IDS
  ) {
    assert.match(
      ui,
      new RegExp(
        `['"]${metricId}['"]`
      )
    );

    assert.match(
      ui,
      new RegExp(
        `case ['"]${metricId}['"]\\s*:`
      )
    );
  }

  assert.match(
    ui,
    /N\/A · nonpositive match duration/
  );
});
