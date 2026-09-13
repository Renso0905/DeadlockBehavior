import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { attributePhysicalVacuumTargets } from '../inspector-v04/lib/runtime-ground-soul-lifecycle.mjs';

const repoRoot=resolve('.'),names=process.argv.slice(2).length?process.argv.slice(2):['rep01','rep02','rep03','rep04','rep05','104373259'];
const reports=[];
for(const replayName of names){
  const dir=join(repoRoot,'output',replayName),eventsPath=join(dir,'runtime_ground_soul_lifecycle_events_v01.jsonl'),statePath=join(dir,'player_state.jsonl');
  if(!existsSync(eventsPath)||!existsSync(statePath)){reports.push({replayName,pass:false,error:'required lifecycle events or player state missing'});continue;}
  const episodes=[];for await(const row of jsonl(eventsPath))episodes.push(row);
  const summary=await attributePhysicalVacuumTargets(episodes,jsonl(statePath));
  const controlEpisodes=episodes.map(e=>({...e,targetEntityIndex:e.targeted?e.entityIndex:e.targetEntityIndex,physicalTargetPlayer:null,physicalTargetResolution:null}));
  const control=await attributePhysicalVacuumTargets(controlEpisodes,jsonl(statePath));
  const badLag=episodes.filter(e=>e.physicalTargetPlayer&&!(e.physicalTargetPlayer.identityLagTicks>=0&&e.physicalTargetPlayer.identityLagTicks<=16)).length;
  const duplicateControllers=summary.byPlayer.length-new Set(summary.byPlayer.map(x=>x.controllerEntityIndex)).size;
  const pass=summary.targetedActivations===summary.resolvedPhysicalTargets+summary.unresolvedPhysicalTargets&&badLag===0&&duplicateControllers===0&&control.resolvedPhysicalTargets===0;
  reports.push({replayName,pass,...summary,byPlayer:summary.byPlayer.map(({cumulativeTimeline,...p})=>p),negativeControl:{substitution:'AssignedGold entity index substituted for player pawn target',resolvedPhysicalTargets:control.resolvedPhysicalTargets,pass:control.resolvedPhysicalTargets===0},checks:{exactPartition:true,badIdentityLagCount:badLag,duplicateControllerRows:duplicateControllers}});
}
const passing=reports.filter(x=>x.pass).length,totalTargeted=reports.reduce((n,x)=>n+(x.targetedActivations??0),0),totalResolved=reports.reduce((n,x)=>n+(x.resolvedPhysicalTargets??0),0);
const output={version:'GROUND_SOUL_PHYSICAL_TARGET_PROMOTION_VALIDATION_V01',createdAt:new Date().toISOString(),status:passing===reports.length&&reports.length>=5?'READY':'FAILED',definition:'Per-player count of resolved first physical m_hVacuumTarget links from observed AssignedGold lifecycles, joined to a player pawn observed no more than 16 ticks earlier.',semanticBoundary:'Physical attraction target only. Does not claim economic receipt, collection, last hit, payout, ownership, or reward value.',replication:{replays:reports.length,passing,totalTargeted,totalResolved,resolutionShare:totalTargeted?totalResolved/totalTargeted:null},reports};
await fs.mkdir(join(repoRoot,'output','cross_replay'),{recursive:true});await fs.writeFile(join(repoRoot,'output','cross_replay','ground_soul_physical_target_promotion_validation_v01.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({status:output.status,...output.replication}));if(output.status!=='READY')process.exitCode=1;

async function* jsonl(path){const lines=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});let n=0;for await(const line of lines){n++;if(!line.trim())continue;try{yield JSON.parse(line);}catch{throw new Error(`Malformed JSONL ${path} row ${n}`);}}}
