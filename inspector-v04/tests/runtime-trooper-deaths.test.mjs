import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrooperDeathSummary, compareEventKeys, deriveTrooperDeathTransition, directTrooperContext } from '../lib/runtime-trooper-deaths.mjs';

test('positive health to zero is the authoritative Trooper death transition',()=>{
  assert.deepEqual(deriveTrooperDeathTransition({health:81,lifeState:0,maxHealth:550},{health:0,lifeState:1,maxHealth:550}),{
    healthSignal:true,lifeStateSignal:true,previousHealth:81,currentHealth:0,previousLifeState:0,currentLifeState:1,maxHealth:550
  });
  assert.equal(deriveTrooperDeathTransition({health:81,lifeState:0},{health:5,lifeState:0}),null);
  assert.equal(deriveTrooperDeathTransition({health:0,lifeState:1},{health:0,lifeState:1}),null);
});

test('alternate nonliving life state still corroborates death',()=>{
  const e=deriveTrooperDeathTransition({health:1,lifeState:0},{health:0,lifeState:2});
  assert.equal(e.lifeStateSignal,true);
});

test('direct Trooper context preserves raw fields without inventing zeroes',()=>{
  assert.deepEqual(directTrooperContext(
    {subclassId:3204567821,team:2,lane:1},
    {subclassId:null,team:undefined,lane:''}
  ),{subclassId:3204567821,team:2,lane:1});
  assert.deepEqual(directTrooperContext({},{}),{subclassId:null,team:null,lane:null});
});

test('summary preserves event count and builds gameplay cumulative timing',()=>{
  const s=buildTrooperDeathSummary([
    {tick:10,entityIndex:1,matchTimeSeconds:-2,trooperContext:{subclassId:10,team:2,lane:1}},
    {tick:20,entityIndex:2,matchTimeSeconds:5,trooperContext:{subclassId:11,team:2,lane:1}},
    {tick:30,entityIndex:3,matchTimeSeconds:15,trooperContext:{subclassId:10,team:3,lane:2}},
  ]);
  assert.equal(s.deaths,3);assert.equal(s.gameplayDeaths,2);assert.equal(s.pregameDeaths,1);
  assert.equal(s.firstGameplayDeathSeconds,5);assert.equal(s.medianGameplayDeathSeconds,10);assert.equal(s.lastGameplayDeathSeconds,15);
  assert.deepEqual(s.cumulativeTimeline.map(x=>x.deaths),[1,2]);
  assert.equal(s.completeContextDeaths,3);assert.equal(s.incompleteContextDeaths,0);
  assert.deepEqual(s.bySubclassId,{10:2,11:1});
  assert.deepEqual(s.byTeamLane,{team_2_lane_1:2,team_3_lane_2:1});
});

test('research comparison uses exact tick/entity death identity',()=>{
  const a=[{tick:100,entityIndex:7},{tick:110,entityIndex:8}];
  assert.equal(compareEventKeys(a,[...a]).exact,true);
  const c=compareEventKeys(a,[{tick:100,entityIndex:7}]);
  assert.equal(c.exact,false);assert.equal(c.recall,1);assert.equal(c.precision,.5);
});
