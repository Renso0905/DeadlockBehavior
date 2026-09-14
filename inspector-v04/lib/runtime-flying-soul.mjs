export const TROOPER_FLYING_SOUL_SUBCLASS_ID='494398941';
export const ECONOMIC_TROOPER_SUBCLASS_IDS=Object.freeze(new Set(['1003135509','1773848083','2943225653']));
export const SOURCE_MIN_TICK_OFFSET=-1;
export const SOURCE_MAX_TICK_OFFSET=4;
export const SOURCE_MAX_DISTANCE_3D_HU=250;
export const ENTITY_INDEX_MASK=0x3fff;
export const PLAYER_DAMAGE_MESSAGE_TYPE='k_EUserMsg_Damage';

export function readEntityWorldPosition(entity){
  const field=name=>{try{return entity?.getField?.(name);}catch{return undefined;}};
  const cellX=finite(field('CBodyComponent.m_cellX'));
  const cellY=finite(field('CBodyComponent.m_cellY'));
  const cellZ=finite(field('CBodyComponent.m_cellZ'));
  const vecX=finite(field('CBodyComponent.m_vecX'));
  const vecY=finite(field('CBodyComponent.m_vecY'));
  const vecZ=finite(field('CBodyComponent.m_vecZ'));
  if(cellX!==null&&cellY!==null&&vecX!==null&&vecY!==null)return{x:cellX*512-16384+vecX,y:cellY*512-16384+vecY,z:cellZ!==null&&vecZ!==null?cellZ*512-16384+vecZ:0};
  for(const name of ['CGameSceneNode.m_vecOrigin','CBodyComponent.m_vecAbsOrigin','m_vecAbsOrigin','m_vecOrigin']){
    const p=normalizePosition(field(name));if(p)return p;
  }
  return null;
}

export function normalizePosition(value){
  if(!value)return null;
  const x=finite(Array.isArray(value)?value[0]:value.x??value.X??value[0]);
  const y=finite(Array.isArray(value)?value[1]:value.y??value.Y??value[1]);
  const z=finite(Array.isArray(value)?value[2]:value.z??value.Z??value[2]??0);
  return x===null||y===null||z===null?null:{x,y,z};
}

export function distance3D(a,b){
  const x=normalizePosition(a),y=normalizePosition(b);if(!x||!y)return Infinity;
  return Math.hypot(x.x-y.x,x.y-y.y,x.z-y.z);
}

export function startFlyingSoulEpisode(current,sequence){
  return{
    schemaVersion:'runtime_flying_soul_episode_v01',episodeId:`${current.entityIndex}|${sequence}`,
    entityIndex:current.entityIndex,sequence,subclassId:String(current.subclassId),team:current.team,
    startTick:current.tick,startPosition:current.position,launchNum:current.launchNum,timeLaunch:current.timeLaunch,
    attackableTime:current.attackableTime,endAttackableTime:current.endAttackableTime,lastObservedTick:current.tick,
    lastPosition:current.position,endTick:null,endReason:null
  };
}

export function updateFlyingSoulEpisode(episode,current){
  episode.lastObservedTick=current.tick;episode.lastPosition=current.position??episode.lastPosition;
  for(const key of ['team','launchNum','timeLaunch','attackableTime','endAttackableTime'])if(current[key]!==null)episode[key]=current[key];
  return episode;
}

export function isFlyingSoulRelaunch(previous,current,episode){
  if(!previous||!episode)return false;
  const launchNumChanged=current.launchNum!==null&&previous.launchNum!==null&&current.launchNum!==previous.launchNum;
  const launchTimeChanged=current.timeLaunch!==null&&previous.timeLaunch!==null&&Math.abs(current.timeLaunch-previous.timeLaunch)>.0001;
  const largeJump=distance3D(previous.position,current.position)>=500;
  return launchNumChanged||launchTimeChanged||(largeJump&&current.tick-episode.startTick>=4);
}

export function buildStrictTrooperLinks(deaths,episodes){
  const usableDeaths=(deaths??[]).filter(d=>ECONOMIC_TROOPER_SUBCLASS_IDS.has(String(d.trooperContext?.subclassId??d.subclassId))&&Number.isFinite(finite(d.tick))&&[2,3].includes(finite(d.trooperContext?.team??d.team))&&normalizePosition(d.position));
  const usableEpisodes=(episodes??[]).filter(e=>String(e.subclassId)===TROOPER_FLYING_SOUL_SUBCLASS_ID&&Number.isFinite(finite(e.startTick))&&[2,3].includes(finite(e.team))&&normalizePosition(e.startPosition));
  const byStartTick=new Map();for(const e of usableEpisodes){const k=Number(e.startTick);if(!byStartTick.has(k))byStartTick.set(k,[]);byStartTick.get(k).push(e);}
  const byDeath=new Map();let candidateEdges=0;
  for(const d of usableDeaths){const id=`${d.entityIndex}|${d.tick}`,edges=[];const team=finite(d.trooperContext?.team??d.team);
    for(let tick=Number(d.tick)+SOURCE_MIN_TICK_OFFSET;tick<=Number(d.tick)+SOURCE_MAX_TICK_OFFSET;tick++)for(const e of byStartTick.get(tick)??[]){
      if(finite(e.team)!==team)continue;const distance=distance3D(d.position,e.startPosition);if(distance>SOURCE_MAX_DISTANCE_3D_HU)continue;
      edges.push({deathId:id,deathEntityIndex:d.entityIndex,deathTick:d.tick,episodeId:e.episodeId,tickDelta:e.startTick-d.tick,distance3D:distance,episode:e});candidateEdges++;
    }
    byDeath.set(id,edges);
  }
  const byEpisode=new Map();for(const edges of byDeath.values())for(const edge of edges){if(!byEpisode.has(edge.episodeId))byEpisode.set(edge.episodeId,[]);byEpisode.get(edge.episodeId).push(edge);}
  const strictLinks=[];for(const edges of byDeath.values())if(edges.length===1&&(byEpisode.get(edges[0].episodeId)?.length??0)===1)strictLinks.push(edges[0]);
  return{usableTrooperDeaths:usableDeaths.length,candidateEpisodes:usableEpisodes.length,candidateEdges,ambiguousDeaths:[...byDeath.values()].filter(x=>x.length>1).length,ambiguousEpisodes:[...byEpisode.values()].filter(x=>x.length>1).length,strictLinks};
}

export function summarizeFlyingSoulLinks(links){
  const events=(links??[]).map(x=>x.episode??x);
  const durations=events.map(e=>finite(e.endAttackableTime)!==null&&finite(e.attackableTime)!==null?finite(e.endAttackableTime)-finite(e.attackableTime):null).filter(x=>x!==null&&x>=0).sort((a,b)=>a-b);
  const byTeam={};for(const e of events){const k=String(e.team);byTeam[k]=(byTeam[k]??0)+1;}
  return{episodes:events.length,attackableWindows:durations.length,missingAttackableWindows:events.length-durations.length,medianAttackableWindowSeconds:median(durations),minAttackableWindowSeconds:durations[0]??null,maxAttackableWindowSeconds:durations.at(-1)??null,byTeam};
}

export function extractPlayerDamageReference(messagePacket){
  const messageType=decodeMessageType(messagePacket?.type);
  if(messageType!==PLAYER_DAMAGE_MESSAGE_TYPE)return null;
  const data=messagePacket?.data??messagePacket?.message??messagePacket?.payload??messagePacket??null;
  const victimIndex=normalizeEntityReference(findValueByKeyPatterns(data,[/entindexvictim/i,/entindex_victim/i,/victimentityindex/i,/victimindex/i,/^victim$/i,/hvictim/i],4));
  if(victimIndex===null)return null;
  const attackerIndex=normalizeEntityReference(findValueByKeyPatterns(data,[/entindexattacker/i,/entindex_attacker/i,/attackerentityindex/i,/attackerindex/i,/^attacker$/i,/hattacker/i],4));
  return{messageType,victimIndex,attackerIndex};
}

export function associatePlayerDamage(events,damageMessages,playerByPawn,{matchClockOffsetSeconds=0,tickRate=64}={}){
  const byVictim=new Map();
  for(const event of events??[]){const key=Number(event.entityIndex);if(!byVictim.has(key))byVictim.set(key,[]);byVictim.get(key).push(event);event.playerDamageMessages=[];}
  const diagnostics={damageMessages:(damageMessages??[]).length,matchedToAttackableEpisode:0,outsideAcceptedAttackableEpisode:0,ambiguousEpisodeMatches:0,unresolvedAttacker:0};
  for(const message of damageMessages??[]){
    const candidates=(byVictim.get(Number(message.victimIndex))??[]).filter(event=>{
      const start=attackableTick(event,event.attackableTime,tickRate),end=attackableTick(event,event.endAttackableTime,tickRate);
      return start!==null&&end!==null&&Number(message.tick)>=start&&Number(message.tick)<=end;
    });
    if(candidates.length===0){diagnostics.outsideAcceptedAttackableEpisode++;continue;}
    if(candidates.length!==1){diagnostics.ambiguousEpisodeMatches++;continue;}
    const player=playerByPawn?.get(Number(message.attackerIndex))??null;
    if(!player){diagnostics.unresolvedAttacker++;continue;}
    diagnostics.matchedToAttackableEpisode++;
    candidates[0].playerDamageMessages.push({tick:Number(message.tick),matchTimeSeconds:Number(message.tick)/tickRate-matchClockOffsetSeconds,messageType:message.messageType,victimIndex:Number(message.victimIndex),attackerIndex:Number(message.attackerIndex),attackerPlayer:{playerId:player.playerId,controllerEntityIndex:Number(player.controllerEntityIndex),pawnEntityIndex:Number(player.pawnEntityIndex),playerName:player.playerName,team:Number(player.team),heroId:player.heroId==null?null:Number(player.heroId)}});
  }
  const byPlayer=new Map();
  for(const event of events??[]){
    const players=new Set(),teams=new Set();
    for(const message of event.playerDamageMessages){const p=message.attackerPlayer;players.add(p.playerId);teams.add(p.team);if(!byPlayer.has(p.playerId))byPlayer.set(p.playerId,{...p,damagedEpisodes:new Set(),damageMessages:0});const row=byPlayer.get(p.playerId);row.damagedEpisodes.add(event.episodeId);row.damageMessages++;}
    event.damageObservation={observedPlayerDamage:event.playerDamageMessages.length>0,damageMessageCount:event.playerDamageMessages.length,distinctPlayerCount:players.size,distinctTeamCount:teams.size,multiMessage:event.playerDamageMessages.length>1,multiPlayer:players.size>1,mixedTeam:teams.size>1};
  }
  const episodes=events?.length??0,withDamage=(events??[]).filter(x=>x.damageObservation.observedPlayerDamage).length;
  const summary={episodesWithObservedPlayerDamage:withDamage,episodesWithoutObservedPlayerDamage:episodes-withDamage,totalObservedPlayerDamageMessages:(events??[]).reduce((n,x)=>n+x.damageObservation.damageMessageCount,0),multiMessageEpisodes:(events??[]).filter(x=>x.damageObservation.multiMessage).length,multiPlayerEpisodes:(events??[]).filter(x=>x.damageObservation.multiPlayer).length,mixedTeamEpisodes:(events??[]).filter(x=>x.damageObservation.mixedTeam).length,byPlayer:[...byPlayer.values()].map(x=>({...x,damagedEpisodes:x.damagedEpisodes.size})).sort((a,b)=>a.controllerEntityIndex-b.controllerEntityIndex)};
  return{events,summary,diagnostics};
}

export function normalizeEntityReference(value){
  if(value===null||value===undefined)return null;
  if(typeof value==='object')for(const key of['entityIndex','entindex','index','handle','value','id'])if(Object.prototype.hasOwnProperty.call(value,key)){const normalized=normalizeEntityReference(value[key]);if(normalized!==null)return normalized;}
  const number=finite(value);if(number===null)return null;const integer=Math.trunc(number);return integer>=0&&integer<=ENTITY_INDEX_MASK?integer:integer&ENTITY_INDEX_MASK;
}

function decodeMessageType(type){
  if(type===null||type===undefined)return null;
  const code=type?._code??type?.code??null;if(code!==null)return String(code);
  const id=type?._id??type?.id??null;return id!==null?`MESSAGE_ID_${id}`:String(type);
}

function findValueByKeyPatterns(root,patterns,maxDepth){
  const seen=new Set(),queue=[{value:root,depth:0}];
  while(queue.length){const current=queue.shift(),value=current.value;if(value===null||value===undefined||typeof value!=='object'||seen.has(value))continue;seen.add(value);for(const[key,nested]of Object.entries(value)){if(patterns.some(pattern=>pattern.test(key)))return nested;if(current.depth<maxDepth&&nested!==null&&typeof nested==='object')queue.push({value:nested,depth:current.depth+1});}}
  return null;
}

function attackableTick(event,value,tickRate){
  const startTick=finite(event?.startTick),timeLaunch=finite(event?.timeLaunch),time=finite(value),rate=finite(tickRate);
  return startTick===null||timeLaunch===null||time===null||rate===null?null:Math.round(startTick+(time-timeLaunch)*rate);
}

function median(values){if(!values.length)return null;const i=Math.floor(values.length/2);return values.length%2?values[i]:(values[i-1]+values[i])/2;}
function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
