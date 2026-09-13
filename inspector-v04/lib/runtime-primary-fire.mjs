const TICKS_PER_SECOND = 64;
const ENTITY_INDEX_MASK = 0x3fff;
const INVALID_ENTITY_INDEX = ENTITY_INDEX_MASK;

export function resolveEntityHandleIndex(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    for (const key of ['index','entityIndex','entryIndex','entIndex']) {
      const n = finite(value[key]);
      if (n !== null) return normalizeIndex(n);
    }
    for (const key of ['handle','value','raw']) {
      const n = finite(value[key]);
      if (n !== null) return normalizeHandleNumber(n);
    }
    return null;
  }
  const n = finite(value);
  return n === null ? null : normalizeHandleNumber(n);
}

export function deriveDischargeTransition(previous, current, {tick=null,demoSeconds=null,matchClockOffsetSeconds=0}={}) {
  const prevShot = finite(previous?.shotNumber);
  const shot = finite(current?.shotNumber);
  if (prevShot === null || shot === null || shot <= prevShot) return null;

  const shotDelta = Math.trunc(shot - prevShot);
  if (shotDelta <= 0) return null;
  const prevLast = finite(previous?.lastAttackTime);
  const last = finite(current?.lastAttackTime);
  const next = finite(current?.nextPrimaryAttack);
  const lastAttackTimeAdvanced = last !== null && (prevLast === null || last > prevLast);
  const readyDelaySeconds = last !== null && next !== null && next >= last ? next - last : null;
  const ds = finite(demoSeconds) ?? (finite(tick) !== null ? Number(tick) / TICKS_PER_SECOND : null);
  const mt = ds === null ? null : ds - (finite(matchClockOffsetSeconds) ?? 0);

  return {
    shotNumberPrevious: prevShot,
    shotNumberCurrent: shot,
    shotDelta,
    dischargeUnits: shotDelta,
    lastAttackTime: last,
    nextPrimaryAttack: next,
    lastAttackTimeAdvancedSameTick: lastAttackTimeAdvanced,
    readyDelaySeconds,
    nextPrimaryReadyDemoSeconds: ds !== null && readyDelaySeconds !== null ? ds + readyDelaySeconds : null,
    nextPrimaryReadyMatchSeconds: mt !== null && readyDelaySeconds !== null ? mt + readyDelaySeconds : null,
  };
}

const DIRECT_STATE_KEYS = Object.freeze(['inReload','activeFireMode','continuousShots','burstShotsRemaining']);

export function derivePrimaryWeaponStateTransition(previous, current) {
  const state = {
    inReload:booleanOrNull(current?.inReload),
    activeFireMode:finite(current?.activeFireMode),
    continuousShots:finite(current?.continuousShots),
    burstShotsRemaining:finite(current?.burstShotsRemaining),
  };
  const prior = previous ? {
    inReload:booleanOrNull(previous.inReload),
    activeFireMode:finite(previous.activeFireMode),
    continuousShots:finite(previous.continuousShots),
    burstShotsRemaining:finite(previous.burstShotsRemaining),
  } : null;
  const changedFields = DIRECT_STATE_KEYS.filter(key => !prior || !Object.is(prior[key],state[key]));
  let reloadTransition=null;
  if (prior) {
    if (prior.inReload!==true && state.inReload===true) reloadTransition='RELOAD_ENTER';
    else if (prior.inReload===true && state.inReload!==true) reloadTransition='RELOAD_EXIT';
  }
  return {
    state,
    changedFields,
    changed:changedFields.length>0,
    reloadTransition,
    fireModeChanged:Boolean(prior&&prior.activeFireMode!==null&&state.activeFireMode!==null&&prior.activeFireMode!==state.activeFireMode),
    continuousShotsChanged:Boolean(prior&&prior.continuousShots!==null&&state.continuousShots!==null&&prior.continuousShots!==state.continuousShots),
    burstShotsRemainingChanged:Boolean(prior&&prior.burstShotsRemaining!==null&&state.burstShotsRemaining!==null&&prior.burstShotsRemaining!==state.burstShotsRemaining),
  };
}

export function buildPlayerPrimaryWeaponStateSummary(player, events, {matchEndSeconds=null}={}) {
  const ordered=[...(events??[])].sort((a,b)=>(a.tick??0)-(b.tick??0)||(a.sequence??0)-(b.sequence??0));
  const timeline=[];
  const reloadIntervals=[];
  const observedModes=new Set();
  const carrierObservations={inReload:0,activeFireMode:0,continuousShots:0,burstShotsRemaining:0};
  let reloadEnterCount=0,reloadExitCount=0,fireModeChanges=0,continuousChanges=0,burstChanges=0;
  const stateByWeapon=new Map();
  const reloadStartByWeapon=new Map();
  for(const event of ordered){
    const time=finite(event.matchTimeSeconds);
    const weaponKey=event.weaponEntityIndex??'UNSPECIFIED_WEAPON';
    if(event.eventType==='WEAPON_DELETE'||event.available===false){
      const reloadStart=reloadStartByWeapon.get(weaponKey)??null;
      if(reloadStart!==null&&time!==null){
        reloadIntervals.push({weaponEntityIndex:event.weaponEntityIndex??null,startTime:reloadStart,endTime:Math.max(reloadStart,time),durationSeconds:Math.max(0,time-reloadStart),endReason:'WEAPON_DELETE'});
      }
      reloadStartByWeapon.delete(weaponKey);stateByWeapon.delete(weaponKey);
      const fallback=[...stateByWeapon.values()].sort((a,b)=>(a.sequence??0)-(b.sequence??0)).at(-1)??null;
      timeline.push(fallback?{...fallback,tick:event.tick??null,matchTime:time,eventType:'WEAPON_DELETE_FALLBACK'}:{tick:event.tick??null,matchTime:time,available:false,eventType:'WEAPON_DELETE',weaponEntityIndex:event.weaponEntityIndex??null});
      continue;
    }
    const state=event.directState??event.state??{};
    const row={
      tick:event.tick??null,sequence:event.sequence??null,matchTime:time,available:true,eventType:event.eventType??'STATE_CHANGE',weaponEntityIndex:event.weaponEntityIndex??null,
      inReload:booleanOrNull(state.inReload),activeFireMode:finite(state.activeFireMode),continuousShots:finite(state.continuousShots),burstShotsRemaining:finite(state.burstShotsRemaining),
    };
    for(const key of DIRECT_STATE_KEYS)if(row[key]!==null)carrierObservations[key]++;
    if(row.activeFireMode!==null)observedModes.add(row.activeFireMode);
    const prior=stateByWeapon.get(weaponKey)??null;
    if(prior){
      if(prior.inReload!==true&&row.inReload===true){reloadEnterCount++;if(time!==null)reloadStartByWeapon.set(weaponKey,Math.max(0,time));}
      if(prior.inReload===true&&row.inReload!==true){
        reloadExitCount++;
        const reloadStart=reloadStartByWeapon.get(weaponKey)??null;
        if(reloadStart!==null&&time!==null)reloadIntervals.push({weaponEntityIndex:event.weaponEntityIndex??null,startTime:reloadStart,endTime:Math.max(reloadStart,time),durationSeconds:Math.max(0,time-reloadStart),endReason:'RELOAD_EXIT'});
        reloadStartByWeapon.delete(weaponKey);
      }
      if(prior.activeFireMode!==null&&row.activeFireMode!==null&&prior.activeFireMode!==row.activeFireMode)fireModeChanges++;
      if(prior.continuousShots!==null&&row.continuousShots!==null&&prior.continuousShots!==row.continuousShots)continuousChanges++;
      if(prior.burstShotsRemaining!==null&&row.burstShotsRemaining!==null&&prior.burstShotsRemaining!==row.burstShotsRemaining)burstChanges++;
    }else if(row.inReload===true&&time!==null)reloadStartByWeapon.set(weaponKey,Math.max(0,time));
    timeline.push(row);stateByWeapon.set(weaponKey,row);
  }
  const end=finite(matchEndSeconds);
  if(end!==null)for(const [weaponKey,reloadStart] of reloadStartByWeapon)if(end>=reloadStart)reloadIntervals.push({weaponEntityIndex:weaponKey==='UNSPECIFIED_WEAPON'?null:weaponKey,startTime:reloadStart,endTime:end,durationSeconds:end-reloadStart,endReason:'REPLAY_END_CENSORED'});
  const latest=[...timeline].reverse().find(row=>row.available)??null;
  return {
    controllerEntityIndex:player?.controllerEntityIndex??null,
    playerName:player?.playerName??null,
    steamId:player?.steamId??null,
    heroId:player?.heroId??null,
    team:player?.team??null,
    observations:ordered.filter(e=>e.eventType!=='WEAPON_DELETE'&&e.available!==false).length,
    timeline,
    carrierObservations,
    allDirectCarriersObserved:DIRECT_STATE_KEYS.every(key=>carrierObservations[key]>0),
    reload:{enterCount:reloadEnterCount,exitCount:reloadExitCount,intervals:reloadIntervals,completedIntervals:reloadIntervals.filter(x=>x.endReason==='RELOAD_EXIT').length},
    fireMode:{changeCount:fireModeChanges,observedModes:[...observedModes].sort((a,b)=>a-b)},
    burstContinuous:{continuousChangeCount:continuousChanges,burstRemainingChangeCount:burstChanges},
    lastObservedState:latest?{tick:latest.tick,matchTime:latest.matchTime,inReload:latest.inReload,activeFireMode:latest.activeFireMode,continuousShots:latest.continuousShots,burstShotsRemaining:latest.burstShotsRemaining}:null,
  };
}

export function summarizeNumbers(values) {
  const a=(values??[]).map(finite).filter(v=>v!==null).sort((x,y)=>x-y);
  if (!a.length) return {count:0,min:null,p25:null,median:null,p75:null,max:null,mean:null};
  return {
    count:a.length,
    min:a[0],
    p25:quantile(a,.25),
    median:quantile(a,.5),
    p75:quantile(a,.75),
    max:a[a.length-1],
    mean:a.reduce((x,y)=>x+y,0)/a.length,
  };
}

export function buildPlayerPrimaryFireSummary(player, events) {
  const ordered=[...(events??[])].sort((a,b)=>(a.tick??0)-(b.tick??0));
  const intervals=[];
  const delays=[];
  let previous=null;
  let dischargeUnits=0;
  let corroboratedUnits=0;
  let invalidReadyDelayEvents=0;
  for (const e of ordered) {
    dischargeUnits += Math.max(0,Math.trunc(finite(e.dischargeUnits)??0));
    if (e.lastAttackTimeAdvancedSameTick) corroboratedUnits += Math.max(0,Math.trunc(finite(e.dischargeUnits)??0));
    const d=finite(e.readyDelaySeconds);
    if (d!==null && d>=0) delays.push(d); else invalidReadyDelayEvents++;
    const currentUnits=Math.max(0,Math.trunc(finite(e.dischargeUnits)??0));
    const previousUnits=previous?Math.max(0,Math.trunc(finite(previous.dischargeUnits)??0)):0;
    if (previous && previous.weaponEntityIndex===e.weaponEntityIndex && previousUnits===1 && currentUnits===1) {
      const a=finite(previous.demoSeconds), b=finite(e.demoSeconds);
      if (a!==null && b!==null && b>=a) intervals.push(b-a);
    }
    previous=e;
  }
  const aliveSeconds=Math.max(0,finite(player?.aliveSeconds)??0);
  const aliveMinutes=aliveSeconds/60;
  const last=ordered.length?ordered[ordered.length-1]:null;
  return {
    controllerEntityIndex:player?.controllerEntityIndex??null,
    pawnEntityIndexes:[...(player?.pawnEntityIndexes??[])].sort((a,b)=>a-b),
    playerName:player?.playerName??null,
    steamId:player?.steamId??null,
    heroId:player?.heroId??null,
    team:player?.team??null,
    aliveSeconds,
    dischargeEvents:ordered.length,
    nextPrimaryReadyTimeline:ordered.map(e=>({tick:e.tick,matchTime:e.matchTimeSeconds,nextPrimaryAttack:e.nextPrimaryAttack})),
    discharges:dischargeUnits,
    primaryAttacksPerAliveMinute:aliveMinutes>0?dischargeUnits/aliveMinutes:null,
    corroboratedDischargeUnits:corroboratedUnits,
    lastAttackCorroborationRate:dischargeUnits>0?corroboratedUnits/dischargeUnits:null,
    interAttackIntervalSeconds:summarizeNumbers(intervals),
    readyDelaySeconds:summarizeNumbers(delays),
    invalidReadyDelayEvents,
    lastObservedNextPrimaryReady:last?{
      tick:last.tick??null,
      demoSeconds:last.nextPrimaryReadyDemoSeconds??null,
      matchTimeSeconds:last.nextPrimaryReadyMatchSeconds??null,
      runtimeTime:last.nextPrimaryAttack??null,
    }:null,
  };
}

export function isPrimaryWeaponTelemetryEntity(entity) {
  if (!entity) return false;
  const shot=entity.getField?.('m_nShotNumber');
  const last=entity.getField?.('m_flLastAttackTime');
  const next=entity.getField?.('m_flNextPrimaryAttack');
  if (shot===undefined || last===undefined || next===undefined) return false;
  const name=String(entity?.class?.name??'');
  return name.includes('PrimaryWeapon') || name.includes('Primary_Weapon') || name.includes('Primary_Weapon') || name.includes('Weapon');
}

function normalizeHandleNumber(n) {
  const raw=Math.trunc(n);
  if (raw < 0) return null;
  const direct=normalizeIndex(raw);
  if (raw <= ENTITY_INDEX_MASK && direct!==null) return direct;
  return normalizeIndex(raw & ENTITY_INDEX_MASK);
}
function normalizeIndex(n) {
  const i=Math.trunc(n);
  return i>=0 && i<INVALID_ENTITY_INDEX ? i : null;
}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function booleanOrNull(v){return v===true||v===1?true:v===false||v===0?false:null;}
function quantile(sorted,q){if(!sorted.length)return null;const pos=(sorted.length-1)*q;const lo=Math.floor(pos),hi=Math.ceil(pos);if(lo===hi)return sorted[lo];const w=pos-lo;return sorted[lo]*(1-w)+sorted[hi]*w;}
