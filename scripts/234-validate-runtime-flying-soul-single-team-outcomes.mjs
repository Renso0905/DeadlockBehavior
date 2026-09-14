import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { publishedDirectory } from '../inspector-v04/lib/run-integrity.mjs';

const requested=process.argv.slice(2).filter(value=>!value.startsWith('--'));
const names=requested.length?requested:(await fs.readdir('replays')).filter(value=>value.toLowerCase().endsWith('.dem')).map(value=>value.slice(0,-4)).sort();
const results=[];

for(const replayName of names){
  const replayDir=resolve('output',replayName);
  const manifest=await readJson(join(replayDir,'production_manifest_v01.json'));
  const productionDir=publishedDirectory(replayDir,manifest);
  const artifact=await readJson(join(productionDir,'runtime_flying_soul_production_v01.json'));
  const events=await readJsonl(join(productionDir,'runtime_flying_soul_events_v01.jsonl'));
  const errors=[];const check=(pass,message)=>{if(!pass)errors.push(message);};
  const playerTotals=new Map();let resolved=0,secure=0,deny=0,mixed=0,noDamage=0;

  check(manifest?.runStatus==='COMPLETE','published manifest is not COMPLETE');
  check(manifest?.coverage?.completeAuthoritative===124,`manifest A coverage is ${manifest?.coverage?.completeAuthoritative??'missing'}, expected 124`);
  check(artifact?.status==='RUNTIME_FLYING_SOUL_PRODUCTION_V01_READY','flying-soul artifact is not READY');
  check(artifact?.validation?.pass===true,'flying-soul artifact validation did not pass');

  const eventById=new Map(events.map(event=>[event.episodeId,event]));
  for(const event of events){
    const messages=(event.playerDamageMessages??[]).slice().sort((a,b)=>Number(a.tick)-Number(b.tick)||Number(a.sequence??0)-Number(b.sequence??0));
    const teams=new Set(messages.map(message=>Number(message?.attackerPlayer?.team)));
    const first=messages[0]??null;
    const expected=teams.size===1&&first&&[2,3].includes(Number(event.team))?(Number(first.attackerPlayer.team)===Number(event.team)?'DENY':'SECURE'):null;
    const outcome=event.singleTeamOutcome??{};
    check((outcome.outcome??null)===expected,`outcome mismatch at ${event.episodeId}: ${outcome.outcome??'null'} vs ${expected??'null'}`);
    if(expected){
      resolved++;if(expected==='SECURE')secure++;else deny++;
      check(outcome.status==='RESOLVED_SINGLE_OBSERVED_TEAM_FIRST_HIT',`resolved status mismatch at ${event.episodeId}`);
      check(outcome.confidence==='HIGH',`resolved confidence mismatch at ${event.episodeId}`);
      check(Number(outcome.firstHit?.tick)===Number(first.tick)&&Number(outcome.firstHit?.attackerIndex)===Number(first.attackerIndex),`first-hit identity mismatch at ${event.episodeId}`);
      check(Number(outcome.observedAttackerTeam)===Number(first.attackerPlayer.team)&&Number(outcome.orbTeam)===Number(event.team),`team context mismatch at ${event.episodeId}`);
      const playerId=first.attackerPlayer.playerId;if(!playerTotals.has(playerId))playerTotals.set(playerId,{secureEpisodes:0,denyEpisodes:0});playerTotals.get(playerId)[expected==='SECURE'?'secureEpisodes':'denyEpisodes']++;
    }else if(teams.size>1){mixed++;check(outcome.status==='MIXED_TEAM_PROVISIONAL',`mixed-team episode was not provisional at ${event.episodeId}`);check(outcome.outcome==null,`mixed-team episode received an outcome at ${event.episodeId}`);}
    else if(!first){noDamage++;check(outcome.status==='NO_PLAYER_DAMAGE_OBSERVED',`no-damage episode status mismatch at ${event.episodeId}`);check(outcome.outcome==null,`no-damage episode received an outcome at ${event.episodeId}`);}
  }

  const summary=artifact?.summary?.damageObservation??{},outcomeSummary=summary.singleTeamOutcome??{};
  check(Number(outcomeSummary.resolvedEpisodes)===resolved,'resolved episode summary does not reconcile');
  check(Number(outcomeSummary.secureEpisodes)===secure,'secure episode summary does not reconcile');
  check(Number(outcomeSummary.denyEpisodes)===deny,'deny episode summary does not reconcile');
  check(Number(outcomeSummary.mixedTeamProvisionalEpisodes)===mixed,'mixed-team episode summary does not reconcile');
  check(Number(outcomeSummary.noPlayerDamageObservedEpisodes)===noDamage,'no-damage episode summary does not reconcile');
  check(resolved===secure+deny,'resolved episodes do not partition into secure and deny');
  for(const row of summary.byPlayer??[]){const actual=playerTotals.get(row.playerId)??{secureEpisodes:0,denyEpisodes:0};check(Number(row.secureEpisodes)===actual.secureEpisodes,`player secure count mismatch for ${row.playerId}`);check(Number(row.denyEpisodes)===actual.denyEpisodes,`player deny count mismatch for ${row.playerId}`);}

  const researchPath=join(replayDir,'flying_soul_temporal_hits_v02.jsonl');
  let establishedHits=0,establishedHitsReproduced=0,establishedRelationsValidated=0;
  if(await exists(researchPath))for(const row of (await readJsonl(researchPath)).filter(row=>row.insideAttackableWindow===true)){
    establishedHits++;
    const event=eventById.get(row.orbEpisodeId),message=(event?.playerDamageMessages??[]).find(message=>Number(message.tick)===Number(row.tick)&&Number(message.victimIndex)===Number(row.victimEntityIndex)&&Number(message.attackerIndex)===Number(row.attackerEntityIndex));
    if(message)establishedHitsReproduced++;
    check(Boolean(message),`established hit was not reproduced at ${row.orbEpisodeId}:${row.tick}:${row.attackerEntityIndex}`);
    const expectedRelation=Number(row.attackerTeam)===Number(row.orbTeam)?'DENY_HIT':'SECURE_HIT';
    if(row.relation===expectedRelation&&message&&Number(message.attackerPlayer?.team)===Number(row.attackerTeam))establishedRelationsValidated++;
    else check(false,`established relation/team mismatch at ${row.orbEpisodeId}:${row.tick}`);
  }

  const result={replayName,runId:manifest?.runId??null,episodes:events.length,resolvedSingleTeamEpisodes:resolved,secureEpisodes:secure,denyEpisodes:deny,mixedTeamProvisionalEpisodes:mixed,noPlayerDamageObservedEpisodes:noDamage,establishedHits,establishedHitsReproduced,establishedRelationsValidated,pass:errors.length===0,errors};
  results.push(result);console.log(JSON.stringify(result));
}

const sum=key=>results.reduce((total,row)=>total+Number(row[key]??0),0);
const totals={replays:results.length,replaysWithResolvedOutcomes:results.filter(row=>row.resolvedSingleTeamEpisodes>0).length,replaysWithSecure:results.filter(row=>row.secureEpisodes>0).length,replaysWithDeny:results.filter(row=>row.denyEpisodes>0).length,episodes:sum('episodes'),resolvedSingleTeamEpisodes:sum('resolvedSingleTeamEpisodes'),secureEpisodes:sum('secureEpisodes'),denyEpisodes:sum('denyEpisodes'),mixedTeamProvisionalEpisodes:sum('mixedTeamProvisionalEpisodes'),noPlayerDamageObservedEpisodes:sum('noPlayerDamageObservedEpisodes'),establishedHits:sum('establishedHits'),establishedHitsReproduced:sum('establishedHitsReproduced'),establishedRelationsValidated:sum('establishedRelationsValidated')};
const pass=results.length>=6&&results.every(row=>row.pass)&&totals.replaysWithResolvedOutcomes>=6&&totals.replaysWithSecure>=3&&totals.replaysWithDeny>=3&&totals.establishedHitsReproduced===totals.establishedHits&&totals.establishedRelationsValidated===totals.establishedHits;
const report={version:'RUNTIME_FLYING_SOUL_SINGLE_TEAM_OUTCOME_VALIDATION_V01',generatedAt:new Date().toISOString(),status:pass?'READY_FOR_SCOPED_A_AUTHORITY':'FAILED',semanticScope:{supported:['SECURE when exactly one observed attacker team differs from the source-linked orb team','DENY when exactly one observed attacker team equals the source-linked orb team','Selected-player credit assigned to the first observed damage message by replay tick and message sequence'],excluded:['Mixed-team race winner or hidden server priority','Episodes without observed player damage','Reward ownership or value, automatic awards, projectile causality, visibility, misses, or opportunity']},replays:results,totals,pass};
await fs.mkdir('output/cross_replay',{recursive:true});await fs.writeFile('output/cross_replay/runtime_flying_soul_single_team_outcome_validation_v01.json',`${JSON.stringify(report,null,2)}\n`);if(!pass)process.exitCode=1;

async function exists(path){try{await fs.access(path);return true;}catch{return false;}}
async function readJson(path){return JSON.parse(await fs.readFile(path,'utf8'));}
async function readJsonl(path){const rows=[];const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of rl)if(line.trim())rows.push(JSON.parse(line));return rows;}
