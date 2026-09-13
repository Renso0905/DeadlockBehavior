import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { EntityOperation, InterceptorStage, Parser } from 'deadem';
import { requireClaim } from '../../src/contracts/claim-registry.mjs';
import { buildPlayerPrimaryFireSummary, deriveDischargeTransition, resolveEntityHandleIndex } from '../lib/runtime-primary-fire.mjs';

const VERSION='RUNTIME_PRIMARY_FIRE_PRODUCTION_V01';
const STATUS_READY='RUNTIME_PRIMARY_FIRE_PRODUCTION_V01_READY';
const TICKS_PER_SECOND=64;
const READY_AUTHORITY_STATUS='OBSERVED_PRIMARY_ATTACK_READY_SCHEDULE_AUTHORITY_V01_READY';

const replayArgument=process.argv[2];
if (!replayArgument) throw new Error('Usage: node inspector-v04/production/extract-runtime-primary-fire.mjs <replay.dem>');
const replayPath=resolve(replayArgument);
const replayName=basename(replayPath,extname(replayPath));
const playerStatePath=resolve('output',replayName,'player_state.jsonl');
const playerSummaryPath=resolve('output',replayName,'player_state_summary.json');
const readyAuthorityPath=resolve('output','cross_replay','observed_primary_attack_ready_schedule_authority_v01.json');
const outputPath=resolve('output',replayName,'runtime_primary_fire_production_v01.json');
const eventsPath=resolve('output',replayName,'runtime_primary_fire_events_v01.jsonl');
for (const path of [replayPath,playerStatePath,playerSummaryPath,readyAuthorityPath]) if (!existsSync(path)) throw new Error(`Required input missing: ${path}`);

const dischargeClaim=requireClaim('primary_weapon_discharge_telemetry',{requireSemantic:true});
const readyAuthority=JSON.parse(readFileSync(readyAuthorityPath,'utf8'));
const playerSummary=JSON.parse(readFileSync(playerSummaryPath,'utf8'));
const matchClockOffsetSeconds=finite(playerSummary?.matchClockOffsetSeconds)??0;
const sampled=await loadPlayerState(playerStatePath);
const playerByPawn=new Map();
for (const p of sampled.players) for (const pawn of p.pawnEntityIndexes) playerByPawn.set(pawn,p);

console.log('');
console.log('==========================================');
console.log('RUNTIME PRIMARY FIRE - PRODUCTION V01');
console.log('==========================================');
console.log(`Replay: ${replayName}`);
console.log(`Ready authority: ${readyAuthorityPath}`);

const parser=new Parser();
const weaponState=new Map();
const events=[];
const weaponEntities=new Set();
const linkedWeaponEntities=new Set();
const weaponClassCounts={};
let replayEndTick=0;
let candidateWeaponEvents=0;
let positiveShotTransitions=0;
let unlinkedDischargeUnits=0;
let nonCorroboratedDischargeUnits=0;
let invalidReadyDelayEvents=0;

parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET,(demoPacket)=>{
  if (Number.isFinite(demoPacket?.tick)) replayEndTick=Math.max(replayEndTick,demoPacket.tick);
});

parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET,(demoPacket,messagePacket,entityEvents)=>{
  const tick=Number.isFinite(demoPacket?.tick)?demoPacket.tick:null;
  if (Number.isFinite(tick)) replayEndTick=Math.max(replayEndTick,tick);
  for (const event of entityEvents) {
    const entity=event.entity;
    const className=String(entity?.class?.name??'');
    if (!entity || !className.includes('PrimaryWeapon')) continue;
    if (event.operation===EntityOperation.DELETE) { weaponState.delete(entity.index); continue; }
    if (event.operation!==EntityOperation.CREATE && event.operation!==EntityOperation.UPDATE) continue;

    const shotNumber=finite(entity.getField('m_nShotNumber'));
    const lastAttackTime=finite(entity.getField('m_flLastAttackTime'));
    const nextPrimaryAttack=finite(entity.getField('m_flNextPrimaryAttack'));
    if (shotNumber===null || lastAttackTime===null || nextPrimaryAttack===null) continue;
    candidateWeaponEvents++;
    weaponEntities.add(entity.index);
    weaponClassCounts[className]=(weaponClassCounts[className]??0)+1;

    const ownerHandle=entity.getField('m_hOwnerEntity');
    const ownerPawnEntityIndex=resolveEntityHandleIndex(ownerHandle);
    const player=ownerPawnEntityIndex===null?null:playerByPawn.get(ownerPawnEntityIndex)??null;
    if (player) linkedWeaponEntities.add(entity.index);
    const current={shotNumber,lastAttackTime,nextPrimaryAttack,activeFireMode:finite(entity.getField('m_eActiveFireMode')),ownerPawnEntityIndex};
    const previous=weaponState.get(entity.index)??null;
    weaponState.set(entity.index,current);
    if (event.operation===EntityOperation.CREATE || !previous) continue;

    const transition=deriveDischargeTransition(previous,current,{tick,demoSeconds:tick===null?null:tick/TICKS_PER_SECOND,matchClockOffsetSeconds});
    if (!transition) continue;
    positiveShotTransitions++;
    if (!player) { unlinkedDischargeUnits+=transition.dischargeUnits; continue; }
    if (!transition.lastAttackTimeAdvancedSameTick) nonCorroboratedDischargeUnits+=transition.dischargeUnits;
    if (transition.readyDelaySeconds===null) invalidReadyDelayEvents++;

    const prior=events.length?findPreviousPlayerWeaponEvent(events,player.controllerEntityIndex,entity.index):null;
    const demoSeconds=tick===null?null:tick/TICKS_PER_SECOND;
    const matchTimeSeconds=demoSeconds===null?null:demoSeconds-matchClockOffsetSeconds;
    const interAttackIntervalSeconds=prior&&prior.dischargeUnits===1&&transition.dischargeUnits===1&&demoSeconds!==null&&finite(prior.demoSeconds)!==null&&demoSeconds>=prior.demoSeconds?demoSeconds-prior.demoSeconds:null;
    events.push({
      schemaVersion:'runtime_primary_fire_event_v01',replay:replayName,tick,demoSeconds,matchTimeSeconds,
      controllerEntityIndex:player.controllerEntityIndex,playerName:player.playerName,steamId:player.steamId,heroId:player.heroId,team:player.team,
      pawnEntityIndex:ownerPawnEntityIndex,weaponEntityIndex:entity.index,weaponClass:className,activeFireMode:current.activeFireMode,
      ownerHandleRaw:serializable(ownerHandle),...transition,interAttackIntervalSeconds,
      semanticStatus:'OBSERVED_PRIMARY_WEAPON_DISCHARGE_AND_RUNTIME_READY_SCHEDULE'
    });
  }
});

try { await parser.parse(createReadStream(replayPath)); } finally { await parser.dispose(); }

const eventsByController=new Map();
for (const e of events) {
  if (!eventsByController.has(e.controllerEntityIndex)) eventsByController.set(e.controllerEntityIndex,[]);
  eventsByController.get(e.controllerEntityIndex).push(e);
}
const players=sampled.players.map(p=>buildPlayerPrimaryFireSummary(p,eventsByController.get(p.controllerEntityIndex)??[]));
const dischargeUnits=players.reduce((n,p)=>n+p.discharges,0);
const corroboratedUnits=players.reduce((n,p)=>n+p.corroboratedDischargeUnits,0);
const readyDelaySamples=players.reduce((n,p)=>n+(p.readyDelaySeconds?.count??0),0);
const sufficientlyLongReplay=(finite(playerSummary?.finalMatchTimeSeconds)??0)>=300;
const corroborationRate=dischargeUnits>0?corroboratedUnits/dischargeUnits:null;
const linkedRate=weaponEntities.size?linkedWeaponEntities.size/weaponEntities.size:null;
const checks={
  dischargeClaimCurrent:check(dischargeClaim.authorityStatus,'current',dischargeClaim.authorityStatus==='current'),
  dischargeSemanticPass:check(dischargeClaim.semanticValidation,'pass',dischargeClaim.semanticValidation==='pass'),
  readyAuthorityReady:check(readyAuthority?.status,READY_AUTHORITY_STATUS,readyAuthority?.status===READY_AUTHORITY_STATUS),
  readyAuthorityIntegrityPass:check(readyAuthority?.validation?.integrityValidation,'pass',readyAuthority?.validation?.integrityValidation==='pass'),
  readyAuthoritySemanticPass:check(readyAuthority?.validation?.semanticValidation,'pass',readyAuthority?.validation?.semanticValidation==='pass'),
  readyAuthorityCrossReplayReplicated:check(readyAuthority?.validation?.replicationStatus,'cross_replay_replicated',readyAuthority?.validation?.replicationStatus==='cross_replay_replicated'),
  playerRosterResolved:check(sampled.players.length,'>=10',sampled.players.length>=10 || !sufficientlyLongReplay),
  primaryWeaponTelemetryObservedWhenEligible:check(candidateWeaponEvents,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||candidateWeaponEvents>0),
  playerWeaponLinkageStrongWhenEligible:check(linkedRate,sufficientlyLongReplay?'>=0.95':'not required before 5:00',!sufficientlyLongReplay||(linkedRate!==null&&linkedRate>=.95)),
  dischargesObservedWhenEligible:check(dischargeUnits,sufficientlyLongReplay?'>=100':'not required before 5:00',!sufficientlyLongReplay||dischargeUnits>=100),
  allDischargeUnitsPlayerLinked:check(unlinkedDischargeUnits,0,unlinkedDischargeUnits===0),
  lastAttackCorroborationStrong:check(corroborationRate,dischargeUnits?'>=0.95':'no discharges',dischargeUnits===0||(corroborationRate!==null&&corroborationRate>=.95)),
  readyDelayAvailableForDischarges:check(readyDelaySamples,dischargeUnits?'>=95% discharge events':'no discharges',events.length===0||readyDelaySamples/events.length>=.95),
  emittedReadyDelaysNonnegative:check(invalidReadyDelayEvents,dischargeUnits?'<=5% discharge events':'no discharges',events.length===0||invalidReadyDelayEvents/events.length<=.05),
};
const failed=Object.entries(checks).filter(([,v])=>!v.pass).map(([k])=>k);
if (failed.length) throw new Error(`Primary-fire production integrity failed: ${failed.join(', ')}`);

const output={
  version:VERSION,canonical:false,createdAt:new Date().toISOString(),status:STATUS_READY,
  replay:{replayName,replayPath,ticksPerSecond:TICKS_PER_SECOND,matchClockOffsetSeconds,replayEndTick,finalMatchTimeSeconds:finite(playerSummary?.finalMatchTimeSeconds)},
  foundations:{dischargeClaim:dischargeClaim.claimId,readyScheduleAuthorityArtifact:readyAuthorityPath},
  semanticScope:{
    supported:'Observed primary-weapon discharge units, per-player discharge cadence, observed inter-discharge spacing, and the cross-replay replicated runtime readiness carrier m_flNextPrimaryAttack - m_flLastAttackTime at discharge boundaries.',
    notClaimed:['Trigger/click attempts that do not discharge','Generic weapon accuracy','Current ammo','Effective magazine size','Effective DPS or damage composition','Static fire-rate formulas as runtime authority','Spin-up cadence outside the frozen fixed-regime readiness authority','Projectile travel or impact identity']
  },
  counts:{players:players.length,candidateWeaponEvents,weaponEntities:weaponEntities.size,playerLinkedWeaponEntities:linkedWeaponEntities.size,positiveShotTransitions,dischargeEvents:events.length,dischargeUnits,corroboratedDischargeUnits:corroboratedUnits,nonCorroboratedDischargeUnits,readyDelaySamples,invalidReadyDelayEvents},
  weaponClassCounts,
  players,
  validation:{pass:true,checks}
};
mkdirSync(dirname(outputPath),{recursive:true});
writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n','utf8');
writeFileSync(eventsPath,events.map(x=>JSON.stringify(x)).join('\n')+(events.length?'\n':''),'utf8');
console.log(`Status: ${STATUS_READY}`);
console.log(`Players: ${players.length}`);
console.log(`Weapon entities: ${weaponEntities.size} (${linkedWeaponEntities.size} player-linked)`);
console.log(`Primary discharges: ${dischargeUnits} units across ${events.length} observed transitions`);
console.log(`Ready-delay samples: ${readyDelaySamples}`);
console.log(`Last-attack corroboration: ${corroborationRate===null?'n/a':(corroborationRate*100).toFixed(2)+'%'}`);
console.log(`JSON: ${outputPath}`);
console.log(`Events: ${eventsPath}`);

async function loadPlayerState(path){
  const map=new Map();
  const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});
  for await(const line of rl){
    if(!line.trim())continue;let r;try{r=JSON.parse(line);}catch{continue;}
    const c=r.controller??{},pawn=r.pawn??{};const name=c.playerName;
    if(!name||name==='SourceTV')continue;
    const controller=finite(c.entityIndex); if(controller===null)continue;
    let p=map.get(controller);
    if(!p){p={controllerEntityIndex:controller,playerName:name,steamId:c.steamId??null,heroId:c.heroId??null,team:c.team??null,pawnEntityIndexes:new Set(),aliveSeconds:0,lastDemoSeconds:null,lastAlive:null};map.set(controller,p);}
    p.playerName=name??p.playerName;p.steamId=c.steamId??p.steamId;p.heroId=c.heroId??p.heroId;p.team=c.team??p.team;
    const pawnIndex=finite(pawn.entityIndex);if(pawnIndex!==null)p.pawnEntityIndexes.add(pawnIndex);
    const ds=finite(r.demoSeconds)??(finite(r.demoTick)!==null?Number(r.demoTick)/TICKS_PER_SECOND:null);
    if(ds!==null&&p.lastDemoSeconds!==null&&ds>=p.lastDemoSeconds&&p.lastAlive===true)p.aliveSeconds+=ds-p.lastDemoSeconds;
    if(ds!==null)p.lastDemoSeconds=ds;p.lastAlive=c.alive===true;
  }
  return{players:[...map.values()]};
}
function findPreviousPlayerWeaponEvent(all,controllerEntityIndex,weaponEntityIndex){for(let i=all.length-1;i>=0;i--){const e=all[i];if(e.controllerEntityIndex===controllerEntityIndex&&e.weaponEntityIndex===weaponEntityIndex)return e;}return null;}
function check(actual,expected,pass){return{actual,expected,pass:Boolean(pass)};}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function serializable(v){if(v===undefined)return null;if(v===null||typeof v==='string'||typeof v==='number'||typeof v==='boolean')return v;if(typeof v==='object'){try{return JSON.parse(JSON.stringify(v));}catch{return String(v);}}return String(v);}
