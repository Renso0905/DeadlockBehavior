import { existsSync, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { AUTHORITATIVE_PRODUCTION_METRIC_IDS, CORE_AUTHORITATIVE_PRODUCTION_METRIC_IDS, EXTENDED_AUTHORITATIVE_PRODUCTION_METRIC_IDS, getProductionCapability } from './production-capabilities.mjs';

const MANIFEST_VERSION='DEADLOCK_PRODUCTION_MANIFEST_V01';
const TERMINAL_FAILURES=new Set(['failed','blocked']);

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
    const response={
      version:config.version??'INSPECTOR_PIPELINE_V01', replayName, configured:false,
      status:'PROCESSING_MANIFEST_EMPTY',
      message:'Replay was imported, but no current research-processing steps are configured in inspector-v04/pipeline.json. The inspector will not guess which historical research scripts are authoritative.',
      results
    };
    response.productionManifest=await persistManifest({repoRoot,replayName,config,response});
    return response;
  }

  let haltReason=null;
  for (const step of config.steps) {
    let result;
    const capability=getProductionCapability(step.capability);
    if (haltReason && capability?.productionStatus!=='not_supported') {
      result=blockedResult(step,capability,`Not run because ${haltReason}.`);
    } else {
      result=await runStep(step,context,onEvent,results);
    }
    results.push(result);
    if (TERMINAL_FAILURES.has(result.status) && result.required && config.stopOnRequiredFailure!==false) {
      haltReason=`required stage ${result.id} ended ${result.status}`;
    }
  }

  const requiredFailures=results.filter(r=>r.required&&TERMINAL_FAILURES.has(r.status));
  const unsupported=results.some(r=>r.status==='not_supported');
  const response={
    version:config.version,
    replayName,
    configured:true,
    status:requiredFailures.length?'FAILED_REQUIRED_STEP':unsupported?'COMPLETE_WITH_UNSUPPORTED_CAPABILITIES':'COMPLETE',
    results
  };
  response.productionManifest=await persistManifest({repoRoot,replayName,config,response});
  return response;
}

async function runStep(step,{repoRoot,replayName},onEvent,priorResults) {
  const capability=getProductionCapability(step.capability);
  const common=baseResult(step,capability);

  if (capability?.productionStatus==='not_supported' || step.supported===false) {
    return {...common,status:'not_supported',ok:false,skipped:true,reason:step.reason??capability?.reason??'No production entrypoint is configured.'};
  }

  if (Array.isArray(step.dependsOn) && step.dependsOn.length) {
    const unmet=step.dependsOn.filter(id=>priorResults.find(r=>r.id===id)?.status!=='complete');
    if (unmet.length) return {...common,status:'blocked',ok:false,skipped:true,reason:`Unmet dependencies: ${unmet.join(', ')}`};
  }

  if (step.ifExists) {
    const candidate=resolve(repoRoot,substitute(step.ifExists,{repoRoot,replayName}));
    if (!existsSync(candidate)) return {...common,status:'blocked',ok:false,skipped:true,reason:`Missing ${candidate}`};
  }

  const expected=normalizeExpectedOutputs(step.expectedOutputs??[],repoRoot,replayName);
  const before=await snapshotOutputs(expected);
  const command=step.command ? substitute(String(step.command),{repoRoot,replayName}) : process.execPath;
  const args=(step.args??[]).map(v=>substitute(String(v),{repoRoot,replayName}));
  const startedAt=new Date().toISOString();
  onEvent({type:'step-start',id:step.id,label:step.label,capability:step.capability});

  const processResult=await spawnStep(command,args,{repoRoot,replayName,step,onEvent});
  if (!processResult.ok) return {...common,...processResult,status:'failed',startedAt,finishedAt:new Date().toISOString()};

  const outputValidation=await validateFreshOutputs(expected,before);
  if (!outputValidation.ok) {
    return {...common,...processResult,status:'failed',ok:false,startedAt,finishedAt:new Date().toISOString(),reason:outputValidation.reason,outputs:outputValidation.outputs};
  }
  return {...common,...processResult,status:'complete',ok:true,startedAt,finishedAt:new Date().toISOString(),outputs:outputValidation.outputs};
}

function spawnStep(command,args,{repoRoot,replayName,step,onEvent}) {
  return new Promise(resolvePromise=>{
    const child=spawn(command,args,{cwd:repoRoot,shell:false,env:{...process.env,DEADLOCK_REPLAY_NAME:replayName}});
    let stdout='',stderr=''; let settled=false;
    const finish=value=>{if(!settled){settled=true;resolvePromise(value);}};
    child.stdout?.on('data',d=>{stdout+=d; onEvent({type:'stdout',id:step.id,text:String(d)});});
    child.stderr?.on('data',d=>{stderr+=d; onEvent({type:'stderr',id:step.id,text:String(d)});});
    child.on('error',err=>finish({ok:false,error:err.message,stdout:tail(stdout),stderr:tail(stderr)}));
    child.on('close',code=>finish({ok:code===0,code,stdout:tail(stdout),stderr:tail(stderr)}));
  });
}

function baseResult(step,capability) {
  return {
    id:step.id,
    label:step.label,
    capability:step.capability??null,
    required:step.required!==false,
    metricIds:[...(capability?.metricIds??step.metricIds??[])],
    validation:capability?.validation??step.validation??null
  };
}

function blockedResult(step,capability,reason) {
  return {...baseResult(step,capability),status:'blocked',ok:false,skipped:true,reason};
}

async function persistManifest({repoRoot,replayName,config,response}) {
  const manifest=buildProductionManifest({replayName,config,response});
  const dir=join(repoRoot,'output',replayName);
  await fs.mkdir(dir,{recursive:true});
  const file=config.manifestFile??'production_manifest_v01.json';
  const path=join(dir,file);
  await fs.writeFile(path,JSON.stringify(manifest,null,2)+'\n','utf8');
  return {...manifest,path};
}

export function buildProductionManifest({replayName,config,response}) {
  const authoritative=new Set(AUTHORITATIVE_PRODUCTION_METRIC_IDS);
  const buckets={complete:[],failed:[],blocked:[],not_supported:[],unclassified:[]};
  const owners=new Map();
  for (const result of response.results??[]) {
    for (const id of result.metricIds??[]) {
      if (!authoritative.has(id)) continue;
      if (!owners.has(id)) owners.set(id,[]);
      owners.get(id).push(result.id);
      const bucket=buckets[result.status] ?? buckets.unclassified;
      bucket.push(id);
    }
  }
  const missing=AUTHORITATIVE_PRODUCTION_METRIC_IDS.filter(id=>!owners.has(id));
  buckets.unclassified.push(...missing);
  for (const key of Object.keys(buckets)) buckets[key]=[...new Set(buckets[key])].sort();
  const duplicateMetricOwners=[...owners.entries()].filter(([,v])=>v.length>1).map(([metricId,stages])=>({metricId,stages}));
  const coverage={
    authoritativeTotal:AUTHORITATIVE_PRODUCTION_METRIC_IDS.length,
    completeAuthoritative:buckets.complete.length,
    failedAuthoritative:buckets.failed.length,
    blockedAuthoritative:buckets.blocked.length,
    notSupportedAuthoritative:buckets.not_supported.length,
    unclassifiedAuthoritative:buckets.unclassified.length,
    core:layerCoverage(CORE_AUTHORITATIVE_PRODUCTION_METRIC_IDS,buckets),
    extended:layerCoverage(EXTENDED_AUTHORITATIVE_PRODUCTION_METRIC_IDS,buckets),
    metricIds:buckets
  };
  return {
    version:MANIFEST_VERSION,
    replayName,
    generatedAt:new Date().toISOString(),
    pipelineVersion:config.version??null,
    runStatus:response.status,
    validationTaxonomy:['integrityValidation','semanticValidation','replicationStatus'],
    coverage,
    contractErrors:{missingMetricOwners:missing,duplicateMetricOwners},
    stages:(response.results??[]).map(r=>({...r,stdout:undefined,stderr:undefined}))
  };
}

function layerCoverage(metricIds,buckets) {
  const ids=new Set(metricIds);
  const count=key=>(buckets[key]??[]).filter(id=>ids.has(id)).length;
  return {
    authoritativeTotal:metricIds.length,
    completeAuthoritative:count('complete'),
    failedAuthoritative:count('failed'),
    blockedAuthoritative:count('blocked'),
    notSupportedAuthoritative:count('not_supported'),
    unclassifiedAuthoritative:count('unclassified')
  };
}
function normalizeExpectedOutputs(values,repoRoot,replayName) {
  return values.map(value=>{
    const spec=typeof value==='string'?{path:value}:value;
    const rel=substitute(String(spec.path),{repoRoot,replayName});
    return {path:resolve(repoRoot,rel),relativePath:rel,minBytes:Number(spec.minBytes??0)};
  });
}

async function snapshotOutputs(expected) {
  const map=new Map();
  for (const spec of expected) map.set(spec.path,await statMaybe(spec.path));
  return map;
}

async function validateFreshOutputs(expected,before) {
  const outputs=[]; const problems=[];
  for (const spec of expected) {
    const prior=before.get(spec.path); const after=await statMaybe(spec.path);
    let fresh=false;
    if (after) fresh=!prior || after.mtimeMs>prior.mtimeMs || after.ctimeMs>prior.ctimeMs || after.size!==prior.size;
    const enough=Boolean(after)&&after.size>=spec.minBytes;
    outputs.push({path:spec.relativePath,present:Boolean(after),size:after?.size??0,fresh,minBytes:spec.minBytes});
    if (!after) problems.push(`${spec.relativePath} was not produced`);
    else if (!enough) problems.push(`${spec.relativePath} is smaller than ${spec.minBytes} bytes`);
    else if (!fresh) problems.push(`${spec.relativePath} existed before the run and was not freshly written`);
  }
  return {ok:problems.length===0,reason:problems.join('; ')||null,outputs};
}

async function statMaybe(path) {
  try { const s=await fs.stat(path); return {size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs}; }
  catch { return null; }
}

function substitute(value,{repoRoot,replayName}) {
  return value.replaceAll('{replay}',replayName).replaceAll('{repoRoot}',repoRoot);
}

function sanitizeReplayName(name) {
  const base=basename(String(name||'replay.dem')).replace(/[^A-Za-z0-9._-]/g,'_');
  if (!base || base==='.' || base==='..') throw new Error('Invalid replay filename');
  return base;
}
function tail(s,n=12000){ return s.length>n?s.slice(-n):s; }
