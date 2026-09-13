import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReplayModel } from '../lib/replay-model.mjs';
import { metricValue } from '../public/metric-values.mjs';
import { readJsonl,rowMatchesPlayer } from '../lib/io.mjs';
import { fileDigest,validatePublishedRun,inputFingerprint } from '../lib/run-integrity.mjs';
import { PRODUCTION_METRIC_CONTRACT } from '../../src/contracts/production-metric-contract.mjs';

function row(time,id=1,changes={}){return{demoSeconds:time+10,demoTick:(time+10)*64,matchTimeSeconds:time,controller:{entityIndex:id,playerName:'Same name',steamId:String(id),team:id===1?2:3,heroId:1,alive:true,health:100,maxHealth:100,level:1,kills:0,deaths:0,assists:0,lastHits:0,denies:0,netWorth:600,abilityPointNetWorth:0,...changes},pawn:{entityIndex:id+100,positionWorld:{x:0,y:0,z:0},positionValidForMovement:true}};}
async function fixture(rows){const root=await mkdtemp(join(tmpdir(),'db-reliable-'));const dir=join(root,'match');await mkdir(dir);await writeFile(join(dir,'player_state_summary.json'),JSON.stringify({matchClockOffsetSeconds:10}));await writeFile(join(dir,'player_state.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');return{root,dir,model:await buildReplayModel({outputRoot:root,replayName:'match'})};}

test('gameplay durations, growth baselines, fractional team time and checkpoints use observed boundaries',async()=>{
 const {model:m}=await fixture([row(-10,1,{level:0,netWorth:0}),row(0),row(5,1,{alive:false,health:0}),row(10.5,1,{alive:true,health:100})]);const p=m.players[0];
 assert.equal(m.match.matchDurationSeconds,10.5);assert.equal(p.core.aliveSeconds,5);assert.equal(p.core.deadSeconds,5.5);assert.equal(p.core.levelRatePerMinute,0);assert.equal(p.core.netWorthGainPerMinute,0);assert.equal(m.teamSeries[0].tick,640);assert.equal(m.teamSeries.at(-1).time,10.5);assert.deepEqual(p.core.checkpoints,{});assert.deepEqual(p.core.survivalIntervals,[5]);
});
test('same-name players remain separate and controller-scoped evidence stays separate',async()=>{
 const {model:m}=await fixture([row(0,1),row(0,2),row(5,1,{kills:2}),row(5,2,{kills:7})]);assert.equal(m.players.length,2);assert.deepEqual(m.players.map(p=>p.playerId).sort(),['controller:1','controller:2']);assert.equal(m.players.find(p=>p.playerId==='controller:1').scoreboard.kills,2);assert.equal(rowMatchesPlayer(row(1,2),{controllerEntityIndex:1,steamId:'1',allowName:false}),false);
});
test('missing alive, health and scoreboard values stay unknown',async()=>{
 const {model:m}=await fixture([row(0,1,{alive:null,health:null,kills:null}),row(5,1,{alive:null,health:null,kills:null})]);const p=m.players[0];assert.equal(p.scoreboard.kills,null);assert.equal(p.scoreboard.kd,null);assert.equal(p.core.deadSeconds,0);assert.equal(p.core.unknownStateSeconds,5);assert.equal(p.core.low25Seconds,0);
});
test('missing source is unavailable, while observed zero and denominator-zero are distinct',()=>{
 const p={playerName:'A',melee:{attacks:0,hits:0,hitRate:null},metricAvailability:{melee_attacks:{available:true},melee_hit_rate:{available:true}}};const ctx={model:{},p,time:0};assert.equal(metricValue('melee_attacks',ctx).value,'0');assert.equal(metricValue('melee_hit_rate',ctx).value,'N/A');delete p.metricAvailability.melee_attacks;assert.equal(metricValue('melee_attacks',ctx).value,'Unavailable');
});
test('next-ready selects production telemetry at or before the scrubber',()=>{
 const p={metricAvailability:{next_primary_ready:{available:true}},weapon:{nextPrimaryReadyTimeline:[{matchTime:5,nextPrimaryAttack:20},{matchTime:10,nextPrimaryAttack:99}]}};const ctx={model:{},p,time:7};assert.equal(metricValue('next_primary_ready',ctx).value,'20.000000');assert.equal(metricValue('next_primary_ready',{...ctx,time:0}).value,'N/A');
});
test('JSONL corruption is surfaced instead of dropping records',async()=>{
 const root=await mkdtemp(join(tmpdir(),'db-corrupt-')),file=join(root,'rows.jsonl');await writeFile(file,'{}\ninvalid\n');await assert.rejects(async()=>{for await(const row of readJsonl(file))void row;},/Malformed JSONL/);
});
test('published output hashes and exact metric identities are mandatory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'db-manifest-'));const published=join(root,'.production-runs','one');await mkdir(published,{recursive:true});
 const manifest={runId:'one',runStatus:'COMPLETE',publishedOutputDir:'.production-runs/one',inputFingerprint:'input',coverage:{metricIds:{complete:PRODUCTION_METRIC_CONTRACT.metrics.map(m=>m.metricId)}},outputDigests:{}};
 for(const producer of PRODUCTION_METRIC_CONTRACT.producers)for(const spec of producer.expectedOutputs){const name=spec.path.split('/').at(-1),file=join(published,name);await writeFile(file,'{}');manifest.outputDigests[name]=await fileDigest(file);}
 assert.equal((await validatePublishedRun(root,manifest)).available,true);await writeFile(join(published,'player_state.jsonl'),'changed');assert.equal((await validatePublishedRun(root,manifest)).available,false);
 const wrong={...manifest,coverage:{metricIds:{complete:manifest.coverage.metricIds.complete.map((id,i)=>i===0?'wrong_metric':id)}}};assert.match((await validatePublishedRun(root,wrong)).reason,/contract changed/);
});
test('input fingerprint changes when code changes without changing metric count',async()=>{
 const root=await mkdtemp(join(tmpdir(),'db-input-'));await mkdir(join(root,'src'));const file=join(root,'src','example.mjs');await writeFile(file,'export const x=1;');const first=await inputFingerprint(root,'fixture');await writeFile(file,'export const x=2;');assert.notEqual(await inputFingerprint(root,'fixture'),first);
});
