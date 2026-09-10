import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerPrimaryFireSummary, deriveDischargeTransition, resolveEntityHandleIndex, summarizeNumbers } from '../lib/runtime-primary-fire.mjs';

test('Source2 entity handles resolve to the low 14-bit entity index',()=>{
  assert.equal(resolveEntityHandleIndex(2195535),79);
  assert.equal(resolveEntityHandleIndex(8372304),80);
  assert.equal(resolveEntityHandleIndex({index:123}),123);
  assert.equal(resolveEntityHandleIndex(16777215),null);
});

test('shot-number advance produces observed discharge and ready schedule without ammo inference',()=>{
  const row=deriveDischargeTransition(
    {shotNumber:12,lastAttackTime:2.0,nextPrimaryAttack:2.1},
    {shotNumber:13,lastAttackTime:2.28125,nextPrimaryAttack:2.38125},
    {tick:3658,demoSeconds:57.15625,matchClockOffsetSeconds:30}
  );
  assert.equal(row.dischargeUnits,1);
  assert.equal(row.lastAttackTimeAdvancedSameTick,true);
  assert.ok(Math.abs(row.readyDelaySeconds-.1)<1e-9);
  assert.ok(Math.abs(row.nextPrimaryReadyMatchSeconds-27.25625)<1e-9);
});

test('non-advance and shot-number reset do not fabricate discharges',()=>{
  assert.equal(deriveDischargeTransition({shotNumber:5,lastAttackTime:1},{shotNumber:5,lastAttackTime:1.1}),null);
  assert.equal(deriveDischargeTransition({shotNumber:5,lastAttackTime:1},{shotNumber:0,lastAttackTime:0}),null);
});

test('packet-compressed shot delta preserves discharge units without inventing zero-time intra-packet intervals',()=>{
  const row=deriveDischargeTransition({shotNumber:5,lastAttackTime:1},{shotNumber:8,lastAttackTime:1.3,nextPrimaryAttack:1.4},{tick:100});
  assert.equal(row.dischargeUnits,3);
  const p=buildPlayerPrimaryFireSummary({controllerEntityIndex:1,playerName:'Alpha',aliveSeconds:120,pawnEntityIndexes:new Set([2])},[
    {tick:100,demoSeconds:1.5625,weaponEntityIndex:10,dischargeUnits:3,lastAttackTimeAdvancedSameTick:true,readyDelaySeconds:.1,nextPrimaryAttack:1.4,nextPrimaryReadyDemoSeconds:1.6625,nextPrimaryReadyMatchSeconds:1.6625},
    {tick:110,demoSeconds:1.71875,weaponEntityIndex:10,dischargeUnits:1,lastAttackTimeAdvancedSameTick:true,readyDelaySeconds:.1,nextPrimaryAttack:1.5,nextPrimaryReadyDemoSeconds:1.81875,nextPrimaryReadyMatchSeconds:1.81875}
  ]);
  assert.equal(p.discharges,4);
  assert.equal(p.dischargeEvents,2);
  assert.equal(p.interAttackIntervalSeconds.count,0);
  assert.equal(p.primaryAttacksPerAliveMinute,2);
});

test('numeric summaries preserve cadence distribution',()=>{
  assert.deepEqual(summarizeNumbers([]),{count:0,min:null,p25:null,median:null,p75:null,max:null,mean:null});
  const s=summarizeNumbers([.1,.2,.3]);
  assert.equal(s.count,3);assert.equal(s.median,.2);assert.ok(Math.abs(s.mean-.2)<1e-12);
});

test('dedicated runtime primary-fire artifact supplies A cadence fields to replay model',async()=>{
  const { mkdtemp, mkdir, writeFile }=await import('node:fs/promises');
  const { tmpdir }=await import('node:os');
  const { join }=await import('node:path');
  const { buildReplayModel }=await import('../lib/replay-model.mjs');
  const root=await mkdtemp(join(tmpdir(),'db-primary-model-'));const out=join(root,'output','fixture');await mkdir(out,{recursive:true});
  const row=(matchTime)=>JSON.stringify({demoTick:Math.round((matchTime+30)*64),demoSeconds:matchTime+30,matchTimeSeconds:matchTime,controller:{entityIndex:1,playerName:'Alpha',steamId:'1',team:2,heroId:1,alive:true,health:500,maxHealth:500,level:1,netWorth:600,abilityPointNetWorth:0,kills:0,deaths:0,assists:0,lastHits:0,denies:0,respawnTime:0},pawn:{entityIndex:2,positionWorld:{x:0,y:0,z:0}}});
  await writeFile(join(out,'player_state.jsonl'),row(0)+'\n'+row(120)+'\n');
  await writeFile(join(out,'player_state_summary.json'),JSON.stringify({tickRateAssumed:64,matchClockOffsetSeconds:30,finalMatchTimeSeconds:120}));
  await writeFile(join(out,'runtime_primary_fire_production_v01.json'),JSON.stringify({status:'RUNTIME_PRIMARY_FIRE_PRODUCTION_V01_READY',counts:{dischargeEvents:40,dischargeUnits:42},players:[{controllerEntityIndex:1,playerName:'Alpha',steamId:'1',dischargeEvents:40,discharges:42,primaryAttacksPerAliveMinute:21,interAttackIntervalSeconds:{count:39,mean:.2,median:.18},readyDelaySeconds:{count:40,mean:.11,median:.10},lastObservedNextPrimaryReady:{tick:5000,demoSeconds:78.2,matchTimeSeconds:48.2,runtimeTime:109.4}}]}));
  const model=await buildReplayModel({outputRoot:join(root,'output'),replayName:'fixture'});
  const p=model.players.find(x=>x.playerName==='Alpha');
  assert.equal(p.weapon.discharges,42);
  assert.equal(p.weapon.medianReadyDelaySeconds,.10);
  assert.equal(p.weapon.lastObservedNextPrimaryReady.matchTimeSeconds,48.2);
  assert.equal(p.weapon.authority,'runtime_primary_attack_ready_schedule');
  assert.equal(model.weapon.discharges,42);
});
