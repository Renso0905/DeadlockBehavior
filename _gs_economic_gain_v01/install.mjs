import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=process.argv[2];
if(!repoRoot)throw new Error('Usage: node install.mjs <RepoRoot>');
const patchRoot=dirname(fileURLToPath(import.meta.url));
const payloadRoot=join(patchRoot,'payload');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\..+$/,'');
const backupRoot=join(repoRoot,'patch-backups',`ground-soul-economic-gain-ui-v01-${stamp}`);

const required=[
  'inspector-v04/lib/runtime-assigned-gold-economic-credit.mjs',
  'inspector-v04/tests/runtime-assigned-gold-economic-credit.test.mjs',
  'inspector-v04/lib/production-capabilities.mjs',
  'inspector-v04/lib/metric-registry.mjs',
  'inspector-v04/public/app.js',
  'inspector-v04/public/authoritative.js',
  'inspector-v04/tests/authoritative-stats.test.mjs',
  'inspector-v04/tests/production-pipeline.test.mjs',
];
const payloadFiles=[
  'inspector-v04/lib/runtime-assigned-gold-economic-credit.mjs',
  'inspector-v04/tests/runtime-assigned-gold-economic-credit.test.mjs',
];
for(const rel of required){if(!existsSync(join(repoRoot,rel)))throw new Error(`Required current file missing: ${rel}`);}
for(const rel of payloadFiles){if(!existsSync(join(payloadRoot,rel)))throw new Error(`Payload missing: ${rel}`);}
const cap0=await readFile(join(repoRoot,'inspector-v04/lib/production-capabilities.mjs'),'utf8');
if(!cap0.includes("capability('runtime_assigned_gold_economic_credit'"))throw new Error('Prerequisite missing: Ground Soul Economic Credit Extended A V01 must be installed first.');
const app0=await readFile(join(repoRoot,'inspector-v04/public/app.js'),'utf8');
if(!app0.includes("section('Ground Soul economic credit'"))throw new Error('Prerequisite missing: economic-credit visualizer integration not found.');

const originals=new Map();
for(const rel of required){const present=existsSync(join(repoRoot,rel));originals.set(rel,present);if(present)await backupIfPresent(rel);}

try{
  for(const rel of payloadFiles){const src=join(payloadRoot,rel),dst=join(repoRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);console.log(`Installed: ${rel}`);}
  await patchCapabilities();
  await patchMetricRegistry();
  await patchApp();
  await patchAuthoritative();
  await patchAuthoritativeTests();
  await patchPipelineTests();
  await verify();
}catch(error){
  console.error('');console.error(`INSTALLATION FAILED: ${error?.message??error}`);console.error('Restoring pre-install files from backup...');
  await rollback();console.error(`Rollback complete. Backup retained at: ${backupRoot}`);throw error;
}

console.log('');
console.log('GROUND SOUL ECONOMIC GAIN + EVIDENCE UX V01 INSTALLED');
console.log(`Backup: ${backupRoot}`);
console.log('Authority ledger target: Core A 68/68 | Extended A 9/9 | Total A 77/77');
console.log('Next: run the full Node test suite, then rerun production for 104373259 so the per-player cumulative timeline is regenerated.');

async function backupIfPresent(rel){const src=join(repoRoot,rel);if(!existsSync(src))return;const dst=join(backupRoot,rel);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);}
async function rollback(){for(const [rel,present] of originals){const dst=join(repoRoot,rel),bak=join(backupRoot,rel);if(present&&existsSync(bak)){await mkdir(dirname(dst),{recursive:true});await copyFile(bak,dst);}else if(!present&&existsSync(dst)){await rm(dst,{force:true});}}}
async function rw(rel,fn){const p=join(repoRoot,rel);const before=await readFile(p,'utf8');const after=await fn(before);if(typeof after!=='string')throw new Error(`Patch function did not return text: ${rel}`);if(after!==before){await writeFile(p,after,'utf8');console.log(`Patched: ${rel}`);}else console.log(`Already applied: ${rel}`);}

async function patchCapabilities(){await rw('inspector-v04/lib/production-capabilities.mjs',t=>{
  const old="'ground_soul_economic_credit_events','ground_soul_economic_recipient_transitions','ground_soul_multi_recipient_share'";
  const neu="'ground_soul_economic_credit_events','ground_soul_economic_recipient_transitions','ground_soul_multi_recipient_share','ground_soul_economic_gain'";
  if(!t.includes("'ground_soul_economic_gain'")){
    if(!t.includes(old))throw new Error('Economic-credit capability metric-list marker missing.');t=t.replace(old,neu);
  }
  if(!t.includes('The economic-gain metric is the cumulative selected-player sum')){
    const oldSem="m_hVacuumTarget remains physical attraction telemetry and is not used as economic-recipient identity.'";
    const newSem="m_hVacuumTarget remains physical attraction telemetry and is not used as economic-recipient identity. The economic-gain metric is the cumulative selected-player sum of observed recipient m_nCurrencies.0000 deltas from resolved events only; unresolved events are excluded.'";
    if(!t.includes(oldSem))throw new Error('Economic-credit semantic-validation marker missing.');t=t.replace(oldSem,newSem);
  }
  return t;
});}

async function patchMetricRegistry(){await rw('inspector-v04/lib/metric-registry.mjs',t=>{
  if(t.includes("m('ground_soul_economic_gain'"))return t;
  const re=/(^\s*)m\('ground_soul_multi_recipient_share'[^\n]*\),\r?\n/m;const m=t.match(re);if(!m)throw new Error('Multi-recipient metric marker missing.');
  const line=`${m[1]}m('ground_soul_economic_gain','Total Ground Soul Economic Gain',A,'number','runtime_assigned_gold_economic_credit_events','Cumulative selected-player sum of observed positive m_nCurrencies.0000 deltas across resolved Ground Soul economic-credit events up to the selected match time; unresolved events are excluded.'),\n`;
  return t.replace(re,m[0]+line);
});}

async function patchApp(){await rw('inspector-v04/public/app.js',t=>{
  if(!t.includes('function groundSoulEconomicGainAtTime(')){
    const marker='function metricCard(id,value,evidence,sub=\'\')';const i=t.indexOf(marker);if(i<0)throw new Error('metricCard insertion marker missing.');
    const helper=`function groundSoulEconomicGainAtTime(summary,p,time){const rows=summary?.byPlayer??[];const steam=String(p?.identity?.steamId??'');const name=String(p?.playerName??'');const row=rows.find(x=>steam&&String(x.steamId??'')===steam)??rows.find(x=>String(x.playerName??'')===name);const timeline=row?.cumulativeTimeline??[];let gain=0,creditEvents=0;for(const x of timeline){if(Number(x.matchTime)<=Number(time)){gain=Number(x.cumulativeCurrency0Delta)||0;creditEvents=Number(x.creditEvents)||0;}else break;}return {gain,creditEvents,fullMatch:Number(row?.observedCurrency0DeltaTotal)||0};}\n`;
    t=t.slice(0,i)+helper+t.slice(i);
  }
  if(!t.includes("metricCard('ground_soul_economic_gain'")){
    const marker="${metricCard('ground_soul_multi_recipient_share',pct(ge.summary?.multiRecipientShare),'groundSoulEconomicCredit',`${ge.summary?.multiRecipientEvents??'—'} of ${ge.summary?.resolvedCreditEvents??'—'} resolved events`)}";
    if(!t.includes(marker))throw new Error('Ground Soul economic-credit card marker missing.');
    const card="${metricCard('ground_soul_economic_gain',num(groundSoulEconomicGainAtTime(ge.summary,p,state.time).gain),'groundSoulEconomicCredit',`${groundSoulEconomicGainAtTime(ge.summary,p,state.time).creditEvents} resolved credit events through ${clock(state.time)} · full match ${num(groundSoulEconomicGainAtTime(ge.summary,p,state.time).fullMatch)}`)}";
    t=t.replace(marker,marker+card);
  }
  const oldJson="function jsonRow(r,n){const summary=eventSummary(r);return `<details class=\"json-row\"><summary><span class=\"muted mono\">#${n}</span> ${esc(summary)}</summary><pre>${esc(JSON.stringify(r,null,2))}</pre></details>`;}";
  if(!t.includes('function economicCreditEventDetail(')){
    if(!t.includes(oldJson))throw new Error('jsonRow marker missing.');
    const newJson="function jsonRow(r,n){const summary=eventSummary(r),detail=economicCreditEventDetail(r);return `<details class=\"json-row\"><summary><span class=\"muted mono\">#${n}</span> ${esc(summary)}</summary>${detail}<pre>${esc(JSON.stringify(r,null,2))}</pre></details>`;}\nfunction economicCreditEventDetail(r){if(r?.schemaVersion!=='runtime_assigned_gold_economic_credit_event_v01')return '';const recipients=r.recipients??[];const recipientRows=recipients.length?recipients.map(x=>`<div style=\"display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--border)\"><span>${esc(x.playerName??`Pawn ${x.pawnEntityIndex??'—'}`)}</span><strong>+${num(x.delta)} observed currency0</strong></div>`).join(''):'<div class=\"muted\">No authoritative economic recipients on this row.</div>';return `<div class=\"panel\" style=\"margin:10px 0\"><div class=\"eyebrow\">Resolved economic credit</div><div style=\"margin-top:6px\">${recipientRows}</div><div style=\"display:flex;justify-content:space-between;gap:12px;padding-top:8px\"><span>Total observed same-team credit</span><strong>${r.observedTeamCurrency0Delta==null?'—':`+${num(r.observedTeamCurrency0Delta)}`}</strong></div><div class=\"metric-sub\" style=\"margin-top:8px\">Resolution: ${r.resolutionMatchTimeSeconds==null?'—':clock(Number(r.resolutionMatchTimeSeconds))} · tick ${r.resolutionTick??'—'} · physical vacuum target in recipient set: ${r.physicalTargetIsEconomicRecipient==null?'not comparable':r.physicalTargetIsEconomicRecipient?'yes':'no'}</div></div>`;}";
    t=t.replace(oldJson,newJson);
  }
  const oldSummary="function eventSummary(r){const time=r.matchTimeSeconds??r.timeSeconds??r.time??r.demoSeconds;const event=r.eventType??r.action?.actionType??r.classification?.status??r.outcomeLabel??r.baseType??r.type??'event';return `${time!=null?clock(Number(time))+' · ':''}${event}`;}";
  const newSummary="function eventSummary(r){const time=r.resolutionMatchTimeSeconds??r.matchTimeSeconds??r.timeSeconds??r.time??r.demoSeconds;if(r?.schemaVersion==='runtime_assigned_gold_economic_credit_event_v01'){const tick=r.resolutionTick??'—';if(r.resolved){const count=Number(r.recipientCount)||0,total=r.observedTeamCurrency0Delta;return `${time!=null?clock(Number(time))+' · ':''}tick ${tick} · ${count} recipient${count===1?'':'s'} · ${total==null?'—':`+${num(total)}`} observed credit`;}return `${time!=null?clock(Number(time))+' · ':''}tick ${tick} · ${pretty(r.resolutionStatus??'unresolved')}`;}const event=r.eventType??r.action?.actionType??r.classification?.status??r.outcomeLabel??r.baseType??r.type??'event';return `${time!=null?clock(Number(time))+' · ':''}${event}`;}";
  if(t.includes(oldSummary))t=t.replace(oldSummary,newSummary);else if(!t.includes('r.resolutionMatchTimeSeconds??r.matchTimeSeconds'))throw new Error('eventSummary marker missing.');
  return t;
});}

async function patchAuthoritative(){await rw('inspector-v04/public/authoritative.js',t=>{
  const auth=t.match(/const AUTH_IDS=\[(.*?)\];/s);if(!auth)throw new Error('AUTH_IDS contract not found.');let inner=auth[1];
  if(!inner.includes("'ground_soul_economic_gain'")){
    const marker="'ground_soul_multi_recipient_share'";if(!inner.includes(marker))throw new Error('Economic AUTH_IDS marker missing.');inner=inner.replace(marker,marker+",'ground_soul_economic_gain'");t=t.slice(0,auth.index)+`const AUTH_IDS=[${inner}];`+t.slice(auth.index+auth[0].length);
  }
  if(!t.includes('function authGroundSoulEconomicGainAtTime(')){
    const marker='function metricValue(id,{model,p,time,weaponReady})';const i=t.indexOf(marker);if(i<0)throw new Error('metricValue helper insertion marker missing.');
    const helper=`function authGroundSoulEconomicGainAtTime(summary,p,time){const rows=summary?.byPlayer??[];const steam=String(p?.identity?.steamId??'');const name=String(p?.playerName??'');const row=rows.find(x=>steam&&String(x.steamId??'')===steam)??rows.find(x=>String(x.playerName??'')===name);const timeline=row?.cumulativeTimeline??[];let gain=0,creditEvents=0;for(const x of timeline){if(Number(x.matchTime)<=Number(time)){gain=Number(x.cumulativeCurrency0Delta)||0;creditEvents=Number(x.creditEvents)||0;}else break;}return {gain,creditEvents,fullMatch:Number(row?.observedCurrency0DeltaTotal)||0};}\n`;
    t=t.slice(0,i)+helper+t.slice(i);
  }
  if(!t.includes("case 'ground_soul_economic_gain':")){
    const marker="    case 'primary_discharges':";const i=t.indexOf(marker);if(i<0)throw new Error('Primary metric-value switch marker missing.');
    const block="    case 'ground_soul_economic_gain': { const g=authGroundSoulEconomicGainAtTime(model.groundSoulEconomicCredit?.summary,p,time); return v(num(g.gain),`${g.creditEvents} resolved credit events through ${clock(time)} · full-match ${num(g.fullMatch)}`); }\n";
    t=t.slice(0,i)+block+t.slice(i);
  }
  return t;
});}

async function patchAuthoritativeTests(){await rw('inspector-v04/tests/authoritative-stats.test.mjs',t=>{
  t=t.replace(/assert\.equal\(authoritative\.length,\d+,'A-status metric count changed; review the display contract intentionally'\);/,"assert.equal(authoritative.length,77,'A-status metric count changed; review the display contract intentionally');");
  if(!t.includes('authoritative.length,77'))throw new Error('Could not update Authoritative Stats expected A count to 77.');return t;
});}

async function patchPipelineTests(){await rw('inspector-v04/tests/production-pipeline.test.mjs',t=>{
  t=t.replace("['ground_soul_economic_credit_events','ground_soul_economic_recipient_transitions','ground_soul_multi_recipient_share']","['ground_soul_economic_credit_events','ground_soul_economic_recipient_transitions','ground_soul_multi_recipient_share','ground_soul_economic_gain']");
  t=t.replaceAll('extendedA.length,8','extendedA.length,9');
  t=t.replaceAll('supported.flatMap(c=>c.metricIds).length,76','supported.flatMap(c=>c.metricIds).length,77');
  t=t.replaceAll('68/68 Core A plus 8/8 Extended A','68/68 Core A plus 9/9 Extended A');
  t=t.replaceAll('coverage.completeAuthoritative,76','coverage.completeAuthoritative,77');
  t=t.replaceAll('coverage.authoritativeTotal,76','coverage.authoritativeTotal,77');
  t=t.replaceAll('coverage.extended.completeAuthoritative,8','coverage.extended.completeAuthoritative,9');
  t=t.replaceAll('coverage.extended.authoritativeTotal,8','coverage.extended.authoritativeTotal,9');
  if(!t.includes('extendedA.length,9'))throw new Error('Extended A test count was not updated to 9.');
  if(!t.includes('authoritativeTotal,77'))throw new Error('Total A fixture count was not updated to 77.');
  if(!t.includes("'ground_soul_economic_gain'"))throw new Error('Economic-gain capability expectation not updated.');
  return t;
});}

async function verify(){
  const read=rel=>readFile(join(repoRoot,rel),'utf8');
  const [helper,caps,metrics,app,auth,atest,ptest]=await Promise.all([
    read('inspector-v04/lib/runtime-assigned-gold-economic-credit.mjs'),
    read('inspector-v04/lib/production-capabilities.mjs'),
    read('inspector-v04/lib/metric-registry.mjs'),
    read('inspector-v04/public/app.js'),
    read('inspector-v04/public/authoritative.js'),
    read('inspector-v04/tests/authoritative-stats.test.mjs'),
    read('inspector-v04/tests/production-pipeline.test.mjs'),
  ]);
  const checks=[
    [helper.includes('cumulativeCurrency0Delta'),'per-player cumulative economic timeline'],
    [caps.includes("'ground_soul_economic_gain'"),'production capability ownership'],
    [metrics.includes("m('ground_soul_economic_gain'"),'metric registry'],
    [app.includes("metricCard('ground_soul_economic_gain'"),'Troopers & Souls time-slider card'],
    [app.includes('resolutionMatchTimeSeconds??r.matchTimeSeconds'),'evidence timestamp mapping'],
    [app.includes('Total observed same-team credit'),'expanded economic-credit evidence detail'],
    [auth.includes("case 'ground_soul_economic_gain':"),'Authoritative Stats mapping'],
    [atest.includes('authoritative.length,77'),'Authoritative Stats expected count'],
    [ptest.includes('extendedA.length,9'),'pipeline Extended A count'],
    [ptest.includes('authoritativeTotal,77'),'pipeline Total A count'],
  ];
  const failed=checks.filter(([ok])=>!ok).map(([,name])=>name);if(failed.length)throw new Error(`Installation verification failed: ${failed.join(', ')}`);
  const occurrences=(caps.match(/'ground_soul_economic_gain'/g)??[]).length;if(occurrences!==1)throw new Error(`Capability ownership verification failed for ground_soul_economic_gain: expected 1 occurrence, found ${occurrences}.`);
}
