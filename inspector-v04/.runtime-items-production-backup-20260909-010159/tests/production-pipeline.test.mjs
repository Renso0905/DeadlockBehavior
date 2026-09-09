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
});

test('pipeline requires fresh outputs and records 41/68 production coverage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'db-production-'));
  const inspector=join(root,'inspector-v04');
  await mkdir(join(root,'replays'),{recursive:true}); await mkdir(inspector,{recursive:true});
  await writeFile(join(root,'replays','fixture.dem'),'fixture');
  const producer=join(root,'producer.mjs');
  await writeFile(producer,`import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';const root=process.argv[2],r=process.argv[3];await mkdir(join(root,'output',r),{recursive:true});await writeFile(join(root,'output',r,'player_state.jsonl'),'{}\\n');await writeFile(join(root,'output',r,'player_state_summary.json'),'{}\\n');`);
  const pipeline={version:'TEST',manifestFile:'production_manifest_v01.json',steps:[
    {id:'core',label:'core',capability:'core_state_economy',required:true,args:[producer,'{repoRoot}','{replay}'],ifExists:'replays/{replay}.dem',expectedOutputs:[{path:'output/{replay}/player_state.jsonl',minBytes:2},{path:'output/{replay}/player_state_summary.json',minBytes:2}]},
    {id:'health',label:'health',capability:'health_regen',required:false},
    {id:'items',label:'items',capability:'runtime_item_ownership',required:false},
    {id:'perm',label:'perm',capability:'runtime_permanent_buff_ownership',required:false},
    {id:'bridge',label:'bridge',capability:'runtime_bridge_buff_ownership',required:false},
    {id:'fire',label:'fire',capability:'primary_fire_cadence',required:false}
  ]};
  await writeFile(join(inspector,'pipeline.json'),JSON.stringify(pipeline));
  const result=await runPipeline({repoRoot:root,inspectorRoot:inspector,replayName:'fixture'});
  assert.equal(result.status,'COMPLETE_WITH_UNSUPPORTED_CAPABILITIES');
  assert.equal(result.results[0].status,'complete');
  assert.equal(result.productionManifest.coverage.completeAuthoritative,41);
  assert.equal(result.productionManifest.coverage.notSupportedAuthoritative,27);
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
