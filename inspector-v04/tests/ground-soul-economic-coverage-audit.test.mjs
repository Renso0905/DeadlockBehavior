import test from 'node:test';
import assert from 'node:assert/strict';
import { auditGroundSoulEconomicCoverage, exclusionStage, reasonText } from '../lib/research-ground-soul-economic-coverage.mjs';

const ep=(id,endTick,overrides={})=>({schemaVersion:'runtime_ground_soul_lifecycle_event_v01',activationId:id,entityIndex:Number(id.split('|')[0]),activationTick:endTick-20,activationMatchTimeSeconds:(endTick-20)/64,endTick,endMatchTimeSeconds:endTick/64,team:2,targeted:true,targetEntityIndex:91,finalized:true,censored:false,endReason:'BECAME_INACTIVE',...overrides});
const econ=(e,status,resolved=false,overrides={})=>({schemaVersion:'runtime_assigned_gold_economic_credit_event_v01',activationId:e.activationId,assignedGoldEntityIndex:e.entityIndex,activationTick:e.activationTick,resolutionTick:e.endTick,resolutionMatchTimeSeconds:e.endMatchTimeSeconds,team:e.team,targeted:e.targeted,targetEntityIndex:e.targetEntityIndex,resolved,resolutionStatus:status,recipientCount:resolved?1:0,observedTeamCurrency0Delta:resolved?55:null,integerPartitionClean:resolved?true:null,...overrides});
const cur=(tick,pawn,delta,team=2)=>({tick,pawnEntityIndex:pawn,playerName:`P${pawn}`,team,delta,previousCurrency0:100,currentCurrency0:100+delta});
const death=tick=>({tick,entityIndex:500+tick,matchTimeSeconds:tick/64});

test('coverage audit preserves current resolver categories and builds a funnel',()=>{
  const a=ep('10|1',140),b=ep('20|1',300,{targeted:false,targetEntityIndex:null}),c=ep('30|1',500,{censored:true,endReason:'REPLAY_END_CENSORED'});
  const economicEvents=[econ(a,'RESOLVED_ISOLATED_TARGETED_EXACT_TICK_CURRENCY0',true),econ(b,'UNRESOLVED_TARGETLESS_LIFECYCLE'),econ(c,'INELIGIBLE_NONCOMPLETED_LIFECYCLE')];
  const {summary,rows}=auditGroundSoulEconomicCoverage({episodes:[a,b,c],economicEvents,currencyDeltas:[cur(140,91,55)],trooperDeaths:[death(120)]});
  assert.equal(rows.length,3);assert.equal(summary.funnel.lifecycleActivations,3);assert.equal(summary.funnel.completedLifecycle,2);assert.equal(summary.funnel.resolvedEconomicCredit,1);assert.equal(summary.exclusionStageCounts.PHYSICAL_TARGET,1);assert.equal(summary.exclusionStageCounts.LIFECYCLE_COMPLETION,1);assert.equal(summary.integrity.eventKeySetsExact,true);
});

test('nonisolated terminations expose same-tick and nearby collision context without resolving them',()=>{
  const a=ep('10|1',140),b=ep('20|1',140,{entityIndex:20,targetEntityIndex:92});
  const economicEvents=[econ(a,'UNRESOLVED_NONISOLATED_TERMINATION'),econ(b,'UNRESOLVED_NONISOLATED_TERMINATION')];
  const {summary,rows}=auditGroundSoulEconomicCoverage({episodes:[a,b],economicEvents,currencyDeltas:[cur(140,91,55),cur(140,92,56)],trooperDeaths:[death(120),death(121)]});
  assert.equal(rows[0].collisionContext.sameTickCompletedAssignedGoldTerminations,1);assert.equal(rows[0].currencyContext.exactTickSameTeamPositiveTransitions,2);assert.equal(rows[0].trooperTimingContext.deathsNearActivation,2);assert.equal(summary.collisionDiagnostics.nonisolatedEvents,2);assert.equal(summary.collisionDiagnostics.nonisolatedWithSameTickAssignedGoldCollision,2);assert.equal(summary.collisionDiagnostics.nonisolatedWithMultipleExactTickSameTeamPositiveCurrency,2);
});

test('no-delta and nonpartition cases remain diagnostic exclusions',()=>{
  const a=ep('10|1',140),b=ep('20|1',300);
  const economicEvents=[econ(a,'UNRESOLVED_NO_SAME_TEAM_POSITIVE_CURRENCY0_AT_TERMINATION'),econ(b,'UNRESOLVED_NONPARTITION_CLEAN_CURRENCY0_SET',false,{recipientCount:2,observedTeamCurrency0Delta:50,integerPartitionClean:false})];
  const {summary}=auditGroundSoulEconomicCoverage({episodes:[a,b],economicEvents,currencyDeltas:[cur(300,91,40),cur(300,92,10)]});
  assert.equal(summary.exclusionStageCounts.EXACT_TICK_ECONOMY,1);assert.equal(summary.exclusionStageCounts.PARTITION_CLEANLINESS,1);assert.equal(summary.funnel.currentResolverCandidates,2);assert.equal(summary.funnel.resolvedEconomicCredit,0);
});

test('missing economic rows are treated as integrity failures, not gameplay outcomes',()=>{
  const a=ep('10|1',140);const {summary,rows}=auditGroundSoulEconomicCoverage({episodes:[a],economicEvents:[],currencyDeltas:[]});
  assert.equal(rows[0].resolutionStatus,'MISSING_ECONOMIC_RESOLUTION_ROW');assert.equal(summary.integrity.eventKeySetsExact,false);assert.equal(summary.integrity.missingEconomicResolutionRows,1);assert.equal(exclusionStage(rows[0].resolutionStatus),'INTEGRITY_JOIN');assert.match(reasonText(rows[0].resolutionStatus),/integrity problem/i);
});

test('currency context can be intentionally unavailable without inventing zeros',()=>{
  const a=ep('10|1',140);const out=auditGroundSoulEconomicCoverage({episodes:[a],economicEvents:[econ(a,'UNRESOLVED_NONISOLATED_TERMINATION')],currencyDeltas:null});
  assert.equal(out.rows[0].currencyContext.available,false);assert.equal(out.summary.currencyRescanAvailable,false);assert.equal(out.summary.collisionDiagnostics.nonisolatedWithExactTickSameTeamPositiveCurrency,null);
});
