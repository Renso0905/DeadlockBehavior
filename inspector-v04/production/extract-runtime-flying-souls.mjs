import{createReadStream,existsSync,mkdirSync,readFileSync,writeFileSync}from'node:fs';
import{basename,dirname,extname,resolve}from'node:path';
import{createInterface}from'node:readline';
import{EntityOperation,InterceptorStage,Logger,Parser,ParserConfiguration}from'deadem';
import{requireClaim}from'../../src/contracts/claim-registry.mjs';
import{TROOPER_FLYING_SOUL_SUBCLASS_ID,buildStrictTrooperLinks,isFlyingSoulRelaunch,readEntityWorldPosition,startFlyingSoulEpisode,summarizeFlyingSoulLinks,updateFlyingSoulEpisode}from'../lib/runtime-flying-soul.mjs';

const VERSION='RUNTIME_FLYING_SOUL_PRODUCTION_V01',STATUS='RUNTIME_FLYING_SOUL_PRODUCTION_V01_READY',TICK_RATE=64;
const arg=process.argv[2];if(!arg)throw new Error('Usage: node inspector-v04/production/extract-runtime-flying-souls.mjs <replay.dem>');
const replayPath=resolve(arg),replayName=basename(replayPath,extname(replayPath)),dir=resolve('output',replayName);
const playerSummaryPath=resolve(dir,'player_state_summary.json'),trooperPath=resolve(dir,'runtime_trooper_death_events_v01.jsonl');
const outputPath=resolve(dir,'runtime_flying_soul_production_v01.json'),eventsPath=resolve(dir,'runtime_flying_soul_events_v01.jsonl');
for(const p of[replayPath,playerSummaryPath,trooperPath])if(!existsSync(p))throw new Error(`Required input missing: ${p}`);
const claim=requireClaim('runtime_flying_soul_direct_lifecycle_v01',{requireSemantic:true,requireReplication:true});
const playerSummary=JSON.parse(readFileSync(playerSummaryPath,'utf8')),offset=finite(playerSummary.matchClockOffsetSeconds)??0;
const deaths=await readJsonl(trooperPath),previous=new Map(),open=new Map(),sequence=new Map(),episodes=[];
let candidateEntityEvents=0,replayEndTick=0;
const parser=new Parser(new ParserConfiguration({entityClasses:['CItemXP']}),Logger.CONSOLE_INFO);
parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET,p=>{if(Number.isFinite(p?.tick))replayEndTick=Math.max(replayEndTick,p.tick);});
parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET,(packet,_message,rows)=>{const tick=finite(packet?.tick);if(tick===null)return;replayEndTick=Math.max(replayEndTick,tick);
  for(const row of rows){const entity=row.entity;if(!entity||String(entity?.class?.name??'')!=='CItemXP')continue;candidateEntityEvents++;
    const index=finite(entity.index);if(index===null)continue;
    if(row.operation===EntityOperation.DELETE){const ep=open.get(index);if(ep){ep.endTick=tick;ep.endReason='ENTITY_DELETE';episodes.push(ep);open.delete(index);}previous.delete(index);continue;}
    if(row.operation!==EntityOperation.CREATE&&row.operation!==EntityOperation.UPDATE)continue;
    const current={tick,entityIndex:index,subclassId:String(safeField(entity,'m_nSubclassID')??'UNKNOWN'),team:finite(safeField(entity,'m_iTeamNum')),position:readEntityWorldPosition(entity),launchNum:finite(safeField(entity,'m_nLaunchNum')),timeLaunch:finite(safeField(entity,'m_timeLaunch')),attackableTime:finite(safeField(entity,'m_flAttackableTime')),endAttackableTime:finite(safeField(entity,'m_flEndAttackableTime'))};
    const prior=previous.get(index)??null,active=open.get(index)??null;
    if(active&&isFlyingSoulRelaunch(prior,current,active)){active.endTick=tick-1;active.endReason='ENTITY_RELAUNCH_OR_REUSE';episodes.push(active);open.delete(index);}
    let ep=open.get(index);if(!ep){const n=(sequence.get(index)??0)+1;sequence.set(index,n);ep=startFlyingSoulEpisode(current,n);open.set(index,ep);}updateFlyingSoulEpisode(ep,current);previous.set(index,current);
  }
});
try{await parser.parse(createReadStream(replayPath));}finally{await parser.dispose();}
for(const ep of open.values()){ep.endTick=ep.lastObservedTick;ep.endReason='REPLAY_END_CENSORED';episodes.push(ep);}episodes.sort((a,b)=>a.startTick-b.startTick||a.entityIndex-b.entityIndex||a.sequence-b.sequence);
const linkResult=buildStrictTrooperLinks(deaths,episodes),events=linkResult.strictLinks.map((link,i)=>{const e=link.episode;const attackableWindowSeconds=finite(e.endAttackableTime)!==null&&finite(e.attackableTime)!==null?finite(e.endAttackableTime)-finite(e.attackableTime):null;return{...e,schemaVersion:'runtime_flying_soul_event_v01',replay:replayName,eventIndex:i,matchStartTimeSeconds:e.startTick/TICK_RATE-offset,attackableWindowSeconds,sourceLink:{method:'MUTUALLY_UNIQUE_SAME_TEAM_TICK_AND_DISTANCE',deathEntityIndex:link.deathEntityIndex,deathTick:link.deathTick,tickDelta:link.tickDelta,distance3D:link.distance3D},semanticStatus:'OBSERVED_SOURCE_LINKED_TROOPER_CITEMXP_EPISODE'};});
const summary=summarizeFlyingSoulLinks(events),duplicateIds=events.length-new Set(events.map(e=>e.episodeId)).size;
const sufficientlyLong=(finite(playerSummary.finalMatchTimeSeconds)??0)>=300;
const checks={claimCurrent:check(claim.authorityStatus,'current',claim.authorityStatus==='current'),semanticPass:check(claim.semanticValidation,'pass',claim.semanticValidation==='pass'),replicated:check(claim.replicationStatus,'cross_replay_replicated',claim.replicationStatus==='cross_replay_replicated'),episodesObservedWhenEligible:check(events.length,sufficientlyLong?'>0':'not required before 5:00',!sufficientlyLong||events.length>0),uniqueEpisodeIds:check(duplicateIds,0,duplicateIds===0),allSubclassDirect:check(events.filter(e=>e.subclassId!==TROOPER_FLYING_SOUL_SUBCLASS_ID).length,0,events.every(e=>e.subclassId===TROOPER_FLYING_SOUL_SUBCLASS_ID)),allLinksInsideEnvelope:check(events.filter(e=>e.sourceLink.tickDelta< -1||e.sourceLink.tickDelta>4||e.sourceLink.distance3D>250).length,0,events.every(e=>e.sourceLink.tickDelta>=-1&&e.sourceLink.tickDelta<=4&&e.sourceLink.distance3D<=250)),completeAttackableWindows:check(summary.missingAttackableWindows,0,summary.missingAttackableWindows===0),nonnegativeAttackableWindows:check(events.filter(e=>!(e.attackableWindowSeconds>=0)).length,0,events.every(e=>e.attackableWindowSeconds>=0))};
const failed=Object.entries(checks).filter(([,v])=>!v.pass).map(([k])=>k);if(failed.length)throw new Error(`Flying-soul production integrity failed: ${failed.join(', ')}`);
const output={version:VERSION,canonical:false,createdAt:new Date().toISOString(),status:STATUS,authorityLayer:'extended',replay:{replayName,replayPath,ticksPerSecond:TICK_RATE,matchClockOffsetSeconds:offset,replayEndTick,finalMatchTimeSeconds:finite(playerSummary.finalMatchTimeSeconds)},foundation:{claimId:claim.claimId,replicationStatus:claim.replicationStatus},semanticScope:{supported:`Observed CItemXP subclass ${TROOPER_FLYING_SOUL_SUBCLASS_ID} episodes connected to the validated raw economic-Trooper subclass set only when the same-team tick/distance candidate is mutually unique, plus direct m_flAttackableTime and m_flEndAttackableTime windows.`,notClaimed:['Every Trooper death produces a flying soul','Human-readable Trooper type or variant names','Unlinked CItemXP meaning','Shooter identity','Secure or deny outcome','Reward recipient or value','Automatic awards','Projectile causality','Continuous visibility or player opportunity']},counts:{candidateEntityEvents,allCitemxpEpisodes:episodes.length,...linkResult,strictLinks:events.length},summary,validation:{pass:true,checks}};
delete output.counts.strictLinks;output.counts.strictLinks=events.length;
mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n');writeFileSync(eventsPath,events.map(x=>JSON.stringify(x)).join('\n')+(events.length?'\n':''));
console.log(`Status: ${STATUS}`);console.log(`Source-linked episodes: ${events.length}`);console.log(`Attackable windows: ${summary.attackableWindows}/${events.length}`);console.log(`JSON: ${outputPath}`);

function safeField(entity,name){try{return entity.getField(name);}catch{return undefined;}}
function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function check(actual,expected,pass){return{actual,expected,pass:Boolean(pass)};}
async function readJsonl(path){const out=[];const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of rl)if(line.trim())out.push(JSON.parse(line));return out;}
