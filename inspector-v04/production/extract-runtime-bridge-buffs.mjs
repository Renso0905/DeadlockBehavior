import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { EntityOperation, InterceptorStage, Logger, Parser, ParserConfiguration } from 'deadem';
import { requireClaim } from '../../src/contracts/claim-registry.mjs';
import { murmurHash2 } from '../../src/source2/murmurhash2.mjs';
import { BRIDGE_RECORD_KEYS, COLLECTOR_DISTANCE_GATE_HU, MAX_SNAPSHOT_GAP_TICKS, deriveBridgeIntervals } from '../lib/runtime-bridge-buffs.mjs';

const VERSION='RUNTIME_BRIDGE_BUFF_OWNERSHIP_PRODUCTION_V01';
const STATUS_READY='RUNTIME_BRIDGE_BUFF_OWNERSHIP_PRODUCTION_V01_READY';
const TICKS_PER_SECOND=64;
const RESOURCE_STATUS='WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY';
const COLLECTION_REPLICATION_STATUS='BRIDGE_WORLD_COLLECTION_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS';
const AUTHORITY_STATUS='BRIDGE_RUNTIME_INTERVAL_AUTHORITY_V01_READY';

const replayArgument=process.argv[2];
if (!replayArgument) throw new Error('Usage: node inspector-v04/production/extract-runtime-bridge-buffs.mjs <replay.dem>');
const replayPath=resolve(replayArgument);
const replayName=basename(replayPath,extname(replayPath));
const resourcePath=resolve('output','cross_replay','world_stat_buff_resource_contract_v02.json');
const replicationPath=resolve('output','cross_replay','bridge_world_collection_cross_replay_replication_v01.json');
const authorityPath=resolve('output','cross_replay','bridge_runtime_interval_authority_v01.json');
const playerStatePath=resolve('output',replayName,'player_state.jsonl');
const playerSummaryPath=resolve('output',replayName,'player_state_summary.json');
const outputPath=resolve('output',replayName,'runtime_bridge_buff_ownership_production_v01.json');
const eventsPath=resolve('output',replayName,'runtime_bridge_buff_events_v01.jsonl');
for (const path of [replayPath,resourcePath,replicationPath,authorityPath,playerStatePath,playerSummaryPath]) if (!existsSync(path)) throw new Error(`Required input missing: ${path}`);

const resourceClaim=requireClaim('bridge_powerup_resource_contract',{requireSemantic:true});
const ownershipClaim=requireClaim('runtime_bridge_buff_ownership',{requireSemantic:true,requireReplication:true});
const resourceContract=JSON.parse(readFileSync(resourcePath,'utf8'));
const replication=JSON.parse(readFileSync(replicationPath,'utf8'));
const authority=JSON.parse(readFileSync(authorityPath,'utf8'));
const playerSummary=JSON.parse(readFileSync(playerSummaryPath,'utf8'));
const powerups=(resourceContract?.bridgePowerups?.powerups??[]).filter(x=>BRIDGE_RECORD_KEYS.includes(x.recordKey));
const tokenRows=powerups.map(x=>({...x,recordId:murmurHash2(x.recordKey)}));
const tokenById=new Map(tokenRows.map(x=>[x.recordId,x]));
const collisions=[]; for (const x of tokenRows) for (const y of tokenRows) if(x!==y&&x.recordId===y.recordId) collisions.push([x.recordKey,y.recordKey,x.recordId]);
const matchClockOffsetSeconds=finite(playerSummary?.matchClockOffsetSeconds)??0;
const replaySamples=await loadPlayerState(playerStatePath);
const gameplayState=deriveGameplayState(replaySamples.gameStateRows);

console.log('');
console.log('============================================');
console.log('RUNTIME BRIDGE BUFF OWNERSHIP - PRODUCTION V01');
console.log('============================================');
console.log(`Replay: ${replayName}`);
console.log(`Resource contract: ${resourcePath}`);
console.log(`Interval authority: ${authorityPath}`);

const parser=new Parser(new ParserConfiguration({entityClasses:['CCitadel_Pickup_Modifier','CCitadelPlayerController','CCitadelGameRulesProxy']}),Logger.CONSOLE_INFO);
const pickupState=new Map(); const controllerState=new Map();
const collectionCandidates=[]; const deathEvents=[]; const gameStateEvents=[];
let currentGameState=null,replayEndTick=0,pickupMutationEvents=0,pickupEntitiesObserved=0,mappedIdentityObservations=0,activeTrueToFalseUpdates=0,controllerMutationEvents=0;
const pickupEntityIndexes=new Set();

parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET,(demoPacket)=>{
  if (Number.isFinite(demoPacket?.tick)) replayEndTick=Math.max(replayEndTick,demoPacket.tick);
});

parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET,(demoPacket,messagePacket,events)=>{
  const tick=Number.isFinite(demoPacket?.tick)?demoPacket.tick:null;
  if (Number.isFinite(tick)) replayEndTick=Math.max(replayEndTick,tick);
  for (const event of events) {
    const entity=event.entity,className=entity?.class?.name;
    if (!entity||!className) continue;
    if (className==='CCitadelGameRulesProxy'&&(event.operation===EntityOperation.CREATE||event.operation===EntityOperation.UPDATE)) {
      const next=normalizeInteger(entity.getField('m_pGameRules.m_eGameState'));
      if (next!==null&&next!==currentGameState) { gameStateEvents.push({tick,before:currentGameState,after:next}); currentGameState=next; }
      continue;
    }
    if (className==='CCitadelPlayerController'&&(event.operation===EntityOperation.CREATE||event.operation===EntityOperation.UPDATE)) {
      controllerMutationEvents++;
      const s=getControllerState(controllerState,entity.index),beforeAlive=s.alive;
      refreshController(s,entity);
      if (beforeAlive===true&&s.alive===false) deathEvents.push({tick,controllerEntityIndex:entity.index,playerName:s.playerName,steamId:s.steamId,heroId:s.heroId,team:s.team});
      continue;
    }
    if (className!=='CCitadel_Pickup_Modifier') continue;
    if (event.operation===EntityOperation.DELETE) { pickupState.delete(entity.index); continue; }
    if (event.operation!==EntityOperation.CREATE&&event.operation!==EntityOperation.UPDATE) continue;
    pickupMutationEvents++;pickupEntityIndexes.add(entity.index);pickupEntitiesObserved=pickupEntityIndexes.size;
    if (event.operation===EntityOperation.CREATE) pickupState.delete(entity.index);
    const previous=pickupState.get(entity.index)??{active:null,recordId:null,recordKey:null,position:null};
    const recordId=normalizeUnsignedId(entity.getField('m_nSubclassID'))??previous.recordId;
    const token=recordId!==null?tokenById.get(recordId):null;
    if (token) mappedIdentityObservations++;
    const active=normalizeBoolean(entity.getField('m_bActive'));
    const position=readWorldPosition(entity)??previous.position;
    const next={active:active??previous.active,recordId,recordKey:token?.recordKey??previous.recordKey,position};
    if (event.operation===EntityOperation.UPDATE&&previous.active===true&&next.active===false&&next.recordKey) {
      activeTrueToFalseUpdates++;
      collectionCandidates.push({tick,entityIndex:entity.index,recordId:next.recordId,recordKey:next.recordKey,position:next.position,gameState:currentGameState});
    }
    pickupState.set(entity.index,next);
  }
});
try { await parser.parse(createReadStream(replayPath)); } finally { await parser.dispose(); }

const matchEndTick=findMatchEndTick(gameStateEvents,gameplayState,matchClockOffsetSeconds);
const players=mergePlayerIdentities(replaySamples.players,[...controllerState.values()]);
const derived=deriveBridgeIntervals({
  players,powerups:tokenRows,collectionCandidates,snapshots:replaySamples.snapshots,deathEvents,
  matchClockOffsetSeconds,replayEndTick,matchEndTick,gameplayState,ticksPerSecond:TICKS_PER_SECOND,
  collectorDistanceGateHU:COLLECTOR_DISTANCE_GATE_HU,maxSnapshotGapTicks:MAX_SNAPSHOT_GAP_TICKS,
});
const d=derived.diagnostics;
const sufficientlyLongReplay=(finite(playerSummary?.finalMatchTimeSeconds)??0)>=300;
const checks={
  resourceClaimCurrent:check(resourceClaim.authorityStatus,'current',resourceClaim.authorityStatus==='current'),
  ownershipClaimCurrent:check(ownershipClaim.authorityStatus,'current',ownershipClaim.authorityStatus==='current'),
  ownershipSemanticPass:check(ownershipClaim.semanticValidation,'pass',ownershipClaim.semanticValidation==='pass'),
  ownershipReplicationCrossReplay:check(ownershipClaim.replicationStatus,'cross_replay_replicated',ownershipClaim.replicationStatus==='cross_replay_replicated'),
  resourceContractReady:check(resourceContract?.status,RESOURCE_STATUS,resourceContract?.status===RESOURCE_STATUS),
  collectionReplicationStrong:check(replication?.status,COLLECTION_REPLICATION_STATUS,replication?.status===COLLECTION_REPLICATION_STATUS),
  intervalAuthorityReady:check(authority?.status,AUTHORITY_STATUS,authority?.status===AUTHORITY_STATUS&&authority?.validation?.pass===true),
  fourBridgePowerupsFrozen:check(powerups.length,4,powerups.length===4&&BRIDGE_RECORD_KEYS.every(k=>powerups.some(x=>x.recordKey===k))),
  allBridgeDurations160:check([...new Set(powerups.map(x=>x.durationSeconds))],[160],powerups.length===4&&powerups.every(x=>x.durationSeconds===160)),
  tokenHashCollisionsAbsent:check(collisions.length,0,collisions.length===0),
  playerStateSnapshotsObserved:check(replaySamples.snapshots.length,'>0',replaySamples.snapshots.length>0&&players.length>=10),
  gameplayStateResolved:check(gameplayState,'non-null',gameplayState!==null),
  pickupCarrierObservedWhenEligible:check(pickupMutationEvents,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||pickupMutationEvents>0),
  mappedBridgeIdentityObservedWhenEligible:check(mappedIdentityObservations,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||mappedIdentityObservations>0),
  gameplayActiveDownsAllAttributed:check(d.unattributedGameplayActiveDowns.length,0,d.unattributedGameplayActiveDowns.length===0),
  collectorSnapshotGapsWithinFrozenEnvelope:check(d.snapshotGapFailures.length,0,d.snapshotGapFailures.length===0),
  collectorDistancesWithin300HU:check(d.overDistanceGate.length,0,d.overDistanceGate.length===0),
  intervalsNonnegative:check(d.invalidIntervals.length,0,d.invalidIntervals.length===0),
  collectionKeysUnique:check(d.duplicateCollectionKeys.length,0,d.duplicateCollectionKeys.length===0),
};
if (!Object.values(checks).every(x=>x.pass)) {
  const failed=Object.entries(checks).filter(([,v])=>!v.pass).map(([k])=>k);
  throw new Error(`Bridge-buff production integrity failed: ${failed.join(', ')}`);
}

const output={
  version:VERSION,canonical:false,createdAt:new Date().toISOString(),status:STATUS_READY,
  replay:{replayName,replayPath,ticksPerSecond:TICKS_PER_SECOND,matchClockOffsetSeconds,replayEndTick,matchEndTick,gameplayState},
  foundations:{resourceClaim:resourceClaim.claimId,ownershipClaim:ownershipClaim.claimId,resourceContractArtifact:resourcePath,collectionReplicationArtifact:replicationPath,runtimeIntervalAuthorityArtifact:authorityPath},
  semanticScope:{supported:'Per-player bridge-powerup collection and reconstructed ownership intervals using the cross-replay replicated world collection transition, frozen <=300 HU collector attribution, shared 160-second resource lifetime, exact replay death boundaries, and native match/replay censoring.',notClaimed:['A directly serialized player-side bridge modifier handle','Exact 5-to-40-minute effect interpolation','Gun/Casting/Movement dedicated player-side expiration consequence tests beyond the shared validated duration contract','Persistence beyond a replay or match censoring boundary']},
  counts:{players:players.length,playerSnapshots:replaySamples.snapshots.length,pickupMutationEvents,pickupEntitiesObserved,mappedIdentityObservations,activeTrueToFalseUpdates,controllerMutationEvents,deathEvents:deathEvents.length,collectionEvents:derived.collectionEvents.length,intervals:derived.intervals.length,naturalExpirations:derived.intervals.filter(x=>x.terminationReason==='NATURAL_EXPIRATION').length,deathTerminations:derived.intervals.filter(x=>x.terminationReason==='DEATH_TERMINATION').length,matchEndCensored:derived.intervals.filter(x=>x.terminationReason==='MATCH_END_CENSORED').length,replayEndCensored:derived.intervals.filter(x=>x.terminationReason==='REPLAY_END_CENSORED').length},
  powerups:tokenRows.map(x=>({recordKey:x.recordKey,recordId:x.recordId,modifierClass:x.modifierClass,durationSeconds:x.durationSeconds})),
  players:derived.players,
  diagnostics:{nonGameplayActiveDowns:d.nonGameplayActiveDowns,unattributedGameplayActiveDowns:d.unattributedGameplayActiveDowns},
  validation:{pass:true,checks}
};
mkdirSync(dirname(outputPath),{recursive:true});
writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n','utf8');
writeFileSync(eventsPath,derived.collectionEvents.map(x=>JSON.stringify(x)).join('\n')+(derived.collectionEvents.length?'\n':''),'utf8');
console.log(`Status: ${STATUS_READY}`);
console.log(`Players: ${players.length}`);
console.log(`Collections: ${derived.collectionEvents.length}`);
console.log(`Natural / death / censored: ${output.counts.naturalExpirations} / ${output.counts.deathTerminations} / ${output.counts.matchEndCensored+output.counts.replayEndCensored}`);
console.log(`JSON: ${outputPath}`);
console.log(`Events: ${eventsPath}`);

async function loadPlayerState(path){
  const snapshots=[],playersByController=new Map(),gameStateRows=[];let currentTick=null,currentPlayers=[];
  const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});
  for await(const line of rl){if(!line.trim())continue;let r;try{r=JSON.parse(line);}catch{continue;}const tick=finite(r.demoTick??r.tick);if(tick===null)continue;
    if(currentTick!==null&&tick!==currentTick){snapshots.push({tick:currentTick,players:currentPlayers});currentPlayers=[];}currentTick=tick;
    const c=r.controller??{},pawn=r.pawn??{},name=c.playerName;if(name&&name!=='SourceTV'){
      const p={controllerEntityIndex:finite(c.entityIndex),playerName:name,steamId:c.steamId??null,heroId:c.heroId??null,team:c.team??null,alive:c.alive===true,position:positionArray(pawn.positionWorld)};
      currentPlayers.push(p);if(p.controllerEntityIndex!==null)playersByController.set(p.controllerEntityIndex,{...playersByController.get(p.controllerEntityIndex),...p});
    }
    const mt=finite(r.matchTimeSeconds),gs=normalizeInteger(r.gameState);if(mt!==null&&gs!==null)gameStateRows.push({tick,matchTimeSeconds:mt,gameState:gs});
  }
  if(currentTick!==null)snapshots.push({tick:currentTick,players:currentPlayers});
  return{snapshots,players:[...playersByController.values()],gameStateRows};
}
function deriveGameplayState(rows){const counts=new Map();for(const r of rows){if(r.matchTimeSeconds>=30&&r.matchTimeSeconds<=300)counts.set(r.gameState,(counts.get(r.gameState)??0)+1);}if(!counts.size)for(const r of rows){if(r.matchTimeSeconds>=0)counts.set(r.gameState,(counts.get(r.gameState)??0)+1);}return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??null;}
function findMatchEndTick(events,gameplayState,offset){if(gameplayState===null)return null;let entered=false;for(const e of events){if(e.after===gameplayState){entered=true;continue;}if(entered&&e.before===gameplayState&&e.after!==gameplayState&&Number.isFinite(e.tick)&&e.tick/TICKS_PER_SECOND-offset>=0)return e.tick;}return null;}
function mergePlayerIdentities(sampled,parsed){const map=new Map();for(const p of sampled)if(p.controllerEntityIndex!=null)map.set(Number(p.controllerEntityIndex),p);for(const p of parsed){if(p.playerName&&p.playerName!=='SourceTV')map.set(Number(p.controllerEntityIndex),{...map.get(Number(p.controllerEntityIndex)),...p});}return[...map.values()].filter(p=>p.playerName&&p.playerName!=='SourceTV');}
function getControllerState(map,index){if(!map.has(index))map.set(index,{controllerEntityIndex:index,playerName:null,steamId:null,heroId:null,team:null,alive:null});return map.get(index);}
function refreshController(s,e){const n=e.getField('m_iszPlayerName');if(n!==undefined&&n!==null)s.playerName=String(n);const st=e.getField('m_steamID');if(st!==undefined&&st!==null)s.steamId=safeValue(st);const h=e.getField('m_nHeroID');if(h!==undefined&&h!==null)s.heroId=h;const t=e.getField('m_iTeamNum');if(t!==undefined&&t!==null)s.team=t;const a=e.getField('m_bAlive');if(typeof a==='boolean')s.alive=a;}
function readWorldPosition(e){const x=decodeCoordinate(e.getField('CBodyComponent.m_cellX'),e.getField('CBodyComponent.m_vecX')),y=decodeCoordinate(e.getField('CBodyComponent.m_cellY'),e.getField('CBodyComponent.m_vecY')),z=decodeCoordinate(e.getField('CBodyComponent.m_cellZ'),e.getField('CBodyComponent.m_vecZ'));return[x,y,z].every(Number.isFinite)?{x,y,z}:null;}
function decodeCoordinate(cell,local){return Number.isFinite(cell)&&Number.isFinite(local)?cell*512-16384+local:null;}
function positionArray(p){return p&&[p.x,p.y,p.z].every(Number.isFinite)?[p.x,p.y,p.z]:null;}
function normalizeBoolean(v){return typeof v==='boolean'?v:typeof v==='number'?(v===1?true:v===0?false:null):null;}
function normalizeUnsignedId(v){if(typeof v==='bigint'){const n=Number(v);return Number.isSafeInteger(n)?n>>>0:null;}if(typeof v==='number'&&Number.isFinite(v))return Math.trunc(v)>>>0;if(typeof v==='string'&&/^\d+$/.test(v)){const n=Number(v);return Number.isSafeInteger(n)?n>>>0:null;}return null;}
function normalizeInteger(v){if(typeof v==='bigint'){const n=Number(v);return Number.isSafeInteger(n)?n:null;}if(typeof v==='number'&&Number.isFinite(v))return Math.trunc(v);if(typeof v==='string'&&/^-?\d+$/.test(v)){const n=Number(v);return Number.isSafeInteger(n)?n:null;}return null;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function safeValue(v){if(v==null||['string','number','boolean'].includes(typeof v))return v;if(typeof v==='bigint')return v.toString();try{return JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));}catch{return String(v);}}
function check(actual,expected,pass){return{actual,expected,pass:Boolean(pass)};}
