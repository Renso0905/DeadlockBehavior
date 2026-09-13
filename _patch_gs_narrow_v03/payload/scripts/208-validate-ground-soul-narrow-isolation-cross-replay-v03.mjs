import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { buildNarrowIsolationCrossReplayValidation, validateNarrowIsolationReplay } from '../inspector-v04/lib/research-ground-soul-narrow-isolation-validation.mjs';

const repoRoot=resolve(process.cwd());
const outputRoot=join(repoRoot,'output');
const cohort=['rep01','rep02','rep03','rep04','rep05'];
const perReplay=[];
const pooledRecovered=[];

for(const replayName of cohort){
  const dir=join(outputRoot,replayName);
  const coverageSummaryPath=join(dir,'ground_soul_economic_coverage_audit_v01.json');
  const coverageEventsPath=join(dir,'ground_soul_economic_coverage_audit_events_v01.jsonl');
  const collisionSummaryPath=join(dir,'ground_soul_collision_resolution_audit_v02.json');
  const collisionEventsPath=join(dir,'ground_soul_collision_resolution_audit_events_v02.jsonl');
  const missing=[coverageSummaryPath,coverageEventsPath,collisionSummaryPath,collisionEventsPath].filter(p=>!existsSync(p));
  if(missing.length){
    throw new Error(`Missing V01/V02 diagnostic prerequisites for ${replayName}:\n  ${missing.join('\n  ')}\nRun .\\inspector-v04\\run-ground-soul-narrow-isolation-validation.ps1 -Prepare`);
  }
  const coverage=JSON.parse(readFileSync(coverageSummaryPath,'utf8'));
  const collision=JSON.parse(readFileSync(collisionSummaryPath,'utf8'));
  if(coverage?.status!=='GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_V01_READY')throw new Error(`${replayName} coverage audit is not READY: ${coverage?.status??'missing status'}`);
  if(collision?.status!=='GROUND_SOUL_COLLISION_RESOLUTION_AUDIT_V02_READY')throw new Error(`${replayName} collision audit is not READY: ${collision?.status??'missing status'}`);
  const coverageRows=await readJsonl(coverageEventsPath);
  const collisionRows=await readJsonl(collisionEventsPath);
  const result=validateNarrowIsolationReplay({replayName,coverageRows,collisionRows,coverageSummary:coverage.summary,collisionSummary:collision.summary});
  if(!result.integrity.pass){throw new Error(`${replayName} V03 replay validation failed: ${result.integrity.failedChecks.join(', ')}`);}
  perReplay.push(result);
  for(const row of result.recoveredEvents)pooledRecovered.push({replayName,...row});
  writeFileSync(join(dir,'ground_soul_narrow_isolation_validation_v03.json'),JSON.stringify({
    version:'GROUND_SOUL_NARROW_ISOLATION_VALIDATION_V03',createdAt:new Date().toISOString(),status:'GROUND_SOUL_NARROW_ISOLATION_REPLAY_VALIDATION_V03_READY',authorityLayer:'research_validation_B',replayName,validation:{integrityValidation:'pass',semanticValidation:'strong_support',replicationStatus:'single_replay_component_of_cross_replay_validation'},result
  },null,2)+'\n','utf8');
}

const cross=buildNarrowIsolationCrossReplayValidation(perReplay,cohort);
const out={
  ...cross,
  createdAt:new Date().toISOString(),
  inputs:{
    requiredPerReplay:['ground_soul_economic_coverage_audit_v01.json','ground_soul_economic_coverage_audit_events_v01.jsonl','ground_soul_collision_resolution_audit_v02.json','ground_soul_collision_resolution_audit_events_v02.jsonl'],
    replicationCohort:cohort,
  },
  authorityBoundary:{
    currentALedger:'77/77 unchanged by this validation script',
    productionResolver:'unchanged; runtime-assigned-gold-economic-credit.mjs is not modified',
    nextDecision:'If V03 is READY, review the exact-tick same-team isolation rule for a separate production promotion patch rather than silently changing A attribution here.',
  },
};
mkdirSync(join(outputRoot,'cross_replay'),{recursive:true});
const jsonPath=join(outputRoot,'cross_replay','ground_soul_narrow_isolation_validation_v03.json');
const eventsPath=join(outputRoot,'cross_replay','ground_soul_narrow_isolation_recovered_candidates_v03.jsonl');
writeFileSync(jsonPath,JSON.stringify(out,null,2)+'\n','utf8');
writeFileSync(eventsPath,pooledRecovered.map(x=>JSON.stringify(x)).join('\n')+(pooledRecovered.length?'\n':''),'utf8');
printSummary(out,jsonPath,eventsPath);

async function readJsonl(path){const rows=[];const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of rl){if(!line.trim())continue;try{rows.push(JSON.parse(line));}catch{}}return rows;}
function printSummary(out,jsonPath,eventsPath){
  const a=out.aggregate;
  console.log('');
  console.log('=======================================================');
  console.log('GROUND SOUL NARROW-ISOLATION VALIDATION V03');
  console.log('=======================================================');
  console.log(`Status: ${out.status}`);
  console.log(`Authority: B validation; production/A ledger unchanged`);
  console.log(`Replication: ${out.validation.replicationStatus}`);
  console.log(`Semantic validation: ${out.validation.semanticValidation}`);
  console.log(`Cohort: ${out.cohort.presentExpectedReplayNames.join(', ')}${out.cohort.missingExpectedReplayNames.length?` | missing ${out.cohort.missingExpectedReplayNames.join(', ')}`:''}`);
  console.log('');
  console.log('Per replay:');
  for(const r of out.replayResults){
    console.log(`  ${r.replayName}: lifecycle=${fmt(r.sourceCounts.lifecycleActivations)} | current A=${fmt(r.sourceCounts.currentResolvedAEvents)} | nonisolated=${fmt(r.sourceCounts.currentNonisolatedEvents)} | exact-tick recovered=${fmt(r.exactTickSameTeamRule.recoveredEvents)} | hypothetical total=${fmt(r.exactTickSameTeamRule.hypotheticalResolvedTotal)} (${pct(r.exactTickSameTeamRule.hypotheticalResolvedShareOfLifecycle)})`);
  }
  console.log('');
  console.log('Pooled exact-tick same-team rule:');
  console.log(`  Lifecycle activations: ${fmt(a.lifecycleActivations)}`);
  console.log(`  Current resolved A events: ${fmt(a.currentResolvedAEvents)}`);
  console.log(`  Current nonisolated events: ${fmt(a.currentNonisolatedEvents)}`);
  console.log(`  Recovered candidate events: ${fmt(a.exactTickRecoveredEvents)} (${pct(a.exactTickRecoveryShareOfNonisolated)} of nonisolated)`);
  console.log(`  Hypothetical resolved total: ${fmt(a.exactTickHypotheticalResolvedTotal)} (${pct(a.exactTickHypotheticalResolvedShareOfLifecycle)} of lifecycle activations)`);
  console.log(`  Duplicate same-team resolution boundaries: ${fmt(a.duplicateSameTeamResolutionBoundaryKeys)}`);
  console.log(`  Duplicate recipient-transition keys: ${fmt(a.duplicateRecipientTransitionKeys)}`);
  console.log('');
  console.log('Same-team isolation radius sensitivity:');
  for(const r of out.aggregateSameTeamRadiusSweep)console.log(`  ±${r.sameTeamIsolationRadiusTicks} ticks: recover ${fmt(r.recoveredFromCurrentNonisolated)} | hypothetical total ${fmt(r.hypotheticalResolvedTotal)} (${pct(r.totalShareOfLifecycle)})`);
  console.log('');
  console.log('Nearest same-team termination distance among current collision rows:');
  for(const [k,v] of sortCounts(out.pooledNearestSameTeamTerminationDistanceBuckets))console.log(`  ${k}: ${fmt(v)}`);
  console.log('');
  console.log(`Interpretation: ${out.interpretation.result}`);
  console.log(`Production recommendation: ${out.interpretation.productionRecommendation}`);
  console.log('IMPORTANT: READY does not promote any recovered candidate into A. The 77/77 A ledger remains unchanged.');
  console.log(`JSON: ${jsonPath}`);
  console.log(`Recovered candidates: ${eventsPath}`);
}
function sortCounts(obj){return Object.entries(obj??{}).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));}
function pct(v){return Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(2)}%`:'n/a';}
function fmt(v){return Number.isFinite(Number(v))?Number(v).toLocaleString():'n/a';}
