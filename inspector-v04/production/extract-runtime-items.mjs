import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { EntityOperation, InterceptorStage, Logger, Parser, ParserConfiguration } from 'deadem';
import { requireClaim } from '../../src/contracts/claim-registry.mjs';
import { buildDeadlockStringTokenIndex, murmurHash2 } from '../../src/source2/murmurhash2.mjs';
import { applyUpgradeVectorChanges, buildOwnershipViews, createUpgradeState, currentUpgradeIdSet, itemsAtIntervals, serializeSlots } from '../lib/runtime-items.mjs';

const VERSION='RUNTIME_ITEM_OWNERSHIP_PRODUCTION_V01';
const TICKS_PER_SECOND=64;
const MAGIC_REACH_ID=754480263;

const replayArgument=process.argv[2];
if (!replayArgument) throw new Error('Usage: node inspector-v04/production/extract-runtime-items.mjs replays/<replay>.dem');
const replayPath=resolve(replayArgument);
const replayName=basename(replayPath,extname(replayPath));
const catalogPath=resolve('output','cross_replay','current_purchasable_item_catalog_v02.json');
const playerStateSummaryPath=resolve('output',replayName,'player_state_summary.json');
const outputPath=resolve('output',replayName,'runtime_item_ownership_production_v01.json');
const eventsPath=resolve('output',replayName,'runtime_item_ownership_events_v01.jsonl');

if (!existsSync(replayPath)) throw new Error(`Replay not found: ${replayPath}`);
if (!existsSync(catalogPath)) throw new Error(`Validated Script 138 V02 catalog not found: ${catalogPath}`);
if (!existsSync(playerStateSummaryPath)) throw new Error(`Core production summary missing: ${playerStateSummaryPath}`);

const ownershipClaim=requireClaim('runtime_item_ownership',{requireSemantic:true});
const catalogArtifact=JSON.parse(await fs.readFile(catalogPath,'utf8'));
const playerStateSummary=JSON.parse(await fs.readFile(playerStateSummaryPath,'utf8'));
const standardRows=Array.isArray(catalogArtifact.catalog)?catalogArtifact.catalog:[];
const allResourceRows=[
  ...standardRows.map(row=>({...row,runtimeResourceClass:'STANDARD_SHOP'})),
  ...(catalogArtifact.nonStandardModeItems??[]).map(row=>({...row,runtimeResourceClass:'NON_STANDARD_MODE_ITEM'})),
  ...(catalogArtifact.infrastructure??[]).map(row=>({...row,runtimeResourceClass:'ITEM_SYSTEM_INFRASTRUCTURE'})),
  ...(catalogArtifact.cosmetics??[]).map(row=>({...row,runtimeResourceClass:'COSMETIC_ITEM'})),
  ...(catalogArtifact.excluded??[]).map(row=>({...row,runtimeResourceClass:'EXCLUDED_RESOURCE_ITEM'})),
];
const standardTokenIndex=buildDeadlockStringTokenIndex(standardRows.map(row=>row.recordKey));
const allResourceTokenIndex=buildDeadlockStringTokenIndex(allResourceRows.map(row=>row.recordKey));
const resourceById=new Map(allResourceRows.map(row=>[murmurHash2(row.recordKey),{...row,itemId:murmurHash2(row.recordKey)}]));

let matchClockOffsetSeconds=finite(playerStateSummary.matchClockOffsetSeconds);
let maxTick=finite(playerStateSummary.finalSampleTick)??0;
let controllerMutationEvents=0;
let vectorTouchEvents=0;
const observedIds=new Set();
const controllerStates=new Map();
const transitions=[];

const parser=new Parser(new ParserConfiguration({entityClasses:['CCitadelPlayerController','CCitadelGameRulesProxy']}),Logger.CONSOLE_INFO);
parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET,(demoPacket,messagePacket,events)=>{
  const tick=finite(demoPacket?.tick);
  if (tick!==null) maxTick=Math.max(maxTick,tick);
  for (const event of events) {
    if (event.operation!==EntityOperation.CREATE && event.operation!==EntityOperation.UPDATE) continue;
    const entity=event.entity;
    const className=entity?.class?.name;
    if (className==='CCitadelGameRulesProxy') {
      if (matchClockOffsetSeconds===null) {
        const a=finite(entity.getField('m_pGameRules.m_flGameStartTime'));
        const b=finite(entity.getField('m_pGameRules.m_flGameStateStartTime'));
        if (a!==null&&b!==null) matchClockOffsetSeconds=a-b;
      }
      continue;
    }
    if (className!=='CCitadelPlayerController') continue;
    controllerMutationEvents++;
    const state=getControllerState(entity.index);
    refreshIdentity(state,entity);
    const changes=safeChanges(event);
    const mutation=applyUpgradeVectorChanges(state,changes);
    if (!mutation.touched) continue;
    vectorTouchEvents++;
    for (const id of [...mutation.addedIds,...mutation.removedIds,...currentUpgradeIdSet(state)]) observedIds.add(id);
    if (!mutation.addedIds.length&&!mutation.removedIds.length) continue;
    transitions.push({
      tick,
      demoSeconds:tick===null?null:tick/TICKS_PER_SECOND,
      matchTimeSeconds:tick===null||matchClockOffsetSeconds===null?null:tick/TICKS_PER_SECOND-matchClockOffsetSeconds,
      controllerEntityIndex:entity.index,
      playerName:state.playerName,steamId:state.steamId,heroId:state.heroId,team:state.team,
      eventType:event.operation===EntityOperation.CREATE?'INITIAL_VECTOR_STATE_CHANGE':mutation.addedIds.length&&mutation.removedIds.length?'OWNERSHIP_SET_REPLACEMENT_OR_COMPACTION':mutation.addedIds.length?'OWNERSHIP_SET_ADDITION':'OWNERSHIP_SET_REMOVAL',
      declaredUpgradeLength:state.declaredUpgradeLength,
      added:mutation.addedIds.map(resolveObservedItemId),
      removed:mutation.removedIds.map(resolveObservedItemId),
      beforeSlots:mutation.beforeSlots.map(row=>({slot:row.slot,...resolveObservedItemId(row.itemId)})),
      afterSlots:mutation.afterSlots.map(row=>({slot:row.slot,...resolveObservedItemId(row.itemId)})),
    });
  }
});

console.log('');
console.log('========================================');
console.log('RUNTIME ITEM OWNERSHIP - PRODUCTION V01');
console.log('========================================');
console.log(`Replay: ${replayName}`);
console.log(`Catalog: ${catalogPath}`);
try {
  await parser.parse(createReadStream(replayPath));
} finally {
  await parser.dispose();
}

const basePlayers=[...controllerStates.entries()].map(([entityIndex,state])=>({
  entityIndex,playerName:state.playerName,steamId:state.steamId,heroId:state.heroId,team:state.team,
  declaredUpgradeLength:state.declaredUpgradeLength,
  finalUpgradeSlots:serializeSlots(state.upgradeSlots,resolveObservedItemId),
  finalUpgradeItems:[...currentUpgradeIdSet(state)].map(resolveObservedItemId),
})).filter(row=>row.playerName&&row.playerName!=='SourceTV');

const matchEndSeconds=finite(playerStateSummary.finalMatchTimeSeconds)??Math.max(0,maxTick/TICKS_PER_SECOND-(matchClockOffsetSeconds??0));
const players=buildOwnershipViews({players:basePlayers,transitions,matchEndSeconds});
const flatEvents=players.flatMap(player=>player.itemEvents);
const unknownObservedIds=[...observedIds].filter(id=>!resourceById.has(id)).sort((a,b)=>a-b);
const knownNonStandardObservedIds=[...observedIds].filter(id=>resourceById.has(id)&&resourceById.get(id).runtimeResourceClass!=='STANDARD_SHOP').sort((a,b)=>a-b);
const standardObservedIds=[...observedIds].filter(id=>resourceById.get(id)?.runtimeResourceClass==='STANDARD_SHOP').sort((a,b)=>a-b);
const duplicateEntries=players.reduce((n,p)=>n+(p.integrity?.duplicateOwnershipEntries??0),0);
const orphanExits=players.reduce((n,p)=>n+(p.integrity?.orphanOwnershipExits??0),0);
const finalStateMismatches=players.flatMap(player=>{
  const declared=new Set((player.finalStandardShopItems??[]).map(item=>Number(item.itemId)));
  const interval=new Set(itemsAtIntervals(player.ownershipIntervals,matchEndSeconds).map(item=>Number(item.itemId)));
  const missingFromIntervals=[...declared].filter(id=>!interval.has(id));
  const extraInIntervals=[...interval].filter(id=>!declared.has(id));
  return (missingFromIntervals.length||extraInIntervals.length)?[{controllerEntityIndex:player.entityIndex,playerName:player.playerName,missingFromIntervals,extraInIntervals}]:[];
});

const checks={
  ownershipClaimCurrent:check(ownershipClaim.authorityStatus,'current',ownershipClaim.authorityStatus==='current'),
  catalogReady:check(catalogArtifact.status,'CURRENT_PURCHASABLE_ITEM_CATALOG_V02_STANDARD_SHOP_RESOURCE_READY',catalogArtifact.status==='CURRENT_PURCHASABLE_ITEM_CATALOG_V02_STANDARD_SHOP_RESOURCE_READY'),
  catalogRows:check(standardRows.length,156,standardRows.length===156),
  standardHashCollisions:check(standardTokenIndex.collisions.length,0,standardTokenIndex.collisions.length===0),
  allResourceHashCollisions:check(allResourceTokenIndex.collisions.length,0,allResourceTokenIndex.collisions.length===0),
  magicReachHashFixture:check(murmurHash2('upgrade_magic_reach'),MAGIC_REACH_ID,murmurHash2('upgrade_magic_reach')===MAGIC_REACH_ID),
  playerControllers:check(players.length,'>0',players.length>0),
  vectorTouchEvents:check(vectorTouchEvents,'>0',vectorTouchEvents>0),
  observedItemIds:check(observedIds.size,'>0',observedIds.size>0),
  unknownObservedItemIds:check(unknownObservedIds.length,0,unknownObservedIds.length===0),
  duplicateOwnershipEntries:check(duplicateEntries,0,duplicateEntries===0),
  orphanOwnershipExits:check(orphanExits,0,orphanExits===0),
  finalOwnershipMatchesIntervals:check(finalStateMismatches.length,0,finalStateMismatches.length===0),
};
const integrityPass=Object.values(checks).every(row=>row.pass);
const status=integrityPass?'RUNTIME_ITEM_OWNERSHIP_PRODUCTION_V01_READY':'RUNTIME_ITEM_OWNERSHIP_PRODUCTION_V01_REQUIRES_DIAGNOSIS';

const output={
  version:VERSION,canonical:false,createdAt:new Date().toISOString(),status,
  replay:{replayName,replayPath,ticksPerSecond:TICKS_PER_SECOND,matchClockOffsetSeconds,matchEndSeconds,maxTick},
  authority:{
    claimId:ownershipClaim.claimId??'runtime_item_ownership',authorityStatus:ownershipClaim.authorityStatus,
    sourceField:'CCitadelPlayerController.m_vecUpgrades',
    semanticInterpretation:'Current standard-shop item ownership.',
    researchAuthority:['Script 140 V01','Script 141 V02','Script 142 V02'],
    replicationStatus:'Strong cross-replay replication across five independent replays.',
    cautions:['Ownership entry is not automatically a shop purchase.','Ownership exit is not automatically a sale.','A mixed add/remove transition is not automatically a component upgrade.']
  },
  catalog:{path:catalogPath,status:catalogArtifact.status,standardShopRows:standardRows.length,versionBoundToInstalledBuild:Boolean(catalogArtifact.versionBoundToInstalledBuild)},
  counts:{controllerMutationEvents,vectorTouchEvents,transitions:transitions.length,players:players.length,standardOwnershipEvents:flatEvents.length,distinctObservedItemIds:observedIds.size,distinctStandardObservedItemIds:standardObservedIds.length,knownNonStandardObservedIds:knownNonStandardObservedIds.length,unknownObservedItemIds:unknownObservedIds.length},
  mapping:{standardObservedIds,knownNonStandardObservedIds:knownNonStandardObservedIds.map(resolveObservedItemId),unknownObservedIds,finalStateMismatches},
  players,transitions,
  integrityValidation:{pass:integrityPass,checks},
  semanticValidation:{status:'STRONG',authority:'A142 runtime_item_ownership',interpretation:'m_vecUpgrades is used as current standard-shop item ownership only.'},
  replicationStatus:{status:'STRONGLY_REPLICATED',independentReplays:5,authority:'Script 142 V02'},
};

await fs.mkdir(dirname(outputPath),{recursive:true});
await fs.writeFile(outputPath,JSON.stringify(output,null,2)+'\n','utf8');
await fs.writeFile(eventsPath,flatEvents.map(row=>JSON.stringify(row)).join('\n')+(flatEvents.length?'\n':''),'utf8');
console.log(`Status: ${status}`);
console.log(`Players: ${players.length}`);
console.log(`Ownership events: ${flatEvents.length}`);
console.log(`Unknown item IDs: ${unknownObservedIds.length}`);
console.log(`JSON: ${outputPath}`);
console.log(`Events: ${eventsPath}`);
if (!integrityPass) process.exitCode=1;

function getControllerState(entityIndex) {
  if (!controllerStates.has(entityIndex)) controllerStates.set(entityIndex,{...createUpgradeState(),playerName:null,steamId:null,heroId:null,team:null});
  return controllerStates.get(entityIndex);
}
function refreshIdentity(state,entity) {
  const name=entity.getField('m_iszPlayerName'); if (name!==undefined&&name!==null) state.playerName=String(name);
  const steam=entity.getField('m_steamID'); if (steam!==undefined&&steam!==null) state.steamId=safeValue(steam);
  const hero=entity.getField('m_nHeroID'); if (hero!==undefined&&hero!==null) state.heroId=safeValue(hero);
  const team=entity.getField('m_iTeamNum'); if (team!==undefined&&team!==null) state.team=safeValue(team);
}
function resolveObservedItemId(itemId) {
  const id=Number(itemId)>>>0; const row=resourceById.get(id);
  if (!row) return {itemId:id,mapped:false,resourceClass:'UNKNOWN'};
  return {itemId:id,mapped:true,resourceClass:row.runtimeResourceClass,recordKey:row.recordKey,itemSlot:row.itemSlot??null,itemTier:row.itemTier??null,standardShopPrice:row.standardShopPrice??null};
}
function safeChanges(event){try{return event.getChanges()??{};}catch{return {};}}
function safeValue(value){if(typeof value==='bigint')return value.toString();return value;}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function check(actual,expected,pass){return{actual,expected,pass:Boolean(pass)};}
