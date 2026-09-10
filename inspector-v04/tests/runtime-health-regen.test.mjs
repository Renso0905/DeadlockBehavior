import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealthRegenPlayerSummary, numericSummary } from '../lib/runtime-health-regen.mjs';

test('numeric health-regen summary preserves distribution',()=>{
  const s=numericSummary([1,2,3,4]);
  assert.equal(s.count,4);assert.equal(s.min,1);assert.equal(s.max,4);assert.equal(s.mean,2.5);assert.equal(s.median,2.5);
});

test('gameplay health-regen summary excludes pregame transient while preserving raw observations',()=>{
  const p=buildHealthRegenPlayerSummary({controllerEntityIndex:1,playerName:'Alpha'},[
    {tick:16,demoSeconds:.25,matchTimeSeconds:-29.75,value:108.8},
    {tick:1920,demoSeconds:30,matchTimeSeconds:0,value:2},
    {tick:1936,demoSeconds:30.25,matchTimeSeconds:.25,value:2},
    {tick:3840,demoSeconds:60,matchTimeSeconds:30,value:17.5},
  ],{matchEndSeconds:30});
  assert.equal(p.pregameSampleCount,1);assert.equal(p.gameplaySampleCount,3);
  assert.equal(p.rawObserved.max,108.8);assert.equal(p.gameplayObserved.max,17.5);assert.equal(p.gameplayObserved.min,2);
  assert.equal(p.firstGameplayValue,2);assert.equal(p.lastGameplayValue,17.5);
  assert.equal(p.changeCount,2);
});

test('unchanged sampled regen does not fabricate change events',()=>{
  const p=buildHealthRegenPlayerSummary({controllerEntityIndex:1,playerName:'Alpha'},[
    {tick:1,matchTimeSeconds:0,value:2},{tick:2,matchTimeSeconds:.25,value:2},{tick:3,matchTimeSeconds:.5,value:2}
  ]);
  assert.equal(p.changeEvents.length,1);assert.equal(p.changeEvents[0].eventType,'OBSERVED_HEALTH_REGEN_INITIAL');assert.equal(p.changeCount,0);
});
