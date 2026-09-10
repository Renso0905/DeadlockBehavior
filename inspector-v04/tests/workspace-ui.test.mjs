import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root=resolve(process.cwd());
const read=rel=>readFile(join(root,rel),'utf8');

test('modular workspace is wired into inspector shell',async()=>{
  const [html,js,css]=await Promise.all([
    read('public/index.html'),
    read('public/workspace.js'),
    read('public/workspace.css')
  ]);
  assert.match(html,/workspace\.css/);
  assert.match(html,/workspace\.js/);
  assert.match(js,/modular-workspace/);
  assert.match(js,/\/api\/metrics/);
  assert.match(js,/\/api\/replay\//);
  assert.match(js,/timeSlider/);
  assert.match(js,/groundSoulEconomicCredit/);
  assert.match(js,/ground_soul_economic_gain/);
  assert.match(js,/dragstart/);
  assert.match(js,/Set baseline/);
  assert.match(css,/\.ws-grid/);
});

test('workspace keeps authority boundary explicit',async()=>{
  const js=await read('public/workspace.js');
  assert.match(js,/does not create or promote statistics/);
  assert.match(js,/derived view/);
  assert.doesNotMatch(js,/status\s*:\s*['"]A['"]/);
});

test('workspace replay heat map is additive and scrubber-driven',async()=>{
  const [js,css]=await Promise.all([read('public/workspace.js'),read('public/workspace.css')]);
  assert.match(js,/Replay \/ heat map/);
  assert.match(js,/makeSpatialPanel/);
  assert.match(js,/spatialOccupancy/);
  assert.match(js,/spatialReplaySvg/);
  assert.match(js,/heat-trail/);
  assert.match(js,/Through current time/);
  assert.match(js,/Last 2 min/);
  assert.match(js,/workspacePlaybackTimer/);
  assert.match(js,/dispatchEvent\(new Event\('input'/);
  assert.match(js,/Gaps &gt;3 s are excluded/);
  assert.match(js,/diagnostic coordinate plane/);
  assert.match(css,/\.ws-heat-cell/);
  assert.match(css,/\.ws-spatial-trail/);
  assert.match(css,/\.ws-spatial-marker/);
});


test('workspace exposes Ground Soul economic coverage diagnostics without promoting them',async()=>{
  const [js,css]=await Promise.all([read('public/workspace.js'),read('public/workspace.css')]);
  assert.match(js,/Ground Soul economic coverage audit/);
  assert.match(js,/GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_V01_READY/);
  assert.match(js,/ground-soul-coverage/);
  assert.match(js,/data-ws-audit-time/);
  assert.match(js,/does not alter the 77\/77 A ledger/);
  assert.match(js,/Unresolved.*does not mean no Souls were awarded/s);
  assert.match(css,/\.ws-audit-funnel/);
  assert.match(css,/\.ws-audit-event/);
});

test('workspace exposes Ground Soul collision-resolution diagnostics without changing A authority',async()=>{
  const [js,css]=await Promise.all([read('public/workspace.js'),read('public/workspace.css')]);
  assert.match(js,/Ground Soul collision resolution audit/);
  assert.match(js,/GROUND_SOUL_COLLISION_RESOLUTION_AUDIT_V02_READY/);
  assert.match(js,/ground-soul-collisions/);
  assert.match(js,/Would pass narrower rule/);
  assert.match(js,/Same-tick \+ same-team ambiguous/);
  assert.match(js,/This is not an A promotion/);
  assert.match(js,/The 77\/77 A ledger is unchanged/);
  assert.match(css,/\.ws-collision-summary/);
  assert.match(css,/\.ws-collision-counterfactual/);
});

test('workspace exposes cross-replay Ground Soul narrow-isolation validation as B only',async()=>{
  const [js,css]=await Promise.all([read('public/workspace.js'),read('public/workspace.css')]);
  assert.match(js,/\+ GS isolation validation/);
  assert.match(js,/Ground Soul narrow-isolation validation/);
  assert.match(js,/ground-soul-narrow-isolation-validation/);
  assert.match(js,/cross-replay V03/);
  assert.match(js,/does not add recovered candidates to A/);
  assert.match(js,/77\/77 ledger/);
  assert.match(css,/\.ws-validation-radius/);
  assert.match(css,/\.ws-validation-replay/);
});
