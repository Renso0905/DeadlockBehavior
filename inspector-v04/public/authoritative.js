import { AUTH_IDS, metricValue, clock, escapeHtml, apiJson } from './metric-values.mjs';
const AUTH_TAB_ID='authoritative-ready';
const AUTH_STYLE_ID='authoritative-ready-style';
let authActive=false;
let authRegistry=null;
let authModel=null,authReplay=null;
let authRenderToken=0;
document.addEventListener('replay-model-loaded',e=>{authModel=e.detail.model;authReplay=e.detail.replay;queueAuthoritativeRender();});



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
document.querySelector('#refreshBtn')?.addEventListener('click',()=>{authModel=null;queueAuthoritativeRender(400);});
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
      authModel&&authReplay===replay?Promise.resolve(authModel):apiJson(`/api/replay/${encodeURIComponent(replay)}/model`).then(x=>{authModel=x;authReplay=replay;return x;})
    ]);
    if(token!==authRenderToken||!authActive)return;
    const p=model.players?.find(x=>String(x.playerId??x.playerName)===String(playerName))??model.players?.[0];
    if(!p){main.innerHTML='<div class="warning-box">No player model is available for this replay.</div>';return;}
    const aSections=(registryData.sections??[]).map(s=>({...s,metrics:(s.metrics??[]).filter(m=>m.status==='A')})).filter(s=>s.metrics.length);
    const aMetrics=aSections.flatMap(s=>s.metrics);
    const unknownRegistry=aMetrics.filter(m=>!AUTH_IDS.includes(m.id));
    const missingContract=AUTH_IDS.filter(id=>!aMetrics.some(m=>m.id===id));
    const weaponReady=null;
    if(token!==authRenderToken||!authActive)return;
    const ctx={model,p,time,weaponReady};
    const rendered=aSections.map(section=>{
      const rows=section.metrics.map(m=>({metric:m,result:metricValue(m.id,ctx)}));
      return authSection(section,rows);
    }).join('');
    const wired=aMetrics.filter(m=>metricValue(m.id,ctx).wired!==false).length;
    const available=aMetrics.filter(m=>metricValue(m.id,ctx).available).length;
    const complete=available===aMetrics.length && wired===aMetrics.length && unknownRegistry.length===0 && missingContract.length===0;
    main.innerHTML=`
      <div class="section-head auth-head">
        <div>
          <h2>Authoritative statistics</h2>
          <p>Every current <strong>A-status</strong> metric contract is shown here with a value, source, and definition. Scrub the match clock for time-dependent state.</p>
        </div>
        <div class="auth-coverage ${complete?'complete':'incomplete'}">
          <strong>${available}/${aMetrics.length}</strong>
          <span>A metrics available · ${wired} mapped</span>
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
    ${result?.scope?`<div class="auth-detail">${result.scope==='at_selected_time'?'At selected time':'Full observed match'}</div>`:''}
    ${result?.detail?`<div class="auth-detail">${escapeHtml(result.detail)}</div>`:''}
    <div class="auth-meta"><span>${escapeHtml(metric.source??'')}</span><span>${escapeHtml(metric.definition??'')}</span></div>
  </article>`;
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
