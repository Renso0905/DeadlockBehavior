import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';

export async function listReplayInventory({repoRoot,outputRoot}) {
  const names=new Set();
  try {
    for(const entry of await fs.readdir(join(repoRoot,'replays'),{withFileTypes:true})) {
      if(entry.isFile()&&entry.name.toLowerCase().endsWith('.dem')) names.add(basename(entry.name,'.dem'));
    }
  } catch {}
  try {
    for(const entry of await fs.readdir(outputRoot,{withFileTypes:true})) {
      if(entry.isDirectory()&&entry.name!=='cross_replay'&&!entry.name.startsWith('.')) names.add(entry.name);
    }
  } catch {}
  return [...names].sort(replaySort);
}

export async function replayReadiness({repoRoot,outputRoot,replayName,authoritativeTotal,processing=null}) {
  const replayPath=join(repoRoot,'replays',`${replayName}.dem`);
  const outputDir=join(outputRoot,replayName);
  const manifestPath=join(outputDir,'production_manifest_v01.json');
  const replayStat=await statMaybe(replayPath);
  const outputStat=await statMaybe(outputDir);
  const manifest=await readJsonMaybe(manifestPath);
  const currentTotal=Number(authoritativeTotal);

  if(processing?.state==='PROCESSING') {
    const coverage=manifest?.coverage??{};
    return {
      state:'PROCESSING',replayPresent:Boolean(replayStat),outputPresent:Boolean(outputStat),manifestPresent:Boolean(manifest),
      authoritativeTotal:Number.isFinite(currentTotal)?currentTotal:Number(coverage.authoritativeTotal??0),
      completeAuthoritative:Number(coverage.completeAuthoritative??0),
      missingAuthoritative:null,currentStage:processing.currentStage??null,processingOrigin:processing.origin??null,
      runStatus:manifest?.runStatus??null,contractCurrent:manifest?Number(coverage.authoritativeTotal)===currentTotal:null,
      manifestGeneratedAt:manifest?.generatedAt??null
    };
  }

  if(!manifest) {
    const state=replayStat?'UNPROCESSED':outputStat?'OUTPUT_ONLY':'MISSING';
    return {
      state,replayPresent:Boolean(replayStat),outputPresent:Boolean(outputStat),manifestPresent:false,
      authoritativeTotal:Number.isFinite(currentTotal)?currentTotal:0,completeAuthoritative:0,
      missingAuthoritative:Number.isFinite(currentTotal)?currentTotal:null,runStatus:null,contractCurrent:null,manifestGeneratedAt:null
    };
  }

  const coverage=manifest.coverage??{};
  const manifestTotal=Number(coverage.authoritativeTotal??0);
  const complete=Number(coverage.completeAuthoritative??0);
  const failed=Number(coverage.failedAuthoritative??0);
  const blocked=Number(coverage.blockedAuthoritative??0);
  const notSupported=Number(coverage.notSupportedAuthoritative??0);
  const unclassified=Number(coverage.unclassifiedAuthoritative??0);
  const missingOwners=manifest?.contractErrors?.missingMetricOwners??[];
  const duplicateOwners=manifest?.contractErrors?.duplicateMetricOwners??[];
  const contractCurrent=manifestTotal===currentTotal;
  const coverageClean=complete===currentTotal&&failed===0&&blocked===0&&notSupported===0&&unclassified===0&&missingOwners.length===0&&duplicateOwners.length===0;
  const runComplete=manifest.runStatus==='COMPLETE';
  const state=!contractCurrent?'STALE_CONTRACT':coverageClean&&runComplete?'READY':'INCOMPLETE';

  return {
    state,replayPresent:Boolean(replayStat),outputPresent:Boolean(outputStat),manifestPresent:true,
    authoritativeTotal:currentTotal,manifestAuthoritativeTotal:manifestTotal,completeAuthoritative:complete,
    missingAuthoritative:Math.max(0,currentTotal-complete),failedAuthoritative:failed,blockedAuthoritative:blocked,
    notSupportedAuthoritative:notSupported,unclassifiedAuthoritative:unclassified,runStatus:manifest.runStatus??null,
    contractCurrent,manifestGeneratedAt:manifest.generatedAt??null,replayMtimeMs:replayStat?.mtimeMs??null,
    manifestMtimeMs:(await statMaybe(manifestPath))?.mtimeMs??null,
    contractErrors:{missingMetricOwners:missingOwners,duplicateMetricOwners:duplicateOwners},
    metricIds:coverage.metricIds??null
  };
}

export async function needsReplayProcessing({repoRoot,outputRoot,replayName}) {
  const replayPath=join(repoRoot,'replays',`${replayName}.dem`);
  const manifestPath=join(outputRoot,replayName,'production_manifest_v01.json');
  const replayStat=await statMaybe(replayPath);
  if(!replayStat)return{needed:false,reason:'replay_missing'};
  const manifest=await readJsonMaybe(manifestPath);
  if(!manifest)return{needed:true,reason:'manifest_missing'};
  const manifestStat=await statMaybe(manifestPath);
  if(!manifestStat)return{needed:true,reason:'manifest_missing'};
  if(replayStat.mtimeMs>manifestStat.mtimeMs)return{needed:true,reason:'replay_newer_than_manifest'};
  return{needed:false,reason:'already_processed'};
}

async function readJsonMaybe(path){try{return JSON.parse(await fs.readFile(path,'utf8'));}catch{return null;}}
async function statMaybe(path){try{const s=await fs.stat(path);return{size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs,isDirectory:s.isDirectory()};}catch{return null;}}
function replaySort(a,b){if(a==='test')return-1;if(b==='test')return 1;const na=Number(a.match(/\d+/)?.[0]??Infinity),nb=Number(b.match(/\d+/)?.[0]??Infinity);return na-nb||a.localeCompare(b);}
