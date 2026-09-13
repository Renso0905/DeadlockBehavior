import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=process.argv[2];
if(!repoRoot)throw new Error('Usage: node install.mjs <RepoRoot>');
const patchRoot=dirname(fileURLToPath(import.meta.url));
const payloadRoot=join(patchRoot,'payload');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`ground-soul-economic-coverage-audit-v01-${stamp}`);

const replaceFiles=[
  'inspector-v04/public/workspace.js',
  'inspector-v04/public/workspace.css',
  'inspector-v04/tests/workspace-ui.test.mjs',
];
const addFiles=[
  'inspector-v04/lib/research-ground-soul-economic-coverage.mjs',
  'inspector-v04/tests/ground-soul-economic-coverage-audit.test.mjs',
  'inspector-v04/tests/ground-soul-economic-coverage-ui.test.mjs',
  'inspector-v04/run-ground-soul-coverage-audit.ps1',
  'scripts/206-audit-ground-soul-economic-coverage-v01.mjs',
];
const serverRel='inspector-v04/server.mjs';

for(const rel of replaceFiles){
  if(!existsSync(join(repoRoot,rel)))throw new Error(`Prerequisite missing: ${rel}. Install Modular Workspace Replay/Heat Map V02 first.`);
  if(!existsSync(join(payloadRoot,rel)))throw new Error(`Payload missing: ${rel}`);
}
for(const rel of addFiles)if(!existsSync(join(payloadRoot,rel)))throw new Error(`Payload missing: ${rel}`);
if(!existsSync(join(repoRoot,serverRel)))throw new Error(`Prerequisite missing: ${serverRel}`);
if(!existsSync(join(repoRoot,'inspector-v04/lib/runtime-assigned-gold-economic-credit.mjs')))throw new Error('Prerequisite missing: Ground Soul Economic Credit Extended A V01.');
const workspace0=await readFile(join(repoRoot,'inspector-v04/public/workspace.js'),'utf8');
if(!workspace0.includes('+ Replay / heat map')||!workspace0.includes('spatialOccupancy'))throw new Error('Workspace V02 heat-map prerequisite was not detected.');
const server0=await readFile(join(repoRoot,serverRel),'utf8');
if(!server0.includes("groundSoulEconomicCredit:['jsonl','runtime_assigned_gold_economic_credit_events_v01.jsonl']"))throw new Error('Ground Soul economic-credit evidence endpoint prerequisite was not detected.');

const backupCandidates=[...replaceFiles,serverRel,...addFiles.filter(rel=>existsSync(join(repoRoot,rel)))];
for(const rel of backupCandidates){const src=join(repoRoot,rel),bak=join(backupRoot,rel);await mkdir(dirname(bak),{recursive:true});await copyFile(src,bak);}

try{
  for(const rel of [...replaceFiles,...addFiles]){
    const src=join(payloadRoot,rel),dst=join(repoRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);console.log(`Installed: ${rel}`);
  }
  let server=server0;
  if(!server.includes("groundSoulCoverage:['jsonl','ground_soul_economic_coverage_audit_events_v01.jsonl']")){
    const marker="  groundSoulEconomicCredit:['jsonl','runtime_assigned_gold_economic_credit_events_v01.jsonl'],";
    if(!server.includes(marker))throw new Error('Server economic evidence marker missing.');
    server=server.replace(marker,marker+"\n  groundSoulCoverage:['jsonl','ground_soul_economic_coverage_audit_events_v01.jsonl'],");
  }
  if(!server.includes("ground_soul_economic_coverage_audit_v01.json")){
    const lines=server.split(/\r?\n/);
    const healthIndex=lines.findIndex(line=>line.includes('url.pathname.match')&&line.includes('health$/);'));
    if(healthIndex<0||!lines[healthIndex+1]?.includes("sourceHealth(join(outputRoot,replay))"))throw new Error('Server health route marker missing.');
    const route=[
      "  m=url.pathname.match(/^\\/api\\/replay\\/([^/]+)\\/ground-soul-coverage$/);",
      "  if(req.method==='GET'&&m){",
      "    const replay=decodeURIComponent(m[1]);if(!/^[A-Za-z0-9._-]+$/.test(replay))throw new Error('Invalid replay name');",
      "    const path=join(outputRoot,replay,'ground_soul_economic_coverage_audit_v01.json');",
      "    if(!existsSync(path))return sendJson(res,404,{error:'Ground Soul economic coverage audit has not been generated for this replay.',replay,file:'ground_soul_economic_coverage_audit_v01.json'});",
      "    const data=await readJson(path,null);if(!data)return sendJson(res,500,{error:'Ground Soul economic coverage audit could not be read.',replay});",
      "    return sendJson(res,200,data);",
      "  }",
    ];
    lines.splice(healthIndex+2,0,...route);server=lines.join('\n');
  }
  if(server.includes("const filterPlayer=kind==='troopers'?null:player;"))server=server.replace("const filterPlayer=kind==='troopers'?null:player;","const filterPlayer=(kind==='troopers'||kind==='groundSoulCoverage')?null:player;");
  await writeFile(join(repoRoot,serverRel),server,'utf8');console.log(`Patched: ${serverRel}`);
  await verify();
}catch(error){
  console.error(`INSTALLATION FAILED: ${error?.message??error}`);
  for(const rel of backupCandidates){const bak=join(backupRoot,rel);if(existsSync(bak)){await mkdir(dirname(join(repoRoot,rel)),{recursive:true});await copyFile(bak,join(repoRoot,rel));}}
  console.error(`Restored available backups from: ${backupRoot}`);
  throw error;
}

console.log('');
console.log('GROUND SOUL ECONOMIC COVERAGE / EXCLUSION AUDIT V01 INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('This is a B-level research/diagnostic layer. It does NOT alter the 77/77 A ledger or the production pipeline.');
console.log('Run .\\inspector-v04\\test-inspector.ps1');
console.log('Then run .\\inspector-v04\\run-ground-soul-coverage-audit.ps1 104373259');
console.log('Restart/rebuild the inspector and add Ground Soul audit from Workspace.');

async function verify(){
  const [ws,css,test,server,script,helper]=await Promise.all([
    readFile(join(repoRoot,'inspector-v04/public/workspace.js'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/public/workspace.css'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/tests/workspace-ui.test.mjs'),'utf8'),
    readFile(join(repoRoot,serverRel),'utf8'),
    readFile(join(repoRoot,'scripts/206-audit-ground-soul-economic-coverage-v01.mjs'),'utf8'),
    readFile(join(repoRoot,'inspector-v04/lib/research-ground-soul-economic-coverage.mjs'),'utf8'),
  ]);
  const checks=[
    [ws.includes('+ Ground Soul audit'),'workspace add control'],
    [ws.includes('renderGroundSoulAuditPanel'),'workspace audit renderer'],
    [ws.includes('does not alter the 77/77 A ledger'),'authority boundary'],
    [css.includes('.ws-audit-funnel'),'audit styling'],
    [test.includes('Ground Soul economic coverage diagnostics'),'workspace regression test'],
    [server.includes('ground-soul-coverage'),'summary endpoint'],
    [server.includes('groundSoulCoverage'),'evidence endpoint'],
    [script.includes('GROUND SOUL ECONOMIC COVERAGE / EXCLUSION AUDIT V01'),'research script'],
    [helper.includes("authorityStatus:'B_DIAGNOSTIC'"),'B diagnostic helper'],
    [helper.includes('UNRESOLVED_NONISOLATED_TERMINATION'),'collision taxonomy'],
  ];
  const failed=checks.filter(([ok])=>!ok).map(([,label])=>label);if(failed.length)throw new Error(`Verification failed: ${failed.join(', ')}`);
}
