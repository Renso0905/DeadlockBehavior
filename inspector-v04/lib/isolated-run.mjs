import { promises as fs, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, basename, resolve } from 'node:path';
import { inputFingerprint, inspectOutput, validReplayName } from './run-integrity.mjs';

export async function atomicJson(path,value){const temp=path+`.${randomUUID()}.tmp`;await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,path);}
export async function isolatedRun({repoRoot,inspectorRoot,replayName,onEvent,runDirect}){
  if(!validReplayName(replayName))throw new Error('Invalid replay name');
  const runId=randomUUID(),work=join(repoRoot,'output','.pipeline-work',runId),out=join(repoRoot,'output',replayName);
  const before=await inputFingerprint(repoRoot,replayName,inspectorRoot);
  await fs.mkdir(join(work,'output'),{recursive:true});await fs.mkdir(out,{recursive:true});
  for(const name of ['scripts','src','contracts','node_modules','inspector-v04','replays'])if(existsSync(join(repoRoot,name)))await fs.symlink(resolve(repoRoot,name),join(work,name),process.platform==='win32'?'junction':'dir');
  if(existsSync(join(repoRoot,'output','cross_replay')))await fs.symlink(resolve(repoRoot,'output','cross_replay'),join(work,'output','cross_replay'),process.platform==='win32'?'junction':'dir');
  await atomicJson(join(out,'production_job.json'),{runId,state:'PROCESSING',startedAt:new Date().toISOString()});
  let result;
  try{
    result=await runDirect({repoRoot:work,inspectorRoot,replayName,onEvent:event=>{
      onEvent(event);
      if(event.type==='step-start')fs.writeFile(join(out,'production_progress.json'),JSON.stringify({runId,currentStage:event.id,updatedAt:new Date().toISOString()})).catch(()=>{});
    }});
    if(result.status!=='COMPLETE')throw new Error(`Required stages did not complete: ${result.status}`);
    const c=result.productionManifest.coverage;
    if(c.completeAuthoritative!==c.authoritativeTotal||c.unclassifiedAuthoritative||result.productionManifest.contractErrors.duplicateMetricOwners.length)throw new Error('Incomplete metric ownership/coverage');
    const produced=join(work,'output',replayName),outputDigests={};
    for(const stage of result.results)for(const spec of stage.outputs??[]){const name=basename(spec.path);outputDigests[name]=await inspectOutput(join(produced,name));}
    if(before!==await inputFingerprint(repoRoot,replayName,inspectorRoot))throw new Error('Replay, code, contract, or resource inputs changed during processing; retry.');
    const publishedOutputDir=join('.production-runs',runId),published=join(out,publishedOutputDir);
    await fs.mkdir(join(out,'.production-runs'),{recursive:true});await fs.rename(produced,published);
    const manifest={...result.productionManifest,path:undefined,runId,inputFingerprint:before,publishedOutputDir,outputDigests};
    // Historical research entrypoints still read flat files. The visualizer uses the
    // immutable run directory and switches only when the manifest is published.
    for(const name of Object.keys(outputDigests)){const temp=join(out,`.${runId}-${name}.tmp`);await fs.copyFile(join(published,name),temp);await fs.rename(temp,join(out,name));}
    await atomicJson(join(out,'production_manifest_v01.json'),manifest);
    result.productionManifest={...manifest,path:join(out,'production_manifest_v01.json')};
    await atomicJson(join(out,'production_job.json'),{runId,state:'READY',finishedAt:new Date().toISOString(),inputFingerprint:before});
    return result;
  }catch(error){
    const message=error?.message??String(error);
    await atomicJson(join(out,'production_job.json'),{runId,state:'FAILED',finishedAt:new Date().toISOString(),inputFingerprint:before,error:message});
    if(result){result.status='FAILED_REQUIRED_STEP';result.error=message;return result;}
    throw error;
  }
}
