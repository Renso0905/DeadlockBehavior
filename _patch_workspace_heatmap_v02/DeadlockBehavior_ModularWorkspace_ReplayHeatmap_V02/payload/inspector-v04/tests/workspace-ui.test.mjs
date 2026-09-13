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
