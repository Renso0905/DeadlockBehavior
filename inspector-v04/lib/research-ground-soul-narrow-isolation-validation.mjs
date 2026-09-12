export const NARROW_ISOLATION_VALIDATION_VERSION='GROUND_SOUL_NARROW_ISOLATION_VALIDATION_V03';
export const DEFAULT_RADIUS_SWEEP=[0,1,2,4,8,16];

const V02_PASS='WOULD_PASS_NARROWER_SAME_TICK_SAME_TEAM_ISOLATION';
const CURRENT_A_STATUS='RESOLVED_ISOLATED_TARGETED_EXACT_TICK_CURRENCY0';

export function validateNarrowIsolationReplay({
  replayName=null,
  coverageRows=[],
  collisionRows=[],
  coverageSummary=null,
  collisionSummary=null,
  radiusSweep=DEFAULT_RADIUS_SWEEP,
}={}){
  const radii=normalizeRadii(radiusSweep);
  const aRows=(coverageRows??[]).filter(r=>r?.resolvedEconomicCredit===true);
  const nonisolated=(coverageRows??[]).filter(r=>r?.resolutionStatus==='UNRESOLVED_NONISOLATED_TERMINATION');
  const recomputedPass=(collisionRows??[]).filter(row=>passesSameTeamRadius(row,0));
  const declaredPass=(collisionRows??[]).filter(row=>row?.counterfactualNarrowerIsolation?.wouldPass===true);

  const currentA=Number(collisionSummary?.counterfactualNarrowerIsolation?.currentResolvedAEvents ?? coverageSummary?.funnel?.resolvedEconomicCredit ?? aRows.length);
  const sourceNonisolated=Number(collisionSummary?.nonisolatedEvents ?? coverageSummary?.collisionDiagnostics?.nonisolatedEvents ?? nonisolated.length);
  const sourceDeclaredPass=Number(collisionSummary?.counterfactualNarrowerIsolation?.wouldPassEvents ?? declaredPass.length);

  const acceptedCurrent=aRows.map(normalizeCoverageResolved).filter(Boolean);
  const recoveredExact=recomputedPass.map(normalizeCollisionRecovered).filter(Boolean);
  const combined=[...acceptedCurrent,...recoveredExact];

  const boundaryReuse=duplicates(combined.map(r=>`${r.team}:${r.resolutionTick}`));
  const transitionRows=combined.flatMap(r=>(r.recipients??[]).map(x=>({
    source:r.source,
    activationId:r.activationId,
    team:r.team,
    resolutionTick:r.resolutionTick,
    pawnEntityIndex:x.pawnEntityIndex,
    delta:x.delta,
    key:`${r.team}:${r.resolutionTick}:${x.pawnEntityIndex}`,
  })));
  const transitionReuse=duplicates(transitionRows.map(r=>r.key));

  const radiusSweepRows=radii.map(radius=>{
    const recovered=(collisionRows??[]).filter(row=>passesSameTeamRadius(row,radius));
    return {
      sameTeamIsolationRadiusTicks:radius,
      recoveredFromCurrentNonisolated:recovered.length,
      hypotheticalResolvedTotal:currentA+recovered.length,
      recoveredShareOfNonisolated:sourceNonisolated?recovered.length/sourceNonisolated:null,
      totalShareOfLifecycle:Number(coverageSummary?.funnel?.lifecycleActivations)>0?(currentA+recovered.length)/Number(coverageSummary.funnel.lifecycleActivations):null,
    };
  });

  const currentAIntegrity={
    rows:aRows.length,
    statusMismatch:aRows.filter(r=>r?.resolutionStatus!==CURRENT_A_STATUS).length,
    unavailableCurrencyContext:aRows.filter(r=>r?.currencyContext?.available!==true).length,
    noSameTeamPositiveCurrency:aRows.filter(r=>Number(r?.currencyContext?.exactTickSameTeamPositiveTransitions??0)<=0).length,
    nonPartitionClean:aRows.filter(r=>partitionCleanFromCoverage(r)!==true).length,
    sourceCollisionCountNonzero:aRows.filter(r=>Number(r?.collisionContext?.neighboringCompletedAssignedGoldTerminations??0)!==0).length,
  };

  const recoveredIntegrity={
    rows:recomputedPass.length,
    unavailableCurrencyContext:recomputedPass.filter(r=>r?.exactTickCurrency?.available!==true).length,
    truncatedCurrencyContext:recomputedPass.filter(r=>r?.exactTickCurrency?.contextComplete!==true).length,
    noSameTeamPositiveCurrency:recomputedPass.filter(r=>Number(r?.exactTickCurrency?.rawSameTeamPositiveTransitions??0)<=0).length,
    nonPartitionClean:recomputedPass.filter(r=>r?.exactTickCurrency?.integerPartitionClean!==true).length,
    sameTickSameTeamCollision:recomputedPass.filter(r=>Number(r?.collisionDimensions?.sameTickSameTeamNeighbors??0)>0).length,
  };

  const checks={
    coverageCollisionNonisolatedCountExact:check(collisionRows.length,sourceNonisolated,collisionRows.length===sourceNonisolated),
    coverageRowsContainSameNonisolatedCount:check(nonisolated.length,sourceNonisolated,nonisolated.length===sourceNonisolated),
    currentAEventCountExact:check(aRows.length,currentA,aRows.length===currentA),
    v02DeclaredPassCountExact:check(declaredPass.length,sourceDeclaredPass,declaredPass.length===sourceDeclaredPass),
    v03RecomputeMatchesV02PassSet:check([...keySet(recomputedPass)].sort(),[...keySet(declaredPass)].sort(),sameSet(keySet(recomputedPass),keySet(declaredPass))),
    currentARowsPreserveExactTickCurrencyContract:check(currentAIntegrity,'all zero failures',Object.entries(currentAIntegrity).filter(([k])=>k!=='rows').every(([,v])=>v===0)),
    recoveredRowsPreserveExactTickCurrencyContract:check(recoveredIntegrity,'all zero failures',Object.entries(recoveredIntegrity).filter(([k])=>k!=='rows').every(([,v])=>v===0)),
    noSameTeamResolutionBoundaryReuse:check(boundaryReuse.length,0,boundaryReuse.length===0),
    noRecipientTransitionReuse:check(transitionReuse.length,0,transitionReuse.length===0),
    radiusSweepMonotonic:check(radiusSweepRows.map(x=>x.recoveredFromCurrentNonisolated),'non-increasing',isNonIncreasing(radiusSweepRows.map(x=>x.recoveredFromCurrentNonisolated))),
    exactTickRadiusEqualsRecoveredCount:check(radiusSweepRows.find(x=>x.sameTeamIsolationRadiusTicks===0)?.recoveredFromCurrentNonisolated??null,recomputedPass.length,(radiusSweepRows.find(x=>x.sameTeamIsolationRadiusTicks===0)?.recoveredFromCurrentNonisolated??null)===recomputedPass.length),
  };
  const failedChecks=Object.entries(checks).filter(([,v])=>!v.pass).map(([k])=>k);

  const minSameTeamDistanceBuckets=countBy(collisionRows,row=>distanceBucket(minSameTeamNeighborDistance(row)));
  const recoveredCollisionClasses=countBy(recomputedPass,row=>row?.collisionClass??'UNKNOWN');
  const recoveredTrooperContext=countBy(recomputedPass,row=>row?.trooperConcurrency?.class??'UNKNOWN');
  const recoveredTargetComparable=recomputedPass.filter(r=>r?.exactTickCurrency?.physicalTargetInRecipientSet!==null&&r?.exactTickCurrency?.physicalTargetInRecipientSet!==undefined);
  const recoveredTargetInSet=recoveredTargetComparable.filter(r=>r.exactTickCurrency.physicalTargetInRecipientSet===true).length;
  const currentATargetComparable=aRows.filter(r=>r?.authoritativeEconomicEvent?.physicalTargetIsEconomicRecipient!==null&&r?.authoritativeEconomicEvent?.physicalTargetIsEconomicRecipient!==undefined);
  const currentATargetInSet=currentATargetComparable.filter(r=>r.authoritativeEconomicEvent.physicalTargetIsEconomicRecipient===true).length;

  return {
    version:NARROW_ISOLATION_VALIDATION_VERSION,
    authorityStatus:'B_VALIDATION',
    replayName,
    semanticScope:{
      supported:'Validates the mechanical determinism of replacing the current all-event ±16-tick isolation gate with same-team isolation radii, while preserving the already-used exact-tick, same-team, positive currency0 and integer-partition requirements.',
      notClaimed:['Recovered events are A-level','Exact-tick same-team isolation is already production-authoritative','Observed currency0 is a canonical Ground Soul reward formula','Melee last-hit identity','Nearby Trooper death caused the Ground Soul','Flying Soul outcome','Exact reward or share-radius formula'],
    },
    sourceCounts:{
      lifecycleActivations:Number(coverageSummary?.funnel?.lifecycleActivations??coverageRows.length),
      currentResolvedAEvents:currentA,
      currentNonisolatedEvents:sourceNonisolated,
      v02DeclaredExactTickPassEvents:sourceDeclaredPass,
    },
    exactTickSameTeamRule:{
      recoveredEvents:recomputedPass.length,
      hypotheticalResolvedTotal:currentA+recomputedPass.length,
      hypotheticalResolvedShareOfLifecycle:Number(coverageSummary?.funnel?.lifecycleActivations)>0?(currentA+recomputedPass.length)/Number(coverageSummary.funnel.lifecycleActivations):null,
      combinedAcceptedEvents:combined.length,
      combinedRecipientTransitions:transitionRows.length,
      duplicateSameTeamResolutionBoundaryKeys:boundaryReuse,
      duplicateRecipientTransitionKeys:transitionReuse,
      recoveredCollisionClassCounts:recoveredCollisionClasses,
      recoveredTrooperConcurrencyCounts:recoveredTrooperContext,
      currentAPhysicalTargetInRecipientSetShare:currentATargetComparable.length?currentATargetInSet/currentATargetComparable.length:null,
      recoveredPhysicalTargetInRecipientSetShare:recoveredTargetComparable.length?recoveredTargetInSet/recoveredTargetComparable.length:null,
      semanticBoundary:'This is a validation candidate set only. The current 77/77 A ledger and current production resolver remain unchanged.',
    },
    sameTeamRadiusSweep:radiusSweepRows,
    nearestSameTeamTerminationDistanceBuckets:minSameTeamDistanceBuckets,
    integrity:{
      currentA:currentAIntegrity,
      recoveredExactTick:recoveredIntegrity,
      failedChecks,
      pass:failedChecks.length===0,
      checks,
    },
    recoveredEvents:recomputedPass.map(row=>({
      activationId:row?.sourceActivationId??null,
      assignedGoldEntityIndex:integer(row?.assignedGoldEntityIndex),
      activationTick:integer(row?.activationTick),
      resolutionTick:integer(row?.resolutionTick),
      resolutionMatchTimeSeconds:finite(row?.resolutionMatchTimeSeconds),
      team:integer(row?.team),
      collisionClass:row?.collisionClass??null,
      nearestSameTeamTerminationDistanceTicks:minSameTeamNeighborDistance(row),
      exactTickRecipientCount:Number(row?.exactTickCurrency?.groupedRecipientCount??0),
      observedSameTeamPositiveTotal:finite(row?.exactTickCurrency?.observedSameTeamPositiveTotal),
      physicalTargetInRecipientSet:row?.exactTickCurrency?.physicalTargetInRecipientSet??null,
      trooperConcurrencyClass:row?.trooperConcurrency?.class??null,
    })),
  };
}

export function buildNarrowIsolationCrossReplayValidation(replays=[],expectedReplayNames=['rep01','rep02','rep03','rep04','rep05']){
  const expected=[...expectedReplayNames];
  const byName=new Map((replays??[]).map(r=>[String(r.replayName),r]));
  const presentExpected=expected.filter(name=>byName.has(name));
  const missingExpected=expected.filter(name=>!byName.has(name));
  const selected=expected.map(name=>byName.get(name)).filter(Boolean);
  const allIntegrityPass=selected.length===expected.length&&selected.every(r=>r?.integrity?.pass===true);
  const aggregateRadiusSweep=DEFAULT_RADIUS_SWEEP.map(radius=>{
    const rows=selected.map(r=>r.sameTeamRadiusSweep?.find(x=>x.sameTeamIsolationRadiusTicks===radius)).filter(Boolean);
    const recovered=rows.reduce((n,x)=>n+Number(x.recoveredFromCurrentNonisolated||0),0);
    const currentA=selected.reduce((n,r)=>n+Number(r.sourceCounts?.currentResolvedAEvents||0),0);
    const lifecycle=selected.reduce((n,r)=>n+Number(r.sourceCounts?.lifecycleActivations||0),0);
    return {sameTeamIsolationRadiusTicks:radius,recoveredFromCurrentNonisolated:recovered,hypotheticalResolvedTotal:currentA+recovered,totalShareOfLifecycle:lifecycle?(currentA+recovered)/lifecycle:null};
  });
  const aggregate={
    lifecycleActivations:selected.reduce((n,r)=>n+Number(r.sourceCounts?.lifecycleActivations||0),0),
    currentResolvedAEvents:selected.reduce((n,r)=>n+Number(r.sourceCounts?.currentResolvedAEvents||0),0),
    currentNonisolatedEvents:selected.reduce((n,r)=>n+Number(r.sourceCounts?.currentNonisolatedEvents||0),0),
    exactTickRecoveredEvents:selected.reduce((n,r)=>n+Number(r.exactTickSameTeamRule?.recoveredEvents||0),0),
    exactTickHypotheticalResolvedTotal:selected.reduce((n,r)=>n+Number(r.exactTickSameTeamRule?.hypotheticalResolvedTotal||0),0),
    combinedRecipientTransitions:selected.reduce((n,r)=>n+Number(r.exactTickSameTeamRule?.combinedRecipientTransitions||0),0),
    duplicateSameTeamResolutionBoundaryKeys:selected.reduce((n,r)=>n+(r.exactTickSameTeamRule?.duplicateSameTeamResolutionBoundaryKeys?.length??0),0),
    duplicateRecipientTransitionKeys:selected.reduce((n,r)=>n+(r.exactTickSameTeamRule?.duplicateRecipientTransitionKeys?.length??0),0),
  };
  aggregate.exactTickHypotheticalResolvedShareOfLifecycle=aggregate.lifecycleActivations?aggregate.exactTickHypotheticalResolvedTotal/aggregate.lifecycleActivations:null;
  aggregate.exactTickRecoveryShareOfNonisolated=aggregate.currentNonisolatedEvents?aggregate.exactTickRecoveredEvents/aggregate.currentNonisolatedEvents:null;

  const recoveredObservedInEveryReplay=selected.length===expected.length&&selected.every(r=>Number(r?.exactTickSameTeamRule?.recoveredEvents??0)>0);
  const replicatedMechanicalSupport=missingExpected.length===0&&allIntegrityPass&&recoveredObservedInEveryReplay&&aggregate.duplicateSameTeamResolutionBoundaryKeys===0&&aggregate.duplicateRecipientTransitionKeys===0&&isNonIncreasing(aggregateRadiusSweep.map(x=>x.recoveredFromCurrentNonisolated));
  const checks={
    expectedReplicationCohortComplete:check(presentExpected,expected,missingExpected.length===0),
    everyReplayIntegrityPass:check(selected.filter(r=>r?.integrity?.pass===true).length,expected.length,allIntegrityPass),
    recoveredCandidateObservedInEveryReplay:check(selected.filter(r=>Number(r?.exactTickSameTeamRule?.recoveredEvents??0)>0).length,expected.length,recoveredObservedInEveryReplay),
    noSameTeamResolutionBoundaryReuseAcrossReplayLocalSets:check(aggregate.duplicateSameTeamResolutionBoundaryKeys,0,aggregate.duplicateSameTeamResolutionBoundaryKeys===0),
    noRecipientTransitionReuseAcrossReplayLocalSets:check(aggregate.duplicateRecipientTransitionKeys,0,aggregate.duplicateRecipientTransitionKeys===0),
    aggregateRadiusSweepMonotonic:check(aggregateRadiusSweep.map(x=>x.recoveredFromCurrentNonisolated),'non-increasing',isNonIncreasing(aggregateRadiusSweep.map(x=>x.recoveredFromCurrentNonisolated))),
  };
  return {
    version:NARROW_ISOLATION_VALIDATION_VERSION,
    status:replicatedMechanicalSupport?'GROUND_SOUL_NARROW_ISOLATION_VALIDATION_V03_READY':'GROUND_SOUL_NARROW_ISOLATION_VALIDATION_V03_INCOMPLETE',
    authorityLayer:'research_validation_B',
    validation:{
      integrityValidation:Object.values(checks).every(x=>x.pass)?'pass':'fail',
      semanticValidation:replicatedMechanicalSupport?'strong_support':'not_established',
      replicationStatus:replicatedMechanicalSupport?'cross_replay_supported_5_of_5':'incomplete',
      checks,
    },
    interpretation:{
      result:replicatedMechanicalSupport?'CROSS_REPLAY_MECHANICAL_SUPPORT_FOR_EXACT_TICK_SAME_TEAM_ISOLATION':'INSUFFICIENT_FOR_RULE_REVISION',
      productionRecommendation:replicatedMechanicalSupport?'candidate_for_production_resolver_review_not_promoted':'retain_current_production_resolver',
      semanticBoundary:'Even READY means the narrower isolation rule has cross-replay mechanical/semantic support within the existing exact-tick economic-carrier model. It does not itself change the production resolver or A ledger.',
    },
    cohort:{expectedReplayNames:expected,presentExpectedReplayNames:presentExpected,missingExpectedReplayNames:missingExpected,replayCount:selected.length},
    aggregate,
    aggregateSameTeamRadiusSweep:aggregateRadiusSweep,
    replayResults:selected.map(r=>compactReplay(r)),
    pooledNearestSameTeamTerminationDistanceBuckets:mergeCounts(selected.map(r=>r.nearestSameTeamTerminationDistanceBuckets??{})),
    pooledRecoveredCollisionClassCounts:mergeCounts(selected.map(r=>r.exactTickSameTeamRule?.recoveredCollisionClassCounts??{})),
  };
}

export function passesSameTeamRadius(row,radiusTicks=0){
  const radius=Math.max(0,Math.trunc(Number(radiusTicks)||0));
  const team=integer(row?.team);
  if(team===null)return false;
  if(row?.exactTickCurrency?.available!==true||row?.exactTickCurrency?.contextComplete!==true)return false;
  if(Number(row?.exactTickCurrency?.rawSameTeamPositiveTransitions??0)<=0)return false;
  if(row?.exactTickCurrency?.integerPartitionClean!==true)return false;
  for(const n of row?.collisionDimensions?.neighbors??[]){
    if(integer(n?.team)!==team)continue;
    const d=Math.abs(Number(n?.tickDelta));
    if(Number.isFinite(d)&&d<=radius)return false;
  }
  return true;
}

export function minSameTeamNeighborDistance(row){
  const team=integer(row?.team);if(team===null)return null;
  let best=null;
  for(const n of row?.collisionDimensions?.neighbors??[]){
    if(integer(n?.team)!==team)continue;
    const d=Math.abs(Number(n?.tickDelta));if(!Number.isFinite(d))continue;if(best===null||d<best)best=d;
  }
  return best;
}

function normalizeCoverageResolved(row){
  const team=integer(row?.team),tick=integer(row?.resolutionTick);if(team===null||tick===null)return null;
  const recipients=groupCoverageRecipients(row?.currencyContext?.exactTickSameTeamRecipients??[]);
  return {source:'CURRENT_A',activationId:row?.activationId??null,team,resolutionTick:tick,recipients};
}
function normalizeCollisionRecovered(row){
  const team=integer(row?.team),tick=integer(row?.resolutionTick);if(team===null||tick===null)return null;
  const recipients=(row?.exactTickCurrency?.groupedRecipients??[]).map(x=>({pawnEntityIndex:integer(x?.pawnEntityIndex),delta:finite(x?.delta)})).filter(x=>x.pawnEntityIndex!==null&&x.delta!==null);
  return {source:'V03_RECOVERED_CANDIDATE',activationId:row?.sourceActivationId??null,team,resolutionTick:tick,recipients};
}
function groupCoverageRecipients(raw){
  const byPawn=new Map();
  for(const x of raw??[]){const pawn=integer(x?.pawnEntityIndex),delta=finite(x?.delta);if(pawn===null||delta===null||delta<=0)continue;byPawn.set(pawn,(byPawn.get(pawn)??0)+delta);}
  return [...byPawn.entries()].map(([pawnEntityIndex,delta])=>({pawnEntityIndex,delta})).sort((a,b)=>a.pawnEntityIndex-b.pawnEntityIndex);
}
function partitionCleanFromCoverage(row){
  const rawCount=Number(row?.currencyContext?.exactTickSameTeamPositiveTransitions??0);const raw=row?.currencyContext?.exactTickSameTeamRecipients??[];
  if(row?.currencyContext?.available!==true||raw.length!==rawCount||rawCount<=0)return false;
  const recipients=groupCoverageRecipients(raw);if(!recipients.length)return false;
  const total=recipients.reduce((n,x)=>n+x.delta,0),floor=Math.floor(total/recipients.length),ceil=Math.ceil(total/recipients.length);
  return recipients.every(x=>Number.isInteger(x.delta)&&(x.delta===floor||x.delta===ceil));
}
function distanceBucket(d){if(d===null)return 'NO_SAME_TEAM_NEIGHBOR_WITHIN_SOURCE_RADIUS';if(d===0)return '0_TICKS';if(d===1)return '1_TICK';if(d===2)return '2_TICKS';if(d<=4)return '3_TO_4_TICKS';if(d<=8)return '5_TO_8_TICKS';return '9_TO_16_TICKS';}
function keySet(rows){return new Set((rows??[]).map(r=>String(r?.sourceActivationId??r?.activationId??`${r?.assignedGoldEntityIndex}:${r?.activationTick}`)));}
function sameSet(a,b){if(a.size!==b.size)return false;for(const x of a)if(!b.has(x))return false;return true;}
function duplicates(keys){const seen=new Set(),dup=new Set();for(const key of keys){if(seen.has(key))dup.add(key);seen.add(key);}return [...dup].sort();}
function normalizeRadii(values){const out=[...new Set((values??DEFAULT_RADIUS_SWEEP).map(x=>Math.max(0,Math.trunc(Number(x)||0))))].sort((a,b)=>a-b);if(!out.includes(0))out.unshift(0);return out;}
function isNonIncreasing(values){for(let i=1;i<values.length;i++)if(Number(values[i])>Number(values[i-1]))return false;return true;}
function compactReplay(r){return {replayName:r.replayName,integrityPass:r.integrity?.pass===true,sourceCounts:r.sourceCounts,exactTickSameTeamRule:{recoveredEvents:r.exactTickSameTeamRule?.recoveredEvents,hypotheticalResolvedTotal:r.exactTickSameTeamRule?.hypotheticalResolvedTotal,hypotheticalResolvedShareOfLifecycle:r.exactTickSameTeamRule?.hypotheticalResolvedShareOfLifecycle,combinedRecipientTransitions:r.exactTickSameTeamRule?.combinedRecipientTransitions,currentAPhysicalTargetInRecipientSetShare:r.exactTickSameTeamRule?.currentAPhysicalTargetInRecipientSetShare,recoveredPhysicalTargetInRecipientSetShare:r.exactTickSameTeamRule?.recoveredPhysicalTargetInRecipientSetShare},sameTeamRadiusSweep:r.sameTeamRadiusSweep,nearestSameTeamTerminationDistanceBuckets:r.nearestSameTeamTerminationDistanceBuckets};}
function mergeCounts(objects){const out={};for(const obj of objects??[])for(const [k,v] of Object.entries(obj??{}))out[k]=(out[k]??0)+Number(v||0);return out;}
function countBy(rows,keyFn){const out={};for(const row of rows??[]){const k=String(keyFn(row)??'UNKNOWN');out[k]=(out[k]??0)+1;}return out;}
function check(actual,expected,pass){return {actual,expected,pass:Boolean(pass)};}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function integer(v){const n=Number(v);return Number.isInteger(n)?n:null;}
