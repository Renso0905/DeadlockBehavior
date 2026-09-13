import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTHORITATIVE_PRODUCTION_METRIC_IDS } from '../inspector-v04/lib/production-capabilities.mjs';
import { listReplayInventory,needsReplayProcessing,replayReadiness } from '../inspector-v04/lib/replay-readiness.mjs';

const A_TOTAL=AUTHORITATIVE_PRODUCTION_METRIC_IDS.length;

test('one-step ingestion readiness is driven by canonical A count',()=>assert.equal(A_TOTAL,114));

test('new DEM with no manifest is UNPROCESSED and requires ingestion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'db-ingest-new-')),replays=join(root,'replays'),output=join(root,'output');
  await mkdir(replays,{recursive:true});await writeFile(join(replays,'fresh.dem'),'fixture');
  assert.deepEqual(await listReplayInventory({repoRoot:root,outputRoot:output}),['fresh']);
  const r=await replayReadiness({repoRoot:root,outputRoot:output,replayName:'fresh',authoritativeTotal:A_TOTAL});
  assert.equal(r.state,'UNPROCESSED');assert.equal(r.authoritativeTotal,114);assert.equal(r.completeAuthoritative,0);
  const d=await needsReplayProcessing({repoRoot:root,outputRoot:output,replayName:'fresh'});
  assert.equal(d.needed,true);assert.equal(d.reason,'manifest_missing');
});

test('a completion counter without output provenance is INCOMPLETE',async()=>{
  const {root,output}=await fixtureWithManifest({manifestTotal:114,complete:114,runStatus:'COMPLETE'});
  const r=await replayReadiness({repoRoot:root,outputRoot:output,replayName:'match1',authoritativeTotal:A_TOTAL});
  assert.equal(r.state,'INCOMPLETE');assert.equal(r.completeAuthoritative,114);assert.equal(r.missingAuthoritative,0);assert.equal(r.contractCurrent,true);
});

test('current contract with failed coverage is INCOMPLETE',async()=>{
  const {root,output}=await fixtureWithManifest({manifestTotal:114,complete:113,failed:1,runStatus:'FAILED_REQUIRED_STEP'});
  const r=await replayReadiness({repoRoot:root,outputRoot:output,replayName:'match1',authoritativeTotal:A_TOTAL});
  assert.equal(r.state,'INCOMPLETE');assert.equal(r.completeAuthoritative,113);assert.equal(r.failedAuthoritative,1);
});

test('old complete manifest is STALE_CONTRACT rather than silently READY',async()=>{
  const {root,output}=await fixtureWithManifest({manifestTotal:80,complete:80,runStatus:'COMPLETE'});
  const r=await replayReadiness({repoRoot:root,outputRoot:output,replayName:'match1',authoritativeTotal:A_TOTAL});
  assert.equal(r.state,'STALE_CONTRACT');assert.equal(r.manifestAuthoritativeTotal,80);assert.equal(r.authoritativeTotal,114);assert.equal(r.contractCurrent,false);
});

test('contract drift triggers replay reprocessing',async()=>{
  const {root,output}=await fixtureWithManifest({manifestTotal:78,complete:78,runStatus:'COMPLETE'});
  const d=await needsReplayProcessing({repoRoot:root,outputRoot:output,replayName:'match1'});
  assert.equal(d.needed,true);assert.equal(d.reason,'contract_changed');
});

async function fixtureWithManifest({manifestTotal,complete,failed=0,blocked=0,notSupported=0,unclassified=0,runStatus}){
  const root=await mkdtemp(join(tmpdir(),'db-ingest-manifest-')),replays=join(root,'replays'),output=join(root,'output'),out=join(output,'match1');
  await mkdir(replays,{recursive:true});await mkdir(out,{recursive:true});await writeFile(join(replays,'match1.dem'),'fixture');
  await new Promise(r=>setTimeout(r,10));
  await writeFile(join(out,'production_manifest_v01.json'),JSON.stringify({
    version:'DEADLOCK_PRODUCTION_MANIFEST_V01',replayName:'match1',generatedAt:new Date().toISOString(),runStatus,
    coverage:{authoritativeTotal:manifestTotal,completeAuthoritative:complete,failedAuthoritative:failed,blockedAuthoritative:blocked,notSupportedAuthoritative:notSupported,unclassifiedAuthoritative:unclassified,metricIds:{complete:[],failed:[],blocked:[],not_supported:[],unclassified:[]}},
    contractErrors:{missingMetricOwners:[],duplicateMetricOwners:[]}
  }));
  return{root,output};
}
