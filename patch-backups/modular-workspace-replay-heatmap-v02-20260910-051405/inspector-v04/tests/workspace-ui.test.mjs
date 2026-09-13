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
