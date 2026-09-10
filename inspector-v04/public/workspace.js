const WORKSPACE_TAB_ID='modular-workspace';
const WORKSPACE_STORAGE_KEY='deadlockBehavior.modularWorkspace.v01';
let workspaceActive=false;
let workspaceModel=null;
let workspaceRegistry=null;
let workspaceReplay=null;
let workspaceRenderToken=0;
let workspaceRaf=0;
let dragPanelId=null;
let workspacePlaybackTimer=null;
let workspacePlaybackSpeed=1;
let workspaceAudit=null;
let workspaceAuditReplay=null;
let workspaceCollisionAudit=null;
let workspaceCollisionReplay=null;
let workspaceNarrowValidation=null;

const workspaceState=loadWorkspaceState();

const METRICS={
  level:{label:'Level',sourceMetricId:'level',unit:'level',decimals:0,valueAt:(p,m,t)=>stateAt(p,t)?.level},
  health:{label:'Health',sourceMetricId:'health',unit:'HP',decimals:0,valueAt:(p,m,t)=>stateAt(p,t)?.health},
  health_max:{label:'Max health',sourceMetricId:'health_max',unit:'HP',decimals:0,valueAt:(p,m,t)=>stateAt(p,t)?.healthMax},
  health_percent:{label:'Health %',sourceMetricId:'health_percent',unit:'%',format:'percent',valueAt:(p,m,t)=>{const s=stateAt(p,t);return finite(s?.healthMax)>0?finite(s?.health)/finite(s?.healthMax):null;}},
  health_regen:{label:'Health regen',sourceMetricId:'health_regen',unit:'HP/s',decimals:2,valueAt:(p,m,t)=>stateAt(p,t)?.healthRegen},
  gold_networth:{label:'Gold net worth',sourceMetricId:'gold_networth',unit:'net worth',decimals:0,valueAt:(p,m,t)=>stateAt(p,t)?.goldNetWorth},
  ap_networth:{label:'AP net worth',sourceMetricId:'ap_networth',unit:'AP',decimals:0,valueAt:(p,m,t)=>stateAt(p,t)?.apNetWorth},
  team_networth:{label:'Team net worth',sourceMetricId:'team_networth',unit:'net worth',decimals:0,valueAt:(p,m,t)=>teamAt(m,p?.team,t)?.goldNetWorth},
  team_networth_diff:{label:'Team net-worth differential',sourceMetricId:'team_networth_diff',unit:'net worth',decimals:0,signed:true,valueAt:(p,m,t)=>{const mine=finite(teamAt(m,p?.team,t)?.goldNetWorth),other=finite(otherTeamAt(m,p?.team,t)?.goldNetWorth);return mine===null||other===null?null:mine-other;}},
  player_team_share:{label:'Player share of team net worth',sourceMetricId:'player_team_share',unit:'%',format:'percent',valueAt:(p,m,t)=>{const own=finite(stateAt(p,t)?.goldNetWorth),team=finite(teamAt(m,p?.team,t)?.goldNetWorth);return own===null||team===null||team===0?null:own/team;}},
  item_count:{label:'Owned standard-shop items',sourceMetricId:'item_count',unit:'items',decimals:0,step:true,valueAt:(p,m,t)=>itemsAt(p,t).length},
  permanent_current:{label:'Permanent world-buff units',sourceMetricId:'permanent_current',unit:'units',decimals:0,step:true,valueAt:(p,m,t)=>permanentUnits(permanentAt(p,t))},
  bridge_current:{label:'Active bridge buffs',sourceMetricId:'bridge_current',unit:'active buffs',decimals:0,step:true,valueAt:(p,m,t)=>bridgesAt(p,t).length},
  bridge_uptime:{label:'Bridge uptime through scrubber',sourceMetricId:'bridge_uptime',unit:'seconds',format:'duration',derivedView:true,valueAt:(p,m,t)=>bridgeUptimeThrough(p,t)},
  death_count:{label:'Deaths through scrubber',sourceMetricId:'death_count',unit:'deaths',decimals:0,step:true,derivedView:true,valueAt:(p,m,t)=>deathCountThrough(p,t)},
  ground_soul_economic_gain:{label:'Ground Soul economic gain',sourceMetricId:'ground_soul_economic_gain',unit:'observed currency0',decimals:0,step:true,valueAt:(p,m,t)=>groundSoulGainAt(m,p,t)},
  ground_soul_activations:{label:'Ground Soul activations through scrubber',sourceMetricId:'ground_soul_activations',unit:'activations',decimals:0,step:true,derivedView:true,matchScoped:true,valueAt:(p,m,t)=>groundSoulActivationsAt(m,t)}
};

installWorkspaceTab();
const tabsEl=document.querySelector('#tabs');
if(tabsEl){
  new MutationObserver(()=>installWorkspaceTab()).observe(tabsEl,{childList:true});
  tabsEl.addEventListener('click',e=>{
    const b=e.target.closest('button');
    if(!b)return;
    if(b.id!==WORKSPACE_TAB_ID && b.classList.contains('tab')){workspaceActive=false;stopWorkspacePlayback();}
  });
}

document.querySelector('#timeSlider')?.addEventListener('input',()=>queueWorkspaceRender());
document.querySelector('#playerSelect')?.addEventListener('change',()=>queueWorkspaceRender());
document.querySelector('#replaySelect')?.addEventListener('change',()=>{workspaceModel=null;workspaceReplay=null;workspaceAudit=null;workspaceAuditReplay=null;workspaceCollisionAudit=null;workspaceCollisionReplay=null;queueWorkspaceRender(100);});
document.querySelector('#refreshBtn')?.addEventListener('click',()=>{workspaceModel=null;workspaceReplay=null;workspaceAudit=null;workspaceAuditReplay=null;workspaceCollisionAudit=null;workspaceCollisionReplay=null;queueWorkspaceRender(500);});
const playerSelect=document.querySelector('#playerSelect');
if(playerSelect)new MutationObserver(()=>queueWorkspaceRender(25)).observe(playerSelect,{childList:true});

function installWorkspaceTab(){
  const tabs=document.querySelector('#tabs');
  if(!tabs||document.querySelector(`#${WORKSPACE_TAB_ID}`))return;
  const b=document.createElement('button');
  b.id=WORKSPACE_TAB_ID;
  b.type='button';
  b.className='tab';
  b.textContent='Workspace';
  b.title='Build a draggable comparison workspace from time-varying replay statistics';
  b.addEventListener('click',()=>{workspaceActive=true;syncWorkspaceTab();renderWorkspace();});
  const auth=document.querySelector('#authoritative-ready');
  if(auth)tabs.insertBefore(b,auth);else tabs.appendChild(b);
}

function syncWorkspaceTab(){
  if(!workspaceActive)return;
  document.querySelectorAll('#tabs .tab').forEach(x=>x.classList.toggle('active',x.id===WORKSPACE_TAB_ID));
}

function queueWorkspaceRender(delay=0){
  if(!workspaceActive)return;
  if(workspaceRaf)cancelAnimationFrame(workspaceRaf);
  const run=()=>{workspaceRaf=requestAnimationFrame(()=>{workspaceRaf=0;if(workspaceActive){syncWorkspaceTab();renderWorkspace();}});};
  if(delay)setTimeout(run,delay);else run();
}

async function renderWorkspace(){
  const token=++workspaceRenderToken;
  const main=document.querySelector('#main');
  const replay=document.querySelector('#replaySelect')?.value;
  if(!main||!replay){if(main)main.innerHTML='<div class="loading">Select a replay to open the workspace.</div>';return;}
  if(!workspaceModel||workspaceReplay!==replay){main.innerHTML='<div class="loading">Loading modular workspace…</div>';}
  try{
    const [model,registry]=await Promise.all([getWorkspaceModel(replay),getWorkspaceRegistry()]);
    const needsAudit=workspaceState.panels.some(p=>p.kind==='groundSoulAudit');
    const needsCollisionAudit=workspaceState.panels.some(p=>p.kind==='groundSoulCollision');
    const needsNarrowValidation=workspaceState.panels.some(p=>p.kind==='groundSoulIsolationValidation');
    const [audit,collisionAudit,narrowValidation]=await Promise.all([needsAudit?getWorkspaceAudit(replay):Promise.resolve(null),needsCollisionAudit?getWorkspaceCollisionAudit(replay):Promise.resolve(null),needsNarrowValidation?getWorkspaceNarrowValidation():Promise.resolve(null)]);
    if(token!==workspaceRenderToken||!workspaceActive)return;
    ensureWorkspacePanels(model);
    const currentTime=clampTime(Number(document.querySelector('#timeSlider')?.value??0),model);
    workspaceState.baseline=clampTime(Number(workspaceState.baseline??0),model);
    const cols=workspaceState.columns??'auto';
    main.innerHTML=`
      <section class="ws-toolbar panel">
        <div class="ws-toolbar-copy">
          <div class="eyebrow">Modular comparison workspace</div>
          <h2>Compare replay statistics at the same moment</h2>
          <p>Every panel follows the global scrubber. Compare statistics, add a player replay/heat-map panel, pin a baseline, and drag panels into the order you want.</p>
        </div>
        <div class="ws-toolbar-controls">
          <button type="button" class="primary" data-ws-action="add">+ Metric</button>
          <button type="button" class="ghost" data-ws-action="add-spatial">+ Replay / heat map</button>
          <button type="button" class="ghost" data-ws-action="add-ground-soul-audit">+ Ground Soul audit</button>
          <button type="button" class="ghost" data-ws-action="add-ground-soul-collisions">+ Ground Soul collisions</button>
          <button type="button" class="ghost" data-ws-action="add-ground-soul-isolation-validation">+ GS isolation validation</button>
          <button type="button" class="ghost" data-ws-action="play">${workspacePlaybackTimer?'Pause':'Play'}</button>
          <label>Speed<select data-ws-speed><option value="0.5" ${workspacePlaybackSpeed===0.5?'selected':''}>0.5×</option><option value="1" ${workspacePlaybackSpeed===1?'selected':''}>1×</option><option value="2" ${workspacePlaybackSpeed===2?'selected':''}>2×</option><option value="4" ${workspacePlaybackSpeed===4?'selected':''}>4×</option></select></label>
          <button type="button" class="ghost compact" data-ws-action="back-5">−5 s</button>
          <button type="button" class="ghost compact" data-ws-action="forward-5">+5 s</button>
          <button type="button" class="ghost" data-ws-action="baseline">Set baseline = ${clock(currentTime)}</button>
          <button type="button" class="ghost" data-ws-action="baseline-zero">Baseline 0:00</button>
          <label>Columns<select data-ws-columns><option value="auto" ${cols==='auto'?'selected':''}>Auto</option><option value="1" ${cols==='1'?'selected':''}>1</option><option value="2" ${cols==='2'?'selected':''}>2</option><option value="3" ${cols==='3'?'selected':''}>3</option><option value="4" ${cols==='4'?'selected':''}>4</option></select></label>
          <button type="button" class="ghost" data-ws-action="reset">Reset layout</button>
        </div>
      </section>
      <div class="ws-time-context">
        <span><strong>Current:</strong> ${clock(currentTime,true)}</span>
        <span><strong>Baseline:</strong> ${clock(workspaceState.baseline,true)}</span>
        <span><strong>Δ:</strong> current − baseline</span>
        <span>${workspaceState.panels.length} panel${workspaceState.panels.length===1?'':'s'}</span>
      </div>
      <section class="ws-grid" data-cols="${escapeHtml(cols)}">
        ${workspaceState.panels.map((panel,index)=>renderPanel(panel,index,model,registry,currentTime,workspaceState.baseline,audit,collisionAudit,narrowValidation)).join('')}
      </section>
      <section class="section">
        <div class="warning-box"><strong>Authority boundary:</strong> Workspace V01 does not create or promote statistics. It visualizes existing replay-model fields and validated event streams. Cards marked “derived view” are time-window views of an existing source metric, not new A claims.</div>
      </section>`;
    bindWorkspaceControls(model);
  }catch(err){
    if(token!==workspaceRenderToken)return;
    main.innerHTML=`<div class="warning-box danger-box"><strong>Workspace failed to load.</strong><br>${escapeHtml(err?.message??String(err))}</div>`;
  }
}

function renderPanel(panel,index,model,registry,currentTime,baselineTime,audit,collisionAudit,narrowValidation){
  if(panel.kind==='spatial')return renderSpatialPanel(panel,index,model,currentTime);
  if(panel.kind==='groundSoulAudit')return renderGroundSoulAuditPanel(panel,index,model,currentTime,audit);
  if(panel.kind==='groundSoulCollision')return renderGroundSoulCollisionPanel(panel,index,model,currentTime,collisionAudit);
  if(panel.kind==='groundSoulIsolationValidation')return renderGroundSoulIsolationValidationPanel(panel,index,model,narrowValidation);
  return renderMetricPanel(panel,index,model,registry,currentTime,baselineTime);
}

function renderSpatialPanel(panel,index,model,currentTime){
  const player=resolvePanelPlayer(panel,model);
  const view=panel.spatialView??'heat-trail';
  const windowSeconds=panel.heatWindow==='all'?null:Number(panel.heatWindow??120);
  const bounds=spatialBounds(model);
  const occupancy=player?spatialOccupancy(player,currentTime,windowSeconds,bounds):null;
  const visual=player?spatialReplaySvg(player,model,currentTime,bounds,occupancy,view):'<div class="ws-chart-empty">No player position data.</div>';
  const current=player?stateAt(player,currentTime):null;
  const pos=validPosition(current?.position)?current.position:null;
  const windowLabel=windowSeconds===null?`0:00 → ${clock(currentTime)}`:`last ${formatWindow(windowSeconds)}`;
  return `<article class="ws-card ws-spatial-card" draggable="true" data-ws-panel="${escapeHtml(panel.id)}">
    <div class="ws-card-head">
      <button type="button" class="ws-drag" data-ws-drag title="Drag to reorder" aria-label="Drag panel to reorder">⋮⋮</button>
      <div class="ws-card-title"><span class="ws-view-badge">VIEW</span><strong>Player replay</strong><span class="ws-derived">derived spatial view</span></div>
      <div class="ws-card-actions">
        <button type="button" class="ghost compact" data-ws-action="left" data-panel="${escapeHtml(panel.id)}" ${index===0?'disabled':''} title="Move left">←</button>
        <button type="button" class="ghost compact" data-ws-action="right" data-panel="${escapeHtml(panel.id)}" ${index===workspaceState.panels.length-1?'disabled':''} title="Move right">→</button>
        <button type="button" class="ghost compact" data-ws-action="duplicate" data-panel="${escapeHtml(panel.id)}" title="Duplicate panel">⧉</button>
        <button type="button" class="ghost compact" data-ws-action="remove" data-panel="${escapeHtml(panel.id)}" title="Remove panel">×</button>
      </div>
    </div>
    <div class="ws-spatial-selectors">
      <label>Player<select data-ws-player="${escapeHtml(panel.id)}">${playerOptions(model,panel.playerName)}</select></label>
      <label>Display<select data-ws-spatial-view="${escapeHtml(panel.id)}">
        <option value="position" ${view==='position'?'selected':''}>Current position</option>
        <option value="trail" ${view==='trail'?'selected':''}>Trail</option>
        <option value="heat" ${view==='heat'?'selected':''}>Heat map</option>
        <option value="heat-trail" ${view==='heat-trail'?'selected':''}>Heat map + trail</option>
      </select></label>
      <label>Heat window<select data-ws-heat-window="${escapeHtml(panel.id)}">
        <option value="all" ${panel.heatWindow==='all'?'selected':''}>Through current time</option>
        <option value="30" ${String(panel.heatWindow)==='30'?'selected':''}>Last 30 s</option>
        <option value="60" ${String(panel.heatWindow)==='60'?'selected':''}>Last 60 s</option>
        <option value="120" ${String(panel.heatWindow??'120')==='120'?'selected':''}>Last 2 min</option>
        <option value="300" ${String(panel.heatWindow)==='300'?'selected':''}>Last 5 min</option>
      </select></label>
    </div>
    <div class="ws-spatial-context">
      <span><strong>${escapeHtml(player?.playerName??'No player')}</strong> · ${clock(currentTime,true)}</span>
      <span>${current?.alive?'alive':'dead'}</span>
      <span>${pos?`x ${formatCoord(pos[0])} · y ${formatCoord(pos[1])}`:'position unavailable'}</span>
      <span>${escapeHtml(windowLabel)}</span>
    </div>
    <div class="ws-spatial-chart">${visual}</div>
    <div class="ws-spatial-stats">
      <span><strong>${formatObservedSeconds(occupancy?.observedAliveSeconds)}</strong><small>alive-position time represented</small></span>
      <span><strong>${occupancy?.occupiedCells??0}</strong><small>occupied heat cells</small></span>
      <span><strong>${formatObservedSeconds(occupancy?.peakCellSeconds)}</strong><small>peak cell dwell</small></span>
      <span><strong>${occupancy?.sampleIntervals??0}</strong><small>usable intervals</small></span>
    </div>
    <div class="ws-note"><strong>Spatial semantics:</strong> heat intensity is observed alive-time occupancy from sampled world-position telemetry through the selected replay time. This remains a diagnostic coordinate plane—not a validated Midtown map transform. Gaps &gt;3 s are excluded rather than assuming the player stayed at the last position.</div>
  </article>`;
}

function renderGroundSoulAuditPanel(panel,index,model,currentTime,audit){
  const loaded=audit?.status==='GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_V01_READY';
  const summary=audit?.summary??null;
  const at=summary?coverageAtTime(summary,currentTime):null;
  const reasonEntries=summary?Object.entries(summary.exclusionStageCounts??{}).sort((a,b)=>b[1]-a[1]):[];
  const nearby=summary?nearestAuditExclusions(summary.unresolvedTimeline??[],currentTime,6):[];
  const collision=summary?.collisionDiagnostics??{};
  return `<article class="ws-card ws-audit-card" draggable="true" data-ws-panel="${escapeHtml(panel.id)}">
    <div class="ws-card-head">
      <button type="button" class="ws-drag" data-ws-drag title="Drag to reorder" aria-label="Drag panel to reorder">⋮⋮</button>
      <div class="ws-card-title"><span class="badge b">B</span><strong>Ground Soul economic coverage audit</strong><span class="ws-derived">diagnostic</span></div>
      <div class="ws-card-actions">
        <button type="button" class="ghost compact" data-ws-action="left" data-panel="${escapeHtml(panel.id)}" ${index===0?'disabled':''} title="Move left">←</button>
        <button type="button" class="ghost compact" data-ws-action="right" data-panel="${escapeHtml(panel.id)}" ${index===workspaceState.panels.length-1?'disabled':''} title="Move right">→</button>
        <button type="button" class="ghost compact" data-ws-action="duplicate" data-panel="${escapeHtml(panel.id)}" title="Duplicate panel">⧉</button>
        <button type="button" class="ghost compact" data-ws-action="remove" data-panel="${escapeHtml(panel.id)}" title="Remove panel">×</button>
      </div>
    </div>
    ${loaded?`
      <div class="ws-audit-context"><span><strong>Through ${clock(currentTime,true)}</strong></span><span>${summary.currencyRescanAvailable?'direct currency rescan available':'currency collision context unavailable'}</span><span>±${summary.radiusTicks??16} tick isolation diagnostic</span></div>
      <div class="ws-audit-funnel">
        ${auditFunnelStep('Activations',at?.activations,summary.funnel?.lifecycleActivations)}
        ${auditFunnelStep('Completed',at?.completedLifecycle,summary.funnel?.completedLifecycle)}
        ${auditFunnelStep('Targeted + completed',at?.targetedCompletedLifecycle,summary.funnel?.completedTargetedLifecycle)}
        ${auditFunnelStep('Resolver candidates',at?.currentResolverCandidates,summary.funnel?.currentResolverCandidates)}
        ${auditFunnelStep('Resolved A credit',at?.resolvedEconomicCredit,summary.funnel?.resolvedEconomicCredit,true)}
      </div>
      <div class="ws-audit-rate"><div><span>Resolved / all lifecycle</span><strong>${formatPercent(summary.coverage?.resolvedShareOfAllLifecycle)}</strong></div><div><span>Resolved / current candidates</span><strong>${formatPercent(summary.coverage?.resolvedShareOfCurrentResolverCandidates)}</strong></div><div><span>Nonisolated exclusions</span><strong>${Number(collision.nonisolatedEvents??0).toLocaleString()}</strong></div><div><span>Same-tick AssignedGold collisions</span><strong>${Number(collision.nonisolatedWithSameTickAssignedGoldCollision??0).toLocaleString()}</strong></div></div>
      <div class="ws-audit-columns">
        <div><div class="ws-audit-heading">Why events are excluded</div><div class="ws-audit-reasons">${reasonEntries.length?reasonEntries.map(([k,v])=>`<div><span>${escapeHtml(auditStageLabel(k))}</span><strong>${Number(v).toLocaleString()}</strong></div>`).join(''):'<div class="muted">No exclusions.</div>'}</div></div>
        <div><div class="ws-audit-heading">Nearest unresolved events</div><div class="ws-audit-events">${nearby.length?nearby.map(x=>auditEventRow(x,currentTime)).join(''):'<div class="muted">No unresolved events.</div>'}</div></div>
      </div>
      <div class="ws-note"><strong>Interpretation boundary:</strong> this panel explains the current resolver's selection process. “Unresolved” does not mean no Souls were awarded. Nearby Trooper deaths are temporal context only, not asserted source-death matches. This diagnostic does not alter the 77/77 A ledger.</div>`:
      `<div class="ws-audit-missing"><strong>Audit output not found for ${escapeHtml(model.replayName??'this replay')}.</strong><span>Run <span class="mono">.\\inspector-v04\\run-ground-soul-coverage-audit.ps1 ${escapeHtml(model.replayName??'104373259')}</span>, then use Rebuild cache / reopen Workspace.</span></div>`}
  </article>`;
}
function auditFunnelStep(label,current,final,isResolved=false){return `<div class="ws-audit-step ${isResolved?'resolved':''}"><span>${escapeHtml(label)}</span><strong>${Number(current??0).toLocaleString()}</strong><small>full match ${Number(final??0).toLocaleString()}</small></div>`;}
function coverageAtTime(summary,time){const tl=summary?.timeline??[];let lo=0,hi=tl.length-1,best=null;while(lo<=hi){const mid=(lo+hi)>>1,x=tl[mid],t=finite(x?.matchTime);if(t!==null&&t<=time){best=x;lo=mid+1;}else hi=mid-1;}return best??{activations:0,completedLifecycle:0,targetedCompletedLifecycle:0,currentResolverCandidates:0,resolvedEconomicCredit:0,notResolved:0};}
function nearestAuditExclusions(rows,time,limit=6){return [...(rows??[])].filter(x=>finite(x?.matchTime)!==null).sort((a,b)=>Math.abs(finite(a.matchTime)-time)-Math.abs(finite(b.matchTime)-time)||finite(a.matchTime)-finite(b.matchTime)).slice(0,limit);}
function auditEventRow(x,currentTime){const t=finite(x?.matchTime),delta=t===null?null:t-currentTime;const collision=Number(x?.collisionCount??0),sameTick=Number(x?.sameTickCollisionCount??0),currency=x?.exactTickSameTeamPositiveTransitions;const bits=[auditStageLabel(x?.exclusionStage),collision?`${collision} nearby AssignedGold termination${collision===1?'':'s'}`:null,sameTick?`${sameTick} same-tick collision${sameTick===1?'':'s'}`:null,currency===null||currency===undefined?null:`${currency} same-team +currency0 transition${currency===1?'':'s'}`].filter(Boolean);return `<button type="button" class="ws-audit-event" data-ws-audit-time="${t??0}"><span><strong>${t===null?'—':clock(t,true)}</strong><small>${escapeHtml(bits.join(' · '))}</small></span><span>${delta===null?'':formatSignedSeconds(delta)}</span></button>`;}
function auditStageLabel(v){return String(v??'OTHER').toLowerCase().replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());}
function formatPercent(v){const n=finite(v);return n===null?'—':`${(n*100).toFixed(1)}%`;}
function formatSignedSeconds(v){const n=finite(v);if(n===null)return '';if(Math.abs(n)<.05)return 'now';return `${n>0?'+':'−'}${Math.abs(n).toFixed(Math.abs(n)<10?1:0)}s`;}

function renderGroundSoulCollisionPanel(panel,index,model,currentTime,audit){
  const loaded=audit?.status==='GROUND_SOUL_COLLISION_RESOLUTION_AUDIT_V02_READY';
  const summary=audit?.summary??null;
  const cf=summary?.counterfactualNarrowerIsolation??{};
  const collisionEntries=summary?Object.entries(summary.collisionClassCounts??{}).sort((a,b)=>b[1]-a[1]):[];
  const counterEntries=summary?Object.entries(summary.counterfactualResultCounts??{}).sort((a,b)=>b[1]-a[1]):[];
  const nearby=summary?nearestCollisionTimeline(summary.timeline??[],currentTime,8):[];
  return `<article class="ws-card ws-audit-card ws-collision-card" draggable="true" data-ws-panel="${escapeHtml(panel.id)}">
    <div class="ws-card-head">
      <button type="button" class="ws-drag" data-ws-drag title="Drag to reorder" aria-label="Drag panel to reorder">⋮⋮</button>
      <div class="ws-card-title"><span class="badge b">B</span><strong>Ground Soul collision resolution audit</strong><span class="ws-derived">counterfactual diagnostic</span></div>
      <div class="ws-card-actions">
        <button type="button" class="ghost compact" data-ws-action="left" data-panel="${escapeHtml(panel.id)}" ${index===0?'disabled':''} title="Move left">←</button>
        <button type="button" class="ghost compact" data-ws-action="right" data-panel="${escapeHtml(panel.id)}" ${index===workspaceState.panels.length-1?'disabled':''} title="Move right">→</button>
        <button type="button" class="ghost compact" data-ws-action="duplicate" data-panel="${escapeHtml(panel.id)}" title="Duplicate panel">⧉</button>
        <button type="button" class="ghost compact" data-ws-action="remove" data-panel="${escapeHtml(panel.id)}" title="Remove panel">×</button>
      </div>
    </div>
    ${loaded?`
      <div class="ws-audit-context"><span><strong>Focus ${clock(currentTime,true)}</strong></span><span>±${summary.radiusTicks??16} tick source collision radius</span><span>${Number(summary.collisionClusters??0).toLocaleString()} temporal collision clusters</span></div>
      <div class="ws-collision-summary">
        <div><span>Current nonisolated</span><strong>${Number(summary.nonisolatedEvents??0).toLocaleString()}</strong></div>
        <div><span>Would pass narrower rule</span><strong>${Number(cf.wouldPassEvents??0).toLocaleString()}</strong></div>
        <div><span>Same-tick + same-team ambiguous</span><strong>${Number(cf.stillSameTickSameTeamAmbiguous??0).toLocaleString()}</strong></div>
        <div><span>Current A events</span><strong>${Number(cf.currentResolvedAEvents??0).toLocaleString()}</strong></div>
      </div>
      <div class="ws-collision-counterfactual"><strong>Algorithmic counterfactual:</strong> if isolation rejected only same-team AssignedGold lifecycles terminating on the exact same tick, ${Number(cf.wouldPassEvents??0).toLocaleString()} currently excluded events would satisfy the remaining exact-tick currency and partition checks. <em>This is not an A promotion.</em></div>
      <div class="ws-audit-columns">
        <div><div class="ws-audit-heading">Collision classes</div><div class="ws-audit-reasons">${collisionEntries.length?collisionEntries.map(([k,v])=>`<div><span>${escapeHtml(collisionLabel(k))}</span><strong>${Number(v).toLocaleString()}</strong></div>`).join(''):'<div class="muted">No collision rows.</div>'}</div></div>
        <div><div class="ws-audit-heading">Counterfactual outcomes</div><div class="ws-audit-reasons">${counterEntries.length?counterEntries.map(([k,v])=>`<div><span>${escapeHtml(collisionLabel(k))}</span><strong>${Number(v).toLocaleString()}</strong></div>`).join(''):'<div class="muted">No counterfactual rows.</div>'}</div></div>
      </div>
      <div class="ws-audit-heading ws-collision-near-head">Nearest nonisolated events to replay time</div>
      <div class="ws-audit-events">${nearby.length?nearby.map(x=>collisionEventRow(x,currentTime)).join(''):'<div class="muted ws-collision-empty">No nonisolated events.</div>'}</div>
      <div class="ws-note"><strong>Interpretation boundary:</strong> “would pass narrower rule” means only that a less conservative algorithm would accept the event using the already-observed exact-tick currency carrier. It does not prove the attribution is scientifically valid. Same-tick same-team collisions remain explicitly ambiguous. Trooper timing is context only. The 77/77 A ledger is unchanged.</div>`:
      `<div class="ws-audit-missing"><strong>Collision audit V02 output not found for ${escapeHtml(model.replayName??'this replay')}.</strong><span>Run <span class="mono">.\\inspector-v04\\run-ground-soul-collision-audit.ps1 ${escapeHtml(model.replayName??'104373259')}</span>, then reopen Workspace.</span></div>`}
  </article>`;
}
function nearestCollisionTimeline(rows,time,limit=8){return [...(rows??[])].filter(x=>finite(x?.matchTime)!==null).sort((a,b)=>Math.abs(finite(a.matchTime)-time)-Math.abs(finite(b.matchTime)-time)||finite(a.matchTime)-finite(b.matchTime)).slice(0,limit);}
function collisionEventRow(x,currentTime){const t=finite(x?.matchTime),delta=t===null?null:t-currentTime;const bits=[collisionLabel(x?.collisionClass),`${Number(x?.sameTickSameTeamNeighbors??0)} same-tick same-team`,`${Number(x?.exactTickSameTeamPositiveTransitions??0)} +currency0`,x?.exactTickSameTeamPositiveTotal==null?null:`+${Number(x.exactTickSameTeamPositiveTotal).toLocaleString()} observed team credit`,collisionLabel(x?.trooperConcurrencyClass),x?.counterfactualWouldPass?'counterfactual pass':collisionLabel(x?.counterfactualResult)].filter(Boolean);return `<button type="button" class="ws-audit-event" data-ws-audit-time="${t??0}"><span><strong>${t===null?'—':clock(t,true)} · tick ${escapeHtml(x?.resolutionTick??'—')}</strong><small>${escapeHtml(bits.join(' · '))}</small></span><span>${delta===null?'':formatSignedSeconds(delta)}</span></button>`;}
function collisionLabel(v){return String(v??'OTHER').toLowerCase().replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());}

function renderGroundSoulIsolationValidationPanel(panel,index,model,validation){
  const loaded=validation?.status==='GROUND_SOUL_NARROW_ISOLATION_VALIDATION_V03_READY'||validation?.status==='GROUND_SOUL_NARROW_ISOLATION_VALIDATION_V03_INCOMPLETE';
  const aggregate=validation?.aggregate??{};
  const replayRow=(validation?.replayResults??[]).find(r=>String(r.replayName)===String(model.replayName));
  const sweep=validation?.aggregateSameTeamRadiusSweep??[];
  const maxRecovered=Math.max(1,...sweep.map(x=>Number(x.recoveredFromCurrentNonisolated)||0));
  const radiusBars=sweep.map(x=>{const n=Number(x.recoveredFromCurrentNonisolated)||0;const width=Math.max(0,Math.min(100,n/maxRecovered*100));return `<div class="ws-validation-radius"><span>±${escapeHtml(x.sameTeamIsolationRadiusTicks)} tick${Number(x.sameTeamIsolationRadiusTicks)===1?'':'s'}</span><div><i style="width:${width.toFixed(2)}%"></i></div><strong>${n.toLocaleString()}</strong></div>`;}).join('');
  const replayRows=(validation?.replayResults??[]).map(r=>`<div class="ws-validation-replay ${String(r.replayName)===String(model.replayName)?'selected':''}"><span>${escapeHtml(r.replayName)}</span><strong>${Number(r.exactTickSameTeamRule?.recoveredEvents??0).toLocaleString()}</strong><small>+ candidates · ${formatPercent(r.exactTickSameTeamRule?.hypotheticalResolvedShareOfLifecycle)}</small></div>`).join('');
  return `<article class="ws-card ws-audit-card ws-validation-card" draggable="true" data-ws-panel="${escapeHtml(panel.id)}">
    <div class="ws-card-head">
      <button type="button" class="ws-drag" data-ws-drag title="Drag to reorder" aria-label="Drag panel to reorder">⋮⋮</button>
      <div class="ws-card-title"><span class="badge b">B</span><strong>Ground Soul narrow-isolation validation</strong><span class="ws-derived">cross-replay V03</span></div>
      <div class="ws-card-actions">
        <button type="button" class="ghost compact" data-ws-action="left" data-panel="${escapeHtml(panel.id)}" ${index===0?'disabled':''} title="Move left">←</button>
        <button type="button" class="ghost compact" data-ws-action="right" data-panel="${escapeHtml(panel.id)}" ${index===workspaceState.panels.length-1?'disabled':''} title="Move right">→</button>
        <button type="button" class="ghost compact" data-ws-action="duplicate" data-panel="${escapeHtml(panel.id)}" title="Duplicate panel">⧉</button>
        <button type="button" class="ghost compact" data-ws-action="remove" data-panel="${escapeHtml(panel.id)}" title="Remove panel">×</button>
      </div>
    </div>
    ${loaded?`
      <div class="ws-audit-context"><span><strong>${escapeHtml(validation.status)}</strong></span><span>${escapeHtml(validation.validation?.replicationStatus??'replication unavailable')}</span><span>${escapeHtml(validation.validation?.semanticValidation??'semantic validation unavailable')}</span></div>
      <div class="ws-collision-summary">
        <div><span>Current A events · cohort</span><strong>${Number(aggregate.currentResolvedAEvents??0).toLocaleString()}</strong></div>
        <div><span>Exact-tick recovered candidates</span><strong>${Number(aggregate.exactTickRecoveredEvents??0).toLocaleString()}</strong></div>
        <div><span>Hypothetical resolved total</span><strong>${Number(aggregate.exactTickHypotheticalResolvedTotal??0).toLocaleString()}</strong></div>
        <div><span>Hypothetical lifecycle coverage</span><strong>${formatPercent(aggregate.exactTickHypotheticalResolvedShareOfLifecycle)}</strong></div>
      </div>
      <div class="ws-collision-counterfactual"><strong>Selected replay:</strong> ${replayRow?`${escapeHtml(replayRow.replayName)} would recover ${Number(replayRow.exactTickSameTeamRule?.recoveredEvents??0).toLocaleString()} candidates, for a hypothetical ${formatPercent(replayRow.exactTickSameTeamRule?.hypotheticalResolvedShareOfLifecycle)} lifecycle-resolution share.`:`${escapeHtml(model.replayName??'this replay')} is not one of the rep01–rep05 validation replays.`}</div>
      <div class="ws-validation-columns">
        <div><div class="ws-audit-heading">Same-team radius sensitivity · pooled</div><div class="ws-validation-radius-list">${radiusBars||'<div class="muted">No radius sweep.</div>'}</div></div>
        <div><div class="ws-audit-heading">Independent replay results</div><div class="ws-validation-replays">${replayRows||'<div class="muted">No replay rows.</div>'}</div></div>
      </div>
      <div class="ws-validation-integrity"><span>Duplicate same-team resolution boundaries <strong>${Number(aggregate.duplicateSameTeamResolutionBoundaryKeys??0).toLocaleString()}</strong></span><span>Duplicate recipient-transition keys <strong>${Number(aggregate.duplicateRecipientTransitionKeys??0).toLocaleString()}</strong></span><span>Recommendation <strong>${escapeHtml(validation.interpretation?.productionRecommendation??'—')}</strong></span></div>
      <div class="ws-note"><strong>Authority boundary:</strong> V03 validates whether the narrower rule is mechanically deterministic and cross-replay supported within the existing exact-tick currency-carrier semantics. It does not add recovered candidates to A and does not modify the production resolver or 77/77 ledger.</div>`:
      `<div class="ws-audit-missing"><strong>Cross-replay Narrow-Isolation Validation V03 output not found.</strong><span>Run <span class="mono">.\\inspector-v04\\run-ground-soul-narrow-isolation-validation.ps1 -Prepare</span>. The preparation step processes rep01–rep05 and may take several minutes.</span></div>`}
  </article>`;
}

function renderMetricPanel(panel,index,model,registry,currentTime,baselineTime){
  const metric=METRICS[panel.metricId]??METRICS.gold_networth;
  const player=resolvePanelPlayer(panel,model);
  const current=player?finite(metric.valueAt(player,model,currentTime)):null;
  const baseline=player?finite(metric.valueAt(player,model,baselineTime)):null;
  const delta=current===null||baseline===null?null:current-baseline;
  const source=registry.get(metric.sourceMetricId);
  const authority=source?.status??'—';
  const playerLabel=metric.matchScoped?'Match-wide':(player?.playerName??'No player');
  const chart=player?miniChart(metric,player,model,currentTime,baselineTime):'<div class="ws-chart-empty">No player data.</div>';
  const detail=deltaDetail(metric,current,baseline,delta,currentTime,baselineTime);
  return `<article class="ws-card" draggable="true" data-ws-panel="${escapeHtml(panel.id)}">
    <div class="ws-card-head">
      <button type="button" class="ws-drag" data-ws-drag title="Drag to reorder" aria-label="Drag panel to reorder">⋮⋮</button>
      <div class="ws-card-title"><span class="badge ${authority==='A'?'a':authority==='B'?'b':'warn'}">${escapeHtml(authority)}</span><strong>${escapeHtml(metric.label)}</strong>${metric.derivedView?'<span class="ws-derived">derived view</span>':''}</div>
      <div class="ws-card-actions">
        <button type="button" class="ghost compact" data-ws-action="left" data-panel="${escapeHtml(panel.id)}" ${index===0?'disabled':''} title="Move left">←</button>
        <button type="button" class="ghost compact" data-ws-action="right" data-panel="${escapeHtml(panel.id)}" ${index===workspaceState.panels.length-1?'disabled':''} title="Move right">→</button>
        <button type="button" class="ghost compact" data-ws-action="duplicate" data-panel="${escapeHtml(panel.id)}" title="Duplicate panel">⧉</button>
        <button type="button" class="ghost compact" data-ws-action="remove" data-panel="${escapeHtml(panel.id)}" title="Remove panel">×</button>
      </div>
    </div>
    <div class="ws-selectors">
      <label>Statistic<select data-ws-metric="${escapeHtml(panel.id)}">${metricOptions(panel.metricId)}</select></label>
      <label>Player<select data-ws-player="${escapeHtml(panel.id)}" ${metric.matchScoped?'disabled':''}>${playerOptions(model,panel.playerName)}</select></label>
    </div>
    <div class="ws-value-row">
      <div><div class="ws-caption">${escapeHtml(playerLabel)} · ${clock(currentTime)}</div><div class="ws-current">${formatMetric(metric,current)}</div></div>
      <div class="ws-delta ${delta===null?'neutral':delta>0?'up':delta<0?'down':'neutral'}"><div class="ws-caption">Change from ${clock(baselineTime)}</div><strong>${formatDelta(metric,delta)}</strong>${deltaPercent(metric,baseline,delta)}</div>
    </div>
    <div class="ws-chart">${chart}</div>
    <div class="ws-panel-foot"><span>${escapeHtml(metric.unit)}</span><span>${source?.label?escapeHtml(source.label):escapeHtml(metric.sourceMetricId)}</span></div>
    ${detail}
  </article>`;
}

function bindWorkspaceControls(model){
  const main=document.querySelector('#main');
  if(!main)return;
  main.querySelector('[data-ws-action="add"]')?.addEventListener('click',()=>{
    const selected=document.querySelector('#playerSelect')?.value??model.players?.[0]?.playerName??null;
    workspaceState.panels.push(makePanel('gold_networth',selected));saveWorkspaceState();renderWorkspace();
  });
  main.querySelector('[data-ws-action="add-spatial"]')?.addEventListener('click',()=>{
    const selected=document.querySelector('#playerSelect')?.value??model.players?.[0]?.playerName??null;
    workspaceState.panels.push(makeSpatialPanel(selected));saveWorkspaceState();renderWorkspace();
  });
  main.querySelector('[data-ws-action="add-ground-soul-audit"]')?.addEventListener('click',()=>{workspaceState.panels.push(makeGroundSoulAuditPanel());saveWorkspaceState();renderWorkspace();});
  main.querySelector('[data-ws-action="add-ground-soul-collisions"]')?.addEventListener('click',()=>{workspaceState.panels.push(makeGroundSoulCollisionPanel());saveWorkspaceState();renderWorkspace();});
  main.querySelector('[data-ws-action="add-ground-soul-isolation-validation"]')?.addEventListener('click',()=>{workspaceState.panels.push(makeGroundSoulIsolationValidationPanel());saveWorkspaceState();renderWorkspace();});
  main.querySelector('[data-ws-action="play"]')?.addEventListener('click',()=>toggleWorkspacePlayback(model));
  main.querySelector('[data-ws-action="back-5"]')?.addEventListener('click',()=>nudgeWorkspaceTime(model,-5));
  main.querySelector('[data-ws-action="forward-5"]')?.addEventListener('click',()=>nudgeWorkspaceTime(model,5));
  main.querySelector('[data-ws-speed]')?.addEventListener('change',e=>{workspacePlaybackSpeed=Number(e.target.value)||1;});
  main.querySelector('[data-ws-action="baseline"]')?.addEventListener('click',()=>{workspaceState.baseline=Number(document.querySelector('#timeSlider')?.value??0);saveWorkspaceState();renderWorkspace();});
  main.querySelector('[data-ws-action="baseline-zero"]')?.addEventListener('click',()=>{workspaceState.baseline=0;saveWorkspaceState();renderWorkspace();});
  main.querySelector('[data-ws-action="reset"]')?.addEventListener('click',()=>{resetWorkspaceState(model);saveWorkspaceState();renderWorkspace();});
  main.querySelector('[data-ws-columns]')?.addEventListener('change',e=>{workspaceState.columns=e.target.value;saveWorkspaceState();renderWorkspace();});
  main.querySelectorAll('[data-ws-metric]').forEach(sel=>sel.addEventListener('change',e=>{const p=findPanel(e.target.dataset.wsMetric);if(p){p.metricId=e.target.value;saveWorkspaceState();renderWorkspace();}}));
  main.querySelectorAll('[data-ws-player]').forEach(sel=>sel.addEventListener('change',e=>{const p=findPanel(e.target.dataset.wsPlayer);if(p){p.playerName=e.target.value;saveWorkspaceState();renderWorkspace();}}));
  main.querySelectorAll('[data-ws-spatial-view]').forEach(sel=>sel.addEventListener('change',e=>{const p=findPanel(e.target.dataset.wsSpatialView);if(p){p.spatialView=e.target.value;saveWorkspaceState();renderWorkspace();}}));
  main.querySelectorAll('[data-ws-heat-window]').forEach(sel=>sel.addEventListener('change',e=>{const p=findPanel(e.target.dataset.wsHeatWindow);if(p){p.heatWindow=e.target.value;saveWorkspaceState();renderWorkspace();}}));
  main.querySelectorAll('[data-ws-action][data-panel]').forEach(btn=>btn.addEventListener('click',()=>panelAction(btn.dataset.wsAction,btn.dataset.panel,model)));
  main.querySelectorAll('[data-ws-audit-time]').forEach(btn=>btn.addEventListener('click',()=>setWorkspaceTime(model,Number(btn.dataset.wsAuditTime))));
  bindDragAndDrop(main);
}

function panelAction(action,id,model){
  const idx=workspaceState.panels.findIndex(p=>p.id===id);if(idx<0)return;
  if(action==='remove'){workspaceState.panels.splice(idx,1);if(!workspaceState.panels.length)workspaceState.panels.push(makePanel('gold_networth',document.querySelector('#playerSelect')?.value??model.players?.[0]?.playerName??null));}
  if(action==='duplicate'){const src=workspaceState.panels[idx];workspaceState.panels.splice(idx+1,0,{...src,id:newPanelId()});}
  if(action==='left'&&idx>0)[workspaceState.panels[idx-1],workspaceState.panels[idx]]=[workspaceState.panels[idx],workspaceState.panels[idx-1]];
  if(action==='right'&&idx<workspaceState.panels.length-1)[workspaceState.panels[idx+1],workspaceState.panels[idx]]=[workspaceState.panels[idx],workspaceState.panels[idx+1]];
  saveWorkspaceState();renderWorkspace();
}

function bindDragAndDrop(main){
  main.querySelectorAll('[data-ws-panel]').forEach(card=>{
    card.addEventListener('dragstart',e=>{dragPanelId=card.dataset.wsPanel;card.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragPanelId);});
    card.addEventListener('dragend',()=>{dragPanelId=null;main.querySelectorAll('.ws-card').forEach(x=>x.classList.remove('dragging','drag-over'));});
    card.addEventListener('dragover',e=>{e.preventDefault();if(dragPanelId&&dragPanelId!==card.dataset.wsPanel)card.classList.add('drag-over');});
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
    card.addEventListener('drop',e=>{e.preventDefault();card.classList.remove('drag-over');const source=e.dataTransfer.getData('text/plain')||dragPanelId;const target=card.dataset.wsPanel;if(!source||source===target)return;reorderPanels(source,target);});
  });
}

function reorderPanels(sourceId,targetId){
  const from=workspaceState.panels.findIndex(p=>p.id===sourceId),to=workspaceState.panels.findIndex(p=>p.id===targetId);if(from<0||to<0)return;
  const [moved]=workspaceState.panels.splice(from,1);workspaceState.panels.splice(to,0,moved);saveWorkspaceState();renderWorkspace();
}

function miniChart(metric,player,model,currentTime,baselineTime){
  const end=Math.max(1,Number(model.match?.matchDurationSeconds)||1);
  const count=Math.min(320,Math.max(80,Math.round(end/4)));
  const points=[];
  for(let i=0;i<=count;i++){const time=end*i/count;const value=finite(metric.valueAt(player,model,time));if(value!==null)points.push({time,value});}
  if(points.length<2)return '<div class="ws-chart-empty">No time series available for this card.</div>';
  let min=Math.min(...points.map(x=>x.value)),max=Math.max(...points.map(x=>x.value));
  if(min===max){const pad=Math.max(1,Math.abs(min)*.05);min-=pad;max+=pad;}
  const w=640,h=180,padX=10,padY=12;
  const x=t=>padX+(w-padX*2)*(t/end),y=v=>h-padY-(h-padY*2)*((v-min)/(max-min));
  let d='';
  points.forEach((pt,i)=>{d+=`${i?'L':'M'}${x(pt.time).toFixed(2)},${y(pt.value).toFixed(2)} `;});
  const cx=x(currentTime),bx=x(baselineTime),current=finite(metric.valueAt(player,model,currentTime));
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(metric.label)} over match time">
    <line class="ws-gridline" x1="${padX}" y1="${y(max)}" x2="${w-padX}" y2="${y(max)}"></line>
    <line class="ws-gridline" x1="${padX}" y1="${y(min)}" x2="${w-padX}" y2="${y(min)}"></line>
    <line class="ws-baseline-line" x1="${bx}" y1="0" x2="${bx}" y2="${h}"></line>
    <line class="ws-current-line" x1="${cx}" y1="0" x2="${cx}" y2="${h}"></line>
    <path class="ws-series-line" d="${d.trim()}"></path>
    ${current===null?'':`<circle class="ws-current-dot" cx="${cx}" cy="${y(current)}" r="4"></circle>`}
    <text class="ws-chart-label" x="${padX}" y="11">${escapeHtml(formatMetric(metric,max))}</text>
    <text class="ws-chart-label" x="${padX}" y="${h-3}">${escapeHtml(formatMetric(metric,min))}</text>
    <text class="ws-chart-label end" x="${w-padX}" y="${h-3}">${escapeHtml(clock(end))}</text>
  </svg>`;
}

function deltaDetail(metric,current,baseline,delta,currentTime,baselineTime){
  if(current===null||baseline===null)return '<div class="ws-note">Current or baseline value is unavailable for this card.</div>';
  const direction=delta>0?'increased':delta<0?'decreased':'did not change';
  return `<div class="ws-note">${escapeHtml(metric.label)} ${direction} from ${formatMetric(metric,baseline)} at ${clock(baselineTime)} to ${formatMetric(metric,current)} at ${clock(currentTime)}.</div>`;
}

function metricOptions(selected){return Object.entries(METRICS).map(([id,m])=>`<option value="${escapeHtml(id)}" ${id===selected?'selected':''}>${escapeHtml(m.label)}</option>`).join('');}
function playerOptions(model,selected){return (model.players??[]).map(p=>`<option value="${escapeHtml(p.playerName)}" ${String(p.playerName)===String(selected)?'selected':''}>T${escapeHtml(p.team??'—')} · ${escapeHtml(p.identity?.heroDisplayName??`H${p.heroId??'?'}`)} · ${escapeHtml(p.playerName)}</option>`).join('');}

function ensureWorkspacePanels(model){
  const players=model.players??[];const selected=document.querySelector('#playerSelect')?.value??players[0]?.playerName??null;
  if(!Array.isArray(workspaceState.panels)||!workspaceState.panels.length){resetWorkspaceState(model);return;}
  for(const p of workspaceState.panels){
    p.kind=p.kind==='spatial'?'spatial':p.kind==='groundSoulAudit'?'groundSoulAudit':p.kind==='groundSoulCollision'?'groundSoulCollision':p.kind==='groundSoulIsolationValidation'?'groundSoulIsolationValidation':'metric';
    if(p.kind==='metric'&&!METRICS[p.metricId])p.metricId='gold_networth';
    if(p.kind==='spatial'){p.spatialView=p.spatialView??'heat-trail';p.heatWindow=p.heatWindow??'120';}
    if(!['groundSoulAudit','groundSoulCollision','groundSoulIsolationValidation'].includes(p.kind)&&!players.some(x=>String(x.playerName)===String(p.playerName)))p.playerName=selected;
  }
}
function resetWorkspaceState(model){const selected=document.querySelector('#playerSelect')?.value??model.players?.[0]?.playerName??null;workspaceState.baseline=0;workspaceState.columns='auto';workspaceState.panels=[makePanel('gold_networth',selected),makePanel('health',selected),makePanel('ground_soul_economic_gain',selected)];}
function makePanel(metricId,playerName){return {id:newPanelId(),kind:'metric',metricId,playerName};}
function makeSpatialPanel(playerName){return {id:newPanelId(),kind:'spatial',playerName,spatialView:'heat-trail',heatWindow:'120'};}
function makeGroundSoulAuditPanel(){return {id:newPanelId(),kind:'groundSoulAudit'};}
function makeGroundSoulCollisionPanel(){return {id:newPanelId(),kind:'groundSoulCollision'};}
function makeGroundSoulIsolationValidationPanel(){return {id:newPanelId(),kind:'groundSoulIsolationValidation'};}
function newPanelId(){return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
function findPanel(id){return workspaceState.panels.find(p=>p.id===id);}
function resolvePanelPlayer(panel,model){return (model.players??[]).find(p=>String(p.playerName)===String(panel.playerName))??model.players?.[0]??null;}

async function getWorkspaceModel(replay){if(workspaceModel&&workspaceReplay===replay)return workspaceModel;workspaceModel=await apiJson(`/api/replay/${encodeURIComponent(replay)}/model`);workspaceReplay=replay;return workspaceModel;}
async function getWorkspaceRegistry(){if(workspaceRegistry)return workspaceRegistry;const data=await apiJson('/api/metrics');const map=new Map();for(const s of data.sections??[])for(const m of s.metrics??[])map.set(m.id,m);workspaceRegistry=map;return map;}
async function getWorkspaceAudit(replay){if(workspaceAuditReplay===replay)return workspaceAudit;try{workspaceAudit=await apiJson(`/api/replay/${encodeURIComponent(replay)}/ground-soul-coverage`);}catch(err){if(String(err?.message??err).startsWith('404'))workspaceAudit={missing:true};else throw err;}workspaceAuditReplay=replay;return workspaceAudit;}
async function getWorkspaceCollisionAudit(replay){if(workspaceCollisionReplay===replay)return workspaceCollisionAudit;try{workspaceCollisionAudit=await apiJson(`/api/replay/${encodeURIComponent(replay)}/ground-soul-collisions`);}catch(err){if(String(err?.message??err).startsWith('404'))workspaceCollisionAudit={missing:true};else throw err;}workspaceCollisionReplay=replay;return workspaceCollisionAudit;}
async function getWorkspaceNarrowValidation(){if(workspaceNarrowValidation)return workspaceNarrowValidation;try{workspaceNarrowValidation=await apiJson('/api/research/ground-soul-narrow-isolation-validation');}catch(err){if(String(err?.message??err).startsWith('404'))workspaceNarrowValidation={missing:true};else throw err;}return workspaceNarrowValidation;}
async function apiJson(url){const r=await fetch(url);if(!r.ok)throw new Error(`${r.status} ${await r.text()}`);return r.json();}

function stateAt(p,time){const tl=p?.timeline??[];if(!tl.length)return null;let lo=0,hi=tl.length-1,best=tl[0];while(lo<=hi){const mid=(lo+hi)>>1,x=tl[mid];if((x.matchTime??-Infinity)<=time){best=x;lo=mid+1;}else hi=mid-1;}return best;}
function teamAt(model,team,time){const series=model.teamSeries??[];if(!series.length)return null;const idx=Math.max(0,Math.min(series.length-1,Math.floor(time)));return series[idx]?.teams?.[String(team)]??null;}
function otherTeamAt(model,team,time){const series=model.teamSeries??[];if(!series.length)return null;const idx=Math.max(0,Math.min(series.length-1,Math.floor(time))),teams=series[idx]?.teams??{};const key=Object.keys(teams).find(k=>String(k)!==String(team));return key?teams[key]:null;}
function itemsAt(p,time){return (p.items?.ownershipIntervals??[]).filter(x=>(x.startTime??Infinity)<=time&&(x.endReason==='REPLAY_END'?time<=(x.endTime??-Infinity):time<(x.endTime??-Infinity)));}
function permanentAt(p,time){let out={};for(const e of p.permanentBuffs?.events??[]){if((e.time??Infinity)<=time)out=e.state??out;else break;}return out;}
function permanentUnits(state){return Object.values(state??{}).reduce((n,x)=>n+(Number(x?.inferredUnits)||0),0);}
function bridgesAt(p,time){return (p.bridgeBuffs?.intervals??[]).filter(x=>(x.startTime??Infinity)<=time&&time<(x.endTime??-Infinity));}
function bridgeUptimeThrough(p,time){let total=0;for(const x of p.bridgeBuffs?.intervals??[]){const a=finite(x.startTime),b=finite(x.endTime);if(a===null||b===null||time<=a)continue;total+=Math.max(0,Math.min(time,b)-a);}return total;}
function deathCountThrough(p,time){const rows=p.core?.deathTimings??p.core?.deathsObserved??[];return (rows??[]).filter(x=>finite(x?.time??x?.matchTime??x)<=time).length;}
function groundSoulGainAt(model,p,time){const rows=model.groundSoulEconomicCredit?.summary?.byPlayer??[];const steam=String(p?.identity?.steamId??''),name=String(p?.playerName??'');const row=rows.find(x=>steam&&String(x.steamId??'')===steam)??rows.find(x=>String(x.playerName??'')===name);const tl=row?.cumulativeTimeline??[];let lo=0,hi=tl.length-1,best=null;while(lo<=hi){const mid=(lo+hi)>>1,x=tl[mid];if(finite(x?.matchTime)<=time){best=x;lo=mid+1;}else hi=mid-1;}return best?finite(best.cumulativeCurrency0Delta)??0:0;}
function groundSoulActivationsAt(model,time){const tl=model.groundSoulLifecycle?.summary?.cumulativeTimeline??[];let lo=0,hi=tl.length-1,best=null;while(lo<=hi){const mid=(lo+hi)>>1,x=tl[mid];if(finite(x?.matchTime)<=time){best=x;lo=mid+1;}else hi=mid-1;}return best?finite(best.activations)??0:0;}

function toggleWorkspacePlayback(model){
  if(workspacePlaybackTimer){stopWorkspacePlayback();renderWorkspace();return;}
  const slider=document.querySelector('#timeSlider');if(!slider)return;
  if(Number(slider.value)>=Number(model.match?.matchDurationSeconds??0)-0.05)slider.value=0;
  let last=performance.now();
  workspacePlaybackTimer=setInterval(()=>{
    if(!workspaceActive){stopWorkspacePlayback();return;}
    const now=performance.now(),dt=Math.min(.5,Math.max(0,(now-last)/1000));last=now;
    const end=Math.max(0,Number(model.match?.matchDurationSeconds)||0);
    const next=Math.min(end,Number(slider.value||0)+dt*workspacePlaybackSpeed);
    slider.value=String(next);slider.dispatchEvent(new Event('input',{bubbles:true}));
    if(next>=end)stopWorkspacePlayback();
  },100);
  renderWorkspace();
}
function stopWorkspacePlayback(){if(workspacePlaybackTimer){clearInterval(workspacePlaybackTimer);workspacePlaybackTimer=null;}}
function nudgeWorkspaceTime(model,delta){const slider=document.querySelector('#timeSlider');if(!slider)return;slider.value=String(clampTime(Number(slider.value||0)+delta,model));slider.dispatchEvent(new Event('input',{bubbles:true}));}
function setWorkspaceTime(model,time){const slider=document.querySelector('#timeSlider');if(!slider)return;slider.value=String(clampTime(Number(time)||0,model));slider.dispatchEvent(new Event('input',{bubbles:true}));}

function spatialBounds(model){
  const xs=[],ys=[];
  for(const p of model.players??[])for(const s of p.timeline??[]){if(validPosition(s?.position)){xs.push(Number(s.position[0]));ys.push(Number(s.position[1]));}}
  if(xs.length<2)return {minX:-1,maxX:1,minY:-1,maxY:1};
  xs.sort((a,b)=>a-b);ys.sort((a,b)=>a-b);
  const lo=Math.max(0,Math.floor(xs.length*.002)),hi=Math.min(xs.length-1,Math.ceil(xs.length*.998)-1);
  let minX=xs[lo],maxX=xs[hi],minY=ys[lo],maxY=ys[hi];
  if(!(maxX>minX)){minX-=1;maxX+=1;}if(!(maxY>minY)){minY-=1;maxY+=1;}
  const px=(maxX-minX)*.04,py=(maxY-minY)*.04;
  return {minX:minX-px,maxX:maxX+px,minY:minY-py,maxY:maxY+py};
}
function validPosition(pos){return Array.isArray(pos)&&pos.length>=2&&Number.isFinite(Number(pos[0]))&&Number.isFinite(Number(pos[1]));}
function spatialOccupancy(player,currentTime,windowSeconds,bounds){
  const cols=30,rows=30,cells=new Float64Array(cols*rows);const timeline=player?.timeline??[];
  const start=windowSeconds===null?0:Math.max(0,currentTime-windowSeconds);
  let observedAliveSeconds=0,sampleIntervals=0,skippedGapSeconds=0;
  for(let i=0;i<timeline.length-1;i++){
    const a=timeline[i],b=timeline[i+1],ta=finite(a?.matchTime),tb=finite(b?.matchTime);
    if(ta===null||tb===null||tb<=start||ta>=currentTime||!validPosition(a?.position)||!a?.alive)continue;
    const rawDt=tb-ta;if(!(rawDt>0))continue;
    const overlap=Math.max(0,Math.min(tb,currentTime)-Math.max(ta,start));if(overlap<=0)continue;
    if(rawDt>3){skippedGapSeconds+=overlap;continue;}
    const x=Number(a.position[0]),y=Number(a.position[1]);
    const cx=Math.max(0,Math.min(cols-1,Math.floor((x-bounds.minX)/(bounds.maxX-bounds.minX)*cols)));
    const cy=Math.max(0,Math.min(rows-1,Math.floor((y-bounds.minY)/(bounds.maxY-bounds.minY)*rows)));
    cells[cy*cols+cx]+=overlap;observedAliveSeconds+=overlap;sampleIntervals++;
  }
  let peakCellSeconds=0,occupiedCells=0;for(const v of cells){if(v>0){occupiedCells++;peakCellSeconds=Math.max(peakCellSeconds,v);}}
  return {cols,rows,cells,observedAliveSeconds,sampleIntervals,skippedGapSeconds,peakCellSeconds,occupiedCells,startTime:start,endTime:currentTime};
}
function spatialReplaySvg(player,model,currentTime,bounds,occupancy,view){
  const w=720,h=420,pad=18;const spanX=bounds.maxX-bounds.minX||1,spanY=bounds.maxY-bounds.minY||1;
  const sx=x=>pad+(w-pad*2)*Math.max(0,Math.min(1,(Number(x)-bounds.minX)/spanX));
  const sy=y=>h-pad-(h-pad*2)*Math.max(0,Math.min(1,(Number(y)-bounds.minY)/spanY));
  const showHeat=view==='heat'||view==='heat-trail',showTrail=view==='trail'||view==='heat-trail';
  let heat='';
  if(showHeat&&occupancy?.peakCellSeconds>0){
    const cw=(w-pad*2)/occupancy.cols,ch=(h-pad*2)/occupancy.rows;
    for(let row=0;row<occupancy.rows;row++)for(let col=0;col<occupancy.cols;col++){
      const seconds=occupancy.cells[row*occupancy.cols+col];if(seconds<=0)continue;
      const intensity=Math.sqrt(seconds/occupancy.peakCellSeconds);const opacity=(.08+.72*intensity).toFixed(3);
      const x=pad+col*cw,y=h-pad-(row+1)*ch;
      heat+=`<rect class="ws-heat-cell" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cw+.4).toFixed(2)}" height="${(ch+.4).toFixed(2)}" style="opacity:${opacity}"><title>${seconds.toFixed(1)} s observed alive-time occupancy</title></rect>`;
    }
  }
  const start=occupancy?.startTime??0;let trail='';
  if(showTrail){const pts=[];for(const s of player.timeline??[]){const t=finite(s?.matchTime);if(t===null||t<start||t>currentTime||!s?.alive||!validPosition(s?.position))continue;pts.push(`${sx(s.position[0]).toFixed(1)},${sy(s.position[1]).toFixed(1)}`);}if(pts.length>1)trail=`<polyline class="ws-spatial-trail" points="${pts.join(' ')}"></polyline>`;}
  const current=stateAt(player,currentTime),pos=validPosition(current?.position)?current.position:null;
  const marker=pos?`<circle class="ws-spatial-marker ${current?.alive?'alive':'dead'}" cx="${sx(pos[0]).toFixed(1)}" cy="${sy(pos[1]).toFixed(1)}" r="7"></circle><circle class="ws-spatial-marker-ring" cx="${sx(pos[0]).toFixed(1)}" cy="${sy(pos[1]).toFixed(1)}" r="12"></circle>`:'';
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="World-coordinate player replay and heat map through ${escapeHtml(clock(currentTime,true))}">
    <rect class="ws-spatial-bg" x="${pad}" y="${pad}" width="${w-pad*2}" height="${h-pad*2}" rx="4"></rect>
    <line class="ws-spatial-axis" x1="${pad}" y1="${h/2}" x2="${w-pad}" y2="${h/2}"></line><line class="ws-spatial-axis" x1="${w/2}" y1="${pad}" x2="${w/2}" y2="${h-pad}"></line>
    ${heat}${trail}${marker}
    <text class="ws-spatial-label" x="${pad+6}" y="${pad+14}">diagnostic world-coordinate plane</text>
    <text class="ws-spatial-label end" x="${w-pad-6}" y="${h-pad-6}">${escapeHtml(clock(currentTime))}</text>
  </svg>`;
}
function formatWindow(seconds){const n=Number(seconds)||0;return n<60?`${n} s`:`${n/60} min`;}
function formatCoord(value){const n=Number(value);return Number.isFinite(n)?Math.round(n).toLocaleString():'—';}
function formatObservedSeconds(value){const n=Number(value);return Number.isFinite(n)?`${n.toFixed(n<10?1:0)} s`:'0 s';}

function formatMetric(metric,value){if(value===null||value===undefined||!Number.isFinite(Number(value)))return '—';const n=Number(value);if(metric.format==='percent')return `${(n*100).toFixed(1)}%`;if(metric.format==='duration')return duration(n);const d=Number.isInteger(metric.decimals)?metric.decimals:(Math.abs(n)<10?2:0);return n.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});}
function formatDelta(metric,delta){if(delta===null)return '—';if(metric.format==='percent')return `${delta>=0?'+':''}${(delta*100).toFixed(1)} pp`;if(metric.format==='duration')return `${delta>=0?'+':'−'}${duration(Math.abs(delta))}`;const d=Number.isInteger(metric.decimals)?metric.decimals:(Math.abs(delta)<10?2:0);return `${delta>0?'+':''}${delta.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d})}`;}
function deltaPercent(metric,baseline,delta){if(delta===null||baseline===null||baseline===0||metric.format==='percent'||metric.signed)return '';const pct=delta/Math.abs(baseline);if(!Number.isFinite(pct))return '';return `<span>${pct>=0?'+':''}${(pct*100).toFixed(1)}%</span>`;}
function duration(seconds){const n=Math.max(0,Number(seconds)||0),m=Math.floor(n/60),s=n-m*60;return `${m}:${s.toFixed(s<10?1:0).padStart(s<10?4:2,'0')}`;}
function clock(seconds,ms=false){const n=Math.max(0,Number(seconds)||0),m=Math.floor(n/60),s=n-m*60;if(ms)return `${m}:${s.toFixed(3).padStart(6,'0')}`;return `${m}:${Math.floor(s).toString().padStart(2,'0')}`;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clampTime(v,model){const end=Math.max(0,Number(model.match?.matchDurationSeconds)||0);return Math.min(end,Math.max(0,Number.isFinite(v)?v:0));}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function loadWorkspaceState(){
  try{const x=JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)||'null');if(x&&Array.isArray(x.panels))return {baseline:Number(x.baseline)||0,columns:String(x.columns??'auto'),panels:x.panels.map(p=>({id:String(p.id||newPanelId()),kind:p.kind==='spatial'?'spatial':p.kind==='groundSoulAudit'?'groundSoulAudit':p.kind==='groundSoulCollision'?'groundSoulCollision':p.kind==='groundSoulIsolationValidation'?'groundSoulIsolationValidation':'metric',metricId:String(p.metricId||'gold_networth'),playerName:p.playerName==null?null:String(p.playerName),spatialView:String(p.spatialView??'heat-trail'),heatWindow:String(p.heatWindow??'120')}))};}catch{}
  return {baseline:0,columns:'auto',panels:[]};
}
function saveWorkspaceState(){try{localStorage.setItem(WORKSPACE_STORAGE_KEY,JSON.stringify(workspaceState));}catch{}}
