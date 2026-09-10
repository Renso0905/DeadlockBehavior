export const DEFAULT_ISOLATION_RADIUS_TICKS=16;

export function isCompletedGroundSoulEpisode(e){
  return Boolean(e?.finalized) && !e?.censored && e?.endReason==='BECAME_INACTIVE' && integer(e?.endTick)!==null;
}

export function isIsolatedGroundSoulTermination(episode,episodes=[],radiusTicks=DEFAULT_ISOLATION_RADIUS_TICKS){
  const endTick=integer(episode?.endTick);
  if(endTick===null || !isCompletedGroundSoulEpisode(episode)) return false;
  const radius=Math.max(0,Math.trunc(Number(radiusTicks)||0));
  for(const other of episodes??[]){
    if(sameEpisodeIdentity(other,episode) || !isCompletedGroundSoulEpisode(other)) continue;
    const t=integer(other.endTick);if(t!==null && Math.abs(t-endTick)<=radius)return false;
  }
  return true;
}

export function resolveAssignedGoldEconomicCredit(episode,currencyDeltas=[],episodes=[],options={}){
  const radius=Number.isFinite(Number(options.isolationRadiusTicks))?Math.max(0,Math.trunc(Number(options.isolationRadiusTicks))):DEFAULT_ISOLATION_RADIUS_TICKS;
  const base={
    schemaVersion:'runtime_assigned_gold_economic_credit_event_v01',
    activationId:episode?.activationId??null,
    assignedGoldEntityIndex:integer(episode?.entityIndex),
    activationTick:integer(episode?.activationTick),
    resolutionTick:integer(episode?.endTick),
    resolutionMatchTimeSeconds:finite(episode?.endMatchTimeSeconds),
    team:integer(episode?.team),
    targetEntityIndex:integer(episode?.targetEntityIndex),
    targeted:Boolean(episode?.targeted),
    isolationRadiusTicks:radius,
    exactTickOnly:true,
    resolved:false,
    resolutionStatus:null,
    recipients:[],
    recipientCount:0,
    multiRecipient:false,
    observedTeamCurrency0Delta:null,
    integerPartitionClean:null,
    physicalTargetIsEconomicRecipient:null,
  };
  if(!isCompletedGroundSoulEpisode(episode))return {...base,resolutionStatus:'INELIGIBLE_NONCOMPLETED_LIFECYCLE'};
  if(!episode?.targeted)return {...base,resolutionStatus:'UNRESOLVED_TARGETLESS_LIFECYCLE'};
  if(!isIsolatedGroundSoulTermination(episode,episodes,radius))return {...base,resolutionStatus:'UNRESOLVED_NONISOLATED_TERMINATION'};
  if(base.team===null)return {...base,resolutionStatus:'UNRESOLVED_MISSING_ASSIGNED_GOLD_TEAM'};

  const matching=(currencyDeltas??[]).filter(d=>
    integer(d?.tick)===base.resolutionTick &&
    integer(d?.team)===base.team &&
    finite(d?.delta)!==null && finite(d.delta)>0 &&
    integer(d?.pawnEntityIndex)!==null
  );
  const byPawn=new Map();
  for(const d of matching){
    const pawn=integer(d.pawnEntityIndex);let row=byPawn.get(pawn);
    if(!row){row={pawnEntityIndex:pawn,playerName:d.playerName??null,steamId:d.steamId??null,heroId:integer(d.heroId),team:integer(d.team),previousCurrency0:finite(d.previousCurrency0),currentCurrency0:finite(d.currentCurrency0),delta:0,tick:base.resolutionTick};byPawn.set(pawn,row);}
    row.delta+=finite(d.delta)??0;
    if(row.playerName==null&&d.playerName!=null)row.playerName=d.playerName;
    if(row.steamId==null&&d.steamId!=null)row.steamId=d.steamId;
    if(row.heroId==null)row.heroId=integer(d.heroId);
    if(row.previousCurrency0==null)row.previousCurrency0=finite(d.previousCurrency0);
    if(finite(d.currentCurrency0)!==null)row.currentCurrency0=finite(d.currentCurrency0);
  }
  const recipients=[...byPawn.values()].sort((a,b)=>a.pawnEntityIndex-b.pawnEntityIndex);
  if(!recipients.length)return {...base,resolutionStatus:'UNRESOLVED_NO_SAME_TEAM_POSITIVE_CURRENCY0_AT_TERMINATION'};

  const amounts=recipients.map(r=>r.delta);
  const total=amounts.reduce((s,v)=>s+v,0);
  const floorShare=Math.floor(total/recipients.length),ceilShare=Math.ceil(total/recipients.length);
  const integerPartitionClean=amounts.every(v=>Number.isInteger(v)&&(v===floorShare||v===ceilShare));
  if(!integerPartitionClean){
    return {...base,resolutionStatus:'UNRESOLVED_NONPARTITION_CLEAN_CURRENCY0_SET',recipients,recipientCount:recipients.length,multiRecipient:recipients.length>1,observedTeamCurrency0Delta:total,integerPartitionClean:false,physicalTargetIsEconomicRecipient:base.targetEntityIndex===null?null:recipients.some(r=>r.pawnEntityIndex===base.targetEntityIndex)};
  }

  return {...base,resolved:true,resolutionStatus:'RESOLVED_ISOLATED_TARGETED_EXACT_TICK_CURRENCY0',recipients,recipientCount:recipients.length,multiRecipient:recipients.length>1,observedTeamCurrency0Delta:total,integerPartitionClean:true,physicalTargetIsEconomicRecipient:base.targetEntityIndex===null?null:recipients.some(r=>r.pawnEntityIndex===base.targetEntityIndex)};
}

export function buildAssignedGoldEconomicCreditSummary(events=[]){
  const rows=[...(events??[])].sort((a,b)=>num(a.resolutionTick)-num(b.resolutionTick)||num(a.assignedGoldEntityIndex)-num(b.assignedGoldEntityIndex));
  const resolved=rows.filter(e=>e.resolved);
  const unresolved=rows.filter(e=>!e.resolved && String(e.resolutionStatus??'').startsWith('UNRESOLVED_'));
  const completed=rows.filter(e=>e.resolutionStatus!=='INELIGIBLE_NONCOMPLETED_LIFECYCLE');
  const isolatedTargetedCandidates=rows.filter(e=>['RESOLVED_ISOLATED_TARGETED_EXACT_TICK_CURRENCY0','UNRESOLVED_NO_SAME_TEAM_POSITIVE_CURRENCY0_AT_TERMINATION','UNRESOLVED_NONPARTITION_CLEAN_CURRENCY0_SET'].includes(e.resolutionStatus));
  const unresolvedCandidates=isolatedTargetedCandidates.filter(e=>!e.resolved);
  const recipientTransitions=resolved.reduce((n,e)=>n+(e.recipients?.length??0),0);
  const multi=resolved.filter(e=>e.multiRecipient);
  const statusCounts=countBy(rows,e=>e.resolutionStatus??'UNKNOWN');
  const recipientCountDistribution=countBy(resolved,e=>String(e.recipientCount??0));
  const byPlayer={};
  for(const e of resolved){
    for(const r of e.recipients??[]){
      const key=String(r.pawnEntityIndex);
      const out=byPlayer[key]??={pawnEntityIndex:r.pawnEntityIndex,playerName:r.playerName??null,steamId:r.steamId??null,heroId:r.heroId??null,team:r.team??null,creditEvents:0,observedRecipientTransitions:0,observedCurrency0DeltaTotal:0,cumulativeTimeline:[]};
      const delta=finite(r.delta)??0;
      out.creditEvents++;out.observedRecipientTransitions++;out.observedCurrency0DeltaTotal+=delta;
      out.cumulativeTimeline.push({matchTime:e.resolutionMatchTimeSeconds,tick:e.resolutionTick,delta,cumulativeCurrency0Delta:out.observedCurrency0DeltaTotal,creditEvents:out.creditEvents});
    }
  }
  const targetedResolved=resolved.filter(e=>e.targetEntityIndex!==null);
  const targetInSet=targetedResolved.filter(e=>e.physicalTargetIsEconomicRecipient===true).length;
  const cumulativeTimeline=[];let ev=0,tr=0;
  for(const e of resolved){ev++;tr+=e.recipientCount??0;cumulativeTimeline.push({matchTime:e.resolutionMatchTimeSeconds,tick:e.resolutionTick,resolvedCreditEvents:ev,recipientTransitions:tr});}
  return {
    candidateLifecycleEvents:rows.length,
    completedLifecycleEvents:completed.length,
    isolatedTargetedCandidates:isolatedTargetedCandidates.length,
    resolvedCreditEvents:resolved.length,
    unresolvedLifecycleEvents:unresolved.length,
    unresolvedCandidateEvents:unresolvedCandidates.length,
    resolutionShare:isolatedTargetedCandidates.length?resolved.length/isolatedTargetedCandidates.length:null,
    recipientTransitions,
    multiRecipientEvents:multi.length,
    multiRecipientShare:resolved.length?multi.length/resolved.length:null,
    recipientCountDistribution,
    resolutionStatusCounts:statusCounts,
    physicalTargetComparableResolvedEvents:targetedResolved.length,
    physicalTargetInRecipientSet:targetInSet,
    physicalTargetInRecipientSetShare:targetedResolved.length?targetInSet/targetedResolved.length:null,
    byPlayer:Object.values(byPlayer).sort((a,b)=>(b.creditEvents-a.creditEvents)||(a.pawnEntityIndex-b.pawnEntityIndex)),
    cumulativeTimeline,
  };
}

export function compareResolvedEconomicCreditKeys(productionEvents,researchCases){
  const key=e=>`${integer(e.resolutionTick??e.activeFalseTick??e.endTick)}:${integer(e.assignedGoldEntityIndex??e.pickupEntityIndex??e.entityIndex)}`;
  const a=new Set((productionEvents??[]).filter(e=>e.resolved!==false).map(key).filter(k=>!k.includes('null')));
  const b=new Set((researchCases??[]).map(key).filter(k=>!k.includes('null')));
  let matched=0;for(const k of a)if(b.has(k))matched++;
  return {production:a.size,research:b.size,matched,precision:a.size?matched/a.size:null,recall:b.size?matched/b.size:null,exact:a.size===b.size&&matched===a.size};
}

function sameEpisodeIdentity(a,b){
  if(a===b)return true;
  if(a?.activationId!=null&&b?.activationId!=null)return String(a.activationId)===String(b.activationId);
  return integer(a?.entityIndex)!==null&&integer(a?.entityIndex)===integer(b?.entityIndex)&&integer(a?.activationTick)!==null&&integer(a?.activationTick)===integer(b?.activationTick);
}
function countBy(rows,keyFn){const out={};for(const r of rows){const k=keyFn(r);out[k]=(out[k]??0)+1;}return out;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function integer(v){const n=Number(v);return Number.isInteger(n)?n:null;}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
