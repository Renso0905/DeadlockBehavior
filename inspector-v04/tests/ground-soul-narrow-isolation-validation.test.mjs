import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNarrowIsolationCrossReplayValidation, passesSameTeamRadius, validateNarrowIsolationReplay } from '../lib/research-ground-soul-narrow-isolation-validation.mjs';

function collision(id,tick,team,neighbors=[],overrides={}){
  return {
    sourceActivationId:id,assignedGoldEntityIndex:Number(id.replace(/\D/g,''))||1,activationTick:tick-3,resolutionTick:tick,resolutionMatchTimeSeconds:tick/64,team,
    collisionClass:'NEARBY_DIFFERENT_TICK_SAME_TEAM',
    collisionDimensions:{sameTickSameTeamNeighbors:neighbors.filter(n=>n.team===team&&n.tickDelta===0).length,neighbors},
    exactTickCurrency:{available:true,contextComplete:true,rawSameTeamPositiveTransitions:1,groupedRecipientCount:1,groupedRecipients:[{pawnEntityIndex:100+(Number(id.replace(/\D/g,''))||1),team,delta:55}],observedSameTeamPositiveTotal:55,integerPartitionClean:true,physicalTargetInRecipientSet:true},
    counterfactualNarrowerIsolation:{result:'WOULD_PASS_NARROWER_SAME_TICK_SAME_TEAM_ISOLATION',wouldPass:true},
    trooperConcurrency:{class:'SINGLE_NEARBY_TROOPER_DEATH'},
    ...overrides,
  };
}
function coverageResolved(id,tick,team){return {activationId:id,assignedGoldEntityIndex:99,activationTick:tick-3,resolutionTick:tick,team,targeted:true,lifecycleCompleted:true,resolvedEconomicCredit:true,resolutionStatus:'RESOLVED_ISOLATED_TARGETED_EXACT_TICK_CURRENCY0',collisionContext:{neighboringCompletedAssignedGoldTerminations:0},currencyContext:{available:true,exactTickSameTeamPositiveTransitions:1,exactTickSameTeamRecipients:[{pawnEntityIndex:99,team,delta:55}]},authoritativeEconomicEvent:{physicalTargetIsEconomicRecipient:true}};}

function makeReplay(name){
  const a=collision('c1',1000,2,[{team:2,tickDelta:2}]);
  const b=collision('c2',1002,2,[{team:2,tickDelta:-2}]);
  const other=collision('c3',1100,2,[{team:3,tickDelta:0}],{collisionClass:'SAME_TICK_OTHER_TEAM_ONLY'});
  const resolved=coverageResolved('a1',2000,2);
  const coverageRows=[resolved,{activationId:'c1',resolutionStatus:'UNRESOLVED_NONISOLATED_TERMINATION'},{activationId:'c2',resolutionStatus:'UNRESOLVED_NONISOLATED_TERMINATION'},{activationId:'c3',resolutionStatus:'UNRESOLVED_NONISOLATED_TERMINATION'}];
  return validateNarrowIsolationReplay({replayName:name,coverageRows,collisionRows:[a,b,other],coverageSummary:{funnel:{lifecycleActivations:4,resolvedEconomicCredit:1},collisionDiagnostics:{nonisolatedEvents:3}},collisionSummary:{nonisolatedEvents:3,counterfactualNarrowerIsolation:{currentResolvedAEvents:1,wouldPassEvents:3}}});
}

test('same-team radius sweep distinguishes exact tick from nearby same-team collisions',()=>{
  const row=collision('c1',1000,2,[{team:2,tickDelta:2},{team:3,tickDelta:0}]);
  assert.equal(passesSameTeamRadius(row,0),true);
  assert.equal(passesSameTeamRadius(row,1),true);
  assert.equal(passesSameTeamRadius(row,2),false);
  assert.equal(passesSameTeamRadius(row,16),false);
});

test('opposite-team collisions do not consume the same-team exact-tick boundary',()=>{
  const row=collision('c1',1000,2,[{team:3,tickDelta:0}]);
  assert.equal(passesSameTeamRadius(row,0),true);
  assert.equal(passesSameTeamRadius(row,16),true);
});

test('replay validation preserves current A separately and detects deterministic recovered candidates',()=>{
  const out=makeReplay('rep01');
  assert.equal(out.integrity.pass,true);
  assert.equal(out.sourceCounts.currentResolvedAEvents,1);
  assert.equal(out.exactTickSameTeamRule.recoveredEvents,3);
  assert.equal(out.exactTickSameTeamRule.hypotheticalResolvedTotal,4);
  assert.equal(out.sameTeamRadiusSweep.find(x=>x.sameTeamIsolationRadiusTicks===0).recoveredFromCurrentNonisolated,3);
  assert.equal(out.sameTeamRadiusSweep.find(x=>x.sameTeamIsolationRadiusTicks===2).recoveredFromCurrentNonisolated,1);
  assert.equal(out.sameTeamRadiusSweep.find(x=>x.sameTeamIsolationRadiusTicks===16).recoveredFromCurrentNonisolated,1);
  assert.deepEqual(out.exactTickSameTeamRule.duplicateSameTeamResolutionBoundaryKeys,[]);
  assert.deepEqual(out.exactTickSameTeamRule.duplicateRecipientTransitionKeys,[]);
});

test('five-replay cohort produces cross-replay support without promoting A',()=>{
  const replays=['rep01','rep02','rep03','rep04','rep05'].map(makeReplay);
  const out=buildNarrowIsolationCrossReplayValidation(replays);
  assert.equal(out.status,'GROUND_SOUL_NARROW_ISOLATION_VALIDATION_V03_READY');
  assert.equal(out.validation.integrityValidation,'pass');
  assert.equal(out.validation.semanticValidation,'strong_support');
  assert.equal(out.validation.replicationStatus,'cross_replay_supported_5_of_5');
  assert.equal(out.interpretation.productionRecommendation,'candidate_for_production_resolver_review_not_promoted');
  assert.match(out.interpretation.semanticBoundary,/does not itself change/i);
});

test('missing replication replay prevents READY status',()=>{
  const replays=['rep01','rep02','rep03','rep04'].map(makeReplay);
  const out=buildNarrowIsolationCrossReplayValidation(replays);
  assert.equal(out.status,'GROUND_SOUL_NARROW_ISOLATION_VALIDATION_V03_INCOMPLETE');
  assert.equal(out.validation.replicationStatus,'incomplete');
});
