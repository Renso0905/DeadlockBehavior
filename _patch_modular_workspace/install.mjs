import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=process.argv[2];
if(!repoRoot)throw new Error('Usage: node install.mjs <RepoRoot>');
const patchRoot=dirname(fileURLToPath(import.meta.url));
const payloadRoot=join(patchRoot,'payload');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`modular-workspace-v01-${stamp}`);

const required=['inspector-v04/public/index.html','inspector-v04/public/app.js','inspector-v04/server.mjs','inspector-v04/test-inspector.ps1'];
const payloadFiles=['inspector-v04/public/workspace.js','inspector-v04/public/workspace.css','inspector-v04/tests/workspace-ui.test.mjs'];
const touched=['inspector-v04/public/index.html',...payloadFiles];
for(const rel of required)if(!existsSync(join(repoRoot,rel)))throw new Error(`Required inspector file missing: ${rel}`);
for(const rel of payloadFiles)if(!existsSync(join(payloadRoot,rel)))throw new Error(`Payload missing: ${rel}`);
const index0=await readFile(join(repoRoot,'inspector-v04/public/index.html'),'utf8');
if(!index0.includes('/app.js'))throw new Error('Inspector shell marker /app.js was not found.');

const originals=new Map();
for(const rel of touched){const present=existsSync(join(repoRoot,rel));originals.set(rel,present);if(present)await backup(rel);}

try{
  for(const rel of payloadFiles){const src=join(payloadRoot,rel),dst=join(repoRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);console.log(`Installed: ${rel}`);}
  await patchIndex();
  await verify();
}catch(error){
  console.error('');console.error(`INSTALLATION FAILED: ${error?.message??error}`);console.error('Restoring pre-install files from backup...');await rollback();console.error(`Rollback complete. Backup retained at: ${backupRoot}`);throw error;
}

console.log('');
console.log('MODULAR WORKSPACE V01 INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('No metric authority or production counts were changed.');
console.log('Run .\\inspector-v04\\test-inspector.ps1, then restart the inspector and open the new Workspace tab.');

async function backup(rel){const src=join(repoRoot,rel),dst=join(backupRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);}
async function rollback(){for(const [rel,present] of originals){const dst=join(repoRoot,rel),bak=join(backupRoot,rel);if(present&&existsSync(bak)){await mkdir(dirname(dst),{recursive:true});await copyFile(bak,dst);}else if(!present&&existsSync(dst)){await rm(dst,{force:true});}}}
async function patchIndex(){const rel='inspector-v04/public/index.html',p=join(repoRoot,rel);let t=await readFile(p,'utf8');
  if(!t.includes('/workspace.css')){
    const marker='<link rel="stylesheet" href="/styles.css" />';if(!t.includes(marker))throw new Error('styles.css link marker missing from index.html.');t=t.replace(marker,marker+'\n  <link rel="stylesheet" href="/workspace.css" />');
  }
  if(!t.includes('/workspace.js')){
    const auth='<script type="module" src="/authoritative.js"></script>';
    const app='<script type="module" src="/app.js"></script>';
    if(t.includes(auth))t=t.replace(auth,auth+'\n  <script type="module" src="/workspace.js"></script>');
    else if(t.includes(app))t=t.replace(app,app+'\n  <script type="module" src="/workspace.js"></script>');
    else throw new Error('app.js script marker missing from index.html.');
  }
  await writeFile(p,t,'utf8');console.log(`Patched: ${rel}`);
}
async function verify(){const [html,js,css,test]=await Promise.all(touched.map(rel=>readFile(join(repoRoot,rel),'utf8')));const checks=[[html.includes('/workspace.css'),'workspace CSS link'],[html.includes('/workspace.js'),'workspace module link'],[js.includes("const WORKSPACE_TAB_ID='modular-workspace'"),'workspace tab'],[js.includes('ground_soul_economic_gain'),'Ground Soul economic gain adapter'],[js.includes('dragstart'),'drag-and-drop'],[js.includes('workspaceState.baseline'),'baseline comparison'],[css.includes('.ws-grid'),'workspace layout CSS'],[test.includes("test('modular workspace is wired"),'workspace regression test']];const failed=checks.filter(([ok])=>!ok).map(([,name])=>name);if(failed.length)throw new Error(`Verification failed: ${failed.join(', ')}`);}
