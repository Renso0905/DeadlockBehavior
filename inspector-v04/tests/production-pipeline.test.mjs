import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { METRIC_REGISTRY } from '../lib/metric-registry.mjs';
import { AUTHORITATIVE_PRODUCTION_METRIC_IDS, PRODUCTION_CAPABILITIES } from '../lib/production-capabilities.mjs';
import { buildReplayModel } from '../lib/replay-model.mjs';
import { runPipeline } from '../lib/pipeline.mjs';

test('production capability contract owns every A metric exactly once',()=>{
  const a=METRIC_REGISTRY.flatMap(s=>s.metrics).filter(m=>m.status==='A').map(m=>m.id).sort();
  const production=[...AUTHORITATIVE_PRODUCTION_METRIC_IDS].sort();
  assert.equal(a.length,68);
  assert.equal(new Set(production).size,68);
  assert.deepEqual(production,a);
  const core=PRODUCTION_CAPABILITIES.find(c=>c.id==='core_state_economy');
  assert.equal(core.productionStatus,'supported');
  assert.equal(core.metricIds.length,41);
  assert.ok(!core.metricIds.includes('health_regen'));
  assert.equal(PRODUCTION_CAPABILITIES.find(c=>c.id==='health_regen').productionStatus,'not_supported');
  const items=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_item_ownership');
  assert.equal(items.productionStatus,'supported');
  assert.equal(items.metricIds.length,8);
  const perm=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_permanent_buff_ownership');
  assert.equal(perm.productionStatus,'supported');
  assert.equal(perm.metricIds.length,6);
  const bridge=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_bridge_buff_ownership');
  assert.equal(bridge.productionStatus,'supported');
  assert.equal(bridge.metricIds.length,7);
  assert.equal(PRODUCTION_CAPABILITIES.filter(c=>c.productionStatus==='supported').flatMap(c=>c.metricIds).length,62);
});

test('pipeline requires fresh outputs and records 62/68 production coverage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'db-production-'));
  const inspector=join(root,'inspector-v04');
  await mkdir(join(root,'replays'),{recursive:true}); await mkdir(inspector,{recursive:true});
  await writeFile(join(root,'replays','fixture.dem'),'fixture');
  const producer=join(root,'producer.mjs');
  await writeFile(producer,`import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';const root=process.argv[2],r=process.argv[3];await mkdir(join(root,'output',r),{recursive:true});await writeFile(join(root,'output',r,'player_state.jsonl'),'{}\\n');await writeFile(join(root,'output',r,'player_state_summary.json'),'{}\\n');`);
  const itemProducer=join(root,'item-producer.mjs');
  await writeFile(itemProducer,`import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';const root=process.argv[2],r=process.argv[3];await mkdir(join(root,'output',r),{recursive:true});await writeFile(join(root,'output',r,'runtime_item_ownership_production_v01.json'),'{}\\n');await writeFile(join(root,'output',r,'runtime_item_ownership_events_v01.jsonl'),'{}\\n');`);
  const permProducer=join(root,'perm-producer.mjs');
  await writeFile(permProducer,`import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';const root=process.argv[2],r=process.argv[3];await mkdir(join(root,'output',r),{recursive:true});await writeFile(join(root,'output',r,'runtime_permanent_buff_ownership_production_v01.json'),'{}\\n');await writeFile(join(root,'output',r,'runtime_permanent_buff_events_v01.jsonl'),'');`);
  const bridgeProducer=join(root,'bridge-producer.mjs');
  await writeFile(bridgeProducer,`import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';const root=process.argv[2],r=process.argv[3];await mkdir(join(root,'output',r),{recursive:true});await writeFile(join(root,'output',r,'runtime_bridge_buff_ownership_production_v01.json'),'{}\\n');await writeFile(join(root,'output',r,'runtime_bridge_buff_events_v01.jsonl'),'');`);
  const pipeline={version:'TEST',manifestFile:'production_manifest_v01.json',steps:[
    {id:'core',label:'core',capability:'core_state_economy',required:true,args:[producer,'{repoRoot}','{replay}'],ifExists:'replays/{replay}.dem',expectedOutputs:[{path:'output/{replay}/player_state.jsonl',minBytes:2},{path:'output/{replay}/player_state_summary.json',minBytes:2}]},
    {id:'health',label:'health',capability:'health_regen',required:false},
    {id:'items',label:'items',capability:'runtime_item_ownership',required:true,dependsOn:['core'],args:[itemProducer,'{repoRoot}','{replay}'],expectedOutputs:[{path:'output/{replay}/runtime_item_ownership_production_v01.json',minBytes:2},{path:'output/{replay}/runtime_item_ownership_events_v01.jsonl',minBytes:2}]},
    {id:'perm',label:'perm',capability:'runtime_permanent_buff_ownership',required:true,dependsOn:['core'],args:[permProducer,'{repoRoot}','{replay}'],expectedOutputs:[{path:'output/{replay}/runtime_permanent_buff_ownership_production_v01.json',minBytes:2},{path:'output/{replay}/runtime_permanent_buff_events_v01.jsonl',minBytes:0}]},
    {id:'bridge',label:'bridge',capability:'runtime_bridge_buff_ownership',required:true,dependsOn:['core'],args:[bridgeProducer,'{repoRoot}','{replay}'],expectedOutputs:[{path:'output/{replay}/runtime_bridge_buff_ownership_production_v01.json',minBytes:2},{path:'output/{replay}/runtime_bridge_buff_events_v01.jsonl',minBytes:0}]},
    {id:'fire',label:'fire',capability:'primary_fire_cadence',required:false}
  ]};
  await writeFile(join(inspector,'pipeline.json'),JSON.stringify(pipeline));
  const result=await runPipeline({repoRoot:root,inspectorRoot:inspector,replayName:'fixture'});
  assert.equal(result.status,'COMPLETE_WITH_UNSUPPORTED_CAPABILITIES');
  assert.equal(result.results[0].status,'complete');
  assert.equal(result.results.find(r=>r.id==='items').status,'complete');
  assert.equal(result.results.find(r=>r.id==='perm').status,'complete');
  assert.equal(result.results.find(r=>r.id==='bridge').status,'complete');
  assert.equal(result.productionManifest.coverage.completeAuthoritative,62);
  assert.equal(result.productionManifest.coverage.notSupportedAuthoritative,6);
  assert.equal(result.productionManifest.coverage.unclassifiedAuthoritative,0);
  const disk=JSON.parse(await readFile(join(root,'output','fixture','production_manifest_v01.json'),'utf8'));
  assert.equal(disk.coverage.authoritativeTotal,68);
});

test('existing outputs are not accepted when the current producer does not rewrite them',async()=>{
  const root=await mkdtemp(join(tmpdir(),'db-stale-'));const inspector=join(root,'inspector-v04'),out=join(root,'output','fixture');
  await mkdir(join(root,'replays'),{recursive:true});await mkdir(inspector,{recursive:true});await mkdir(out,{recursive:true});
  await writeFile(join(root,'replays','fixture.dem'),'fixture');await writeFile(join(out,'player_state.jsonl'),'old\n');await writeFile(join(out,'player_state_summary.json'),'old\n');
  const noop=join(root,'noop.mjs');await writeFile(noop,'process.exit(0);');
  await writeFile(join(inspector,'pipeline.json'),JSON.stringify({version:'TEST',steps:[{id:'core',label:'core',capability:'core_state_economy',required:true,args:[noop],ifExists:'replays/{replay}.dem',expectedOutputs:['output/{replay}/player_state.jsonl','output/{replay}/player_state_summary.json']}]}));
  const result=await runPipeline({repoRoot:root,inspectorRoot:inspector,replayName:'fixture'});
  assert.equal(result.results[0].status,'failed');
  assert.match(result.results[0].reason,/not freshly written/);
  assert.equal(result.productionManifest.coverage.failedAuthoritative,41);
});

test('player-state summary supplies match-clock offset when integrated substrate is absent',async()=>{
  const root=await mkdtemp(join(tmpdir(),'db-clock-'));const out=join(root,'output','fixture');await mkdir(out,{recursive:true});
  function row(matchTime){return JSON.stringify({demoTick:Math.round((matchTime+30)*64),demoSeconds:matchTime+30,matchTimeSeconds:matchTime,controller:{entityIndex:1,playerName:'Alpha',steamId:'1',team:2,heroId:1,alive:true,health:500,maxHealth:500,level:1,netWorth:600,abilityPointNetWorth:0,kills:0,deaths:0,assists:0,lastHits:0,denies:0,respawnTime:0},pawn:{entityIndex:2,positionWorld:{x:0,y:0,z:0}}});}
  await writeFile(join(out,'player_state.jsonl'),row(0)+'\n'+row(120)+'\n');
  await writeFile(join(out,'player_state_summary.json'),JSON.stringify({tickRateAssumed:64,matchClockOffsetSeconds:30}));
  const model=await buildReplayModel({outputRoot:join(root,'output'),replayName:'fixture'});
  assert.equal(model.match.matchClockOffsetSeconds,30);
  assert.equal(model.match.matchDurationSeconds,120);
});

test('dedicated runtime item artifact overrides legacy item source in replay model',async()=>{
  const root=await mkdtemp(join(tmpdir(),'db-items-model-'));const out=join(root,'output','fixture');await mkdir(out,{recursive:true});
  function row(matchTime){return JSON.stringify({demoTick:Math.round((matchTime+30)*64),demoSeconds:matchTime+30,matchTimeSeconds:matchTime,controller:{entityIndex:1,playerName:'Alpha',steamId:'1',team:2,heroId:1,alive:true,health:500,maxHealth:500,level:1,netWorth:600,abilityPointNetWorth:0,kills:0,deaths:0,assists:0,lastHits:0,denies:0,respawnTime:0},pawn:{entityIndex:2,positionWorld:{x:0,y:0,z:0}}});}
  await writeFile(join(out,'player_state.jsonl'),row(0)+'\n'+row(120)+'\n');
  await writeFile(join(out,'player_state_summary.json'),JSON.stringify({tickRateAssumed:64,matchClockOffsetSeconds:30,finalMatchTimeSeconds:120}));
  const item={itemId:123,mapped:true,resourceClass:'STANDARD_SHOP',recordKey:'upgrade_fixture',itemSlot:'EItemSlotType_Armor',itemTier:1,standardShopPrice:800};
  await writeFile(join(out,'runtime_item_ownership_production_v01.json'),JSON.stringify({status:'RUNTIME_ITEM_OWNERSHIP_PRODUCTION_V01_READY',players:[{entityIndex:1,playerName:'Alpha',steamId:'1',finalStandardShopItems:[item],itemEvents:[{eventType:'ITEM_OWNERSHIP_ENTERED',tick:2560,time:10,playerName:'Alpha',controllerEntityIndex:1,item}],ownershipIntervals:[{item,startTick:2560,startTime:10,endTime:120,durationSeconds:110,endReason:'REPLAY_END'}]}]}));
  const model=await buildReplayModel({outputRoot:join(root,'output'),replayName:'fixture'});
  const p=model.players.find(x=>x.playerName==='Alpha');
  assert.equal(p.items.finalItems[0].recordKey,'upgrade_fixture');
  assert.equal(p.items.events[0].eventType,'ITEM_ADDED');
  assert.equal(p.items.events[0].sourceEventType,'ITEM_OWNERSHIP_ENTERED');
  assert.equal(p.items.ownershipIntervals[0].durationSeconds,110);
});


test('dedicated runtime permanent-buff artifact overrides legacy permanent state in replay model',async()=>{
  const root=await mkdtemp(join(tmpdir(),'db-perm-model-'));const out=join(root,'output','fixture');await mkdir(out,{recursive:true});
  function row(matchTime,name='Alpha',team=2,entityIndex=1){return JSON.stringify({demoTick:Math.round((matchTime+30)*64),demoSeconds:matchTime+30,matchTimeSeconds:matchTime,controller:{entityIndex,playerName:name,steamId:String(entityIndex),team,heroId:1,alive:true,health:500,maxHealth:500,level:1,netWorth:600,abilityPointNetWorth:0,kills:0,deaths:0,assists:0,lastHits:0,denies:0,respawnTime:0},pawn:{entityIndex:entityIndex+100,positionWorld:{x:0,y:0,z:0}}});}
  await writeFile(join(out,'player_state.jsonl'),row(0)+'\n'+row(120)+'\n');
  await writeFile(join(out,'player_state_summary.json'),JSON.stringify({tickRateAssumed:64,matchClockOffsetSeconds:30,finalMatchTimeSeconds:120}));
  const state={spirit_permanent_pickup:{inferredUnits:2,totalValue:4,rows:[{sourceModifierId:1,recordKey:'spirit_permanent_pickup',tier:1,inferredUnits:2,totalValue:4}]}};
  await writeFile(join(out,'runtime_permanent_buff_ownership_production_v01.json'),JSON.stringify({status:'RUNTIME_PERMANENT_BUFF_OWNERSHIP_PRODUCTION_V01_READY',players:[{entityIndex:1,playerName:'Alpha',steamId:'1',acquisitionEvents:[{eventType:'PERMANENT_BUFF_POSITIVE_ACCUMULATION',tick:2560,matchTimeSeconds:10,time:10,state}],finalPermanentBuffs:state,summary:{totalUnits:2,families:state}}]}));
  const model=await buildReplayModel({outputRoot:join(root,'output'),replayName:'fixture'});
  const p=model.players.find(x=>x.playerName==='Alpha');
  assert.equal(p.permanentBuffs.summary.totalUnits,2);
  assert.equal(p.permanentBuffs.final.spirit_permanent_pickup.totalValue,4);
  assert.equal(p.permanentBuffs.events[0].time,10);
});


test('dedicated runtime bridge artifact overrides legacy bridge state in replay model',async()=>{
  const root=await mkdtemp(join(tmpdir(),'db-bridge-model-'));const out=join(root,'output','fixture');await mkdir(out,{recursive:true});
  function row(matchTime,name='Alpha',team=2,entityIndex=1){return JSON.stringify({demoTick:Math.round((matchTime+30)*64),demoSeconds:matchTime+30,matchTimeSeconds:matchTime,gameState:7,controller:{entityIndex,playerName:name,steamId:String(entityIndex),team,heroId:1,alive:true,health:500,maxHealth:500,level:1,netWorth:600,abilityPointNetWorth:0,kills:0,deaths:0,assists:0,lastHits:0,denies:0,respawnTime:0},pawn:{entityIndex:entityIndex+100,positionWorld:{x:0,y:0,z:0}}});}
  await writeFile(join(out,'player_state.jsonl'),row(0)+'\n'+row(120)+'\n');
  await writeFile(join(out,'player_state_summary.json'),JSON.stringify({tickRateAssumed:64,matchClockOffsetSeconds:30,finalMatchTimeSeconds:120}));
  const interval={intervalId:'bridge-1',playerName:'Alpha',steamId:'1',controllerEntityIndex:1,team:2,buffType:'gun_powerup_pickup',recordKey:'gun_powerup_pickup',startTick:2560,stateEndTick:8960,startTime:10,endTime:110,durationSeconds:100,terminationReason:'DEATH_TERMINATION',terminationObserved:true,collectionDistanceHU:42};
  await writeFile(join(out,'runtime_bridge_buff_ownership_production_v01.json'),JSON.stringify({status:'RUNTIME_BRIDGE_BUFF_OWNERSHIP_PRODUCTION_V01_READY',replay:{replayEndTick:9600,matchClockOffsetSeconds:30},players:[{controllerEntityIndex:1,playerName:'Alpha',steamId:'1',bridgeIntervals:[interval],collectionEvents:[],summary:{collections:1,totalUptimeSeconds:100}}]}));
  const model=await buildReplayModel({outputRoot:join(root,'output'),replayName:'fixture'});
  const p=model.players.find(x=>x.playerName==='Alpha');
  assert.equal(p.bridgeBuffs.intervals.length,1);
  assert.equal(p.bridgeBuffs.intervals[0].recordKey,'gun_powerup_pickup');
  assert.equal(p.bridgeBuffs.intervals[0].terminationReason,'DEATH_TERMINATION');
  assert.equal(model.teams.find(x=>x.team===2).bridgeUptimeSeconds,100);
});
