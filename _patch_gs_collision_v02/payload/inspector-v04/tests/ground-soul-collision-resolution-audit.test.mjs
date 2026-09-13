import test from 'node:test';
import assert from 'node:assert/strict';
import { auditGroundSoulCollisionResolution, classifyCollisionRow, nearestCollisionCases } from '../lib/research-ground-soul-collision-resolution.mjs';

function coverageRow(id,tick,team,overrides={}){
  return {
    activationId:id,
    assignedGoldEntityIndex:Number(String(id).replace(/\D/g,''))||1,
    activationTick:tick-4,
    activationMatchTimeSeconds:(tick-4)/64,
    resolutionTick:tick,
    resolutionMatchTimeSeconds:tick/64,
    displayMatchTimeSeconds:tick/64,
    team,
    targeted:true,
    targetEntityIndex:100+(Number(String(id).replace(/\D/g,''))||1),
    lifecycleCompleted:true,
    resolvedEconomicCredit:false,
    resolutionStatus:'UNRESOLVED_NONISOLATED_TERMINATION',
    currencyContext:{
      available:true,
      exactTickSameTeamPositiveTransitions:1,
      exactTickSameTeamRecipients:[{pawnEntityIndex:100+(Number(String(id).replace(/\D/g,''))||1),playerName:`P${id}`,team,delta:55}],
    },
    trooperTimingContext:{deathsNearActivation:1,sameTickDeathsAtActivation:1,deathsNearResolution:0,sameTickDeathsAtResolution:0},
    ...overrides,
  };
}

test('same-tick same-team collision remains ambiguous under narrower counterfactual',()=>{
  const a=coverageRow('a1',1000,2),b=coverageRow('a2',1000,2);
  const out=classifyCollisionRow(a,[a,b],{radiusTicks:16});
  assert.equal(out.collisionClass,'SAME_TICK_SAME_TEAM_COLLISION');
  assert.equal(out.collisionDimensions.sameTickSameTeamNeighbors,1);
  assert.equal(out.counterfactualNarrowerIsolation.result,'STILL_AMBIGUOUS_SAME_TICK_SAME_TEAM');
  assert.equal(out.counterfactualNarrowerIsolation.wouldPass,false);
});

test('same-tick opposite-team collision is algorithmically separable but remains diagnostic',()=>{
  const a=coverageRow('a1',1000,2),b=coverageRow('a2',1000,3);
  const out=classifyCollisionRow(a,[a,b],{radiusTicks:16});
  assert.equal(out.collisionClass,'SAME_TICK_OTHER_TEAM_ONLY');
  assert.equal(out.collisionDimensions.sameTickSameTeamNeighbors,0);
  assert.equal(out.collisionDimensions.sameTickOtherTeamNeighbors,1);
  assert.equal(out.counterfactualNarrowerIsolation.result,'WOULD_PASS_NARROWER_SAME_TICK_SAME_TEAM_ISOLATION');
  assert.equal(out.counterfactualNarrowerIsolation.wouldPass,true);
  assert.match(out.counterfactualNarrowerIsolation.semanticBoundary,/does not establish semantic validity/i);
});

test('nearby same-team different-tick collision is separated by exact tick only in counterfactual',()=>{
  const a=coverageRow('a1',1000,2),b=coverageRow('a2',1010,2);
  const out=classifyCollisionRow(a,[a,b],{radiusTicks:16});
  assert.equal(out.collisionClass,'NEARBY_DIFFERENT_TICK_SAME_TEAM');
  assert.equal(out.collisionDimensions.sameTickSameTeamNeighbors,0);
  assert.equal(out.collisionDimensions.nearbyDifferentTickSameTeamNeighbors,1);
  assert.equal(out.counterfactualNarrowerIsolation.wouldPass,true);
});

test('same-team same-tick currency partition is re-evaluated without fabricating a pass',()=>{
  const a=coverageRow('a1',1000,2,{currencyContext:{available:true,exactTickSameTeamPositiveTransitions:2,exactTickSameTeamRecipients:[{pawnEntityIndex:101,team:2,delta:55},{pawnEntityIndex:102,team:2,delta:100}]}});
  const b=coverageRow('a2',1008,3);
  const out=classifyCollisionRow(a,[a,b],{radiusTicks:16});
  assert.equal(out.exactTickCurrency.integerPartitionClean,false);
  assert.equal(out.counterfactualNarrowerIsolation.result,'NONPARTITION_CLEAN_EXACT_TICK_CURRENCY');
  assert.equal(out.counterfactualNarrowerIsolation.wouldPass,false);
});

test('collision audit forms clusters and preserves current A count separately from counterfactual candidates',()=>{
  const a=coverageRow('a1',1000,2),b=coverageRow('a2',1010,2);
  const resolved={...coverageRow('a3',2000,2),resolutionStatus:'RESOLVED_ISOLATED_TARGETED_EXACT_TICK_CURRENCY0',resolvedEconomicCredit:true};
  const {rows,summary}=auditGroundSoulCollisionResolution({coverageRows:[a,b,resolved],radiusTicks:16});
  assert.equal(rows.length,2);
  assert.equal(summary.collisionClusters,1);
  assert.equal(summary.counterfactualNarrowerIsolation.wouldPassEvents,2);
  assert.equal(summary.counterfactualNarrowerIsolation.currentResolvedAEvents,1);
  assert.equal(summary.counterfactualNarrowerIsolation.hypotheticalResolvedIfAllCounterfactualPassesWereEventuallyValidated,3);
  assert.equal(summary.authorityStatus,'B_DIAGNOSTIC');
  assert.match(summary.counterfactualNarrowerIsolation.semanticBoundary,/not an A count/i);
});

test('focus helper selects collision cases nearest a replay time',()=>{
  const rows=[{displayMatchTimeSeconds:130,resolutionTick:1},{displayMatchTimeSeconds:132.1,resolutionTick:2},{displayMatchTimeSeconds:135,resolutionTick:3}];
  const out=nearestCollisionCases(rows,132,5,2);
  assert.deepEqual(out.map(x=>x.resolutionTick),[2,1]);
  assert.ok(out[0].distanceFromFocusSeconds<out[1].distanceFromFocusSeconds);
});
