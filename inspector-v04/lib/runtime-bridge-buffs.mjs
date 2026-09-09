export const BRIDGE_RECORD_KEYS=Object.freeze([
  'gun_powerup_pickup','survival_powerup_pickup','casting_powerup_pickup','movement_powerup_pickup'
]);
export const COLLECTOR_DISTANCE_GATE_HU=300;
export const MAX_SNAPSHOT_GAP_TICKS=16;

export function deriveBridgeIntervals({
  players=[], powerups=[], collectionCandidates=[], snapshots=[], deathEvents=[],
  matchClockOffsetSeconds=0, replayEndTick=null, matchEndTick=null, gameplayState=null,
  ticksPerSecond=64, collectorDistanceGateHU=COLLECTOR_DISTANCE_GATE_HU,
  maxSnapshotGapTicks=MAX_SNAPSHOT_GAP_TICKS,
}={}) {
  const byRecord=new Map(powerups.map(x=>[x.recordKey,x]));
  const playerRows=new Map(players.map(p=>[playerKey(p),p]));
  const deathsByController=new Map();
  for (const d of deathEvents) {
    const key=Number(d.controllerEntityIndex);
    if (!deathsByController.has(key)) deathsByController.set(key,[]);
    deathsByController.get(key).push(d);
  }
  for (const rows of deathsByController.values()) rows.sort((a,b)=>a.tick-b.tick);
  const sortedSnapshots=[...snapshots].filter(x=>Number.isFinite(x.tick)).sort((a,b)=>a.tick-b.tick);
  const diagnostics={
    candidateActiveDowns:0, attributedCollections:0, unattributedGameplayActiveDowns:[],
    nonGameplayActiveDowns:[], snapshotGapFailures:[], overDistanceGate:[], unknownRecordKeys:[],
    invalidIntervals:[], duplicateCollectionKeys:[],
  };
  const seenCollections=new Set();
  const intervals=[];
  const collections=[];

  for (const c of [...collectionCandidates].sort((a,b)=>a.tick-b.tick)) {
    diagnostics.candidateActiveDowns++;
    const resource=byRecord.get(c.recordKey);
    if (!resource) { diagnostics.unknownRecordKeys.push(c); continue; }
    if (gameplayState!==null && c.gameState!==null && c.gameState!==undefined && c.gameState!==gameplayState) {
      diagnostics.nonGameplayActiveDowns.push(c); continue;
    }
    const snap=nearestSnapshot(sortedSnapshots,c.tick);
    const gap=snap?Math.abs(snap.tick-c.tick):Infinity;
    if (!snap || gap>maxSnapshotGapTicks) {
      diagnostics.snapshotGapFailures.push({...compactCandidate(c),snapshotTick:snap?.tick??null,snapshotGapTicks:Number.isFinite(gap)?gap:null});
      diagnostics.unattributedGameplayActiveDowns.push(c); continue;
    }
    const nearest=nearestAlivePlayer(snap.players??[],c.position);
    if (!nearest || nearest.distanceHU>collectorDistanceGateHU) {
      diagnostics.overDistanceGate.push({...compactCandidate(c),snapshotTick:snap.tick,snapshotGapTicks:snap.tick-c.tick,nearest:nearest?compactNearest(nearest):null});
      diagnostics.unattributedGameplayActiveDowns.push(c); continue;
    }
    const p=nearest.player;
    const ckey=`${c.entityIndex}:${c.tick}:${c.recordKey}`;
    if (seenCollections.has(ckey)) { diagnostics.duplicateCollectionKeys.push(ckey); continue; }
    seenCollections.add(ckey);

    const durationSeconds=Number(resource.durationSeconds);
    const nominalEndTick=c.tick+Math.round(durationSeconds*ticksPerSecond);
    let stateEndTick=nominalEndTick;
    let terminationReason='NATURAL_EXPIRATION';
    let terminationObserved=true;
    const deaths=deathsByController.get(Number(p.controllerEntityIndex))??[];
    const death=deaths.find(x=>x.tick>=c.tick && x.tick<stateEndTick);
    if (death) { stateEndTick=death.tick; terminationReason='DEATH_TERMINATION'; terminationObserved=true; }
    if (Number.isFinite(matchEndTick) && matchEndTick>=c.tick && matchEndTick<stateEndTick) {
      stateEndTick=matchEndTick; terminationReason='MATCH_END_CENSORED'; terminationObserved=false;
    }
    if (Number.isFinite(replayEndTick) && replayEndTick>=c.tick && replayEndTick<stateEndTick) {
      stateEndTick=replayEndTick; terminationReason='REPLAY_END_CENSORED'; terminationObserved=false;
    }
    const startTime=c.tick/ticksPerSecond-matchClockOffsetSeconds;
    const nominalEndTime=nominalEndTick/ticksPerSecond-matchClockOffsetSeconds;
    const endTime=stateEndTick/ticksPerSecond-matchClockOffsetSeconds;
    const interval={
      intervalId:`bridge-${intervals.length+1}`,
      playerName:p.playerName,steamId:p.steamId??null,controllerEntityIndex:p.controllerEntityIndex??null,
      heroId:p.heroId??null,team:p.team??null,
      buffType:c.recordKey,recordKey:c.recordKey,modifierClass:resource.modifierClass??null,
      sourceEntityIndex:c.entityIndex??null,recordId:c.recordId??null,
      startTick:c.tick,nominalEndTick,stateEndTick,
      startTime,nominalEndTime,endTime,durationSeconds:Math.max(0,(stateEndTick-c.tick)/ticksPerSecond),
      resourceDurationSeconds:durationSeconds,terminationReason,terminationObserved,
      collectionDistanceHU:nearest.distanceHU,collectorSnapshotTick:snap.tick,collectorSnapshotGapTicks:snap.tick-c.tick,
      position:c.position??null,
    };
    if (!Number.isFinite(interval.durationSeconds)||interval.stateEndTick<interval.startTick) diagnostics.invalidIntervals.push(interval);
    intervals.push(interval);
    collections.push({
      eventType:'BRIDGE_POWERUP_COLLECTED',tick:c.tick,matchTimeSeconds:startTime,time:startTime,
      playerName:p.playerName,steamId:p.steamId??null,controllerEntityIndex:p.controllerEntityIndex??null,heroId:p.heroId??null,team:p.team??null,
      recordKey:c.recordKey,buffType:c.recordKey,modifierClass:resource.modifierClass??null,recordId:c.recordId??null,
      sourceEntityIndex:c.entityIndex??null,collectionDistanceHU:nearest.distanceHU,collectorSnapshotTick:snap.tick,
      collectorSnapshotGapTicks:snap.tick-c.tick,position:c.position??null,
      terminationReason,stateEndTick,endTime,durationSeconds:interval.durationSeconds,
    });
    diagnostics.attributedCollections++;
  }

  const intervalsByPlayer=new Map();
  for (const i of intervals) {
    const key=playerKey(i);
    if (!intervalsByPlayer.has(key)) intervalsByPlayer.set(key,[]);
    intervalsByPlayer.get(key).push(i);
  }
  const collectionByPlayer=new Map();
  for (const e of collections) {
    const key=playerKey(e);
    if (!collectionByPlayer.has(key)) collectionByPlayer.set(key,[]);
    collectionByPlayer.get(key).push(e);
  }
  const outPlayers=players.map(p=>{
    const key=playerKey(p),rows=intervalsByPlayer.get(key)??[];
    return {...p,bridgeIntervals:rows,collectionEvents:collectionByPlayer.get(key)??[],summary:summarizeBridgeIntervals(rows)};
  });
  return {players:outPlayers,intervals,collectionEvents:collections,diagnostics};
}

export function summarizeBridgeIntervals(intervals=[]) {
  const byFamily={}; const termination={}; let totalUptimeSeconds=0;
  for (const i of intervals) {
    totalUptimeSeconds+=Number(i.durationSeconds)||0;
    byFamily[i.recordKey]=(byFamily[i.recordKey]??0)+1;
    termination[i.terminationReason]=(termination[i.terminationReason]??0)+1;
  }
  const overlap=overlapSummary(intervals);
  return {collections:intervals.length,totalUptimeSeconds,byFamily,termination,maxConcurrent:overlap.maxConcurrent,overlapSeconds:overlap.overlapSeconds};
}

export function overlapSummary(intervals=[]) {
  const events=[];
  for (const i of intervals) {
    if (!Number.isFinite(i.startTime)||!Number.isFinite(i.endTime)||i.endTime<i.startTime) continue;
    events.push([i.startTime,1],[i.endTime,-1]);
  }
  events.sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  let active=0,maxConcurrent=0,overlapSeconds=0,last=null;
  for (const [time,delta] of events) {
    if (last!==null && active>=2) overlapSeconds+=Math.max(0,time-last);
    active+=delta; maxConcurrent=Math.max(maxConcurrent,active); last=time;
  }
  return {maxConcurrent,overlapSeconds};
}

function nearestSnapshot(snapshots,tick){
  let lo=0,hi=snapshots.length-1;if(hi<0)return null;
  while(lo<=hi){const mid=(lo+hi)>>1;if(snapshots[mid].tick<tick)lo=mid+1;else hi=mid-1;}
  const a=snapshots[Math.max(0,Math.min(snapshots.length-1,lo))],b=snapshots[Math.max(0,Math.min(snapshots.length-1,lo-1))];
  if(!a)return b??null;if(!b)return a;return Math.abs(a.tick-tick)<Math.abs(b.tick-tick)?a:b;
}
function nearestAlivePlayer(players,position){
  if(!validPosition(position))return null;let best=null;
  for(const p of players){if(p.alive!==true||!validPosition(p.position))continue;const dx=p.position[0]-position.x,dy=p.position[1]-position.y,dz=p.position[2]-position.z;const d=Math.hypot(dx,dy,dz);if(!best||d<best.distanceHU)best={player:p,distanceHU:d};}
  return best;
}
function validPosition(p){return Array.isArray(p)?p.length>=3&&p.every(Number.isFinite):p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z);}
function playerKey(p){return p.controllerEntityIndex!=null?`controller:${p.controllerEntityIndex}`:p.steamId!=null?`steam:${p.steamId}`:`name:${p.playerName}`;}
function compactNearest(n){return{playerName:n.player.playerName,controllerEntityIndex:n.player.controllerEntityIndex,distanceHU:n.distanceHU};}
function compactCandidate(c){return{tick:c.tick,entityIndex:c.entityIndex,recordKey:c.recordKey,recordId:c.recordId,gameState:c.gameState,position:c.position};}
