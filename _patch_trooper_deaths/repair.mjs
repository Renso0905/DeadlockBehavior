import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const repoRoot=process.argv[2];
if(!repoRoot) throw new Error('Usage: node repair.mjs <RepoRoot>');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`trooper-deaths-extended-a-v01c-${stamp}`);
const files=[
  'inspector-v04/public/authoritative.js',
  'inspector-v04/tests/authoritative-stats.test.mjs',
  'inspector-v04/tests/production-pipeline.test.mjs',
];
for(const rel of files){
  const src=join(repoRoot,rel);
  if(!existsSync(src)) throw new Error(`Required file missing: ${rel}`);
  const dst=join(backupRoot,rel);
  await mkdir(dirname(dst),{recursive:true});
  await copyFile(src,dst);
}

await patchAuthoritative();
await patchAuthoritativeTests();
await patchPipelineTests();
await verify();

console.log('');
console.log('TROOPER DEATHS EXTENDED A V01C INTEGRATION REPAIR INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('Target: Core A 68/68 | Extended A 2/2 | Total A 70/70');
console.log('Next: rerun the full Node test suite before production.');

async function patchAuthoritative(){
  const rel='inspector-v04/public/authoritative.js';
  const path=join(repoRoot,rel);
  let t=await readFile(path,'utf8');

  const auth=t.match(/const AUTH_IDS=\[(.*?)\];/s);
  if(!auth) throw new Error('AUTH_IDS contract not found in authoritative.js');
  let inner=auth[1];
  const ids=[...inner.matchAll(/'([^']+)'/g)].map(m=>m[1]);
  const additions=['trooper_deaths','trooper_death_timing'].filter(id=>!ids.includes(id));
  if(additions.length){
    const primaryMarker="  'primary_discharges'";
    if(inner.includes(primaryMarker)) inner=inner.replace(primaryMarker,`  ${additions.map(x=>`'${x}'`).join(',')},\n${primaryMarker}`);
    else inner += `\n  ${additions.map(x=>`'${x}'`).join(',')}`;
    t=t.slice(0,auth.index)+`const AUTH_IDS=[${inner}];`+t.slice(auth.index+auth[0].length);
  }

  if(!t.includes("case 'trooper_deaths':")){
    const marker="    case 'primary_discharges':";
    const i=t.indexOf(marker);
    if(i<0) throw new Error("Primary-fire switch marker not found in authoritative.js");
    const block=`    case 'trooper_deaths': return v(model.troopers?.deaths??model.troopers?.summary?.deaths??'—','Observed CNPC_Trooper positive-health → 0 transitions');\n`+
      `    case 'trooper_death_timing': { const ts=model.troopers?.summary??{}; const times=ts.deathTimesSeconds??[]; return v(\`${'${'}ts.gameplayDeaths??times.length} gameplay deaths\`,times.length?\`first ${'${'}clock(ts.firstGameplayDeathSeconds)} · median ${'${'}clock(ts.medianGameplayDeathSeconds)} · last ${'${'}clock(ts.lastGameplayDeathSeconds)}\`:'No gameplay deaths observed'); }\n`;
    t=t.slice(0,i)+block+t.slice(i);
  }
  await writeFile(path,t,'utf8');
  console.log(`Patched: ${rel}`);
}

async function patchAuthoritativeTests(){
  const rel='inspector-v04/tests/authoritative-stats.test.mjs';
  const path=join(repoRoot,rel);
  let t=await readFile(path,'utf8');
  t=t.replace(/assert\.equal\(authoritative\.length,\d+,'A-status metric count changed; review the display contract intentionally'\);/,
    "assert.equal(authoritative.length,70,'A-status metric count changed; review the display contract intentionally');");
  if(!t.includes("assert.equal(authoritative.length,70")) throw new Error('Could not update Authoritative Stats metric-count assertion');
  await writeFile(path,t,'utf8');
  console.log(`Patched: ${rel}`);
}

async function patchPipelineTests(){
  const rel='inspector-v04/tests/production-pipeline.test.mjs';
  const path=join(repoRoot,rel);
  let t=await readFile(path,'utf8');
  const s1=t.indexOf("test('production capability contract owns every A metric exactly once'");
  const s2=t.indexOf("test('pipeline requires fresh outputs",s1+1);
  const s3=t.indexOf("test('existing outputs are not accepted",s2+1);
  if(s1<0||s2<0||s3<0) throw new Error('Could not locate the production integration test boundaries');

  const test1=`test('production capability contract owns every A metric exactly once',()=>{\n`+
`  const a=METRIC_REGISTRY.flatMap(s=>s.metrics).filter(m=>m.status==='A').map(m=>m.id).sort();\n`+
`  const production=[...AUTHORITATIVE_PRODUCTION_METRIC_IDS].sort();\n`+
`  assert.equal(a.length,70);\n`+
`  assert.equal(new Set(production).size,70);\n`+
`  assert.deepEqual(production,a);\n`+
`  const core=PRODUCTION_CAPABILITIES.find(c=>c.id==='core_state_economy');\n`+
`  assert.equal(core.productionStatus,'supported');\n`+
`  assert.equal(core.metricIds.length,41);\n`+
`  assert.ok(!core.metricIds.includes('health_regen'));\n`+
`  const health=PRODUCTION_CAPABILITIES.find(c=>c.id==='health_regen');\n`+
`  assert.equal(health.productionStatus,'supported');\n`+
`  assert.equal(health.metricIds.length,1);\n`+
`  const items=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_item_ownership');\n`+
`  assert.equal(items.productionStatus,'supported');\n`+
`  assert.equal(items.metricIds.length,8);\n`+
`  const perm=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_permanent_buff_ownership');\n`+
`  assert.equal(perm.productionStatus,'supported');\n`+
`  assert.equal(perm.metricIds.length,6);\n`+
`  const bridge=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_bridge_buff_ownership');\n`+
`  assert.equal(bridge.productionStatus,'supported');\n`+
`  assert.equal(bridge.metricIds.length,7);\n`+
`  const fire=PRODUCTION_CAPABILITIES.find(c=>c.id==='primary_fire_cadence');\n`+
`  assert.equal(fire.productionStatus,'supported');\n`+
`  assert.equal(fire.metricIds.length,5);\n`+
`  const trooper=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_trooper_death_events');\n`+
`  assert.equal(trooper.productionStatus,'supported');\n`+
`  assert.equal(trooper.authorityLayer,'extended');\n`+
`  assert.deepEqual([...trooper.metricIds],['trooper_deaths','trooper_death_timing']);\n`+
`  const supported=PRODUCTION_CAPABILITIES.filter(c=>c.productionStatus==='supported');\n`+
`  const coreA=supported.filter(c=>(c.authorityLayer??'core')==='core').flatMap(c=>c.metricIds);\n`+
`  const extendedA=supported.filter(c=>c.authorityLayer==='extended').flatMap(c=>c.metricIds);\n`+
`  assert.equal(coreA.length,68);\n`+
`  assert.equal(extendedA.length,2);\n`+
`  assert.equal(supported.flatMap(c=>c.metricIds).length,70);\n`+
`});\n\n`;

  const test2=`test('pipeline requires fresh outputs and records 68/68 Core A plus 2/2 Extended A coverage',async()=>{\n`+
`  const root=await mkdtemp(join(tmpdir(),'db-production-'));\n`+
`  const inspector=join(root,'inspector-v04');\n`+
`  await mkdir(join(root,'replays'),{recursive:true}); await mkdir(inspector,{recursive:true});\n`+
`  await writeFile(join(root,'replays','fixture.dem'),'fixture');\n`+
`  async function fixtureProducer(name,files){\n`+
`    const path=join(root,name);\n`+
`    const payload=JSON.stringify(files);\n`+
`    await writeFile(path,\`import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';const root=process.argv[2],r=process.argv[3],files=${'${'}payload};await mkdir(join(root,'output',r),{recursive:true});for(const f of files)await writeFile(join(root,'output',r,f),'{}\\\\n');\`);\n`+
`    return path;\n`+
`  }\n`+
`  const producer=await fixtureProducer('producer.mjs',['player_state.jsonl','player_state_summary.json']);\n`+
`  const healthProducer=await fixtureProducer('health-producer.mjs',['runtime_health_regen_production_v01.json','runtime_health_regen_events_v01.jsonl']);\n`+
`  const itemProducer=await fixtureProducer('item-producer.mjs',['runtime_item_ownership_production_v01.json','runtime_item_ownership_events_v01.jsonl']);\n`+
`  const permProducer=await fixtureProducer('perm-producer.mjs',['runtime_permanent_buff_ownership_production_v01.json','runtime_permanent_buff_events_v01.jsonl']);\n`+
`  const bridgeProducer=await fixtureProducer('bridge-producer.mjs',['runtime_bridge_buff_ownership_production_v01.json','runtime_bridge_buff_events_v01.jsonl']);\n`+
`  const fireProducer=await fixtureProducer('fire-producer.mjs',['runtime_primary_fire_production_v01.json','runtime_primary_fire_events_v01.jsonl']);\n`+
`  const trooperProducer=await fixtureProducer('trooper-producer.mjs',['runtime_trooper_deaths_production_v01.json','runtime_trooper_death_events_v01.jsonl']);\n`+
`  const outputs=files=>files.map(path=>({path:\`output/{replay}/${'${'}path}\`,minBytes:2}));\n`+
`  const pipeline={version:'TEST',manifestFile:'production_manifest_v01.json',steps:[\n`+
`    {id:'core',label:'core',capability:'core_state_economy',required:true,args:[producer,'{repoRoot}','{replay}'],ifExists:'replays/{replay}.dem',expectedOutputs:outputs(['player_state.jsonl','player_state_summary.json'])},\n`+
`    {id:'health',label:'health',capability:'health_regen',required:true,dependsOn:['core'],args:[healthProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_health_regen_production_v01.json','runtime_health_regen_events_v01.jsonl'])},\n`+
`    {id:'items',label:'items',capability:'runtime_item_ownership',required:true,dependsOn:['core'],args:[itemProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_item_ownership_production_v01.json','runtime_item_ownership_events_v01.jsonl'])},\n`+
`    {id:'perm',label:'perm',capability:'runtime_permanent_buff_ownership',required:true,dependsOn:['core'],args:[permProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_permanent_buff_ownership_production_v01.json','runtime_permanent_buff_events_v01.jsonl'])},\n`+
`    {id:'bridge',label:'bridge',capability:'runtime_bridge_buff_ownership',required:true,dependsOn:['core'],args:[bridgeProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_bridge_buff_ownership_production_v01.json','runtime_bridge_buff_events_v01.jsonl'])},\n`+
`    {id:'fire',label:'fire',capability:'primary_fire_cadence',required:true,dependsOn:['core'],args:[fireProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_primary_fire_production_v01.json','runtime_primary_fire_events_v01.jsonl'])},\n`+
`    {id:'trooper',label:'trooper',capability:'runtime_trooper_death_events',required:true,dependsOn:['core'],args:[trooperProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_trooper_deaths_production_v01.json','runtime_trooper_death_events_v01.jsonl'])}\n`+
`  ]};\n`+
`  await writeFile(join(inspector,'pipeline.json'),JSON.stringify(pipeline));\n`+
`  const result=await runPipeline({repoRoot:root,inspectorRoot:inspector,replayName:'fixture'});\n`+
`  assert.equal(result.status,'COMPLETE');\n`+
`  for(const id of ['core','health','items','perm','bridge','fire','trooper']) assert.equal(result.results.find(r=>r.id===id)?.status,'complete',\`${'${'}id} fixture step must complete\`);\n`+
`  assert.equal(result.productionManifest.coverage.completeAuthoritative,70);\n`+
`  assert.equal(result.productionManifest.coverage.authoritativeTotal,70);\n`+
`  assert.equal(result.productionManifest.coverage.notSupportedAuthoritative,0);\n`+
`  assert.equal(result.productionManifest.coverage.failedAuthoritative,0);\n`+
`  assert.equal(result.productionManifest.coverage.blockedAuthoritative,0);\n`+
`  assert.equal(result.productionManifest.coverage.unclassifiedAuthoritative,0);\n`+
`  assert.equal(result.productionManifest.coverage.core.completeAuthoritative,68);\n`+
`  assert.equal(result.productionManifest.coverage.core.authoritativeTotal,68);\n`+
`  assert.equal(result.productionManifest.coverage.extended.completeAuthoritative,2);\n`+
`  assert.equal(result.productionManifest.coverage.extended.authoritativeTotal,2);\n`+
`  const disk=JSON.parse(await readFile(join(root,'output','fixture','production_manifest_v01.json'),'utf8'));\n`+
`  assert.equal(disk.coverage.authoritativeTotal,70);\n`+
`  assert.equal(disk.coverage.core.authoritativeTotal,68);\n`+
`  assert.equal(disk.coverage.extended.authoritativeTotal,2);\n`+
`});\n\n`;

  t=t.slice(0,s1)+test1+test2+t.slice(s3);
  await writeFile(path,t,'utf8');
  console.log(`Patched: ${rel}`);
}

async function verify(){
  const auth=await readFile(join(repoRoot,'inspector-v04/public/authoritative.js'),'utf8');
  const authTest=await readFile(join(repoRoot,'inspector-v04/tests/authoritative-stats.test.mjs'),'utf8');
  const pipeTest=await readFile(join(repoRoot,'inspector-v04/tests/production-pipeline.test.mjs'),'utf8');
  const checks=[
    [auth.includes("'trooper_deaths'"),'authoritative.js AUTH_IDS trooper_deaths'],
    [auth.includes("'trooper_death_timing'"),'authoritative.js AUTH_IDS trooper_death_timing'],
    [auth.includes("case 'trooper_deaths':"),'authoritative.js trooper_deaths case'],
    [auth.includes("case 'trooper_death_timing':"),'authoritative.js trooper_death_timing case'],
    [authTest.includes('authoritative.length,70'),'authoritative test count 70'],
    [pipeTest.includes('const coreA=supported.filter'),'pipeline Core A contract'],
    [pipeTest.includes("'runtime_trooper_death_events'"),'pipeline Trooper fixture'],
    [pipeTest.includes('coverage.extended.completeAuthoritative,2'),'pipeline Extended A coverage assertion'],
  ];
  const failed=checks.filter(([ok])=>!ok).map(([,name])=>name);
  if(failed.length) throw new Error(`Repair verification failed: ${failed.join(', ')}`);
}
