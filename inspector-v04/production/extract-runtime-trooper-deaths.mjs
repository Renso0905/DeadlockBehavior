import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { EntityOperation, InterceptorStage, Logger, Parser, ParserConfiguration } from 'deadem';
import { requireClaim } from '../../src/contracts/claim-registry.mjs';
import { buildTrooperDeathSummary, compareEventKeys, deriveTrooperDeathTransition } from '../lib/runtime-trooper-deaths.mjs';

const VERSION='RUNTIME_TROOPER_DEATH_PRODUCTION_V01';
const STATUS_READY='RUNTIME_TROOPER_DEATH_PRODUCTION_V01_READY';
const TROOPER_CLASS='CNPC_Trooper';
const TICKS_PER_SECOND=64;

const replayArgument=process.argv[2];
if(!replayArgument) throw new Error('Usage: node inspector-v04/production/extract-runtime-trooper-deaths.mjs <replay.dem>');
const replayPath=resolve(replayArgument);
const replayName=basename(replayPath,extname(replayPath));
const playerSummaryPath=resolve('output',replayName,'player_state_summary.json');
const researchPath=resolve('output',replayName,'replication_trooper_deaths_v01.jsonl');
const outputPath=resolve('output',replayName,'runtime_trooper_deaths_production_v01.json');
const eventsPath=resolve('output',replayName,'runtime_trooper_death_events_v01.jsonl');
for(const path of [replayPath,playerSummaryPath]) if(!existsSync(path)) throw new Error(`Required input missing: ${path}`);

const claim=requireClaim('trooper_death_transition',{requireSemantic:true});
const replicationOk=['multi_replay_replication','multi_replay_supported','cross_replay_replicated'].includes(String(claim.replicationStatus));
const playerSummary=JSON.parse(readFileSync(playerSummaryPath,'utf8'));
const matchClockOffsetSeconds=finite(playerSummary?.matchClockOffsetSeconds)??0;
const finalMatchTimeSeconds=finite(playerSummary?.finalMatchTimeSeconds);
const sufficientlyLongReplay=(finalMatchTimeSeconds??0)>=300;

console.log('');
console.log('==========================================');
console.log('RUNTIME TROOPER DEATHS - PRODUCTION V01');
console.log('==========================================');
console.log(`Replay: ${replayName}`);
console.log(`Authority claim: ${claim.claimId}`);

const config=new ParserConfiguration({entityClasses:[TROOPER_CLASS]});
const parser=new Parser(config,Logger.CONSOLE_INFO);
const stateByEntity=new Map();
const trooperEntities=new Set();
const healthObservedEntities=new Set();
const events=[];
let replayEndTick=0;
let candidateEntityEvents=0;
let finiteHealthObservations=0;
let lifeStateAvailableDeaths=0;
let lifeStateCorroboratedDeaths=0;

parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET,(demoPacket)=>{
  if(Number.isFinite(demoPacket?.tick))replayEndTick=Math.max(replayEndTick,demoPacket.tick);
});

parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET,(demoPacket,messagePacket,entityEvents)=>{
  const tick=Number.isFinite(demoPacket?.tick)?demoPacket.tick:null;
  if(Number.isFinite(tick))replayEndTick=Math.max(replayEndTick,tick);
  for(const event of entityEvents){
    const entity=event.entity;
    if(!entity||String(entity?.class?.name??'')!==TROOPER_CLASS)continue;
    if(event.operation===EntityOperation.DELETE){stateByEntity.delete(entity.index);continue;}
    if(event.operation!==EntityOperation.CREATE&&event.operation!==EntityOperation.UPDATE)continue;
    candidateEntityEvents++;
    trooperEntities.add(entity.index);
    const current={
      health:finite(entity.getField('m_iHealth')),
      lifeState:finite(entity.getField('m_lifeState')),
      maxHealth:finite(entity.getField('m_iMaxHealth'))??finite(entity.getField('m_iHealthMax')),
    };
    if(current.health!==null){finiteHealthObservations++;healthObservedEntities.add(entity.index);}
    const previous=stateByEntity.get(entity.index)??null;
    stateByEntity.set(entity.index,current);
    if(event.operation===EntityOperation.CREATE||!previous)continue;
    const transition=deriveTrooperDeathTransition(previous,current);
    if(!transition)continue;
    if(transition.lifeStateSignal!==null){lifeStateAvailableDeaths++;if(transition.lifeStateSignal)lifeStateCorroboratedDeaths++;}
    const demoSeconds=tick===null?null:tick/TICKS_PER_SECOND;
    const matchTimeSeconds=demoSeconds===null?null:demoSeconds-matchClockOffsetSeconds;
    events.push({
      schemaVersion:'runtime_trooper_death_event_v01',replay:replayName,tick,demoSeconds,matchTimeSeconds,
      entityIndex:entity.index,...transition,
      semanticStatus:'OBSERVED_CNPC_TROOPER_POSITIVE_HEALTH_TO_ZERO_TRANSITION'
    });
  }
});

try{await parser.parse(createReadStream(replayPath));}finally{await parser.dispose();}

const summary=buildTrooperDeathSummary(events);
const duplicateKeys=findDuplicateKeys(events);
let researchComparison=null;
if(existsSync(researchPath)){
  const researchEvents=await readJsonl(researchPath);
  researchComparison=compareEventKeys(events,researchEvents);
}
const lifeStateCorroborationRate=lifeStateAvailableDeaths?lifeStateCorroboratedDeaths/lifeStateAvailableDeaths:null;
const checks={
  authorityCurrent:check(claim.authorityStatus,'current',claim.authorityStatus==='current'),
  integrityPass:check(claim.integrityValidation,'pass',claim.integrityValidation==='pass'),
  semanticPass:check(claim.semanticValidation,'pass or strong_support',['pass','strong_support'].includes(claim.semanticValidation)),
  independentlyReplicated:check(claim.replicationStatus,'multi/cross-replay replication',replicationOk),
  trooperClassObservedWhenEligible:check(trooperEntities.size,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||trooperEntities.size>0),
  healthCarrierObservedWhenEligible:check(healthObservedEntities.size,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||healthObservedEntities.size>0),
  deathsObservedWhenEligible:check(events.length,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||events.length>0),
  allEventsPositiveHealthToZero:check(events.filter(e=>!(e.previousHealth>0&&e.currentHealth===0)).length,0,events.every(e=>e.previousHealth>0&&e.currentHealth===0)),
  duplicateDeathKeys:check(duplicateKeys.length,0,duplicateKeys.length===0),
  researchArtifactExactWhenPresent:check(researchComparison?.exact??null,researchComparison?'exact tick/entity agreement':'no local research artifact',!researchComparison||researchComparison.exact),
};
const failed=Object.entries(checks).filter(([,v])=>!v.pass).map(([k])=>k);
if(failed.length)throw new Error(`Trooper-death production integrity failed: ${failed.join(', ')}`);

const output={
  version:VERSION,canonical:false,createdAt:new Date().toISOString(),status:STATUS_READY,authorityLayer:'extended',
  replay:{replayName,replayPath,ticksPerSecond:TICKS_PER_SECOND,matchClockOffsetSeconds,replayEndTick,finalMatchTimeSeconds},
  foundation:{claimId:claim.claimId,authorityScript:claim.authorityScript??null,authorityOutput:claim.authorityOutput??null,replicationStatus:claim.replicationStatus},
  semanticScope:{
    supported:'Observed CNPC_Trooper death transitions defined by replicated positive m_iHealth -> 0 transitions, including their replay/match timing.',
    notClaimed:['Killer identity','Last-hit identity','Attack method','Melee attribution','Trooper base type or variant','Lane/jungle classification','Ground-soul eligibility or reward outcome']
  },
  counts:{candidateEntityEvents,trooperEntities:trooperEntities.size,healthObservedEntities:healthObservedEntities.size,finiteHealthObservations,deaths:events.length,gameplayDeaths:summary.gameplayDeaths,pregameDeaths:summary.pregameDeaths,lifeStateAvailableDeaths,lifeStateCorroboratedDeaths},
  summary,
  diagnostics:{lifeStateCorroborationRate,researchArtifact:existsSync(researchPath)?researchPath:null,researchComparison},
  validation:{pass:true,checks}
};
mkdirSync(dirname(outputPath),{recursive:true});
writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n','utf8');
writeFileSync(eventsPath,events.map(x=>JSON.stringify(x)).join('\n')+(events.length?'\n':''),'utf8');
console.log(`Status: ${STATUS_READY}`);
console.log(`Trooper entities: ${trooperEntities.size}`);
console.log(`Deaths: ${events.length} (${summary.gameplayDeaths} gameplay, ${summary.pregameDeaths} pregame)`);
console.log(`Life-state corroboration: ${lifeStateCorroborationRate===null?'n/a':(lifeStateCorroborationRate*100).toFixed(2)+'%'}`);
if(researchComparison)console.log(`Research tick/entity agreement: ${researchComparison.exact?'EXACT':'MISMATCH'} (${researchComparison.matched}/${researchComparison.research})`);
console.log(`JSON: ${outputPath}`);
console.log(`Events: ${eventsPath}`);

function check(actual,expected,pass){return{actual,expected,pass:Boolean(pass)};}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function findDuplicateKeys(rows){const seen=new Set(),dupes=[];for(const e of rows){const k=`${e.tick}:${e.entityIndex}`;if(seen.has(k))dupes.push(k);else seen.add(k);}return dupes;}
async function readJsonl(path){const rows=[];const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of rl){if(!line.trim())continue;try{rows.push(JSON.parse(line));}catch{}}return rows;}
