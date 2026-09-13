import test from 'node:test';
import assert from 'node:assert/strict';
import { beginGroundSoulEpisode, buildGroundSoulLifecycleSummary, compareActivationKeys, decodeSource2EntityHandle, finishGroundSoulEpisode, observeGroundSoulEpisode } from '../lib/runtime-ground-soul-lifecycle.mjs';

test('Source2 vacuum handles reject sentinels and resolve low 14-bit entity index',()=>{
  assert.equal(decodeSource2EntityHandle(0),null);
  assert.equal(decodeSource2EntityHandle(16777215),null);
  assert.equal(decodeSource2EntityHandle(0xffffffff),null);
  const decoded=decodeSource2EntityHandle((37|(19<<14))>>>0);
  assert.equal(decoded.entityIndex,37);
});

test('Ground Soul lifecycle records physical vacuum targeting without calling it economic collection',()=>{
  const e=beginGroundSoulEpisode({entityIndex:2914,sequence:1,tick:100,demoSeconds:1.5625,matchTimeSeconds:0,team:2,subclassId:607220400,active:true,interactive:false,vacuumTarget:16777215});
  assert.equal(e.targeted,false);
  observeGroundSoulEpisode(e,{tick:108,matchTimeSeconds:.125,vacuumTarget:(91|(3<<14))>>>0});
  assert.equal(e.targeted,true);assert.equal(e.targetEntityIndex,91);assert.equal(e.finalized,false);
  finishGroundSoulEpisode(e,{tick:140,demoSeconds:2.1875,matchTimeSeconds:.625,endReason:'BECAME_INACTIVE',censored:false});
  assert.equal(e.durationSeconds,.625);assert.equal(e.endReason,'BECAME_INACTIVE');assert.equal(e.censored,false);
});

test('Lifecycle summary excludes censored episodes from completed-duration statistic',()=>{
  const a=beginGroundSoulEpisode({entityIndex:1,sequence:1,tick:64,demoSeconds:1,matchTimeSeconds:1,team:2,active:true,vacuumTarget:0});
  finishGroundSoulEpisode(a,{tick:128,demoSeconds:2,matchTimeSeconds:2,endReason:'BECAME_INACTIVE',censored:false});
  const b=beginGroundSoulEpisode({entityIndex:2,sequence:1,tick:192,demoSeconds:3,matchTimeSeconds:3,team:3,active:true,vacuumTarget:0});
  finishGroundSoulEpisode(b,{tick:320,demoSeconds:5,matchTimeSeconds:5,endReason:'REPLAY_END_CENSORED',censored:true});
  const s=buildGroundSoulLifecycleSummary([b,a]);
  assert.equal(s.activations,2);assert.equal(s.completedActiveToInactive,1);assert.equal(s.censoredActivations,1);assert.equal(s.medianCompletedDurationSeconds,1);assert.deepEqual(s.byTeam,{2:1,3:1});
  assert.deepEqual(s.cumulativeTimeline.map(x=>x.activations),[1,2]);
});

test('Activation-key research comparison is exact only for the same tick/entity identities',()=>{
  const p=[{activationTick:10,entityIndex:2},{activationTick:20,entityIndex:3}];
  assert.equal(compareActivationKeys(p,[...p]).exact,true);
  const c=compareActivationKeys(p,[{activationTick:10,entityIndex:2},{activationTick:21,entityIndex:3}]);
  assert.equal(c.exact,false);assert.equal(c.matched,1);
});
