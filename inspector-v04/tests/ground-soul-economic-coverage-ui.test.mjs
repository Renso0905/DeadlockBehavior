import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root=resolve(process.cwd());
const read=rel=>readFile(join(root,rel),'utf8');

test('Ground Soul coverage audit has a research script, summary endpoint, and evidence endpoint',async()=>{
  const [server,script,helper]=await Promise.all([
    read('server.mjs'),
    read('../scripts/206-audit-ground-soul-economic-coverage-v01.mjs'),
    read('lib/research-ground-soul-economic-coverage.mjs')
  ]);
  assert.match(server,/ground-soul-coverage/);
  assert.match(server,/groundSoulCoverage/);
  assert.match(server,/ground_soul_economic_coverage_audit_v01\.json/);
  assert.match(script,/GROUND SOUL ECONOMIC COVERAGE \/ EXCLUSION AUDIT V01/);
  assert.match(script,/m_nCurrencies\.0000/);
  assert.match(helper,/UNRESOLVED_NONISOLATED_TERMINATION/);
  assert.match(helper,/Temporal proximity only/);
});

test('coverage audit remains explicitly B diagnostic and does not modify production pipeline',async()=>{
  const [helper,workspace]=await Promise.all([
    read('lib/research-ground-soul-economic-coverage.mjs'),
    read('public/workspace.js')
  ]);
  assert.match(helper,/B_DIAGNOSTIC/);
  assert.match(helper,/Unresolved means no reward/);
  assert.match(workspace,/does not alter the 77\/77 A ledger/);
});
