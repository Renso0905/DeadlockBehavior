const DEFAULT_CHECKPOINTS=[300,600,900,1200,1500,1800,2100,2400,2700,3000];

export function createUpgradeState() {
  return {declaredUpgradeLength:null,upgradeSlots:new Map()};
}

export function applyUpgradeVectorChanges(state,changes={}) {
  const beforeSlots=new Map(state.upgradeSlots);
  const beforeSet=currentUpgradeIdSet(state);
  const keys=Object.keys(changes??{});
  const touched=keys.some(field=>field==='m_vecUpgrades' || /^m_vecUpgrades\.\d{4}$/.test(field));
  if (!touched) return {touched:false,addedIds:[],removedIds:[],beforeSlots:serializeSlots(beforeSlots),afterSlots:serializeSlots(state.upgradeSlots)};

  if (Object.prototype.hasOwnProperty.call(changes,'m_vecUpgrades')) {
    const length=normalizeVectorLength(changes.m_vecUpgrades);
    if (length!==null) {
      state.declaredUpgradeLength=length;
      for (const slot of [...state.upgradeSlots.keys()]) if (slot>=length) state.upgradeSlots.delete(slot);
    }
  }

  for (const [fieldName,rawValue] of Object.entries(changes)) {
    const match=/^m_vecUpgrades\.(\d{4})$/.exec(fieldName);
    if (!match) continue;
    const slot=Number.parseInt(match[1],10);
    const itemId=normalizeItemId(rawValue);
    if (itemId===null || itemId===0) state.upgradeSlots.delete(slot);
    else state.upgradeSlots.set(slot,itemId);
  }

  const afterSet=currentUpgradeIdSet(state);
  return {
    touched:true,
    addedIds:difference(afterSet,beforeSet),
    removedIds:difference(beforeSet,afterSet),
    beforeSlots:serializeSlots(beforeSlots),
    afterSlots:serializeSlots(state.upgradeSlots),
    declaredUpgradeLength:state.declaredUpgradeLength,
  };
}

export function normalizeVectorLength(value) {
  if (typeof value==='bigint') value=Number(value);
  if (!Number.isFinite(value)) return null;
  const integer=Math.trunc(value);
  return integer>=0 && integer<=128 ? integer : null;
}

export function normalizeItemId(value) {
  if (typeof value==='bigint') {
    const n=Number(value);
    return Number.isSafeInteger(n) ? n>>>0 : null;
  }
  if (typeof value==='number' && Number.isFinite(value)) return Math.trunc(value)>>>0;
  if (typeof value==='string' && /^\d+$/.test(value.trim())) {
    const n=Number(value);
    return Number.isSafeInteger(n) ? n>>>0 : null;
  }
  return null;
}

export function currentUpgradeIdSet(state) {
  return new Set([...state.upgradeSlots.values()].filter(id=>Number.isInteger(id)&&id!==0));
}

export function serializeSlots(slots,resolveItem=id=>({itemId:id})) {
  return [...slots.entries()].sort((a,b)=>a[0]-b[0]).map(([slot,itemId])=>({slot,...resolveItem(itemId)}));
}

export function buildOwnershipViews({players=[],transitions=[],matchEndSeconds=0,checkpoints=DEFAULT_CHECKPOINTS}={}) {
  const byController=new Map();
  for (const player of players) {
    const controller=Number(player.entityIndex??player.controllerEntityIndex);
    if (!Number.isInteger(controller)) continue;
    byController.set(controller,{
      ...player,
      entityIndex:controller,
      itemEvents:[],
      ownershipIntervals:[],
      finalStandardShopItems:standardItems(player.finalUpgradeItems??[]),
      checkpointBuilds:{},
      integrity:{duplicateOwnershipEntries:0,orphanOwnershipExits:0},
      _open:new Map(),
    });
  }

  const ordered=[...transitions].sort((a,b)=>(finite(a.tick)??Infinity)-(finite(b.tick)??Infinity));
  for (const transition of ordered) {
    const controller=Number(transition.controllerEntityIndex);
    const player=byController.get(controller);
    if (!player) continue;
    const time=finite(transition.matchTimeSeconds);
    const tick=finite(transition.tick);

    for (const item of standardItems(transition.added??[])) {
      const id=Number(item.itemId);
      const event={eventType:'ITEM_OWNERSHIP_ENTERED',tick,time,playerName:player.playerName,steamId:player.steamId,controllerEntityIndex:controller,item};
      player.itemEvents.push(event);
      if (player._open.has(id)) {
        player.integrity.duplicateOwnershipEntries++;
        continue;
      }
      player._open.set(id,{item,startTick:tick,startTime:time});
    }

    for (const item of standardItems(transition.removed??[])) {
      const id=Number(item.itemId);
      const event={eventType:'ITEM_OWNERSHIP_EXITED',tick,time,playerName:player.playerName,steamId:player.steamId,controllerEntityIndex:controller,item};
      player.itemEvents.push(event);
      const open=player._open.get(id);
      if (!open) {
        player.integrity.orphanOwnershipExits++;
        continue;
      }
      const end=time??open.startTime;
      player.ownershipIntervals.push({
        item:open.item,startTick:open.startTick,endTick:tick,startTime:open.startTime,endTime:end,
        durationSeconds:bothFinite(open.startTime,end)?Math.max(0,end-open.startTime):null,endReason:'OWNERSHIP_EXITED'
      });
      player._open.delete(id);
    }
  }

  const end=finite(matchEndSeconds)??0;
  for (const player of byController.values()) {
    for (const open of player._open.values()) {
      player.ownershipIntervals.push({
        item:open.item,startTick:open.startTick,endTick:null,startTime:open.startTime,endTime:end,
        durationSeconds:bothFinite(open.startTime,end)?Math.max(0,end-open.startTime):null,endReason:'REPLAY_END'
      });
    }
    player.ownershipIntervals.sort((a,b)=>(finite(a.startTime)??Infinity)-(finite(b.startTime)??Infinity));
    player.itemEvents.sort((a,b)=>(finite(a.tick)??Infinity)-(finite(b.tick)??Infinity));
    for (const checkpoint of checkpoints) {
      if (checkpoint>end) continue;
      player.checkpointBuilds[String(checkpoint)]=itemsAtIntervals(player.ownershipIntervals,checkpoint);
    }
    delete player._open;
  }
  return [...byController.values()];
}

export function itemsAtIntervals(intervals,time) {
  const t=finite(time);
  if (t===null) return [];
  return (intervals??[])
    .filter(row=>{
      const start=finite(row.startTime),end=finite(row.endTime);
      if (start===null || end===null || start>t) return false;
      return row.endReason==='REPLAY_END' ? t<=end : t<end;
    })
    .map(row=>row.item);
}

function standardItems(items) {
  return (items??[]).filter(item=>item?.mapped===true && item?.resourceClass==='STANDARD_SHOP');
}
function difference(left,right){return [...left].filter(v=>!right.has(v)).sort((a,b)=>a-b);}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function bothFinite(a,b){return finite(a)!==null&&finite(b)!==null;}
