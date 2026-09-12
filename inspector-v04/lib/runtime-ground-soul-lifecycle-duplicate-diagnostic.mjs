export function buildDuplicateActivationDiagnostic(episodes=[],meta={}){
  const rows=[...(episodes??[])];
  const byKey=new Map();
  const byEntity=new Map();
  for(const row of rows){
    const key=activationKey(row);
    if(!byKey.has(key))byKey.set(key,[]);
    byKey.get(key).push(row);
    const entity=Number(row?.entityIndex);
    if(Number.isFinite(entity)){
      if(!byEntity.has(entity))byEntity.set(entity,[]);
      byEntity.get(entity).push(row);
    }
  }
  for(const arr of byEntity.values())arr.sort(compareEpisode);
  const duplicateGroups=[];
  for(const [activationKeyValue,group0] of byKey){
    if(group0.length<2)continue;
    const group=[...group0].sort(compareEpisode);
    const entityIndex=finite(group[0]?.entityIndex);
    const activationTick=finite(group[0]?.activationTick);
    const entityRows=byEntity.get(entityIndex)??[];
    const indexes=group.map(r=>entityRows.indexOf(r)).filter(i=>i>=0);
    const lo=indexes.length?Math.min(...indexes):0;
    const hi=indexes.length?Math.max(...indexes):Math.max(0,group.length-1);
    const prior=lo>0?compactEpisode(entityRows[lo-1]):null;
    const next=hi<entityRows.length-1?compactEpisode(entityRows[hi+1]):null;
    const endTicks=group.map(r=>finite(r?.endTick)).filter(v=>v!==null);
    const zeroTickEpisodes=group.filter(r=>finite(r?.endTick)!==null&&finite(r?.endTick)===finite(r?.activationTick)).length;
    const completed=group.filter(r=>r?.endReason==='BECAME_INACTIVE'&&!r?.censored).length;
    const censored=group.filter(r=>Boolean(r?.censored)).length;
    const targeted=group.filter(r=>Boolean(r?.targeted)).length;
    const sequenceValues=group.map(r=>finite(r?.sequence)).filter(v=>v!==null);
    duplicateGroups.push({
      activationKey:activationKeyValue,
      entityIndex,
      activationTick,
      duplicateEpisodeCount:group.length,
      extraEpisodeCount:group.length-1,
      sequenceMin:sequenceValues.length?Math.min(...sequenceValues):null,
      sequenceMax:sequenceValues.length?Math.max(...sequenceValues):null,
      targetedEpisodes:targeted,
      completedEpisodes:completed,
      censoredEpisodes:censored,
      zeroTickEpisodes,
      allEndOnActivationTick:endTicks.length===group.length&&endTicks.every(t=>t===activationTick),
      containsSameTickCloseThenReopen:zeroTickEpisodes>0&&group.length>1,
      endTicks:[...new Set(endTicks)].sort((a,b)=>a-b),
      priorEpisode:prior,
      episodes:group.map(compactEpisode),
      nextEpisode:next,
    });
  }
  duplicateGroups.sort((a,b)=>(a.activationTick??0)-(b.activationTick??0)||(a.entityIndex??0)-(b.entityIndex??0));
  const duplicateExtraRecordCount=duplicateGroups.reduce((n,g)=>n+g.extraEpisodeCount,0);
  return {
    version:'GROUND_SOUL_LIFECYCLE_DUPLICATE_ACTIVATION_DIAGNOSTIC_V01',
    authority:'diagnostic_only',
    createdAt:new Date().toISOString(),
    replayName:meta.replayName??null,
    replayPath:meta.replayPath??null,
    replayEndTick:finite(meta.replayEndTick),
    totalEpisodes:rows.length,
    uniqueActivationKeys:byKey.size,
    duplicateKeyCount:duplicateGroups.length,
    duplicateExtraRecordCount,
    patterns:{
      groupsWithZeroTickEpisode:duplicateGroups.filter(g=>g.zeroTickEpisodes>0).length,
      groupsAllEndingOnActivationTick:duplicateGroups.filter(g=>g.allEndOnActivationTick).length,
      groupsWithSameTickCloseThenReopen:duplicateGroups.filter(g=>g.containsSameTickCloseThenReopen).length,
      groupsWithTargetStateDifference:duplicateGroups.filter(g=>new Set(g.episodes.map(r=>String(Boolean(r.targeted)))).size>1).length,
      groupsWithDifferentEndTicks:duplicateGroups.filter(g=>g.endTicks.length>1).length,
    },
    duplicateGroups,
    semanticNote:'Diagnostic only. Duplicate activation-key groups are not merged, discarded, or promoted. This artifact exists to determine why production saw more than one episode for the same tick/entity identity.',
  };
}

export function duplicateDiagnosticConsoleLines(diagnostic,{limit=20}={}){
  const d=diagnostic??{};
  const lines=[
    `Duplicate activation keys: ${d.duplicateKeyCount??0}`,
    `Extra duplicate episode records: ${d.duplicateExtraRecordCount??0}`,
    `Groups with zero-tick episode: ${d.patterns?.groupsWithZeroTickEpisode??0}`,
    `Groups with same-tick close/reopen signature: ${d.patterns?.groupsWithSameTickCloseThenReopen??0}`,
    `Groups with different end ticks: ${d.patterns?.groupsWithDifferentEndTicks??0}`,
    `Groups with target-state difference: ${d.patterns?.groupsWithTargetStateDifference??0}`,
  ];
  const groups=(d.duplicateGroups??[]).slice(0,Math.max(0,Number(limit)||0));
  if(groups.length){
    lines.push(`First ${groups.length} duplicate group${groups.length===1?'':'s'}:`);
    for(const g of groups){
      const eps=(g.episodes??[]).map(e=>`seq=${e.sequence??'?'} end=${e.endTick??'—'} reason=${e.endReason??'—'} target=${e.targeted?'yes':'no'} targetTick=${e.targetOnsetTick??'—'}`).join(' || ');
      lines.push(`  tick ${g.activationTick} entity ${g.entityIndex} x${g.duplicateEpisodeCount} | ${eps}`);
    }
  }
  return lines;
}

function compactEpisode(r){return{
  activationId:r?.activationId??null,
  entityIndex:finite(r?.entityIndex),
  sequence:finite(r?.sequence),
  activationTick:finite(r?.activationTick),
  activationMatchTimeSeconds:finite(r?.activationMatchTimeSeconds),
  targeted:Boolean(r?.targeted),
  targetOnsetTick:finite(r?.targetOnsetTick),
  targetEntityIndex:finite(r?.targetEntityIndex),
  endTick:finite(r?.endTick),
  endMatchTimeSeconds:finite(r?.endMatchTimeSeconds),
  durationSeconds:finite(r?.durationSeconds),
  endReason:r?.endReason??null,
  censored:Boolean(r?.censored),
  finalized:Boolean(r?.finalized),
};}
function activationKey(r){return `${finite(r?.activationTick)??'null'}:${finite(r?.entityIndex)??'null'}`;}
function compareEpisode(a,b){return (finite(a?.activationTick)??0)-(finite(b?.activationTick)??0)||(finite(a?.sequence)??0)-(finite(b?.sequence)??0)||(finite(a?.endTick)??Infinity)-(finite(b?.endTick)??Infinity);}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
