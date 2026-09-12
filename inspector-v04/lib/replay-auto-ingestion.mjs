import { watch, promises as fs } from 'node:fs';
import { basename, join } from 'node:path';

export async function startReplayAutoIngestion({repoRoot,shouldProcess,processReplay,onLog=()=>{},debounceMs=1200}) {
  const replayDir=join(repoRoot,'replays');
  await fs.mkdir(replayDir,{recursive:true});
  const timers=new Map();let closed=false;

  const schedule=(replayName,reason)=>{
    if(closed||!replayName)return;
    if(timers.has(replayName))clearTimeout(timers.get(replayName));
    timers.set(replayName,setTimeout(async()=>{
      timers.delete(replayName);
      try{
        const replayPath=join(replayDir,`${replayName}.dem`);
        if(!await waitForStableFile(replayPath)){onLog(`${replayName}: file did not stabilize; auto-processing skipped.`);return;}
        if(!await shouldProcess(replayName))return;
        onLog(`${replayName}: automatic processing started (${reason}).`);
        const result=await processReplay(replayName);
        onLog(`${replayName}: automatic processing ended ${result?.status??'UNKNOWN'}.`);
      }catch(error){onLog(`${replayName}: automatic processing failed: ${error?.message??error}`);}
    },debounceMs));
  };

  try{
    for(const entry of await fs.readdir(replayDir,{withFileTypes:true})){
      if(entry.isFile()&&entry.name.toLowerCase().endsWith('.dem')){
        const replayName=basename(entry.name,'.dem');
        if(await shouldProcess(replayName))schedule(replayName,'startup scan');
      }
    }
  }catch{}

  const fsWatcher=watch(replayDir,(_eventType,filename)=>{
    if(!filename||!String(filename).toLowerCase().endsWith('.dem'))return;
    schedule(basename(String(filename),'.dem'),'replays directory change');
  });

  return{close(){closed=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();fsWatcher.close();}};
}

async function waitForStableFile(path,{intervalMs=750,stableChecks=3,maxChecks=40}={}){
  let previous=null,stable=0;
  for(let i=0;i<maxChecks;i++){
    const current=await statMaybe(path);
    if(!current){stable=0;previous=null;}
    else if(previous&&current.size===previous.size&&current.mtimeMs===previous.mtimeMs){stable++;if(stable>=stableChecks)return true;}
    else{stable=0;previous=current;}
    await delay(intervalMs);
  }
  return false;
}
async function statMaybe(path){try{const s=await fs.stat(path);return{size:s.size,mtimeMs:s.mtimeMs};}catch{return null;}}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
