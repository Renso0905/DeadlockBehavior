import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=process.argv[2];
if(!repoRoot)throw new Error('Usage: node install.mjs <RepoRoot>');
const patchRoot=dirname(fileURLToPath(import.meta.url));
const payloadRoot=join(patchRoot,'payload');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`ground-soul-narrow-isolation-validation-v03-${stamp}`);

const replaceFiles=[
  'inspector-v04/public/workspace.js',
  'inspector-v04/public/workspace.css',
  'inspector-v04/tests/workspace-ui.test.mjs',
];
const addFiles=[
  'inspector-v04/lib/research-ground-soul-narrow-isolation-validation.mjs',
  'inspector-v04/tests/ground-soul-narrow-isolation-validation.test.mjs',
  'inspector-v04/tests/ground-soul-narrow-isolation-validation-ui.test.mjs',
  'inspector-v04/run-ground-soul-narrow-isolation-validation.ps1',
  'scripts/208-validate-ground-soul-narrow-isolation-cross-replay-v03.mjs',
];
const serverRel='inspector-v04/server.mjs';

for(const rel of replaceFiles){
  if(!existsSync(join(repoRoot,rel)))throw new Error(`Prerequisite missing: ${rel}. Install Modular Workspace + Ground Soul Collision Audit V02 first.`);
  if(!existsSync(join(payloadRoot,rel)))throw new Error(`Payload missing: ${rel}`);
}
for(const rel of addFiles)if(!existsSync(join(payloadRoot,rel)))throw new Error(`Payload missing: ${rel}`);
for(const rel of [serverRel,'inspector-v04/lib/research-ground-soul-economic-coverage.mjs','inspector-v04/lib/research-ground-soul-collision-resolution.mjs','inspector-v04/lib/runtime-assigned-gold-economic-credit.mjs','scripts/206-audit-ground-soul-economic-coverage-v01.mjs','scripts/207-audit-ground-soul-collision-resolution-v02.mjs']){
  if(!existsSync(join(repoRoot,rel)))throw new Error(`Prerequisite missing: ${rel}`);
}
const workspace0=await readFile(join(repoRoot,'inspector-v04/public/workspace.js'),'utf8');
if(!workspace0.includes('Ground Soul collision resolution audit')||!workspace0.includes('+ Ground Soul collisions'))throw new Error('Ground Soul Collision Resolution Audit V02 workspace prerequisite was not detected.');
const server0=await readFile(join(repoRoot,serverRel),'utf8');
if(!server0.includes('ground-soul-collisions'))throw new Error('Ground Soul Collision Resolution Audit V02 server prerequisite was not detected.');
const production0=await readFile(join(repoRoot,'inspector-v04/lib/runtime-assigned-gold-economic-credit.mjs'),'utf8');
if(!production0.includes('DEFAULT_ISOLATION_RADIUS_TICKS=16'))throw new Error('Current production economic-credit isolation contract was not recognized; refusing to install research validation over an unexpected production state.');

const backupCandidates=[...replaceFiles,serverRel,...addFiles.filter(rel=>existsSync(join(repoRoot,rel)))];
for(const rel of backupCandidates){const src=join(repoRoot,rel),bak=join(backupRoot,rel);await mkdir(dirname(bak),{recursive:true});await copyFile(src,bak);}

try{
  for(const rel of [...replaceFiles,...addFiles]){
    const src=join(payloadRoot,rel),dst=join(repoRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);console.log(`Installed: ${rel}`);
  }
  let server=server0;
  if(!server.includes("url.pathname==='/api/research/ground-soul-narrow-isolation-validation'")){
    const lines=server.split(/\r?\n/);
    const idx=lines.findIndex(line=>line.includes("url.pathname==='/api/metrics'"));
    if(idx<0)throw new Error('Server /api/metrics marker missing; could not install V03 research endpoint safely.');
    const route=[
      "  if(req.method==='GET'&&url.pathname==='/api/research/ground-soul-narrow-isolation-validation'){",
      "    const path=join(outputRoot,'cross_replay','ground_soul_narrow_isolation_validation_v03.json');",
      "    if(!existsSync(path))return sendJson(res,404,{error:'Ground Soul Narrow-Isolation Validation V03 has not been generated.',file:'ground_soul_narrow_isolation_validation_v03.json'});",
      "    const data=await readJson(path,null);if(!data)return sendJson(res,500,{error:'Ground Soul Narrow-Isolation Validation V03 could not be read.'});",
      "    return sendJson(res,200,data);",
      "  }",
    ];
    lines.splice(idx+1,0,...route);server=lines.join('\n');
  }
  await writeFile(join(repoRoot,serverRel),server,'utf8');console.log(`Patched: ${serverRel}`);
  await verify();
}catch(error){
  console.error(`INSTALLATION FAILED: ${error?.message??error}`);
  for(const rel of backupCandidates){const bak=join(backupRoot,rel);if(existsSync(bak)){await mkdir(dirname(join(repoRoot,rel)),{recursive:true});await copyFile(bak,join(repoRoot,rel));}}
  console.error(`Restored available backups from: ${backupRoot}`);
  throw error;
}

console.log('');
console.log('GROUND SOUL NARROW-ISOLATION VALIDATION V03 INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('This is a B-level cross-replay validation layer. It does NOT change the 77/77 A ledger or the production resolver.');
console.log('Run .\\inspector-v04\\test-inspector.ps1');
console.log('Then run .\\inspector-v04\\run-ground-soul-narrow-isolation-validation.ps1 -Prepare');
console.log('After V03 finishes, reopen Workspace and add GS isolation validation.');

async function verify(){
  const [ws,css,test,server,script,helper,runner,production,pipeline]=await Promise.all([
    readFile(join(repoRoot,'inspector-v04/public/workspace.js'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/public/workspace.css'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/tests/workspace-ui.test.mjs'),'utf8'),
    readFile(join(repoRoot,serverRel),'utf8'),
    readFile(join(repoRoot,'scripts/208-validate-ground-soul-narrow-isolation-cross-replay-v03.mjs'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/lib/research-ground-soul-narrow-isolation-validation.mjs'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/run-ground-soul-narrow-isolation-validation.ps1'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/lib/runtime-assigned-gold-economic-credit.mjs'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/pipeline.json'),'utf8'),
  ]);
  const checks=[
    [ws.includes('+ GS isolation validation'),'workspace add control'],
    [ws.includes('renderGroundSoulIsolationValidationPanel'),'workspace V03 renderer'],
    [ws.includes('does not add recovered candidates to A'),'workspace authority boundary'],
    [css.includes('.ws-validation-radius'),'validation styling'],
    [test.includes('cross-replay Ground Soul narrow-isolation validation'),'workspace regression test'],
    [server.includes('ground-soul-narrow-isolation-validation'),'V03 API endpoint'],
    [server.includes('ground_soul_narrow_isolation_validation_v03.json'),'V03 API output'],
    [script.includes('GROUND SOUL NARROW-ISOLATION VALIDATION V03'),'Script 208'],
    [helper.includes("DEFAULT_RADIUS_SWEEP=[0,1,2,4,8,16]"),'radius sweep'],
    [helper.includes("authorityStatus:'B_VALIDATION'"),'B validation helper'],
    [runner.includes("'rep01','rep02','rep03','rep04','rep05'"),'replication cohort runner'],
    [production.includes('DEFAULT_ISOLATION_RADIUS_TICKS=16'),'production resolver unchanged'],
    [!pipeline.includes('208-validate-ground-soul-narrow-isolation-cross-replay-v03'),'production pipeline untouched'],
  ];
  const failed=checks.filter(([ok])=>!ok).map(([,label])=>label);if(failed.length)throw new Error(`Verification failed: ${failed.join(', ')}`);
}
