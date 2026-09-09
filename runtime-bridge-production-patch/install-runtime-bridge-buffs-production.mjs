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
const permanentProducer=join(inspectorRoot,'production','extract-runtime-permanent-buffs.mjs');

for (const path of [inspectorRoot,replayModel,ioFile,serverFile,appFile,permanentProducer]) if (!existsSync(path)) fail(`Required 55/68 production path not found: ${path}`);

const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\..+$/,'').replace('T','-');
const backupRoot=join(inspectorRoot,`.runtime-bridge-buffs-production-backup-${stamp}`);
const replaceFiles=[
  'pipeline.json',
  join('lib','production-capabilities.mjs'),
  join('lib','runtime-bridge-buffs.mjs'),
  join('production','extract-runtime-bridge-buffs.mjs'),
  join('tests','production-pipeline.test.mjs'),
  join('tests','runtime-bridge-buffs.test.mjs'),
];
const patchTargets=[
  {path:replayModel,backup:join(backupRoot,'lib','replay-model.mjs'),patcher:patchReplayModel,label:'lib/replay-model.mjs'},
  {path:ioFile,backup:join(backupRoot,'lib','io.mjs'),patcher:patchIo,label:'lib/io.mjs'},
  {path:serverFile,backup:join(backupRoot,'server.mjs'),patcher:patchServer,label:'server.mjs'},
  {path:appFile,backup:join(backupRoot,'public','app.js'),patcher:patchApp,label:'public/app.js'},
];

// Preflight every source file and every in-place patch before touching the repository.
for (const rel of replaceFiles) {
  const src=join(sourceRoot,rel);
  if (!existsSync(src)) fail(`Bundle file missing: ${src}`);
}
const prepared=[];
for (const target of patchTargets) {
  const original=(await fs.readFile(target.path,'utf8')).replaceAll('\r\n','\n');
  const patched=target.patcher(original);
  if (patched===original) fail(`${target.label} was not changed; stopped before writing anything.`);
  prepared.push({...target,original,patched});
}

await fs.mkdir(backupRoot,{recursive:true});
for (const rel of replaceFiles) {
  const src=join(sourceRoot,rel),dst=join(inspectorRoot,rel);
  if (existsSync(dst)) await backup(dst,join(backupRoot,rel));
  await fs.mkdir(dirname(dst),{recursive:true});
  await fs.copyFile(src,dst);
  console.log(`Installed ${rel}`);
}
for (const target of prepared) {
  await backup(target.path,target.backup);
  await fs.writeFile(target.path,target.patched,'utf8');
  console.log(`Patched ${target.label}`);
}

console.log('');
console.log('Runtime bridge-powerup production stage installed.');
console.log(`Backup: ${backupRoot}`);
console.log('Expected authoritative production coverage after a successful replay run: 62/68.');
console.log('Remaining unsupported A metrics: health_regen (1) + primary-fire cadence (5).');

function patchReplayModel(text){
  if (text.includes('applyRuntimeBridge(playerByName,runtimeBridge)')) fail('replay-model.mjs already contains the runtime bridge production join. Refusing to apply twice.');
  text=replaceOnce(text,
    "'player_state.jsonl','player_state_summary.json','integrated_authoritative_player_state_substrate_v01.json','runtime_item_ownership_production_v01.json','runtime_permanent_buff_ownership_production_v01.json','behavioral_metrics_v02.json',",
    "'player_state.jsonl','player_state_summary.json','integrated_authoritative_player_state_substrate_v01.json','runtime_item_ownership_production_v01.json','runtime_permanent_buff_ownership_production_v01.json','runtime_bridge_buff_ownership_production_v01.json','behavioral_metrics_v02.json',",
    'replay-model bridge fingerprint source');
  text=replaceOnce(text,
    "  const runtimePermanent=await readJson(join(dir,'runtime_permanent_buff_ownership_production_v01.json'));\n  const offset=Number(runtimeItems?.replay?.matchClockOffsetSeconds ?? runtimePermanent?.replay?.matchClockOffsetSeconds ?? playerStateSummary?.matchClockOffsetSeconds ?? integrated?.replay?.matchClockOffsetSeconds ?? 0);",
    "  const runtimePermanent=await readJson(join(dir,'runtime_permanent_buff_ownership_production_v01.json'));\n  const runtimeBridge=await readJson(join(dir,'runtime_bridge_buff_ownership_production_v01.json'));\n  const offset=Number(runtimeItems?.replay?.matchClockOffsetSeconds ?? runtimePermanent?.replay?.matchClockOffsetSeconds ?? runtimeBridge?.replay?.matchClockOffsetSeconds ?? playerStateSummary?.matchClockOffsetSeconds ?? integrated?.replay?.matchClockOffsetSeconds ?? 0);",
    'replay-model bridge read');
  text=replaceOnce(text,
    "  applyRuntimeItems(playerByName,runtimeItems);\n  applyRuntimePermanent(playerByName,runtimePermanent);\n  applyBehavioral(playerByName,behavioral,resourceFeatures);",
    "  applyRuntimeItems(playerByName,runtimeItems);\n  applyRuntimePermanent(playerByName,runtimePermanent);\n  applyRuntimeBridge(playerByName,runtimeBridge);\n  applyBehavioral(playerByName,behavioral,resourceFeatures);",
    'replay-model bridge application');
  const helper=`function applyRuntimeBridge(playerByName,artifact){\n  if (!artifact || artifact.status!=='RUNTIME_BRIDGE_BUFF_OWNERSHIP_PRODUCTION_V01_READY') return;\n  const players=[...playerByName.values()];\n  for (const row of artifact.players??[]) {\n    const p=players.find(x=>Number.isInteger(row.controllerEntityIndex)&&x.identity?.controllerEntityIndex===row.controllerEntityIndex)\n      ?? players.find(x=>row.steamId!=null&&String(x.identity?.steamId)===String(row.steamId))\n      ?? playerByName.get(row.playerName);\n    if (!p) continue;\n    const intervals=(row.bridgeIntervals??[]).map(i=>({...i,startTime:i.startTime??null,endTime:i.endTime??null,durationSeconds:i.durationSeconds??null}));\n    p.bridgeBuffs={\n      intervals,\n      finalActive:intervals.filter(i=>Number.isFinite(artifact?.replay?.replayEndTick)&&i.startTick<=artifact.replay.replayEndTick&&i.stateEndTick>artifact.replay.replayEndTick),\n      summary:row.summary??null,\n      authority:'runtime_bridge_buff_ownership',\n      source:'runtime_bridge_buff_ownership_production_v01.json'\n    };\n  }\n}\n\n`;
  text=replaceOnce(text,'function applyRuntimePermanent(playerByName,artifact){',helper+'function applyRuntimePermanent(playerByName,artifact){','replay-model bridge helper');
  return text;
}

function patchIo(text){
  if (text.includes("['runtime_bridge_buffs','runtime_bridge_buff_ownership_production_v01.json'")) fail('io.mjs already contains runtime bridge source health. Refusing to apply twice.');
  return replaceOnce(text,
    "    ['runtime_permanent_buff_events','runtime_permanent_buff_events_v01.jsonl','A','Positive permanent-buff accumulation evidence'],",
    "    ['runtime_permanent_buff_events','runtime_permanent_buff_events_v01.jsonl','A','Positive permanent-buff accumulation evidence'],\n    ['runtime_bridge_buffs','runtime_bridge_buff_ownership_production_v01.json','A','A148 bridge powerup collection and runtime intervals'],\n    ['runtime_bridge_buff_events','runtime_bridge_buff_events_v01.jsonl','A','A148 bridge collection evidence'],",
    'io source-health bridge buffs');
}

function patchServer(text){
  if (text.includes("bridgeBuffs:['jsonl','runtime_bridge_buff_events_v01.jsonl']")) fail('server.mjs already exposes bridge-buff evidence. Refusing to apply twice.');
  return replaceOnce(text,
    "  permanentBuffs:['jsonl','runtime_permanent_buff_events_v01.jsonl'],",
    "  permanentBuffs:['jsonl','runtime_permanent_buff_events_v01.jsonl'],\n  bridgeBuffs:['jsonl','runtime_bridge_buff_events_v01.jsonl'],",
    'server bridge evidence source');
}

function patchApp(text){
  if (text.includes("['Bridge powerup collections','bridgeBuffs']")) fail('public/app.js already exposes bridge-buff evidence. Refusing to apply twice.');
  return replaceOnce(text,
    "['Player-state samples','playerState'],['Item ownership boundaries','items'],['Permanent buff acquisitions','permanentBuffs'],['Melee events','melee']",
    "['Player-state samples','playerState'],['Item ownership boundaries','items'],['Permanent buff acquisitions','permanentBuffs'],['Bridge powerup collections','bridgeBuffs'],['Melee events','melee']",
    'app evidence hub bridge entry');
}

async function backup(src,dst){await fs.mkdir(dirname(dst),{recursive:true});await fs.copyFile(src,dst);}
function replaceOnce(text,needle,replacement,label){if(!text.includes(needle))fail(`${label} anchor not found. The repository may have changed; stopped rather than guessing.`);return text.replace(needle,replacement);}
function fail(message){console.error(message);process.exit(1);}
