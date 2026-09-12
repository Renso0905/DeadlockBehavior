import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Parser, InterceptorStage } from 'deadem';

const WINDOWS=[0,1,2,4,8,16,32];
const TICK_RATE=64;
const DEFAULT_REPLAYS=['test','rep01','rep02','rep03','rep04','rep05'];
const replayNames=process.argv.slice(2).filter(Boolean).length?process.argv.slice(2).filter(Boolean):DEFAULT_REPLAYS;
const batchPath=resolve('output','cross_replay','player_last_hit_residual_timing_diagnostics_v01.json');

console.log('');
console.log('========================================================');
console.log('LAST-HIT RESIDUAL TIMING DIAGNOSTICS V0.1');
console.log('========================================================');
console.log(`Replays: ${replayNames.join(', ')}`);
console.log('');

const results=[];

for(const replayName of replayNames){
  const replayPath=resolve('replays',`${replayName}.dem`);
  if(!existsSync(replayPath)){
    results.push({replayName,success:false,status:'REPLAY_MISSING'});
    console.log(`${replayName.padEnd(10)} replay missing`);
    continue;
  }
  try{
    const result=await diagnoseReplay({replayName,replayPath});
    results.push(result);
    console.log(
      `${replayName.padEnd(10)} `+
      `credits=${String(result.counts.lastHitCredits).padStart(5)} `+
      `exact=${pct(result.windows['0'].coverageRate).padStart(7)} `+
      `±4=${pct(result.windows['4'].coverageRate).padStart(7)} `+
      `±8=${pct(result.windows['8'].coverageRate).padStart(7)} `+
      `remain8=${String(result.windows['8'].unmatchedCredits).padStart(4)}`
    );
  }catch(error){
    results.push({replayName,success:false,status:'DIAGNOSTIC_EXCEPTION',error:error?.stack??String(error)});
    console.log(`${replayName.padEnd(10)} ERROR`);
    console.error(error);
  }
}

const successful=results.filter(r=>r.success);
const aggregate=aggregateResults(successful);

const batch={
  version:'PLAYER_LAST_HIT_RESIDUAL_TIMING_DIAGNOSTICS_V01',
  canonical:false,
  diagnosticOnly:true,
  createdAt:new Date().toISOString(),
  requestedReplays:replayNames,
  replayCount:replayNames.length,
  successCount:successful.length,
  allRequestedReplaysSucceeded:successful.length===replayNames.length,
  windowsTicks:WINDOWS,
  windowsSeconds:Object.fromEntries(WINDOWS.map(w=>[String(w),w/TICK_RATE])),
  aggregate,
  replays:results
};

mkdirSync(dirname(batchPath),{recursive:true});
writeFileSync(batchPath,JSON.stringify(batch,null,2),'utf8');

console.log('');
console.log('========================================================');
console.log('BATCH TIMING DIAGNOSTICS');
console.log('========================================================');
console.log(`Successful replays: ${successful.length}/${replayNames.length}`);
console.log(`Last-hit credits: ${aggregate.counts.lastHitCredits}`);
console.log('');
for(const w of WINDOWS){
  const row=aggregate.windows[String(w)];
  const label=w===0?'exact':`±${w} ticks`;
  console.log(`${label.padEnd(10)} matched=${String(row.matchedCredits).padStart(5)} coverage=${pct(row.coverageRate).padStart(7)} unmatched=${String(row.unmatchedCredits).padStart(5)}`);
}
console.log('');
console.log('Signed offsets among ±32 tick matches:');
for(const [offset,count] of Object.entries(aggregate.signedOffsetHistogram32)){
  console.log(`  ${String(offset).padStart(4)} ticks : ${count}`);
}
console.log('');
console.log('NPC classes recovered beyond exact tick within ±8:');
for(const [name,count] of Object.entries(aggregate.recoveredBeyondExactClasses8)){
  console.log(`  ${name.padEnd(36)} ${count}`);
}
console.log('');
console.log(`Output: ${batchPath}`);
console.log('');
console.log('IMPORTANT: timing diagnosis only; no last-hit semantic promotion.');

async function diagnoseReplay({replayName,replayPath}){
  const parser=new Parser();
  const prevController=new Map();
  const prevNpc=new Map();
  const lastHitEvents=[];
  const npcDeaths=[];

  parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,
    (demoPacket,_messagePacket,events)=>{
      const tick=finite(demoPacket?.tick);
      if(tick===null)return;

      for(const event of events??[]){
        const entity=event?.entity;
        if(!entity)continue;

        const className=getEntityClassName(entity);
        const entityIndex=getEntityIndex(entity);
        if(!className||entityIndex===null)continue;

        if(className==='CCitadelPlayerController'){
          const playerName=stringOrNull(safeGetField(entity,'m_iszPlayerName'));
          if(!playerName||playerName==='SourceTV')continue;

          const current={
            tick,
            controllerEntityIndex:entityIndex,
            playerName,
            team:finite(safeGetField(entity,'m_iTeamNum')),
            heroId:finite(safeGetField(entity,'m_nHeroID')),
            lastHits:finite(safeGetField(entity,'m_iLastHits'))
          };

          const previous=prevController.get(entityIndex)??null;
          if(previous&&Number.isFinite(previous.lastHits)&&Number.isFinite(current.lastHits)&&current.lastHits>previous.lastHits){
            lastHitEvents.push({
              tick,
              controllerEntityIndex:entityIndex,
              playerName,
              team:current.team,
              heroId:current.heroId,
              previous:previous.lastHits,
              current:current.lastHits,
              delta:current.lastHits-previous.lastHits
            });
          }
          prevController.set(entityIndex,current);
          continue;
        }

        if(!className.startsWith('CNPC_'))continue;

        const current={
          tick,
          entityIndex,
          className,
          team:finite(safeGetField(entity,'m_iTeamNum')),
          health:finite(safeGetField(entity,'m_iHealth')),
          maxHealth:finite(safeGetField(entity,'m_iMaxHealth')),
          subclassId:stringOrNull(safeGetField(entity,'m_nEntitySubclassID'))
        };
        const previous=prevNpc.get(entityIndex)??null;

        if(previous&&Number.isFinite(previous.health)&&Number.isFinite(current.health)&&previous.health>0&&current.health<=0){
          npcDeaths.push({
            id:`npcDeath|${entityIndex}|${tick}`,
            tick,
            entityIndex,
            className,
            team:current.team,
            previousHealth:previous.health,
            currentHealth:current.health,
            maxHealth:current.maxHealth,
            subclassId:current.subclassId
          });
        }
        prevNpc.set(entityIndex,current);
      }
    }
  );

  try{await parser.parse(createReadStream(replayPath));}
  finally{await parser.dispose();}

  const credits=expandCounterSlots(lastHitEvents);
  const windows={};
  let exactResult=null;
  let eightResult=null;
  let thirtyTwoResult=null;

  for(const w of WINDOWS){
    const result=matchCreditsToNpcDeaths({credits,npcDeaths,maxTicks:w});
    windows[String(w)]={
      matchedCredits:result.matches.length,
      unmatchedCredits:result.unmatchedCredits.length,
      unusedNpcDeaths:result.unusedNpcDeaths.length,
      coverageRate:safeDiv(result.matches.length,credits.length),
      signedOffsetHistogram:histogram(result.matches.map(m=>m.signedTickDelta)),
      matchedClassCounts:countBy(result.matches,m=>m.death.className??'UNKNOWN')
    };
    if(w===0)exactResult=result;
    if(w===8)eightResult=result;
    if(w===32)thirtyTwoResult=result;
  }

  const exactIds=new Set(exactResult.matches.map(m=>m.credit.id));
  const recoveredBeyondExact8=eightResult.matches.filter(m=>!exactIds.has(m.credit.id));

  const outputDir=resolve('output',replayName);
  mkdirSync(outputDir,{recursive:true});
  const summaryPath=resolve(outputDir,'player_last_hit_residual_timing_diagnostics_v01.json');
  const matchPath=resolve(outputDir,'player_last_hit_residual_timing_matches_v01.jsonl');

  const summary={
    version:'PLAYER_LAST_HIT_RESIDUAL_TIMING_DIAGNOSTICS_V01',
    canonical:false,
    replay:replayName,
    counts:{
      lastHitCredits:credits.length,
      npcDeathTransitions:npcDeaths.length,
      exactMatchedCredits:exactResult.matches.length,
      exactResidualCredits:exactResult.unmatchedCredits.length,
      recoveredBeyondExactWithin8Ticks:recoveredBeyondExact8.length
    },
    windows,
    recoveredBeyondExactClasses8:sortDescending(countBy(recoveredBeyondExact8,m=>m.death.className??'UNKNOWN')),
    recoveredBeyondExactOffsetHistogram8:histogram(recoveredBeyondExact8.map(m=>m.signedTickDelta)),
    unmatchedAt32Examples:thirtyTwoResult.unmatchedCredits.slice(0,100),
    outputs:{summary:summaryPath,residualMatches:matchPath}
  };

  writeFileSync(summaryPath,JSON.stringify(summary,null,2),'utf8');
  writeFileSync(matchPath,recoveredBeyondExact8.map(x=>JSON.stringify(x)).join('\n')+(recoveredBeyondExact8.length?'\n':''),'utf8');

  return {
    replayName,
    success:true,
    status:'RESIDUAL_TIMING_DIAGNOSTIC_COMPLETE',
    counts:summary.counts,
    windows,
    recoveredBeyondExactClasses8:summary.recoveredBeyondExactClasses8,
    outputs:summary.outputs
  };
}

function matchCreditsToNpcDeaths({credits,npcDeaths,maxTicks}){
  const edges=[];
  for(let ci=0;ci<credits.length;ci++){
    const credit=credits[ci];
    for(let di=0;di<npcDeaths.length;di++){
      const death=npcDeaths[di];
      if(!isEligibleDeathForPlayer(death,credit.team))continue;
      const signedTickDelta=death.tick-credit.tick;
      const absoluteTickDelta=Math.abs(signedTickDelta);
      if(absoluteTickDelta>maxTicks)continue;
      edges.push({ci,di,signedTickDelta,absoluteTickDelta});
    }
  }

  edges.sort((a,b)=>a.absoluteTickDelta-b.absoluteTickDelta||a.ci-b.ci||a.di-b.di);

  const usedCredits=new Set();
  const usedDeaths=new Set();
  const matches=[];

  for(const edge of edges){
    if(usedCredits.has(edge.ci)||usedDeaths.has(edge.di))continue;
    usedCredits.add(edge.ci);
    usedDeaths.add(edge.di);
    matches.push({
      credit:credits[edge.ci],
      death:npcDeaths[edge.di],
      signedTickDelta:edge.signedTickDelta,
      absoluteTickDelta:edge.absoluteTickDelta,
      secondsDelta:edge.signedTickDelta/TICK_RATE
    });
  }

  return {
    matches,
    unmatchedCredits:credits.filter((_,i)=>!usedCredits.has(i)),
    unusedNpcDeaths:npcDeaths.filter((_,i)=>!usedDeaths.has(i))
  };
}

function isEligibleDeathForPlayer(death,playerTeam){
  if(!Number.isFinite(playerTeam))return true;
  if(isCompetitiveTeam(death.team)&&isCompetitiveTeam(playerTeam))return death.team!==playerTeam;
  return true;
}
function isCompetitiveTeam(team){return team===2||team===3;}

function expandCounterSlots(events){
  const out=[];
  for(const event of events){
    const count=Math.max(0,Math.trunc(event.delta));
    for(let i=0;i<count;i++){
      out.push({
        id:`lastHit|${event.controllerEntityIndex}|${event.tick}|${i}`,
        tick:event.tick,
        controllerEntityIndex:event.controllerEntityIndex,
        playerName:event.playerName,
        team:event.team,
        heroId:event.heroId,
        transitionDelta:event.delta,
        ordinalWithinTransition:i+1
      });
    }
  }
  return out;
}

function aggregateResults(successful){
  const totalCredits=successful.reduce((a,r)=>a+(r.counts?.lastHitCredits??0),0);
  const windows={};

  for(const w of WINDOWS){
    const key=String(w);
    const matched=successful.reduce((a,r)=>a+(r.windows?.[key]?.matchedCredits??0),0);
    windows[key]={
      matchedCredits:matched,
      unmatchedCredits:totalCredits-matched,
      coverageRate:safeDiv(matched,totalCredits)
    };
  }

  const signedOffsetHistogram32={};
  const recoveredBeyondExactClasses8={};

  for(const row of successful){
    for(const [offset,count] of Object.entries(row.windows?.['32']?.signedOffsetHistogram??{})){
      signedOffsetHistogram32[offset]=(signedOffsetHistogram32[offset]??0)+count;
    }
    for(const [name,count] of Object.entries(row.recoveredBeyondExactClasses8??{})){
      recoveredBeyondExactClasses8[name]=(recoveredBeyondExactClasses8[name]??0)+count;
    }
  }

  return {
    counts:{
      lastHitCredits:totalCredits,
      exactResidualCredits:successful.reduce((a,r)=>a+(r.counts?.exactResidualCredits??0),0)
    },
    windows,
    signedOffsetHistogram32:sortNumeric(signedOffsetHistogram32),
    recoveredBeyondExactClasses8:sortDescending(recoveredBeyondExactClasses8)
  };
}

function countBy(rows,keyFn){
  const out={};
  for(const row of rows){
    const key=String(keyFn(row)??'UNKNOWN');
    out[key]=(out[key]??0)+1;
  }
  return out;
}
function histogram(values){
  const out={};
  for(const value of values){
    const key=String(value);
    out[key]=(out[key]??0)+1;
  }
  return sortNumeric(out);
}
function sortNumeric(obj){return Object.fromEntries(Object.entries(obj).sort((a,b)=>Number(a[0])-Number(b[0])));}
function sortDescending(obj){return Object.fromEntries(Object.entries(obj).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));}

function getEntityClassName(entity){
  try{
    if(typeof entity?.getClassName==='function'){
      const v=entity.getClassName();
      if(v)return String(v);
    }
  }catch{}
  return entity?.className??entity?.class?.name??entity?._className??null;
}
function getEntityIndex(entity){
  const direct=finite(entity?.index??entity?.entityIndex);
  if(direct!==null)return direct;
  try{return typeof entity?.getIndex==='function'?finite(entity.getIndex()):null;}
  catch{return null;}
}
function safeGetField(entity,name){try{return typeof entity?.getField==='function'?entity.getField(name):undefined;}catch{return undefined;}}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function stringOrNull(v){if(v===null||v===undefined)return null;const s=String(v).trim();return s?s:null;}
function safeDiv(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?a/b:null;}
function pct(v){return Number.isFinite(v)?`${(v*100).toFixed(2)}%`:'—';}
