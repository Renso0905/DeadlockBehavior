const EPSILON=1e-5;

export function derivePermanentBuffProduction({players=[],transitions=[],subclassMap,expectedFamilyValueTypes={}}={}) {
  if (!subclassMap) throw new Error('subclassMap is required');
  const permanentById=new Map();
  for (const candidate of subclassMap.permanentCandidates??[]) {
    if (!permanentById.has(candidate.sourceId)) permanentById.set(candidate.sourceId,[]);
    permanentById.get(candidate.sourceId).push(candidate);
  }

  const contributions=[];
  for (const transition of transitions) contributions.push(...transitionContributions(transition,permanentById));
  contributions.sort(orderByTime);

  const permanentContributions=contributions.filter(x=>x.candidate);
  const positive=permanentContributions.filter(x=>Number.isFinite(x.delta)&&x.delta>EPSILON);
  const negativeInPlace=permanentContributions.filter(x=>x.contributionKind==='IN_PLACE_VALUE_DELTA'&&Number.isFinite(x.delta)&&x.delta<-EPSILON);
  const removals=permanentContributions.filter(x=>x.contributionKind==='ROW_REMOVE');
  const positiveAmountFailures=positive.filter(x=>!x.exactPositiveUnitMultiple);
  const valueTypeFailures=permanentContributions.filter(x=>{
    const expected=expectedFamilyValueTypes?.[x.family];
    return Number.isInteger(expected)&&Number.isInteger(x.valueType)&&x.valueType!==expected;
  });

  const finalRows=[];
  for (const player of players) {
    for (const row of player.finalRows??[]) {
      const candidate=solePermanentCandidate(permanentById,row.sourceModifierId);
      if (!candidate) continue;
      const unit=expectedUnit(candidate);
      const ratio=Number.isFinite(row.value)&&Number.isFinite(unit)&&Math.abs(unit)>EPSILON?row.value/unit:null;
      const expectedType=expectedFamilyValueTypes?.[candidate.family];
      finalRows.push({
        controllerEntityIndex:player.controllerEntityIndex??player.entityIndex??null,
        playerName:player.playerName??null,
        steamId:player.steamId??null,
        heroId:player.heroId??null,
        team:player.team??null,
        sourceModifierId:row.sourceModifierId,
        valueType:row.valueType??null,
        value:row.value??null,
        family:candidate.family,
        tier:candidate.tier,
        recordKey:candidate.recordKey,
        modifierClass:candidate.modifierClass,
        expectedUnitValue:unit,
        inferredUnits:nearlyInteger(ratio)&&ratio>=-EPSILON?Math.round(ratio):null,
        exactUnitMultiple:nearlyInteger(ratio)&&ratio>=-EPSILON,
        expectedValueType:Number.isInteger(expectedType)?expectedType:null,
        valueTypeMatches:!Number.isInteger(expectedType)||row.valueType===expectedType,
      });
    }
  }
  const finalAmountFailures=finalRows.filter(x=>!x.exactUnitMultiple);
  const finalValueTypeFailures=finalRows.filter(x=>!x.valueTypeMatches);

  const identities=new Map();
  for (const p of players) identities.set(controllerKey(p.controllerEntityIndex??p.entityIndex),{
    entityIndex:p.controllerEntityIndex??p.entityIndex??null,
    playerName:p.playerName??null,steamId:p.steamId??null,heroId:p.heroId??null,team:p.team??null
  });
  for (const c of permanentContributions) {
    const key=controllerKey(c.controllerEntityIndex);
    if (!identities.has(key)) identities.set(key,{entityIndex:c.controllerEntityIndex??null,playerName:c.playerName??null,steamId:c.steamId??null,heroId:c.heroId??null,team:c.team??null});
  }

  const stateByController=new Map();
  const outputPlayers=[...identities.entries()].map(([key,identity])=>{
    const out={...identity,acquisitionEvents:[],finalPermanentBuffs:{},summary:{totalUnits:0,families:{}}};
    stateByController.set(key,{out,families:new Map()});
    return out;
  });

  for (const row of positive) {
    if (!row.exactPositiveUnitMultiple) continue;
    const key=controllerKey(row.controllerEntityIndex);
    const bucket=stateByController.get(key);
    if (!bucket) continue;
    const family=bucket.families.get(row.family)??{inferredUnits:0,totalValue:0,rows:new Map()};
    family.inferredUnits+=row.inferredUnitCount;
    family.totalValue=cleanNumber(family.totalValue+row.delta);
    const sourceKey=String(row.sourceModifierId);
    const source=family.rows.get(sourceKey)??{
      sourceModifierId:row.sourceModifierId,recordKey:row.recordKey,tier:row.tier,unitValue:row.expectedUnitValue,inferredUnits:0,totalValue:0
    };
    source.inferredUnits+=row.inferredUnitCount;
    source.totalValue=cleanNumber(source.totalValue+row.delta);
    family.rows.set(sourceKey,source);
    bucket.families.set(row.family,family);
    const state=serializeFamilies(bucket.families);
    bucket.out.acquisitionEvents.push({
      eventType:'PERMANENT_BUFF_POSITIVE_ACCUMULATION',
      tick:row.tick??null,
      demoSeconds:row.demoSeconds??null,
      matchTimeSeconds:row.matchTimeSeconds??null,
      time:row.matchTimeSeconds??null,
      controllerEntityIndex:row.controllerEntityIndex??null,
      playerName:row.playerName??bucket.out.playerName,
      steamId:row.steamId??bucket.out.steamId,
      heroId:row.heroId??bucket.out.heroId,
      team:row.team??bucket.out.team,
      family:row.family,
      tier:row.tier,
      recordKey:row.recordKey,
      sourceModifierId:row.sourceModifierId,
      valueType:row.valueType,
      unitsAdded:row.inferredUnitCount,
      valueAdded:row.delta,
      expectedUnitValue:row.expectedUnitValue,
      state
    });
  }

  for (const [,bucket] of stateByController) {
    bucket.out.finalPermanentBuffs=serializeFamilies(bucket.families);
    bucket.out.summary=summarizeState(bucket.out.finalPermanentBuffs);
  }
  outputPlayers.sort((a,b)=>(Number(a.team??99)-Number(b.team??99))||String(a.playerName??'').localeCompare(String(b.playerName??'')));

  const finalConsistencyFailures=[];
  if (removals.length===0) {
    const finalByController=aggregateFinalRows(finalRows);
    for (const out of outputPlayers) {
      const expected=finalByController.get(controllerKey(out.entityIndex))??{};
      if (!statesEquivalent(out.finalPermanentBuffs,expected)) {
        finalConsistencyFailures.push({controllerEntityIndex:out.entityIndex,playerName:out.playerName,fromAcquisitions:out.finalPermanentBuffs,fromFinalRows:expected});
      }
    }
  }

  return {
    players:outputPlayers,
    acquisitionEvents:outputPlayers.flatMap(p=>p.acquisitionEvents),
    diagnostics:{
      permanentContributions:permanentContributions.length,
      positiveAccumulationEvents:positive.length,
      inferredPickupUnits:positive.filter(x=>x.exactPositiveUnitMultiple).reduce((n,x)=>n+x.inferredUnitCount,0),
      negativeInPlaceEvents:negativeInPlace,
      removalEvents:removals,
      positiveAmountFailures,
      valueTypeFailures,
      finalRows,
      finalAmountFailures,
      finalValueTypeFailures,
      finalConsistencyFailures,
      distinctPermanentSourceIds:[...new Set(permanentContributions.map(x=>x.sourceModifierId))].sort((a,b)=>a-b),
      observedFamilies:[...new Set(permanentContributions.map(x=>x.family))].sort(),
    }
  };
}

export function transitionContributions(transition,permanentById) {
  const before=transition?.before??null,after=transition?.after??null;
  const rows=[];
  if (before&&after&&before.sourceModifierId===after.sourceModifierId) {
    if (Number.isFinite(before.value)&&Number.isFinite(after.value)&&!nearlyEqual(before.value,after.value)) {
      rows.push(buildContribution(transition,after.sourceModifierId,after.valueType??before.valueType,before.value,after.value,after.value-before.value,'IN_PLACE_VALUE_DELTA',permanentById));
    }
    return rows;
  }
  if (before) rows.push(buildContribution(transition,before.sourceModifierId,before.valueType,before.value,null,Number.isFinite(before.value)?-before.value:null,'ROW_REMOVE',permanentById));
  if (after) rows.push(buildContribution(transition,after.sourceModifierId,after.valueType,null,after.value,Number.isFinite(after.value)?after.value:null,'ROW_ADD',permanentById));
  return rows;
}

function buildContribution(transition,sourceModifierId,valueType,beforeValue,afterValue,delta,contributionKind,permanentById) {
  const candidate=solePermanentCandidate(permanentById,sourceModifierId);
  const unit=expectedUnit(candidate);
  const ratio=Number.isFinite(delta)&&Number.isFinite(unit)&&Math.abs(unit)>EPSILON?delta/unit:null;
  const exactPositiveUnitMultiple=Number.isFinite(delta)&&delta>EPSILON&&nearlyInteger(ratio)&&ratio>0;
  return {
    tick:transition?.tick??null,demoSeconds:transition?.demoSeconds??null,matchTimeSeconds:transition?.matchTimeSeconds??null,
    controllerEntityIndex:transition?.controllerEntityIndex??null,playerName:transition?.playerName??null,steamId:transition?.steamId??null,heroId:transition?.heroId??null,team:transition?.team??null,
    vectorIndex:transition?.vectorIndex??null,contributionKind,sourceModifierId,valueType,beforeValue,afterValue,delta,candidate,
    family:candidate?.family??null,tier:candidate?.tier??null,recordKey:candidate?.recordKey??null,modifierClass:candidate?.modifierClass??null,
    expectedUnitValue:unit,exactPositiveUnitMultiple,inferredUnitCount:exactPositiveUnitMultiple?Math.round(ratio):null
  };
}

function aggregateFinalRows(rows) {
  const byController=new Map();
  for (const row of rows) {
    const key=controllerKey(row.controllerEntityIndex);
    const state=byController.get(key)??{};
    const family=state[row.family]??{inferredUnits:0,totalValue:0,rows:[]};
    if (Number.isInteger(row.inferredUnits)) family.inferredUnits+=row.inferredUnits;
    if (Number.isFinite(row.value)) family.totalValue=cleanNumber(family.totalValue+row.value);
    family.rows.push({sourceModifierId:row.sourceModifierId,recordKey:row.recordKey,tier:row.tier,unitValue:row.expectedUnitValue,inferredUnits:row.inferredUnits??0,totalValue:row.value??0});
    family.rows.sort((a,b)=>(Number(a.tier??99)-Number(b.tier??99))||Number(a.sourceModifierId)-Number(b.sourceModifierId));
    state[row.family]=family;
    byController.set(key,state);
  }
  return byController;
}

function statesEquivalent(a,b) {
  const keys=[...new Set([...Object.keys(a??{}),...Object.keys(b??{})])].sort();
  for (const k of keys) {
    const x=a?.[k]??{inferredUnits:0,totalValue:0},y=b?.[k]??{inferredUnits:0,totalValue:0};
    if ((x.inferredUnits??0)!==(y.inferredUnits??0)) return false;
    if (!nearlyEqual(Number(x.totalValue??0),Number(y.totalValue??0))) return false;
  }
  return true;
}

function serializeFamilies(map) {
  const out={};
  for (const [family,v] of [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
    out[family]={
      inferredUnits:v.inferredUnits,
      totalValue:cleanNumber(v.totalValue),
      rows:[...v.rows.values()].sort((a,b)=>(Number(a.tier??99)-Number(b.tier??99))||Number(a.sourceModifierId)-Number(b.sourceModifierId)).map(x=>({...x}))
    };
  }
  return out;
}

function summarizeState(state) {
  let totalUnits=0;const families={};
  for (const [family,v] of Object.entries(state??{})) {
    const units=Number(v?.inferredUnits)||0;totalUnits+=units;
    families[family]={inferredUnits:units,totalValue:Number(v?.totalValue)||0,rows:v?.rows??[]};
  }
  return {totalUnits,families};
}

function solePermanentCandidate(map,id) {
  const rows=map.get(id)??[];
  return rows.length===1&&rows[0]?.buffClass==='PERMANENT_PICKUP'?rows[0]:null;
}
function expectedUnit(candidate){const values=(candidate?.effects??[]).map(x=>x?.value).filter(Number.isFinite);return candidate?.buffClass==='PERMANENT_PICKUP'&&values.length===1?values[0]:null;}
function controllerKey(v){return String(v??'unknown');}
function nearlyEqual(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=EPSILON;}
function nearlyInteger(v){return Number.isFinite(v)&&Math.abs(v-Math.round(v))<=EPSILON;}
function cleanNumber(v){return Math.abs(v)<EPSILON?0:Number(v.toFixed(8));}
function orderByTime(a,b){return (Number(a.tick??0)-Number(b.tick??0))||(Number(a.vectorIndex??0)-Number(b.vectorIndex??0));}
