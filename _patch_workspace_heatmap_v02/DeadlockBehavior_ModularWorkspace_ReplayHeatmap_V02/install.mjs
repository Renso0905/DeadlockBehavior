import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=process.argv[2];
if(!repoRoot)throw new Error('Usage: node install.mjs <RepoRoot>');
const patchRoot=dirname(fileURLToPath(import.meta.url));
const payloadRoot=join(patchRoot,'payload');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`modular-workspace-replay-heatmap-v02-${stamp}`);
const files=[
  'inspector-v04/public/workspace.js',
  'inspector-v04/public/workspace.css',
  'inspector-v04/tests/workspace-ui.test.mjs'
];

for(const rel of files){
  if(!existsSync(join(repoRoot,rel)))throw new Error(`Workspace V01 file missing: ${rel}. Install Modular Workspace V01 first.`);
  if(!existsSync(join(payloadRoot,rel)))throw new Error(`Payload missing: ${rel}`);
}
const existing=await readFile(join(repoRoot,'inspector-v04/public/workspace.js'),'utf8');
if(!existing.includes("const WORKSPACE_TAB_ID='modular-workspace'"))throw new Error('Existing workspace.js does not look like Modular Workspace V01.');

for(const rel of files){
  const src=join(repoRoot,rel),bak=join(backupRoot,rel);await mkdir(dirname(bak),{recursive:true});await copyFile(src,bak);
}
try{
  for(const rel of files){const src=join(payloadRoot,rel),dst=join(repoRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);console.log(`Installed: ${rel}`);}
  await verify();
}catch(error){
  console.error(`INSTALLATION FAILED: ${error?.message??error}`);
  for(const rel of files)await copyFile(join(backupRoot,rel),join(repoRoot,rel));
  console.error(`Restored backup: ${backupRoot}`);
  throw error;
}

console.log('');
console.log('MODULAR WORKSPACE REPLAY + HEAT MAP V02 INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('Authority contracts, production extraction, and the 77/77 ledger were not changed.');
console.log('Run .\\inspector-v04\\test-inspector.ps1, restart the inspector, then add Replay / heat map from Workspace.');

async function verify(){
  const [js,css,test]=await Promise.all(files.map(rel=>readFile(join(repoRoot,rel),'utf8')));
  const checks=[
    [js.includes('+ Replay / heat map'),'add spatial panel control'],
    [js.includes('spatialOccupancy'),'time-weighted occupancy'],
    [js.includes('spatialReplaySvg'),'replay spatial renderer'],
    [js.includes('workspacePlaybackTimer'),'playback control'],
    [js.includes('Gaps &gt;3 s are excluded'),'gap semantics'],
    [css.includes('.ws-heat-cell'),'heat-map styling'],
    [css.includes('.ws-spatial-trail'),'trail styling'],
    [test.includes("workspace replay heat map is additive"),'heat-map regression test']
  ];
  const failed=checks.filter(([ok])=>!ok).map(([,name])=>name);
  if(failed.length)throw new Error(`Verification failed: ${failed.join(', ')}`);
}
