import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=process.argv[2];
if(!repoRoot)throw new Error('Usage: node install.mjs <RepoRoot>');
const patchRoot=dirname(fileURLToPath(import.meta.url));
const payloadRoot=join(patchRoot,'payload');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`ground-soul-collision-resolution-audit-v02-${stamp}`);

const replaceFiles=[
  'inspector-v04/public/workspace.js',
  'inspector-v04/public/workspace.css',
  'inspector-v04/tests/workspace-ui.test.mjs',
];
const addFiles=[
  'inspector-v04/lib/research-ground-soul-collision-resolution.mjs',
  'inspector-v04/tests/ground-soul-collision-resolution-audit.test.mjs',
  'inspector-v04/tests/ground-soul-collision-resolution-ui.test.mjs',
  'inspector-v04/run-ground-soul-collision-audit.ps1',
  'scripts/207-audit-ground-soul-collision-resolution-v02.mjs',
];
const serverRel='inspector-v04/server.mjs';

for(const rel of replaceFiles){
  if(!existsSync(join(repoRoot,rel)))throw new Error(`Prerequisite missing: ${rel}. Install Ground Soul Economic Coverage Audit B V01 first.`);
  if(!existsSync(join(payloadRoot,rel)))throw new Error(`Payload missing: ${rel}`);
}
for(const rel of addFiles)if(!existsSync(join(payloadRoot,rel)))throw new Error(`Payload missing: ${rel}`);
if(!existsSync(join(repoRoot,serverRel)))throw new Error(`Prerequisite missing: ${serverRel}`);
if(!existsSync(join(repoRoot,'inspector-v04/lib/research-ground-soul-economic-coverage.mjs')))throw new Error('Prerequisite missing: Ground Soul Economic Coverage Audit B V01.');
if(!existsSync(join(repoRoot,'scripts/206-audit-ground-soul-economic-coverage-v01.mjs')))throw new Error('Prerequisite missing: Script 206 coverage audit.');
const workspace0=await readFile(join(repoRoot,'inspector-v04/public/workspace.js'),'utf8');
if(!workspace0.includes('Ground Soul economic coverage audit')||!workspace0.includes('ground-soul-coverage'))throw new Error('Ground Soul coverage-audit workspace prerequisite was not detected.');
const server0=await readFile(join(repoRoot,serverRel),'utf8');
if(!server0.includes('groundSoulCoverage'))throw new Error('Ground Soul coverage evidence endpoint prerequisite was not detected.');

const backupCandidates=[...replaceFiles,serverRel,...addFiles.filter(rel=>existsSync(join(repoRoot,rel)))];
for(const rel of backupCandidates){const src=join(repoRoot,rel),bak=join(backupRoot,rel);await mkdir(dirname(bak),{recursive:true});await copyFile(src,bak);}

try{
  for(const rel of [...replaceFiles,...addFiles]){
    const src=join(payloadRoot,rel),dst=join(repoRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);console.log(`Installed: ${rel}`);
  }
  let server=server0;
  if(!server.includes("groundSoulCollisions:['jsonl','ground_soul_collision_resolution_audit_events_v02.jsonl']")){
    const lines=server.split(/\r?\n/);
    const idx=lines.findIndex(line=>line.includes("groundSoulCoverage:['jsonl','ground_soul_economic_coverage_audit_events_v01.jsonl']"));
    if(idx<0)throw new Error('Server groundSoulCoverage evidence marker missing.');
    lines.splice(idx+1,0,"  groundSoulCollisions:['jsonl','ground_soul_collision_resolution_audit_events_v02.jsonl'],");
    server=lines.join('\n');
  }
  if(!server.includes('ground_soul_collision_resolution_audit_v02.json')){
    const lines=server.split(/\r?\n/);
    const evidenceIndex=lines.findIndex(line=>line.includes('url.pathname.match')&&line.includes('evidence'));
    if(evidenceIndex<0)throw new Error('Server generic evidence route marker missing.');
    const route=[
      "  m=url.pathname.match(/^\\/api\\/replay\\/([^/]+)\\/ground-soul-collisions$/);",
      "  if(req.method==='GET'&&m){",
      "    const replay=decodeURIComponent(m[1]);if(!/^[A-Za-z0-9._-]+$/.test(replay))throw new Error('Invalid replay name');",
      "    const path=join(outputRoot,replay,'ground_soul_collision_resolution_audit_v02.json');",
      "    if(!existsSync(path))return sendJson(res,404,{error:'Ground Soul collision-resolution audit V02 has not been generated for this replay.',replay,file:'ground_soul_collision_resolution_audit_v02.json'});",
      "    const data=await readJson(path,null);if(!data)return sendJson(res,500,{error:'Ground Soul collision-resolution audit V02 could not be read.',replay});",
      "    return sendJson(res,200,data);",
      "  }",
    ];
    lines.splice(evidenceIndex,0,...route);server=lines.join('\n');
  }
  if(server.includes("const filterPlayer=(kind==='troopers'||kind==='groundSoulCoverage')?null:player;")){
    server=server.replace("const filterPlayer=(kind==='troopers'||kind==='groundSoulCoverage')?null:player;","const filterPlayer=(kind==='troopers'||kind==='groundSoulCoverage'||kind==='groundSoulCollisions')?null:player;");
  }else if(server.includes("const filterPlayer=kind==='troopers'?null:player;")){
    server=server.replace("const filterPlayer=kind==='troopers'?null:player;","const filterPlayer=(kind==='troopers'||kind==='groundSoulCoverage'||kind==='groundSoulCollisions')?null:player;");
  }else if(!server.includes("kind==='groundSoulCollisions'")){
    throw new Error('Server evidence player-filter marker was not recognized.');
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
console.log('GROUND SOUL COLLISION RESOLUTION AUDIT V02 INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('This is a B-level diagnostic layer. It does NOT change the 77/77 A ledger or production resolver.');
console.log('Run .\\inspector-v04\\test-inspector.ps1');
console.log('Then run .\\inspector-v04\\run-ground-soul-collision-audit.ps1 104373259 132');
console.log('Restart/reopen Workspace and add Ground Soul collisions.');

async function verify(){
  const [ws,css,test,server,script,helper]=await Promise.all([
    readFile(join(repoRoot,'inspector-v04/public/workspace.js'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/public/workspace.css'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/tests/workspace-ui.test.mjs'),'utf8'),
    readFile(join(repoRoot,serverRel),'utf8'),
    readFile(join(repoRoot,'scripts/207-audit-ground-soul-collision-resolution-v02.mjs'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/lib/research-ground-soul-collision-resolution.mjs'),'utf8'),
  ]);
  const checks=[
    [ws.includes('+ Ground Soul collisions'),'workspace add control'],
    [ws.includes('renderGroundSoulCollisionPanel'),'workspace collision renderer'],
    [ws.includes('This is not an A promotion'),'workspace authority boundary'],
    [css.includes('.ws-collision-summary'),'collision styling'],
    [test.includes('collision-resolution diagnostics'),'workspace regression test'],
    [server.includes('ground-soul-collisions'),'summary endpoint'],
    [server.includes('groundSoulCollisions'),'evidence endpoint'],
    [script.includes('GROUND SOUL COLLISION RESOLUTION AUDIT V02'),'research script'],
    [helper.includes("authorityStatus:'B_DIAGNOSTIC'"),'B diagnostic helper'],
    [helper.includes('WOULD_PASS_NARROWER_SAME_TICK_SAME_TEAM_ISOLATION'),'counterfactual taxonomy'],
  ];
  const failed=checks.filter(([ok])=>!ok).map(([,label])=>label);if(failed.length)throw new Error(`Verification failed: ${failed.join(', ')}`);
}
