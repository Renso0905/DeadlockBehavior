export const TROOPER_FLYING_SOUL_SUBCLASS_ID='494398941';
export const ECONOMIC_TROOPER_SUBCLASS_IDS=Object.freeze(new Set(['1003135509','1773848083','2943225653']));
export const SOURCE_MIN_TICK_OFFSET=-1;
export const SOURCE_MAX_TICK_OFFSET=4;
export const SOURCE_MAX_DISTANCE_3D_HU=250;

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

function median(values){if(!values.length)return null;const i=Math.floor(values.length/2);return values.length%2?values[i]:(values[i-1]+values[i])/2;}
function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
