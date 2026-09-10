import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { auditGroundSoulCollisionResolution, DEFAULT_COLLISION_RADIUS_TICKS, nearestCollisionCases } from '../inspector-v04/lib/research-ground-soul-collision-resolution.mjs';

const STATUS='GROUND_SOUL_COLLISION_RESOLUTION_AUDIT_V02_READY';
const repoRoot=resolve(process.cwd());
const arg=process.argv[2]??'104373259';
const focusSeconds=Number.isFinite(Number(process.argv[3]))?Number(process.argv[3]):null;

if(arg==='all'){
  const outputRoot=join(repoRoot,'output');
  const names=existsSync(outputRoot)?readdirSync(outputRoot).filter(name=>{
    const p=join(outputRoot,name);return statSafeDir(p)&&existsSync(join(p,'ground_soul_economic_coverage_audit_events_v01.jsonl'))&&existsSync(join(p,'ground_soul_economic_coverage_audit_v01.json'));
  }):[];
  const summaries=[];
  for(const name of names){
    try{const out=await auditReplay(name,null);summaries.push(compactBatch(out));}
    catch(err){summaries.push({replayName:name,status:'FAILED',error:err.message});}
  }
  const batch={
    version:'GROUND_SOUL_COLLISION_RESOLUTION_AUDIT_BATCH_V02',
    createdAt:new Date().toISOString(),
    status:'GROUND_SOUL_COLLISION_RESOLUTION_AUDIT_BATCH_V02_READY',
    authorityLayer:'research_diagnostic_B',
    semanticBoundary:'Cross-replay diagnostic aggregation only; no counterfactual-pass event is promoted into the A ledger.',
    replays:summaries,
  };
  const outPath=join(outputRoot,'cross_replay','ground_soul_collision_resolution_audit_batch_v02.json');
  mkdirSync(join(outputRoot,'cross_replay'),{recursive:true});writeFileSync(outPath,JSON.stringify(batch,null,2)+'\n','utf8');
  console.log(`Batch collision audit complete: ${summaries.filter(x=>x.status===STATUS).length}/${summaries.length} READY`);
  console.log(`JSON: ${outPath}`);
}else{
  await auditReplay(arg,focusSeconds);
}

async function auditReplay(input,focus){
  const replayName=basename(String(input),extname(String(input)));
  const dir=join(repoRoot,'output',replayName);
  const coverageJsonPath=join(dir,'ground_soul_economic_coverage_audit_v01.json');
  const coverageEventsPath=join(dir,'ground_soul_economic_coverage_audit_events_v01.jsonl');
  if(!existsSync(coverageJsonPath)||!existsSync(coverageEventsPath))throw new Error(`Coverage audit V01 is required first. Run .\\inspector-v04\\run-ground-soul-coverage-audit.ps1 ${replayName}`);
  const coverage=JSON.parse(readFileSync(coverageJsonPath,'utf8'));
  if(coverage?.status!=='GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_V01_READY')throw new Error(`Coverage audit is not READY: ${coverage?.status??'missing status'}`);
  const coverageRows=await readJsonl(coverageEventsPath);
  const {rows,summary}=auditGroundSoulCollisionResolution({coverageRows,radiusTicks:coverage?.summary?.radiusTicks??DEFAULT_COLLISION_RADIUS_TICKS});
  const expectedNonisolated=Number(coverage?.summary?.collisionDiagnostics?.nonisolatedEvents??0);
  const checks={
    sourceCoverageReady:check(coverage.status,'GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_V01_READY',coverage.status==='GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_V01_READY'),
    sourceRowsPresent:check(coverageRows.length,'>0',coverageRows.length>0),
    nonisolatedCountMatchesCoverageAudit:check(rows.length,expectedNonisolated,rows.length===expectedNonisolated),
    allRowsRemainDiagnosticNonisolated:check(rows.filter(r=>r.sourceResolutionStatus!=='UNRESOLVED_NONISOLATED_TERMINATION').length,0,rows.every(r=>r.sourceResolutionStatus==='UNRESOLVED_NONISOLATED_TERMINATION')),
    noAuthoritativePromotionField:check(rows.filter(r=>r?.counterfactualNarrowerIsolation?.wouldPass&&r?.resolvedEconomicCredit===true).length,0,rows.every(r=>r.resolvedEconomicCredit!==true)),
  };
  const failed=Object.entries(checks).filter(([,v])=>!v.pass).map(([k])=>k);if(failed.length)throw new Error(`Collision audit integrity failed: ${failed.join(', ')}`);
  const calibrationFocus=focus===null?null:{
    focusSeconds:focus,
    windowSeconds:2,
    nearest:nearestCollisionCases(rows,focus,12,2),
  };
  const out={
    version:'GROUND_SOUL_COLLISION_RESOLUTION_AUDIT_V02',
    createdAt:new Date().toISOString(),
    status:STATUS,
    authorityLayer:'research_diagnostic_B',
    replay:{replayName,ticksPerSecond:64},
    inputs:{coverageSummary:coverageJsonPath,coverageEvents:coverageEventsPath,sourceCoverageCreatedAt:coverage.createdAt??null},
    semanticScope:summary.semanticScope,
    summary,
    calibrationFocus,
    validation:{
      integrityValidation:'pass',
      semanticValidation:'diagnostic_only',
      replicationStatus:'not_assigned_by_this_script',
      checks,
    },
  };
  const jsonPath=join(dir,'ground_soul_collision_resolution_audit_v02.json');
  const eventsPath=join(dir,'ground_soul_collision_resolution_audit_events_v02.jsonl');
  writeFileSync(jsonPath,JSON.stringify(out,null,2)+'\n','utf8');
  writeFileSync(eventsPath,rows.map(r=>JSON.stringify(r)).join('\n')+(rows.length?'\n':''),'utf8');
  printSummary(out,jsonPath,eventsPath);
  return out;
}

function printSummary(out,jsonPath,eventsPath){
  const s=out.summary,cf=s.counterfactualNarrowerIsolation;
  console.log('');
  console.log('=======================================================');
  console.log('GROUND SOUL COLLISION RESOLUTION AUDIT V02');
  console.log('=======================================================');
  console.log(`Replay: ${out.replay.replayName}`);
  console.log(`Status: ${out.status}`);
  console.log('Authority: B diagnostic (does not alter A metrics)');
  console.log(`Nonisolated events: ${s.nonisolatedEvents}`);
  console.log(`Collision clusters: ${s.collisionClusters}`);
  console.log('');
  console.log('Collision classes:');
  for(const [k,v] of sortCounts(s.collisionClassCounts))console.log(`  ${k}: ${v}`);
  console.log('');
  console.log('Counterfactual narrower isolation:');
  console.log(`  Would pass narrower same-tick/same-team isolation: ${cf.wouldPassEvents}`);
  console.log(`  Still ambiguous from same-tick same-team collisions: ${cf.stillSameTickSameTeamAmbiguous}`);
  for(const [k,v] of sortCounts(s.counterfactualResultCounts))if(!['WOULD_PASS_NARROWER_SAME_TICK_SAME_TEAM_ISOLATION','STILL_AMBIGUOUS_SAME_TICK_SAME_TEAM'].includes(k))console.log(`  ${k}: ${v}`);
  console.log(`  Current resolved A events (unchanged): ${cf.currentResolvedAEvents}`);
  console.log(`  Hypothetical algorithmic total if every counterfactual pass were later validated: ${cf.hypotheticalResolvedIfAllCounterfactualPassesWereEventuallyValidated} (${pct(cf.hypotheticalResolvedShareOfAllLifecycle)} of all lifecycle activations)`);
  console.log('');
  console.log('Trooper concurrency context:');
  for(const [k,v] of sortCounts(s.trooperConcurrencyCounts))console.log(`  ${k}: ${v}`);
  if(out.calibrationFocus){
    console.log('');console.log(`Calibration focus around ${clock(out.calibrationFocus.focusSeconds)} (±${out.calibrationFocus.windowSeconds.toFixed(1)} s):`);
    if(!out.calibrationFocus.nearest.length)console.log('  No nonisolated event within focus window.');
    for(const r of out.calibrationFocus.nearest){
      const c=r.collisionDimensions??{},x=r.exactTickCurrency??{},t=r.trooperConcurrency??{};
      console.log(`  ${clock(r.displayMatchTimeSeconds)} tick ${r.resolutionTick} entity ${r.assignedGoldEntityIndex} | ${r.collisionClass} | same-tick same-team=${c.sameTickSameTeamNeighbors??0} | exact-team-currency=${x.rawSameTeamPositiveTransitions??0} +${fmt(x.observedSameTeamPositiveTotal)} | troopers=${t.class} | ${r.counterfactualNarrowerIsolation?.result}`);
    }
  }
  console.log('');
  console.log('IMPORTANT: counterfactual-pass events remain B diagnostics and are NOT added to 77/77 A coverage.');
  console.log(`JSON: ${jsonPath}`);
  console.log(`Events: ${eventsPath}`);
}

function compactBatch(out){const s=out.summary;return {replayName:out.replay.replayName,status:out.status,nonisolatedEvents:s.nonisolatedEvents,collisionClusters:s.collisionClusters,collisionClassCounts:s.collisionClassCounts,counterfactualResultCounts:s.counterfactualResultCounts,counterfactualNarrowerIsolation:s.counterfactualNarrowerIsolation,trooperConcurrencyCounts:s.trooperConcurrencyCounts,validation:out.validation};}
async function readJsonl(path){const out=[];const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of rl){if(!line.trim())continue;try{out.push(JSON.parse(line));}catch{}}return out;}
function check(actual,expected,pass){return {actual,expected,pass:Boolean(pass)};}
function statSafeDir(path){try{return statSync(path).isDirectory();}catch{return false;}}
function sortCounts(obj){return Object.entries(obj??{}).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));}
function pct(v){return Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(2)}%`:'n/a';}
function fmt(v){return Number.isFinite(Number(v))?Number(v).toLocaleString():'n/a';}
function clock(seconds){const n=Math.max(0,Number(seconds)||0),m=Math.floor(n/60),s=n-m*60;return `${m}:${s.toFixed(3).padStart(6,'0')}`;}
