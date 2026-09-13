import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const repoRoot = process.argv[2];
if (!repoRoot) throw new Error('Usage: node repair.mjs <RepoRoot>');

const rel = 'inspector-v04/tests/production-pipeline.test.mjs';
const file = join(repoRoot, rel);
if (!existsSync(file)) throw new Error(`Required file missing: ${rel}`);

const stamp = new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backup = join(repoRoot, 'patch-backups', `ground-soul-economic-gain-evidence-ux-v01b-${stamp}`, rel);
await mkdir(dirname(backup), { recursive: true });
await copyFile(file, backup);

const before = await readFile(file, 'utf8');
let after = before;

// Repair only the two ownership-count assertions missed by V01.
after = after.replace(/assert\.equal\(a\.length\s*,\s*76\s*\)/g, 'assert.equal(a.length,77)');
after = after.replace(/assert\.equal\(new Set\(production\)\.size\s*,\s*76\s*\)/g, 'assert.equal(new Set(production).size,77)');

// Also support equivalent formatting with messages as a defensive repair.
after = after.replace(/assert\.equal\(a\.length\s*,\s*76\s*,/g, 'assert.equal(a.length,77,');
after = after.replace(/assert\.equal\(new Set\(production\)\.size\s*,\s*76\s*,/g, 'assert.equal(new Set(production).size,77,');

if (!after.includes('assert.equal(a.length,77') || !after.includes('assert.equal(new Set(production).size,77')) {
  throw new Error('Could not verify both repaired 77-count ownership assertions. Original file was not modified.');
}
if (!after.includes('extendedA.length,9') || !after.includes('authoritativeTotal,77')) {
  throw new Error('V01 prerequisite not detected: expected 9 Extended A / 77 Total A fixture updates are missing. Original file was not modified.');
}

if (after !== before) {
  await writeFile(file, after, 'utf8');
  console.log(`Patched: ${rel}`);
} else {
  console.log(`Already repaired: ${rel}`);
}

console.log('GROUND SOUL ECONOMIC GAIN + EVIDENCE UX V01B REPAIR INSTALLED');
console.log(`Backup: ${dirname(dirname(dirname(backup)))}`);
console.log('Expected authority ledger: Core A 68/68 | Extended A 9/9 | Total A 77/77');
console.log('Next: rerun the full Node test suite.');
