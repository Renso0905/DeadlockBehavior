import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, basename } from 'node:path';
import { createInterface } from 'node:readline';
import { PRODUCTION_METRIC_CONTRACT } from '../../src/contracts/production-metric-contract.mjs';

const digestCache=new Map();
export function validReplayName(name){return typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)&&name!=='.'&&name!=='..';}
export async function fileDigest(file){
  const s=await fs.stat(file);const key=`${file}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  if(digestCache.has(key))return digestCache.get(key);
  const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);
  const result={sha256:h.digest('hex'),bytes:s.size};digestCache.set(key,result);return result;
}
async function filesUnder(dir){
  let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return [];}
  const rows=[];for(const e of entries){const p=join(dir,e.name);if(e.isDirectory())rows.push(...await filesUnder(p));else if(/\.(mjs|js|json)$/.test(e.name))rows.push(p);}return rows;
}
export async function inputFingerprint(repoRoot,replayName,inspectorRoot=join(repoRoot,'inspector-v04')){
  const paths=[join(repoRoot,'replays',`${replayName}.dem`),join(repoRoot,'package-lock.json'),join(inspectorRoot,'pipeline.json'),join(repoRoot,'scripts','03-extract-player-state.mjs'),
    ...await filesUnder(join(repoRoot,'src')),...await filesUnder(join(repoRoot,'contracts')),...await filesUnder(join(inspectorRoot,'lib')),...await filesUnder(join(inspectorRoot,'production')),...await filesUnder(join(inspectorRoot,'public'))];
  // These build-bound resources are explicit inputs, not per-replay research output.
  for(const file of ['current_purchasable_item_catalog_v02.json','world_stat_buff_resource_contract_v02.json','runtime_permanent_pickup_cross_replay_replication_v01.json','bridge_world_collection_cross_replay_replication_v01.json','bridge_runtime_interval_authority_v01.json','integrated_player_state_authority_v01.json','observed_primary_attack_ready_schedule_authority_v01.json'])paths.push(join(repoRoot,'output','cross_replay',file));
  const rows=[];for(const file of [...new Set(paths)].sort()){try{rows.push([relative(repoRoot,file),await fileDigest(file)]);}catch{rows.push([relative(repoRoot,file),'missing']);}}
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
export function publishedDirectory(replayDir,manifest){
  if(!manifest?.publishedOutputDir)return replayDir;
  const target=resolve(replayDir,manifest.publishedOutputDir);const rel=relative(resolve(replayDir),target);
  if(!rel||rel.startsWith('..')||/^[A-Za-z]:/.test(rel))throw new Error('Invalid published output directory');
  return target;
}
export async function validatePublishedRun(replayDir,manifest){
  const unavailable=reason=>({available:false,reason,runId:manifest?.runId??null});
  if(!manifest)return unavailable('No production manifest; process this replay.');
  if(manifest.runStatus!=='COMPLETE')return unavailable(`Production run ${manifest.runStatus??'incomplete'}.`);
  const expected=PRODUCTION_METRIC_CONTRACT.metrics.map(m=>m.metricId).sort();
  const actual=[...(manifest.coverage?.metricIds?.complete??[])].sort();
  if(JSON.stringify(expected)!==JSON.stringify(actual)||manifest.contractErrors?.missingMetricOwners?.length||manifest.contractErrors?.duplicateMetricOwners?.length)return unavailable('Production contract changed; reprocess this replay.');
  if(!manifest.inputFingerprint||!manifest.outputDigests||!manifest.publishedOutputDir)return unavailable('Legacy run has no verified provenance; reprocess this replay.');
  const dir=publishedDirectory(replayDir,manifest);
  for(const producer of PRODUCTION_METRIC_CONTRACT.producers)for(const spec of producer.expectedOutputs){
    const file=basename(spec.path);const expectedHash=manifest.outputDigests[file];
    if(!expectedHash)return unavailable(`Missing output proof: ${file}`);
    try{const actualHash=await fileDigest(join(dir,file));if(actualHash.sha256!==expectedHash.sha256)return unavailable(`Output changed: ${file}`);}catch{return unavailable(`Missing output: ${file}`);}
  }
  return {available:true,reason:null,runId:manifest.runId};
}
export async function inspectOutput(file){
  if(file.endsWith('.jsonl')){
    let count=0;const stream=createInterface({input:createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity});
    for await(const line of stream){if(!line.trim())continue;count++;try{JSON.parse(line);}catch{throw new Error(`Invalid JSONL ${basename(file)} row ${count}`);}}
  }else if(file.endsWith('.json')){
    const x=JSON.parse(await fs.readFile(file,'utf8'));
    if(x.validation?.pass===false||x.integrityValidation?.pass===false||String(x.status??'').includes('FAILED'))throw new Error(`Artifact validation failed: ${basename(file)}`);
    if(basename(file)==='player_state_summary.json'&&(!(x.recordsWritten>0)||!Array.isArray(x.playersSeen)||!x.playersSeen.length||!Number.isFinite(x.matchClockOffsetSeconds)))throw new Error('Core state summary lacks records, roster, or a finite clock offset');
  }
  return fileDigest(file);
}
