import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join,resolve } from 'node:path';
import { publishedDirectory } from '../inspector-v04/lib/run-integrity.mjs';

const DIRECT_KEYS=['inReload','activeFireMode','continuousShots','burstShotsRemaining'];
const args=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const names=args.length?args:(await fs.readdir('replays')).filter(x=>x.toLowerCase().endsWith('.dem')).map(x=>x.slice(0,-4)).sort();
const results=[];

for(const replayName of names){
  const replayDir=resolve('output',replayName);
  const manifest=await readJson(join(replayDir,'production_manifest_v01.json'));
  const productionDir=publishedDirectory(replayDir,manifest);
  const artifact=await readJson(join(productionDir,'runtime_primary_fire_production_v01.json'));
  const eventsPath=join(productionDir,'runtime_primary_weapon_state_events_v01.jsonl');
  const errors=[];
  const check=(pass,message)=>{if(!pass)errors.push(message);};
  check(manifest?.runStatus==='COMPLETE','published manifest is not COMPLETE');
  check(manifest?.coverage?.completeAuthoritative===114,`manifest complete A count is ${manifest?.coverage?.completeAuthoritative??'missing'}, expected 114`);
  check(artifact?.status==='RUNTIME_PRIMARY_FIRE_PRODUCTION_V01_READY','primary-fire artifact is not READY');
  check(artifact?.validation?.pass===true,'primary-fire artifact validation did not pass');
  const playerRows=artifact?.directStatePlayers??[];
  check(playerRows.length===12,`direct-state player count is ${playerRows.length}, expected 12`);
  const observedPlayers=playerRows.filter(p=>p.observations>0);
  check(observedPlayers.length>=10,`only ${observedPlayers.length} players have direct weapon state, expected at least 10`);
  check(observedPlayers.every(p=>p.allDirectCarriersObserved===true),'one or more observed players lack a direct carrier');
  check(new Set(playerRows.map(p=>p.controllerEntityIndex)).size===playerRows.length,'direct-state player identities are not unique');

  const byController=new Map();
  const byWeapon=new Map();
  let lines=0,deletions=0,reloadEnters=0,reloadExits=0,fireModeChanges=0,continuousChanges=0,burstChanges=0;
  let priorSequence=0;
  const rl=createInterface({input:createReadStream(eventsPath,{encoding:'utf8'}),crlfDelay:Infinity});
  for await(const line of rl){
    if(!line.trim())continue;
    lines++;let event;
    try{event=JSON.parse(line);}catch{errors.push(`invalid JSONL at line ${lines}`);continue;}
    check(Number.isInteger(event.sequence)&&event.sequence>priorSequence,`non-increasing sequence at line ${lines}`);priorSequence=event.sequence;
    check(Number.isInteger(event.controllerEntityIndex),`missing controller identity at line ${lines}`);
    if(event.eventType==='WEAPON_DELETE'||event.available===false){deletions++;byWeapon.delete(event.weaponEntityIndex);continue;}
    const state=event.directState??{};
    check(typeof state.inReload==='boolean'||state.inReload===null,'reload carrier is not boolean/null');
    for(const key of DIRECT_KEYS.slice(1))check(state[key]===null||Number.isFinite(state[key]),`${key} is not finite/null at line ${lines}`);
    for(const key of ['continuousShots','burstShotsRemaining'])check(state[key]===null||(Number.isInteger(state[key])&&state[key]>=0),`${key} is not a nonnegative integer/null at line ${lines}`);
    const seen=byController.get(event.controllerEntityIndex)??new Set();for(const key of DIRECT_KEYS)if(state[key]!==null)seen.add(key);byController.set(event.controllerEntityIndex,seen);
    const prior=byWeapon.get(event.weaponEntityIndex)??null;
    if(prior){
      const expectedReload=prior.inReload!==true&&state.inReload===true?'RELOAD_ENTER':prior.inReload===true&&state.inReload!==true?'RELOAD_EXIT':null;
      check((event.transition?.reloadTransition??null)===expectedReload,`reload transition mismatch at line ${lines}`);
      if(expectedReload==='RELOAD_ENTER')reloadEnters++;if(expectedReload==='RELOAD_EXIT')reloadExits++;
      if(prior.activeFireMode!==null&&state.activeFireMode!==null&&prior.activeFireMode!==state.activeFireMode)fireModeChanges++;
      if(prior.continuousShots!==null&&state.continuousShots!==null&&prior.continuousShots!==state.continuousShots)continuousChanges++;
      if(prior.burstShotsRemaining!==null&&state.burstShotsRemaining!==null&&prior.burstShotsRemaining!==state.burstShotsRemaining)burstChanges++;
    }
    byWeapon.set(event.weaponEntityIndex,state);
  }
  check(lines===artifact?.counts?.directStateEvents,`event line count ${lines} does not match summary ${artifact?.counts?.directStateEvents}`);
  for(const player of observedPlayers)check(DIRECT_KEYS.every(key=>byController.get(player.controllerEntityIndex)?.has(key)),`${player.playerName}: JSONL carrier coverage incomplete`);
  check(reloadEnters===artifact?.counts?.reloadEnters,`reload-enter count ${reloadEnters} does not match summary ${artifact?.counts?.reloadEnters}`);
  check(reloadExits===artifact?.counts?.reloadExits,`reload-exit count ${reloadExits} does not match summary ${artifact?.counts?.reloadExits}`);
  check(fireModeChanges===artifact?.counts?.fireModeChanges,`fire-mode change count ${fireModeChanges} does not match summary ${artifact?.counts?.fireModeChanges}`);
  check(continuousChanges===artifact?.counts?.continuousCounterChanges,`continuous change count ${continuousChanges} does not match summary ${artifact?.counts?.continuousCounterChanges}`);
  check(burstChanges===artifact?.counts?.burstRemainingChanges,`burst change count ${burstChanges} does not match summary ${artifact?.counts?.burstRemainingChanges}`);
  results.push({replayName,runId:manifest?.runId??null,players:playerRows.length,playersWithDirectState:observedPlayers.length,playersWithoutDirectState:playerRows.filter(p=>p.observations===0).map(p=>({controllerEntityIndex:p.controllerEntityIndex,playerName:p.playerName})),eventRows:lines,deletions,reloadEnters,reloadExits,fireModeChanges,continuousCounterChanges:continuousChanges,burstRemainingChanges:burstChanges,pass:errors.length===0,errors});
  console.log(JSON.stringify(results.at(-1)));
}

const totals=results.reduce((a,r)=>({players:a.players+r.players,eventRows:a.eventRows+r.eventRows,reloadEnters:a.reloadEnters+r.reloadEnters,reloadExits:a.reloadExits+r.reloadExits,fireModeChanges:a.fireModeChanges+r.fireModeChanges,continuousCounterChanges:a.continuousCounterChanges+r.continuousCounterChanges,burstRemainingChanges:a.burstRemainingChanges+r.burstRemainingChanges}),{players:0,eventRows:0,reloadEnters:0,reloadExits:0,fireModeChanges:0,continuousCounterChanges:0,burstRemainingChanges:0});
const report={version:'PRIMARY_WEAPON_DIRECT_STATE_PROMOTION_VALIDATION_V01',generatedAt:new Date().toISOString(),status:results.every(r=>r.pass)?'READY_FOR_SCOPED_A_AUTHORITY':'FAILED',semanticScope:{supported:['Direct player-linked PrimaryWeapon m_bInReload state and observed transitions','Direct raw numeric m_eActiveFireMode values','Direct raw m_nNumContinuousShots and m_nBurstShotsRemaining values'],excluded:['Current-ammo correctness','Reload cause or efficiency','Trigger intent','Named fire-mode semantics','Burst design','Projectile behavior','Damage or effective weapon composition']},replays:results,totals,pass:results.every(r=>r.pass)};
await fs.mkdir('output/cross_replay',{recursive:true});
await fs.writeFile('output/cross_replay/primary_weapon_direct_state_promotion_validation_v01.json',JSON.stringify(report,null,2)+'\n');
if(!report.pass)process.exitCode=1;

async function readJson(path){return JSON.parse(await fs.readFile(path,'utf8'));}
