import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDuplicateActivationDiagnostic, duplicateDiagnosticConsoleLines } from '../lib/runtime-ground-soul-lifecycle-duplicate-diagnostic.mjs';

function ep(sequence,activationTick,endTick,{targeted=false,endReason='BECAME_INACTIVE',censored=false}={}){
  return {activationId:`7|${sequence}`,entityIndex:7,sequence,activationTick,activationMatchTimeSeconds:activationTick/64,targeted,targetOnsetTick:targeted?activationTick:null,targetEntityIndex:targeted?42:null,endTick,endMatchTimeSeconds:endTick/64,durationSeconds:(endTick-activationTick)/64,endReason,censored,finalized:true};
}

test('duplicate activation diagnostic preserves conflicting episodes instead of merging them',()=>{
  const rows=[ep(1,100,100),ep(2,100,140,{targeted:true}),ep(3,200,230)];
  const d=buildDuplicateActivationDiagnostic(rows,{replayName:'rep01',replayEndTick:999});
  assert.equal(d.totalEpisodes,3);
  assert.equal(d.uniqueActivationKeys,2);
  assert.equal(d.duplicateKeyCount,1);
  assert.equal(d.duplicateExtraRecordCount,1);
  assert.equal(d.patterns.groupsWithZeroTickEpisode,1);
  assert.equal(d.patterns.groupsWithSameTickCloseThenReopen,1);
  assert.equal(d.patterns.groupsWithTargetStateDifference,1);
  assert.equal(d.duplicateGroups[0].episodes.length,2);
  assert.equal(d.duplicateGroups[0].episodes[0].endTick,100);
  assert.equal(d.duplicateGroups[0].episodes[1].endTick,140);
  assert.equal(d.duplicateGroups[0].nextEpisode.activationTick,200);
});

test('diagnostic summary prints duplicate identity and episode boundaries',()=>{
  const d=buildDuplicateActivationDiagnostic([ep(1,100,100),ep(2,100,140,{targeted:true})]);
  const text=duplicateDiagnosticConsoleLines(d,{limit:5}).join('\n');
  assert.match(text,/Duplicate activation keys: 1/);
  assert.match(text,/tick 100 entity 7 x2/);
  assert.match(text,/seq=1 end=100/);
  assert.match(text,/seq=2 end=140/);
});
