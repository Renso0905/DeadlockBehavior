import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrooperDeathSummary, compareEventKeys, deriveTrooperDeathTransition } from '../lib/runtime-trooper-deaths.mjs';

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

test('summary preserves event count and builds gameplay cumulative timing',()=>{
  const s=buildTrooperDeathSummary([
    {tick:10,entityIndex:1,matchTimeSeconds:-2},
    {tick:20,entityIndex:2,matchTimeSeconds:5},
    {tick:30,entityIndex:3,matchTimeSeconds:15},
  ]);
  assert.equal(s.deaths,3);assert.equal(s.gameplayDeaths,2);assert.equal(s.pregameDeaths,1);
  assert.equal(s.firstGameplayDeathSeconds,5);assert.equal(s.medianGameplayDeathSeconds,10);assert.equal(s.lastGameplayDeathSeconds,15);
  assert.deepEqual(s.cumulativeTimeline.map(x=>x.deaths),[1,2]);
});

test('research comparison uses exact tick/entity death identity',()=>{
  const a=[{tick:100,entityIndex:7},{tick:110,entityIndex:8}];
  assert.equal(compareEventKeys(a,[...a]).exact,true);
  const c=compareEventKeys(a,[{tick:100,entityIndex:7}]);
  assert.equal(c.exact,false);assert.equal(c.recall,1);assert.equal(c.precision,.5);
});
