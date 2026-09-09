import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { readJson, readJsonl, sourceHealth, fileFingerprint } from './io.mjs';

const TICKS_PER_SECOND=64;
const CHECKPOINTS=[300,600,900,1200,1500,1800,2100,2400,2700,3000];

export async function buildReplayModel({outputRoot,replayName,cacheRoot=null,force=false}) {
  const dir=join(outputRoot,replayName);
  const sourceFiles=[
    'player_state.jsonl','player_state_summary.json','integrated_authoritative_player_state_substrate_v01.json','runtime_item_ownership_production_v01.json','behavioral_metrics_v02.json',
    'behavioral_resource_features_summary_v01.json','breakable_catalog_v1.json','breakable_action_stream_summary_v1.json',
    'breakable_reward_acquisition_summary_v1.json','trooper_ground_soul_one_to_one_summary_v01.json',
    'citemxp_inspector_events_v01.json','citemxp_auto_award_resolution_validation_v02.json','effective_weapon_runtime_events_v01.jsonl'
  ].map(f=>join(dir,f));
  const fingerprint=await fileFingerprint(sourceFiles);
  const cachePath=cacheRoot?join(cacheRoot,`${safeName(replayName)}.json`):null;
  if (!force && cachePath && existsSync(cachePath)) {
    try {
      const cached=JSON.parse(await fs.readFile(cachePath,'utf8'));
      if (cached?.fingerprint===fingerprint && cached?.model) return cached.model;
    } catch {}
  }

  const health=await sourceHealth(dir);
  const playerStateSummary=await readJson(join(dir,'player_state_summary.json'));
  const integrated=await readJson(join(dir,'integrated_authoritative_player_state_substrate_v01.json'));
  const runtimeItems=await readJson(join(dir,'runtime_item_ownership_production_v01.json'));
  const offset=Number(runtimeItems?.replay?.matchClockOffsetSeconds ?? playerStateSummary?.matchClockOffsetSeconds ?? integrated?.replay?.matchClockOffsetSeconds ?? 0);
  const core=await aggregatePlayerState(join(dir,'player_state.jsonl'),offset);
  const behavioral=await readJson(join(dir,'behavioral_metrics_v02.json'));
  const resourceFeatures=await readJson(join(dir,'behavioral_resource_features_summary_v01.json'));
  const breakCatalog=await readJson(join(dir,'breakable_catalog_v1.json'));
  const breakSummary=await readJson(join(dir,'breakable_action_stream_summary_v1.json'));
  const rewardSummary=await readJson(join(dir,'breakable_reward_acquisition_summary_v1.json'));
  const groundSummary=await readJson(join(dir,'trooper_ground_soul_one_to_one_summary_v01.json'));
  const citemxp=await readJson(join(dir,'citemxp_inspector_events_v01.json'));
  const autoAwardSummary=await readJson(join(dir,'citemxp_auto_award_resolution_validation_v02.json'));

  const playerByName=new Map(core.players.map(p=>[p.playerName,p]));
  applyIntegrated(playerByName,integrated,offset,core.matchEndSeconds);
  applyRuntimeItems(playerByName,runtimeItems);
  applyBehavioral(playerByName,behavioral,resourceFeatures);
  applyRewards(playerByName,rewardSummary,breakSummary);
  applyCitemxp(playerByName,citemxp);
  applyGroundSouls(playerByName,groundSummary);
  const weapon=await aggregateWeaponEvents(join(dir,'effective_weapon_runtime_events_v01.jsonl'),playerByName,offset);
  const troopers=await aggregateTroopers(join(dir,'trooper_deaths_typed_v02.jsonl'));
  const autoAwards=autoAwardSummary ? {
    status:autoAwardSummary.status,
    counts:autoAwardSummary.resolutionStatusCounts ?? {},
    bySource:autoAwardSummary.resolutionStatusBySource ?? {},
    validation:autoAwardSummary.pipelineValidation ?? null
  } : null;

  const players=core.players.map(p=>finalizePlayer(p,core)).sort((a,b)=>a.team-b.team || b.scoreboard.goldNetWorth-a.scoreboard.goldNetWorth);
  const teams=finalizeTeams(players,core.teamSeries);
  const model={
    version:'DEADLOCK_INSPECTOR_MATCH_MODEL_V04',
    replayName,
    generatedAt:new Date().toISOString(),
    match:{
      ticksPerSecond:Number(integrated?.replay?.ticksPerSecond ?? playerStateSummary?.tickRateAssumed ?? TICKS_PER_SECOND),
      matchClockOffsetSeconds:offset,
      startDemoSeconds:core.startDemoSeconds,
      endDemoSeconds:core.endDemoSeconds,
      matchDurationSeconds:core.matchEndSeconds,
      replayEndTick:integrated?.replay?.replayEndTick ?? core.lastTick,
      postGameTick:integrated?.replay?.postGameTick ?? null,
      roster:players.map(p=>pick(p.identity,['playerName','steamId','heroId','team','controllerEntityIndex','pawnEntityIndex'])),
    },
    sourceHealth:health,
    players,
    teams,
    teamSeries:core.teamSeries,
    breakables:breakCatalog ? {
      persistentSlots:breakCatalog.summary?.persistentSlots ?? breakCatalog.slots?.length ?? null,
      typeCounts:breakCatalog.summary?.typeCounts ?? null,
      spawnCohorts:breakCatalog.summary?.spawnCohorts ?? null,
      lifecycle:breakCatalog.summary?.lifecycle ?? null,
      respawnSeconds:breakCatalog.timing?.respawnSeconds ?? null,
      slots:(breakCatalog.slots??[]).map(s=>({
        breakableId:s.breakableId,entityIndex:s.entityIndex,type:s.type,worldPosition:s.worldPosition,
        spawn:s.spawn,lifecycle:s.lifecycle,breakCount:s.breakEvents?.length??0
      }))
    }:null,
    breakableActionSummary:breakSummary?{counts:breakSummary.counts,economy:breakSummary.economy,crossPlayerCollection:breakSummary.crossPlayerCollection}:null,
    breakableRewardSummary:rewardSummary?{
      counts:rewardSummary.counts,byRewardType:rewardSummary.byRewardType,value:rewardSummary.value,
      breakerCollector:rewardSummary.breakerCollector,geometry:rewardSummary.confirmedCollectionGeometry
    }:null,
    troopers,
    groundSouls:groundSummary?{
      status:groundSummary.status,
      deathEligibility:groundSummary.deathEligibility,
      oneToOneResults:groundSummary.oneToOneResults,
      vacuumTargets:groundSummary.vacuumTargets,
      validation:groundSummary.validation
    }:null,
    citemxp:citemxp?{summary:citemxp.summary,matchClockOffsetSeconds:citemxp.matchClockOffsetSeconds}:null,
    autoAwards,
    weapon,
    cautions:[
      'Item removals are displayed as REMOVED, not SOLD.',
      'Camp CLEAR DURING EXPOSURE does not prove the player caused the clear.',
      'Ground-soul vacuum targets are displayed as TARGETED TO PLAYER, not final collection.',
      'Current ammo / effective magazine / effective DPS are intentionally excluded from A/B statistics.',
      'Net-worth gain rate is not automatically labeled souls/min.'
    ]
  };

  if (cachePath) {
    await fs.mkdir(cacheRoot,{recursive:true});
    await fs.writeFile(cachePath,JSON.stringify({fingerprint,model}));
  }
  return model;
}

async function aggregatePlayerState(path,offset) {
  const byName=new Map(); let startDemo=Infinity,endDemo=-Infinity,lastTick=0;
  for await (const row of readJsonl(path)) {
    const demoTime=finite(row.demoSeconds ?? row.time) ?? (finite(row.demoTick ?? row.tick)!==null?(row.demoTick??row.tick)/TICKS_PER_SECOND:null);
    if (demoTime===null) continue;
    const tick=finite(row.demoTick ?? row.tick) ?? 0;
    startDemo=Math.min(startDemo,demoTime); endDemo=Math.max(endDemo,demoTime); lastTick=Math.max(lastTick,tick);
    if (row.controller && typeof row.controller==='object') {
      const c=row.controller,pawn=row.pawn??{};
      const pos=pawn.positionWorld;
      const state={
        controllerEntityIndex:c.entityIndex,playerName:c.playerName,steamId:c.steamId,team:c.team,heroId:c.heroId,heroEntityIndex:pawn.entityIndex,
        laneColor:c.assignedLane??pawn.deducedLane,alive:c.alive,health:c.health,healthMax:c.maxHealth,healthRegen:c.healthRegen,maxAmmo:c.maxAmmo,
        level:c.level,kills:c.kills,deaths:c.deaths,assists:c.assists,denies:c.denies,lastHits:c.lastHits,goldNetWorth:c.netWorth,apNetWorth:c.abilityPointNetWorth,
        respawnTime:c.respawnTime,position:pos?[pos.x,pos.y,pos.z]:null
      };
      updatePlayer(byName,state,demoTime,offset,tick,finite(row.matchTimeSeconds));
    } else {
      for (const state of row.players??[]) updatePlayer(byName,state,demoTime,offset,tick,null);
    }
  }
  const matchEndSeconds=Math.max(0,endDemo-offset);
  const players=[];
  for (const p of byName.values()) {
    closePlayerIntervals(p,endDemo);
    p.aliveMinutes=p.aliveSeconds/60;
    p.deadMinutes=p.deadSeconds/60;
    p.aliveShare=safeDiv(p.aliveSeconds,p.aliveSeconds+p.deadSeconds);
    p.averageLifeSeconds=mean(p.survivalIntervals);
    p.totalRespawnDowntimeSeconds=p.respawnIntervals.reduce((a,b)=>a+b.duration,0);
    p.matchMinutes=matchEndSeconds/60;
    p.netWorthGainPerMinute=safeDiv((p.finalState?.goldNetWorth??0)-(p.initialState?.goldNetWorth??0),p.matchMinutes);
    p.levelRatePerMinute=safeDiv((p.finalState?.level??0)-(p.initialState?.level??0),p.matchMinutes);
    p.checkpoints=checkpointStates(p.timeline,CHECKPOINTS);
    players.push(p);
  }
  const teamSeries=buildTeamSeries(players,matchEndSeconds);
  return {players,startDemoSeconds:Number.isFinite(startDemo)?startDemo:0,endDemoSeconds:Number.isFinite(endDemo)?endDemo:0,matchEndSeconds,lastTick,teamSeries};
}

function updatePlayer(map,s,demoTime,offset,tick,matchTimeOverride=null) {
  const name=s.playerName ?? s.steamId ?? `controller-${s.controllerEntityIndex}`;
  let p=map.get(name);
  if (!p) {
    p={
      playerName:name, team:s.team??null, heroId:s.heroId??null,
      identity:{playerName:name,steamId:s.steamId??null,heroId:s.heroId??null,team:s.team??null,controllerEntityIndex:s.controllerEntityIndex??null,pawnEntityIndex:s.heroEntityIndex??null,laneColor:s.laneColor??null},
      initialState:null,finalState:null,prev:null,aliveSeconds:0,deadSeconds:0,low25Seconds:0,low50Seconds:0,
      minHealth:Infinity,maxHealth:-Infinity,minHealthMax:Infinity,maxHealthMax:-Infinity,
      deathsObserved:[],respawnsObserved:[],survivalIntervals:[],respawnIntervals:[],levelTimings:{},timeline:[],lastSampleMatch:-Infinity,
      lifeStartDemo:null,deathStartDemo:null
    }; map.set(name,p);
  }
  const matchTime=matchTimeOverride ?? (demoTime-offset); const state=normalizeState(s,tick,demoTime,matchTime);
  if (!p.initialState) { p.initialState=state; if(state.alive) p.lifeStartDemo=demoTime; else p.deathStartDemo=demoTime; }
  if (p.prev) {
    const dt=Math.max(0,demoTime-p.prev.demoTime);
    if (p.prev.alive) p.aliveSeconds+=dt; else p.deadSeconds+=dt;
    const ratio=(p.prev.healthMax>0)?p.prev.health/p.prev.healthMax:null;
    if (ratio!==null && ratio<0.25) p.low25Seconds+=dt;
    if (ratio!==null && ratio<0.50) p.low50Seconds+=dt;
    if (p.prev.alive && !state.alive) {
      p.deathsObserved.push({tick,time:matchTime,demoTime,health:s.health??null});
      if (p.lifeStartDemo!==null) p.survivalIntervals.push(Math.max(0,demoTime-p.lifeStartDemo));
      p.lifeStartDemo=null; p.deathStartDemo=demoTime;
    }
    if (!p.prev.alive && state.alive) {
      const duration=p.deathStartDemo===null?null:Math.max(0,demoTime-p.deathStartDemo);
      p.respawnsObserved.push({tick,time:matchTime,demoTime,duration});
      if (duration!==null) p.respawnIntervals.push({startDemo:p.deathStartDemo,endDemo:demoTime,duration});
      p.deathStartDemo=null; p.lifeStartDemo=demoTime;
    }
  }
  if (Number.isFinite(s.health)) {p.minHealth=Math.min(p.minHealth,s.health);p.maxHealth=Math.max(p.maxHealth,s.health);}
  if (Number.isFinite(s.healthMax)){p.minHealthMax=Math.min(p.minHealthMax,s.healthMax);p.maxHealthMax=Math.max(p.maxHealthMax,s.healthMax);}
  if (s.level!==undefined && p.levelTimings[String(s.level)]===undefined && matchTime>=0) p.levelTimings[String(s.level)]={tick,time:matchTime};
  if (matchTime>=0 && (matchTime-p.lastSampleMatch>=1 || p.timeline.length===0)) {
    p.timeline.push(compactState(state)); p.lastSampleMatch=matchTime;
  }
  p.prev=state; p.finalState=state;
}

function closePlayerIntervals(p,endDemo) {
  if (!p.prev) return;
  const dt=Math.max(0,endDemo-p.prev.demoTime);
  if (p.prev.alive) p.aliveSeconds+=dt; else p.deadSeconds+=dt;
  const ratio=p.prev.healthMax>0?p.prev.health/p.prev.healthMax:null;
  if (ratio!==null && ratio<.25)p.low25Seconds+=dt;if(ratio!==null&&ratio<.5)p.low50Seconds+=dt;
}

function normalizeState(s,tick,demoTime,matchTime){return{
  tick:finite(tick),demoTime,matchTime,alive:Boolean(s.alive),health:finite(s.health),healthMax:finite(s.healthMax),healthRegen:finite(s.healthRegen),
  level:finite(s.level),kills:finite(s.kills)??0,deaths:finite(s.deaths)??0,assists:finite(s.assists)??0,denies:finite(s.denies)??0,lastHits:finite(s.lastHits)??0,
  goldNetWorth:finite(s.goldNetWorth)??0,apNetWorth:finite(s.apNetWorth)??0,respawnTime:finite(s.respawnTime),position:Array.isArray(s.position)?s.position.map(v=>finite(v)??0):null
};}
function compactState(s){return pick(s,['tick','matchTime','alive','health','healthMax','healthRegen','level','kills','deaths','assists','denies','lastHits','goldNetWorth','apNetWorth','respawnTime','position']);}

function applyRuntimeItems(playerByName,artifact){
  if (!artifact || artifact.status!=='RUNTIME_ITEM_OWNERSHIP_PRODUCTION_V01_READY') return;
  const players=[...playerByName.values()];
  for (const row of artifact.players??[]) {
    const p=players.find(x=>Number.isInteger(row.entityIndex)&&x.identity?.controllerEntityIndex===row.entityIndex)
      ?? players.find(x=>row.steamId!=null&&String(x.identity?.steamId)===String(row.steamId))
      ?? playerByName.get(row.playerName);
    if (!p) continue;
    p.items={
      events:(row.itemEvents??[]).map(e=>({...e,sourceEventType:e.eventType,eventType:e.eventType==='ITEM_OWNERSHIP_ENTERED'?'ITEM_ADDED':e.eventType==='ITEM_OWNERSHIP_EXITED'?'ITEM_REMOVED':e.eventType})),
      finalItems:row.finalStandardShopItems??[],
      ownershipIntervals:row.ownershipIntervals??[],
      checkpointBuilds:row.checkpointBuilds??{},
      authority:'A142 runtime_item_ownership',
      source:'runtime_item_ownership_production_v01.json'
    };
  }
}

function applyIntegrated(playerByName,integrated,offset,matchEnd){
  if (!integrated) return;
  const bridgeByPlayer=new Map();
  for (const i of integrated.bridgeIntervals??[]) { const key=i.playerName??i.playerKey; if(!bridgeByPlayer.has(key))bridgeByPlayer.set(key,[]); bridgeByPlayer.get(key).push({...i,startTime:i.startTick/TICKS_PER_SECOND-offset,endTime:i.stateEndTick/TICKS_PER_SECOND-offset,durationSeconds:(i.stateEndTick-i.startTick)/TICKS_PER_SECOND}); }
  for (const ip of integrated.players??[]) {
    const name=ip.identity?.playerName??ip.playerKey; const p=playerByName.get(name); if(!p)continue;
    const itemEvents=[]; const ownership=new Map(); const ownershipStart=new Map(); const ownershipIntervals=[]; const permanentEvents=[];
    for (const e of ip.events??[]) {
      const time=e.tick/TICKS_PER_SECOND-offset;
      for (const item of e.itemAdds??[]) { ownership.set(item.itemId,item); ownershipStart.set(item.itemId,{time,tick:e.tick,item}); itemEvents.push({eventType:'ITEM_ADDED',time,tick:e.tick,item}); }
      for (const item of e.itemRemoves??[]) { const start=ownershipStart.get(item.itemId); itemEvents.push({eventType:'ITEM_REMOVED',time,tick:e.tick,item}); if(start)ownershipIntervals.push({item:start.item,startTime:start.time,endTime:time,durationSeconds:time-start.time,endReason:'REMOVED'}); ownership.delete(item.itemId); ownershipStart.delete(item.itemId); }
      if (e.causes?.includes('PERMANENT_WORLD_BUFF_STATE') && e.permanentBuffState) permanentEvents.push({tick:e.tick,time,state:e.permanentBuffState});
    }
    for (const start of ownershipStart.values()) ownershipIntervals.push({item:start.item,startTime:start.time,endTime:matchEnd,durationSeconds:Math.max(0,matchEnd-start.time),endReason:'REPLAY_END'});
    const finalOwnership=ip.finalState?.authoritativeOwnership??{};
    p.items={events:itemEvents,finalItems:finalOwnership.standardShopItems??[...ownership.values()],ownershipIntervals};
    p.permanentBuffs={events:permanentEvents,final:finalOwnership.permanentWorldBuffs??{},summary:summarizePermanent(finalOwnership.permanentWorldBuffs??{})};
    p.bridgeBuffs={intervals:bridgeByPlayer.get(name)??[],finalActive:finalOwnership.activeBridgeBuffs??[]};
  }
}

function summarizePermanent(state){const families={};let totalUnits=0;for(const [key,v] of Object.entries(state??{})){const units=finite(v?.inferredUnits)??0;families[key]={inferredUnits:units,totalValue:finite(v?.totalValue)??0,rows:v?.rows??[]};totalUnits+=units;}return{totalUnits,families};}

function applyBehavioral(playerByName,behavioral,resourceFeatures){
  for(const b of behavioral?.players??[]){const p=playerByName.get(b.playerName);if(!p)continue;p.behavioral={movement:b.movement??{},resourceExposure:b.resourceExposure??{},breakables:b.knownBreakableActions??{},melee:b.melee??{},soulOrbs:b.soulOrbBehavior??{}};}
  for(const r of resourceFeatures?.players??[]){const p=playerByName.get(r.playerName);if(p)p.resourceFeatures=r;}
}
function applyRewards(playerByName,rewardSummary,breakSummary){
  for(const c of rewardSummary?.collectors??[]){const p=playerByName.get(c.playerName);if(p)p.rewardCollector=c;}
  for(const bp of breakSummary?.players??[]){const name=bp.playerName;const p=playerByName.get(name);if(p)p.breakableAction=bp;}
}
function applyCitemxp(playerByName,citemxp){
  if(!citemxp)return; const agg=new Map();
  for(const e of citemxp.events??[]){const names=new Set([e.winnerPlayerName,e.firstHitPlayerName].filter(Boolean));for(const name of names){const a=agg.get(name)??{events:0,shotEvents:0,secure:0,deny:0,claim:0,mixedTeam:0,bySource:{},byOutcome:{}};a.events++;if(e.shotObserved)a.shotEvents++;if(e.mixedTeamRace)a.mixedTeam++;const out=e.outcomeLabel??e.outcomeFamily??'UNRESOLVED';a.byOutcome[out]=(a.byOutcome[out]??0)+1;if(String(out).includes('SECURE'))a.secure++;if(String(out).includes('DENY'))a.deny++;if(String(out).includes('CLAIM'))a.claim++;const src=e.sourceType??'UNKNOWN';a.bySource[src]=(a.bySource[src]??0)+1;agg.set(name,a);}}
  for(const [name,a] of agg){const p=playerByName.get(name);if(p)p.citemxp=a;}
}
function applyGroundSouls(playerByName,summary){
  const counts=summary?.vacuumTargets?.playerCounts??{};
  if(Array.isArray(counts)){for(const row of counts){const p=playerByName.get(row.playerName??row.name);if(p)p.groundSoulTargets=finite(row.count)??finite(row.groundSouls)??0;}}
  else if(counts&&typeof counts==='object'){for(const [name,n] of Object.entries(counts)){const p=playerByName.get(name);if(p)p.groundSoulTargets=finite(n)??0;}}
}

async function aggregateWeaponEvents(path,playerByName,offset){
  if(!existsSync(path))return null; const byPlayer={};let discharges=0,reloadTransitions=0,events=0;
  for await(const e of readJsonl(path)){events++;const name=e.playerName??e.playerKey;if(!name)continue;const a=byPlayer[name]??={events:0,discharges:0,reloadTransitions:0,fireModeChanges:0,readyDelays:[],interAttackIntervals:[],lastDischargeTime:null,lastFireMode:null};a.events++;
    const time=finite(e.time)??(finite(e.tick)!==null?e.tick/TICKS_PER_SECOND:null);const mt=time===null?null:time-offset;
    const discharge=Boolean(e.discharge ?? e.transition?.actualDischargeSignal);
    if(discharge){discharges++;a.discharges++;if(mt!==null&&a.lastDischargeTime!==null&&mt>=a.lastDischargeTime)a.interAttackIntervals.push(mt-a.lastDischargeTime);a.lastDischargeTime=mt;
      const before=e.directRuntime?.before??{},after=e.directRuntime?.after??{};const last=finite(after.lastAttackTime??after.m_flLastAttackTime??e.observedWeaponState?.lastAttackTime);const next=finite(after.nextPrimaryAttack??after.m_flNextPrimaryAttack??e.observedWeaponState?.nextPrimaryAttack);const candidate=finite(e.transition?.readyDelayCandidateSeconds);if(candidate!==null&&candidate>=0)a.readyDelays.push(candidate);else if(last!==null&&next!==null&&next>=last)a.readyDelays.push(next-last);
    }
    if(e.transition?.reloadTransition || e.eventType==='RELOAD_STATE_CHANGE'||e.eventType==='RELOAD_START'||e.eventType==='RELOAD_END'){reloadTransitions++;a.reloadTransitions++;}
    const fireMode=finite(e.observedWeaponState?.activeFireMode ?? e.directRuntime?.after?.activeFireMode);
    if(fireMode!==null){if(a.lastFireMode!==null&&fireMode!==a.lastFireMode)a.fireModeChanges++;a.lastFireMode=fireMode;}
  }
  for(const [name,a] of Object.entries(byPlayer)){a.meanInterAttackSeconds=mean(a.interAttackIntervals);a.medianInterAttackSeconds=median(a.interAttackIntervals);a.meanReadyDelaySeconds=mean(a.readyDelays);a.medianReadyDelaySeconds=median(a.readyDelays);a.interAttackSampleCount=a.interAttackIntervals.length;a.readyDelaySampleCount=a.readyDelays.length;delete a.interAttackIntervals;delete a.readyDelays;delete a.lastDischargeTime;delete a.lastFireMode;const p=playerByName.get(name);if(p)p.weapon=a;}
  return {events,discharges,reloadTransitions,byPlayer};
}

async function aggregateTroopers(path){
  if(!existsSync(path))return null;const byBaseType={},byVariant={},byTeam={},byLane={};let deaths=0;
  for await(const r of readJsonl(path)){
    deaths++;
    inc(byBaseType,r.trooper?.baseType??r.baseType??r.type??r.trooperType??'UNRESOLVED');
    inc(byVariant,r.variant?.label??r.variant??'UNRESOLVED');
    inc(byTeam,String(r.trooper?.team??r.team??'UNKNOWN'));
    inc(byLane,String(r.trooper?.lane??r.lane??r.laneColor??'UNKNOWN'));
  }
  return{deaths,byBaseType,byVariant,byTeam,byLane};
}

function finalizePlayer(p,core){
  const f=p.finalState??{};const minutes=Math.max(core.matchEndSeconds/60,1e-9);const deaths=f.deaths??p.deathsObserved.length;
  p.scoreboard={kills:f.kills??0,deaths,assists:f.assists??0,lastHits:f.lastHits??0,denies:f.denies??0,goldNetWorth:f.goldNetWorth??0,apNetWorth:f.apNetWorth??0,
    kd:safeDiv(f.kills??0,Math.max(deaths,1)),kda:safeDiv((f.kills??0)+(f.assists??0),Math.max(deaths,1)),killsPerMinute:(f.kills??0)/minutes,assistsPerMinute:(f.assists??0)/minutes,lastHitsPerMinute:(f.lastHits??0)/minutes,deniesPerMinute:(f.denies??0)/minutes};
  p.core={level:f.level,alive:f.alive,health:f.health,healthMax:f.healthMax,healthPercent:f.healthMax>0?f.health/f.healthMax:null,healthRegen:f.healthRegen,
    aliveSeconds:p.aliveSeconds,deadSeconds:p.deadSeconds,aliveShare:p.aliveShare,deathsObserved:p.deathsObserved.length,deathTimings:p.deathsObserved,respawns:p.respawnsObserved,
    survivalIntervals:p.survivalIntervals,averageLifeSeconds:p.averageLifeSeconds,totalRespawnDowntimeSeconds:p.totalRespawnDowntimeSeconds,
    minHealth:Number.isFinite(p.minHealth)?p.minHealth:null,maxHealth:Number.isFinite(p.maxHealth)?p.maxHealth:null,low25Seconds:p.low25Seconds,low50Seconds:p.low50Seconds,
    levelTimings:p.levelTimings,levelRatePerMinute:p.levelRatePerMinute,netWorthGainPerMinute:p.netWorthGainPerMinute,checkpoints:p.checkpoints};
  const mv=p.behavioral?.movement??{};p.movement={...mv,distancePerMinute:safeDiv(mv.travelDistanceXY,minutes),distancePerAliveMinute:safeDiv(mv.travelDistanceXY,p.aliveMinutes),movingShare:mv.validMovementSeconds?safeDiv(mv.movingSeconds,mv.validMovementSeconds):null};
  p.rank={};
  return p;
}

function finalizeTeams(players,series){
  const grouped=new Map();for(const p of players){const t=String(p.team);if(!grouped.has(t))grouped.set(t,[]);grouped.get(t).push(p);}
  const finalTeams={};
  for(const [team,ps] of grouped){finalTeams[team]={team:Number(team),players:ps.map(p=>p.playerName),goldNetWorth:sum(ps,p=>p.scoreboard.goldNetWorth),apNetWorth:sum(ps,p=>p.scoreboard.apNetWorth),level:sum(ps,p=>p.core.level??0),kills:sum(ps,p=>p.scoreboard.kills),deaths:sum(ps,p=>p.scoreboard.deaths),assists:sum(ps,p=>p.scoreboard.assists),lastHits:sum(ps,p=>p.scoreboard.lastHits),denies:sum(ps,p=>p.scoreboard.denies),permanentBuffUnits:sum(ps,p=>p.permanentBuffs?.summary?.totalUnits??0),bridgeUptimeSeconds:sum(ps,p=>(p.bridgeBuffs?.intervals??[]).reduce((a,b)=>a+(b.durationSeconds??0),0))};}
  const teamIds=Object.keys(finalTeams); if(teamIds.length===2){for(const team of teamIds){const other=teamIds.find(x=>x!==team);finalTeams[team].goldNetWorthDiff=finalTeams[team].goldNetWorth-finalTeams[other].goldNetWorth;}}
  const advantage={};for(const team of teamIds)advantage[team]={aheadSeconds:0,behindSeconds:0,tiedSeconds:0,maxLead:0,maxDeficit:0,minDiff:Infinity,maxDiff:-Infinity};
  for(let i=0;i<series.length-1;i++){const row=series[i],next=series[i+1],dt=Math.max(0,next.time-row.time);for(const team of teamIds){const other=teamIds.find(x=>x!==team);if(!other)continue;const diff=(row.teams?.[team]?.goldNetWorth??0)-(row.teams?.[other]?.goldNetWorth??0);const a=advantage[team];if(diff>0)a.aheadSeconds+=dt;else if(diff<0)a.behindSeconds+=dt;else a.tiedSeconds+=dt;a.maxLead=Math.max(a.maxLead,diff);a.maxDeficit=Math.min(a.maxDeficit,diff);a.minDiff=Math.min(a.minDiff,diff);a.maxDiff=Math.max(a.maxDiff,diff);}}
  for(const team of teamIds){advantage[team].largestSwing=(Number.isFinite(advantage[team].maxDiff)&&Number.isFinite(advantage[team].minDiff))?advantage[team].maxDiff-advantage[team].minDiff:null;finalTeams[team].advantage=advantage[team];}
  const matchRank=[...players].sort((a,b)=>b.scoreboard.goldNetWorth-a.scoreboard.goldNetWorth);matchRank.forEach((p,i)=>p.rank.matchNetWorth=i+1);
  for(const ps of grouped.values()){[...ps].sort((a,b)=>b.scoreboard.goldNetWorth-a.scoreboard.goldNetWorth).forEach((p,i)=>p.rank.teamNetWorth=i+1);for(const p of ps)p.teamNetWorthShare=safeDiv(p.scoreboard.goldNetWorth,finalTeams[String(p.team)].goldNetWorth);}
  return Object.values(finalTeams);
}

function buildTeamSeries(players,matchEndSeconds){
  const out=[];const end=Math.max(0,Math.floor(matchEndSeconds));
  const cursors=new Map(players.map(p=>[p.playerName,0]));
  for(let sec=0;sec<=end;sec++){
    const teams={};
    for(const p of players){
      const tl=p.timeline??[];if(!tl.length)continue;let i=cursors.get(p.playerName)??0;
      while(i+1<tl.length&&tl[i+1].matchTime<=sec)i++;cursors.set(p.playerName,i);const st=tl[i];
      if(st.matchTime>sec)continue;
      const team=String(p.team??'unknown');teams[team]??={goldNetWorth:0,apNetWorth:0,level:0,alive:0,players:0};
      const t=teams[team];t.goldNetWorth+=st.goldNetWorth??0;t.apNetWorth+=st.apNetWorth??0;t.level+=st.level??0;t.alive+=st.alive?1:0;t.players++;
    }
    out.push({time:sec,tick:Math.round((sec+30)*TICKS_PER_SECOND),teams});
  }
  return out;
}

function checkpointStates(timeline,points){const out={};for(const sec of points){let best=null;for(const s of timeline){if(s.matchTime<=sec)best=s;else break;}if(best)out[String(sec)]={time:best.matchTime,level:best.level,goldNetWorth:best.goldNetWorth,apNetWorth:best.apNetWorth,kills:best.kills,deaths:best.deaths,assists:best.assists,lastHits:best.lastHits,denies:best.denies,health:best.health,healthMax:best.healthMax};}return out;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function safeDiv(a,b){return Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Number(b)!==0?Number(a)/Number(b):null;}
function mean(a){const b=(a??[]).filter(Number.isFinite);return b.length?b.reduce((x,y)=>x+y,0)/b.length:null;}
function median(a){const b=(a??[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return null;const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2;}
function sum(a,f){return a.reduce((n,x)=>n+(Number(f(x))||0),0);}
function inc(o,k){o[k]=(o[k]??0)+1;}
function pick(o,keys){return Object.fromEntries(keys.map(k=>[k,o?.[k]]));}
function safeName(s){return String(s).replace(/[^A-Za-z0-9._-]/g,'_');}
