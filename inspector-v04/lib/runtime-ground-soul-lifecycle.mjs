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
