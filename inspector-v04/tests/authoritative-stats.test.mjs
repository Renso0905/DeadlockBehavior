import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { METRIC_REGISTRY } from '../lib/metric-registry.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const publicRoot=join(here,'..','public');

test('every A-status metric is explicitly wired in Authoritative Stats', async()=>{
  const source=await readFile(join(publicRoot,'authoritative.js'),'utf8');
  const authoritative=METRIC_REGISTRY.flatMap(section=>section.metrics).filter(metric=>metric.status==='A');
  assert.equal(authoritative.length,79,'A-status metric count changed; review the display contract intentionally');
  for(const metric of authoritative){
    assert.match(source,new RegExp(`case ['"]${escapeRegex(metric.id)}['"]\\s*:`),`A metric ${metric.id} is not wired`);
  }
});

test('authoritative display contract has no stale metric ids', async()=>{
  const source=await readFile(join(publicRoot,'authoritative.js'),'utf8');
  const array=source.match(/const AUTH_IDS=\[(.*?)\];/s);
  assert.ok(array,'AUTH_IDS contract not found');
  const ids=[...array[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
  assert.equal(new Set(ids).size,ids.length,'AUTH_IDS contains duplicate ids');
  const registryIds=new Set(METRIC_REGISTRY.flatMap(section=>section.metrics).filter(metric=>metric.status==='A').map(metric=>metric.id));
  assert.deepEqual(new Set(ids),registryIds,'AUTH_IDS must exactly match the A-status registry');
});

test('index loads Authoritative Stats extension', async()=>{
  const html=await readFile(join(publicRoot,'index.html'),'utf8');
  assert.match(html,/authoritative\.js/);
});

function escapeRegex(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
