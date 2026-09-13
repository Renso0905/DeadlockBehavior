import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseBenignSameTickReactivationFragments } from '../lib/runtime-ground-soul-lifecycle.mjs';

function episode(overrides={}){
  return {
    activationId:'3003|1',entityIndex:3003,sequence:1,activationTick:100,
    activationDemoSeconds:100/64,activationMatchTimeSeconds:1,
    targeted:false,targetOnsetTick:null,targetEntityIndex:null,
    endTick:100,endDemoSeconds:100/64,endMatchTimeSeconds:1,durationSeconds:0,
    endReason:'REACTIVATED_WITHOUT_INACTIVE_CENSORED',finalized:true,censored:true,
    ...overrides,
  };
}

test('exact same-tick reactivation fragment is removed while successor is retained',()=>{
  const rows=[
    episode(),
    episode({activationId:'3003|2',sequence:2,targeted:true,targetOnsetTick:101,targetEntityIndex:17,endTick:130,endDemoSeconds:130/64,durationSeconds:30/64,endReason:'BECAME_INACTIVE',censored:false}),
  ];
  const result=collapseBenignSameTickReactivationFragments(rows);
  assert.equal(result.removedCount,1);
  assert.equal(rows.length,1);
  assert.equal(rows[0].sequence,2);
  assert.equal(rows[0].endReason,'BECAME_INACTIVE');
  assert.equal(result.unresolvedDuplicateGroups,0);
});

test('arbitrary duplicate activation keys are not silently discarded',()=>{
  const rows=[
    episode({endReason:'BECAME_INACTIVE',censored:false,endTick:101,durationSeconds:1/64}),
    episode({activationId:'3003|2',sequence:2,endReason:'BECAME_INACTIVE',censored:false,endTick:130,durationSeconds:30/64}),
  ];
  const result=collapseBenignSameTickReactivationFragments(rows);
  assert.equal(result.removedCount,0);
  assert.equal(rows.length,2);
  assert.equal(result.unresolvedDuplicateGroups,1);
});

test('fragment signature must be an exact two-record consecutive sequence',()=>{
  const rows=[
    episode(),
    episode({activationId:'3003|3',sequence:3,endTick:130,endDemoSeconds:130/64,durationSeconds:30/64,endReason:'BECAME_INACTIVE',censored:false}),
  ];
  const result=collapseBenignSameTickReactivationFragments(rows);
  assert.equal(result.removedCount,0);
  assert.equal(rows.length,2);
  assert.equal(result.unresolvedDuplicateGroups,1);
});
