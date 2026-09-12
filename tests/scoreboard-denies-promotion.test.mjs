import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadClaimRegistry, requireClaim } from '../src/contracts/claim-registry.mjs';
import { getProductionMetric, isAuthoritativeProductionMetric } from '../src/contracts/production-metric-contract.mjs';
import { METRIC_REGISTRY } from '../inspector-v04/lib/metric-registry.mjs';
import { PRODUCTION_CAPABILITIES } from '../inspector-v04/lib/production-capabilities.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));

test('scoreboard deny counter is current cross-replay authority',()=>{
  const claim=requireClaim(
    'scoreboard_deny_credit_counter',
    {requireSemantic:true,requireReplication:true},
    loadClaimRegistry()
  );
  assert.equal(claim.authorityStatus,'current');
  assert.equal(claim.integrityValidation,'pass');
  assert.equal(claim.semanticValidation,'pass');
  assert.equal(claim.replicationStatus,'cross_replay_replicated');
  assert.equal(claim.valueSummary.independentReplicationReplays,5);
  assert.equal(claim.valueSummary.observedDenyCredits,266);
  assert.equal(claim.valueSummary.reconciledFinalCounterTotal,266);
  assert.equal(claim.valueSummary.terminalDenyAnchors,100);
  assert.equal(claim.valueSummary.terminalDenyMatches,89);
  assert.equal(claim.valueSummary.terminalDenyMatchRate,0.89);
  assert.equal(claim.valueSummary.terminalSecureAnchors,314);
  assert.equal(claim.valueSummary.terminalSecureMatches,3);
  assert.ok(claim.valueSummary.terminalSecureMatchRate<0.01);
  assert.equal(claim.valueSummary.placebo10Rate,0);
  assert.equal(claim.valueSummary.placebo30Rate,0.01);
  assert.ok(claim.valueSummary.positiveVsSecureRiskRatio>90);
  assert.ok(claim.valueSummary.weakestReplayPositiveControlRate>=0.75);
  assert.match(claim.scope,/game-awarded per-player deny credits/i);
  assert.match(claim.scope,/does not establish/i);
  assert.match(claim.notes,/33\.46%/);
});

test('denies is A through canonical core production',()=>{
  assert.equal(isAuthoritativeProductionMetric('denies'),true);
  const metric=getProductionMetric('denies');
  assert.ok(metric);
  assert.equal(metric.status,'A');
  assert.equal(metric.primaryClaimId,'scoreboard_deny_credit_counter');
  assert.deepEqual(metric.dependencyClaimIds,['player_controller_pawn_identity','player_state_t_v1']);
  assert.equal(metric.capabilityId,'core_state_economy');
  assert.equal(metric.producerStageId,'core-player-state');
  assert.equal(metric.authorityLayer,'core');

  const registryMetric=METRIC_REGISTRY.flatMap(section=>section.metrics).find(row=>row.id==='denies');
  assert.ok(registryMetric);
  assert.equal(registryMetric.status,'A');

  const core=PRODUCTION_CAPABILITIES.find(capability=>capability.id==='core_state_economy');
  assert.ok(core);
  assert.equal(core.productionStatus,'supported');
  assert.ok(core.metricIds.includes('denies'));
});

test('denies extraction, replay transport, and Authoritative Stats remain wired',()=>{
  const extractor=fs.readFileSync(path.resolve(__dirname,'../scripts/03-extract-player-state.mjs'),'utf8');
  const replayModel=fs.readFileSync(path.resolve(__dirname,'../inspector-v04/lib/replay-model.mjs'),'utf8');
  const ui=fs.readFileSync(path.resolve(__dirname,'../inspector-v04/public/authoritative.js'),'utf8');

  assert.match(extractor,/denies:\s*controller\.getField\(\s*['"]m_iDenies['"]\s*\)/);
  assert.match(replayModel,/denies:c\.denies/);
  assert.match(replayModel,/denies:f\.denies\?\?0/);
  assert.match(ui,/['"]denies['"]/);
  assert.match(ui,/case ['"]denies['"]\s*:/);
});
