import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUpgradeVectorChanges, buildOwnershipViews, createUpgradeState } from '../lib/runtime-items.mjs';

const item=id=>({itemId:id,mapped:true,resourceClass:'STANDARD_SHOP',recordKey:`item_${id}`});

test('upgrade vector reconstruction uses set semantics across compaction',()=>{
  const state=createUpgradeState();
  let x=applyUpgradeVectorChanges(state,{'m_vecUpgrades':2,'m_vecUpgrades.0000':101,'m_vecUpgrades.0001':202});
  assert.deepEqual(x.addedIds,[101,202]);
  assert.deepEqual(x.removedIds,[]);
  x=applyUpgradeVectorChanges(state,{'m_vecUpgrades.0000':202,'m_vecUpgrades.0001':101});
  assert.deepEqual(x.addedIds,[]);
  assert.deepEqual(x.removedIds,[]);
  x=applyUpgradeVectorChanges(state,{'m_vecUpgrades':1,'m_vecUpgrades.0000':202});
  assert.deepEqual(x.addedIds,[]);
  assert.deepEqual(x.removedIds,[101]);
});

test('ownership intervals preserve removal and re-entry without calling either a sale',()=>{
  const players=[{entityIndex:7,playerName:'Alpha',steamId:'1',finalUpgradeItems:[item(11)]}];
  const transitions=[
    {tick:640,matchTimeSeconds:10,controllerEntityIndex:7,added:[item(11)],removed:[]},
    {tick:1280,matchTimeSeconds:20,controllerEntityIndex:7,added:[],removed:[item(11)]},
    {tick:1920,matchTimeSeconds:30,controllerEntityIndex:7,added:[item(11)],removed:[]},
  ];
  const [p]=buildOwnershipViews({players,transitions,matchEndSeconds:50,checkpoints:[15,25,40]});
  assert.deepEqual(p.itemEvents.map(e=>e.eventType),['ITEM_OWNERSHIP_ENTERED','ITEM_OWNERSHIP_EXITED','ITEM_OWNERSHIP_ENTERED']);
  assert.deepEqual(p.ownershipIntervals.map(x=>[x.startTime,x.endTime,x.endReason]),[[10,20,'OWNERSHIP_EXITED'],[30,50,'REPLAY_END']]);
  assert.equal(p.checkpointBuilds['15'].length,1);
  assert.equal(p.checkpointBuilds['25'].length,0);
  assert.equal(p.checkpointBuilds['40'].length,1);
  assert.ok(!JSON.stringify(p).includes('SOLD'));
});
