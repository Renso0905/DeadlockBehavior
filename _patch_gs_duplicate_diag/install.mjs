import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=process.argv[2];
if(!repoRoot)throw new Error('Usage: node install.mjs <RepoRoot>');
const patchRoot=dirname(fileURLToPath(import.meta.url));
const payloadRoot=join(patchRoot,'payload');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`ground-soul-lifecycle-duplicate-diagnostic-v01-${stamp}`);
const producerRel='inspector-v04/production/extract-runtime-ground-soul-lifecycle.mjs';
const helperRel='inspector-v04/lib/runtime-ground-soul-lifecycle-duplicate-diagnostic.mjs';
const testRel='inspector-v04/tests/runtime-ground-soul-lifecycle-duplicate-diagnostic.test.mjs';

for(const rel of [producerRel,'inspector-v04/lib/runtime-ground-soul-lifecycle.mjs']){
  if(!existsSync(join(repoRoot,rel)))throw new Error(`Required current file missing: ${rel}`);
}
const producerPath=join(repoRoot,producerRel);
let producer=await readFile(producerPath,'utf8');
if(!producer.includes("const VERSION='RUNTIME_GROUND_SOUL_LIFECYCLE_PRODUCTION_V01';"))throw new Error('Unexpected Ground Soul lifecycle producer version; refusing to patch blindly.');

for(const rel of [producerRel,helperRel,testRel])await backupIfPresent(rel);
for(const rel of [helperRel,testRel]){
  const src=join(payloadRoot,rel),dst=join(repoRoot,rel);
  if(!existsSync(src))throw new Error(`Payload missing: ${rel}`);
  await mkdir(dirname(dst),{recursive:true});
  await copyFile(src,dst);
  console.log(`Installed: ${rel}`);
}

const importLine="import { buildDuplicateActivationDiagnostic, duplicateDiagnosticConsoleLines } from '../lib/runtime-ground-soul-lifecycle-duplicate-diagnostic.mjs';";
if(!producer.includes(importLine)){
  const anchor="import { beginGroundSoulEpisode, buildGroundSoulLifecycleSummary, compareActivationKeys, decodeSource2EntityHandle, finishGroundSoulEpisode, observeGroundSoulEpisode } from '../lib/runtime-ground-soul-lifecycle.mjs';";
  if(!producer.includes(anchor))throw new Error('Lifecycle helper import anchor not found.');
  producer=producer.replace(anchor,`${anchor}\n${importLine}`);
}

if(!producer.includes("runtime_ground_soul_lifecycle_duplicate_activation_diagnostic_v01.json")){
  const anchor="const eventsPath=resolve('output',replayName,'runtime_ground_soul_lifecycle_events_v01.jsonl');";
  if(!producer.includes(anchor))throw new Error('Lifecycle events-path anchor not found.');
  producer=producer.replace(anchor,`${anchor}\nconst duplicateDiagnosticPath=resolve('output',replayName,'runtime_ground_soul_lifecycle_duplicate_activation_diagnostic_v01.json');`);
}

const diagnosticMarker='GROUND_SOUL_LIFECYCLE_DUPLICATE_DIAGNOSTIC_V01_INSTRUMENTATION';
if(!producer.includes(diagnosticMarker)){
  const anchor='const duplicateKeys=findDuplicateKeys(episodes);';
  if(!producer.includes(anchor))throw new Error('Duplicate-key integrity anchor not found.');
  const block=`${anchor}\n// ${diagnosticMarker}\nconst duplicateDiagnostic=buildDuplicateActivationDiagnostic(episodes,{replayName,replayPath,replayEndTick});\nif(duplicateDiagnostic.duplicateKeyCount>0){\n  mkdirSync(dirname(duplicateDiagnosticPath),{recursive:true});\n  writeFileSync(duplicateDiagnosticPath,JSON.stringify(duplicateDiagnostic,null,2)+'\\n','utf8');\n  console.log('');\n  console.log('DUPLICATE ACTIVATION-KEY DIAGNOSTIC V01');\n  console.log('---------------------------------------');\n  for(const line of duplicateDiagnosticConsoleLines(duplicateDiagnostic,{limit:20}))console.log(line);\n  console.log(\`Diagnostic JSON: \${duplicateDiagnosticPath}\`);\n  console.log('Integrity failure is intentionally preserved; no duplicate episodes were merged or discarded.');\n}\n`;
  producer=producer.replace(anchor,block);
}
await writeFile(producerPath,producer,'utf8');
console.log(`Patched: ${producerRel}`);

const verify=await readFile(producerPath,'utf8');
for(const needle of [importLine,diagnosticMarker,'duplicateDiagnosticPath'])if(!verify.includes(needle))throw new Error(`Installation verification failed: ${needle}`);
console.log('');
console.log('GROUND SOUL LIFECYCLE DUPLICATE DIAGNOSTIC V01 INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('Authority: diagnostic instrumentation only; duplicateActivationKeys integrity failure remains enforced.');
console.log('Next: run inspector tests, then rerun V03 -Prepare to capture rep01 duplicate shape.');

async function backupIfPresent(rel){
  const src=join(repoRoot,rel);if(!existsSync(src))return;
  const dst=join(backupRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);
}
