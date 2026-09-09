import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { EntityOperation, InterceptorStage, Logger, Parser, ParserConfiguration } from 'deadem';
import { requireClaim } from '../../src/contracts/claim-registry.mjs';
import { buildWorldBuffRuntimeSubclassMap } from '../../src/resources/world-buff-runtime-subclass-map.mjs';
import { derivePermanentBuffProduction } from '../lib/runtime-permanent-buffs.mjs';

const VERSION='RUNTIME_PERMANENT_BUFF_OWNERSHIP_PRODUCTION_V01';
const STATUS_READY='RUNTIME_PERMANENT_BUFF_OWNERSHIP_PRODUCTION_V01_READY';
const TICKS_PER_SECOND=64;
const STRONG_REPLICATION_STATUS='RUNTIME_PERMANENT_PICKUP_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS';

const replayArgument=process.argv[2];
if (!replayArgument) throw new Error('Usage: node inspector-v04/production/extract-runtime-permanent-buffs.mjs <replay.dem>');
const replayPath=resolve(replayArgument);
const replayName=basename(replayPath,extname(replayPath));
const contractPath=resolve('output','cross_replay','world_stat_buff_resource_contract_v02.json');
const replicationPath=resolve('output','cross_replay','runtime_permanent_pickup_cross_replay_replication_v01.json');
const playerSummaryPath=resolve('output',replayName,'player_state_summary.json');
const outputPath=resolve('output',replayName,'runtime_permanent_buff_ownership_production_v01.json');
const eventsPath=resolve('output',replayName,'runtime_permanent_buff_events_v01.jsonl');

for (const path of [replayPath,contractPath,replicationPath]) if (!existsSync(path)) throw new Error(`Required input missing: ${path}`);
const resourceClaim=requireClaim('permanent_world_buff_resource_contract',{requireSemantic:true});
const ownershipClaim=requireClaim('runtime_permanent_buff_ownership',{requireSemantic:true,requireReplication:true});
const contract=JSON.parse(readFileSync(contractPath,'utf8'));
const replication=JSON.parse(readFileSync(replicationPath,'utf8'));
if (contract?.status!=='WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') throw new Error(`World-buff contract not ready: ${contract?.status}`);
if (replication?.status!==STRONG_REPLICATION_STATUS) throw new Error(`Permanent-pickup replication authority not strong: ${replication?.status}`);
const expectedFamilyValueTypes=replication?.foundations?.discoveryFamilyValueTypes??{};
const subclassMap=buildWorldBuffRuntimeSubclassMap(contract);

console.log('');
console.log('==============================================');
console.log('RUNTIME PERMANENT BUFF OWNERSHIP - PRODUCTION V01');
console.log('==============================================');
console.log(`Replay: ${replayName}`);
console.log(`Contract: ${contractPath}`);
console.log(`Replication authority: ${replicationPath}`);

const parser=new Parser(new ParserConfiguration({entityClasses:['CCitadelPlayerController','CCitadelGameRulesProxy']}),Logger.CONSOLE_INFO);
let matchClockOffsetSeconds=null;
let controllerMutationEvents=0,statViewerRootMutations=0,statViewerChildMutations=0;
const carrierReadableControllers=new Set();
const controllers=new Map();
const transitions=[];

parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET,(demoPacket,messagePacket,events)=>{
  const tick=Number.isFinite(demoPacket?.tick)?demoPacket.tick:null;
  for (const event of events) {
    if (event.operation!==EntityOperation.CREATE&&event.operation!==EntityOperation.UPDATE) continue;
    const entity=event.entity,className=entity?.class?.name;
    if (className==='CCitadelGameRulesProxy') {
      const a=entity.getField('m_pGameRules.m_flGameStartTime'),b=entity.getField('m_pGameRules.m_flGameStateStartTime');
      if (matchClockOffsetSeconds===null&&Number.isFinite(a)&&Number.isFinite(b)) matchClockOffsetSeconds=a-b;
      continue;
    }
    if (className!=='CCitadelPlayerController') continue;
    controllerMutationEvents++;
    const changes=safeChanges(event),state=getControllerState(controllers,entity.index);refreshIdentity(state,entity);
    const rootImage=normalizeLength(entity.getField('m_vecStatViewerModifierValues'));
    if (rootImage!==null) carrierReadableControllers.add(entity.index);
    if (Object.prototype.hasOwnProperty.call(changes,'m_vecStatViewerModifierValues')) {
      statViewerRootMutations++;
      const length=normalizeLength(changes.m_vecStatViewerModifierValues);
      if (length!==null) {
        state.declaredLength=length;
        for (const index of [...state.rows.keys()]) if (index>=length) {
          const before=cloneRow(state.rows.get(index));state.rows.delete(index);recordTransition(state,index,before,null,tick,'VECTOR_TRIM');
        }
      }
    }
    const touched=new Set();
    for (const fieldName of Object.keys(changes)) {
      const m=/^m_vecStatViewerModifierValues\.(\d{4})\.(m_flValue|m_SourceModifierID|m_eValType)$/.exec(fieldName);
      if (m){statViewerChildMutations++;touched.add(Number.parseInt(m[1],10));}
    }
    for (const index of touched) {
      const before=cloneRow(state.rows.get(index)??null),after=readStatViewerRow(entity,index,tick);
      if (after&&after.sourceModifierId!==null) state.rows.set(index,after); else state.rows.delete(index);
      if (!rowsEqual(before,after)) recordTransition(state,index,before,after,tick,'ROW_MUTATION');
    }
  }
});

try { await parser.parse(createReadStream(replayPath)); } finally { await parser.dispose(); }

let summaryOffset=null;
if (existsSync(playerSummaryPath)) {
  try { summaryOffset=Number(JSON.parse(readFileSync(playerSummaryPath,'utf8'))?.matchClockOffsetSeconds); } catch {}
}
if (!Number.isFinite(matchClockOffsetSeconds)&&Number.isFinite(summaryOffset)) matchClockOffsetSeconds=summaryOffset;
if (!Number.isFinite(matchClockOffsetSeconds)) matchClockOffsetSeconds=0;
for (const t of transitions) {
  t.matchTimeSeconds=Number.isFinite(t.tick)?t.tick/TICKS_PER_SECOND-matchClockOffsetSeconds:null;
  t.demoSeconds=Number.isFinite(t.tick)?t.tick/TICKS_PER_SECOND:null;
}

const playerStates=[...controllers.entries()].filter(([,s])=>s.playerName&&s.playerName!=='SourceTV').map(([controllerEntityIndex,s])=>({
  controllerEntityIndex,playerName:s.playerName,steamId:s.steamId,heroId:s.heroId,team:s.team,
  finalRows:[...s.rows.entries()].sort((a,b)=>a[0]-b[0]).map(([vectorIndex,row])=>({vectorIndex,...row}))
}));

const derived=derivePermanentBuffProduction({players:playerStates,transitions,subclassMap,expectedFamilyValueTypes});
const d=derived.diagnostics;
const checks={
  resourceClaimCurrent:check(resourceClaim.authorityStatus,'current',resourceClaim.authorityStatus==='current'),
  ownershipClaimCurrent:check(ownershipClaim.authorityStatus,'current',ownershipClaim.authorityStatus==='current'),
  ownershipReplicationCrossReplay:check(ownershipClaim.replicationStatus,'cross_replay_replicated',ownershipClaim.replicationStatus==='cross_replay_replicated'),
  contractReady:check(contract.status,'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY',contract.status==='WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY'),
  replicationArtifactStrong:check(replication.status,STRONG_REPLICATION_STATUS,replication.status===STRONG_REPLICATION_STATUS),
  subclassHashCollisionsAbsent:check(subclassMap.collisions.length,0,subclassMap.collisions.length===0),
  permanentCandidatesExpected:check(subclassMap.permanentCandidates.length,18,subclassMap.permanentCandidates.length===18),
  frozenFamilyValueTypesComplete:check(Object.keys(expectedFamilyValueTypes).length,6,Object.keys(expectedFamilyValueTypes).length===6),
  playerControllersObserved:check(playerStates.length,'>=10',playerStates.length>=10),
  statViewerCarrierObserved:check(statViewerRootMutations+statViewerChildMutations+carrierReadableControllers.size,'>0',statViewerRootMutations+statViewerChildMutations+carrierReadableControllers.size>0),
  observedPermanentValueTypesMatchFrozenMap:check(d.valueTypeFailures.length,0,d.valueTypeFailures.length===0&&d.finalValueTypeFailures.length===0),
  positiveAmountsExactStaticUnitMultiples:check(d.positiveAmountFailures.length,0,d.positiveAmountFailures.length===0),
  noNegativeInPlacePermanentDeltas:check(d.negativeInPlaceEvents.length,0,d.negativeInPlaceEvents.length===0),
  finalPermanentValuesExactStaticUnitMultiples:check(d.finalAmountFailures.length,0,d.finalAmountFailures.length===0),
  acquisitionHistoryMatchesRetainedRowsWhenComparable:check(d.finalConsistencyFailures.length,0,d.finalConsistencyFailures.length===0),
};
const validationPass=Object.values(checks).every(x=>x.pass);
if (!validationPass) {
  const failed=Object.entries(checks).filter(([,v])=>!v.pass).map(([k])=>k);
  throw new Error(`Permanent-buff production integrity failed: ${failed.join(', ')}`);
}

const output={
  version:VERSION,canonical:false,createdAt:new Date().toISOString(),status:STATUS_READY,
  replay:{replayName,replayPath,ticksPerSecond:TICKS_PER_SECOND,matchClockOffsetSeconds},
  foundations:{resourceClaim:resourceClaim.claimId,ownershipClaim:ownershipClaim.claimId,resourceContractArtifact:contractPath,replicationArtifact:replicationPath,sourceNamespace:subclassMap.namespace},
  semanticScope:{supported:'Cumulative per-player permanent-pickup units and positive accumulation events for the 18 validated tier records across six families.',notClaimed:['Physical producer/object attribution','Golden Statue/Lion Statue causal attribution','Bridge powerup semantics','Exact downstream effective-stat composition','Compatibility across materially different game builds']},
  counts:{controllerMutationEvents,playerControllers:playerStates.length,statViewerRootMutations,statViewerChildMutations,carrierReadableControllers:carrierReadableControllers.size,permanentSubclassCandidates:subclassMap.permanentCandidates.length,distinctObservedPermanentSourceIds:d.distinctPermanentSourceIds.length,observedPermanentFamilies:d.observedFamilies.length,positiveAccumulationEvents:d.positiveAccumulationEvents,inferredPickupUnits:d.inferredPickupUnits,rowRemovalsDiagnostic:d.removalEvents.length,finalPermanentRows:d.finalRows.length},
  expectedFamilyValueTypes,players:derived.players,
  diagnostics:{observedPermanentSourceIds:d.distinctPermanentSourceIds,observedFamilies:d.observedFamilies,rowRemovals:d.removalEvents,finalRows:d.finalRows},
  validation:{pass:true,checks}
};
mkdirSync(dirname(outputPath),{recursive:true});
writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n','utf8');
writeFileSync(eventsPath,derived.acquisitionEvents.map(e=>JSON.stringify(e)).join('\n')+(derived.acquisitionEvents.length?'\n':''),'utf8');

console.log(`Status: ${STATUS_READY}`);
console.log(`Players: ${playerStates.length}`);
console.log(`Permanent acquisition events: ${derived.acquisitionEvents.length}`);
console.log(`Inferred pickup units: ${d.inferredPickupUnits}`);
console.log(`Observed families: ${d.observedFamilies.length}/6`);
console.log(`Row removals (diagnostic): ${d.removalEvents.length}`);
console.log(`JSON: ${outputPath}`);
console.log(`Events: ${eventsPath}`);

function recordTransition(state,index,before,after,tick,cause){transitions.push({tick,cause,controllerEntityIndex:state.entityIndex,playerName:state.playerName,steamId:state.steamId,heroId:state.heroId,team:state.team,vectorIndex:index,before,after});}
function readStatViewerRow(entity,index,tick){const s=String(index).padStart(4,'0');const sourceModifierId=normalizeUnsignedId(entity.getField(`m_vecStatViewerModifierValues.${s}.m_SourceModifierID`));const valueType=normalizeInteger(entity.getField(`m_vecStatViewerModifierValues.${s}.m_eValType`));const value=normalizeNumber(entity.getField(`m_vecStatViewerModifierValues.${s}.m_flValue`));if(sourceModifierId===null&&valueType===null&&value===null)return null;return{sourceModifierId,valueType,value,lastTick:tick};}
function getControllerState(map,entityIndex){if(!map.has(entityIndex))map.set(entityIndex,{entityIndex,playerName:null,steamId:null,heroId:null,team:null,declaredLength:null,rows:new Map()});return map.get(entityIndex);}
function refreshIdentity(s,e){const name=e.getField('m_iszPlayerName');if(name!==undefined&&name!==null)s.playerName=String(name);const steam=e.getField('m_steamID');if(steam!==undefined&&steam!==null)s.steamId=safeValue(steam);const hero=e.getField('m_nHeroID');if(hero!==undefined&&hero!==null)s.heroId=hero;const team=e.getField('m_iTeamNum');if(team!==undefined&&team!==null)s.team=team;}
function cloneRow(r){return r?{...r}:null;}
function rowsEqual(a,b){if(!a&&!b)return true;if(!a||!b)return false;return a.sourceModifierId===b.sourceModifierId&&a.valueType===b.valueType&&a.value===b.value;}
function normalizeLength(v){const n=normalizeInteger(v);return n!==null&&n>=0&&n<=128?n:null;}
function normalizeUnsignedId(v){if(typeof v==='bigint'){const n=Number(v);return Number.isSafeInteger(n)?n>>>0:null;}if(typeof v==='number'&&Number.isFinite(v))return Math.trunc(v)>>>0;if(typeof v==='string'&&/^\d+$/.test(v)){const n=Number(v);return Number.isSafeInteger(n)?n>>>0:null;}return null;}
function normalizeInteger(v){if(typeof v==='bigint'){const n=Number(v);return Number.isSafeInteger(n)?n:null;}if(typeof v==='number'&&Number.isFinite(v))return Math.trunc(v);if(typeof v==='string'&&/^-?\d+$/.test(v)){const n=Number(v);return Number.isSafeInteger(n)?n:null;}return null;}
function normalizeNumber(v){if(typeof v==='number'&&Number.isFinite(v))return v;if(typeof v==='bigint')return Number(v);if(typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v)))return Number(v);return null;}
function safeChanges(event){try{return event.getChanges()??{};}catch{return{};}}
function safeValue(v){if(v==null||['string','number','boolean'].includes(typeof v))return v;if(typeof v==='bigint')return v.toString();try{return JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));}catch{return String(v);}}
function check(actual,expected,pass){return{actual,expected,pass:Boolean(pass)};}
