import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=process.argv[2];
if(!repoRoot)throw new Error('Usage: node install.mjs <RepoRoot>');
const patchRoot=dirname(fileURLToPath(import.meta.url));
const payloadRoot=join(patchRoot,'payload');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`ground-soul-lifecycle-extended-a-v01-${stamp}`);
const required=[
  'contracts/claim_registry_v03.json',
  'inspector-v04/pipeline.json',
  'inspector-v04/lib/production-capabilities.mjs',
  'inspector-v04/lib/metric-registry.mjs',
  'inspector-v04/lib/replay-model.mjs',
  'inspector-v04/lib/io.mjs',
  'inspector-v04/server.mjs',
  'inspector-v04/public/app.js',
  'inspector-v04/public/authoritative.js',
  'inspector-v04/tests/authoritative-stats.test.mjs',
  'inspector-v04/tests/production-pipeline.test.mjs',
];
for(const rel of required){if(!existsSync(join(repoRoot,rel)))throw new Error(`Required current file missing: ${rel}`);}
const cap0=await readFile(join(repoRoot,'inspector-v04/lib/production-capabilities.mjs'),'utf8');
if(!cap0.includes("capability('runtime_trooper_death_events'"))throw new Error('Prerequisite missing: Trooper Deaths Extended A must be installed first.');
if(!cap0.includes('CORE_AUTHORITATIVE_PRODUCTION_METRIC_IDS'))throw new Error('Prerequisite missing: Core/Extended authority ledger not found.');

const newFiles=[
  'inspector-v04/lib/runtime-ground-soul-lifecycle.mjs',
  'inspector-v04/production/extract-runtime-ground-soul-lifecycle.mjs',
  'inspector-v04/tests/runtime-ground-soul-lifecycle.test.mjs',
];
for(const rel of [...required,...newFiles])await backupIfPresent(rel);
for(const rel of newFiles){const src=join(payloadRoot,rel),dst=join(repoRoot,rel);if(!existsSync(src))throw new Error(`Payload missing: ${rel}`);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);console.log(`Installed: ${rel}`);}

await patchClaimRegistry();
await patchPipelineJson();
await patchCapabilities();
await patchMetricRegistry();
await patchReplayModel();
await patchSourceHealthRegistry();
await patchServer();
await patchApp();
await patchAuthoritative();
await patchAuthoritativeTests();
await patchPipelineTests();
await verify();

console.log('');
console.log('GROUND SOUL LIFECYCLE EXTENDED A V01 INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('Authority ledger target: Core A 68/68 | Extended A 5/5 | Total A 73/73');
console.log('Next: run Node syntax/tests, then production on 104373259.');

async function backupIfPresent(rel){const src=join(repoRoot,rel);if(!existsSync(src))return;const dst=join(backupRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);}
async function rw(rel,fn){const p=join(repoRoot,rel);const before=await readFile(p,'utf8');const after=await fn(before);if(typeof after!=='string')throw new Error(`Patch function did not return text: ${rel}`);if(after!==before){await writeFile(p,after,'utf8');console.log(`Patched: ${rel}`);}else console.log(`Already applied: ${rel}`);}

async function patchClaimRegistry(){
  const rel='contracts/claim_registry_v03.json',p=join(repoRoot,rel);const o=JSON.parse(await readFile(p,'utf8'));
  let c=(o.claims??[]).find(x=>x.claimId==='ground_soul_lifecycle');
  const authoritative={
    claimId:'ground_soul_lifecycle',domain:'souls',construct:'CCitadel_Pickup_AssignedGold activation, physical vacuum-target, and active lifecycle semantics',
    authorityStatus:'current',integrityValidation:'pass',semanticValidation:'strong_support',replicationStatus:'multi_replay_supported',scope:'Observed AssignedGold lifecycle only; no collector, reward, exact radius, or unmatched-death semantics.',
    sourceScripts:['75-assigned-gold-lifecycle','88-assigned-gold-lifecycle-classifier','103-foundational-replication','104-foundational-replication'],
    currentArtifacts:['output/cross_replay/foundational_replication_metrics_v02.json','output/cross_replay/foundational_replication_interpretation_audit_v01.json'],
    downstreamUses:['ground-soul lifecycle visualization','resource-state construction','future opportunity models'],
    valueSummary:{replicatedReplays:5},supersedes:[],supersededBy:null,
    notes:'5/5 independent replay support for Ground-Soul/AssignedGold lifecycle. m_hVacuumTarget is physical target telemetry only. m_bActive=false is lifecycle termination only. Exact 732/735-HU radius, economic recipient identity, reward amount/formula, and unmatched=missed interpretations are excluded.'
  };
  if(c)Object.assign(c,authoritative);else(o.claims??=[]).push(authoritative);
  await writeFile(p,JSON.stringify(o,null,2)+'\n','utf8');console.log(`Patched: ${rel}`);
}

async function patchPipelineJson(){
  const rel='inspector-v04/pipeline.json',p=join(repoRoot,rel);const o=JSON.parse(await readFile(p,'utf8'));const core=o.steps.find(s=>s.capability==='core_state_economy');if(!core)throw new Error('Core production step not found');
  const step={id:'ground-soul-lifecycle',label:'Extract authoritative Ground Soul lifecycle',capability:'runtime_ground_soul_lifecycle',required:true,dependsOn:[core.id],args:['inspector-v04/production/extract-runtime-ground-soul-lifecycle.mjs','replays/{replay}.dem'],ifExists:'replays/{replay}.dem',expectedOutputs:[{path:'output/{replay}/runtime_ground_soul_lifecycle_production_v01.json',minBytes:2},{path:'output/{replay}/runtime_ground_soul_lifecycle_events_v01.jsonl',minBytes:0}]};
  const existing=o.steps.findIndex(s=>s.capability==='runtime_ground_soul_lifecycle');
  if(existing>=0)o.steps[existing]=step;else{const i=o.steps.findIndex(s=>s.capability==='runtime_trooper_death_events');o.steps.splice(i>=0?i+1:1,0,step);}
  await writeFile(p,JSON.stringify(o,null,2)+'\n','utf8');console.log(`Patched: ${rel}`);
}

async function patchCapabilities(){await rw('inspector-v04/lib/production-capabilities.mjs',t=>{
  if(t.includes("capability('runtime_ground_soul_lifecycle'"))return t;
  const marker=/\r?\n\];\r?\n\r?\nexport const CORE_AUTHORITATIVE_PRODUCTION_METRIC_IDS/;const m=t.match(marker);if(!m)throw new Error('Capability array terminator not found');
  const block=",\n  capability('runtime_ground_soul_lifecycle', 'Observed Ground Soul / AssignedGold lifecycle', 'supported', [\n    'ground_soul_activations','ground_soul_targeted_activations','ground_soul_lifecycle_duration'\n  ], {\n    integrityValidation: 'Fresh runtime_ground_soul_lifecycle_production_v01.json and runtime_ground_soul_lifecycle_events_v01.jsonl must be produced. Activation identities are unique and completed active-to-inactive durations must be nonnegative.',\n    semanticValidation: 'ground_soul_lifecycle current claim. CCitadel_Pickup_AssignedGold m_bActive defines the replicated lifecycle carrier; m_hVacuumTarget is physical target telemetry only. Inactivity is not relabeled collection or payout.',\n    replicationStatus: 'Ground-Soul production/lifecycle semantics reproduced across five independent replays. Exact vacuum radius, economic recipient identity, reward allocation, and unmatched-death interpretation remain outside this capability.'\n  }, null, 'extended')";
  return t.replace(marker,block+m[0]);
});}

async function patchMetricRegistry(){await rw('inspector-v04/lib/metric-registry.mjs',t=>{
  if(t.includes("m('ground_soul_activations'"))return t;
  const marker=/^(\s*)m\('trooper_death_timing'[^\n]*\),\r?\n/m;const m=t.match(marker);if(!m)throw new Error('trooper_death_timing registry marker not found');const ind=m[1];
  const block=`${m[0]}${ind}m('ground_soul_activations','Ground Soul activations',A,'integer','runtime_ground_soul_lifecycle_events','Observed CCitadel_Pickup_AssignedGold active lifecycle activations.'),\n${ind}m('ground_soul_targeted_activations','Vacuum-targeted Ground Soul activations',A,'integer','runtime_ground_soul_lifecycle_events','Ground Soul lifecycle activations that acquire a valid physical m_hVacuumTarget handle; not an economic-recipient claim.'),\n${ind}m('ground_soul_lifecycle_duration','Ground Soul lifecycle duration',A,'seconds','runtime_ground_soul_lifecycle_events','Median duration of completed observed m_bActive true→false Ground Soul lifecycle episodes; censored episodes excluded.'),\n`;
  return t.replace(marker,block);
});}

async function patchReplayModel(){await rw('inspector-v04/lib/replay-model.mjs',t=>{
  if(!t.includes("'runtime_ground_soul_lifecycle_production_v01.json'")){
    const marker="'runtime_trooper_deaths_production_v01.json','runtime_trooper_death_events_v01.jsonl'";if(!t.includes(marker))throw new Error('Trooper fingerprint marker missing');t=t.replace(marker,marker+",'runtime_ground_soul_lifecycle_production_v01.json','runtime_ground_soul_lifecycle_events_v01.jsonl'");
  }
  if(!t.includes("const runtimeGroundSoulLifecycle=await readJson(join(dir,'runtime_ground_soul_lifecycle_production_v01.json'));")){
    const marker="  const runtimeTrooperDeaths=await readJson(join(dir,'runtime_trooper_deaths_production_v01.json'));";if(!t.includes(marker))throw new Error('Runtime Trooper read marker missing');t=t.replace(marker,marker+"\n  const runtimeGroundSoulLifecycle=await readJson(join(dir,'runtime_ground_soul_lifecycle_production_v01.json')); ");
  }
  if(!t.includes('groundSoulLifecycle:runtimeGroundSoulLifecycle')){
    const marker='    troopers,\n';if(!t.includes(marker)){const cr='    troopers,\r\n';if(!t.includes(cr))throw new Error('troopers model marker missing');t=t.replace(cr,cr+"    groundSoulLifecycle:runtimeGroundSoulLifecycle?.status==='RUNTIME_GROUND_SOUL_LIFECYCLE_PRODUCTION_V01_READY'?{status:runtimeGroundSoulLifecycle.status,authorityLayer:'extended',summary:runtimeGroundSoulLifecycle.summary,counts:runtimeGroundSoulLifecycle.counts,semanticScope:runtimeGroundSoulLifecycle.semanticScope,validation:runtimeGroundSoulLifecycle.validation,source:'runtime_ground_soul_lifecycle_production_v01.json'}:null,\r\n");}else t=t.replace(marker,marker+"    groundSoulLifecycle:runtimeGroundSoulLifecycle?.status==='RUNTIME_GROUND_SOUL_LIFECYCLE_PRODUCTION_V01_READY'?{status:runtimeGroundSoulLifecycle.status,authorityLayer:'extended',summary:runtimeGroundSoulLifecycle.summary,counts:runtimeGroundSoulLifecycle.counts,semanticScope:runtimeGroundSoulLifecycle.semanticScope,validation:runtimeGroundSoulLifecycle.validation,source:'runtime_ground_soul_lifecycle_production_v01.json'}:null,\n");
  }
  return t;
});}

async function patchSourceHealthRegistry(){await rw('inspector-v04/lib/io.mjs',t=>{
  if(t.includes("['runtime_ground_soul_lifecycle','runtime_ground_soul_lifecycle_production_v01.json'"))return t;
  const marker="    ['runtime_trooper_death_events','runtime_trooper_death_events_v01.jsonl','A','Extended A: authoritative Trooper death timing evidence'],";if(!t.includes(marker))throw new Error('Trooper Source Health marker missing');
  return t.replace(marker,marker+"\n    ['runtime_ground_soul_lifecycle','runtime_ground_soul_lifecycle_production_v01.json','A','Extended A: replicated Ground Soul / AssignedGold lifecycle summary'],\n    ['runtime_ground_soul_lifecycle_events','runtime_ground_soul_lifecycle_events_v01.jsonl','A','Extended A: Ground Soul activation, physical vacuum-target, termination, and censoring evidence'],");
});}

async function patchServer(){await rw('inspector-v04/server.mjs',t=>{
  if(t.includes("groundSoulLifecycle:['jsonl','runtime_ground_soul_lifecycle_events_v01.jsonl']"))return t;
  const marker="  troopers:['jsonl','runtime_trooper_death_events_v01.jsonl'],";if(!t.includes(marker))throw new Error('Trooper evidence endpoint marker missing');
  return t.replace(marker,marker+"\n  groundSoulLifecycle:['jsonl','runtime_ground_soul_lifecycle_events_v01.jsonl'],");
});}

async function patchApp(){await rw('inspector-v04/public/app.js',t=>{
  if(!t.includes('groundSoulLifecycle??{}')){
    const marker='function souls(p){const t=state.model.troopers??{},g=state.model.groundSouls??{}';if(!t.includes(marker))throw new Error('souls() model header marker missing');t=t.replace(marker,'function souls(p){const t=state.model.troopers??{},gl=state.model.groundSoulLifecycle??{},g=state.model.groundSouls??{}');
  }
  if(!t.includes("section('Ground Soul lifecycle'")){
    const marker=")+section('Ground soul one-to-one model'";if(!t.includes(marker))throw new Error('Ground soul research section marker missing');
    const replacement=")+section('Ground Soul lifecycle','Extended A: replicated CCitadel_Pickup_AssignedGold active lifecycle; physical vacuum targeting is kept separate from economic credit',`<div class=\"grid\">${metricCard('ground_soul_activations',gl.summary?.activations??'—','groundSoulLifecycle',`gameplay ${gl.summary?.gameplayActivations??'—'} · pregame ${gl.summary?.pregameActivations??'—'}`)}${metricCard('ground_soul_targeted_activations',gl.summary?.targetedActivations??'—','groundSoulLifecycle',`${pct(gl.summary?.targetedShare)} of activations · targetless ${gl.summary?.targetlessActivations??'—'}`)}${metricCard('ground_soul_lifecycle_duration',gl.summary?.medianCompletedDurationSeconds!=null?`${gl.summary.medianCompletedDurationSeconds.toFixed(2)} s`:'—','groundSoulLifecycle',`median completed · completed ${gl.summary?.completedActiveToInactive??'—'} · censored ${gl.summary?.censoredActivations??'—'}`)}</div><div class=\"warning-box\"><strong>Extended-A boundary:</strong> m_hVacuumTarget is physical vacuum-target telemetry only. m_bActive=false is lifecycle termination only. Neither establishes collector, last hitter, payout, expiration, exact vacuum radius, or reward value.</div>${evidenceButton('Inspect authoritative Ground Soul lifecycle','groundSoulLifecycle')}`)+section('Ground Soul activation timeline','Cumulative observed AssignedGold activations at the global scrubber',`<div class=\"panel chart\">${lineChart(gl.summary?.cumulativeTimeline??[],'matchTime','activations',state.time,true)}</div>`)+section('Ground soul one-to-one model'";
    t=t.replace(marker,replacement);
  }
  if(!t.includes("'runtime_ground_soul_lifecycle'")){
    const marker="'runtime_trooper_death_events'";if(!t.includes(marker))throw new Error('Source Health productionIds Trooper marker missing');t=t.replace(marker,marker+",'runtime_ground_soul_lifecycle','runtime_ground_soul_lifecycle_events'");
  }
  return t;
});}

async function patchAuthoritative(){await rw('inspector-v04/public/authoritative.js',t=>{
  const auth=t.match(/const AUTH_IDS=\[(.*?)\];/s);if(!auth)throw new Error('AUTH_IDS contract not found');let inner=auth[1];const ids=[...inner.matchAll(/'([^']+)'/g)].map(x=>x[1]);const add=['ground_soul_activations','ground_soul_targeted_activations','ground_soul_lifecycle_duration'].filter(x=>!ids.includes(x));
  if(add.length){const marker="  'primary_discharges'";if(!inner.includes(marker))throw new Error('Primary AUTH_IDS marker missing');inner=inner.replace(marker,`  ${add.map(x=>`'${x}'`).join(',')},\n${marker}`);t=t.slice(0,auth.index)+`const AUTH_IDS=[${inner}];`+t.slice(auth.index+auth[0].length);}
  if(!t.includes("case 'ground_soul_activations':")){
    const marker="    case 'primary_discharges':";const i=t.indexOf(marker);if(i<0)throw new Error('Primary switch marker missing');
    const block="    case 'ground_soul_activations': return v(model.groundSoulLifecycle?.summary?.activations??'—','Match-level observed CCitadel_Pickup_AssignedGold active episodes');\n"+
      "    case 'ground_soul_targeted_activations': { const gs=model.groundSoulLifecycle?.summary??{}; return v(gs.targetedActivations??'—',`${percent(gs.targetedShare)} of observed activations · physical m_hVacuumTarget only`); }\n"+
      "    case 'ground_soul_lifecycle_duration': { const gs=model.groundSoulLifecycle?.summary??{}; return v(gs.medianCompletedDurationSeconds!=null?duration(gs.medianCompletedDurationSeconds):'—',`${gs.completedActiveToInactive??0} completed active → inactive · ${gs.censoredActivations??0} censored`); }\n";
    t=t.slice(0,i)+block+t.slice(i);
  }
  return t;
});}

async function patchAuthoritativeTests(){await rw('inspector-v04/tests/authoritative-stats.test.mjs',t=>{
  t=t.replace(/assert\.equal\(authoritative\.length,\d+,'A-status metric count changed; review the display contract intentionally'\);/,"assert.equal(authoritative.length,73,'A-status metric count changed; review the display contract intentionally');");if(!t.includes('authoritative.length,73'))throw new Error('Could not update Authoritative Stats count to 73');return t;
});}

async function patchPipelineTests(){await rw('inspector-v04/tests/production-pipeline.test.mjs',t=>{
  const s1=t.indexOf("test('production capability contract owns every A metric exactly once'");const s2=t.indexOf("test('pipeline requires fresh outputs",s1+1);const s3=t.indexOf("test('existing outputs are not accepted",s2+1);if(s1<0||s2<0||s3<0)throw new Error('Production integration test boundaries missing');
  const test1=`test('production capability contract owns every A metric exactly once',()=>{\n  const a=METRIC_REGISTRY.flatMap(s=>s.metrics).filter(m=>m.status==='A').map(m=>m.id).sort();\n  const production=[...AUTHORITATIVE_PRODUCTION_METRIC_IDS].sort();\n  assert.equal(a.length,73);\n  assert.equal(new Set(production).size,73);\n  assert.deepEqual(production,a);\n  const core=PRODUCTION_CAPABILITIES.find(c=>c.id==='core_state_economy');\n  assert.equal(core.productionStatus,'supported');\n  assert.equal(core.metricIds.length,41);\n  const health=PRODUCTION_CAPABILITIES.find(c=>c.id==='health_regen');assert.equal(health.productionStatus,'supported');assert.equal(health.metricIds.length,1);\n  const items=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_item_ownership');assert.equal(items.metricIds.length,8);\n  const perm=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_permanent_buff_ownership');assert.equal(perm.metricIds.length,6);\n  const bridge=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_bridge_buff_ownership');assert.equal(bridge.metricIds.length,7);\n  const fire=PRODUCTION_CAPABILITIES.find(c=>c.id==='primary_fire_cadence');assert.equal(fire.metricIds.length,5);\n  const trooper=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_trooper_death_events');assert.equal(trooper.authorityLayer,'extended');assert.deepEqual([...trooper.metricIds],['trooper_deaths','trooper_death_timing']);\n  const ground=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_ground_soul_lifecycle');assert.equal(ground.productionStatus,'supported');assert.equal(ground.authorityLayer,'extended');assert.deepEqual([...ground.metricIds],['ground_soul_activations','ground_soul_targeted_activations','ground_soul_lifecycle_duration']);\n  const supported=PRODUCTION_CAPABILITIES.filter(c=>c.productionStatus==='supported');\n  const coreA=supported.filter(c=>(c.authorityLayer??'core')==='core').flatMap(c=>c.metricIds);\n  const extendedA=supported.filter(c=>c.authorityLayer==='extended').flatMap(c=>c.metricIds);\n  assert.equal(coreA.length,68);assert.equal(extendedA.length,5);assert.equal(supported.flatMap(c=>c.metricIds).length,73);\n});\n\n`;
  const test2=`test('pipeline requires fresh outputs and records 68/68 Core A plus 5/5 Extended A coverage',async()=>{\n  const root=await mkdtemp(join(tmpdir(),'db-production-'));const inspector=join(root,'inspector-v04');await mkdir(join(root,'replays'),{recursive:true});await mkdir(inspector,{recursive:true});await writeFile(join(root,'replays','fixture.dem'),'fixture');\n  async function fixtureProducer(name,files){const path=join(root,name),payload=JSON.stringify(files);await writeFile(path,\`import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';const root=process.argv[2],r=process.argv[3],files=\${payload};await mkdir(join(root,'output',r),{recursive:true});for(const f of files)await writeFile(join(root,'output',r,f),'{}\\\\n');\`);return path;}\n  const producer=await fixtureProducer('producer.mjs',['player_state.jsonl','player_state_summary.json']);\n  const healthProducer=await fixtureProducer('health-producer.mjs',['runtime_health_regen_production_v01.json','runtime_health_regen_events_v01.jsonl']);\n  const itemProducer=await fixtureProducer('item-producer.mjs',['runtime_item_ownership_production_v01.json','runtime_item_ownership_events_v01.jsonl']);\n  const permProducer=await fixtureProducer('perm-producer.mjs',['runtime_permanent_buff_ownership_production_v01.json','runtime_permanent_buff_events_v01.jsonl']);\n  const bridgeProducer=await fixtureProducer('bridge-producer.mjs',['runtime_bridge_buff_ownership_production_v01.json','runtime_bridge_buff_events_v01.jsonl']);\n  const fireProducer=await fixtureProducer('fire-producer.mjs',['runtime_primary_fire_production_v01.json','runtime_primary_fire_events_v01.jsonl']);\n  const trooperProducer=await fixtureProducer('trooper-producer.mjs',['runtime_trooper_deaths_production_v01.json','runtime_trooper_death_events_v01.jsonl']);\n  const groundProducer=await fixtureProducer('ground-producer.mjs',['runtime_ground_soul_lifecycle_production_v01.json','runtime_ground_soul_lifecycle_events_v01.jsonl']);\n  const outputs=files=>files.map(path=>({path:\`output/{replay}/\${path}\`,minBytes:2}));\n  const pipeline={version:'TEST',manifestFile:'production_manifest_v01.json',steps:[\n    {id:'core',label:'core',capability:'core_state_economy',required:true,args:[producer,'{repoRoot}','{replay}'],ifExists:'replays/{replay}.dem',expectedOutputs:outputs(['player_state.jsonl','player_state_summary.json'])},\n    {id:'health',label:'health',capability:'health_regen',required:true,dependsOn:['core'],args:[healthProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_health_regen_production_v01.json','runtime_health_regen_events_v01.jsonl'])},\n    {id:'items',label:'items',capability:'runtime_item_ownership',required:true,dependsOn:['core'],args:[itemProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_item_ownership_production_v01.json','runtime_item_ownership_events_v01.jsonl'])},\n    {id:'perm',label:'perm',capability:'runtime_permanent_buff_ownership',required:true,dependsOn:['core'],args:[permProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_permanent_buff_ownership_production_v01.json','runtime_permanent_buff_events_v01.jsonl'])},\n    {id:'bridge',label:'bridge',capability:'runtime_bridge_buff_ownership',required:true,dependsOn:['core'],args:[bridgeProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_bridge_buff_ownership_production_v01.json','runtime_bridge_buff_events_v01.jsonl'])},\n    {id:'fire',label:'fire',capability:'primary_fire_cadence',required:true,dependsOn:['core'],args:[fireProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_primary_fire_production_v01.json','runtime_primary_fire_events_v01.jsonl'])},\n    {id:'trooper',label:'trooper',capability:'runtime_trooper_death_events',required:true,dependsOn:['core'],args:[trooperProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_trooper_deaths_production_v01.json','runtime_trooper_death_events_v01.jsonl'])},\n    {id:'ground',label:'ground',capability:'runtime_ground_soul_lifecycle',required:true,dependsOn:['core'],args:[groundProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_ground_soul_lifecycle_production_v01.json','runtime_ground_soul_lifecycle_events_v01.jsonl'])}\n  ]};\n  await writeFile(join(inspector,'pipeline.json'),JSON.stringify(pipeline));const result=await runPipeline({repoRoot:root,inspectorRoot:inspector,replayName:'fixture'});\n  assert.equal(result.status,'COMPLETE');for(const id of ['core','health','items','perm','bridge','fire','trooper','ground'])assert.equal(result.results.find(r=>r.id===id)?.status,'complete',\`${id} fixture step must complete\`);\n  assert.equal(result.productionManifest.coverage.completeAuthoritative,73);assert.equal(result.productionManifest.coverage.authoritativeTotal,73);assert.equal(result.productionManifest.coverage.notSupportedAuthoritative,0);assert.equal(result.productionManifest.coverage.failedAuthoritative,0);assert.equal(result.productionManifest.coverage.blockedAuthoritative,0);assert.equal(result.productionManifest.coverage.unclassifiedAuthoritative,0);\n  assert.equal(result.productionManifest.coverage.core.completeAuthoritative,68);assert.equal(result.productionManifest.coverage.core.authoritativeTotal,68);assert.equal(result.productionManifest.coverage.extended.completeAuthoritative,5);assert.equal(result.productionManifest.coverage.extended.authoritativeTotal,5);\n  const disk=JSON.parse(await readFile(join(root,'output','fixture','production_manifest_v01.json'),'utf8'));assert.equal(disk.coverage.authoritativeTotal,73);assert.equal(disk.coverage.core.authoritativeTotal,68);assert.equal(disk.coverage.extended.authoritativeTotal,5);\n});\n\n`;
  return t.slice(0,s1)+test1+test2+t.slice(s3);
});}

async function verify(){
  const checks=[];const read=rel=>readFile(join(repoRoot,rel),'utf8');
  const [claims,caps,metrics,replay,io,server,app,auth,atest,ptest,pipeline]=await Promise.all([read('contracts/claim_registry_v03.json'),read('inspector-v04/lib/production-capabilities.mjs'),read('inspector-v04/lib/metric-registry.mjs'),read('inspector-v04/lib/replay-model.mjs'),read('inspector-v04/lib/io.mjs'),read('inspector-v04/server.mjs'),read('inspector-v04/public/app.js'),read('inspector-v04/public/authoritative.js'),read('inspector-v04/tests/authoritative-stats.test.mjs'),read('inspector-v04/tests/production-pipeline.test.mjs'),read('inspector-v04/pipeline.json')]);
  checks.push([claims.includes('"claimId": "ground_soul_lifecycle"'),'claim registry'],[caps.includes("capability('runtime_ground_soul_lifecycle'"),'production capability'],[metrics.includes("m('ground_soul_activations'"),'metric registry'],[replay.includes('groundSoulLifecycle:runtimeGroundSoulLifecycle'),'replay model'],[io.includes("['runtime_ground_soul_lifecycle'"),'Source Health registry'],[server.includes("groundSoulLifecycle:['jsonl','runtime_ground_soul_lifecycle_events_v01.jsonl']"),'evidence endpoint'],[app.includes("section('Ground Soul lifecycle'"),'Troopers & Souls UI'],[app.includes("'runtime_ground_soul_lifecycle_events'"),'Source Health UI'],[auth.includes("case 'ground_soul_activations':"),'Authoritative Stats mapping'],[atest.includes('authoritative.length,73'),'Authoritative Stats count'],[ptest.includes('extendedA.length,5'),'pipeline Extended A contract'],[pipeline.includes('runtime_ground_soul_lifecycle'),'pipeline step']);
  const failed=checks.filter(([ok])=>!ok).map(([,name])=>name);if(failed.length)throw new Error(`Installation verification failed: ${failed.join(', ')}`);
}
