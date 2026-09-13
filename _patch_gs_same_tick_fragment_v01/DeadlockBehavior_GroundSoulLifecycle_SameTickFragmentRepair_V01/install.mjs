import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=process.argv[2];
if(!repoRoot)throw new Error('Usage: node install.mjs <RepoRoot>');
const patchRoot=dirname(fileURLToPath(import.meta.url));
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`ground-soul-same-tick-fragment-repair-v01-${stamp}`);
const libRel='inspector-v04/lib/runtime-ground-soul-lifecycle.mjs';
const producerRel='inspector-v04/production/extract-runtime-ground-soul-lifecycle.mjs';
const testRel='inspector-v04/tests/runtime-ground-soul-same-tick-fragment-repair.test.mjs';
for(const rel of [libRel,producerRel])if(!existsSync(join(repoRoot,rel)))throw new Error(`Required current file missing: ${rel}`);
for(const rel of [libRel,producerRel,testRel])await backupIfPresent(rel);

await patchLib();
await patchProducer();
await mkdir(dirname(join(repoRoot,testRel)),{recursive:true});
await copyFile(join(patchRoot,'payload',testRel),join(repoRoot,testRel));
console.log(`Installed: ${testRel}`);
await verify();
console.log('');
console.log('GROUND SOUL SAME-TICK FRAGMENT REPAIR V01 INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('No authority count or semantic claim changed. Unexpected duplicate-key shapes still fail closed.');

async function backupIfPresent(rel){const src=join(repoRoot,rel);if(!existsSync(src))return;const dst=join(backupRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);}
async function rw(rel,fn){const p=join(repoRoot,rel);const before=await readFile(p,'utf8');const after=fn(before);if(after!==before){await writeFile(p,after,'utf8');console.log(`Patched: ${rel}`);}else console.log(`Already applied: ${rel}`);}

async function patchLib(){await rw(libRel,t=>{
  if(t.includes('export function collapseBenignSameTickReactivationFragments'))return t;
  return t.trimEnd()+`\n\n/**\n * Canonicalize one narrowly defined Source2 packet-fragmentation signature.\n *\n * A removable group must contain exactly two records with the same entity/tick.\n * The first must be a finalized, censored, zero-duration\n * REACTIVATED_WITHOUT_INACTIVE_CENSORED fragment and the second must be the\n * immediately consecutive sequence. All other duplicate shapes are preserved\n * so the producer's existing duplicateActivationKeys integrity check still\n * fails closed. The input array is mutated in place only for qualifying rows.\n */\nexport function collapseBenignSameTickReactivationFragments(episodes=[]){\n  const groups=new Map();\n  for(const e of episodes??[]){\n    const tick=finite(e?.activationTick),entity=finite(e?.entityIndex);\n    if(tick===null||entity===null)continue;\n    const k=String(Math.trunc(entity))+':'+String(Math.trunc(tick));\n    if(!groups.has(k))groups.set(k,[]);\n    groups.get(k).push(e);\n  }\n  const remove=new Set(),resolvedGroups=[];\n  let duplicateGroups=0,unresolvedDuplicateGroups=0;\n  for(const [key,rows0] of groups){\n    if(rows0.length<2)continue;\n    duplicateGroups++;\n    const rows=[...rows0].sort((a,b)=>(finite(a?.sequence)??0)-(finite(b?.sequence)??0));\n    let resolved=false;\n    if(rows.length===2){\n      const [fragment,successor]=rows;\n      const sameTick=finite(fragment.activationTick)!==null&&finite(fragment.activationTick)===finite(fragment.endTick)&&finite(fragment.activationTick)===finite(successor.activationTick);\n      const zeroDuration=finite(fragment.durationSeconds)===0;\n      const exactReason=fragment.endReason==='REACTIVATED_WITHOUT_INACTIVE_CENSORED'&&fragment.censored===true&&fragment.finalized===true;\n      const consecutive=Number.isInteger(Number(fragment.sequence))&&Number(successor.sequence)===Number(fragment.sequence)+1;\n      const sameEntity=Number(fragment.entityIndex)===Number(successor.entityIndex);\n      if(sameTick&&zeroDuration&&exactReason&&consecutive&&sameEntity){\n        remove.add(fragment);resolved=true;\n        resolvedGroups.push({key,entityIndex:fragment.entityIndex,activationTick:fragment.activationTick,removedSequence:fragment.sequence,retainedSequence:successor.sequence,removedActivationId:fragment.activationId??null,retainedActivationId:successor.activationId??null});\n      }\n    }\n    if(!resolved)unresolvedDuplicateGroups++;\n  }\n  if(remove.size){\n    let w=0;for(let r=0;r<episodes.length;r++){if(remove.has(episodes[r]))continue;episodes[w++]=episodes[r];}episodes.length=w;\n  }\n  return {duplicateGroups,removedCount:remove.size,resolvedGroups,unresolvedDuplicateGroups};\n}\n`;
});}

async function patchProducer(){await rw(producerRel,t=>{
  if(!t.includes('collapseBenignSameTickReactivationFragments')){
    const re=/import \{([^}]+)\} from '\.\.\/lib\/runtime-ground-soul-lifecycle\.mjs';/;
    const m=t.match(re);if(!m)throw new Error('Ground Soul lifecycle helper import not found.');
    const names=m[1].trim();
    t=t.replace(re,`import { ${names}, collapseBenignSameTickReactivationFragments } from '../lib/runtime-ground-soul-lifecycle.mjs';`);
  }
  if(!t.includes('const sameTickFragmentRepair=collapseBenignSameTickReactivationFragments(episodes);')){
    const marker='const summary=buildGroundSoulLifecycleSummary(episodes);';
    if(!t.includes(marker))throw new Error('Lifecycle summary marker not found.');
    t=t.replace(marker,`const sameTickFragmentRepair=collapseBenignSameTickReactivationFragments(episodes);\nif(sameTickFragmentRepair.removedCount){\n  console.log(\`Same-tick reactivation fragments canonicalized: \${sameTickFragmentRepair.removedCount} across \${sameTickFragmentRepair.resolvedGroups.length} duplicate groups\`);\n}\n${marker}`);
  }
  if(!t.includes('sameTickReactivationFragmentRepair:sameTickFragmentRepair')){
    const marker='diagnostics:{';
    if(!t.includes(marker))throw new Error('Diagnostics object marker not found.');
    t=t.replace(marker,`diagnostics:{sameTickReactivationFragmentRepair:sameTickFragmentRepair,`);
  }
  return t;
});}

async function verify(){
  const lib=await readFile(join(repoRoot,libRel),'utf8');
  const producer=await readFile(join(repoRoot,producerRel),'utf8');
  const test=await readFile(join(repoRoot,testRel),'utf8');
  const checks=[
    [lib.includes('export function collapseBenignSameTickReactivationFragments'),'helper export'],
    [producer.includes('const sameTickFragmentRepair=collapseBenignSameTickReactivationFragments(episodes);'),'producer canonicalization'],
    [producer.includes('sameTickReactivationFragmentRepair:sameTickFragmentRepair'),'diagnostic preservation'],
    [producer.includes('duplicateActivationKeys:check'),'original fail-closed integrity check'],
    [test.includes('arbitrary duplicate activation keys are not silently discarded'),'regression test'],
  ];
  const failed=checks.filter(([ok])=>!ok).map(([,name])=>name);if(failed.length)throw new Error(`Installation verification failed: ${failed.join(', ')}`);
}
