import { existsSync, promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bundleRoot=dirname(fileURLToPath(import.meta.url));
const repoRoot=resolve(process.argv[2]??'G:\\DeadlockBehavior');
const sourceRoot=join(bundleRoot,'inspector-v04');
const inspectorRoot=join(repoRoot,'inspector-v04');
const replayModel=join(inspectorRoot,'lib','replay-model.mjs');
const ioFile=join(inspectorRoot,'lib','io.mjs');
const serverFile=join(inspectorRoot,'server.mjs');
const appFile=join(inspectorRoot,'public','app.js');
const itemProducer=join(inspectorRoot,'production','extract-runtime-items.mjs');

for (const path of [inspectorRoot,replayModel,ioFile,serverFile,appFile,itemProducer]) if (!existsSync(path)) fail(`Required current-production path not found: ${path}`);

const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\..+$/,'').replace('T','-');
const backupRoot=join(inspectorRoot,`.runtime-permanent-buffs-production-backup-${stamp}`);
const replaceFiles=[
  'pipeline.json',
  'run-production.ps1',
  join('lib','production-capabilities.mjs'),
  join('lib','runtime-permanent-buffs.mjs'),
  join('production','extract-runtime-permanent-buffs.mjs'),
  join('tests','production-pipeline.test.mjs'),
  join('tests','runtime-permanent-buffs.test.mjs'),
];

await fs.mkdir(backupRoot,{recursive:true});
for (const rel of replaceFiles) {
  const src=join(sourceRoot,rel),dst=join(inspectorRoot,rel);
  if (!existsSync(src)) fail(`Bundle file missing: ${src}`);
  if (existsSync(dst)) await backup(dst,join(backupRoot,rel));
  await fs.mkdir(dirname(dst),{recursive:true});
  await fs.copyFile(src,dst);
  console.log(`Installed ${rel}`);
}

await patchFile(replayModel,join(backupRoot,'lib','replay-model.mjs'),patchReplayModel,'lib/replay-model.mjs');
await patchFile(ioFile,join(backupRoot,'lib','io.mjs'),patchIo,'lib/io.mjs');
await patchFile(serverFile,join(backupRoot,'server.mjs'),patchServer,'server.mjs');
await patchFile(appFile,join(backupRoot,'public','app.js'),patchApp,'public/app.js');

console.log('');
console.log('Runtime permanent-buff production stage installed.');
console.log(`Backup: ${backupRoot}`);
console.log('Expected authoritative production coverage after a successful replay run: 55/68.');
console.log('Note: the PowerShell wrapper parameter-default bug is fixed, but systems requiring signed PowerShell scripts may still need ExecutionPolicy Bypass. The direct Node runner remains supported.');

async function patchFile(path,backupPath,patcher,label){
  await backup(path,backupPath);
  const original=(await fs.readFile(path,'utf8')).replaceAll('\r\n','\n');
  const patched=patcher(original);
  if (patched===original) fail(`${label} was not changed; stopped rather than claiming installation.`);
  await fs.writeFile(path,patched,'utf8');
  console.log(`Patched ${label}`);
}

function patchReplayModel(text){
  if (text.includes('applyRuntimePermanent(playerByName,runtimePermanent)')) fail('replay-model.mjs already contains the runtime permanent-buff production join. Refusing to apply twice.');
  text=replaceOnce(text,
    "'player_state.jsonl','player_state_summary.json','integrated_authoritative_player_state_substrate_v01.json','runtime_item_ownership_production_v01.json','behavioral_metrics_v02.json',",
    "'player_state.jsonl','player_state_summary.json','integrated_authoritative_player_state_substrate_v01.json','runtime_item_ownership_production_v01.json','runtime_permanent_buff_ownership_production_v01.json','behavioral_metrics_v02.json',",
    'replay-model fingerprint source');
  text=replaceOnce(text,
    "  const integrated=await readJson(join(dir,'integrated_authoritative_player_state_substrate_v01.json'));\n  const runtimeItems=await readJson(join(dir,'runtime_item_ownership_production_v01.json'));\n  const offset=Number(runtimeItems?.replay?.matchClockOffsetSeconds ?? playerStateSummary?.matchClockOffsetSeconds ?? integrated?.replay?.matchClockOffsetSeconds ?? 0);",
    "  const integrated=await readJson(join(dir,'integrated_authoritative_player_state_substrate_v01.json'));\n  const runtimeItems=await readJson(join(dir,'runtime_item_ownership_production_v01.json'));\n  const runtimePermanent=await readJson(join(dir,'runtime_permanent_buff_ownership_production_v01.json'));\n  const offset=Number(runtimeItems?.replay?.matchClockOffsetSeconds ?? runtimePermanent?.replay?.matchClockOffsetSeconds ?? playerStateSummary?.matchClockOffsetSeconds ?? integrated?.replay?.matchClockOffsetSeconds ?? 0);",
    'replay-model runtime permanent read');
  text=replaceOnce(text,
    "  applyIntegrated(playerByName,integrated,offset,core.matchEndSeconds);\n  applyRuntimeItems(playerByName,runtimeItems);\n  applyBehavioral(playerByName,behavioral,resourceFeatures);",
    "  applyIntegrated(playerByName,integrated,offset,core.matchEndSeconds);\n  applyRuntimeItems(playerByName,runtimeItems);\n  applyRuntimePermanent(playerByName,runtimePermanent);\n  applyBehavioral(playerByName,behavioral,resourceFeatures);",
    'replay-model runtime permanent application');
  const helper=`function applyRuntimePermanent(playerByName,artifact){\n  if (!artifact || artifact.status!=='RUNTIME_PERMANENT_BUFF_OWNERSHIP_PRODUCTION_V01_READY') return;\n  const players=[...playerByName.values()];\n  for (const row of artifact.players??[]) {\n    const p=players.find(x=>Number.isInteger(row.entityIndex)&&x.identity?.controllerEntityIndex===row.entityIndex)\n      ?? players.find(x=>row.steamId!=null&&String(x.identity?.steamId)===String(row.steamId))\n      ?? playerByName.get(row.playerName);\n    if (!p) continue;\n    const final=row.finalPermanentBuffs??{};\n    p.permanentBuffs={\n      events:(row.acquisitionEvents??[]).map(e=>({...e,time:e.matchTimeSeconds??e.time??null,state:e.state??{}})),\n      final,\n      summary:row.summary??summarizePermanent(final),\n      authority:'runtime_permanent_buff_ownership',\n      source:'runtime_permanent_buff_ownership_production_v01.json'\n    };\n  }\n}\n\n`;
  text=replaceOnce(text,'function applyRuntimeItems(playerByName,artifact){',helper+'function applyRuntimeItems(playerByName,artifact){','replay-model runtime permanent helper');
  return text;
}

function patchIo(text){
  if (text.includes("['runtime_permanent_buffs','runtime_permanent_buff_ownership_production_v01.json'")) fail('io.mjs already contains runtime permanent-buff source health. Refusing to apply twice.');
  return replaceOnce(text,
    "    ['runtime_item_events','runtime_item_ownership_events_v01.jsonl','A','A142 ownership-entry / ownership-exit evidence'],",
    "    ['runtime_item_events','runtime_item_ownership_events_v01.jsonl','A','A142 ownership-entry / ownership-exit evidence'],\n    ['runtime_permanent_buffs','runtime_permanent_buff_ownership_production_v01.json','A','Replicated cumulative permanent world-buff ownership'],\n    ['runtime_permanent_buff_events','runtime_permanent_buff_events_v01.jsonl','A','Positive permanent-buff accumulation evidence'],",
    'io source-health permanent buffs');
}

function patchServer(text){
  if (text.includes("permanentBuffs:['jsonl','runtime_permanent_buff_events_v01.jsonl']")) fail('server.mjs already exposes permanent-buff evidence. Refusing to apply twice.');
  return replaceOnce(text,
    "  items:['jsonl','runtime_item_ownership_events_v01.jsonl'],",
    "  items:['jsonl','runtime_item_ownership_events_v01.jsonl'],\n  permanentBuffs:['jsonl','runtime_permanent_buff_events_v01.jsonl'],",
    'server permanent evidence source');
}

function patchApp(text){
  if (text.includes("['Permanent buff acquisitions','permanentBuffs']")) fail('public/app.js already exposes permanent-buff evidence. Refusing to apply twice.');
  return replaceOnce(text,
    " ['Player-state samples','playerState'],['Item / buff boundaries','items'],['Melee events','melee']",
    " ['Player-state samples','playerState'],['Item ownership boundaries','items'],['Permanent buff acquisitions','permanentBuffs'],['Melee events','melee']",
    'app evidence hub permanent-buff entry');
}

async function backup(src,dst){await fs.mkdir(dirname(dst),{recursive:true});await fs.copyFile(src,dst);}
function replaceOnce(text,needle,replacement,label){if(!text.includes(needle))fail(`${label} anchor not found. The repository may have changed; stopped rather than guessing.`);return text.replace(needle,replacement);}
function fail(message){console.error(message);process.exit(1);}
