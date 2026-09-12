import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';

const TICK_RATE=64;
const MATCH_WINDOW_TICKS=32;
const PLACEBO_10_TICKS=10*TICK_RATE;
const PLACEBO_30_TICKS=30*TICK_RATE;
const DEFAULT_REPLAYS=['test','rep01','rep02','rep03','rep04','rep05'];
const replayNames=process.argv.slice(2).filter(Boolean);
if(!replayNames.length) replayNames.push(...DEFAULT_REPLAYS);
const batchOutputPath=resolve('output','cross_replay','player_scoreboard_death_validation_batch_v01.json');

console.log('\n========================================================');
console.log('PLAYER SCOREBOARD DEATH SEMANTIC VALIDATION V0.1');
console.log('========================================================');
console.log(`Replays: ${replayNames.join(', ')}\n`);

const replayResults=[];
for(const replayName of replayNames){
  const playerStatePath=resolve('output',replayName,'player_state.jsonl');
  if(!existsSync(playerStatePath)){
    replayResults.push({replayName,success:false,status:'PLAYER_STATE_MISSING',playerStatePath});
    console.log(`${replayName.padEnd(10)} player_state.jsonl missing`);
    continue;
  }
  try{
    const result=await validateReplay({replayName,playerStatePath});
    replayResults.push(result);
    console.log(`${replayName.padEnd(10)} scoreDeaths=${String(result.counts.scoreboardDeathCredits).padStart(3)} alive→dead=${String(result.counts.aliveToDeadTransitions).padStart(3)} match=${pct(result.validation.scoreboardDeathToAliveDeadAgreementRate).padStart(7)} extra=${String(result.counts.aliveToDeadWithoutScoreboardDeath).padStart(2)} placebo10=${pct(result.validation.placebo10AgreementRate).padStart(7)}`);
  }catch(error){
    replayResults.push({replayName,success:false,status:'VALIDATION_EXCEPTION',error:error?.stack??String(error)});
    console.log(`${replayName.padEnd(10)} ERROR`);
    console.error(error);
  }
}

const successful=replayResults.filter(r=>r.success);
const aggregate=aggregateResults(successful);
const batch={
  version:'PLAYER_SCOREBOARD_DEATH_VALIDATION_BATCH_V01',canonical:false,createdAt:new Date().toISOString(),
  requestedReplays:replayNames,replayCount:replayNames.length,successCount:successful.length,
  allRequestedReplaysSucceeded:successful.length===replayNames.length,
  construct:'game-awarded/scored player death counter',
  authorityBoundary:{researchOnly:true,promotesClaim:false,promotesMetric:false,establishedIfSupported:'m_iDeaths behaves as the game-awarded/scored player death counter',explicitlyNotEstablished:['every alive-to-dead state transition is a scoreboard death','cause of death','killer attribution','revive mechanic identity']},
  matching:{windowTicks:MATCH_WINDOW_TICKS,windowSeconds:MATCH_WINDOW_TICKS/TICK_RATE,placeboShift10SecondsTicks:PLACEBO_10_TICKS,placeboShift30SecondsTicks:PLACEBO_30_TICKS},
  aggregate,replays:replayResults
};
mkdirSync(dirname(batchOutputPath),{recursive:true});
writeFileSync(batchOutputPath,JSON.stringify(batch,null,2),'utf8');

console.log('\n========================================================');
console.log('BATCH EVIDENCE');
console.log('========================================================');
console.log(`Successful replays: ${successful.length}/${replayNames.length}`);
console.log(`Scoreboard death credits: ${aggregate.counts.scoreboardDeathCredits}`);
console.log(`Alive -> dead transitions: ${aggregate.counts.aliveToDeadTransitions}`);
console.log(`Scoreboard death -> alive/dead agreement: ${pct(aggregate.validation.scoreboardDeathToAliveDeadAgreementRate)}`);
console.log(`Alive/dead transitions without scoreboard death: ${aggregate.counts.aliveToDeadWithoutScoreboardDeath}`);
console.log(`Extra completed state-death episodes: ${aggregate.counts.completedExtraStateDeathEpisodes}`);
console.log(`Extra censored state-death episodes: ${aggregate.counts.censoredExtraStateDeathEpisodes}`);
console.log(`Extra episodes exactly 3.00 s: ${aggregate.counts.extraEpisodesExactly3Seconds}`);
console.log(`10 s placebo agreement: ${pct(aggregate.validation.placebo10AgreementRate)}`);
console.log(`30 s placebo agreement: ${pct(aggregate.validation.placebo30AgreementRate)}`);
console.log(`Output: ${batchOutputPath}\n`);
console.log('IMPORTANT: this script validates the scoreboard death counter while preserving broader alive→dead state episodes as a separate construct.\n');

async function validateReplay({replayName,playerStatePath}){
  const playerStates=new Map();
  const deathCounterEvents=[];
  const aliveToDeadEvents=[];
  const deadToAliveEvents=[];
  const counterRegressions=[];
  let rowCount=0;
  const rl=createInterface({input:createReadStream(playerStatePath,{encoding:'utf8'}),crlfDelay:Infinity});
  for await(const line of rl){
    if(!line.trim()) continue;
    let row; try{row=JSON.parse(line);}catch{continue;}
    rowCount++;
    const c=row?.controller;if(!c)continue;
    const controllerEntityIndex=finite(c.entityIndex);if(controllerEntityIndex===null)continue;
    const playerName=stringOrNull(c.playerName);if(!playerName||playerName==='SourceTV')continue;
    const current={
      tick:firstFinite([row.demoTick,row.tick]),matchTimeSeconds:firstFinite([row.matchTimeSeconds,row.matchTime,row.time]),
      controllerEntityIndex,playerName,team:finite(c.team),heroId:finite(c.heroId),alive:booleanOrNull(c.alive),deaths:finite(c.deaths)
    };
    if(current.tick===null)continue;
    const previous=playerStates.get(controllerEntityIndex)??null;
    if(previous){
      if(Number.isFinite(previous.deaths)&&Number.isFinite(current.deaths)){
        if(current.deaths>previous.deaths) deathCounterEvents.push({kind:'scoreboard_death_counter_increment',tick:current.tick,matchTimeSeconds:current.matchTimeSeconds,controllerEntityIndex,playerName,team:current.team,heroId:current.heroId,previous:previous.deaths,current:current.deaths,delta:current.deaths-previous.deaths});
        else if(current.deaths<previous.deaths) counterRegressions.push({tick:current.tick,controllerEntityIndex,playerName,previous:previous.deaths,current:current.deaths});
      }
      if(previous.alive===true&&current.alive===false) aliveToDeadEvents.push({id:`aliveToDead|${controllerEntityIndex}|${current.tick}`,tick:current.tick,matchTimeSeconds:current.matchTimeSeconds,controllerEntityIndex,playerName,team:current.team,heroId:current.heroId});
      if(previous.alive===false&&current.alive===true) deadToAliveEvents.push({id:`deadToAlive|${controllerEntityIndex}|${current.tick}`,tick:current.tick,matchTimeSeconds:current.matchTimeSeconds,controllerEntityIndex,playerName,team:current.team,heroId:current.heroId});
    }
    playerStates.set(controllerEntityIndex,current);
  }

  const deathSlots=expandCounterSlots(deathCounterEvents,'scoreboard_death');
  const observed=matchOneToOne(deathSlots,aliveToDeadEvents,0);
  const placebo10=matchOneToOne(deathSlots,aliveToDeadEvents,PLACEBO_10_TICKS);
  const placebo30=matchOneToOne(deathSlots,aliveToDeadEvents,PLACEBO_30_TICKS);
  const matchedAliveDeadIds=new Set(observed.matches.map(m=>m.anchor.id));
  const extraAliveToDead=aliveToDeadEvents.filter(r=>!matchedAliveDeadIds.has(r.id));
  const extraEpisodes=extraAliveToDead.map(start=>characterizeExtraEpisode(start,deadToAliveEvents));
  const completed=extraEpisodes.filter(r=>r.completed),censored=extraEpisodes.filter(r=>!r.completed);
  const exactlyThree=completed.filter(r=>Number.isFinite(r.durationSeconds)&&Math.abs(r.durationSeconds-3)<=0.0001);

  const outDir=resolve('output',replayName);mkdirSync(outDir,{recursive:true});
  const summaryPath=resolve(outDir,'player_scoreboard_death_validation_v01.json');
  const eventsPath=resolve(outDir,'player_scoreboard_death_events_v01.jsonl');
  const validation={
    scoreboardDeathToAliveDeadAgreementRate:safeDiv(observed.matches.length,deathSlots.length),
    placebo10AgreementRate:safeDiv(placebo10.matches.length,deathSlots.length),
    placebo30AgreementRate:safeDiv(placebo30.matches.length,deathSlots.length),
    counterRegressionCount:counterRegressions.length
  };
  const summary={
    version:'PLAYER_SCOREBOARD_DEATH_VALIDATION_V01',canonical:false,replay:replayName,rowCount,construct:'game-awarded/scored player death counter',
    counts:{scoreboardDeathTransitions:deathCounterEvents.length,scoreboardDeathCredits:deathSlots.length,aliveToDeadTransitions:aliveToDeadEvents.length,scoreboardDeathsMatchedToAliveDead:observed.matches.length,unmatchedScoreboardDeathCredits:observed.unmatchedObservations.length,aliveToDeadWithoutScoreboardDeath:extraAliveToDead.length,completedExtraStateDeathEpisodes:completed.length,censoredExtraStateDeathEpisodes:censored.length,extraEpisodesExactly3Seconds:exactlyThree.length,counterRegressions:counterRegressions.length},
    validation,timingResiduals:summarizeResiduals(observed.matches),extraStateDeathEpisodeDurations:summarizeDurations(completed.map(r=>r.durationSeconds).filter(Number.isFinite)),unmatchedScoreboardDeathCredits:observed.unmatchedObservations,extraAliveToDeadEpisodes:extraEpisodes,counterRegressions,
    outputs:{summary:summaryPath,events:eventsPath}
  };
  writeFileSync(summaryPath,JSON.stringify(summary,null,2),'utf8');
  const eventRows=[...observed.matches.map(m=>({eventType:'SCOREBOARD_DEATH_MATCHED_STATE_DEATH',scoreboardDeath:m.observation,aliveToDead:m.anchor,signedTickDelta:m.signedTickDelta,signedSecondsDelta:m.signedTickDelta/TICK_RATE})),...extraEpisodes.map(r=>({eventType:'ALIVE_TO_DEAD_WITHOUT_SCOREBOARD_DEATH',...r}))];
  writeFileSync(eventsPath,eventRows.map(r=>JSON.stringify(r)).join('\n')+(eventRows.length?'\n':''),'utf8');
  return{replayName,success:true,status:'RESEARCH_VALIDATION_COMPLETE',counts:summary.counts,validation,timingResiduals:summary.timingResiduals,extraStateDeathEpisodeDurations:summary.extraStateDeathEpisodeDurations,outputs:summary.outputs};
}

function matchOneToOne(observations,anchors,shiftTicks){
  const edges=[];
  for(let oi=0;oi<observations.length;oi++)for(let ai=0;ai<anchors.length;ai++){
    const o=observations[oi],a=anchors[ai];if(o.controllerEntityIndex!==a.controllerEntityIndex)continue;
    const shiftedTick=o.tick+shiftTicks,signed=a.tick-shiftedTick,abs=Math.abs(signed);if(abs>MATCH_WINDOW_TICKS)continue;
    edges.push({oi,ai,signed,abs});
  }
  edges.sort((x,y)=>x.abs-y.abs||x.oi-y.oi||x.ai-y.ai);
  const usedO=new Set(),usedA=new Set(),matches=[];
  for(const e of edges){if(usedO.has(e.oi)||usedA.has(e.ai))continue;usedO.add(e.oi);usedA.add(e.ai);matches.push({observation:observations[e.oi],anchor:anchors[e.ai],signedTickDelta:e.signed,absoluteTickDelta:e.abs});}
  return{matches,unmatchedObservations:observations.filter((_,i)=>!usedO.has(i)),unmatchedAnchors:anchors.filter((_,i)=>!usedA.has(i))};
}

function characterizeExtraEpisode(start,deadToAliveEvents){
  const end=deadToAliveEvents.filter(e=>e.controllerEntityIndex===start.controllerEntityIndex&&e.tick>start.tick).sort((a,b)=>a.tick-b.tick)[0]??null;
  return{start,completed:Boolean(end),end,durationTicks:end?end.tick-start.tick:null,durationSeconds:end?(end.tick-start.tick)/TICK_RATE:null};
}

function expandCounterSlots(events,kind){
  const out=[];for(const e of events){for(let i=0;i<Math.max(0,Math.trunc(e.delta));i++)out.push({id:`${kind}|${e.controllerEntityIndex}|${e.tick}|${i}`,kind,tick:e.tick,matchTimeSeconds:e.matchTimeSeconds,controllerEntityIndex:e.controllerEntityIndex,playerName:e.playerName,team:e.team,heroId:e.heroId,transitionDelta:e.delta,ordinalWithinTransition:i+1});}return out;
}

function summarizeResiduals(matches){
  const v=matches.map(m=>m.signedTickDelta).sort((a,b)=>a-b);if(!v.length)return{count:0};const z=v.filter(x=>x===0).length;
  return{count:v.length,minTicks:v[0],medianTicks:median(v),maxTicks:v.at(-1),zeroTickMatches:z,zeroTickShare:safeDiv(z,v.length),minSeconds:v[0]/TICK_RATE,medianSeconds:median(v)/TICK_RATE,maxSeconds:v.at(-1)/TICK_RATE};
}
function summarizeDurations(v){v=[...v].sort((a,b)=>a-b);if(!v.length)return{count:0};return{count:v.length,minSeconds:v[0],medianSeconds:median(v),maxSeconds:v.at(-1),modeSeconds:modeRounded(v,4)};}
function aggregateResults(rows){
  const sum=k=>rows.reduce((t,r)=>t+(finite(r?.counts?.[k])??0),0);const credits=sum('scoreboardDeathCredits'),matched=sum('scoreboardDeathsMatchedToAliveDead');
  const p10=rows.reduce((t,r)=>t+Math.round((r?.validation?.placebo10AgreementRate??0)*(r?.counts?.scoreboardDeathCredits??0)),0);
  const p30=rows.reduce((t,r)=>t+Math.round((r?.validation?.placebo30AgreementRate??0)*(r?.counts?.scoreboardDeathCredits??0)),0);
  const allResiduals=rows.flatMap(r=>Array(r?.timingResiduals?.zeroTickMatches??0).fill(0));
  return{counts:{scoreboardDeathCredits:credits,aliveToDeadTransitions:sum('aliveToDeadTransitions'),scoreboardDeathsMatchedToAliveDead:matched,unmatchedScoreboardDeathCredits:sum('unmatchedScoreboardDeathCredits'),aliveToDeadWithoutScoreboardDeath:sum('aliveToDeadWithoutScoreboardDeath'),completedExtraStateDeathEpisodes:sum('completedExtraStateDeathEpisodes'),censoredExtraStateDeathEpisodes:sum('censoredExtraStateDeathEpisodes'),extraEpisodesExactly3Seconds:sum('extraEpisodesExactly3Seconds'),counterRegressions:sum('counterRegressions')},validation:{scoreboardDeathToAliveDeadAgreementRate:safeDiv(matched,credits),placebo10AgreementRate:safeDiv(p10,credits),placebo30AgreementRate:safeDiv(p30,credits)}};
}
function median(v){if(!v.length)return null;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;}
function modeRounded(values,decimals){const c=new Map();for(const x of values){const k=Number(x.toFixed(decimals));c.set(k,(c.get(k)??0)+1);}let best=null,n=-1;for(const [k,v] of c)if(v>n){best=k;n=v;}return best;}
function firstFinite(v){for(const x of v){const n=finite(x);if(n!==null)return n;}return null;}
function booleanOrNull(v){if(v===true||v===false)return v;if(v===1||v===0)return Boolean(v);return null;}
function safeDiv(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?a/b:null;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function stringOrNull(v){if(v===null||v===undefined)return null;const s=String(v).trim();return s||null;}
function pct(v){return Number.isFinite(v)?`${(v*100).toFixed(2)}%`:'—';}
