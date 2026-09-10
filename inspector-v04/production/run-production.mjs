import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../lib/pipeline.mjs';

const inspectorRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
const repoRoot=resolve(process.env.DEADLOCK_REPO_ROOT ?? join(inspectorRoot,'..'));
const arg=process.argv[2];
if (!arg) {
  console.error('Usage: node inspector-v04/production/run-production.mjs <replay-name|replay.dem>');
  process.exit(2);
}
const rawArg=String(arg);
const replayBase=basename(rawArg);
const replayName=replayBase.toLowerCase().endsWith('.dem')?replayBase.slice(0,-4):replayBase;
if (!/^[A-Za-z0-9._-]+$/.test(replayName)) {
  console.error(`Invalid replay name: ${replayName}`);
  process.exit(2);
}
const replayPath=join(repoRoot,'replays',`${replayName}.dem`);
if (!existsSync(replayPath)) {
  console.error(`Replay not found: ${replayPath}`);
  process.exit(2);
}

const result=await runPipeline({
  repoRoot,
  inspectorRoot,
  replayName,
  onEvent:event=>{
    if (event.type==='step-start') console.log(`\n[${event.id}] ${event.label}`);
    if (event.type==='stdout') process.stdout.write(event.text);
    if (event.type==='stderr') process.stderr.write(event.text);
  }
});

const c=result.productionManifest.coverage;
console.log('\n========================================');
console.log('DEADLOCK PRODUCTION RUN');
console.log('========================================');
console.log(`Replay: ${replayName}`);
console.log(`Status: ${result.status}`);
console.log(`Authoritative coverage: ${c.completeAuthoritative}/${c.authoritativeTotal}`);console.log(`Core A coverage: ${c.core?.completeAuthoritative??'â€”'}/${c.core?.authoritativeTotal??'â€”'}`);
console.log(`Extended A coverage: ${c.extended?.completeAuthoritative??'â€”'}/${c.extended?.authoritativeTotal??'â€”'}`);
console.log(`Not supported: ${c.notSupportedAuthoritative}`);
console.log(`Blocked: ${c.blockedAuthoritative}`);
console.log(`Failed: ${c.failedAuthoritative}`);
console.log(`Manifest: ${result.productionManifest.path}`);

if (result.status==='FAILED_REQUIRED_STEP' || c.failedAuthoritative>0 || c.blockedAuthoritative>0) process.exitCode=1;
