const WORKSPACE_TAB_ID='modular-workspace';
const WORKSPACE_STORAGE_KEY='deadlockBehavior.modularWorkspace.v01';
let workspaceActive=false;
let workspaceModel=null;
let workspaceRegistry=null;
let workspaceReplay=null;
let workspaceRenderToken=0;
let workspaceRaf=0;
let dragPanelId=null;

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
    if(b.id!==WORKSPACE_TAB_ID && b.classList.contains('tab'))workspaceActive=false;
  });
}

document.querySelector('#timeSlider')?.addEventListener('input',()=>queueWorkspaceRender());
document.querySelector('#playerSelect')?.addEventListener('change',()=>queueWorkspaceRender());
document.querySelector('#replaySelect')?.addEventListener('change',()=>{workspaceModel=null;workspaceReplay=null;queueWorkspaceRender(100);});
document.querySelector('#refreshBtn')?.addEventListener('click',()=>{workspaceModel=null;workspaceReplay=null;queueWorkspaceRender(500);});
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
          <p>Every card follows the global scrubber. Pin a baseline, compare current-minus-baseline change, duplicate cards across players, and drag cards into the order you want.</p>
        </div>
        <div class="ws-toolbar-controls">
          <button type="button" class="primary" data-ws-action="add">+ Add panel</button>
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
        ${workspaceState.panels.map((panel,index)=>renderPanel(panel,index,model,registry,currentTime,workspaceState.baseline)).join('')}
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

function renderPanel(panel,index,model,registry,currentTime,baselineTime){
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
  main.querySelector('[data-ws-action="baseline"]')?.addEventListener('click',()=>{workspaceState.baseline=Number(document.querySelector('#timeSlider')?.value??0);saveWorkspaceState();renderWorkspace();});
  main.querySelector('[data-ws-action="baseline-zero"]')?.addEventListener('click',()=>{workspaceState.baseline=0;saveWorkspaceState();renderWorkspace();});
  main.querySelector('[data-ws-action="reset"]')?.addEventListener('click',()=>{resetWorkspaceState(model);saveWorkspaceState();renderWorkspace();});
  main.querySelector('[data-ws-columns]')?.addEventListener('change',e=>{workspaceState.columns=e.target.value;saveWorkspaceState();renderWorkspace();});
  main.querySelectorAll('[data-ws-metric]').forEach(sel=>sel.addEventListener('change',e=>{const p=findPanel(e.target.dataset.wsMetric);if(p){p.metricId=e.target.value;saveWorkspaceState();renderWorkspace();}}));
  main.querySelectorAll('[data-ws-player]').forEach(sel=>sel.addEventListener('change',e=>{const p=findPanel(e.target.dataset.wsPlayer);if(p){p.playerName=e.target.value;saveWorkspaceState();renderWorkspace();}}));
  main.querySelectorAll('[data-ws-action][data-panel]').forEach(btn=>btn.addEventListener('click',()=>panelAction(btn.dataset.wsAction,btn.dataset.panel,model)));
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
  for(const p of workspaceState.panels){if(!METRICS[p.metricId])p.metricId='gold_networth';if(!players.some(x=>String(x.playerName)===String(p.playerName)))p.playerName=selected;}
}
function resetWorkspaceState(model){const selected=document.querySelector('#playerSelect')?.value??model.players?.[0]?.playerName??null;workspaceState.baseline=0;workspaceState.columns='auto';workspaceState.panels=[makePanel('gold_networth',selected),makePanel('health',selected),makePanel('ground_soul_economic_gain',selected)];}
function makePanel(metricId,playerName){return {id:newPanelId(),metricId,playerName};}
function newPanelId(){return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
function findPanel(id){return workspaceState.panels.find(p=>p.id===id);}
function resolvePanelPlayer(panel,model){return (model.players??[]).find(p=>String(p.playerName)===String(panel.playerName))??model.players?.[0]??null;}

async function getWorkspaceModel(replay){if(workspaceModel&&workspaceReplay===replay)return workspaceModel;workspaceModel=await apiJson(`/api/replay/${encodeURIComponent(replay)}/model`);workspaceReplay=replay;return workspaceModel;}
async function getWorkspaceRegistry(){if(workspaceRegistry)return workspaceRegistry;const data=await apiJson('/api/metrics');const map=new Map();for(const s of data.sections??[])for(const m of s.metrics??[])map.set(m.id,m);workspaceRegistry=map;return map;}
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

function formatMetric(metric,value){if(value===null||value===undefined||!Number.isFinite(Number(value)))return '—';const n=Number(value);if(metric.format==='percent')return `${(n*100).toFixed(1)}%`;if(metric.format==='duration')return duration(n);const d=Number.isInteger(metric.decimals)?metric.decimals:(Math.abs(n)<10?2:0);return n.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});}
function formatDelta(metric,delta){if(delta===null)return '—';if(metric.format==='percent')return `${delta>=0?'+':''}${(delta*100).toFixed(1)} pp`;if(metric.format==='duration')return `${delta>=0?'+':'−'}${duration(Math.abs(delta))}`;const d=Number.isInteger(metric.decimals)?metric.decimals:(Math.abs(delta)<10?2:0);return `${delta>0?'+':''}${delta.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d})}`;}
function deltaPercent(metric,baseline,delta){if(delta===null||baseline===null||baseline===0||metric.format==='percent'||metric.signed)return '';const pct=delta/Math.abs(baseline);if(!Number.isFinite(pct))return '';return `<span>${pct>=0?'+':''}${(pct*100).toFixed(1)}%</span>`;}
function duration(seconds){const n=Math.max(0,Number(seconds)||0),m=Math.floor(n/60),s=n-m*60;return `${m}:${s.toFixed(s<10?1:0).padStart(s<10?4:2,'0')}`;}
function clock(seconds,ms=false){const n=Math.max(0,Number(seconds)||0),m=Math.floor(n/60),s=n-m*60;if(ms)return `${m}:${s.toFixed(3).padStart(6,'0')}`;return `${m}:${Math.floor(s).toString().padStart(2,'0')}`;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clampTime(v,model){const end=Math.max(0,Number(model.match?.matchDurationSeconds)||0);return Math.min(end,Math.max(0,Number.isFinite(v)?v:0));}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function loadWorkspaceState(){
  try{const x=JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)||'null');if(x&&Array.isArray(x.panels))return {baseline:Number(x.baseline)||0,columns:String(x.columns??'auto'),panels:x.panels.map(p=>({id:String(p.id||newPanelId()),metricId:String(p.metricId||'gold_networth'),playerName:p.playerName==null?null:String(p.playerName)}))};}catch{}
  return {baseline:0,columns:'auto',panels:[]};
}
function saveWorkspaceState(){try{localStorage.setItem(WORKSPACE_STORAGE_KEY,JSON.stringify(workspaceState));}catch{}}
