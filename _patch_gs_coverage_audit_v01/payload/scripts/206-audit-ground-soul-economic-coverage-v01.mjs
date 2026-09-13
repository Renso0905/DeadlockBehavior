import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { EntityOperation, InterceptorStage, Logger, Parser, ParserConfiguration } from 'deadem';
import { auditGroundSoulEconomicCoverage, DEFAULT_AUDIT_RADIUS_TICKS } from '../inspector-v04/lib/research-ground-soul-economic-coverage.mjs';

const PAWN_CLASS='CCitadelPlayerPawn';
const CURRENCY_FIELD='m_nCurrencies.0000';
const TICKS_PER_SECOND=64;
const STATUS='GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_V01_READY';
const arg=process.argv[2]??'104373259';
const repoRoot=resolve(process.cwd());

if(arg==='all'){
  const outputRoot=join(repoRoot,'output');
  const names=existsSync(outputRoot)?readdirSync(outputRoot).filter(name=>{
    const p=join(outputRoot,name);return statSafeDir(p)&&existsSync(join(p,'runtime_ground_soul_lifecycle_events_v01.jsonl'))&&existsSync(join(p,'runtime_assigned_gold_economic_credit_events_v01.jsonl'));
  }):[];
  const summaries=[];
  for(const name of names){
    try{const out=await auditReplay(name,{allowMissingReplay:true});summaries.push(compactBatch(out));}
    catch(err){summaries.push({replayName:name,status:'FAILED',error:err.message});}
  }
  const batch={version:'GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_BATCH_V01',createdAt:new Date().toISOString(),status:'GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_BATCH_V01_READY',replays:summaries};
  const outPath=join(outputRoot,'cross_replay','ground_soul_economic_coverage_audit_batch_v01.json');mkdirSync(join(outputRoot,'cross_replay'),{recursive:true});writeFileSync(outPath,JSON.stringify(batch,null,2)+'\n');
  console.log(`Batch audit complete: ${summaries.filter(x=>x.status===STATUS).length}/${summaries.length} READY`);console.log(`JSON: ${outPath}`);
}else{
  await auditReplay(arg,{allowMissingReplay:false});
}

async function auditReplay(input,{allowMissingReplay}){
  const replayName=basename(String(input),extname(String(input)));
  const replayPath=String(input).toLowerCase().endsWith('.dem')?resolve(String(input)):join(repoRoot,'replays',`${replayName}.dem`);
  const dir=join(repoRoot,'output',replayName);
  const lifecyclePath=join(dir,'runtime_ground_soul_lifecycle_events_v01.jsonl');
  const economyPath=join(dir,'runtime_assigned_gold_economic_credit_events_v01.jsonl');
  const trooperPath=join(dir,'runtime_trooper_death_events_v01.jsonl');
  const playerStatePath=join(dir,'player_state.jsonl');
  const playerSummaryPath=join(dir,'player_state_summary.json');
  for(const p of [lifecyclePath,economyPath])if(!existsSync(p))throw new Error(`Required input missing: ${p}`);
  const episodes=await readJsonl(lifecyclePath);
  const economicEvents=await readJsonl(economyPath);
  const trooperDeaths=existsSync(trooperPath)?await readJsonl(trooperPath):[];
  let currencyDeltas=null;
  let currencyRescan={available:false,reason:null,positiveTransitions:null,observedPawnEntities:null};
  if(existsSync(replayPath)&&existsSync(playerStatePath)&&existsSync(playerSummaryPath)){
    const playerSummary=JSON.parse(readFileSync(playerSummaryPath,'utf8'));
    const offset=finite(playerSummary?.matchClockOffsetSeconds)??0;
    const identities=await loadPlayerIdentities(playerStatePath);
    const scan=await scanCurrencyDeltas(replayPath,identities,offset);
    currencyDeltas=scan.currencyDeltas;
    currencyRescan={available:true,reason:null,positiveTransitions:currencyDeltas.length,observedPawnEntities:scan.observedPawnEntities};
  }else{
    currencyRescan.reason='Replay, player-state, or player-summary input unavailable; resolver-stage audit remains valid but raw currency collision context is unavailable.';
    if(!allowMissingReplay&&!existsSync(replayPath))throw new Error(`Replay missing for full audit: ${replayPath}`);
  }
  const {rows,summary}=auditGroundSoulEconomicCoverage({episodes,economicEvents,currencyDeltas,trooperDeaths,radiusTicks:DEFAULT_AUDIT_RADIUS_TICKS});
  const out={
    version:'GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_V01',createdAt:new Date().toISOString(),status:STATUS,authorityLayer:'research_diagnostic_B',
    replay:{replayName,replayPath:existsSync(replayPath)?replayPath:null,ticksPerSecond:TICKS_PER_SECOND},
    inputs:{lifecycleEvents:lifecyclePath,economicEvents:economyPath,trooperDeaths:existsSync(trooperPath)?trooperPath:null,currencyRescan},
    semanticScope:summary.semanticScope,
    summary,
    validation:{
      integrityValidation:summary.integrity.eventKeySetsExact?'pass':'fail',
      semanticValidation:'diagnostic_only',
      replicationStatus:'not_assigned_by_this_script',
      checks:{
        lifecycleEconomicKeySetsExact:summary.integrity.eventKeySetsExact,
        lifecycleRows:summary.integrity.lifecycleRows,
        economicRows:summary.integrity.economicRows,
        missingEconomicResolutionRows:summary.integrity.missingEconomicResolutionRows,
        orphanEconomicResolutionRows:summary.integrity.orphanEconomicResolutionRows,
      }
    }
  };
  const jsonPath=join(dir,'ground_soul_economic_coverage_audit_v01.json');
  const eventsPath=join(dir,'ground_soul_economic_coverage_audit_events_v01.jsonl');
  writeFileSync(jsonPath,JSON.stringify(out,null,2)+'\n','utf8');
  writeFileSync(eventsPath,rows.map(x=>JSON.stringify(x)).join('\n')+(rows.length?'\n':''),'utf8');
  printSummary(out,jsonPath,eventsPath);
  return out;
}

async function scanCurrencyDeltas(replayPath,identities,matchClockOffsetSeconds){
  const parser=new Parser(new ParserConfiguration({entityClasses:[PAWN_CLASS]}),Logger.CONSOLE_INFO);
  const previousCurrencyByPawn=new Map(),currencyDeltas=[];const observed=new Set();
  parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET,(demoPacket,messagePacket,entityEvents)=>{
    const tick=Number.isFinite(demoPacket?.tick)?demoPacket.tick:null;if(tick===null)return;
    for(const event of entityEvents){
      const entity=event.entity;if(!entity||String(entity?.class?.name??'')!==PAWN_CLASS)continue;
      if(event.operation!==EntityOperation.CREATE&&event.operation!==EntityOperation.UPDATE)continue;
      const pawnEntityIndex=integer(entity.index);if(pawnEntityIndex===null)continue;observed.add(pawnEntityIndex);
      const current=finite(entity.getField(CURRENCY_FIELD));if(current===null)continue;
      const previous=previousCurrencyByPawn.get(pawnEntityIndex);previousCurrencyByPawn.set(pawnEntityIndex,current);
      if(previous===undefined||!(current>previous))continue;
      const identity=identities.get(pawnEntityIndex)??null;
      currencyDeltas.push({tick,demoSeconds:tick/TICKS_PER_SECOND,matchTimeSeconds:tick/TICKS_PER_SECOND-matchClockOffsetSeconds,pawnEntityIndex,playerName:identity?.playerName??null,steamId:identity?.steamId??null,heroId:integer(identity?.heroId),team:integer(identity?.team)??integer(entity.getField('m_iTeamNum')),previousCurrency0:previous,currentCurrency0:current,delta:current-previous});
    }
  });
  try{await parser.parse(createReadStream(replayPath));}finally{await parser.dispose();}
  return {currencyDeltas,observedPawnEntities:observed.size};
}

async function loadPlayerIdentities(path){
  const map=new Map();const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});let lines=0;
  for await(const line of rl){if(!line.trim())continue;lines++;let row;try{row=JSON.parse(line);}catch{continue;}
    if(row.controller&&typeof row.controller==='object'){
      const pawn=row.pawn??{},controller=row.controller??{};const idx=integer(pawn.entityIndex);if(idx!==null&&!map.has(idx))map.set(idx,{pawnEntityIndex:idx,controllerEntityIndex:integer(controller.entityIndex),playerName:controller.playerName??null,steamId:controller.steamId??null,heroId:integer(controller.heroId),team:integer(controller.team??controller.teamNum)});
    }
    for(const p of row.players??[]){const idx=integer(p.heroEntityIndex??p.pawnEntityIndex);if(idx!==null&&!map.has(idx))map.set(idx,{pawnEntityIndex:idx,controllerEntityIndex:integer(p.controllerEntityIndex),playerName:p.playerName??null,steamId:p.steamId??null,heroId:integer(p.heroId),team:integer(p.team??p.teamNum)});}
    if(map.size>=12||lines>=5000)break;
  }
  return map;
}
async function readJsonl(path){const rows=[];const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of rl){if(!line.trim())continue;try{rows.push(JSON.parse(line));}catch{}}return rows;}
function printSummary(out,jsonPath,eventsPath){
  const s=out.summary,f=s.funnel,c=s.collisionDiagnostics;
  console.log('');console.log('=======================================================');console.log('GROUND SOUL ECONOMIC COVERAGE / EXCLUSION AUDIT V01');console.log('=======================================================');
  console.log(`Replay: ${out.replay.replayName}`);console.log(`Status: ${out.status}`);console.log(`Authority: B diagnostic (does not alter A metrics)`);
  console.log(`Lifecycle activations: ${f.lifecycleActivations}`);console.log(`Completed lifecycles: ${f.completedLifecycle}`);console.log(`Completed + targeted: ${f.completedTargetedLifecycle}`);console.log(`Current resolver candidates: ${f.currentResolverCandidates}`);console.log(`Resolved A economic-credit events: ${f.resolvedEconomicCredit}`);console.log(`Not resolved: ${f.notResolved}`);
  console.log(`Resolved share of all lifecycle activations: ${pct(s.coverage.resolvedShareOfAllLifecycle)}`);console.log(`Resolved share of current resolver candidates: ${pct(s.coverage.resolvedShareOfCurrentResolverCandidates)}`);
  console.log('');console.log('Exclusion stages:');for(const [k,v] of Object.entries(s.exclusionStageCounts))console.log(`  ${k}: ${v}`);
  console.log('');console.log('Collision diagnostics:');console.log(`  Nonisolated events: ${c.nonisolatedEvents}`);console.log(`  With same-tick AssignedGold collision: ${c.nonisolatedWithSameTickAssignedGoldCollision}`);console.log(`  With exact-tick same-team positive currency: ${fmtNullable(c.nonisolatedWithExactTickSameTeamPositiveCurrency)}`);console.log(`  With 2+ Trooper deaths near activation: ${c.nonisolatedWithTwoOrMoreTrooperDeathsNearActivation}`);
  console.log(`Currency rescan: ${out.inputs.currencyRescan.available?'available':'unavailable'}`);console.log(`JSON: ${jsonPath}`);console.log(`Events: ${eventsPath}`);
}
function compactBatch(out){return {replayName:out.replay.replayName,status:out.status,currencyRescanAvailable:out.inputs.currencyRescan.available,funnel:out.summary.funnel,coverage:out.summary.coverage,exclusionStageCounts:out.summary.exclusionStageCounts,collisionDiagnostics:out.summary.collisionDiagnostics,integrity:out.summary.integrity};}
function statSafeDir(path){try{return statSync(path).isDirectory();}catch{return false;}}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function integer(v){const n=Number(v);return Number.isInteger(n)?n:null;}
function pct(v){return Number.isFinite(v)?`${(v*100).toFixed(2)}%`:'n/a';}
function fmtNullable(v){return v===null||v===undefined?'n/a':String(v);}
