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
function quantile(sorted,q){if(!sorted.length)return null;const pos=(sorted.length-1)*q;const lo=Math.floor(pos),hi=Math.ceil(pos);if(lo===hi)return sorted[lo];const w=pos-lo;return sorted[lo]*(1-w)+sorted[hi]*w;}
