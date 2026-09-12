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

test('sampled scoreboard counter-timeline authority is current', () => {
  const registry =
    loadClaimRegistry();

  const claim =
    requireClaim(
      'scoreboard_sampled_counter_timeline_v01',
      {
        requireSemantic:
          true,

        requireReplication:
          true
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
    claim.valueSummary.timingSemantics,
    'first observed PlayerState sample carrying the increased counter'
  );

  assert.equal(
    claim.valueSummary.exactServerAwardTick,
    false
  );

  assert.equal(
    claim.valueSummary.negativeTransitions,
    0
  );

  assert.equal(
    claim.valueSummary.invalidTimelineEvents,
    0
  );

  assert.equal(
    claim.valueSummary.reconciliationDifferenceKills,
    0
  );

  assert.equal(
    claim.valueSummary.reconciliationDifferenceAssists,
    0
  );

  assert.equal(
    claim.valueSummary.reconciliationDifferenceLastHits,
    0
  );

  assert.equal(
    claim.valueSummary.reconciliationDifferenceDenies,
    0
  );

  assert.match(
    claim.scope,
    /first observed PlayerState sample/i
  );

  assert.match(
    claim.scope,
    /not.*exact.*server.*award tick/i
  );
});

test('scoreboard_timelines is A through canonical core production', () => {
  assert.equal(
    isAuthoritativeProductionMetric(
      'scoreboard_timelines'
    ),
    true
  );

  const metric =
    getProductionMetric(
      'scoreboard_timelines'
    );

  assert.ok(metric);

  assert.equal(
    metric.status,
    'A'
  );

  assert.equal(
    metric.primaryClaimId,
    'scoreboard_sampled_counter_timeline_v01'
  );

  assert.deepEqual(
    metric.dependencyClaimIds,
    [
      'scoreboard_kill_credit_counter',
      'scoreboard_assist_credit_counter',
      'scoreboard_last_hit_credit_counter',
      'scoreboard_deny_credit_counter',
      'player_state_t_v1',
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

  const core =
    PRODUCTION_CAPABILITIES.find(
      capability =>
        capability.id ===
        'core_state_economy'
    );

  assert.ok(core);

  assert.ok(
    core.metricIds.includes(
      'scoreboard_timelines'
    )
  );
});

test('runtime builds dedicated scoreboard timelines from raw PlayerState transitions', () => {
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
    /scoreboardTimelines:\{kills:\[\],assists:\[\],lastHits:\[\],denies:\[\]\}/
  );

  assert.match(
    replayModel,
    /recordScoreboardCounterTransitions\(p,p\.prev,state\)/
  );

  assert.match(
    replayModel,
    /function recordScoreboardCounterTransitions\(p,previous,current\)/
  );

  assert.match(
    replayModel,
    /observedSampleTick:current\.tick/
  );

  assert.match(
    replayModel,
    /observedMatchTime:current\.matchTime/
  );

  assert.match(
    replayModel,
    /timelines:p\.scoreboardTimelines/
  );

  // The ordinary display timeline remains thinned; authoritative
  // counter events must therefore be a distinct structure.
  assert.match(
    replayModel,
    /matchTime-p\.lastSampleMatch>=1/
  );
});

test('Authoritative Stats exposes sampled scoreboard timelines with timing caution', () => {
  const ui =
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../inspector-v04/public/authoritative.js'
      ),
      'utf8'
    );

  assert.match(
    ui,
    /['"]scoreboard_timelines['"]/
  );

  assert.match(
    ui,
    /case ['"]scoreboard_timelines['"]\s*:/
  );

  assert.match(
    ui,
    /first observed sample; not exact server award time/i
  );
});
