import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBridgeIntervals, summarizeBridgeIntervals } from '../lib/runtime-bridge-buffs.mjs';

const powerups=[
  {recordKey:'gun_powerup_pickup',modifierClass:'modifier_citadel_powerup_gun',durationSeconds:160},
  {recordKey:'survival_powerup_pickup',modifierClass:'modifier_citadel_powerup_survival',durationSeconds:160},
  {recordKey:'casting_powerup_pickup',modifierClass:'modifier_citadel_powerup_casting',durationSeconds:160},
  {recordKey:'movement_powerup_pickup',modifierClass:'modifier_citadel_powerup_movement',durationSeconds:160},
];
const players=[
  {controllerEntityIndex:1,playerName:'Alpha',steamId:'1',heroId:10,team:2},
  {controllerEntityIndex:2,playerName:'Beta',steamId:'2',heroId:20,team:3},
];
function snapshot(tick,alpha=[0,0,0],beta=[1000,0,0]){return{tick,players:[
  {...players[0],alive:true,position:alpha},{...players[1],alive:true,position:beta}
]};}
function candidate(tick,recordKey='gun_powerup_pickup',position={x:20,y:0,z:0},gameState=7){return{tick,entityIndex:300,recordId:123,recordKey,position,gameState};}

function derive(overrides={}){return deriveBridgeIntervals({
  players,powerups,collectionCandidates:[candidate(640)],snapshots:[snapshot(640)],deathEvents:[],
  matchClockOffsetSeconds:0,replayEndTick:30000,matchEndTick:25000,gameplayState:7,ticksPerSecond:64,...overrides
});}

test('nearest-player collection becomes a 160-second natural interval',()=>{
  const r=derive();
  assert.equal(r.collectionEvents.length,1);assert.equal(r.intervals.length,1);
  const i=r.intervals[0];
  assert.equal(i.playerName,'Alpha');assert.equal(i.recordKey,'gun_powerup_pickup');
  assert.equal(i.startTick,640);assert.equal(i.stateEndTick,10880);assert.equal(i.durationSeconds,160);
  assert.equal(i.terminationReason,'NATURAL_EXPIRATION');assert.equal(i.terminationObserved,true);
  assert.equal(i.collectionDistanceHU,20);
});

test('exact death boundary terminates before nominal expiration',()=>{
  const r=derive({deathEvents:[{tick:3000,controllerEntityIndex:1,playerName:'Alpha'}]});
  const i=r.intervals[0];assert.equal(i.stateEndTick,3000);assert.equal(i.terminationReason,'DEATH_TERMINATION');
  assert.equal(i.durationSeconds,(3000-640)/64);
});

test('match end censors an otherwise live interval',()=>{
  const r=derive({matchEndTick:2000,replayEndTick:4000});
  const i=r.intervals[0];assert.equal(i.stateEndTick,2000);assert.equal(i.terminationReason,'MATCH_END_CENSORED');assert.equal(i.terminationObserved,false);
});

test('replay end censors if it arrives before natural expiration and match end',()=>{
  const r=derive({matchEndTick:null,replayEndTick:1800});
  const i=r.intervals[0];assert.equal(i.stateEndTick,1800);assert.equal(i.terminationReason,'REPLAY_END_CENSORED');assert.equal(i.terminationObserved,false);
});

test('distance gate rejects an ungrounded collection instead of assigning a player',()=>{
  const r=derive({snapshots:[snapshot(640,[1000,0,0],[2000,0,0])]});
  assert.equal(r.intervals.length,0);assert.equal(r.diagnostics.unattributedGameplayActiveDowns.length,1);assert.equal(r.diagnostics.overDistanceGate.length,1);
});

test('non-gameplay active-down is not promoted to a collection',()=>{
  const r=derive({collectionCandidates:[candidate(640,'gun_powerup_pickup',{x:20,y:0,z:0},8)]});
  assert.equal(r.intervals.length,0);assert.equal(r.diagnostics.nonGameplayActiveDowns.length,1);assert.equal(r.diagnostics.unattributedGameplayActiveDowns.length,0);
});

test('snapshot gap beyond the frozen envelope fails attribution',()=>{
  const r=derive({snapshots:[snapshot(700)]});
  assert.equal(r.intervals.length,0);assert.equal(r.diagnostics.snapshotGapFailures.length,1);
});

test('overlap summary is aggregate buff-time aware and preserves concurrency',()=>{
  const r=derive({
    collectionCandidates:[candidate(640,'gun_powerup_pickup'),candidate(1280,'casting_powerup_pickup')],
    snapshots:[snapshot(640),snapshot(1280)],matchEndTick:30000,replayEndTick:30000
  });
  const s=summarizeBridgeIntervals(r.intervals);
  assert.equal(s.collections,2);assert.equal(s.totalUptimeSeconds,320);assert.equal(s.maxConcurrent,2);assert.equal(s.overlapSeconds,150);
});

test('zero collections is a valid derivation result',()=>{
  const r=derive({collectionCandidates:[]});
  assert.equal(r.intervals.length,0);assert.equal(r.collectionEvents.length,0);assert.equal(r.diagnostics.unattributedGameplayActiveDowns.length,0);
});
