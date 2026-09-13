import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=process.argv[2];
if(!repoRoot)throw new Error('Usage: node install.mjs <RepoRoot>');
const patchRoot=dirname(fileURLToPath(import.meta.url));
const payloadRoot=join(patchRoot,'payload');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`ground-soul-economic-credit-extended-a-v01-${stamp}`);

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
const payloadFiles=[
  'inspector-v04/lib/runtime-assigned-gold-economic-credit.mjs',
  'inspector-v04/production/extract-runtime-assigned-gold-economic-credit.mjs',
  'inspector-v04/tests/runtime-assigned-gold-economic-credit.test.mjs',
];

for(const rel of required){if(!existsSync(join(repoRoot,rel)))throw new Error(`Required current file missing: ${rel}`);}
for(const rel of payloadFiles){if(!existsSync(join(payloadRoot,rel)))throw new Error(`Payload missing: ${rel}`);}
const cap0=await readFile(join(repoRoot,'inspector-v04/lib/production-capabilities.mjs'),'utf8');
if(!cap0.includes("capability('runtime_ground_soul_lifecycle'"))throw new Error('Prerequisite missing: Ground Soul Lifecycle Extended A must be installed first.');
if(!cap0.includes('CORE_AUTHORITATIVE_PRODUCTION_METRIC_IDS'))throw new Error('Prerequisite missing: Core/Extended authority ledger not found.');
const app0=await readFile(join(repoRoot,'inspector-v04/public/app.js'),'utf8');
if(!app0.includes('groundSoulLifecycle'))throw new Error('Prerequisite missing: Ground Soul lifecycle visualizer integration not found.');

const originals=new Map();
for(const rel of [...required,...payloadFiles]){
  const present=existsSync(join(repoRoot,rel));originals.set(rel,present);
  if(present)await backupIfPresent(rel);
}

try{
  for(const rel of payloadFiles){const src=join(payloadRoot,rel),dst=join(repoRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);console.log(`Installed: ${rel}`);}
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
}catch(error){
  console.error('');console.error(`INSTALLATION FAILED: ${error?.message??error}`);console.error('Restoring pre-install files from backup...');
  await rollback();
  console.error(`Rollback complete. Backup retained at: ${backupRoot}`);
  throw error;
}

console.log('');
console.log('GROUND SOUL ECONOMIC CREDIT EXTENDED A V01 INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('Authority ledger target: Core A 68/68 | Extended A 8/8 | Total A 76/76');
console.log('Next: run the full Node test suite before production.');

async function backupIfPresent(rel){const src=join(repoRoot,rel);if(!existsSync(src))return;const dst=join(backupRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);}
async function rollback(){for(const [rel,present] of originals){const dst=join(repoRoot,rel),bak=join(backupRoot,rel);if(present&&existsSync(bak)){await mkdir(dirname(dst),{recursive:true});await copyFile(bak,dst);}else if(!present&&existsSync(dst)){await rm(dst,{force:true});}}}
async function rw(rel,fn){const p=join(repoRoot,rel);const before=await readFile(p,'utf8');const after=await fn(before);if(typeof after!=='string')throw new Error(`Patch function did not return text: ${rel}`);if(after!==before){await writeFile(p,after,'utf8');console.log(`Patched: ${rel}`);}else console.log(`Already applied: ${rel}`);}

async function patchClaimRegistry(){
  const rel='contracts/claim_registry_v03.json',p=join(repoRoot,rel);const o=JSON.parse(await readFile(p,'utf8'));o.claims??=[];
  const authoritative={
    claimId:'assigned_gold_economic_recipient_set',domain:'souls',construct:'High-confidence AssignedGold economic recipient set at isolated targeted lifecycle termination',
    authorityStatus:'current',integrityValidation:'pass',semanticValidation:'strong_support',replicationStatus:'multi_replay_supported',
    scope:'Isolated physically targeted completed CCitadel_Pickup_AssignedGold lifecycles only. Economic recipients are same-team player pawns with direct positive m_nCurrencies.0000 transitions on the exact lifecycle termination tick, with a clean integer partition across the observed recipient set.',
    sourceScripts:['88-assigned-gold-economic-recipient-discovery','89-assigned-gold-exact-credit-attribution-validation','103-foundational-replication','104-foundational-replication'],
    currentArtifacts:['output/cross_replay/trooper_reward_source_semantics_closure_v01.json','output/cross_replay/foundational_replication_metrics_v02.json'],
    downstreamUses:['Ground Soul economic-credit visualization','recipient-set behavioral statistics','future lane-economy models'],
    valueSummary:{replicatedReplays:5,currencyCarrier:'CCitadelPlayerPawn.m_nCurrencies.0000',exactOffsetTicks:0,isolationRadiusTicks:16,recipientSetSizesObserved:'1-6'},
    supersedes:[],supersededBy:null,
    notes:'Economic recipient-set semantics replicated across five independent replays. m_hVacuumTarget is a physical attraction target and is not equivalent to the economic recipient set. This claim does not establish physical collector, last-hitter identity, damage method, melee semantics, a canonical reward amount/formula, exact share radius, or exact vacuum radius. Nonisolated, targetless, censored, no-delta, and non-partition-clean cases stay unresolved rather than being forced into the authoritative set.'
  };
  const existing=o.claims.find(x=>x.claimId===authoritative.claimId);if(existing)Object.assign(existing,authoritative);else o.claims.push(authoritative);
  await writeFile(p,JSON.stringify(o,null,2)+'\n','utf8');console.log(`Patched: ${rel}`);
}

async function patchPipelineJson(){
  const rel='inspector-v04/pipeline.json',p=join(repoRoot,rel);const o=JSON.parse(await readFile(p,'utf8'));const ground=o.steps?.find(s=>s.capability==='runtime_ground_soul_lifecycle');if(!ground)throw new Error('Ground Soul lifecycle production step not found.');
  const step={id:'ground-soul-economic-credit',label:'Extract authoritative Ground Soul economic recipient sets',capability:'runtime_assigned_gold_economic_credit',required:true,dependsOn:[ground.id],args:['inspector-v04/production/extract-runtime-assigned-gold-economic-credit.mjs','replays/{replay}.dem'],ifExists:'replays/{replay}.dem',expectedOutputs:[{path:'output/{replay}/runtime_assigned_gold_economic_credit_production_v01.json',minBytes:2},{path:'output/{replay}/runtime_assigned_gold_economic_credit_events_v01.jsonl',minBytes:0}]};
  const existing=o.steps.findIndex(s=>s.capability==='runtime_assigned_gold_economic_credit');if(existing>=0)o.steps[existing]=step;else{const i=o.steps.findIndex(s=>s.capability==='runtime_ground_soul_lifecycle');o.steps.splice(i>=0?i+1:o.steps.length,0,step);}
  await writeFile(p,JSON.stringify(o,null,2)+'\n','utf8');console.log(`Patched: ${rel}`);
}

async function patchCapabilities(){await rw('inspector-v04/lib/production-capabilities.mjs',t=>{
  if(t.includes("capability('runtime_assigned_gold_economic_credit'"))return t;
  const marker=/\r?\n\];\r?\n\r?\nexport const CORE_AUTHORITATIVE_PRODUCTION_METRIC_IDS/;const m=t.match(marker);if(!m)throw new Error('Capability array terminator / Core authority export not found.');
  const block=",\n  capability('runtime_assigned_gold_economic_credit', 'Ground Soul economic recipient sets', 'supported', [\n    'ground_soul_economic_credit_events','ground_soul_economic_recipient_transitions','ground_soul_multi_recipient_share'\n  ], {\n    integrityValidation: 'Fresh runtime_assigned_gold_economic_credit_production_v01.json and runtime_assigned_gold_economic_credit_events_v01.jsonl must be produced. Promoted recipient rows are same-team, positive, exact-terminal-tick m_nCurrencies.0000 transitions with unique pawn identity and clean integer partitioning.',\n    semanticValidation: 'assigned_gold_economic_recipient_set current claim. Authority is deliberately limited to isolated, physically targeted, completed AssignedGold lifecycle terminations. m_hVacuumTarget remains physical attraction telemetry and is not used as economic-recipient identity.',\n    replicationStatus: 'Economic recipient-set identity, recipient geometry relationship, and final integer allocation structure reproduced across five independent replays. The old exact reward-magnitude heuristic and frozen exact radii are explicitly excluded.'\n  }, null, 'extended')";
  return t.replace(marker,block+m[0]);
});}

async function patchMetricRegistry(){await rw('inspector-v04/lib/metric-registry.mjs',t=>{
  if(t.includes("m('ground_soul_economic_credit_events'"))return t;
  const marker=/(^\s*)m\('ground_soul_eligible'[^\n]*\),\r?\n/m;const m=t.match(marker);if(!m)throw new Error('Ground Soul B-metric registry marker not found.');const ind=m[1];
  const block=`${ind}m('ground_soul_economic_credit_events','Resolved Ground Soul economic-credit events',A,'integer','runtime_assigned_gold_economic_credit_events','Isolated targeted completed AssignedGold lifecycle terminations with a high-confidence exact-tick same-team economic recipient set.'),\n${ind}m('ground_soul_economic_recipient_transitions','Observed Ground Soul economic-recipient transitions',A,'integer','runtime_assigned_gold_economic_credit_events','Total direct positive CCitadelPlayerPawn.m_nCurrencies.0000 recipient transitions across resolved economic-credit events.'),\n${ind}m('ground_soul_multi_recipient_share','Multi-recipient Ground Soul share',A,'percent','runtime_assigned_gold_economic_credit_events','Share of resolved economic-credit events whose validated recipient set contains more than one allied player; denominator excludes unresolved events.'),\n`;
  return t.replace(marker,block+m[0]);
});}

async function patchReplayModel(){await rw('inspector-v04/lib/replay-model.mjs',t=>{
  if(!t.includes("'runtime_assigned_gold_economic_credit_production_v01.json'")){
    const marker="'runtime_ground_soul_lifecycle_production_v01.json','runtime_ground_soul_lifecycle_events_v01.jsonl'";if(!t.includes(marker))throw new Error('Ground Soul lifecycle fingerprint marker missing.');t=t.replace(marker,marker+",'runtime_assigned_gold_economic_credit_production_v01.json','runtime_assigned_gold_economic_credit_events_v01.jsonl'");
  }
  if(!t.includes("const runtimeAssignedGoldEconomicCredit=await readJson(join(dir,'runtime_assigned_gold_economic_credit_production_v01.json'));")){
    const marker="  const runtimeGroundSoulLifecycle=await readJson(join(dir,'runtime_ground_soul_lifecycle_production_v01.json'));";if(!t.includes(marker))throw new Error('Ground Soul lifecycle read marker missing.');t=t.replace(marker,marker+"\n  const runtimeAssignedGoldEconomicCredit=await readJson(join(dir,'runtime_assigned_gold_economic_credit_production_v01.json')); ");
  }
  if(!t.includes('groundSoulEconomicCredit:runtimeAssignedGoldEconomicCredit')){
    const re=/(\s*groundSoulLifecycle:runtimeGroundSoulLifecycle\?\.status==='RUNTIME_GROUND_SOUL_LIFECYCLE_PRODUCTION_V01_READY'\?\{[^\n\r]*\}:null,\r?\n)/;const m=t.match(re);if(!m)throw new Error('Ground Soul lifecycle model-output marker missing.');
    const ind=(m[1].match(/^(\s*)/)?.[1])??'    ';
    const line=`${ind}groundSoulEconomicCredit:runtimeAssignedGoldEconomicCredit?.status==='RUNTIME_ASSIGNED_GOLD_ECONOMIC_CREDIT_PRODUCTION_V01_READY'?{status:runtimeAssignedGoldEconomicCredit.status,authorityLayer:'extended',summary:runtimeAssignedGoldEconomicCredit.summary,counts:runtimeAssignedGoldEconomicCredit.counts,semanticScope:runtimeAssignedGoldEconomicCredit.semanticScope,diagnostics:runtimeAssignedGoldEconomicCredit.diagnostics,validation:runtimeAssignedGoldEconomicCredit.validation,source:'runtime_assigned_gold_economic_credit_production_v01.json'}:null,\n`;
    t=t.replace(re,m[1]+line);
  }
  return t;
});}

async function patchSourceHealthRegistry(){await rw('inspector-v04/lib/io.mjs',t=>{
  if(t.includes("['runtime_assigned_gold_economic_credit','runtime_assigned_gold_economic_credit_production_v01.json'"))return t;
  const marker="    ['runtime_ground_soul_lifecycle_events','runtime_ground_soul_lifecycle_events_v01.jsonl','A','Extended A: Ground Soul activation, physical vacuum-target, termination, and censoring evidence'],";if(!t.includes(marker))throw new Error('Ground Soul lifecycle Source Health marker missing.');
  return t.replace(marker,marker+"\n    ['runtime_assigned_gold_economic_credit','runtime_assigned_gold_economic_credit_production_v01.json','A','Extended A: conservative Ground Soul economic-recipient-set summary'],\n    ['runtime_assigned_gold_economic_credit_events','runtime_assigned_gold_economic_credit_events_v01.jsonl','A','Extended A: resolved and unresolved AssignedGold economic-credit evidence with exact-tick recipient rows'],");
});}

async function patchServer(){await rw('inspector-v04/server.mjs',t=>{
  if(t.includes("groundSoulEconomicCredit:['jsonl','runtime_assigned_gold_economic_credit_events_v01.jsonl']"))return t;
  const marker="  groundSoulLifecycle:['jsonl','runtime_ground_soul_lifecycle_events_v01.jsonl'],";if(!t.includes(marker))throw new Error('Ground Soul lifecycle evidence endpoint marker missing.');
  return t.replace(marker,marker+"\n  groundSoulEconomicCredit:['jsonl','runtime_assigned_gold_economic_credit_events_v01.jsonl'],");
});}

async function patchApp(){await rw('inspector-v04/public/app.js',t=>{
  if(!t.includes('groundSoulEconomicCredit??{}')){
    const re=/function souls\(p\)\{const t=state\.model\.troopers\?\?\{\},gl=state\.model\.groundSoulLifecycle\?\?\{\},g=state\.model\.groundSouls\?\?\{\}/;if(!re.test(t))throw new Error('Ground Soul lifecycle souls() header marker missing.');
    t=t.replace(re,"function souls(p){const t=state.model.troopers??{},gl=state.model.groundSoulLifecycle??{},ge=state.model.groundSoulEconomicCredit??{},g=state.model.groundSouls??{}");
  }
  if(!t.includes("section('Ground Soul economic credit'")){
    const marker=")+section('Ground soul one-to-one model'";if(!t.includes(marker))throw new Error('Ground soul research section marker missing.');
    const replacement=")+section('Ground Soul economic credit','Extended A: conservative economic-recipient sets for isolated targeted completed AssignedGold lifecycles',`<div class=\"grid\">${metricCard('ground_soul_economic_credit_events',ge.summary?.resolvedCreditEvents??'—','groundSoulEconomicCredit',`${pct(ge.summary?.resolutionShare)} of isolated targeted candidates · unresolved ${ge.summary?.unresolvedCandidateEvents??'—'}`)}${metricCard('ground_soul_economic_recipient_transitions',ge.summary?.recipientTransitions??'—','groundSoulEconomicCredit',`recipient-set sizes ${objectInline(ge.summary?.recipientCountDistribution??{})}`)}${metricCard('ground_soul_multi_recipient_share',pct(ge.summary?.multiRecipientShare),'groundSoulEconomicCredit',`${ge.summary?.multiRecipientEvents??'—'} of ${ge.summary?.resolvedCreditEvents??'—'} resolved events`)}</div><div class=\"warning-box\"><strong>Extended-A boundary:</strong> An economic recipient is a same-team player pawn with a direct positive m_nCurrencies.0000 transition on the exact AssignedGold termination tick under the isolation and integer-partition filters. This does not identify the physical collector, last hitter, damage source, melee method, canonical reward amount, or an exact share/vacuum radius. m_hVacuumTarget remains physical attraction telemetry only.</div>${evidenceButton('Inspect authoritative Ground Soul economic-credit events','groundSoulEconomicCredit')}`)+section('Economic-credit timeline','Cumulative resolved economic-credit events at the global scrubber',`<div class=\"panel chart\">${lineChart(ge.summary?.cumulativeTimeline??[],'matchTime','resolvedCreditEvents',state.time,true)}</div>`)+section('Ground soul one-to-one model'";
    t=t.replace(marker,replacement);
  }
  if(!t.includes("'runtime_assigned_gold_economic_credit'")){
    const marker="'runtime_ground_soul_lifecycle_events'";if(!t.includes(marker))throw new Error('Source Health Ground Soul productionIds marker missing.');t=t.replace(marker,marker+",'runtime_assigned_gold_economic_credit','runtime_assigned_gold_economic_credit_events'");
  }
  t=t.replace("${metricCard('ground_soul_vacuum_target',p.groundSoulTargets??0,'groundSouls')}","${stat('Physical vacuum-target links',p.groundSoulTargets??0,'B','m_hVacuumTarget only; not economic-recipient identity')}");
  t=t.replace('<strong>Semantic boundary:</strong> vacuum target = TARGETED TO PLAYER. It is not labeled final ground-soul collection.','<strong>Semantic boundary:</strong> physical vacuum target = TARGETED TO PLAYER. It is not the economic recipient set, collector, or last-hitter identity.');
  for(const [bad,good] of [['â†’','→'],['Â·','·'],['â€”','—'],['â€“','–'],['Â±','±'],['â‰¤','≤'],['â‰¥','≥']])t=t.split(bad).join(good);
  return t;
});}

async function patchAuthoritative(){await rw('inspector-v04/public/authoritative.js',t=>{
  const auth=t.match(/const AUTH_IDS=\[(.*?)\];/s);if(!auth)throw new Error('AUTH_IDS contract not found.');let inner=auth[1];const ids=[...inner.matchAll(/'([^']+)'/g)].map(x=>x[1]);const add=['ground_soul_economic_credit_events','ground_soul_economic_recipient_transitions','ground_soul_multi_recipient_share'].filter(x=>!ids.includes(x));
  if(add.length){const marker="  'primary_discharges'";if(!inner.includes(marker))throw new Error('Primary AUTH_IDS marker missing.');inner=inner.replace(marker,`  ${add.map(x=>`'${x}'`).join(',')},\n${marker}`);t=t.slice(0,auth.index)+`const AUTH_IDS=[${inner}];`+t.slice(auth.index+auth[0].length);}
  if(!t.includes("case 'ground_soul_economic_credit_events':")){
    const marker="    case 'primary_discharges':";const i=t.indexOf(marker);if(i<0)throw new Error('Primary metric-value switch marker missing.');
    const block="    case 'ground_soul_economic_credit_events': { const ge=model.groundSoulEconomicCredit?.summary??{}; return v(ge.resolvedCreditEvents??'—',`${percent(ge.resolutionShare)} of isolated targeted candidates · ${ge.unresolvedCandidateEvents??0} unresolved candidates`); }\n"+
      "    case 'ground_soul_economic_recipient_transitions': { const ge=model.groundSoulEconomicCredit?.summary??{}; return v(ge.recipientTransitions??'—',`${ge.resolvedCreditEvents??0} resolved events · exact terminal-tick currency transitions`); }\n"+
      "    case 'ground_soul_multi_recipient_share': { const ge=model.groundSoulEconomicCredit?.summary??{}; return v(percent(ge.multiRecipientShare),`${ge.multiRecipientEvents??0} / ${ge.resolvedCreditEvents??0} resolved events`); }\n";
    t=t.slice(0,i)+block+t.slice(i);
  }
  return t;
});}

async function patchAuthoritativeTests(){await rw('inspector-v04/tests/authoritative-stats.test.mjs',t=>{
  t=t.replace(/assert\.equal\(authoritative\.length,\d+,'A-status metric count changed; review the display contract intentionally'\);/,"assert.equal(authoritative.length,76,'A-status metric count changed; review the display contract intentionally');");
  if(!t.includes('authoritative.length,76'))throw new Error('Could not update Authoritative Stats expected A count to 76.');return t;
});}

async function patchPipelineTests(){await rw('inspector-v04/tests/production-pipeline.test.mjs',t=>{
  const s1=t.indexOf("test('production capability contract owns every A metric exactly once'");const s2=t.indexOf("test('pipeline requires fresh outputs",s1+1);const s3=t.indexOf("test('existing outputs are not accepted",s2+1);if(s1<0||s2<0||s3<0)throw new Error('Production integration test boundaries missing.');
  let seg=t.slice(s1,s3);
  seg=seg.replaceAll('73','76').replaceAll('5/5 Extended A','8/8 Extended A');
  seg=seg.replace('assert.equal(extendedA.length,5);','assert.equal(extendedA.length,8);');
  seg=seg.replaceAll('coverage.extended.completeAuthoritative,5','coverage.extended.completeAuthoritative,8');
  seg=seg.replaceAll('coverage.extended.authoritativeTotal,5','coverage.extended.authoritativeTotal,8');
  if(!seg.includes("runtime_assigned_gold_economic_credit")){
    const groundAssert="  const ground=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_ground_soul_lifecycle');assert.equal(ground.productionStatus,'supported');assert.equal(ground.authorityLayer,'extended');assert.deepEqual([...ground.metricIds],['ground_soul_activations','ground_soul_targeted_activations','ground_soul_lifecycle_duration']);\n";
    if(!seg.includes(groundAssert))throw new Error('Ground Soul capability assertion marker missing in production-pipeline test.');
    seg=seg.replace(groundAssert,groundAssert+"  const econ=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_assigned_gold_economic_credit');assert.equal(econ.productionStatus,'supported');assert.equal(econ.authorityLayer,'extended');assert.deepEqual([...econ.metricIds],['ground_soul_economic_credit_events','ground_soul_economic_recipient_transitions','ground_soul_multi_recipient_share']);\n");
    const producerLine="  const groundProducer=await fixtureProducer('ground-producer.mjs',['runtime_ground_soul_lifecycle_production_v01.json','runtime_ground_soul_lifecycle_events_v01.jsonl']);\n";
    if(!seg.includes(producerLine))throw new Error('Ground Soul fixture producer marker missing.');seg=seg.replace(producerLine,producerLine+"  const econProducer=await fixtureProducer('econ-producer.mjs',['runtime_assigned_gold_economic_credit_production_v01.json','runtime_assigned_gold_economic_credit_events_v01.jsonl']);\n");
    const groundStep="    {id:'ground',label:'ground',capability:'runtime_ground_soul_lifecycle',required:true,dependsOn:['core'],args:[groundProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_ground_soul_lifecycle_production_v01.json','runtime_ground_soul_lifecycle_events_v01.jsonl'])}\n";
    if(!seg.includes(groundStep))throw new Error('Ground Soul fixture pipeline step marker missing.');seg=seg.replace(groundStep,groundStep.replace(/\n$/,'')+",\n    {id:'econ',label:'econ',capability:'runtime_assigned_gold_economic_credit',required:true,dependsOn:['ground'],args:[econProducer,'{repoRoot}','{replay}'],expectedOutputs:outputs(['runtime_assigned_gold_economic_credit_production_v01.json','runtime_assigned_gold_economic_credit_events_v01.jsonl'])}\n");
    const ids="['core','health','items','perm','bridge','fire','trooper','ground']";if(!seg.includes(ids))throw new Error('Fixture completed-step list marker missing.');seg=seg.replace(ids,"['core','health','items','perm','bridge','fire','trooper','ground','econ']");
  }
  if(!seg.includes('extendedA.length,8'))throw new Error('Extended A test count was not updated to 8.');
  if(!seg.includes('authoritativeTotal,76'))throw new Error('Total A fixture count was not updated to 76.');
  return t.slice(0,s1)+seg+t.slice(s3);
});}

async function verify(){
  const read=rel=>readFile(join(repoRoot,rel),'utf8');const [claims,caps,metrics,replay,io,server,app,auth,atest,ptest,pipeline]=await Promise.all([read('contracts/claim_registry_v03.json'),read('inspector-v04/lib/production-capabilities.mjs'),read('inspector-v04/lib/metric-registry.mjs'),read('inspector-v04/lib/replay-model.mjs'),read('inspector-v04/lib/io.mjs'),read('inspector-v04/server.mjs'),read('inspector-v04/public/app.js'),read('inspector-v04/public/authoritative.js'),read('inspector-v04/tests/authoritative-stats.test.mjs'),read('inspector-v04/tests/production-pipeline.test.mjs'),read('inspector-v04/pipeline.json')]);
  const checks=[
    [claims.includes('"claimId": "assigned_gold_economic_recipient_set"'),'claim registry'],
    [caps.includes("capability('runtime_assigned_gold_economic_credit'"),'production capability'],
    [metrics.includes("m('ground_soul_economic_credit_events'"),'metric registry'],
    [replay.includes('groundSoulEconomicCredit:runtimeAssignedGoldEconomicCredit'),'replay model'],
    [io.includes("['runtime_assigned_gold_economic_credit'"),'Source Health registry'],
    [server.includes("groundSoulEconomicCredit:['jsonl','runtime_assigned_gold_economic_credit_events_v01.jsonl']"),'evidence endpoint'],
    [app.includes("section('Ground Soul economic credit'"),'Troopers & Souls UI'],
    [app.includes("'runtime_assigned_gold_economic_credit_events'"),'Source Health UI'],
    [app.includes('Physical vacuum-target links'),'vacuum-target label cleanup'],
    [auth.includes("case 'ground_soul_economic_credit_events':"),'Authoritative Stats mapping'],
    [atest.includes('authoritative.length,76'),'Authoritative Stats expected count'],
    [ptest.includes('extendedA.length,8'),'pipeline Extended A contract'],
    [ptest.includes('authoritativeTotal,76'),'pipeline total A contract'],
    [pipeline.includes('runtime_assigned_gold_economic_credit'),'pipeline step'],
  ];
  const failed=checks.filter(([ok])=>!ok).map(([,name])=>name);if(failed.length)throw new Error(`Installation verification failed: ${failed.join(', ')}`);
  const claimObj=JSON.parse(claims).claims.find(x=>x.claimId==='assigned_gold_economic_recipient_set');if(!claimObj||claimObj.authorityStatus!=='current'||claimObj.integrityValidation!=='pass'||!['pass','strong_support'].includes(claimObj.semanticValidation)||!['multi_replay_supported','cross_replay_replicated'].includes(claimObj.replicationStatus))throw new Error('Claim registry semantic-validation state is not promotable after patch.');
  const po=JSON.parse(pipeline);if(po.steps.filter(s=>s.capability==='runtime_assigned_gold_economic_credit').length!==1)throw new Error('Pipeline contains duplicate/missing economic-credit production steps.');
  for(const id of ['ground_soul_economic_credit_events','ground_soul_economic_recipient_transitions','ground_soul_multi_recipient_share']){
    const n=(caps.match(new RegExp(`'${id}'`,'g'))??[]).length;if(n!==1)throw new Error(`Capability metric ownership verification failed for ${id}: expected 1 occurrence, found ${n}.`);
  }
}
