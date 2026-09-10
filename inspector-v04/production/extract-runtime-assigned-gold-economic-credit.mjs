import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { EntityOperation, InterceptorStage, Logger, Parser, ParserConfiguration } from 'deadem';
import { requireClaim } from '../../src/contracts/claim-registry.mjs';
import { buildAssignedGoldEconomicCreditSummary, DEFAULT_ISOLATION_RADIUS_TICKS, resolveAssignedGoldEconomicCredit } from '../lib/runtime-assigned-gold-economic-credit.mjs';

const VERSION='RUNTIME_ASSIGNED_GOLD_ECONOMIC_CREDIT_PRODUCTION_V01';
const STATUS_READY='RUNTIME_ASSIGNED_GOLD_ECONOMIC_CREDIT_PRODUCTION_V01_READY';
const PAWN_CLASS='CCitadelPlayerPawn';
const CURRENCY_FIELD='m_nCurrencies.0000';
const TICKS_PER_SECOND=64;

const replayArgument=process.argv[2];
if(!replayArgument)throw new Error('Usage: node inspector-v04/production/extract-runtime-assigned-gold-economic-credit.mjs <replay.dem>');
const replayPath=resolve(replayArgument);
const replayName=basename(replayPath,extname(replayPath));
const dir=resolve('output',replayName);
const playerStatePath=resolve(dir,'player_state.jsonl');
const playerSummaryPath=resolve(dir,'player_state_summary.json');
const lifecyclePath=resolve(dir,'runtime_ground_soul_lifecycle_events_v01.jsonl');
const lifecycleSummaryPath=resolve(dir,'runtime_ground_soul_lifecycle_production_v01.json');
const outputPath=resolve(dir,'runtime_assigned_gold_economic_credit_production_v01.json');
const eventsPath=resolve(dir,'runtime_assigned_gold_economic_credit_events_v01.jsonl');
for(const path of [replayPath,playerStatePath,playerSummaryPath,lifecyclePath,lifecycleSummaryPath])if(!existsSync(path))throw new Error(`Required input missing: ${path}`);

const claim=requireClaim('assigned_gold_economic_recipient_set',{requireSemantic:true,requireReplication:true});
const groundClaim=requireClaim('ground_soul_lifecycle',{requireSemantic:true,requireReplication:true});
const lifecycleArtifact=JSON.parse(readFileSync(lifecycleSummaryPath,'utf8'));
if(lifecycleArtifact?.status!=='RUNTIME_GROUND_SOUL_LIFECYCLE_PRODUCTION_V01_READY')throw new Error('Ground Soul lifecycle production artifact is not READY.');
const playerSummary=JSON.parse(readFileSync(playerSummaryPath,'utf8'));
const matchClockOffsetSeconds=finite(playerSummary?.matchClockOffsetSeconds)??0;
const finalMatchTimeSeconds=finite(playerSummary?.finalMatchTimeSeconds);
const sufficientlyLongReplay=(finalMatchTimeSeconds??0)>=300;
const identities=await loadPlayerIdentities(playerStatePath);
const episodes=await readJsonl(lifecyclePath);

console.log('');
console.log('====================================================');
console.log('RUNTIME ASSIGNEDGOLD ECONOMIC CREDIT - PRODUCTION V01');
console.log('====================================================');
console.log(`Replay: ${replayName}`);
console.log(`Authority claim: ${claim.claimId}`);
console.log(`Isolation: +/-${DEFAULT_ISOLATION_RADIUS_TICKS} ticks; exact active-false tick only`);

const parser=new Parser(new ParserConfiguration({entityClasses:[PAWN_CLASS]}),Logger.CONSOLE_INFO);
const previousCurrencyByPawn=new Map();
const currencyDeltas=[];
const observedPawnEntities=new Set();
const identityLinkedPawnEntities=new Set();
let replayEndTick=0;

parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET,(demoPacket)=>{if(Number.isFinite(demoPacket?.tick))replayEndTick=Math.max(replayEndTick,demoPacket.tick);});
parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET,(demoPacket,messagePacket,entityEvents)=>{
  const tick=Number.isFinite(demoPacket?.tick)?demoPacket.tick:null;if(Number.isFinite(tick))replayEndTick=Math.max(replayEndTick,tick);
  for(const event of entityEvents){
    const entity=event.entity;if(!entity||String(entity?.class?.name??'')!==PAWN_CLASS)continue;
    if(event.operation!==EntityOperation.CREATE&&event.operation!==EntityOperation.UPDATE)continue;
    const pawnEntityIndex=integer(entity.index);if(pawnEntityIndex===null)continue;observedPawnEntities.add(pawnEntityIndex);
    const identity=identities.get(pawnEntityIndex)??null;if(identity)identityLinkedPawnEntities.add(pawnEntityIndex);
    const current=finite(entity.getField(CURRENCY_FIELD));if(current===null)continue;
    const previous=previousCurrencyByPawn.get(pawnEntityIndex);previousCurrencyByPawn.set(pawnEntityIndex,current);
    if(previous===undefined||!(current>previous))continue;
    const team=integer(identity?.team)??integer(entity.getField('m_iTeamNum'));
    currencyDeltas.push({
      schemaVersion:'runtime_currency0_delta_v01',tick,demoSeconds:finite(tick)===null?null:tick/TICKS_PER_SECOND,matchTimeSeconds:finite(tick)===null?null:tick/TICKS_PER_SECOND-matchClockOffsetSeconds,
      pawnEntityIndex,playerName:identity?.playerName??null,steamId:identity?.steamId??null,heroId:integer(identity?.heroId),team,
      previousCurrency0:previous,currentCurrency0:current,delta:current-previous,
    });
  }
});
try{await parser.parse(createReadStream(replayPath));}finally{await parser.dispose();}

const events=episodes.map(ep=>resolveAssignedGoldEconomicCredit(ep,currencyDeltas,episodes,{isolationRadiusTicks:DEFAULT_ISOLATION_RADIUS_TICKS}));
const summary=buildAssignedGoldEconomicCreditSummary(events);
const resolved=events.filter(e=>e.resolved);
const duplicateRecipientRows=[];
for(const e of resolved){const ids=(e.recipients??[]).map(r=>r.pawnEntityIndex);if(new Set(ids).size!==ids.length)duplicateRecipientRows.push(e.activationId);}
const crossTeamRecipientRows=resolved.filter(e=>(e.recipients??[]).some(r=>integer(r.team)!==integer(e.team)));
const wrongTickRows=resolved.filter(e=>(e.recipients??[]).some(r=>integer(r.tick)!==integer(e.resolutionTick)));
const nonCleanRows=resolved.filter(e=>e.integerPartitionClean!==true);
const checks={
  authorityCurrent:check(claim.authorityStatus,'current',claim.authorityStatus==='current'),
  integrityPass:check(claim.integrityValidation,'pass',claim.integrityValidation==='pass'),
  semanticPass:check(claim.semanticValidation,'pass or strong_support',['pass','strong_support'].includes(claim.semanticValidation)),
  independentlyReplicated:check(claim.replicationStatus,'cross/multi replay',['cross_replay_replicated','multi_replay_supported'].includes(String(claim.replicationStatus))),
  groundLifecycleAuthorityReady:check(groundClaim.authorityStatus,'current',groundClaim.authorityStatus==='current'),
  playerIdentityCoverage:check(identities.size,'>0',identities.size>0),
  currencyCarrierObservedWhenEligible:check(currencyDeltas.length,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||currencyDeltas.length>0),
  resolvedCreditObservedWhenEligible:check(summary.resolvedCreditEvents,sufficientlyLongReplay?'>0':'not required before 5:00',!sufficientlyLongReplay||summary.resolvedCreditEvents>0),
  duplicateRecipientsPerResolvedEvent:check(duplicateRecipientRows.length,0,duplicateRecipientRows.length===0),
  crossTeamRecipients:check(crossTeamRecipientRows.length,0,crossTeamRecipientRows.length===0),
  nonExactTickRecipients:check(wrongTickRows.length,0,wrongTickRows.length===0),
  nonPartitionCleanPromotions:check(nonCleanRows.length,0,nonCleanRows.length===0),
};
const failed=Object.entries(checks).filter(([,v])=>!v.pass).map(([k])=>k);if(failed.length)throw new Error(`AssignedGold economic-credit production integrity failed: ${failed.join(', ')}`);

const output={
  version:VERSION,canonical:false,createdAt:new Date().toISOString(),status:STATUS_READY,authorityLayer:'extended',
  replay:{replayName,replayPath,ticksPerSecond:TICKS_PER_SECOND,matchClockOffsetSeconds,replayEndTick,finalMatchTimeSeconds},
  foundation:{claimId:claim.claimId,sourceScripts:claim.sourceScripts??[],currentArtifacts:claim.currentArtifacts??[],replicationStatus:claim.replicationStatus,groundLifecycleClaimId:groundClaim.claimId},
  semanticScope:{
    supported:'High-confidence economic recipient attribution for isolated, physically targeted, completed CCitadel_Pickup_AssignedGold lifecycles. Recipients are same-team player pawns with direct positive m_nCurrencies.0000 transitions on the exact lifecycle termination tick; promoted rows additionally require integer-partition-clean recipient deltas.',
    conservativeFilter:`Another completed AssignedGold termination within +/-${DEFAULT_ISOLATION_RADIUS_TICKS} ticks makes the event unresolved. Targetless, censored, no-delta, and non-partition-clean cases remain unresolved/ineligible rather than being forced into a recipient set.`,
    notClaimed:['Physical vacuum target equals economic recipient','Economic recipient equals last hitter','Economic recipient physically collected the Ground Soul','Every Ground Soul lifecycle has a resolved recipient set','Unresolved means no reward','Observed m_nCurrencies.0000 delta is a canonical Ground Soul reward formula','Exact reward value schedule','Exact share radius','Exact vacuum radius','Melee last-hit semantics','Flying-orb payout or secure/deny semantics']
  },
  counts:{observedPawnEntities:observedPawnEntities.size,identityLinkedPawnEntities:identityLinkedPawnEntities.size,playerIdentities:identities.size,positiveCurrency0Transitions:currencyDeltas.length,groundSoulLifecycleEpisodes:episodes.length},
  summary,
  diagnostics:{currencyField:CURRENCY_FIELD,isolationRadiusTicks:DEFAULT_ISOLATION_RADIUS_TICKS,exactTickOnly:true,rawObservedDeltaTotalsAreDiagnosticOnly:true},
  validation:{pass:true,checks}
};
mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n','utf8');writeFileSync(eventsPath,events.map(x=>JSON.stringify(x)).join('\n')+(events.length?'\n':''),'utf8');
console.log(`Status: ${STATUS_READY}`);
console.log(`Positive currency0 transitions: ${currencyDeltas.length}`);
console.log(`Isolated targeted candidates: ${summary.isolatedTargetedCandidates}`);
console.log(`Resolved economic-credit events: ${summary.resolvedCreditEvents}`);
console.log(`Recipient transitions: ${summary.recipientTransitions}`);
console.log(`Multi-recipient events: ${summary.multiRecipientEvents} (${pct(summary.multiRecipientShare)})`);
console.log(`Unresolved candidates: ${summary.unresolvedCandidateEvents}`);
console.log(`Physical target in resolved recipient set: ${summary.physicalTargetInRecipientSet}/${summary.physicalTargetComparableResolvedEvents} (${pct(summary.physicalTargetInRecipientSetShare)})`);
console.log(`JSON: ${outputPath}`);console.log(`Events: ${eventsPath}`);

async function loadPlayerIdentities(path){
  const map=new Map();const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});let lines=0;
  for await(const line of rl){if(!line.trim())continue;lines++;let row;try{row=JSON.parse(line);}catch{continue;}
    if(row.controller&&typeof row.controller==='object'){
      const pawn=row.pawn??{},controller=row.controller??{};const idx=integer(pawn.entityIndex);if(idx!==null&&!map.has(idx))map.set(idx,{pawnEntityIndex:idx,controllerEntityIndex:integer(controller.entityIndex),playerName:controller.playerName??null,steamId:controller.steamId??null,heroId:integer(controller.heroId),team:integer(controller.team??controller.teamNum)});
    }
    for(const p of row.players??[]){const idx=integer(p.heroEntityIndex??p.pawnEntityIndex);if(idx!==null&&!map.has(idx))map.set(idx,{pawnEntityIndex:idx,controllerEntityIndex:integer(p.controllerEntityIndex),playerName:p.playerName??null,steamId:p.steamId??null,heroId:integer(p.heroId),team:integer(p.team??p.teamNum)});}
    if(map.size>=12||lines>=5000)break;
  }
  return map;
}
async function readJsonl(path){const rows=[];const rl=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of rl){if(!line.trim())continue;try{rows.push(JSON.parse(line));}catch{}}return rows;}
function check(actual,expected,pass){return{actual,expected,pass:Boolean(pass)};}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function integer(v){const n=Number(v);return Number.isInteger(n)?n:null;}
function pct(v){return Number.isFinite(v)?`${(100*v).toFixed(2)}%`:'n/a';}
