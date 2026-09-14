import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join,resolve } from 'node:path';
import { publishedDirectory } from '../inspector-v04/lib/run-integrity.mjs';

const args=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const names=args.length?args:(await fs.readdir('replays')).filter(x=>x.toLowerCase().endsWith('.dem')).map(x=>x.slice(0,-4)).sort();
const results=[];

for(const replayName of names){
  const replayDir=resolve('output',replayName);
  const manifest=await readJson(join(replayDir,'production_manifest_v01.json'));
  const productionDir=publishedDirectory(replayDir,manifest);
  const artifact=await readJson(join(productionDir,'runtime_trooper_deaths_production_v01.json'));
  const eventsPath=join(productionDir,'runtime_trooper_death_events_v01.jsonl');
  const errors=[];
  const check=(pass,message)=>{if(!pass)errors.push(message);};
  check(manifest?.runStatus==='COMPLETE','published manifest is not COMPLETE');
  check(manifest?.coverage?.completeAuthoritative===116,`manifest complete A count is ${manifest?.coverage?.completeAuthoritative??'missing'}, expected 116`);
  check(artifact?.status==='RUNTIME_TROOPER_DEATH_PRODUCTION_V01_READY','Trooper artifact is not READY');
  check(artifact?.validation?.pass===true,'Trooper artifact validation did not pass');
  const bySubclassId={},byTeam={},byLane={},byTeamLane={};
  const identities=new Set();
  let rows=0;
  const rl=createInterface({input:createReadStream(eventsPath,{encoding:'utf8'}),crlfDelay:Infinity});
  for await(const line of rl){
    if(!line.trim())continue;
    rows++;let event;
    try{event=JSON.parse(line);}catch{errors.push(`invalid JSONL at line ${rows}`);continue;}
    const identity=`${event.tick}:${event.entityIndex}`;
    check(!identities.has(identity),`duplicate death identity ${identity}`);identities.add(identity);
    check(event.previousHealth>0&&event.currentHealth===0,`invalid death transition at line ${rows}`);
    const context=event.trooperContext??{};
    for(const key of ['subclassId','team','lane'])check(Number.isInteger(context[key]),`${key} is not an integer at line ${rows}`);
    if(Number.isInteger(context.subclassId))inc(bySubclassId,String(context.subclassId));
    if(Number.isInteger(context.team))inc(byTeam,String(context.team));
    if(Number.isInteger(context.lane))inc(byLane,String(context.lane));
    if(Number.isInteger(context.team)&&Number.isInteger(context.lane))inc(byTeamLane,`team_${context.team}_lane_${context.lane}`);
  }
  const summary=artifact?.summary??{};
  check(rows===artifact?.counts?.deaths,`event rows ${rows} do not match death count ${artifact?.counts?.deaths}`);
  check(rows===summary.completeContextDeaths,`event rows ${rows} do not match complete-context deaths ${summary.completeContextDeaths}`);
  check(summary.incompleteContextDeaths===0,`incomplete-context deaths is ${summary.incompleteContextDeaths}`);
  for(const [label,actual,expected] of [['subclass',bySubclassId,summary.bySubclassId],['team',byTeam,summary.byTeam],['lane',byLane,summary.byLane],['team/lane',byTeamLane,summary.byTeamLane]])check(equalCounts(actual,expected),`${label} counts do not reconcile`);
  check(Object.keys(bySubclassId).length>0,'no subclass IDs observed');
  check(Object.keys(byTeamLane).length>0,'no team/lane pairs observed');
  results.push({replayName,runId:manifest?.runId??null,eventRows:rows,subclassIds:bySubclassId,teams:byTeam,lanes:byLane,teamLanePairs:byTeamLane,pass:errors.length===0,errors});
  console.log(JSON.stringify(results.at(-1)));
}

const totals={replays:results.length,eventRows:results.reduce((n,r)=>n+r.eventRows,0),subclassIds:mergeCounts(results.map(r=>r.subclassIds)),teams:mergeCounts(results.map(r=>r.teams)),lanes:mergeCounts(results.map(r=>r.lanes)),teamLanePairs:mergeCounts(results.map(r=>r.teamLanePairs))};
const report={version:'RUNTIME_TROOPER_CONTEXT_PROMOTION_VALIDATION_V01',generatedAt:new Date().toISOString(),status:results.length>=6&&results.every(r=>r.pass)?'READY_FOR_SCOPED_A_AUTHORITY':'FAILED',semanticScope:{supported:['Direct raw CNPC_Trooper m_nSubclassID at each authoritative death transition','Direct raw CNPC_Trooper m_iTeamNum and m_iLane pair at each authoritative death transition'],excluded:['Named Ranged, Medic, Melee, Super, or Rift mapping','Lane names or jungle interpretation','Killer or last-hitter identity','Attack method or melee attribution','Ground-Soul eligibility, collection, or reward outcome']},replays:results,totals,pass:results.length>=6&&results.every(r=>r.pass)};
await fs.mkdir('output/cross_replay',{recursive:true});
await fs.writeFile('output/cross_replay/runtime_trooper_context_promotion_validation_v01.json',JSON.stringify(report,null,2)+'\n');
if(!report.pass)process.exitCode=1;

function inc(object,key){object[key]=(object[key]??0)+1;}
function equalCounts(a,b){const keys=new Set([...Object.keys(a??{}),...Object.keys(b??{})]);return [...keys].every(key=>Number(a?.[key]??0)===Number(b?.[key]??0));}
function mergeCounts(objects){const out={};for(const object of objects)for(const [key,value] of Object.entries(object??{}))out[key]=(out[key]??0)+Number(value);return out;}
async function readJson(path){return JSON.parse(await fs.readFile(path,'utf8'));}
