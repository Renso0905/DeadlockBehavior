import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { METRIC_REGISTRY } from '../lib/metric-registry.mjs';
import { buildReplayModel } from '../lib/replay-model.mjs';
import { rowMatchesPlayer } from '../lib/io.mjs';

test('metric registry contains only A/B statuses and unique IDs',()=>{
  const metrics=METRIC_REGISTRY.flatMap(s=>s.metrics);
  assert.ok(metrics.length>=150);
  assert.deepEqual([...new Set(metrics.map(m=>m.status))].sort(),['A','B']);
  assert.equal(new Set(metrics.map(m=>m.id)).size,metrics.length);
  assert.ok(metrics.some(m=>m.id==='ground_soul_vacuum_target'&&m.warning));
  assert.ok(metrics.some(m=>m.id==='camp_clear_during_exposure'&&m.warning));
  assert.ok(!metrics.some(m=>/current_ammo|effective_dps|magazine_size/.test(m.id)));
});

test('replay model joins player state, authoritative ownership, scoreboard and team advantage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'db-inspector-'));
  const out=join(root,'output','fixture');await mkdir(out,{recursive:true});
  const rows=[];
  function row(t,name,team,hero,alive,nw,k=0,d=0,a=0,lh=0,den=0){return JSON.stringify({demoTick:Math.round((t+30)*64),demoSeconds:t+30,matchTimeSeconds:t,controller:{entityIndex:team*10+hero,playerName:name,steamId:`steam-${name}`,team,heroId:hero,alive,health:alive?500:0,maxHealth:500,level:t>=60?2:1,netWorth:nw,abilityPointNetWorth:0,kills:k,deaths:d,assists:a,lastHits:lh,denies:den,respawnTime:alive?0:10,assignedLane:1},pawn:{entityIndex:100+hero,positionWorld:{x:t,y:team*100,z:0}}});}
  rows.push(row(0,'Alpha',2,1,true,600),row(0,'Bravo',3,2,true,600));
  rows.push(row(60,'Alpha',2,1,true,2000,1,0,1,10,2),row(60,'Bravo',3,2,false,1500,0,1,0,8,1));
  rows.push(row(90,'Alpha',2,1,true,3000,1,0,1,15,3),row(90,'Bravo',3,2,true,2200,0,1,0,12,1));
  await writeFile(join(out,'player_state.jsonl'),rows.join('\n')+'\n');
  await writeFile(join(out,'integrated_authoritative_player_state_substrate_v01.json'),JSON.stringify({replay:{ticksPerSecond:64,matchClockOffsetSeconds:30,replayEndTick:7680},bridgeIntervals:[],players:[
    {playerKey:'Alpha',identity:{playerName:'Alpha',steamId:'steam-Alpha',heroId:1,team:2},events:[{tick:64*40,itemAdds:[{itemId:1,recordKey:'upgrade_test',itemTier:1,shopPrice:800}],itemRemoves:[]}],finalState:{authoritativeOwnership:{standardShopItems:[{itemId:1,recordKey:'upgrade_test',itemTier:1,shopPrice:800}],permanentWorldBuffs:{},activeBridgeBuffs:[]},observedRuntime:{healthRegen:2}}},
    {playerKey:'Bravo',identity:{playerName:'Bravo',steamId:'steam-Bravo',heroId:2,team:3},events:[],finalState:{authoritativeOwnership:{standardShopItems:[],permanentWorldBuffs:{},activeBridgeBuffs:[]},observedRuntime:{healthRegen:2}}}
  ]}));
  const model=await buildReplayModel({outputRoot:join(root,'output'),replayName:'fixture'});
  assert.equal(model.players.length,2);assert.equal(model.teams.length,2);
  const alpha=model.players.find(p=>p.playerName==='Alpha'),bravo=model.players.find(p=>p.playerName==='Bravo');
  assert.equal(alpha.scoreboard.kills,1);assert.equal(alpha.scoreboard.lastHits,15);assert.equal(alpha.items.finalItems.length,1);
  assert.equal(bravo.scoreboard.deaths,1);assert.equal(bravo.deathsObserved.length,1);assert.equal(bravo.respawnsObserved.length,1);
  assert.ok(model.teams.find(t=>t.team===2).goldNetWorthDiff>0);
  assert.equal(model.teams.find(t=>t.team===2).players[0],'Alpha');
});


test('player evidence matcher supports current and nested evidence schemas',()=>{
  assert.equal(rowMatchesPlayer({controller:{playerName:'Alpha'}},'Alpha'),true);
  assert.equal(rowMatchesPlayer({action:{player:{playerName:'Alpha'}}},'Alpha'),true);
  assert.equal(rowMatchesPlayer({groundSoul:{vacuumTargetPlayer:{playerName:'Alpha'}}},'Alpha'),true);
  assert.equal(rowMatchesPlayer({evidence:{fields:{m_iGoldNetWorth:{positivePlayers:['Alpha','Bravo']}}}},'Alpha'),true);
  assert.equal(rowMatchesPlayer({controller:{playerName:'Alpha'}},'Bravo'),false);
});
