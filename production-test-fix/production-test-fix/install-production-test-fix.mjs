import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.argv[2] ?? '.');
const target = resolve(repoRoot, 'inspector-v04', 'tests', 'production-pipeline.test.mjs');
if (!existsSync(target)) throw new Error(`Target test not found: ${target}`);
const source = readFileSync(target, 'utf8');
const needle = "runtime_permanent_buff_ownership_production_v01.json'),'{}\\n');";
const replacement = "runtime_permanent_buff_ownership_production_v01.json'),'{}\\\\n');";
if (!source.includes(needle)) {
  if (source.includes(replacement)) {
    console.log('Production pipeline test fixture is already fixed.');
    process.exit(0);
  }
  throw new Error('Expected permanent-buff test-fixture anchor was not found; refusing to modify an unknown file.');
}
const backup = `${target}.before-permanent-fixture-fix`;
copyFileSync(target, backup);
writeFileSync(target, source.replace(needle, replacement), 'utf8');
console.log(`Fixed: ${target}`);
console.log(`Backup: ${backup}`);
