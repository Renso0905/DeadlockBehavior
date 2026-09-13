import { promises as fs, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, basename, resolve } from 'node:path';
import { inputFingerprint, inspectOutput, validReplayName } from './run-integrity.mjs';

export async function atomicJson(path,value){const temp=path+`.${randomUUID()}.tmp`;await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,path);}
export async function isolatedRun(options){
  const {repoRoot,replayName}=options;
  if(!validReplayName(replayName))throw new Error('Invalid replay name');
  const release=await acquireReplayPipelineLock(repoRoot,replayName);
  try{return await isolatedRunUnlocked(options);}finally{await release();}
}

async function isolatedRunUnlocked({repoRoot,inspectorRoot,replayName,onEvent,runDirect}){
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

export async function acquireReplayPipelineLock(repoRoot,replayName){
  if(!validReplayName(replayName))throw new Error('Invalid replay name');
  const dir=join(repoRoot,'output','.pipeline-locks'),path=join(dir,`${replayName}.lock`),lockId=randomUUID();
  await fs.mkdir(dir,{recursive:true});
  for(let attempt=0;attempt<2;attempt++){
    try{
      const handle=await fs.open(path,'wx');
      try{await handle.writeFile(JSON.stringify({lockId,pid:process.pid,replayName,startedAt:new Date().toISOString()})+'\n');}finally{await handle.close();}
      return async()=>{
        try{
          const current=JSON.parse(await fs.readFile(path,'utf8'));
          if(current.lockId===lockId)await fs.unlink(path);
        }catch(error){if(error?.code!=='ENOENT')throw error;}
      };
    }catch(error){
      if(error?.code!=='EEXIST')throw error;
      const current=await readLock(path);
      if(attempt===0&&current?.pid&&!processAlive(current.pid)){await fs.unlink(path).catch(unlinkError=>{if(unlinkError?.code!=='ENOENT')throw unlinkError;});continue;}
      const busy=new Error(`Replay ${replayName} is already processing in another process${current?.pid?` (PID ${current.pid})`:''}.`);
      busy.code='REPLAY_PIPELINE_BUSY';busy.lock=current;throw busy;
    }
  }
  throw new Error(`Could not acquire processing lock for replay ${replayName}.`);
}

async function readLock(path){try{return JSON.parse(await fs.readFile(path,'utf8'));}catch{return null;}}
function processAlive(pid){
  if(!Number.isInteger(Number(pid))||Number(pid)<=0)return false;
  try{process.kill(Number(pid),0);return true;}catch(error){return error?.code==='EPERM';}
}
