export const ECONOMIC_COVERAGE_AUDIT_VERSION='GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_V01';
export const DEFAULT_AUDIT_RADIUS_TICKS=16;

const CANDIDATE_STATUSES=new Set([
  'RESOLVED_ISOLATED_TARGETED_EXACT_TICK_CURRENCY0',
  'UNRESOLVED_NO_SAME_TEAM_POSITIVE_CURRENCY0_AT_TERMINATION',
  'UNRESOLVED_NONPARTITION_CLEAN_CURRENCY0_SET',
]);

export function auditGroundSoulEconomicCoverage({episodes=[],economicEvents=[],currencyDeltas=null,trooperDeaths=[],radiusTicks=DEFAULT_AUDIT_RADIUS_TICKS}={}){
  const radius=Math.max(0,Math.trunc(Number(radiusTicks)||0));
  const economicsByKey=new Map();
  for(const e of economicEvents??[]) economicsByKey.set(eventKey(e),e);
  const completed=(episodes??[]).filter(isCompleted).slice().sort((a,b)=>num(a.endTick)-num(b.endTick)||num(a.entityIndex)-num(b.entityIndex));
  const currencyByTick=currencyDeltas===null?null:groupByTick(currencyDeltas);
  const troopersByTick=groupByTick(trooperDeaths??[]);
  const rows=[];
  for(const episode of episodes??[]){
    const econ=economicsByKey.get(eventKey(episode))??null;
    const endTick=integer(episode?.endTick);
    const team=integer(episode?.team);
    const collisions=endTick===null?[]:completed.filter(other=>eventKey(other)!==eventKey(episode)&&Math.abs(num(other.endTick)-endTick)<=radius);
    const exactCurrency=endTick===null||currencyByTick===null?null:(currencyByTick.get(endTick)??[]);
    const exactSameTeam=exactCurrency===null?null:exactCurrency.filter(x=>team!==null&&integer(x?.team)===team);
    const nearbyCurrency=endTick===null||currencyByTick===null?null:rowsInTickWindow(currencyByTick,endTick,radius);
    const nearbySameTeam=nearbyCurrency===null?null:nearbyCurrency.filter(x=>team!==null&&integer(x?.team)===team);
    const activationTick=integer(episode?.activationTick);
    const trooperNearActivation=activationTick===null?[]:rowsInTickWindow(troopersByTick,activationTick,radius);
    const trooperNearResolution=endTick===null?[]:rowsInTickWindow(troopersByTick,endTick,radius);
    const status=econ?.resolutionStatus??'MISSING_ECONOMIC_RESOLUTION_ROW';
    const stage=exclusionStage(status);
    const displayTime=finite(episode?.endMatchTimeSeconds)??finite(episode?.activationMatchTimeSeconds);
    rows.push({
      schemaVersion:'ground_soul_economic_coverage_audit_event_v01',
      activationId:episode?.activationId??null,
      assignedGoldEntityIndex:integer(episode?.entityIndex),
      activationTick,
      activationMatchTimeSeconds:finite(episode?.activationMatchTimeSeconds),
      resolutionTick:endTick,
      resolutionMatchTimeSeconds:finite(episode?.endMatchTimeSeconds),
      displayMatchTimeSeconds:displayTime,
      team,
      targeted:Boolean(episode?.targeted),
      targetEntityIndex:integer(episode?.targetEntityIndex),
      finalized:Boolean(episode?.finalized),
      censored:Boolean(episode?.censored),
      endReason:episode?.endReason??null,
      durationSeconds:finite(episode?.durationSeconds),
      lifecycleCompleted:isCompleted(episode),
      independentlyIsolatedTermination:collisions.length===0,
      currentResolverCandidate:CANDIDATE_STATUSES.has(status),
      resolvedEconomicCredit:Boolean(econ?.resolved),
      resolutionStatus:status,
      exclusionStage:stage,
      exclusionReason:reasonText(status,radius),
      collisionContext:{
        radiusTicks:radius,
        neighboringCompletedAssignedGoldTerminations:collisions.length,
        sameTickCompletedAssignedGoldTerminations:collisions.filter(x=>integer(x?.endTick)===endTick).length,
        neighbors:collisions.slice(0,12).map(x=>({
          activationId:x?.activationId??null,
          assignedGoldEntityIndex:integer(x?.entityIndex),
          team:integer(x?.team),
          targeted:Boolean(x?.targeted),
          targetEntityIndex:integer(x?.targetEntityIndex),
          resolutionTick:integer(x?.endTick),
          resolutionMatchTimeSeconds:finite(x?.endMatchTimeSeconds),
          tickDelta:integer(x?.endTick)===null||endTick===null?null:integer(x.endTick)-endTick,
        })),
      },
      currencyContext:currencyByTick===null?{available:false}:{
        available:true,
        exactTickPositiveTransitions:exactCurrency.length,
        exactTickPositiveTotal:sum(exactCurrency,x=>finite(x?.delta)??0),
        exactTickSameTeamPositiveTransitions:exactSameTeam.length,
        exactTickSameTeamPositiveTotal:sum(exactSameTeam,x=>finite(x?.delta)??0),
        nearbyPositiveTransitions:nearbyCurrency.length,
        nearbySameTeamPositiveTransitions:nearbySameTeam.length,
        exactTickSameTeamRecipients:exactSameTeam.slice(0,12).map(compactCurrency),
      },
      trooperTimingContext:{
        semanticBoundary:'Temporal proximity only; these are not asserted source-death matches.',
        radiusTicks:radius,
        deathsNearActivation:trooperNearActivation.length,
        sameTickDeathsAtActivation:activationTick===null?0:trooperNearActivation.filter(x=>integer(x?.tick)===activationTick).length,
        deathsNearResolution:trooperNearResolution.length,
        sameTickDeathsAtResolution:endTick===null?0:trooperNearResolution.filter(x=>integer(x?.tick)===endTick).length,
        nearestActivationDeathTickDelta:nearestTickDelta(trooperNearActivation,activationTick),
        nearestResolutionDeathTickDelta:nearestTickDelta(trooperNearResolution,endTick),
      },
      authoritativeEconomicEvent:econ?{
        resolved:Boolean(econ.resolved),
        recipientCount:integer(econ.recipientCount)??0,
        observedTeamCurrency0Delta:finite(econ.observedTeamCurrency0Delta),
        integerPartitionClean:econ.integerPartitionClean??null,
        physicalTargetIsEconomicRecipient:econ.physicalTargetIsEconomicRecipient??null,
      }:null,
    });
  }
  rows.sort((a,b)=>num(a.activationTick)-num(b.activationTick)||num(a.assignedGoldEntityIndex)-num(b.assignedGoldEntityIndex));
  return {rows,summary:buildCoverageSummary(rows,economicEvents,{currencyAvailable:currencyByTick!==null,radiusTicks:radius})};
}

export function buildCoverageSummary(rows=[],economicEvents=[],meta={}){
  const resolved=rows.filter(r=>r.resolvedEconomicCredit);
  const unresolved=rows.filter(r=>!r.resolvedEconomicCredit);
  const candidates=rows.filter(r=>r.currentResolverCandidate);
  const statusCounts=countBy(rows,r=>r.resolutionStatus);
  const stageCounts=countBy(unresolved,r=>r.exclusionStage);
  const nonisolated=rows.filter(r=>r.resolutionStatus==='UNRESOLVED_NONISOLATED_TERMINATION');
  const missingRows=rows.filter(r=>r.resolutionStatus==='MISSING_ECONOMIC_RESOLUTION_ROW');
  const timeline=[];
  let activations=0,completed=0,targetedCompleted=0,isolatedTargeted=0,candidateCount=0,resolvedCount=0,excluded=0;
  for(const r of rows){
    activations++;
    if(r.lifecycleCompleted)completed++;
    if(r.lifecycleCompleted&&r.targeted)targetedCompleted++;
    if(r.lifecycleCompleted&&r.targeted&&r.independentlyIsolatedTermination)isolatedTargeted++;
    if(r.currentResolverCandidate)candidateCount++;
    if(r.resolvedEconomicCredit)resolvedCount++;else excluded++;
    timeline.push({
      matchTime:r.activationMatchTimeSeconds,
      tick:r.activationTick,
      activations,completedLifecycle:completed,targetedCompletedLifecycle:targetedCompleted,
      independentlyIsolatedTargetedLifecycle:isolatedTargeted,currentResolverCandidates:candidateCount,
      resolvedEconomicCredit:resolvedCount,notResolved:excluded,
    });
  }
  const unresolvedTimeline=unresolved.map(r=>({
    matchTime:r.displayMatchTimeSeconds,
    activationMatchTimeSeconds:r.activationMatchTimeSeconds,
    resolutionMatchTimeSeconds:r.resolutionMatchTimeSeconds,
    activationTick:r.activationTick,
    resolutionTick:r.resolutionTick,
    activationId:r.activationId,
    entityIndex:r.assignedGoldEntityIndex,
    resolutionStatus:r.resolutionStatus,
    exclusionStage:r.exclusionStage,
    collisionCount:r.collisionContext?.neighboringCompletedAssignedGoldTerminations??0,
    sameTickCollisionCount:r.collisionContext?.sameTickCompletedAssignedGoldTerminations??0,
    exactTickSameTeamPositiveTransitions:r.currencyContext?.available?r.currencyContext.exactTickSameTeamPositiveTransitions:null,
    exactTickSameTeamPositiveTotal:r.currencyContext?.available?r.currencyContext.exactTickSameTeamPositiveTotal:null,
    trooperDeathsNearActivation:r.trooperTimingContext?.deathsNearActivation??0,
    trooperDeathsNearResolution:r.trooperTimingContext?.deathsNearResolution??0,
  })).sort((a,b)=>num(a.matchTime)-num(b.matchTime)||num(a.resolutionTick)-num(b.resolutionTick));
  const examplesByStatus={};
  for(const r of unresolved){
    const k=r.resolutionStatus;(examplesByStatus[k]??=[]);
    if(examplesByStatus[k].length<8)examplesByStatus[k].push(unresolvedTimeline.find(x=>x.activationId===r.activationId));
  }
  const economicEventKeys=new Set((economicEvents??[]).map(eventKey));
  const rowKeys=new Set(rows.map(eventKey));
  let orphanEconomicEvents=0;for(const k of economicEventKeys)if(!rowKeys.has(k))orphanEconomicEvents++;
  return {
    version:ECONOMIC_COVERAGE_AUDIT_VERSION,
    authorityStatus:'B_DIAGNOSTIC',
    semanticScope:{
      supported:'Describes how existing Ground Soul lifecycle rows pass through or are excluded by the current conservative economic-credit resolver, with temporal collision, direct currency-carrier, and nearby Trooper-death diagnostics.',
      notClaimed:['Unresolved means no reward','Nearby Trooper death caused the Ground Soul','Observed currency0 transition is necessarily a Ground Soul payout','Nonisolated events can be safely disambiguated','Melee last-hit identity','Flying Soul outcome','Exact Ground Soul share or vacuum radius'],
    },
    radiusTicks:meta.radiusTicks??DEFAULT_AUDIT_RADIUS_TICKS,
    currencyRescanAvailable:Boolean(meta.currencyAvailable),
    funnel:{
      lifecycleActivations:rows.length,
      completedLifecycle:rows.filter(r=>r.lifecycleCompleted).length,
      completedTargetedLifecycle:rows.filter(r=>r.lifecycleCompleted&&r.targeted).length,
      independentlyIsolatedCompletedTargetedLifecycle:rows.filter(r=>r.lifecycleCompleted&&r.targeted&&r.independentlyIsolatedTermination).length,
      currentResolverCandidates:candidates.length,
      resolvedEconomicCredit:resolved.length,
      notResolved:unresolved.length,
    },
    coverage:{
      resolvedShareOfAllLifecycle:rows.length?resolved.length/rows.length:null,
      resolvedShareOfCurrentResolverCandidates:candidates.length?resolved.length/candidates.length:null,
    },
    resolutionStatusCounts:statusCounts,
    exclusionStageCounts:stageCounts,
    collisionDiagnostics:{
      nonisolatedEvents:nonisolated.length,
      nonisolatedWithSameTickAssignedGoldCollision:nonisolated.filter(r=>(r.collisionContext?.sameTickCompletedAssignedGoldTerminations??0)>0).length,
      nonisolatedWithExactTickSameTeamPositiveCurrency:meta.currencyAvailable?nonisolated.filter(r=>(r.currencyContext?.exactTickSameTeamPositiveTransitions??0)>0).length:null,
      nonisolatedWithMultipleExactTickSameTeamPositiveCurrency:meta.currencyAvailable?nonisolated.filter(r=>(r.currencyContext?.exactTickSameTeamPositiveTransitions??0)>1).length:null,
      nonisolatedWithTwoOrMoreTrooperDeathsNearActivation:nonisolated.filter(r=>(r.trooperTimingContext?.deathsNearActivation??0)>=2).length,
      nonisolatedWithTwoOrMoreTrooperDeathsNearResolution:nonisolated.filter(r=>(r.trooperTimingContext?.deathsNearResolution??0)>=2).length,
    },
    integrity:{
      lifecycleRows:rows.length,
      economicRows:economicEventKeys.size,
      missingEconomicResolutionRows:missingRows.length,
      orphanEconomicResolutionRows:orphanEconomicEvents,
      eventKeySetsExact:missingRows.length===0&&orphanEconomicEvents===0,
    },
    timeline,
    unresolvedTimeline,
    examplesByStatus,
  };
}

export function exclusionStage(status){
  switch(String(status??'')){
    case 'RESOLVED_ISOLATED_TARGETED_EXACT_TICK_CURRENCY0': return 'RESOLVED';
    case 'INELIGIBLE_NONCOMPLETED_LIFECYCLE': return 'LIFECYCLE_COMPLETION';
    case 'UNRESOLVED_TARGETLESS_LIFECYCLE': return 'PHYSICAL_TARGET';
    case 'UNRESOLVED_NONISOLATED_TERMINATION': return 'TERMINATION_ISOLATION';
    case 'UNRESOLVED_MISSING_ASSIGNED_GOLD_TEAM': return 'TEAM_IDENTITY';
    case 'UNRESOLVED_NO_SAME_TEAM_POSITIVE_CURRENCY0_AT_TERMINATION': return 'EXACT_TICK_ECONOMY';
    case 'UNRESOLVED_NONPARTITION_CLEAN_CURRENCY0_SET': return 'PARTITION_CLEANLINESS';
    case 'MISSING_ECONOMIC_RESOLUTION_ROW': return 'INTEGRITY_JOIN';
    default:return 'OTHER';
  }
}

export function reasonText(status,radiusTicks=DEFAULT_AUDIT_RADIUS_TICKS){
  switch(String(status??'')){
    case 'RESOLVED_ISOLATED_TARGETED_EXACT_TICK_CURRENCY0': return 'Passed the current conservative resolver and entered the authoritative economic-credit set.';
    case 'INELIGIBLE_NONCOMPLETED_LIFECYCLE': return 'Lifecycle did not complete through the validated active-to-inactive termination path; censored/replay-end episodes are not forced into economy attribution.';
    case 'UNRESOLVED_TARGETLESS_LIFECYCLE': return 'Completed lifecycle never acquired a physical vacuum target.';
    case 'UNRESOLVED_NONISOLATED_TERMINATION': return `Another completed AssignedGold termination occurred within ±${radiusTicks} ticks, so exact-tick economic credit is not uniquely attributable to this lifecycle.`;
    case 'UNRESOLVED_MISSING_ASSIGNED_GOLD_TEAM': return 'AssignedGold team identity was unavailable at resolution.';
    case 'UNRESOLVED_NO_SAME_TEAM_POSITIVE_CURRENCY0_AT_TERMINATION': return 'No same-team positive m_nCurrencies.0000 transition was observed on the exact termination tick.';
    case 'UNRESOLVED_NONPARTITION_CLEAN_CURRENCY0_SET': return 'Same-team positive exact-tick currency0 transitions were present, but the observed set did not satisfy the current clean integer-partition filter.';
    case 'MISSING_ECONOMIC_RESOLUTION_ROW': return 'No matching row was found in the authoritative economic-resolution event stream; treat as an integrity problem, not a gameplay conclusion.';
    default:return 'Resolver status is not yet classified by this audit.';
  }
}

function isCompleted(e){return Boolean(e?.finalized)&&!e?.censored&&e?.endReason==='BECAME_INACTIVE'&&integer(e?.endTick)!==null;}
function eventKey(e){
  if(e?.activationId!=null)return `id:${String(e.activationId)}`;
  const entity=integer(e?.assignedGoldEntityIndex??e?.entityIndex),tick=integer(e?.activationTick);
  return `fallback:${entity}:${tick}`;
}
function groupByTick(rows){const m=new Map();for(const r of rows??[]){const t=integer(r?.tick);if(t===null)continue;(m.get(t)??m.set(t,[]).get(t)).push(r);}return m;}
function rowsInTickWindow(map,tick,radius){if(!map||tick===null)return null;const out=[];for(let t=tick-radius;t<=tick+radius;t++)for(const r of map.get(t)??[])out.push(r);return out;}
function compactCurrency(x){return {tick:integer(x?.tick),pawnEntityIndex:integer(x?.pawnEntityIndex),playerName:x?.playerName??null,steamId:x?.steamId??null,heroId:integer(x?.heroId),team:integer(x?.team),delta:finite(x?.delta),previousCurrency0:finite(x?.previousCurrency0),currentCurrency0:finite(x?.currentCurrency0)};}
function nearestTickDelta(rows,tick){if(tick===null||!rows?.length)return null;let best=null;for(const r of rows){const t=integer(r?.tick);if(t===null)continue;const d=t-tick;if(best===null||Math.abs(d)<Math.abs(best))best=d;}return best;}
function countBy(rows,keyFn){const out={};for(const r of rows??[]){const k=String(keyFn(r)??'UNKNOWN');out[k]=(out[k]??0)+1;}return out;}
function sum(rows,fn){let n=0;for(const r of rows??[])n+=Number(fn(r))||0;return n;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function integer(v){const n=Number(v);return Number.isInteger(n)?n:null;}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
