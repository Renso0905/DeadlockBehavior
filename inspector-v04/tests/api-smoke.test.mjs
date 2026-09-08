import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const inspectorRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
const serverPath=join(inspectorRoot,'server.mjs');

test('HTTP API exposes replay model and player-scoped evidence',async t=>{
  const root=await mkdtemp(join(tmpdir(),'db-inspector-api-'));
  const out=join(root,'output','test');
  await mkdir(out,{recursive:true});
  const playerRows=[
    {demoTick:1920,demoSeconds:30,matchTimeSeconds:0,controller:{entityIndex:10,playerName:'Alpha',steamId:'steam-a',team:2,heroId:1,alive:true,health:500,maxHealth:500,level:1,netWorth:600,abilityPointNetWorth:0,kills:0,deaths:0,assists:0,lastHits:0,denies:0,respawnTime:0},pawn:{entityIndex:100,positionWorld:{x:0,y:0,z:0}}},
    {demoTick:1984,demoSeconds:31,matchTimeSeconds:1,controller:{entityIndex:10,playerName:'Alpha',steamId:'steam-a',team:2,heroId:1,alive:true,health:500,maxHealth:500,level:1,netWorth:625,abilityPointNetWorth:0,kills:0,deaths:0,assists:0,lastHits:1,denies:0,respawnTime:0},pawn:{entityIndex:100,positionWorld:{x:10,y:0,z:0}}},
    {demoTick:1920,demoSeconds:30,matchTimeSeconds:0,controller:{entityIndex:20,playerName:'Bravo',steamId:'steam-b',team:3,heroId:2,alive:true,health:500,maxHealth:500,level:1,netWorth:600,abilityPointNetWorth:0,kills:0,deaths:0,assists:0,lastHits:0,denies:0,respawnTime:0},pawn:{entityIndex:200,positionWorld:{x:0,y:100,z:0}}}
  ];
  await writeFile(join(out,'player_state.jsonl'),playerRows.map(x=>JSON.stringify(x)).join('\n')+'\n');
  await writeFile(join(out,'integrated_authoritative_player_state_substrate_v01.json'),JSON.stringify({replay:{ticksPerSecond:64,matchClockOffsetSeconds:30,replayEndTick:1984},bridgeIntervals:[],players:[
    {playerKey:'Alpha',identity:{playerName:'Alpha',steamId:'steam-a',controllerEntityIndex:10,heroId:1,team:2},events:[],finalState:{authoritativeOwnership:{standardShopItems:[],permanentWorldBuffs:{},activeBridgeBuffs:[]},observedRuntime:{}}},
    {playerKey:'Bravo',identity:{playerName:'Bravo',steamId:'steam-b',controllerEntityIndex:20,heroId:2,team:3},events:[],finalState:{authoritativeOwnership:{standardShopItems:[],permanentWorldBuffs:{},activeBridgeBuffs:[]},observedRuntime:{}}}
  ]}));

  const port=await freePort();
  const child=spawn(process.execPath,[serverPath],{env:{...process.env,DEADLOCK_REPO_ROOT:root,DEADLOCK_OUTPUT_ROOT:join(root,'output'),DEADLOCK_INSPECTOR_PORT:String(port)},stdio:'ignore'});
  t.after(()=>child.kill('SIGKILL'));
  await waitFor(`http://127.0.0.1:${port}/api/config`);

  const replayList=await getJson(`http://127.0.0.1:${port}/api/replays`);
  assert.equal(replayList.replays[0].name,'test');
  assert.equal(replayList.replays[0].coreReady,true);

  const model=await getJson(`http://127.0.0.1:${port}/api/replay/test/model`);
  assert.equal(model.players.length,2);
  assert.equal(model.players.find(p=>p.playerName==='Alpha').scoreboard.lastHits,1);

  const evidence=await getJson(`http://127.0.0.1:${port}/api/replay/test/evidence/playerState?player=Alpha&limit=10`);
  assert.equal(evidence.matched,2);
  assert.equal(evidence.rows.every(r=>r.controller.playerName==='Alpha'),true);
});

async function freePort(){
  return new Promise((resolve,reject)=>{
    const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
  });
}
async function waitFor(url){
  let last;
  for(let i=0;i<50;i++){
    try{const r=await fetch(url);if(r.ok)return;}catch(e){last=e;}
    await new Promise(r=>setTimeout(r,50));
  }
  throw last??new Error(`server did not start: ${url}`);
}
async function getJson(url){const r=await fetch(url);assert.equal(r.ok,true,`${r.status} ${url}`);return r.json();}
