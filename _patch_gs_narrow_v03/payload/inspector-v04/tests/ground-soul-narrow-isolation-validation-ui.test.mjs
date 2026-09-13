import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root=resolve(process.cwd());
const read=rel=>readFile(join(root,rel),'utf8');

test('V03 has cross-replay research script, runner, API route, and workspace surface',async()=>{
  const [server,script,runner,workspace,helper]=await Promise.all([
    read('server.mjs'),
    read('../scripts/208-validate-ground-soul-narrow-isolation-cross-replay-v03.mjs'),
    read('run-ground-soul-narrow-isolation-validation.ps1'),
    read('public/workspace.js'),
    read('lib/research-ground-soul-narrow-isolation-validation.mjs'),
  ]);
  assert.match(server,/ground-soul-narrow-isolation-validation/);
  assert.match(server,/ground_soul_narrow_isolation_validation_v03\.json/);
  assert.match(script,/GROUND SOUL NARROW-ISOLATION VALIDATION V03/);
  assert.match(runner,/rep01/);
  assert.match(runner,/rep05/);
  assert.match(runner,/206-audit-ground-soul-economic-coverage-v01/);
  assert.match(runner,/207-audit-ground-soul-collision-resolution-v02/);
  assert.match(workspace,/\+ GS isolation validation/);
  assert.match(helper,/DEFAULT_RADIUS_SWEEP=\[0,1,2,4,8,16\]/);
});

test('V03 remains B validation and does not silently modify production authority',async()=>{
  const [helper,script,pipeline,production]=await Promise.all([
    read('lib/research-ground-soul-narrow-isolation-validation.mjs'),
    read('../scripts/208-validate-ground-soul-narrow-isolation-cross-replay-v03.mjs'),
    read('pipeline.json'),
    read('lib/runtime-assigned-gold-economic-credit.mjs'),
  ]);
  assert.match(helper,/B_VALIDATION/);
  assert.match(helper,/candidate_for_production_resolver_review_not_promoted/);
  assert.match(script,/77\/77 unchanged/);
  assert.doesNotMatch(pipeline,/208-validate-ground-soul-narrow-isolation-cross-replay-v03/);
  assert.match(production,/DEFAULT_ISOLATION_RADIUS_TICKS=16/);
});
