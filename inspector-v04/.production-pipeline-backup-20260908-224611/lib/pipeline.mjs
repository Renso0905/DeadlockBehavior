import { existsSync, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

export async function loadPipelineConfig(inspectorRoot) {
  const path=join(inspectorRoot,'pipeline.json');
  try { return JSON.parse(await fs.readFile(path,'utf8')); }
  catch { return { version:'INSPECTOR_PIPELINE_V01', steps:[] }; }
}

export async function importReplay({repoRoot,filename,bytes}) {
  const safe=sanitizeReplayName(filename);
  if (!safe.toLowerCase().endsWith('.dem')) throw new Error('Replay file must end in .dem');
  const replaysDir=join(repoRoot,'replays');
  await fs.mkdir(replaysDir,{recursive:true});
  const path=join(replaysDir,safe);
  await fs.writeFile(path,bytes);
  return { replayName:basename(safe,'.dem'), path };
}

export async function runPipeline({repoRoot,inspectorRoot,replayName,onEvent=()=>{}}) {
  const config=await loadPipelineConfig(inspectorRoot);
  const context={ repoRoot, replayName };
  const results=[];
  if (!Array.isArray(config.steps) || config.steps.length===0) {
    return {
      version:config.version??'INSPECTOR_PIPELINE_V01', replayName, configured:false,
      status:'PROCESSING_MANIFEST_EMPTY',
      message:'Replay was imported, but no current research-processing steps are configured in inspector-v04/pipeline.json. This is intentional: the inspector will not guess which historical research scripts are authoritative.',
      results
    };
  }
  for (const step of config.steps) {
    const result=await runStep(step,context,onEvent); results.push(result);
    if (!result.ok && step.required!==false && config.stopOnRequiredFailure!==false) break;
  }
  const requiredFailures=results.filter(r=>r.required&& !r.ok);
  return { version:config.version, replayName, configured:true, status:requiredFailures.length?'FAILED_REQUIRED_STEP':'COMPLETE',results };
}

async function runStep(step,{repoRoot,replayName},onEvent) {
  const command=step.command ?? 'node';
  const args=(step.args??[]).map(v=>String(v).replaceAll('{replay}',replayName).replaceAll('{repoRoot}',repoRoot));
  if (step.ifExists) {
    const candidate=resolve(repoRoot,String(step.ifExists).replaceAll('{replay}',replayName));
    if (!existsSync(candidate)) return {id:step.id,label:step.label,required:step.required!==false,ok:false,skipped:true,reason:`Missing ${candidate}`};
  }
  onEvent({type:'step-start',id:step.id,label:step.label});
  return new Promise(resolvePromise=>{
    const child=spawn(command,args,{cwd:repoRoot,shell:false,env:{...process.env,DEADLOCK_REPLAY_NAME:replayName}});
    let stdout='',stderr='';
    child.stdout?.on('data',d=>{stdout+=d; onEvent({type:'stdout',id:step.id,text:String(d)});});
    child.stderr?.on('data',d=>{stderr+=d; onEvent({type:'stderr',id:step.id,text:String(d)});});
    child.on('error',err=>resolvePromise({id:step.id,label:step.label,required:step.required!==false,ok:false,error:err.message,stdout,stderr}));
    child.on('close',code=>resolvePromise({id:step.id,label:step.label,required:step.required!==false,ok:code===0,code,stdout:tail(stdout),stderr:tail(stderr)}));
  });
}

function sanitizeReplayName(name) {
  const base=basename(String(name||'replay.dem')).replace(/[^A-Za-z0-9._-]/g,'_');
  if (!base || base==='.' || base==='..') throw new Error('Invalid replay filename');
  return base;
}
function tail(s,n=12000){ return s.length>n?s.slice(-n):s; }
