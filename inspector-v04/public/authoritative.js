const AUTH_TAB_ID='authoritative-ready';
const AUTH_STYLE_ID='authoritative-ready-style';
let authActive=false;
let authRegistry=null;
let authRenderToken=0;

const AUTH_IDS=[
  'match_clock','match_duration','player_name','steam_id','hero_id','team','controller_entity','pawn_entity','roster','composition',
  'level','level_timing','level_rate','alive_time','dead_time','alive_share','death_count','death_timing','survival_intervals','average_life',
  'respawn_time','respawn_downtime','health','health_max','health_percent','health_minmax','low_health_25','low_health_50','health_regen',
  'gold_networth','ap_networth','networth_rate','networth_checkpoints','networth_rank',
  'team_networth','team_networth_diff','player_team_share','team_ahead_time','team_behind_time','max_team_lead','max_team_deficit','largest_lead_swing',
  'current_items','final_build','item_acquisition_time','item_acquisition_order','item_count','item_ownership_duration','item_removals','checkpoint_builds',
  'permanent_current','permanent_acquisitions','permanent_count','permanent_by_family','permanent_value','permanent_team_diff',
  'bridge_collections','bridge_current','bridge_uptime','bridge_uptime_share','bridge_overlaps','bridge_termination','bridge_team_uptime',
  'trooper_deaths','trooper_death_timing',
  'ground_soul_activations','ground_soul_targeted_activations','ground_soul_lifecycle_duration',
  'ground_soul_economic_credit_events','ground_soul_economic_recipient_transitions','ground_soul_multi_recipient_share','ground_soul_economic_gain',
  'primary_discharges','primary_attack_rate','inter_attack_interval','next_primary_ready','ready_delay'
];

installAuthoritativeStyles();
installAuthoritativeTab();
const tabsEl=document.querySelector('#tabs');
if(tabsEl){
  new MutationObserver(()=>installAuthoritativeTab()).observe(tabsEl,{childList:true});
  tabsEl.addEventListener('click',e=>{
    const b=e.target.closest('button');
    if(!b)return;
    if(b.id!==AUTH_TAB_ID && b.classList.contains('tab')) authActive=false;
  });
}
for(const sel of ['#playerSelect','#timeSlider']){
  document.querySelector(sel)?.addEventListener(sel==='#timeSlider'?'input':'change',()=>queueAuthoritativeRender());
}
document.querySelector('#replaySelect')?.addEventListener('change',()=>queueAuthoritativeRender(50));
document.querySelector('#refreshBtn')?.addEventListener('click',()=>queueAuthoritativeRender(400));
const playerSelect=document.querySelector('#playerSelect');
if(playerSelect)new MutationObserver(()=>queueAuthoritativeRender()).observe(playerSelect,{childList:true});

function installAuthoritativeTab(){
  const tabs=document.querySelector('#tabs'); if(!tabs||document.querySelector(`#${AUTH_TAB_ID}`))return;
  const b=document.createElement('button');
  b.id=AUTH_TAB_ID;b.type='button';b.className='tab';b.textContent='Authoritative Stats';
  b.title='Every A-status metric with an explicit current value';
  b.addEventListener('click',()=>{authActive=true;syncAuthTab();renderAuthoritative();});
  tabs.appendChild(b);
  syncAuthTab();
}
function syncAuthTab(){
  if(!authActive)return;
  document.querySelectorAll('#tabs .tab').forEach(x=>x.classList.toggle('active',x.id===AUTH_TAB_ID));
}
function queueAuthoritativeRender(delay=0){
  if(!authActive)return;
  setTimeout(()=>{if(authActive){syncAuthTab();renderAuthoritative();}},delay);
}

async function renderAuthoritative(){
  const token=++authRenderToken;
  const main=document.querySelector('#main');
  const replay=document.querySelector('#replaySelect')?.value;
  const playerName=document.querySelector('#playerSelect')?.value;
  const time=Number(document.querySelector('#timeSlider')?.value??0);
  if(!main||!replay){
    if(main)main.innerHTML='<div class="loading">Select a replay to inspect authoritative statistics.</div>';
    return;
  }
  main.innerHTML='<div class="loading">Loading authoritative metric values…</div>';
  try{
    const [registryData,model]=await Promise.all([
      authRegistry?Promise.resolve(authRegistry):apiJson('/api/metrics').then(x=>(authRegistry=x)),
      apiJson(`/api/replay/${encodeURIComponent(replay)}/model`)
    ]);
    if(token!==authRenderToken||!authActive)return;
    const p=model.players?.find(x=>String(x.playerName)===String(playerName))??model.players?.[0];
    if(!p){main.innerHTML='<div class="warning-box">No player model is available for this replay.</div>';return;}
    const aSections=(registryData.sections??[]).map(s=>({...s,metrics:(s.metrics??[]).filter(m=>m.status==='A')})).filter(s=>s.metrics.length);
    const aMetrics=aSections.flatMap(s=>s.metrics);
    const unknownRegistry=aMetrics.filter(m=>!AUTH_IDS.includes(m.id));
    const missingContract=AUTH_IDS.filter(id=>!aMetrics.some(m=>m.id===id));
    const weaponReady=await latestNextPrimaryReady(replay,p.playerName,model.match?.matchClockOffsetSeconds??0);
    if(token!==authRenderToken||!authActive)return;
    const ctx={model,p,time,weaponReady};
    const rendered=aSections.map(section=>{
      const rows=section.metrics.map(m=>({metric:m,result:metricValue(m.id,ctx)}));
      return authSection(section,rows);
    }).join('');
    const wired=aMetrics.filter(m=>metricValue(m.id,ctx).wired!==false).length;
    const complete=wired===aMetrics.length && unknownRegistry.length===0 && missingContract.length===0;
    main.innerHTML=`
      <div class="section-head auth-head">
        <div>
          <h2>Authoritative statistics</h2>
          <p>Every current <strong>A-status</strong> metric contract is shown here with a value, source, and definition. Scrub the match clock for time-dependent state.</p>
        </div>
        <div class="auth-coverage ${complete?'complete':'incomplete'}">
          <strong>${wired}/${aMetrics.length}</strong>
          <span>${complete?'A metrics wired':'A metrics wired'}</span>
        </div>
      </div>
      ${unknownRegistry.length?`<div class="warning-box danger-box"><strong>Registry drift:</strong> new A metrics are not mapped: ${escapeHtml(unknownRegistry.map(x=>x.id).join(', '))}</div>`:''}
      ${missingContract.length?`<div class="warning-box"><strong>Display contract drift:</strong> mapped IDs no longer in the A registry: ${escapeHtml(missingContract.join(', '))}</div>`:''}
      <div class="auth-context">
        <span><strong>${escapeHtml(p.playerName)}</strong></span>
        <span>Team ${escapeHtml(p.team??'—')}</span>
        <span>${clock(time,true)}</span>
        <span>${model.replayName?`Replay ${escapeHtml(model.replayName)}`:''}</span>
      </div>
      ${rendered}
      <div class="section">
        <div class="warning-box"><strong>Contract rule:</strong> this page intentionally contains only A-status metrics. B-status, experimental, and unresolved measures stay in their existing research/verification surfaces rather than being promoted here.</div>
      </div>`;
  }catch(err){
    if(token!==authRenderToken)return;
    main.innerHTML=`<div class="warning-box danger-box"><strong>Authoritative stats failed to load.</strong><br>${escapeHtml(err.message)}</div>`;
  }
}

function authSection(section,rows){
  return `<section class="section auth-section">
    <div class="section-head"><div><h2>${escapeHtml(section.label)}</h2><p>${rows.length} authoritative metric${rows.length===1?'':'s'}</p></div></div>
    <div class="auth-grid">${rows.map(({metric,result})=>authCard(metric,result)).join('')}</div>
  </section>`;
}
function authCard(metric,result){
  const unwired=result?.wired===false;
  return `<article class="auth-card ${unwired?'unwired':''}">
    <div class="auth-card-top"><span class="badge a">A</span><span class="auth-unit">${escapeHtml(metric.unit??'')}</span></div>
    <h3>${escapeHtml(metric.label)}</h3>
    <div class="auth-value">${unwired?'NOT WIRED':escapeHtml(result?.value??'—')}</div>
    ${result?.detail?`<div class="auth-detail">${escapeHtml(result.detail)}</div>`:''}
    <div class="auth-meta"><span>${escapeHtml(metric.source??'')}</span><span>${escapeHtml(metric.definition??'')}</span></div>
  </article>`;
}

function authGroundSoulEconomicGainAtTime(summary,p,time){const rows=summary?.byPlayer??[];const steam=String(p?.identity?.steamId??'');const name=String(p?.playerName??'');const row=rows.find(x=>steam&&String(x.steamId??'')===steam)??rows.find(x=>String(x.playerName??'')===name);const timeline=row?.cumulativeTimeline??[];let gain=0,creditEvents=0;for(const x of timeline){if(Number(x.matchTime)<=Number(time)){gain=Number(x.cumulativeCurrency0Delta)||0;creditEvents=Number(x.creditEvents)||0;}else break;}return {gain,creditEvents,fullMatch:Number(row?.observedCurrency0DeltaTotal)||0};}
function metricValue(id,{model,p,time,weaponReady}){
  const s=stateAt(p,time);
  const teamNow=teamAt(model,p.team,time);
  const otherNow=otherTeamAt(model,p.team,time);
  const teamFinal=(model.teams??[]).find(t=>String(t.team)===String(p.team));
  const otherFinal=(model.teams??[]).find(t=>String(t.team)!==String(p.team));
  const teamRoster=(model.match?.roster??[]).filter(r=>String(r.team)===String(p.team));
  const currentItems=itemsAt(p,time);
  const additions=(p.items?.events??[]).filter(e=>e.eventType==='ITEM_ADDED').sort((a,b)=>(a.time??0)-(b.time??0));
  const removals=(p.items?.events??[]).filter(e=>e.eventType==='ITEM_REMOVED').sort((a,b)=>(a.time??0)-(b.time??0));
  const permNow=permanentAt(p,time);
  const permFinal=p.permanentBuffs?.final??{};
  const permEvents=(p.permanentBuffs?.events??[]).sort((a,b)=>(a.time??0)-(b.time??0));
  const bridges=(p.bridgeBuffs?.intervals??[]).slice().sort((a,b)=>(a.startTime??0)-(b.startTime??0));
  const activeBridges=bridges.filter(x=>(x.startTime??Infinity)<=time && time<(x.endTime??-Infinity));
  const bridgeUptime=bridges.reduce((n,x)=>n+(Number(x.durationSeconds)||0),0);
  const matchDuration=Number(model.match?.matchDurationSeconds)||0;
  const overlaps=bridgeOverlapSummary(bridges);
  const weapon=p.weapon??{};
  switch(id){
    case 'match_clock': return v(clock(time,true),s?.tick!=null?`tick ${num(s.tick)}`:'tick unavailable');
    case 'match_duration': return v(duration(matchDuration),`${num(matchDuration,2)} seconds observed`);
    case 'player_name': return v(p.playerName??'—');
    case 'steam_id': return v(p.identity?.steamId??'—');
    case 'hero_id': return v(p.heroId??p.identity?.heroId??'—');
    case 'team': return v(p.team??p.identity?.team??'—');
    case 'controller_entity': return v(p.identity?.controllerEntityIndex??'—');
    case 'pawn_entity': return v(p.identity?.pawnEntityIndex??'—');
    case 'roster': return v(`${teamRoster.length} players`,teamRoster.map(x=>x.playerName).filter(Boolean).join(' · ')||'—');
    case 'composition': return v(`${teamRoster.length} heroes`,teamRoster.map(x=>`H${x.heroId??'?'}`).join(' · ')||'—');

    case 'level': return v(s?.level??p.core?.level??'—',`final ${p.core?.level??'—'}`);
    case 'level_timing': return v(`${Object.keys(p.core?.levelTimings??{}).length} observed levels`,formatLevelTimes(p.core?.levelTimings));
    case 'level_rate': return v(perMin(p.core?.levelRatePerMinute));
    case 'alive_time': return v(duration(p.core?.aliveSeconds));
    case 'dead_time': return v(duration(p.core?.deadSeconds));
    case 'alive_share': return v(percent(p.core?.aliveShare));
    case 'death_count': return v(p.core?.deathsObserved??0,'Observed alive → dead transitions');
    case 'death_timing': return v(`${(p.core?.deathTimings??[]).length} transitions`,(p.core?.deathTimings??[]).map(x=>clock(x.time)).join(' · ')||'None');
    case 'survival_intervals': return v(`${(p.core?.survivalIntervals??[]).length} completed`,formatDurations(p.core?.survivalIntervals));
    case 'average_life': return v(duration(p.core?.averageLifeSeconds));
    case 'respawn_time': return v(`${(p.core?.respawns??[]).length} observed`,formatDurations((p.core?.respawns??[]).map(x=>x.duration)));
    case 'respawn_downtime': return v(duration(p.core?.totalRespawnDowntimeSeconds));
    case 'health': return v(s?.health??p.core?.health??'—');
    case 'health_max': return v(s?.healthMax??p.core?.healthMax??'—');
    case 'health_percent': return v(percent(s?.healthMax>0?s.health/s.healthMax:p.core?.healthPercent));
    case 'health_minmax': return v(`${num(p.core?.minHealth)} → ${num(p.core?.maxHealth)}`,'Observed minimum → maximum');
    case 'low_health_25': return v(duration(p.core?.low25Seconds));
    case 'low_health_50': return v(duration(p.core?.low50Seconds));
    case 'health_regen': return v(num(s?.healthRegen??p.core?.healthRegen,2));
    case 'gold_networth': return v(num(s?.goldNetWorth??p.scoreboard?.goldNetWorth),`final ${num(p.scoreboard?.goldNetWorth)}`);
    case 'ap_networth': return v(num(s?.apNetWorth??p.scoreboard?.apNetWorth),`final ${num(p.scoreboard?.apNetWorth)}`);
    case 'networth_rate': return v(perMin(p.core?.netWorthGainPerMinute),'Observed net-worth change; not relabeled Souls/min');
    case 'networth_checkpoints': return v(`${Object.keys(p.core?.checkpoints??{}).length} checkpoints`,formatCheckpoints(p.core?.checkpoints));
    case 'networth_rank': return v(`#${p.rank?.matchNetWorth??'—'} match`,`#${p.rank?.teamNetWorth??'—'} on team`);

    case 'team_networth': return v(num(teamNow?.goldNetWorth??teamFinal?.goldNetWorth));
    case 'team_networth_diff': return v(signed((teamNow?.goldNetWorth??teamFinal?.goldNetWorth??0)-(otherNow?.goldNetWorth??otherFinal?.goldNetWorth??0)));
    case 'player_team_share': return v(percent(safeDiv(s?.goldNetWorth??p.scoreboard?.goldNetWorth,teamNow?.goldNetWorth??teamFinal?.goldNetWorth)));
    case 'team_ahead_time': return v(duration(teamFinal?.advantage?.aheadSeconds));
    case 'team_behind_time': return v(duration(teamFinal?.advantage?.behindSeconds));
    case 'max_team_lead': return v(num(teamFinal?.advantage?.maxLead));
    case 'max_team_deficit': return v(num(teamFinal?.advantage?.maxDeficit));
    case 'largest_lead_swing': return v(num(teamFinal?.advantage?.largestSwing));

    case 'current_items': return v(`${currentItems.length} owned`,itemNames(currentItems));
    case 'final_build': return v(`${(p.items?.finalItems??[]).length} owned`,itemNames(p.items?.finalItems??[]));
    case 'item_acquisition_time': return v(`${additions.length} additions`,additions.map(e=>`${clock(e.time)} ${itemName(e.item)}`).join(' · ')||'None');
    case 'item_acquisition_order': return v(`${additions.length} items`,additions.map((e,i)=>`${i+1}. ${itemName(e.item)}`).join(' · ')||'None');
    case 'item_count': return v(currentItems.length,`at ${clock(time)}`);
    case 'item_ownership_duration': return v(`${(p.items?.ownershipIntervals??[]).length} intervals`,(p.items?.ownershipIntervals??[]).map(x=>`${itemName(x.item)} ${duration(x.durationSeconds)}`).join(' · ')||'None');
    case 'item_removals': return v(removals.length,removals.map(e=>`${clock(e.time)} ${itemName(e.item)}`).join(' · ')||'None');
    case 'checkpoint_builds': return v(`${checkpointTimes(matchDuration).length} checkpoints`,formatCheckpointBuilds(p,matchDuration));

    case 'permanent_current': return v(`${permanentUnits(permNow)} units`,formatPermanent(permNow));
    case 'permanent_acquisitions': return v(permEvents.length,permEvents.map(e=>`${clock(e.time)} ${formatPermanentDelta(e.state)}`).join(' · ')||'None');
    case 'permanent_count': return v(permanentUnits(permFinal),`${Object.keys(permFinal).length} populated families at replay end`);
    case 'permanent_by_family': return v(`${Object.keys(permFinal).length} families`,formatPermanent(permFinal));
    case 'permanent_value': return v(`${Object.keys(permFinal).length} families`,Object.entries(permFinal).map(([k,x])=>`${pretty(k)} ${num(x?.totalValue,3)}`).join(' · ')||'None');
    case 'permanent_team_diff': {
      const mine=teamFinal?.permanentBuffUnits??0,other=otherFinal?.permanentBuffUnits??0;
      return v(signed(mine-other),`${mine} team units vs ${other} opponent units`);
    }

    case 'bridge_collections': return v(bridges.length,countByText(bridges,x=>pretty(x.buffType??x.recordKey)));
    case 'bridge_current': return v(`${activeBridges.length} active`,activeBridges.map(x=>`${pretty(x.buffType??x.recordKey)} until ${clock(x.endTime)}`).join(' · ')||'None');
    case 'bridge_uptime': return v(duration(bridgeUptime),countByDuration(bridges,x=>pretty(x.buffType??x.recordKey)));
    case 'bridge_uptime_share': return v(percent(safeDiv(bridgeUptime,matchDuration)),'Aggregate buff-seconds / observed match duration; overlaps can make this exceed 100%.');
    case 'bridge_overlaps': return v(`max ${overlaps.maxConcurrent} concurrent`,`${duration(overlaps.overlapSeconds)} with 2+ buffs active`);
    case 'bridge_termination': return v(`${bridges.length} intervals`,countByText(bridges,x=>pretty(x.terminationReason??'UNRESOLVED')));
    case 'bridge_team_uptime': return v(duration(teamFinal?.bridgeUptimeSeconds));

    case 'trooper_deaths': return v(model.troopers?.deaths??model.troopers?.summary?.deaths??'—','Observed CNPC_Trooper positive-health → 0 transitions');
    case 'trooper_death_timing': { const ts=model.troopers?.summary??{}; const times=ts.deathTimesSeconds??[]; return v(`${ts.gameplayDeaths??times.length} gameplay deaths`,times.length?`first ${clock(ts.firstGameplayDeathSeconds)} · median ${clock(ts.medianGameplayDeathSeconds)} · last ${clock(ts.lastGameplayDeathSeconds)}`:'No gameplay deaths observed'); }
    case 'ground_soul_activations': return v(model.groundSoulLifecycle?.summary?.activations??'—','Match-level observed CCitadel_Pickup_AssignedGold active episodes');
    case 'ground_soul_targeted_activations': { const gs=model.groundSoulLifecycle?.summary??{}; return v(gs.targetedActivations??'—',`${percent(gs.targetedShare)} of observed activations · physical m_hVacuumTarget only`); }
    case 'ground_soul_lifecycle_duration': { const gs=model.groundSoulLifecycle?.summary??{}; return v(gs.medianCompletedDurationSeconds!=null?duration(gs.medianCompletedDurationSeconds):'—',`${gs.completedActiveToInactive??0} completed active → inactive · ${gs.censoredActivations??0} censored`); }
    case 'ground_soul_economic_credit_events': { const ge=model.groundSoulEconomicCredit?.summary??{}; return v(ge.resolvedCreditEvents??'—',`${percent(ge.resolutionShare)} of isolated targeted candidates · ${ge.unresolvedCandidateEvents??0} unresolved candidates`); }
    case 'ground_soul_economic_recipient_transitions': { const ge=model.groundSoulEconomicCredit?.summary??{}; return v(ge.recipientTransitions??'—',`${ge.resolvedCreditEvents??0} resolved events · exact terminal-tick currency transitions`); }
    case 'ground_soul_multi_recipient_share': { const ge=model.groundSoulEconomicCredit?.summary??{}; return v(percent(ge.multiRecipientShare),`${ge.multiRecipientEvents??0} / ${ge.resolvedCreditEvents??0} resolved events`); }
    case 'ground_soul_economic_gain': { const g=authGroundSoulEconomicGainAtTime(model.groundSoulEconomicCredit?.summary,p,time); return v(num(g.gain),`${g.creditEvents} resolved credit events through ${clock(time)} · full-match ${num(g.fullMatch)}`); }
    case 'primary_discharges': return v(weapon.discharges??0,`${weapon.events??0} weapon telemetry events`);
    case 'primary_attack_rate': return v(perMin(safeDiv(weapon.discharges,p.aliveMinutes)));
    case 'inter_attack_interval': return v(`${num(weapon.medianInterAttackSeconds,4)} s median`,`mean ${num(weapon.meanInterAttackSeconds,4)} s · n=${weapon.interAttackSampleCount??0}`);
    case 'next_primary_ready': return weaponReady?v(num(weaponReady.nextPrimaryAttack,6),`latest observed carrier · row at ${clock(weaponReady.matchTime)} · raw runtime schedule time`):v('—','No next-primary-ready carrier found in available weapon evidence');
    case 'ready_delay': return v(`${num(weapon.medianReadyDelaySeconds,4)} s median`,`mean ${num(weapon.meanReadyDelaySeconds,4)} s · n=${weapon.readyDelaySampleCount??0}`);
    default: return {wired:false,value:'NOT WIRED',detail:''};
  }
}

async function latestNextPrimaryReady(replay,playerName,offset){
  try{
    const q=`player=${encodeURIComponent(playerName)}&limit=1&offset=0`;
    const first=await apiJson(`/api/replay/${encodeURIComponent(replay)}/evidence/weapon?${q}`);
    const matched=Number(first.matched??0);
    if(!matched)return null;
    const start=Math.max(0,matched-250);
    const tail=await apiJson(`/api/replay/${encodeURIComponent(replay)}/evidence/weapon?player=${encodeURIComponent(playerName)}&limit=250&offset=${start}`);
    const rows=tail.rows??[];
    for(let i=rows.length-1;i>=0;i--){
      const r=rows[i];
      const next=finite(r?.observedWeaponState?.nextPrimaryAttack ?? r?.directRuntime?.after?.nextPrimaryAttack ?? r?.directRuntime?.after?.m_flNextPrimaryAttack);
      if(next!==null){
        const demo=finite(r.demoSeconds)??(finite(r.tick)!==null?Number(r.tick)/64:null);
        return {nextPrimaryAttack:next,matchTime:demo===null?null:demo-offset,tick:r.tick??null};
      }
    }
  }catch{}
  return null;
}

function stateAt(p,time){
  const tl=p?.timeline??[]; if(!tl.length)return null;
  let lo=0,hi=tl.length-1,best=tl[0];
  while(lo<=hi){const mid=(lo+hi)>>1;const x=tl[mid];if((x.matchTime??-Infinity)<=time){best=x;lo=mid+1;}else hi=mid-1;}
  return best;
}
function teamAt(model,team,time){
  const series=model.teamSeries??[]; if(!series.length)return null;
  const idx=Math.max(0,Math.min(series.length-1,Math.floor(time)));
  const row=series[idx]??series[series.length-1];
  return row?.teams?.[String(team)]??null;
}
function otherTeamAt(model,team,time){
  const series=model.teamSeries??[]; if(!series.length)return null;
  const idx=Math.max(0,Math.min(series.length-1,Math.floor(time)));const teams=series[idx]?.teams??{};
  const key=Object.keys(teams).find(k=>String(k)!==String(team));return key?teams[key]:null;
}
function itemsAt(p,time){
  const intervals=p.items?.ownershipIntervals??[];
  return intervals.filter(x=>(x.startTime??Infinity)<=time && (x.endReason==='REPLAY_END'?time<=(x.endTime??-Infinity):time<(x.endTime??-Infinity))).map(x=>x.item);
}
function permanentAt(p,time){
  let state={};
  for(const e of p.permanentBuffs?.events??[]){if((e.time??Infinity)<=time)state=e.state??state;else break;}
  return state;
}
function permanentUnits(state){return Object.values(state??{}).reduce((n,x)=>n+(Number(x?.inferredUnits)||0),0);}
function bridgeOverlapSummary(intervals){
  const events=[];for(const x of intervals){const a=finite(x.startTime),b=finite(x.endTime);if(a===null||b===null||b<a)continue;events.push([a,1],[b,-1]);}
  events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let n=0,max=0,last=null,overlapSeconds=0;
  for(const [t,d] of events){if(last!==null&&n>=2)overlapSeconds+=Math.max(0,t-last);n+=d;max=Math.max(max,n);last=t;}
  return {maxConcurrent:max,overlapSeconds};
}
function checkpointTimes(matchDuration){return [300,600,900,1200,1500,1800,2100,2400,2700,3000].filter(x=>x<=matchDuration);}
function formatCheckpointBuilds(p,matchDuration){
  return checkpointTimes(matchDuration).map(t=>`${clock(t)}: ${itemNames(itemsAt(p,t))}`).join(' • ')||'No standard checkpoint reached';
}
function itemName(item){return item?.recordKey??item?.itemName??item?.name??(item?.itemId!=null?`item ${item.itemId}`:'unknown item');}
function itemNames(items){return items?.length?items.map(itemName).join(' · '):'None';}
function formatPermanent(state){
  const parts=Object.entries(state??{}).map(([k,x])=>`${pretty(k)} ×${Number(x?.inferredUnits)||0} (${num(x?.totalValue,3)})`);
  return parts.join(' · ')||'None';
}
function formatPermanentDelta(state){return formatPermanent(state);}
function formatLevelTimes(o){
  const xs=Object.entries(o??{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([lvl,x])=>`L${lvl} ${clock(x?.time)}`);
  return xs.join(' · ')||'None';
}
function formatDurations(xs){
  const a=(xs??[]).filter(x=>finite(x)!==null);
  return a.length?a.map(duration).join(' · '):'None';
}
function formatCheckpoints(o){
  const xs=Object.entries(o??{}).sort((a,b)=>Number(a[0])-Number(b[0]));
  return xs.map(([sec,x])=>`${clock(Number(sec))}: ${num(x?.goldNetWorth)}`).join(' · ')||'None';
}
function countByText(xs,keyFn){
  const m=new Map();for(const x of xs){const k=keyFn(x)||'Unknown';m.set(k,(m.get(k)||0)+1);}
  return [...m].map(([k,n])=>`${k} ${n}`).join(' · ')||'None';
}
function countByDuration(xs,keyFn){
  const m=new Map();for(const x of xs){const k=keyFn(x)||'Unknown';m.set(k,(m.get(k)||0)+(Number(x.durationSeconds)||0));}
  return [...m].map(([k,n])=>`${k} ${duration(n)}`).join(' · ')||'None';
}
function pretty(s){return String(s??'').replace(/_powerup_pickup$/,'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
function v(value,detail=''){return {wired:true,value:String(value??'—'),detail:String(detail??'')};}
function finite(x){const n=Number(x);return Number.isFinite(n)?n:null;}
function safeDiv(a,b){const x=finite(a),y=finite(b);return x!==null&&y!==null&&y!==0?x/y:null;}
function num(x,digits=0){const n=finite(x);if(n===null)return '—';return n.toLocaleString(undefined,{maximumFractionDigits:digits,minimumFractionDigits:digits});}
function signed(x){const n=finite(x);if(n===null)return '—';return `${n>0?'+':''}${num(n)}`;}
function percent(x){const n=finite(x);return n===null?'—':`${num(n*100,1)}%`;}
function perMin(x){const n=finite(x);return n===null?'—':`${num(n,2)} / min`;}
function duration(x){const n=finite(x);if(n===null)return '—';return clock(Math.max(0,n),n<60);}
function clock(sec,millis=false){
  const n=finite(sec);if(n===null)return '—';const sign=n<0?'-':'';const a=Math.abs(n),m=Math.floor(a/60),s=a-m*60;
  return millis?`${sign}${m}:${s.toFixed(3).padStart(6,'0')}`:`${sign}${m}:${Math.floor(s).toString().padStart(2,'0')}`;
}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function apiJson(path){
  const r=await fetch(path,{headers:{accept:'application/json'}});const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||`${r.status} ${r.statusText}`);return data;
}
function installAuthoritativeStyles(){
  if(document.querySelector(`#${AUTH_STYLE_ID}`))return;
  const style=document.createElement('style');style.id=AUTH_STYLE_ID;style.textContent=`
    .auth-head{align-items:center}.auth-coverage{min-width:128px;border:1px solid var(--line,#303846);border-radius:10px;padding:10px 14px;text-align:right;background:var(--panel,#171b22)}
    .auth-coverage strong{display:block;font-size:22px}.auth-coverage span{font-size:11px;color:var(--muted,#99a2b0)}.auth-coverage.complete strong{color:#77d49b}.auth-coverage.incomplete strong{color:#ff8e8e}
    .auth-context{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 18px;padding:10px 12px;border:1px solid var(--line,#303846);border-radius:10px;background:var(--panel,#171b22);font-size:12px;color:var(--muted,#99a2b0)}
    .auth-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(225px,1fr));gap:10px}
    .auth-card{min-width:0;border:1px solid var(--line,#303846);border-radius:10px;padding:12px;background:var(--panel,#171b22)}
    .auth-card.unwired{border-color:#a84b4b}.auth-card-top{display:flex;justify-content:space-between;gap:8px;align-items:center}.auth-unit{font-size:10px;color:var(--muted,#99a2b0);text-transform:uppercase;letter-spacing:.06em}
    .auth-card h3{font-size:12px;margin:9px 0 5px;color:var(--muted,#99a2b0);font-weight:600}.auth-value{font-size:20px;font-weight:700;overflow-wrap:anywhere}
    .auth-detail{font-size:11px;color:var(--muted,#99a2b0);margin-top:5px;line-height:1.45;overflow-wrap:anywhere}
    .auth-meta{border-top:1px solid var(--line,#303846);margin-top:10px;padding-top:8px;display:grid;gap:4px;font-size:10px;color:var(--muted,#99a2b0);line-height:1.35}
    @media(max-width:620px){.auth-grid{grid-template-columns:1fr}.auth-coverage{width:100%;text-align:left}}
  `;document.head.appendChild(style);
}
