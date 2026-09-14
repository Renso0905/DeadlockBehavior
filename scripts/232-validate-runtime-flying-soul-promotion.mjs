import fs from'node:fs/promises';
import{createReadStream}from'node:fs';
import{createInterface}from'node:readline';
import{join,resolve}from'node:path';
import{publishedDirectory}from'../inspector-v04/lib/run-integrity.mjs';

const requested=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const names=requested.length?requested:(await fs.readdir('replays')).filter(x=>x.toLowerCase().endsWith('.dem')).map(x=>x.slice(0,-4)).sort();
const research=await readJson('output/cross_replay/flying_soul_opportunity_existence_batch_v01.json');
const researchCounts=new Map((research.replays??research.replayResults??[]).map(x=>[x.replay,Number(x.sourceLink?.strictLinks)]));
const results=[];
for(const replayName of names){
  const replayDir=resolve('output',replayName),manifest=await readJson(join(replayDir,'production_manifest_v01.json')),productionDir=publishedDirectory(replayDir,manifest);
  const artifact=await readJson(join(productionDir,'runtime_flying_soul_production_v01.json')),eventsPath=join(productionDir,'runtime_flying_soul_events_v01.jsonl'),errors=[];
  const check=(pass,message)=>{if(!pass)errors.push(message);};
  check(manifest?.runStatus==='COMPLETE','published manifest is not COMPLETE');check(manifest?.coverage?.completeAuthoritative===116,`manifest A coverage is ${manifest?.coverage?.completeAuthoritative??'missing'}, expected 116`);
  check(artifact?.status==='RUNTIME_FLYING_SOUL_PRODUCTION_V01_READY','flying-soul artifact is not READY');check(artifact?.validation?.pass===true,'artifact validation did not pass');
  let rows=0,attackable=0;const ids=new Set(),byTeam={};
  const rl=createInterface({input:createReadStream(eventsPath,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of rl){if(!line.trim())continue;rows++;const e=JSON.parse(line);
    check(!ids.has(e.episodeId),`duplicate episode ${e.episodeId}`);ids.add(e.episodeId);check(e.subclassId==='494398941',`unexpected subclass ${e.subclassId}`);
    check(e.sourceLink?.method==='MUTUALLY_UNIQUE_SAME_TEAM_TICK_AND_DISTANCE',`invalid link method at ${e.episodeId}`);check(e.sourceLink?.tickDelta>=-1&&e.sourceLink?.tickDelta<=4,`tick envelope failure at ${e.episodeId}`);check(e.sourceLink?.distance3D<=250,`distance envelope failure at ${e.episodeId}`);
    if(Number.isFinite(e.attackableWindowSeconds)&&e.attackableWindowSeconds>=0)attackable++;else errors.push(`invalid attackable window at ${e.episodeId}`);inc(byTeam,String(e.team));
  }
  check(rows===artifact?.summary?.episodes,`rows ${rows} != summary episodes ${artifact?.summary?.episodes}`);check(attackable===rows,`${rows-attackable} episodes lack a valid attackable window`);
  const expected=researchCounts.get(replayName);if(Number.isFinite(expected))check(rows===expected,`production links ${rows} != established strict links ${expected}`);
  const result={replayName,runId:manifest?.runId??null,episodes:rows,attackableWindows:attackable,byTeam,establishedStrictLinks:Number.isFinite(expected)?expected:null,pass:errors.length===0,errors};results.push(result);console.log(JSON.stringify(result));
}
const totals={replays:results.length,episodes:results.reduce((n,x)=>n+x.episodes,0),attackableWindows:results.reduce((n,x)=>n+x.attackableWindows,0),byTeam:mergeCounts(results.map(x=>x.byTeam)),researchComparisons:results.filter(x=>x.establishedStrictLinks!==null).length};
const pass=results.length>=6&&results.every(x=>x.pass)&&totals.researchComparisons>=5;
const report={version:'RUNTIME_FLYING_SOUL_PROMOTION_VALIDATION_V01',generatedAt:new Date().toISOString(),status:pass?'READY_FOR_SCOPED_A_AUTHORITY':'FAILED',semanticScope:{supported:['Mutually unique same-team Trooper-death links to CItemXP subclass 494398941 inside the frozen -1..+4 tick and <=250 HU envelope','Direct m_flAttackableTime to m_flEndAttackableTime duration'],excluded:['Complete Trooper-orb production rate','Shooter identity','Secure/deny result','Reward recipient/value','Automatic award','Visibility or opportunity']},replays:results,totals,pass};
await fs.mkdir('output/cross_replay',{recursive:true});await fs.writeFile('output/cross_replay/runtime_flying_soul_promotion_validation_v01.json',JSON.stringify(report,null,2)+'\n');if(!pass)process.exitCode=1;
function inc(o,k){o[k]=(o[k]??0)+1;}function mergeCounts(xs){const o={};for(const x of xs)for(const[k,v]of Object.entries(x))o[k]=(o[k]??0)+v;return o;}async function readJson(p){return JSON.parse(await fs.readFile(p,'utf8'));}
