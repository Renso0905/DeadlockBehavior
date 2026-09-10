export const COLLISION_AUDIT_VERSION='GROUND_SOUL_COLLISION_RESOLUTION_AUDIT_V02';
export const DEFAULT_COLLISION_RADIUS_TICKS=16;

const NONISOLATED_STATUS='UNRESOLVED_NONISOLATED_TERMINATION';
const COUNTERFACTUAL_PASS='WOULD_PASS_NARROWER_SAME_TICK_SAME_TEAM_ISOLATION';

export function auditGroundSoulCollisionResolution({coverageRows=[],radiusTicks=DEFAULT_COLLISION_RADIUS_TICKS}={}){
  const radius=Math.max(0,Math.trunc(Number(radiusTicks)||0));
  const allRows=[...(coverageRows??[])];
  const completed=allRows.filter(r=>Boolean(r?.lifecycleCompleted)&&integer(r?.resolutionTick)!==null);
  const clusterResult=buildCollisionClusters(completed,{radiusTicks:radius});
  const rows=allRows.filter(r=>r?.resolutionStatus===NONISOLATED_STATUS).map(source=>{
    const row=classifyCollisionRow(source,completed,{radiusTicks:radius});
    const cluster=clusterResult.clusterByKey.get(eventKey(source))??null;
    return {...row,cluster:cluster?compactCluster(cluster):null};
  }).sort((a,b)=>num(a.resolutionTick)-num(b.resolutionTick)||num(a.assignedGoldEntityIndex)-num(b.assignedGoldEntityIndex));
  return {rows,summary:buildCollisionSummary(rows,clusterResult.clusters,allRows,{radiusTicks:radius})};
}

export function classifyCollisionRow(source,completedRows=[],options={}){
  const radius=Math.max(0,Math.trunc(Number(options.radiusTicks??DEFAULT_COLLISION_RADIUS_TICKS)||0));
  const tick=integer(source?.resolutionTick);
  const team=integer(source?.team);
  const neighbors=(completedRows??[]).filter(other=>eventKey(other)!==eventKey(source)&&integer(other?.resolutionTick)!==null&&tick!==null&&Math.abs(integer(other.resolutionTick)-tick)<=radius);
  const sameTick=neighbors.filter(n=>integer(n.resolutionTick)===tick);
  const nearDifferentTick=neighbors.filter(n=>integer(n.resolutionTick)!==tick);
  const sameTickSameTeam=team===null?[]:sameTick.filter(n=>integer(n.team)===team);
  const sameTickOtherTeam=team===null?[]:sameTick.filter(n=>integer(n.team)!==null&&integer(n.team)!==team);
  const sameTickUnknownTeam=sameTick.filter(n=>integer(n.team)===null);
  const nearSameTeam=team===null?[]:nearDifferentTick.filter(n=>integer(n.team)===team);
  const nearOtherTeam=team===null?[]:nearDifferentTick.filter(n=>integer(n.team)!==null&&integer(n.team)!==team);
  const nearUnknownTeam=nearDifferentTick.filter(n=>integer(n.team)===null);

  const currency=evaluateExactTickCurrency(source);
  const counterfactualResult=evaluateNarrowerIsolation({team,sameTickSameTeamCount:sameTickSameTeam.length,currency});
  const targetIndex=integer(source?.targetEntityIndex);
  const targetInExactTickRecipientSet=targetIndex===null||!currency.contextComplete?null:currency.recipients.some(r=>integer(r.pawnEntityIndex)===targetIndex);

  return {
    schemaVersion:'ground_soul_collision_resolution_audit_event_v02',
    sourceActivationId:source?.activationId??null,
    assignedGoldEntityIndex:integer(source?.assignedGoldEntityIndex??source?.entityIndex),
    activationTick:integer(source?.activationTick),
    activationMatchTimeSeconds:finite(source?.activationMatchTimeSeconds),
    resolutionTick:tick,
    resolutionMatchTimeSeconds:finite(source?.resolutionMatchTimeSeconds),
    displayMatchTimeSeconds:finite(source?.displayMatchTimeSeconds)??finite(source?.resolutionMatchTimeSeconds)??finite(source?.activationMatchTimeSeconds),
    team,
    targeted:Boolean(source?.targeted),
    targetEntityIndex:targetIndex,
    sourceResolutionStatus:source?.resolutionStatus??null,
    collisionClass:collisionClass({team,sameTickSameTeam,sameTickOtherTeam,sameTickUnknownTeam,nearSameTeam,nearOtherTeam,nearUnknownTeam}),
    collisionDimensions:{
      radiusTicks:radius,
      totalNeighbors:neighbors.length,
      sameTickNeighbors:sameTick.length,
      sameTickSameTeamNeighbors:sameTickSameTeam.length,
      sameTickOtherTeamNeighbors:sameTickOtherTeam.length,
      sameTickUnknownTeamNeighbors:sameTickUnknownTeam.length,
      nearbyDifferentTickNeighbors:nearDifferentTick.length,
      nearbyDifferentTickSameTeamNeighbors:nearSameTeam.length,
      nearbyDifferentTickOtherTeamNeighbors:nearOtherTeam.length,
      nearbyDifferentTickUnknownTeamNeighbors:nearUnknownTeam.length,
      neighborResolutionTicks:[...new Set(neighbors.map(n=>integer(n.resolutionTick)).filter(x=>x!==null))].sort((a,b)=>a-b),
      neighbors:neighbors.map(n=>({...compactNeighbor(n),tickDelta:integer(n?.resolutionTick)===null||tick===null?null:integer(n.resolutionTick)-tick})),
    },
    exactTickCurrency:{
      available:currency.available,
      contextComplete:currency.contextComplete,
      rawSameTeamPositiveTransitions:currency.rawTransitionCount,
      groupedRecipientCount:currency.recipients.length,
      groupedRecipients:currency.recipients,
      observedSameTeamPositiveTotal:currency.total,
      integerPartitionClean:currency.integerPartitionClean,
      physicalTargetInRecipientSet:targetInExactTickRecipientSet,
    },
    counterfactualNarrowerIsolation:{
      rule:'Reject only when another completed AssignedGold lifecycle from the same team terminates on the exact same tick; retain the existing exact-tick, same-team, positive currency0, integer-partition requirements.',
      result:counterfactualResult,
      wouldPass:counterfactualResult===COUNTERFACTUAL_PASS,
      semanticBoundary:'Algorithmic counterfactual only. Passing this diagnostic does not establish semantic validity and does not promote the event into A-level economic attribution.',
    },
    trooperConcurrency:{
      semanticBoundary:'Trooper timing remains temporal context only; no source-death identity is asserted.',
      class:trooperConcurrencyClass(source?.trooperTimingContext),
      deathsNearActivation:integer(source?.trooperTimingContext?.deathsNearActivation)??0,
      sameTickDeathsAtActivation:integer(source?.trooperTimingContext?.sameTickDeathsAtActivation)??0,
      deathsNearResolution:integer(source?.trooperTimingContext?.deathsNearResolution)??0,
      sameTickDeathsAtResolution:integer(source?.trooperTimingContext?.sameTickDeathsAtResolution)??0,
      nearestActivationDeathTickDelta:integer(source?.trooperTimingContext?.nearestActivationDeathTickDelta),
      nearestResolutionDeathTickDelta:integer(source?.trooperTimingContext?.nearestResolutionDeathTickDelta),
    },
  };
}

export function buildCollisionClusters(completedRows=[],options={}){
  const radius=Math.max(0,Math.trunc(Number(options.radiusTicks??DEFAULT_COLLISION_RADIUS_TICKS)||0));
  const rows=[...(completedRows??[])].filter(r=>integer(r?.resolutionTick)!==null).sort((a,b)=>integer(a.resolutionTick)-integer(b.resolutionTick)||num(a.assignedGoldEntityIndex??a.entityIndex)-num(b.assignedGoldEntityIndex??b.entityIndex));
  const clusters=[];let current=[];let lastTick=null;
  const flush=()=>{if(!current.length)return;clusters.push(makeCluster(current,clusters.length+1));current=[];lastTick=null;};
  for(const row of rows){
    const tick=integer(row.resolutionTick);
    if(lastTick!==null&&tick-lastTick>radius)flush();
    current.push(row);lastTick=tick;
  }
  flush();
  const collisionClusters=clusters.filter(c=>c.memberCount>1);
  const clusterByKey=new Map();
  for(const c of clusters)for(const k of c.memberKeys)clusterByKey.set(k,c);
  return {clusters:collisionClusters,allClusters:clusters,clusterByKey};
}

export function nearestCollisionCases(rows=[],timeSeconds=0,limit=12,windowSeconds=null){
  const t=finite(timeSeconds)??0;const win=windowSeconds===null?null:Math.max(0,Number(windowSeconds)||0);
  return [...(rows??[])].map(r=>({...r,_distance:Math.abs((finite(r.displayMatchTimeSeconds)??0)-t)})).filter(r=>win===null||r._distance<=win).sort((a,b)=>a._distance-b._distance||num(a.resolutionTick)-num(b.resolutionTick)).slice(0,Math.max(1,Math.trunc(Number(limit)||12))).map(({_distance,...r})=>({...r,distanceFromFocusSeconds:_distance}));
}

export function buildCollisionSummary(rows=[],clusters=[],coverageRows=[],meta={}){
  const currentResolvedA=(coverageRows??[]).filter(r=>Boolean(r?.resolvedEconomicCredit)).length;
  const allLifecycle=(coverageRows??[]).length;
  const wouldPass=rows.filter(r=>r.counterfactualNarrowerIsolation?.wouldPass);
  const sameTickSameTeam=rows.filter(r=>(r.collisionDimensions?.sameTickSameTeamNeighbors??0)>0);
  const counterfactualCounts=countBy(rows,r=>r.counterfactualNarrowerIsolation?.result??'UNKNOWN');
  const collisionClassCounts=countBy(rows,r=>r.collisionClass??'UNKNOWN');
  const trooperConcurrencyCounts=countBy(rows,r=>r.trooperConcurrency?.class??'UNKNOWN');
  const relevantClusterIds=new Set(rows.map(r=>r.cluster?.clusterId).filter(Boolean));
  const relevantClusters=(clusters??[]).filter(c=>relevantClusterIds.has(c.clusterId));
  const clusterSizeDistribution=countBy(relevantClusters,c=>String(c.memberCount));
  const hypothetical=currentResolvedA+wouldPass.length;
  return {
    version:COLLISION_AUDIT_VERSION,
    authorityStatus:'B_DIAGNOSTIC',
    semanticScope:{
      supported:'Classifies why current nonisolated Ground Soul economic events collide, groups them into temporal collision clusters, and evaluates a narrower same-tick/same-team isolation rule as an algorithmic counterfactual.',
      notClaimed:['Counterfactual-pass events are authoritative','A narrower isolation rule is scientifically validated','Observed currency0 is definitively Ground Soul payout','Nearby Trooper death caused a Ground Soul','Melee last-hit identity','Flying Soul outcome','Exact reward formula','Exact share radius'],
    },
    radiusTicks:meta.radiusTicks??DEFAULT_COLLISION_RADIUS_TICKS,
    nonisolatedEvents:rows.length,
    collisionClusters:relevantClusters.length,
    collisionClassCounts,
    clusterSizeDistribution,
    counterfactualResultCounts:counterfactualCounts,
    counterfactualNarrowerIsolation:{
      wouldPassEvents:wouldPass.length,
      stillSameTickSameTeamAmbiguous:sameTickSameTeam.length,
      currentResolvedAEvents:currentResolvedA,
      hypotheticalResolvedIfAllCounterfactualPassesWereEventuallyValidated:hypothetical,
      hypotheticalResolvedShareOfAllLifecycle:allLifecycle?hypothetical/allLifecycle:null,
      semanticBoundary:'The hypothetical total is not an A count and must not be merged into the production ledger without independent semantic validation and replication.',
    },
    trooperConcurrencyCounts,
    exactTickCurrencyDiagnostics:{
      contextAvailable:rows.filter(r=>r.exactTickCurrency?.available).length,
      contextComplete:rows.filter(r=>r.exactTickCurrency?.contextComplete).length,
      withSameTeamPositiveCurrency:rows.filter(r=>(r.exactTickCurrency?.rawSameTeamPositiveTransitions??0)>0).length,
      partitionClean:rows.filter(r=>r.exactTickCurrency?.integerPartitionClean===true).length,
      targetInRecipientSet:rows.filter(r=>r.exactTickCurrency?.physicalTargetInRecipientSet===true).length,
      targetNotInRecipientSet:rows.filter(r=>r.exactTickCurrency?.physicalTargetInRecipientSet===false).length,
    },
    timeline:rows.map(r=>({
      matchTime:r.displayMatchTimeSeconds,resolutionTick:r.resolutionTick,activationTick:r.activationTick,activationId:r.sourceActivationId,entityIndex:r.assignedGoldEntityIndex,team:r.team,
      collisionClass:r.collisionClass,clusterId:r.cluster?.clusterId??null,totalNeighbors:r.collisionDimensions?.totalNeighbors??0,sameTickSameTeamNeighbors:r.collisionDimensions?.sameTickSameTeamNeighbors??0,sameTickOtherTeamNeighbors:r.collisionDimensions?.sameTickOtherTeamNeighbors??0,nearbyDifferentTickSameTeamNeighbors:r.collisionDimensions?.nearbyDifferentTickSameTeamNeighbors??0,
      exactTickSameTeamPositiveTransitions:r.exactTickCurrency?.rawSameTeamPositiveTransitions??null,exactTickSameTeamPositiveTotal:r.exactTickCurrency?.observedSameTeamPositiveTotal??null,integerPartitionClean:r.exactTickCurrency?.integerPartitionClean??null,
      counterfactualResult:r.counterfactualNarrowerIsolation?.result??null,counterfactualWouldPass:Boolean(r.counterfactualNarrowerIsolation?.wouldPass),trooperConcurrencyClass:r.trooperConcurrency?.class??null,sameTickTrooperDeathsAtActivation:r.trooperConcurrency?.sameTickDeathsAtActivation??0,trooperDeathsNearActivation:r.trooperConcurrency?.deathsNearActivation??0,
    })),
    clusters:relevantClusters.map(compactCluster),
  };
}

function evaluateExactTickCurrency(source){
  const ctx=source?.currencyContext??{};
  if(!ctx.available)return {available:false,contextComplete:false,rawTransitionCount:0,recipients:[],total:null,integerPartitionClean:null};
  const rawCount=Math.max(0,integer(ctx.exactTickSameTeamPositiveTransitions)??0);
  const raw=Array.isArray(ctx.exactTickSameTeamRecipients)?ctx.exactTickSameTeamRecipients:[];
  const contextComplete=raw.length===rawCount;
  const byPawn=new Map();
  for(const d of raw){
    const pawn=integer(d?.pawnEntityIndex);const delta=finite(d?.delta);if(pawn===null||delta===null||delta<=0)continue;
    let row=byPawn.get(pawn);if(!row){row={pawnEntityIndex:pawn,playerName:d?.playerName??null,steamId:d?.steamId??null,heroId:integer(d?.heroId),team:integer(d?.team),delta:0};byPawn.set(pawn,row);}row.delta+=delta;
  }
  const recipients=[...byPawn.values()].sort((a,b)=>a.pawnEntityIndex-b.pawnEntityIndex);
  const total=recipients.reduce((n,r)=>n+r.delta,0);
  let clean=null;
  if(contextComplete&&recipients.length){
    const floor=Math.floor(total/recipients.length),ceil=Math.ceil(total/recipients.length);
    clean=recipients.every(r=>Number.isInteger(r.delta)&&(r.delta===floor||r.delta===ceil));
  }else if(contextComplete&&rawCount===0)clean=false;
  return {available:true,contextComplete,rawTransitionCount:rawCount,recipients,total,integerPartitionClean:clean};
}

function evaluateNarrowerIsolation({team,sameTickSameTeamCount,currency}){
  if(team===null)return 'MISSING_ASSIGNED_GOLD_TEAM';
  if(sameTickSameTeamCount>0)return 'STILL_AMBIGUOUS_SAME_TICK_SAME_TEAM';
  if(!currency.available)return 'CURRENCY_CONTEXT_UNAVAILABLE';
  if(!currency.contextComplete)return 'CURRENCY_CONTEXT_TRUNCATED';
  if(currency.rawTransitionCount<=0)return 'NO_EXACT_TICK_SAME_TEAM_CURRENCY';
  if(currency.integerPartitionClean!==true)return 'NONPARTITION_CLEAN_EXACT_TICK_CURRENCY';
  return COUNTERFACTUAL_PASS;
}

function collisionClass(x){
  if(x.team===null)return 'UNKNOWN_EVENT_TEAM';
  if(x.sameTickSameTeam.length&&x.sameTickOtherTeam.length)return 'SAME_TICK_MIXED_TEAM_WITH_SAME_TEAM_COLLISION';
  if(x.sameTickSameTeam.length)return 'SAME_TICK_SAME_TEAM_COLLISION';
  if(x.sameTickOtherTeam.length&&x.nearSameTeam.length)return 'SAME_TICK_OTHER_TEAM_PLUS_NEARBY_SAME_TEAM';
  if(x.sameTickOtherTeam.length)return 'SAME_TICK_OTHER_TEAM_ONLY';
  if(x.sameTickUnknownTeam.length)return 'SAME_TICK_UNKNOWN_TEAM_COLLISION';
  if(x.nearSameTeam.length&&x.nearOtherTeam.length)return 'NEARBY_DIFFERENT_TICK_MIXED_TEAM';
  if(x.nearSameTeam.length)return 'NEARBY_DIFFERENT_TICK_SAME_TEAM';
  if(x.nearOtherTeam.length)return 'NEARBY_DIFFERENT_TICK_OTHER_TEAM_ONLY';
  if(x.nearUnknownTeam.length)return 'NEARBY_DIFFERENT_TICK_UNKNOWN_TEAM';
  return 'UNCLASSIFIED_NONISOLATED';
}

function trooperConcurrencyClass(ctx){
  const sameA=integer(ctx?.sameTickDeathsAtActivation)??0,nearA=integer(ctx?.deathsNearActivation)??0;
  const sameR=integer(ctx?.sameTickDeathsAtResolution)??0,nearR=integer(ctx?.deathsNearResolution)??0;
  if(sameA>=2)return 'MULTIPLE_SAME_TICK_TROOPER_DEATHS_AT_ACTIVATION';
  if(sameR>=2)return 'MULTIPLE_SAME_TICK_TROOPER_DEATHS_AT_RESOLUTION';
  if(nearA>=2)return 'MULTIPLE_NEARBY_TROOPER_DEATHS_AT_ACTIVATION';
  if(nearR>=2)return 'MULTIPLE_NEARBY_TROOPER_DEATHS_AT_RESOLUTION';
  if(nearA===1||nearR===1)return 'SINGLE_NEARBY_TROOPER_DEATH';
  return 'NO_NEARBY_TROOPER_DEATH';
}

function makeCluster(rows,index){
  const ticks=rows.map(r=>integer(r.resolutionTick)).filter(x=>x!==null);const start=Math.min(...ticks),end=Math.max(...ticks);
  const tickCounts=countBy(rows,r=>String(integer(r.resolutionTick)));
  const teamCounts=countBy(rows,r=>String(integer(r.team)??'UNKNOWN'));
  const statusCounts=countBy(rows,r=>String(r.resolutionStatus??'UNKNOWN'));
  return {
    clusterId:`collision-${String(index).padStart(4,'0')}-${start}-${end}`,
    startTick:start,endTick:end,spanTicks:end-start,
    memberCount:rows.length,
    uniqueResolutionTicks:Object.keys(tickCounts).length,
    maxSameTickMultiplicity:Math.max(...Object.values(tickCounts)),
    teamCounts,statusCounts,
    targetedMembers:rows.filter(r=>Boolean(r.targeted)).length,
    nonisolatedMembers:rows.filter(r=>r.resolutionStatus===NONISOLATED_STATUS).length,
    memberKeys:rows.map(eventKey),
    members:rows.map(r=>({activationId:r?.activationId??null,assignedGoldEntityIndex:integer(r?.assignedGoldEntityIndex??r?.entityIndex),team:integer(r?.team),targeted:Boolean(r?.targeted),resolutionTick:integer(r?.resolutionTick),resolutionMatchTimeSeconds:finite(r?.resolutionMatchTimeSeconds),resolutionStatus:r?.resolutionStatus??null})),
  };
}

function compactCluster(c){return {clusterId:c.clusterId,startTick:c.startTick,endTick:c.endTick,spanTicks:c.spanTicks,memberCount:c.memberCount,uniqueResolutionTicks:c.uniqueResolutionTicks,maxSameTickMultiplicity:c.maxSameTickMultiplicity,teamCounts:c.teamCounts,statusCounts:c.statusCounts,targetedMembers:c.targetedMembers,nonisolatedMembers:c.nonisolatedMembers};}
function compactNeighbor(n){return {activationId:n?.activationId??null,assignedGoldEntityIndex:integer(n?.assignedGoldEntityIndex??n?.entityIndex),team:integer(n?.team),targeted:Boolean(n?.targeted),targetEntityIndex:integer(n?.targetEntityIndex),resolutionTick:integer(n?.resolutionTick),resolutionMatchTimeSeconds:finite(n?.resolutionMatchTimeSeconds),tickDelta:null};}
function eventKey(e){if(e?.activationId!=null)return `id:${String(e.activationId)}`;return `fallback:${integer(e?.assignedGoldEntityIndex??e?.entityIndex)}:${integer(e?.activationTick)}`;}
function countBy(rows,keyFn){const out={};for(const r of rows??[]){const k=String(keyFn(r)??'UNKNOWN');out[k]=(out[k]??0)+1;}return out;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function integer(v){const n=Number(v);return Number.isInteger(n)?n:null;}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
