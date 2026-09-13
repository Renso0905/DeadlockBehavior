import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { InterceptorStage, Logger, Parser, ParserConfiguration } from 'deadem';
import { buildHealthRegenPlayerSummary } from '../lib/runtime-health-regen.mjs';

const VERSION='RUNTIME_HEALTH_REGEN_PRODUCTION_V01';
const STATUS_READY='RUNTIME_HEALTH_REGEN_PRODUCTION_V01_READY';
const AUTHORITY_STATUS='INTEGRATED_PLAYER_STATE_AUTHORITY_V01_READY';
const TICKS_PER_SECOND=64;
const SAMPLE_EVERY_TICKS=16;
const replayArgument=process.argv[2];
if(!replayArgument)throw new Error('Usage: node inspector-v04/production/extract-runtime-health-regen.mjs <replay.dem>');
const replayPath=resolve(replayArgument),replayName=basename(replayPath,extname(replayPath));
const playerSummaryPath=resolve('output',replayName,'player_state_summary.json');
const authorityPath=resolve('output','cross_replay','integrated_player_state_authority_v01.json');
const outputPath=resolve('output',replayName,'runtime_health_regen_production_v01.json');
const eventsPath=resolve('output',replayName,'runtime_health_regen_events_v01.jsonl');
for(const p of [replayPath,playerSummaryPath,authorityPath])if(!existsSync(p))throw new Error(`Required input missing: ${p}`);
const playerSummary=JSON.parse(readFileSync(playerSummaryPath,'utf8'));
const authority=JSON.parse(readFileSync(authorityPath,'utf8'));
const matchClockOffsetSeconds=finite(playerSummary?.matchClockOffsetSeconds)??0;
const finalMatchTimeSeconds=finite(playerSummary?.finalMatchTimeSeconds);

console.log('');
console.log('==========================================');
console.log('RUNTIME HEALTH REGEN - PRODUCTION V01');
console.log('==========================================');
console.log(`Replay: ${replayName}`);
console.log(`Authority: ${authorityPath}`);

const config=new ParserConfiguration({entityClasses:['CCitadelPlayerController']});
const parser=new Parser(config,Logger.CONSOLE_INFO);
const byController=new Map();
let lastSampleTick=-1,replayEndTick=0,totalFiniteSamples=0,negativeSamples=0;
parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET,(demoPacket)=>{
  const tick=finite(demoPacket?.tick);if(tick===null||tick<0)return;replayEndTick=Math.max(replayEndTick,tick);
  if(tick===lastSampleTick||tick%SAMPLE_EVERY_TICKS!==0)return;lastSampleTick=tick;
  const demo=parser.getDemo();
  for(const c of demo.getEntitiesByClassName('CCitadelPlayerController')){
    const playerName=c.getField('m_iszPlayerName');if(!playerName||playerName==='SourceTV')continue;
    const value=finite(c.getField('m_flHealthRegen'));if(value===null)continue;
    totalFiniteSamples++;if(value<0)negativeSamples++;
    const controllerEntityIndex=finite(c.index);if(controllerEntityIndex===null)continue;
    let p=byController.get(controllerEntityIndex);
    if(!p){p={identity:{controllerEntityIndex,playerName,steamId:serializable(c.getField('m_steamID')),heroId:finite(c.getField('m_nHeroID')),team:finite(c.getField('m_iTeamNum'))},samples:[]};byController.set(controllerEntityIndex,p);}
    p.identity.playerName=playerName;p.identity.steamId=serializable(c.getField('m_steamID'))??p.identity.steamId;p.identity.heroId=finite(c.getField('m_nHeroID'))??p.identity.heroId;p.identity.team=finite(c.getField('m_iTeamNum'))??p.identity.team;
    const demoSeconds=tick/TICKS_PER_SECOND,matchTimeSeconds=demoSeconds-matchClockOffsetSeconds;
    p.samples.push({tick,demoSeconds,matchTimeSeconds,value});
  }
});
try{await parser.parse(createReadStream(replayPath));}finally{await parser.dispose();}

const players=[...byController.values()].map(p=>buildHealthRegenPlayerSummary(p.identity,p.samples,{matchEndSeconds:finalMatchTimeSeconds}));
const events=[];
for(const p of players)for(const e of p.changeEvents??[])events.push({...e,replay:replayName,controllerEntityIndex:p.controllerEntityIndex,playerName:p.playerName,steamId:p.steamId,heroId:p.heroId,team:p.team,semanticStatus:'DIRECT_OBSERVED_CCITADELPLAYERCONTROLLER_M_FLHEALTHREGEN'});
events.sort((a,b)=>(a.tick??0)-(b.tick??0)||String(a.playerName).localeCompare(String(b.playerName)));
const sufficientlyLongReplay=(finalMatchTimeSeconds??0)>=300;
const playersWithGameplay=players.filter(p=>p.gameplaySampleCount>0).length;
const checks={
  playerStateAuthorityReady:check(authority?.status,AUTHORITY_STATUS,authority?.status===AUTHORITY_STATUS),
  authorityCurrent:check(authority?.claim?.authorityStatus,'current',authority?.claim?.authorityStatus==='current'),
  authorityIntegrityPass:check(authority?.claim?.integrityValidation,'pass',authority?.claim?.integrityValidation==='pass'),
  authoritySemanticPass:check(authority?.claim?.semanticValidation,'pass',authority?.claim?.semanticValidation==='pass'),
  authorityCrossReplayReplicated:check(authority?.claim?.replicationStatus,'cross_replay_replicated',authority?.claim?.replicationStatus==='cross_replay_replicated'),
  playerRosterResolved:check(players.length,sufficientlyLongReplay?'>=10':'not required before 5:00',!sufficientlyLongReplay||players.length>=10),
  healthRegenObserved:check(totalFiniteSamples,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||totalFiniteSamples>0),
  gameplayCoverage:check(playersWithGameplay,sufficientlyLongReplay?'all resolved players':'not required before 5:00',!sufficientlyLongReplay||playersWithGameplay===players.length),
  valuesFiniteAndNonnegative:check(negativeSamples,0,negativeSamples===0)
};
const failed=Object.entries(checks).filter(([,v])=>!v.pass).map(([k])=>k);if(failed.length)throw new Error(`Health-regen production integrity failed: ${failed.join(', ')}`);
const output={
  version:VERSION,canonical:false,createdAt:new Date().toISOString(),status:STATUS_READY,
  replay:{replayName,replayPath,ticksPerSecond:TICKS_PER_SECOND,sampleEveryTicks:SAMPLE_EVERY_TICKS,matchClockOffsetSeconds,replayEndTick,finalMatchTimeSeconds},
  authority:{artifact:authorityPath,status:authority?.status??null,claim:authority?.claim??null},
  semanticScope:{
    supported:'Direct sampled CCitadelPlayerController.m_flHealthRegen runtime values and change boundaries. Gameplay summaries exclude matchTimeSeconds < 0 while raw observations preserve pregame values.',
    notClaimed:['Realized HP restored per second from health deltas','Total healing received','Causal decomposition into hero base, items, world buffs, regeneration zones, or abilities','Reconstructed effective regeneration from loadout','Causal reason for any observed change']
  },
  counts:{players:players.length,totalFiniteSamples,pregameSamples:players.reduce((n,p)=>n+p.pregameSampleCount,0),gameplaySamples:players.reduce((n,p)=>n+p.gameplaySampleCount,0),changeEvents:events.length,negativeSamples},
  players,validation:{pass:true,checks}
};
mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n','utf8');writeFileSync(eventsPath,events.map(e=>JSON.stringify(e)).join('\n')+(events.length?'\n':''),'utf8');
console.log(`Status: ${STATUS_READY}`);console.log(`Players: ${players.length}`);console.log(`Samples: ${totalFiniteSamples} (${output.counts.gameplaySamples} gameplay / ${output.counts.pregameSamples} pregame)`);console.log(`Observed change boundaries: ${events.length}`);console.log(`Negative samples: ${negativeSamples}`);console.log(`JSON: ${outputPath}`);console.log(`Events: ${eventsPath}`);

function check(actual,expected,pass){return{actual,expected,pass:Boolean(pass)}}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function serializable(v){if(v===undefined||v===null)return null;if(['string','number','boolean'].includes(typeof v))return v;try{return JSON.parse(JSON.stringify(v))}catch{return String(v)}}
