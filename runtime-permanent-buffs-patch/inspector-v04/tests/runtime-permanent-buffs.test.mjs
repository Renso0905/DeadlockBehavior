import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePermanentBuffProduction } from '../lib/runtime-permanent-buffs.mjs';

const candidate=(sourceId,family,tier,unit,valueType)=>({sourceId,buffClass:'PERMANENT_PICKUP',family,tier,recordKey:`${family}_lv${tier}`,modifierClass:'modifier_permanent_pickup',effects:[{modifierValue:`VALUE_${family}`,value:unit}],valueType});
const spirit=candidate(101,'spirit_permanent_pickup',1,2,158);
const hp=candidate(202,'hp_permanent_pickup',2,20,43);
const subclassMap={permanentCandidates:[spirit,hp]};
const expected={spirit_permanent_pickup:158,hp_permanent_pickup:43};

function tr(tick,sourceModifierId,valueType,beforeValue,afterValue,controllerEntityIndex=7){
  const before=beforeValue===null?null:{sourceModifierId,valueType,value:beforeValue};
  const after=afterValue===null?null:{sourceModifierId,valueType,value:afterValue};
  return {tick,demoSeconds:tick/64,matchTimeSeconds:tick/64-30,controllerEntityIndex,playerName:'Alpha',steamId:'1',team:2,vectorIndex:0,before,after};
}

test('permanent production accumulates exact tier units into family state',()=>{
  const transitions=[tr(2560,101,158,null,2),tr(3200,101,158,2,6),tr(3840,202,43,null,40)];
  const players=[{controllerEntityIndex:7,playerName:'Alpha',steamId:'1',team:2,finalRows:[{sourceModifierId:101,valueType:158,value:6},{sourceModifierId:202,valueType:43,value:40}]}];
  const out=derivePermanentBuffProduction({players,transitions,subclassMap,expectedFamilyValueTypes:expected});
  assert.equal(out.acquisitionEvents.length,3);
  assert.deepEqual(out.acquisitionEvents.map(x=>x.unitsAdded),[1,2,2]);
  const p=out.players[0];
  assert.equal(p.finalPermanentBuffs.spirit_permanent_pickup.inferredUnits,3);
  assert.equal(p.finalPermanentBuffs.spirit_permanent_pickup.totalValue,6);
  assert.equal(p.finalPermanentBuffs.hp_permanent_pickup.inferredUnits,2);
  assert.equal(p.summary.totalUnits,5);
  assert.equal(out.diagnostics.positiveAmountFailures.length,0);
  assert.equal(out.diagnostics.valueTypeFailures.length,0);
  assert.equal(out.diagnostics.finalConsistencyFailures.length,0);
});

test('zero permanent pickups is a valid empty production view',()=>{
  const players=[{controllerEntityIndex:7,playerName:'Alpha',steamId:'1',team:2,finalRows:[]}];
  const out=derivePermanentBuffProduction({players,transitions:[],subclassMap,expectedFamilyValueTypes:expected});
  assert.equal(out.acquisitionEvents.length,0);
  assert.deepEqual(out.players[0].finalPermanentBuffs,{});
  assert.equal(out.players[0].summary.totalUnits,0);
  assert.equal(out.diagnostics.positiveAmountFailures.length,0);
  assert.equal(out.diagnostics.finalAmountFailures.length,0);
});

test('row removal remains diagnostic and does not subtract permanent ownership',()=>{
  const transitions=[tr(2560,101,158,null,4),tr(3200,101,158,4,null)];
  const players=[{controllerEntityIndex:7,playerName:'Alpha',steamId:'1',team:2,finalRows:[]}];
  const out=derivePermanentBuffProduction({players,transitions,subclassMap,expectedFamilyValueTypes:expected});
  assert.equal(out.players[0].finalPermanentBuffs.spirit_permanent_pickup.inferredUnits,2);
  assert.equal(out.diagnostics.removalEvents.length,1);
  assert.equal(out.diagnostics.finalConsistencyFailures.length,0);
});

test('wrong family value type and non-integral amount are explicit failures',()=>{
  const transitions=[tr(2560,101,999,null,3)];
  const players=[{controllerEntityIndex:7,playerName:'Alpha',steamId:'1',team:2,finalRows:[{sourceModifierId:101,valueType:999,value:3}]}];
  const out=derivePermanentBuffProduction({players,transitions,subclassMap,expectedFamilyValueTypes:expected});
  assert.equal(out.diagnostics.valueTypeFailures.length,1);
  assert.equal(out.diagnostics.positiveAmountFailures.length,1);
  assert.equal(out.diagnostics.finalValueTypeFailures.length,1);
  assert.equal(out.diagnostics.finalAmountFailures.length,1);
});
