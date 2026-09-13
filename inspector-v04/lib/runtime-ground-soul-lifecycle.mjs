export function decodeSource2EntityHandle(value){
  const raw=handleNumber(value);
  if(raw===null || raw<=0 || raw===0xFFFFFF || raw===0xFFFFFFFF) return null;
  const entityIndex=(raw>>>0)&0x3fff;
  if(entityIndex===0x3fff) return null;
  return {raw,entityIndex};
}

export function beginGroundSoulEpisode({entityIndex,sequence,tick,demoSeconds,matchTimeSeconds,team,subclassId,active,interactive,vacuumTarget}){
  const target=decodeSource2EntityHandle(vacuumTarget);
  return {
    schemaVersion:'runtime_ground_soul_lifecycle_event_v01',
    activationId:`${entityIndex}|${sequence}`,
    entityIndex,
    sequence,
    activationTick:finite(tick),
    activationDemoSeconds:finite(demoSeconds),
    activationMatchTimeSeconds:finite(matchTimeSeconds),
    team:finite(team),
    subclassId:subclassId==null?null:String(subclassId),
    activeAtStart:active===true,
    interactiveAtStart:interactive===true,
    targeted:Boolean(target),
    targetOnsetTick:target?finite(tick):null,
    targetOnsetMatchTimeSeconds:target?finite(matchTimeSeconds):null,
    targetEntityIndex:target?.entityIndex??null,
    targetHandleRaw:target?.raw??null,
    endTick:null,
    endDemoSeconds:null,
    endMatchTimeSeconds:null,
    durationSeconds:null,
    endReason:null,
    finalized:false,
    censored:false,
  };
}

export function observeGroundSoulEpisode(episode,{tick,matchTimeSeconds,vacuumTarget}){
  if(!episode || episode.finalized) return episode;
  const target=decodeSource2EntityHandle(vacuumTarget);
  if(target && !episode.targeted){
    episode.targeted=true;
    episode.targetOnsetTick=finite(tick);
    episode.targetOnsetMatchTimeSeconds=finite(matchTimeSeconds);
    episode.targetEntityIndex=target.entityIndex;
    episode.targetHandleRaw=target.raw;
  }
  return episode;
}

export function finishGroundSoulEpisode(episode,{tick,demoSeconds,matchTimeSeconds,endReason,censored=false}){
  if(!episode || episode.finalized) return episode;
  episode.endTick=finite(tick);
  episode.endDemoSeconds=finite(demoSeconds);
  episode.endMatchTimeSeconds=finite(matchTimeSeconds);
  const start=finite(episode.activationDemoSeconds),end=finite(demoSeconds);
  episode.durationSeconds=start!==null&&end!==null?Math.max(0,end-start):null;
  episode.endReason=String(endReason??'UNKNOWN');
  episode.censored=Boolean(censored);
  episode.finalized=true;
  return episode;
}

export function buildGroundSoulLifecycleSummary(episodes=[]){
  const rows=[...(episodes??[])].sort((a,b)=>num(a.activationTick)-num(b.activationTick)||num(a.entityIndex)-num(b.entityIndex)||num(a.sequence)-num(b.sequence));
  const gameplay=rows.filter(e=>finite(e.activationMatchTimeSeconds)!==null&&finite(e.activationMatchTimeSeconds)>=0);
  const completed=rows.filter(e=>e.finalized&&!e.censored&&e.endReason==='BECAME_INACTIVE');
  const censored=rows.filter(e=>e.censored);
  const targeted=rows.filter(e=>e.targeted);
  const targetless=rows.filter(e=>!e.targeted);
  const durations=completed.map(e=>finite(e.durationSeconds)).filter(v=>v!==null);
  const targetDelays=targeted.map(e=>{
    const a=finite(e.activationMatchTimeSeconds),t=finite(e.targetOnsetMatchTimeSeconds);
    return a!==null&&t!==null?Math.max(0,t-a):null;
  }).filter(v=>v!==null);
  const byTeam={};
  for(const e of rows){const k=e.team==null?'unknown':String(e.team);byTeam[k]=(byTeam[k]??0)+1;}
  const cumulativeTimeline=[];
  let n=0;
  for(const e of gameplay){n++;cumulativeTimeline.push({matchTime:e.activationMatchTimeSeconds,tick:e.activationTick,activations:n});}
  return {
    activations:rows.length,
    gameplayActivations:gameplay.length,
    pregameActivations:rows.length-gameplay.length,
    targetedActivations:targeted.length,
    targetlessActivations:targetless.length,
    targetedShare:rows.length?targeted.length/rows.length:null,
    completedActiveToInactive:completed.length,
    censoredActivations:censored.length,
    medianCompletedDurationSeconds:median(durations),
    meanCompletedDurationSeconds:mean(durations),
    minCompletedDurationSeconds:durations.length?Math.min(...durations):null,
    maxCompletedDurationSeconds:durations.length?Math.max(...durations):null,
    medianTargetOnsetDelaySeconds:median(targetDelays),
    byTeam,
    cumulativeTimeline,
  };
}

export function compareActivationKeys(productionEpisodes,researchEpisodes){
  const key=e=>`${Math.trunc(num(e.activationTick))}:${Math.trunc(num(e.entityIndex))}`;
  const production=new Set((productionEpisodes??[]).map(key));
  const research=new Set((researchEpisodes??[]).map(key));
  let matched=0;for(const k of production)if(research.has(k))matched++;
  return {production:production.size,research:research.size,matched,precision:production.size?matched/production.size:null,recall:research.size?matched/research.size:null,exact:production.size===research.size&&matched===production.size};
}

export async function attributePhysicalVacuumTargets(episodes=[],playerStateRows,{maxLagTicks=16}={}){
  const targeted=(episodes??[]).filter(e=>e.targeted&&Number.isInteger(e.targetEntityIndex)&&finite(e.targetOnsetTick)!==null)
    .sort((a,b)=>num(a.targetOnsetTick)-num(b.targetOnsetTick)||num(a.entityIndex)-num(b.entityIndex));
  const latest=new Map();let cursor=0,currentTick=null;
  const resolveOne=e=>{
    const observed=latest.get(e.targetEntityIndex),targetTick=num(e.targetOnsetTick),lag=observed?targetTick-observed.tick:null;
    if(!observed||lag<0||lag>maxLagTicks){e.physicalTargetPlayer=null;e.physicalTargetResolution='UNRESOLVED_NO_FRESH_PAWN_IDENTITY';return;}
    if(observed.ambiguous){e.physicalTargetPlayer=null;e.physicalTargetResolution='UNRESOLVED_AMBIGUOUS_PAWN_IDENTITY';return;}
    e.physicalTargetPlayer={...observed.identity,pawnEntityIndex:e.targetEntityIndex,identityObservedTick:observed.tick,identityLagTicks:lag};
    e.physicalTargetResolution='RESOLVED_OBSERVED_PAWN_IDENTITY';
  };
  const resolveBefore=tick=>{while(cursor<targeted.length&&num(targeted[cursor].targetOnsetTick)<tick)resolveOne(targeted[cursor++]);};
  for await(const row of playerStateRows){
    const tick=finite(row?.demoTick);if(tick===null)continue;
    if(currentTick===null)currentTick=tick;
    if(tick!==currentTick){resolveBefore(tick);currentTick=tick;}
    const pawn=finite(row?.pawn?.entityIndex),controller=finite(row?.controller?.entityIndex);if(pawn===null||controller===null)continue;
    const identity={controllerEntityIndex:controller,steamId:row.controller?.steamId??null,playerName:row.controller?.playerName??null,team:finite(row.controller?.team),heroId:finite(row.controller?.heroId)};
    const prior=latest.get(pawn);latest.set(pawn,{tick,identity,ambiguous:Boolean(prior?.tick===tick&&prior.identity.controllerEntityIndex!==controller)});
  }
  while(cursor<targeted.length)resolveOne(targeted[cursor++]);
  const resolved=targeted.filter(e=>e.physicalTargetPlayer),byPlayerMap=new Map();
  for(const e of resolved){const p=e.physicalTargetPlayer,key=String(p.controllerEntityIndex);if(!byPlayerMap.has(key))byPlayerMap.set(key,{...p,resolvedPhysicalTargets:0,cumulativeTimeline:[]});const row=byPlayerMap.get(key);row.resolvedPhysicalTargets++;row.cumulativeTimeline.push({tick:e.targetOnsetTick,matchTime:e.targetOnsetMatchTimeSeconds,resolvedPhysicalTargets:row.resolvedPhysicalTargets});}
  return {definition:'First valid m_hVacuumTarget per observed AssignedGold lifecycle, joined to a fresh sampled player pawn identity; this is physical attraction telemetry, not economic receipt.',maxIdentityLagTicks:maxLagTicks,targetedActivations:targeted.length,resolvedPhysicalTargets:resolved.length,unresolvedPhysicalTargets:targeted.length-resolved.length,resolutionShare:targeted.length?resolved.length/targeted.length:null,byPlayer:[...byPlayerMap.values()].sort((a,b)=>a.controllerEntityIndex-b.controllerEntityIndex)};
}

function handleNumber(v){
  if(v&&typeof v==='object'){
    for(const k of ['value','raw','_value','handle']){const n=Number(v[k]);if(Number.isFinite(n))return n;}
  }
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function median(a){const x=[...(a??[])].filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;}
function mean(a){const x=[...(a??[])].filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}

/**
 * Canonicalize one narrowly defined Source2 packet-fragmentation signature.
 *
 * A removable group must contain exactly two records with the same entity/tick.
 * The first must be a finalized, censored, zero-duration
 * REACTIVATED_WITHOUT_INACTIVE_CENSORED fragment and the second must be the
 * immediately consecutive sequence. All other duplicate shapes are preserved
 * so the producer's existing duplicateActivationKeys integrity check still
 * fails closed. The input array is mutated in place only for qualifying rows.
 */
export function collapseBenignSameTickReactivationFragments(episodes=[]){
  const groups=new Map();
  for(const e of episodes??[]){
    const tick=finite(e?.activationTick),entity=finite(e?.entityIndex);
    if(tick===null||entity===null)continue;
    const k=String(Math.trunc(entity))+':'+String(Math.trunc(tick));
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(e);
  }
  const remove=new Set(),resolvedGroups=[];
  let duplicateGroups=0,unresolvedDuplicateGroups=0;
  for(const [key,rows0] of groups){
    if(rows0.length<2)continue;
    duplicateGroups++;
    const rows=[...rows0].sort((a,b)=>(finite(a?.sequence)??0)-(finite(b?.sequence)??0));
    let resolved=false;
    if(rows.length===2){
      const [fragment,successor]=rows;
      const sameTick=finite(fragment.activationTick)!==null&&finite(fragment.activationTick)===finite(fragment.endTick)&&finite(fragment.activationTick)===finite(successor.activationTick);
      const zeroDuration=finite(fragment.durationSeconds)===0;
      const exactReason=fragment.endReason==='REACTIVATED_WITHOUT_INACTIVE_CENSORED'&&fragment.censored===true&&fragment.finalized===true;
      const consecutive=Number.isInteger(Number(fragment.sequence))&&Number(successor.sequence)===Number(fragment.sequence)+1;
      const sameEntity=Number(fragment.entityIndex)===Number(successor.entityIndex);
      if(sameTick&&zeroDuration&&exactReason&&consecutive&&sameEntity){
        remove.add(fragment);resolved=true;
        resolvedGroups.push({key,entityIndex:fragment.entityIndex,activationTick:fragment.activationTick,removedSequence:fragment.sequence,retainedSequence:successor.sequence,removedActivationId:fragment.activationId??null,retainedActivationId:successor.activationId??null});
      }
    }
    if(!resolved)unresolvedDuplicateGroups++;
  }
  if(remove.size){
    let w=0;for(let r=0;r<episodes.length;r++){if(remove.has(episodes[r]))continue;episodes[w++]=episodes[r];}episodes.length=w;
  }
  return {duplicateGroups,removedCount:remove.size,resolvedGroups,unresolvedDuplicateGroups};
}
