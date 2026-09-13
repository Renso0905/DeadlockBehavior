import fs from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { buildReplayModel } from '../inspector-v04/lib/replay-model.mjs';
import { metricValue } from '../inspector-v04/public/metric-values.mjs';
import { PRODUCTION_METRIC_CONTRACT } from '../src/contracts/production-metric-contract.mjs';
import { runPipeline } from '../inspector-v04/lib/pipeline.mjs';

const args=process.argv.slice(2),processFirst=args.includes('--process');
const names=args.filter(x=>!x.startsWith('--'));
if(!names.length)names.push(...(await fs.readdir('replays')).filter(x=>x.toLowerCase().endsWith('.dem')).map(x=>x.slice(0,-4)).sort());
const results=[];
for(const replayName of names){
 console.log(`Validating ${replayName}`);
 if(processFirst){const result=await runPipeline({repoRoot:process.cwd(),inspectorRoot:resolve('inspector-v04'),replayName,onEvent:e=>{if(e.type==='step-start')console.log(`${replayName}: ${e.id}`);}});if(result.status!=='COMPLETE')throw new Error(`${replayName}: ${result.status} ${result.error??''}`);}
 const m=await buildReplayModel({outputRoot:resolve('output'),replayName});const errors=[];
 const check=(pass,message)=>{if(!pass)errors.push(message);};const close=(a,b)=>Math.abs(a-b)<1e-7;
 check(m.productionReadiness.available,m.productionReadiness.reason);
 check(new Set(m.players.map(p=>p.playerId)).size===m.players.length,'duplicate player IDs');
 const probes=[];
 for(const p of m.players){
  check(close(p.core.aliveSeconds+p.core.deadSeconds+(p.core.unknownStateSeconds??0),m.match.matchDurationSeconds),`${p.playerId}: gameplay time partition`);
  check(close(p.movement.movingSeconds+p.movement.lowMotionSeconds,p.movement.validMovementSeconds),`${p.playerId}: movement partition`);
  check(p.melee&&p.melee.hits<=p.melee.attacks,`${p.playerId}: melee bounds`);
  check(p.melee&&p.melee.light+p.melee.heavy+p.melee.airHeavy+p.melee.slide===p.melee.attacks,`${p.playerId}: melee type partition`);
  for(const [metric,field] of [['kills','kills'],['assists','assists'],['last_hits','lastHits'],['denies','denies']]){
   const observed=p.scoreboard.timelines[field].reduce((n,e)=>n+e.delta,0)+(p.initialState?.[field]??0);
   check(observed===p.scoreboard[field],`${p.playerId}: ${metric} timeline reconciliation`);
  }
  for(const time of [0,m.match.matchDurationSeconds/2,m.match.matchDurationSeconds])for(const metric of PRODUCTION_METRIC_CONTRACT.metrics){
   const value=metricValue(metric.metricId,{model:m,p,time});
   if(!value.wired)errors.push(`${p.playerId}: ${metric.metricId} not wired`);
   if(time===m.match.matchDurationSeconds&&!value.available)errors.push(`${p.playerId}: ${metric.metricId} unavailable: ${value.detail}`);
   if(value.value==='NaN'||value.value==='Infinity'||value.value==='undefined')errors.push(`${p.playerId}: ${metric.metricId} invalid value`);
   probes.push({playerId:p.playerId,metricId:metric.metricId,time,available:value.available,value:value.value,scope:value.scope});
  }
 }
 for(const team of m.teams)check(team.goldNetWorth===m.players.filter(p=>p.team===team.team).reduce((n,p)=>n+p.scoreboard.goldNetWorth,0),`team ${team.team}: economy sum`);
 const result={replayName,runId:m.productionManifest?.runId,metricCount:PRODUCTION_METRIC_CONTRACT.metrics.length,players:m.players.length,probeCount:probes.length,pass:errors.length===0,errors,probes};
 results.push(result);await fs.mkdir('output/cross_replay',{recursive:true});await fs.writeFile(join('output/cross_replay',`production_reliability_${replayName}_v02.json`),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({replayName,pass:result.pass,players:result.players,probeCount:result.probeCount,errors}));
}
await fs.writeFile('output/cross_replay/production_reliability_validation_v02.json',JSON.stringify({generatedAt:new Date().toISOString(),metricCount:PRODUCTION_METRIC_CONTRACT.metrics.length,pass:results.every(r=>r.pass),replays:results.map(({probes,...r})=>r)},null,2)+'\n');
if(results.some(r=>!r.pass))process.exitCode=1;
