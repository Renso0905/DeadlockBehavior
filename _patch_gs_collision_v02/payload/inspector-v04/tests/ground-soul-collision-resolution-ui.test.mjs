import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root=resolve(process.cwd());
const read=rel=>readFile(join(root,rel),'utf8');

test('collision audit has research script, summary endpoint, evidence endpoint, and workspace panel',async()=>{
  const [server,script,helper,workspace]=await Promise.all([
    read('server.mjs'),
    read('../scripts/207-audit-ground-soul-collision-resolution-v02.mjs'),
    read('lib/research-ground-soul-collision-resolution.mjs'),
    read('public/workspace.js')
  ]);
  assert.match(server,/ground-soul-collisions/);
  assert.match(server,/groundSoulCollisions/);
  assert.match(server,/ground_soul_collision_resolution_audit_v02\.json/);
  assert.match(script,/GROUND SOUL COLLISION RESOLUTION AUDIT V02/);
  assert.match(helper,/WOULD_PASS_NARROWER_SAME_TICK_SAME_TEAM_ISOLATION/);
  assert.match(helper,/Algorithmic counterfactual only/);
  assert.match(workspace,/\+ Ground Soul collisions/);
});

test('collision audit remains B diagnostic and production ledger is untouched',async()=>{
  const [helper,script,workspace,pipeline]=await Promise.all([
    read('lib/research-ground-soul-collision-resolution.mjs'),
    read('../scripts/207-audit-ground-soul-collision-resolution-v02.mjs'),
    read('public/workspace.js'),
    read('pipeline.json')
  ]);
  assert.match(helper,/B_DIAGNOSTIC/);
  assert.match(helper,/not an A count/i);
  assert.match(script,/does not alter A metrics/);
  assert.match(workspace,/77\/77 A ledger is unchanged/);
  assert.doesNotMatch(pipeline,/207-audit-ground-soul-collision-resolution-v02/);
});
