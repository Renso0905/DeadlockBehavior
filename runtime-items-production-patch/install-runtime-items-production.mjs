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

for (const path of [inspectorRoot,replayModel,ioFile,serverFile]) if (!existsSync(path)) fail(`Required path not found: ${path}`);

const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\..+$/,'').replace('T','-');
const backupRoot=join(inspectorRoot,`.runtime-items-production-backup-${stamp}`);
const replaceFiles=[
  'pipeline.json',
  join('lib','production-capabilities.mjs'),
  join('lib','runtime-items.mjs'),
  join('production','extract-runtime-items.mjs'),
  join('tests','production-pipeline.test.mjs'),
  join('tests','runtime-items.test.mjs'),
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

console.log('');
console.log('Runtime item production stage installed.');
console.log(`Backup: ${backupRoot}`);
console.log('Expected authoritative production coverage after a successful replay run: 49/68.');

async function patchFile(path,backupPath,patcher,label){
  await backup(path,backupPath);
  const original=(await fs.readFile(path,'utf8')).replaceAll('\r\n','\n');
  const patched=patcher(original);
  if (patched===original) fail(`${label} was not changed; stopped rather than claiming installation.`);
  await fs.writeFile(path,patched,'utf8');
  console.log(`Patched ${label}`);
}

function patchReplayModel(text){
  if (text.includes('applyRuntimeItems(playerByName,runtimeItems)')) fail('replay-model.mjs already contains the runtime-item production join. Refusing to apply twice.');
  text=replaceOnce(text,
    "'player_state.jsonl','player_state_summary.json','integrated_authoritative_player_state_substrate_v01.json','behavioral_metrics_v02.json',",
    "'player_state.jsonl','player_state_summary.json','integrated_authoritative_player_state_substrate_v01.json','runtime_item_ownership_production_v01.json','behavioral_metrics_v02.json',",
    'replay-model fingerprint source');
  text=replaceOnce(text,
    "  const integrated=await readJson(join(dir,'integrated_authoritative_player_state_substrate_v01.json'));\n  const offset=Number(integrated?.replay?.matchClockOffsetSeconds ?? playerStateSummary?.matchClockOffsetSeconds ?? 0);",
    "  const integrated=await readJson(join(dir,'integrated_authoritative_player_state_substrate_v01.json'));\n  const runtimeItems=await readJson(join(dir,'runtime_item_ownership_production_v01.json'));\n  const offset=Number(runtimeItems?.replay?.matchClockOffsetSeconds ?? playerStateSummary?.matchClockOffsetSeconds ?? integrated?.replay?.matchClockOffsetSeconds ?? 0);",
    'replay-model runtime item read');
  text=replaceOnce(text,
    "  applyIntegrated(playerByName,integrated,offset,core.matchEndSeconds);\n  applyBehavioral(playerByName,behavioral,resourceFeatures);",
    "  applyIntegrated(playerByName,integrated,offset,core.matchEndSeconds);\n  applyRuntimeItems(playerByName,runtimeItems);\n  applyBehavioral(playerByName,behavioral,resourceFeatures);",
    'replay-model runtime item application');
  const helper=`function applyRuntimeItems(playerByName,artifact){\n  if (!artifact || artifact.status!=='RUNTIME_ITEM_OWNERSHIP_PRODUCTION_V01_READY') return;\n  const players=[...playerByName.values()];\n  for (const row of artifact.players??[]) {\n    const p=players.find(x=>Number.isInteger(row.entityIndex)&&x.identity?.controllerEntityIndex===row.entityIndex)\n      ?? players.find(x=>row.steamId!=null&&String(x.identity?.steamId)===String(row.steamId))\n      ?? playerByName.get(row.playerName);\n    if (!p) continue;\n    p.items={\n      events:(row.itemEvents??[]).map(e=>({...e,sourceEventType:e.eventType,eventType:e.eventType==='ITEM_OWNERSHIP_ENTERED'?'ITEM_ADDED':e.eventType==='ITEM_OWNERSHIP_EXITED'?'ITEM_REMOVED':e.eventType})),\n      finalItems:row.finalStandardShopItems??[],\n      ownershipIntervals:row.ownershipIntervals??[],\n      checkpointBuilds:row.checkpointBuilds??{},\n      authority:'A142 runtime_item_ownership',\n      source:'runtime_item_ownership_production_v01.json'\n    };\n  }\n}\n\n`;
  text=replaceOnce(text,'function applyIntegrated(playerByName,integrated,offset,matchEnd){',helper+'function applyIntegrated(playerByName,integrated,offset,matchEnd){','replay-model runtime item helper');
  return text;
}

function patchIo(text){
  if (text.includes("['runtime_items','runtime_item_ownership_production_v01.json'")) fail('io.mjs already contains runtime-item source health. Refusing to apply twice.');
  return replaceOnce(text,
    "    ['integrated_state','integrated_authoritative_player_state_substrate_v01.json','A','Items, permanent buffs, bridge intervals'],",
    "    ['integrated_state','integrated_authoritative_player_state_substrate_v01.json','A','Legacy integrated items, permanent buffs, bridge intervals'],\n    ['runtime_items','runtime_item_ownership_production_v01.json','A','A142 runtime standard-shop item ownership'],\n    ['runtime_item_events','runtime_item_ownership_events_v01.jsonl','A','A142 ownership-entry / ownership-exit evidence'],",
    'io source-health runtime items');
}

function patchServer(text){
  if (text.includes("items:['jsonl','runtime_item_ownership_events_v01.jsonl']")) fail('server.mjs already uses runtime-item evidence. Refusing to apply twice.');
  text=replaceOnce(text,
    "  items:['json','integrated_authoritative_player_state_substrate_v01.json','players'],",
    "  items:['jsonl','runtime_item_ownership_events_v01.jsonl'],",
    'server item evidence source');
  text=replaceOnce(text,
    "  const def=evidenceFiles[kind];if(!def)return{error:`Unknown evidence kind: ${kind}`,available:Object.keys(evidenceFiles)};\n  const path=join(outputRoot,replay,def[1]);if(!existsSync(path))return{kind,rows:[],matched:0,missing:true,file:def[1]};",
    "  let def=evidenceFiles[kind];if(!def)return{error:`Unknown evidence kind: ${kind}`,available:Object.keys(evidenceFiles)};\n  let path=join(outputRoot,replay,def[1]);\n  if(kind==='items'&&!existsSync(path)){def=['json','integrated_authoritative_player_state_substrate_v01.json','players'];path=join(outputRoot,replay,def[1]);}\n  if(!existsSync(path))return{kind,rows:[],matched:0,missing:true,file:def[1]};",
    'server legacy item evidence fallback');
  return text;
}

async function backup(src,dst){await fs.mkdir(dirname(dst),{recursive:true});await fs.copyFile(src,dst);}
function replaceOnce(text,needle,replacement,label){
  if (!text.includes(needle)) fail(`${label} anchor not found. The repository may have changed; stopped rather than guessing.`);
  return text.replace(needle,replacement);
}
function fail(message){console.error(message);process.exit(1);}
