import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssignedGoldEconomicCreditSummary, isIsolatedGroundSoulTermination, resolveAssignedGoldEconomicCredit } from '../lib/runtime-assigned-gold-economic-credit.mjs';

const ep=(overrides={})=>({activationId:'10|1',entityIndex:10,activationTick:100,endTick:140,endMatchTimeSeconds:1.5,team:2,targeted:true,targetEntityIndex:91,finalized:true,censored:false,endReason:'BECAME_INACTIVE',...overrides});
const d=(pawn,delta,overrides={})=>({tick:140,pawnEntityIndex:pawn,playerName:`P${pawn}`,team:2,heroId:pawn,previousCurrency0:100,currentCurrency0:100+delta,delta,...overrides});

test('same-team positive exact-tick currency0 transitions resolve economic recipients',()=>{
  const e=ep();
  const out=resolveAssignedGoldEconomicCredit(e,[d(91,30),d(92,31),d(80,50,{team:3}),d(93,-4),d(94,9,{tick:141})],[e]);
  assert.equal(out.resolved,true);assert.equal(out.recipientCount,2);assert.deepEqual(out.recipients.map(r=>r.pawnEntityIndex),[91,92]);assert.equal(out.observedTeamCurrency0Delta,61);
});

test('physical vacuum target may differ from the economic recipient set',()=>{
  const e=ep({targetEntityIndex:99});
  const out=resolveAssignedGoldEconomicCredit(e,[d(91,40)],[e]);
  assert.equal(out.resolved,true);assert.equal(out.physicalTargetIsEconomicRecipient,false);assert.equal(out.recipients[0].pawnEntityIndex,91);
});

test('economic recipient reconstruction preserves recipient sets larger than two',()=>{
  const e=ep();const rows=[91,92,93,94,95,96].map((p,i)=>d(p,i<3?16:15));
  const out=resolveAssignedGoldEconomicCredit(e,rows,[e]);
  assert.equal(out.resolved,true);assert.equal(out.recipientCount,6);assert.equal(out.multiRecipient,true);
});

test('nearby Ground Soul terminations are unresolved instead of double-attributed',()=>{
  const a=ep(),b=ep({activationId:'11|1',entityIndex:11,endTick:150});
  assert.equal(isIsolatedGroundSoulTermination(a,[a,b],16),false);
  const out=resolveAssignedGoldEconomicCredit(a,[d(91,40)],[a,b]);
  assert.equal(out.resolved,false);assert.equal(out.resolutionStatus,'UNRESOLVED_NONISOLATED_TERMINATION');
});

test('targetless, censored, and contaminated unequal currency sets are not promoted',()=>{
  const targetless=resolveAssignedGoldEconomicCredit(ep({targeted:false,targetEntityIndex:null}),[d(91,40)],[ep({targeted:false,targetEntityIndex:null})]);
  assert.equal(targetless.resolved,false);assert.equal(targetless.resolutionStatus,'UNRESOLVED_TARGETLESS_LIFECYCLE');
  const censoredEpisode=ep({censored:true,endReason:'REPLAY_END_CENSORED'});const censored=resolveAssignedGoldEconomicCredit(censoredEpisode,[d(91,40)],[censoredEpisode]);assert.equal(censored.resolved,false);assert.equal(censored.resolutionStatus,'INELIGIBLE_NONCOMPLETED_LIFECYCLE');
  const e=ep();const contaminated=resolveAssignedGoldEconomicCredit(e,[d(91,40),d(92,10)],[e]);assert.equal(contaminated.resolved,false);assert.equal(contaminated.resolutionStatus,'UNRESOLVED_NONPARTITION_CLEAN_CURRENCY0_SET');
});

test('summary reports resolved coverage, recipient transitions, multi-recipient share, and per-player receipts',()=>{
  const a=resolveAssignedGoldEconomicCredit(ep({activationId:'10|1',entityIndex:10,endTick:140}),[d(91,30),d(92,31)],[ep({activationId:'10|1',entityIndex:10,endTick:140})]);
  const bEp=ep({activationId:'20|1',entityIndex:20,endTick:200,targetEntityIndex:93});const b=resolveAssignedGoldEconomicCredit(bEp,[d(93,40,{tick:200})],[bEp]);
  const uEp=ep({activationId:'30|1',entityIndex:30,endTick:300,targeted:false,targetEntityIndex:null});const u=resolveAssignedGoldEconomicCredit(uEp,[],[uEp]);
  const s=buildAssignedGoldEconomicCreditSummary([u,b,a]);
  assert.equal(s.resolvedCreditEvents,2);assert.equal(s.unresolvedLifecycleEvents,1);assert.equal(s.recipientTransitions,3);assert.equal(s.multiRecipientEvents,1);assert.equal(s.multiRecipientShare,.5);assert.deepEqual(s.recipientCountDistribution,{1:1,2:1});assert.equal(s.byPlayer.find(x=>x.pawnEntityIndex===91).creditEvents,1);
});

test('per-player cumulative economic-gain timeline preserves resolved event time and running currency0 total',()=>{
  const aEp=ep({activationId:'40|1',entityIndex:40,endTick:400,endMatchTimeSeconds:5,targetEntityIndex:91});
  const bEp=ep({activationId:'50|1',entityIndex:50,endTick:500,endMatchTimeSeconds:7,targetEntityIndex:91});
  const a=resolveAssignedGoldEconomicCredit(aEp,[d(91,30,{tick:400})],[aEp]);
  const b=resolveAssignedGoldEconomicCredit(bEp,[d(91,40,{tick:500})],[bEp]);
  const s=buildAssignedGoldEconomicCreditSummary([b,a]);
  const player=s.byPlayer.find(x=>x.pawnEntityIndex===91);
  assert.equal(player.observedCurrency0DeltaTotal,70);
  assert.deepEqual(player.cumulativeTimeline,[
    {matchTime:5,tick:400,delta:30,cumulativeCurrency0Delta:30,creditEvents:1},
    {matchTime:7,tick:500,delta:40,cumulativeCurrency0Delta:70,creditEvents:2},
  ]);
});

