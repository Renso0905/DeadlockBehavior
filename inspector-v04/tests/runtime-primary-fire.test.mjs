import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerPrimaryFireSummary, buildPlayerPrimaryWeaponStateSummary, deriveDischargeTransition, derivePrimaryWeaponStateTransition, resolveEntityHandleIndex, summarizeNumbers } from '../lib/runtime-primary-fire.mjs';

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

test('direct weapon-state transition preserves raw carriers and bounded reload semantics',()=>{
  const unchanged=derivePrimaryWeaponStateTransition(
    {inReload:false,activeFireMode:0,continuousShots:3,burstShotsRemaining:0},
    {inReload:false,activeFireMode:0,continuousShots:3,burstShotsRemaining:0}
  );
  assert.equal(unchanged.changed,false);
  const changed=derivePrimaryWeaponStateTransition(
    {inReload:false,activeFireMode:0,continuousShots:3,burstShotsRemaining:0},
    {inReload:true,activeFireMode:2,continuousShots:0,burstShotsRemaining:4}
  );
  assert.equal(changed.reloadTransition,'RELOAD_ENTER');
  assert.equal(changed.fireModeChanged,true);
  assert.deepEqual(changed.state,{inReload:true,activeFireMode:2,continuousShots:0,burstShotsRemaining:4});
  assert.deepEqual(changed.changedFields,['inReload','activeFireMode','continuousShots','burstShotsRemaining']);
});

test('direct weapon-state summary retains deletion gaps and censors unfinished reload intervals',()=>{
  const player={controllerEntityIndex:1,playerName:'Alpha',steamId:'1',heroId:2,team:2};
  const summary=buildPlayerPrimaryWeaponStateSummary(player,[
    {tick:90,sequence:1,matchTimeSeconds:-1,available:true,directState:{inReload:false,activeFireMode:0,continuousShots:0,burstShotsRemaining:0}},
    {tick:128,sequence:2,matchTimeSeconds:1,available:true,directState:{inReload:true,activeFireMode:0,continuousShots:0,burstShotsRemaining:0}},
    {tick:192,sequence:3,matchTimeSeconds:2,available:true,directState:{inReload:false,activeFireMode:1,continuousShots:1,burstShotsRemaining:2}},
    {tick:256,sequence:4,matchTimeSeconds:3,available:false,eventType:'WEAPON_DELETE'},
    {tick:320,sequence:5,matchTimeSeconds:4,available:true,directState:{inReload:true,activeFireMode:1,continuousShots:0,burstShotsRemaining:0}},
  ],{matchEndSeconds:10});
  assert.equal(summary.allDirectCarriersObserved,true);
  assert.equal(summary.reload.enterCount,1);
  assert.equal(summary.reload.exitCount,1);
  assert.deepEqual(summary.reload.intervals.map(x=>x.endReason),['RELOAD_EXIT','REPLAY_END_CENSORED']);
  assert.equal(summary.fireMode.changeCount,1);
  assert.deepEqual(summary.fireMode.observedModes,[0,1]);
  assert.equal(summary.timeline.find(x=>x.eventType==='WEAPON_DELETE').available,false);
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
  await writeFile(join(out,'runtime_primary_fire_production_v01.json'),JSON.stringify({status:'RUNTIME_PRIMARY_FIRE_PRODUCTION_V01_READY',counts:{dischargeEvents:40,dischargeUnits:42},players:[{controllerEntityIndex:1,playerName:'Alpha',steamId:'1',dischargeEvents:40,discharges:42,primaryAttacksPerAliveMinute:21,interAttackIntervalSeconds:{count:39,mean:.2,median:.18},readyDelaySeconds:{count:40,mean:.11,median:.10},lastObservedNextPrimaryReady:{tick:5000,demoSeconds:78.2,matchTimeSeconds:48.2,runtimeTime:109.4}}],directStatePlayers:[{controllerEntityIndex:1,playerName:'Alpha',steamId:'1',allDirectCarriersObserved:true,timeline:[{tick:64,matchTime:1,available:true,inReload:false,activeFireMode:0,continuousShots:2,burstShotsRemaining:0}],reload:{enterCount:0,exitCount:0,intervals:[]},fireMode:{changeCount:0,observedModes:[0]},burstContinuous:{continuousChangeCount:0,burstRemainingChangeCount:0}}]}));
  const model=await buildReplayModel({outputRoot:join(root,'output'),replayName:'fixture'});
  const p=model.players.find(x=>x.playerName==='Alpha');
  assert.equal(p.weapon.discharges,42);
  assert.equal(p.weapon.medianReadyDelaySeconds,.10);
  assert.equal(p.weapon.lastObservedNextPrimaryReady.matchTimeSeconds,48.2);
  assert.equal(p.weapon.authority,'runtime_primary_attack_ready_schedule');
  assert.equal(p.weapon.directStateAuthority,'runtime_primary_weapon_direct_state_v01');
  assert.equal(p.weapon.directStateTimeline[0].activeFireMode,0);
  assert.equal(model.weapon.discharges,42);
});
