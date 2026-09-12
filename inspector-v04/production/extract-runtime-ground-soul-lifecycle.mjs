import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { EntityOperation, InterceptorStage, Logger, Parser, ParserConfiguration } from 'deadem';
import { requireClaim } from '../../src/contracts/claim-registry.mjs';
import { beginGroundSoulEpisode, buildGroundSoulLifecycleSummary, compareActivationKeys, decodeSource2EntityHandle, finishGroundSoulEpisode, observeGroundSoulEpisode, collapseBenignSameTickReactivationFragments } from '../lib/runtime-ground-soul-lifecycle.mjs';
import { buildDuplicateActivationDiagnostic, duplicateDiagnosticConsoleLines } from '../lib/runtime-ground-soul-lifecycle-duplicate-diagnostic.mjs';

const VERSION='RUNTIME_GROUND_SOUL_LIFECYCLE_PRODUCTION_V01';
const STATUS_READY='RUNTIME_GROUND_SOUL_LIFECYCLE_PRODUCTION_V01_READY';
const ASSIGNED_GOLD_CLASS='CCitadel_Pickup_AssignedGold';
const TICKS_PER_SECOND=64;

const replayArgument=process.argv[2];
if(!replayArgument)throw new Error('Usage: node inspector-v04/production/extract-runtime-ground-soul-lifecycle.mjs <replay.dem>');
const replayPath=resolve(replayArgument);
const replayName=basename(replayPath,extname(replayPath));
const playerSummaryPath=resolve('output',replayName,'player_state_summary.json');
const researchPath=resolve('output',replayName,'replication_assigned_gold_activations_v01.jsonl');
const outputPath=resolve('output',replayName,'runtime_ground_soul_lifecycle_production_v01.json');
const eventsPath=resolve('output',replayName,'runtime_ground_soul_lifecycle_events_v01.jsonl');
const duplicateDiagnosticPath=resolve('output',replayName,'runtime_ground_soul_lifecycle_duplicate_activation_diagnostic_v01.json');
for(const path of [replayPath,playerSummaryPath])if(!existsSync(path))throw new Error(`Required input missing: ${path}`);

const claim=requireClaim('ground_soul_lifecycle',{requireSemantic:true,requireReplication:true});
const playerSummary=JSON.parse(readFileSync(playerSummaryPath,'utf8'));
const matchClockOffsetSeconds=finite(playerSummary?.matchClockOffsetSeconds)??0;
const finalMatchTimeSeconds=finite(playerSummary?.finalMatchTimeSeconds);
const sufficientlyLongReplay=(finalMatchTimeSeconds??0)>=300;

console.log('');
console.log('===============================================');
console.log('RUNTIME GROUND SOUL LIFECYCLE - PRODUCTION V01');
console.log('===============================================');
console.log(`Replay: ${replayName}`);
console.log(`Authority claim: ${claim.claimId}`);

const parser=new Parser(new ParserConfiguration({entityClasses:[ASSIGNED_GOLD_CLASS]}),Logger.CONSOLE_INFO);
const stateByEntity=new Map();
const openByEntity=new Map();
const sequenceByEntity=new Map();
const assignedGoldEntities=new Set();
const activeFieldEntities=new Set();
const episodes=[];
let replayEndTick=0;
let candidateEntityEvents=0;
let validVacuumTargetObservations=0;

function timing(tick){const demoSeconds=finite(tick)===null?null:tick/TICKS_PER_SECOND;return{tick:finite(tick),demoSeconds,matchTimeSeconds:demoSeconds===null?null:demoSeconds-matchClockOffsetSeconds};}
function snapshot(entity){return{active:boolish(entity.getField('m_bActive')),interactive:boolish(entity.getField('m_bInteractive')),vacuumTarget:entity.getField('m_hVacuumTarget'),team:finite(entity.getField('m_iTeamNum')),subclassId:entity.getField('m_nSubclassID')??null};}
function start(entity,current,t){
  const sequence=(sequenceByEntity.get(entity.index)??0)+1;sequenceByEntity.set(entity.index,sequence);
  const ep=beginGroundSoulEpisode({entityIndex:entity.index,sequence,...t,team:current.team,subclassId:current.subclassId,active:current.active,interactive:current.interactive,vacuumTarget:current.vacuumTarget});
  openByEntity.set(entity.index,ep);episodes.push(ep);return ep;
}
function end(entityIndex,t,reason,censored){const ep=openByEntity.get(entityIndex);if(!ep)return;finishGroundSoulEpisode(ep,{...t,endReason:reason,censored});openByEntity.delete(entityIndex);}

parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET,(demoPacket)=>{if(Number.isFinite(demoPacket?.tick))replayEndTick=Math.max(replayEndTick,demoPacket.tick);});
parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET,(demoPacket,messagePacket,entityEvents)=>{
  const tick=Number.isFinite(demoPacket?.tick)?demoPacket.tick:null;if(Number.isFinite(tick))replayEndTick=Math.max(replayEndTick,tick);const t=timing(tick);
  for(const event of entityEvents){
    const entity=event.entity;if(!entity||String(entity?.class?.name??'')!==ASSIGNED_GOLD_CLASS)continue;
    assignedGoldEntities.add(entity.index);
    if(event.operation===EntityOperation.DELETE){end(entity.index,t,'ENTITY_DELETE_CENSORED',true);stateByEntity.delete(entity.index);continue;}
    if(event.operation!==EntityOperation.CREATE&&event.operation!==EntityOperation.UPDATE)continue;
    candidateEntityEvents++;
    const current=snapshot(entity);if(current.active!==null)activeFieldEntities.add(entity.index);
    if(decodeSource2EntityHandle(current.vacuumTarget))validVacuumTargetObservations++;
    const previous=stateByEntity.get(entity.index)??null;stateByEntity.set(entity.index,current);
    let ep=openByEntity.get(entity.index)??null;
    const startsActive=current.active===true&&(event.operation===EntityOperation.CREATE||!previous||previous.active!==true);
    if(startsActive){if(ep)end(entity.index,t,'REACTIVATED_WITHOUT_INACTIVE_CENSORED',true);ep=start(entity,current,t);}
    if(ep&&current.active===true)observeGroundSoulEpisode(ep,{tick:t.tick,matchTimeSeconds:t.matchTimeSeconds,vacuumTarget:current.vacuumTarget});
    if(ep&&previous?.active===true&&current.active===false)end(entity.index,t,'BECAME_INACTIVE',false);
  }
});

try{await parser.parse(createReadStream(replayPath));}finally{await parser.dispose();}
const endTime=timing(replayEndTick);for(const entityIndex of [...openByEntity.keys()])end(entityIndex,endTime,'REPLAY_END_CENSORED',true);

const sameTickFragmentRepair=collapseBenignSameTickReactivationFragments(episodes);
if(sameTickFragmentRepair.removedCount){
  console.log(`Same-tick reactivation fragments canonicalized: ${sameTickFragmentRepair.removedCount} across ${sameTickFragmentRepair.resolvedGroups.length} duplicate groups`);
}
const summary=buildGroundSoulLifecycleSummary(episodes);
const duplicateKeys=findDuplicateKeys(episodes);
// GROUND_SOUL_LIFECYCLE_DUPLICATE_DIAGNOSTIC_V01_INSTRUMENTATION
const duplicateDiagnostic=buildDuplicateActivationDiagnostic(episodes,{replayName,replayPath,replayEndTick});
if(duplicateDiagnostic.duplicateKeyCount>0){
  mkdirSync(dirname(duplicateDiagnosticPath),{recursive:true});
  writeFileSync(duplicateDiagnosticPath,JSON.stringify(duplicateDiagnostic,null,2)+'\n','utf8');
  console.log('');
  console.log('DUPLICATE ACTIVATION-KEY DIAGNOSTIC V01');
  console.log('---------------------------------------');
  for(const line of duplicateDiagnosticConsoleLines(duplicateDiagnostic,{limit:20}))console.log(line);
  console.log(`Diagnostic JSON: ${duplicateDiagnosticPath}`);
  console.log('Integrity failure is intentionally preserved; no duplicate episodes were merged or discarded.');
}

let researchComparison=null;if(existsSync(researchPath)){researchComparison=compareActivationKeys(episodes,await readJsonl(researchPath));}
const checks={
  authorityCurrent:check(claim.authorityStatus,'current',claim.authorityStatus==='current'),
  integrityPass:check(claim.integrityValidation,'pass',claim.integrityValidation==='pass'),
  semanticPass:check(claim.semanticValidation,'pass or strong_support',['pass','strong_support'].includes(claim.semanticValidation)),
  independentlyReplicated:check(claim.replicationStatus,'multi/cross-replay replication',['multi_replay_supported','cross_replay_replicated'].includes(String(claim.replicationStatus))),
  assignedGoldClassObservedWhenEligible:check(assignedGoldEntities.size,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||assignedGoldEntities.size>0),
  activeCarrierObservedWhenEligible:check(activeFieldEntities.size,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||activeFieldEntities.size>0),
  activationsObservedWhenEligible:check(episodes.length,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||episodes.length>0),
  duplicateActivationKeys:check(duplicateKeys.length,0,duplicateKeys.length===0),
  allEpisodesFinalized:check(episodes.filter(e=>!e.finalized).length,0,episodes.every(e=>e.finalized)),
  completedDurationsNonnegative:check(episodes.filter(e=>e.endReason==='BECAME_INACTIVE'&&!(finite(e.durationSeconds)>=0)).length,0,episodes.filter(e=>e.endReason==='BECAME_INACTIVE').every(e=>finite(e.durationSeconds)>=0)),
  targetIdentityOnlyPhysicalHandle:check(episodes.filter(e=>e.targeted&&!Number.isInteger(e.targetEntityIndex)).length,0,episodes.filter(e=>e.targeted).every(e=>Number.isInteger(e.targetEntityIndex))),
};
const failed=Object.entries(checks).filter(([,v])=>!v.pass).map(([k])=>k);if(failed.length)throw new Error(`Ground-Soul lifecycle production integrity failed: ${failed.join(', ')}`);

const output={
  version:VERSION,canonical:false,createdAt:new Date().toISOString(),status:STATUS_READY,authorityLayer:'extended',
  replay:{replayName,replayPath,ticksPerSecond:TICKS_PER_SECOND,matchClockOffsetSeconds,replayEndTick,finalMatchTimeSeconds},
  foundation:{claimId:claim.claimId,sourceScripts:claim.sourceScripts??[],currentArtifacts:claim.currentArtifacts??[],replicationStatus:claim.replicationStatus},
  semanticScope:{
    supported:'Observed CCitadel_Pickup_AssignedGold active lifecycle: activation, physical vacuum-target handle acquisition, active-to-inactive termination, duration, and censoring.',
    notClaimed:['Every Trooper death creates an AssignedGold episode','Unmatched Trooper death means missed Soul','m_hVacuumTarget is the economic recipient or last hitter','m_bActive=false proves collection or payout','Targetless termination is expiration','Exact vacuum radius','Reward amount or reward formula','Ground-Soul economic recipient set']
  },
  counts:{candidateEntityEvents,assignedGoldEntities:assignedGoldEntities.size,activeFieldEntities:activeFieldEntities.size,validVacuumTargetObservations},
  summary,
  diagnostics:{sameTickReactivationFragmentRepair:sameTickFragmentRepair,researchArtifact:existsSync(researchPath)?researchPath:null,researchComparison},
  validation:{pass:true,checks}
};
mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n','utf8');writeFileSync(eventsPath,episodes.map(x=>JSON.stringify(x)).join('\n')+(episodes.length?'\n':''),'utf8');
console.log(`Status: ${STATUS_READY}`);
console.log(`AssignedGold entities: ${assignedGoldEntities.size}`);
console.log(`Activations: ${summary.activations} (${summary.targetedActivations} vacuum-targeted / ${summary.targetlessActivations} targetless)`);
console.log(`Completed / censored: ${summary.completedActiveToInactive} / ${summary.censoredActivations}`);
console.log(`Median completed duration: ${summary.medianCompletedDurationSeconds===null?'n/a':summary.medianCompletedDurationSeconds.toFixed(3)+' s'}`);
if(researchComparison)console.log(`Research activation-key agreement: ${(100*(researchComparison.recall??0)).toFixed(2)}% recall / ${(100*(researchComparison.precision??0)).toFixed(2)}% precision`);
console.log(`JSON: ${outputPath}`);console.log(`Events: ${eventsPath}`);

function check(actual,expected,pass){return{actual,expected,pass:Boolean(pass)};}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function boolish(v){if(v===true||v===false)return v;const n=Number(v);if(n===0)return false;if(n===1)return true;return null;}
function findDuplicateKeys(rows){const seen=new Set(),dupes=[];for(const e of rows){const k=`${e.activationTick}:${e.entityIndex}`;if(seen.has(k))dupes.push(k);else seen.add(k);}return dupes;}
async function readJsonl(path){const rows=[];const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of rl){if(!line.trim())continue;try{rows.push(JSON.parse(line));}catch{}}return rows;}
