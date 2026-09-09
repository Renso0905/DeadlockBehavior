import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const inspector = join(repoRoot, 'inspector-v04');

async function read(rel){ return fs.readFile(join(repoRoot, rel), 'utf8'); }
async function write(rel, text){ await fs.writeFile(join(repoRoot, rel), text, 'utf8'); }
function replaceOnce(text, oldText, newText, label){
  const i=text.indexOf(oldText);
  if(i<0) throw new Error(`Expected source not found for ${label}`);
  if(text.indexOf(oldText,i+oldText.length)>=0) throw new Error(`Expected unique source is duplicated for ${label}`);
  return text.slice(0,i)+newText+text.slice(i+oldText.length);
}
function replaceRegexOnce(text, re, replacement, label){
  const matches=[...text.matchAll(new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g'))];
  if(matches.length!==1) throw new Error(`Expected exactly one match for ${label}; found ${matches.length}`);
  return text.replace(re,replacement);
}

async function updateReplayModel(){
  const rel='inspector-v04/lib/replay-model.mjs';
  let s=await read(rel);
  if (!s.includes("const CACHE_SCHEMA_VERSION='INSPECTOR_V05_2026_09_08';")) {
    s=replaceRegexOnce(s,
      /^(const\s+TICKS_PER_SECOND\s*=\s*64\s*;[^\n]*\n)/m,
      `$1const CACHE_SCHEMA_VERSION='INSPECTOR_V05_2026_09_08';\n`,
      'cache schema constant');
  }

  s=replaceOnce(s,
`  ].map(f=>join(dir,f));\n  const fingerprint=await fileFingerprint(sourceFiles);`,
`  ].map(f=>join(dir,f));\n  sourceFiles.push(join(outputRoot,'cross_replay','hero_id_display_name_map_v05.json'));\n  const fingerprint=await fileFingerprint(sourceFiles);`,
'hero map fingerprint');

  s=replaceOnce(s,
`      if (cached?.fingerprint===fingerprint && cached?.model) return cached.model;`,
`      if (cached?.schemaVersion===CACHE_SCHEMA_VERSION && cached?.fingerprint===fingerprint && cached?.model) return cached.model;`,
'cache version gate');

  s=replaceOnce(s,
`  const integrated=await readJson(join(dir,'integrated_authoritative_player_state_substrate_v01.json'));\n  const offset=Number(integrated?.replay?.matchClockOffsetSeconds ?? 0);`,
`  const integrated=await readJson(join(dir,'integrated_authoritative_player_state_substrate_v01.json'));\n  const heroDisplayMap=await readJson(join(outputRoot,'cross_replay','hero_id_display_name_map_v05.json'));\n  const offset=Number(integrated?.replay?.matchClockOffsetSeconds ?? 0);`,
'hero map load');

  s=replaceOnce(s,
`  const players=core.players.map(p=>finalizePlayer(p,core)).sort((a,b)=>a.team-b.team || b.scoreboard.goldNetWorth-a.scoreboard.goldNetWorth);`,
`  const players=core.players.map(p=>finalizePlayer(p,core));\n  applyHeroDisplayNames(players,heroDisplayMap);\n  players.sort((a,b)=>a.team-b.team || b.scoreboard.goldNetWorth-a.scoreboard.goldNetWorth);`,
'hero display application');

  s=replaceOnce(s,`    version:'DEADLOCK_INSPECTOR_MATCH_MODEL_V04',`,`    version:'DEADLOCK_INSPECTOR_MATCH_MODEL_V05',`,'model version');
  s=replaceOnce(s,
`      roster:players.map(p=>pick(p.identity,['playerName','steamId','heroId','team','controllerEntityIndex','pawnEntityIndex'])),`,
`      roster:players.map(p=>pick(p.identity,['playerName','steamId','heroId','heroDisplayName','team','laneColor','controllerEntityIndex','pawnEntityIndex'])),`,
'roster hero/lane');
  s=replaceOnce(s,
`    await fs.writeFile(cachePath,JSON.stringify({fingerprint,model}));`,
`    await fs.writeFile(cachePath,JSON.stringify({schemaVersion:CACHE_SCHEMA_VERSION,fingerprint,model}));`,
'cache write version');

  s=replaceOnce(s,`    closePlayerIntervals(p,endDemo);`,`    closePlayerIntervals(p,endDemo,offset);`,'close interval offset');
  s=replaceOnce(s,
`    p.netWorthGainPerMinute=safeDiv((p.finalState?.goldNetWorth??0)-(p.initialState?.goldNetWorth??0),p.matchMinutes);\n    p.levelRatePerMinute=safeDiv((p.finalState?.level??0)-(p.initialState?.level??0),p.matchMinutes);`,
`    const matchInitial=p.matchInitialState??p.timeline?.[0]??p.initialState;\n    p.netWorthGainPerMinute=safeDiv((p.finalState?.goldNetWorth??0)-(matchInitial?.goldNetWorth??0),p.matchMinutes);\n    p.levelRatePerMinute=safeDiv((p.finalState?.level??0)-(matchInitial?.level??0),p.matchMinutes);`,
'match-time rate baselines');
  s=replaceOnce(s,`  const teamSeries=buildTeamSeries(players,matchEndSeconds);`,`  const teamSeries=buildTeamSeries(players,matchEndSeconds,offset);`,'team series offset argument');

  s=replaceRegexOnce(s,/function updatePlayer\(map,s,demoTime,offset,tick,matchTimeOverride=null\) \{[\s\S]*?\n\}\n\nfunction closePlayerIntervals\(p,endDemo\) \{[\s\S]*?\n\}/,
`function updatePlayer(map,s,demoTime,offset,tick,matchTimeOverride=null) {
  const name=s.playerName ?? s.steamId ?? \`controller-\${s.controllerEntityIndex}\`;
  let p=map.get(name);
  if (!p) {
    p={
      playerName:name, team:s.team??null, heroId:s.heroId??null,
      identity:{playerName:name,steamId:s.steamId??null,heroId:s.heroId??null,team:s.team??null,controllerEntityIndex:s.controllerEntityIndex??null,pawnEntityIndex:s.heroEntityIndex??null,laneColor:s.laneColor??null},
      initialState:null,matchInitialState:null,finalState:null,prev:null,aliveSeconds:0,deadSeconds:0,low25Seconds:0,low50Seconds:0,
      minHealth:Infinity,maxHealth:-Infinity,minHealthMax:Infinity,maxHealthMax:-Infinity,
      deathsObserved:[],respawnsObserved:[],survivalIntervals:[],respawnIntervals:[],levelTimings:{},timeline:[],lastSampleMatch:-Infinity,
      lifeStartMatch:null,deathStartMatch:null
    }; map.set(name,p);
  }
  const matchTime=matchTimeOverride ?? (demoTime-offset); const state=normalizeState(s,tick,demoTime,matchTime);
  if (!p.initialState) {
    p.initialState=state;
    if(state.alive) p.lifeStartMatch=Math.max(0,matchTime); else p.deathStartMatch=Math.max(0,matchTime);
  }
  if (matchTime>=0 && !p.matchInitialState) p.matchInitialState=state;
  if (p.prev) {
    const intervalStart=Math.max(0,p.prev.matchTime);
    const intervalEnd=Math.max(0,matchTime);
    const dt=Math.max(0,intervalEnd-intervalStart);
    if (p.prev.alive) p.aliveSeconds+=dt; else p.deadSeconds+=dt;
    const ratio=(p.prev.healthMax>0)?p.prev.health/p.prev.healthMax:null;
    if (ratio!==null && ratio<0.25) p.low25Seconds+=dt;
    if (ratio!==null && ratio<0.50) p.low50Seconds+=dt;
    if (p.prev.alive && !state.alive) {
      const transitionTime=Math.max(0,matchTime);
      if(matchTime>=0) p.deathsObserved.push({tick,time:matchTime,demoTime,health:s.health??null});
      if(matchTime>=0 && p.lifeStartMatch!==null) p.survivalIntervals.push(Math.max(0,transitionTime-p.lifeStartMatch));
      p.lifeStartMatch=null; p.deathStartMatch=transitionTime;
    }
    if (!p.prev.alive && state.alive) {
      const transitionTime=Math.max(0,matchTime);
      const duration=p.deathStartMatch===null?null:Math.max(0,transitionTime-p.deathStartMatch);
      if(matchTime>=0) p.respawnsObserved.push({tick,time:matchTime,demoTime,duration});
      if (matchTime>=0 && duration!==null) p.respawnIntervals.push({startTime:p.deathStartMatch,endTime:transitionTime,duration});
      p.deathStartMatch=null; p.lifeStartMatch=transitionTime;
    }
  }
  if (matchTime>=0 && Number.isFinite(s.health)) {p.minHealth=Math.min(p.minHealth,s.health);p.maxHealth=Math.max(p.maxHealth,s.health);}
  if (matchTime>=0 && Number.isFinite(s.healthMax)){p.minHealthMax=Math.min(p.minHealthMax,s.healthMax);p.maxHealthMax=Math.max(p.maxHealthMax,s.healthMax);}
  if (s.level!==undefined && p.levelTimings[String(s.level)]===undefined && matchTime>=0) p.levelTimings[String(s.level)]={tick,time:matchTime};
  if (matchTime>=0 && (matchTime-p.lastSampleMatch>=1 || p.timeline.length===0)) {
    p.timeline.push(compactState(state)); p.lastSampleMatch=matchTime;
  }
  p.prev=state; p.finalState=state;
}

function closePlayerIntervals(p,endDemo,offset) {
  if (!p.prev) return;
  const endMatch=Math.max(0,endDemo-offset);
  const dt=Math.max(0,endMatch-Math.max(0,p.prev.matchTime));
  if (p.prev.alive) p.aliveSeconds+=dt; else p.deadSeconds+=dt;
  const ratio=p.prev.healthMax>0?p.prev.health/p.prev.healthMax:null;
  if (ratio!==null && ratio<.25)p.low25Seconds+=dt;if(ratio!==null&&ratio<.5)p.low50Seconds+=dt;
}`,
'gameplay-time interval integration');

  s=replaceOnce(s,
`    kd:safeDiv(f.kills??0,Math.max(deaths,1)),kda:safeDiv((f.kills??0)+(f.assists??0),Math.max(deaths,1)),killsPerMinute:(f.kills??0)/minutes,assistsPerMinute:(f.assists??0)/minutes,lastHitsPerMinute:(f.lastHits??0)/minutes,deniesPerMinute:(f.denies??0)/minutes};`,
`    kd:safeDiv(f.kills??0,Math.max(deaths,1)),kda:safeDiv((f.kills??0)+(f.assists??0),Math.max(deaths,1)),killsPerMinute:(f.kills??0)/minutes,deathsPerMinute:deaths/minutes,assistsPerMinute:(f.assists??0)/minutes,lastHitsPerMinute:(f.lastHits??0)/minutes,deniesPerMinute:(f.denies??0)/minutes};`,
'deaths rate');

  s=replaceOnce(s,`function buildTeamSeries(players,matchEndSeconds){`,`function buildTeamSeries(players,matchEndSeconds,offset){`,'team series signature');
  s=replaceOnce(s,`    out.push({time:sec,tick:Math.round((sec+30)*TICKS_PER_SECOND),teams});`,`    out.push({time:sec,tick:Math.round((sec+offset)*TICKS_PER_SECOND),teams});`,'team tick offset');
  s=replaceOnce(s,
`function checkpointStates(timeline,points){`,
`function applyHeroDisplayNames(players,heroMap){\n  const byId=heroMap?.heroIdToDisplayName??{};\n  for(const p of players){\n    const display=byId[String(p.heroId)]??byId[p.heroId]??null;\n    p.identity.heroDisplayName=display;\n  }\n}\n\nfunction checkpointStates(timeline,points){`,
'hero helper');
  await write(rel,s);
}

async function updateMetricRegistry(){
  const rel='inspector-v04/lib/metric-registry.mjs';
  let s=await read(rel);
  s=replaceOnce(s,
`    m('match_clock','Match clock',A,'time','Canonical/demo timing','Current match clock and demo tick.'),`,
`    m('match_clock','Gameplay clock',B,'time','Canonical/demo timing','Working gameplay clock derived from the replay clock offset; replay tick/time remain authoritative.'),`,
'gameplay clock tier');
  s=replaceOnce(s,
`    m('hero_id','Hero ID',A,'integer','Player identity','Resolved hero identifier.'),\n    m('team','Team',A,'integer','Player identity','Resolved team identifier.'),`,
`    m('hero_id','Hero ID',A,'integer','Player identity','Resolved hero identifier.'),\n    m('hero_display_name','Hero display name',A,'text','hero_display_identity','Build-bound validated hero display identity.'),\n    m('team','Team',A,'integer','Player identity','Resolved team identifier.'),\n    m('lane','Assigned lane',B,'category','Player identity','Observed controller lane assignment or pawn lane deduction; presentation/debug context, not yet a dedicated claim authority.'),`,
'hero/lane metrics');
  s=replaceOnce(s,
`    m('kills_rate','Kills/min',B,'per_min','Controller counters','Final kills / match minutes.'),\n    m('assists_rate','Assists/min',B,'per_min','Controller counters','Final assists / match minutes.'),`,
`    m('kills_rate','Kills/min',B,'per_min','Controller counters','Final kills / match minutes.'),\n    m('deaths_rate','Deaths/min',B,'per_min','Controller counters','Final deaths / match minutes.'),\n    m('assists_rate','Assists/min',B,'per_min','Controller counters','Final assists / match minutes.'),`,
'deaths/min metric');
  s=replaceOnce(s,
`function m(id,label,status,unit,source,definition,warning=false) {\n  return { id,label,status,unit,source,definition,warning };\n}`,
`function m(id,label,status,unit,source,definition,warning=false) {\n  return { id,label,status,unit,source,definition,warning,claimId:claimForMetric(id,source) };\n}\n\nfunction claimForMetric(id,source){\n  if(id==='match_clock')return'replay_clock_30s_offset';\n  if(id==='hero_display_name')return'hero_display_identity';\n  if(id==='position_trajectory')return'world_position_reconstruction';\n  if(['melee_attacks','melee_hits','melee_hit_rate','light_melee','heavy_melee','air_heavy_melee','melee_type_share','melee_per_alive_min'].includes(id))return'melee_attempt_action_authority';\n  if(id==='ground_soul_vacuum_target')return'assigned_gold_vacuum_target_semantics';\n  if(id==='opponent_45m')return'ground_soul_45m_production_relationship';\n  if(['trooper_base_types','trooper_variants','trooper_team_lane'].includes(id))return'trooper_type_variant_classification';\n  const bySource={\n    'PlayerState':'player_state_t_v1','player_state':'player_state_t_v1',\n    'runtime_item_ownership':'runtime_item_ownership','runtime_permanent_buff_ownership':'runtime_permanent_buff_ownership',\n    'runtime_bridge_buff_ownership':'runtime_bridge_buff_ownership','runtime_primary_attack_ready_schedule':'runtime_primary_attack_ready_schedule',\n    'breakable_catalog_v1':'breakable_catalog_and_break_events','breakable_action_stream_v1':'breakable_catalog_and_break_events',\n    'breakable_reward_acquisition_v1':'breakable_reward_acquisition','behavioral_resource_features_v01':'broad_behavioral_exposure',\n    'trooper_deaths_typed_v02':'trooper_death_transition','trooper_ground_soul_one_to_one_v01':'ground_soul_one_to_one_matching',\n    'citemxp_inspector_events_v01':'citemxp_shot_outcome_signal','hero_display_identity':'hero_display_identity'\n  };\n  return bySource[source]??null;\n}`,
'claim linkage');
  await write(rel,s);
}

async function updateServer(){
  const rel='inspector-v04/server.mjs';
  let s=await read(rel);
  s=replaceOnce(s,
`const publicRoot=join(inspectorRoot,'public');\nconst port=Number(process.env.DEADLOCK_INSPECTOR_PORT ?? 4177);`,
`const publicRoot=join(inspectorRoot,'public');\nconst claimRegistryPath=join(repoRoot,'contracts','claim_registry_v03.json');\nconst port=Number(process.env.DEADLOCK_INSPECTOR_PORT ?? 4177);`,
'claim registry path');
  s=replaceOnce(s,`const modelPromises=new Map();`,`const modelPromises=new Map();\nlet metricPayloadPromise=null;`,'metric payload cache');
  s=replaceOnce(s,
`  if(req.method==='GET'&&url.pathname==='/api/config') return sendJson(res,200,{version:'V04',repoRoot,outputRoot,metricCount:METRIC_REGISTRY.reduce((n,s)=>n+s.metrics.length,0)});\n  if(req.method==='GET'&&url.pathname==='/api/metrics') return sendJson(res,200,{sections:METRIC_REGISTRY});`,
`  if(req.method==='GET'&&url.pathname==='/api/config'){\n    const metrics=await getMetricPayload();\n    return sendJson(res,200,{version:'V05',repoRoot,outputRoot,metricCount:METRIC_REGISTRY.reduce((n,s)=>n+s.metrics.length,0),claimRegistryVersion:metrics.claimRegistryVersion});\n  }\n  if(req.method==='GET'&&url.pathname==='/api/metrics') return sendJson(res,200,await getMetricPayload());`,
'claim-aware API');
  s=replaceOnce(s,
`async function getModel(replay,force=false){`,
`async function getMetricPayload(){\n  if(metricPayloadPromise)return metricPayloadPromise;\n  metricPayloadPromise=(async()=>{\n    const registry=await readJson(claimRegistryPath,{version:null,claims:[]});\n    const claims=new Map((registry?.claims??[]).map(c=>[c.claimId,c]));\n    const sections=METRIC_REGISTRY.map(section=>({...section,metrics:section.metrics.map(metric=>{\n      const claim=metric.claimId?claims.get(metric.claimId):null;\n      return {...metric,authority:claim?{authorityStatus:claim.authorityStatus,integrityValidation:claim.integrityValidation,semanticValidation:claim.semanticValidation,replicationStatus:claim.replicationStatus,scope:claim.scope??'',notes:claim.notes??''}:null};\n    })}));\n    return{claimRegistryVersion:registry?.version??null,sections};\n  })();\n  return metricPayloadPromise;\n}\n\nasync function getModel(replay,force=false){`,
'claim-aware payload helper');
  await write(rel,s);
}

async function updateApp(){
  const rel='inspector-v04/public/app.js';
  let s=await read(rel);
  s=replaceOnce(s,
`const state={replays:[],replay:null,model:null,player:null,time:0,tab:'overview',registry:[],evidence:null,evidenceOffset:0,evidenceLimit:75};`,
`const state={replays:[],replay:null,model:null,player:null,time:0,tab:'overview',registry:[],claimRegistryVersion:null,evidence:null,evidenceOffset:0,evidenceLimit:75};`,
'app claim state');
  s=replaceOnce(s,
`  state.registry=(await api('/api/metrics')).sections;`,
`  const metrics=await api('/api/metrics');state.registry=metrics.sections;state.claimRegistryVersion=metrics.claimRegistryVersion??null;`,
'app metrics payload');
  s=replaceOnce(s,
`    $('#playerSelect').innerHTML=ps.map(p=>\`<option value="\${esc(p.playerName)}">T\${p.team} · H\${p.heroId} · \${esc(p.playerName)}</option>\`).join('');$('#playerSelect').value=state.player??'';`,
`    $('#playerSelect').innerHTML=ps.map(p=>\`<option value="\${esc(p.playerName)}">T\${p.team} · \${esc(p.identity?.heroDisplayName??\`H\${p.heroId}\`)}\${p.identity?.laneColor!=null?\` · Lane \${esc(p.identity.laneColor)}\`:''} · \${esc(p.playerName)}</option>\`).join('');$('#playerSelect').value=state.player??'';`,
'hero/lane selector');

  s=replaceRegexOnce(s,/function playerHero\(p\)\{[\s\S]*?\nfunction overview\(p\)\{[\s\S]*?\n\nfunction economy/,
`function playerHero(p){const s=currentState(p),items=itemsAt(p,state.time),bridges=bridgesAt(p,state.time);const hero=p.identity?.heroDisplayName??\`Hero \${p.heroId}\`;return \`<div class="hero-row">
  <div class="hero-card"><div class="eyebrow">Selected player · Team \${p.team}</div><h1>\${esc(p.playerName)}</h1><div class="meta"><span>\${esc(hero)} · ID \${p.heroId}</span>\${p.identity?.laneColor!=null?\`<span>Lane \${esc(p.identity.laneColor)}</span>\`:''}<span>Steam \${esc(p.identity.steamId??'—')}</span><span>\${s?.alive?'ALIVE':'DEAD'}</span></div></div>
  \${stat('Level',fmt(s?.level),'A',\`Final \${fmt(p.core.level)}\`)}\${stat('Health',s?.healthMax?\`\${fmt(s.health)} / \${fmt(s.healthMax)}\`:'—','A',pct(s?.healthMax?s.health/s.healthMax:null))}
  \${stat('Net worth',num(s?.goldNetWorth),'A',\`final \${num(p.scoreboard.goldNetWorth)}\`)}\${stat('Owned items',items.length,'A',\`\${bridges.length} bridge buff\${bridges.length===1?'':'s'} active\`)}</div>\`;}
function overview(p){const s=currentState(p),team=teamOf(p);return playerHero(p)+section('Scoreboard & survival','Observed controller counters plus gameplay-time life-state transitions',\`<div class="grid">
  \${metricCard('kills',p.scoreboard.kills,'scoreboard')}\${metricCard('deaths_scoreboard',p.scoreboard.deaths,'scoreboard')}\${metricCard('assists',p.scoreboard.assists,'scoreboard')}\${metricCard('kda',fmt(p.scoreboard.kda,2),'scoreboard')}
  \${metricCard('last_hits',p.scoreboard.lastHits,'scoreboard')}\${metricCard('denies',p.scoreboard.denies,'scoreboard')}\${metricCard('alive_time',duration(p.core.aliveSeconds),'playerState')}\${metricCard('dead_time',duration(p.core.deadSeconds),'playerState')}
  \${metricCard('alive_share',pct(p.core.aliveShare),'playerState')}\${metricCard('average_life',duration(p.core.averageLifeSeconds),'playerState')}\${metricCard('respawn_downtime',duration(p.core.totalRespawnDowntimeSeconds),'playerState')}\${metricCard('low_health_25',duration(p.core.low25Seconds),'playerState')}
  \${metricCard('low_health_50',duration(p.core.low50Seconds),'playerState')}\${metricCard('kills_rate',fmt(p.scoreboard.killsPerMinute,2),'scoreboard')}\${metricCard('deaths_rate',fmt(p.scoreboard.deathsPerMinute,2),'scoreboard')}\${metricCard('assists_rate',fmt(p.scoreboard.assistsPerMinute,2),'scoreboard')}
</div>\`)+section('Current state at scrubber',clock(state.time),\`<div class="grid">\${stat('Alive',s?.alive?'Yes':'No','A')}\${stat('Health regen',fmt(s?.healthRegen,2),'A')}\${stat('AP net worth',num(s?.apNetWorth),'A')}\${stat('Health extrema',\`\${fmt(p.core.minHealth)}–\${fmt(p.core.maxHealth)}\`,'A')}\${stat('Match net-worth rank',\`#\${p.rank.matchNetWorth}\`,'A',\`#\${p.rank.teamNetWorth} on team\`)} </div>\`)+section('Death / respawn chronology','Gameplay-time transitions only; pre-match setup is excluded',table(['Death','Respawn','Downtime'],deathRespawnRows(p)))+section('Quick timelines','Scrub the global time control to inspect the same moment',\`<div class="grid two"><div class="panel"><div class="eyebrow">Net worth</div>\${lineChart(p.timeline,'matchTime','goldNetWorth',state.time)}</div><div class="panel"><div class="eyebrow">Health</div>\${lineChart(p.timeline,'matchTime','health',state.time)}</div></div>\`)+cautionStrip();}

function economy`,
'overview presentation');

  s=replaceRegexOnce(s,/function builds\(p\)\{[\s\S]*?\n\nfunction buffs/,
`function builds(p){const current=itemsAt(p,state.time),events=p.items?.events??[];return playerHero(p)+section('Build at selected time',\`\${clock(state.time)} · authoritative standard-shop ownership\`,\`<div class="panel"><div class="item-list">\${current.length?current.map(i=>itemPill(i)).join(''):'<span class="muted">No owned standard-shop items at this time.</span>'}</div></div>\`)+section('Final build','Replay-end ownership',\`<div class="panel"><div class="item-list">\${(p.items?.finalItems??[]).map(itemPill).join('')}</div></div>\`)+section('Checkpoint builds','Ownership state at standard player-state checkpoints',table(['Time','Items'],Object.keys(p.core.checkpoints??{}).map(sec=>[clock(Number(sec)),itemsAt(p,Number(sec)).map(i=>pretty(i.recordKey??i.itemId)).join(', ')||'—'])) )+section('Acquisition / removal timeline','Removal is intentionally NOT labeled sale',table(['Time','Event','Item','Tier','Price'],events.map(e=>[clock(e.time),e.eventType,e.item?.recordKey,e.item?.itemTier,num(e.item?.shopPrice)]),true,'items'))+section('Ownership durations','Observed add→remove/replay-end intervals',table(['Item','Start','End','Duration','End reason'],(p.items?.ownershipIntervals??[]).map(x=>[x.item?.recordKey,clock(x.startTime),clock(x.endTime),duration(x.durationSeconds),x.endReason])));}

function buffs`,
'checkpoint builds');

  s=replaceRegexOnce(s,/function metricsCatalog\(p\)\{[\s\S]*?\n\nfunction evidenceHub/,
`function metricsCatalog(p){return \`<div class="section-head"><div><h2>Complete A/B metric registry</h2><p>\${state.registry.reduce((n,s)=>n+s.metrics.length,0)} explicit metric contracts · authority \${esc(state.claimRegistryVersion??'unavailable')}. A/B is presentation tier; claim metadata is the scientific authority.</p></div></div><div class="metric-catalog">\${state.registry.map(sec=>\`<div class="panel"><h3>\${esc(sec.label)}</h3>\${sec.metrics.map(m=>\`<div class="metric-row"><span class="badge \${m.status.toLowerCase()}">\${m.status}</span><strong>\${esc(m.label)}</strong><span class="src">\${esc(m.source)}</span><span class="definition">\${esc(m.definition)}\${m.warning?' <span class="badge warn">semantic warning</span>':''}\${m.claimId?\`<br><span class="muted mono">\${esc(m.claimId)} · \${esc(m.authority?.authorityStatus??'claim missing')} · semantic \${esc(m.authority?.semanticValidation??'—')} · replication \${esc(m.authority?.replicationStatus??'—')}</span>\`:''}</span></div>\`).join('')}</div>\`).join('')}</div>\`;}

function evidenceHub`,
'claim-aware metric catalog');

  s=replaceOnce(s,
`function checkpointTable(p){const rows=Object.entries(p.core.checkpoints??{}).map(([sec,s])=>[clock(Number(sec)),s.level,num(s.goldNetWorth),s.kills,s.deaths,s.assists,s.lastHits,s.denies]);return section('Standard checkpoints','Player state at or immediately before checkpoint',table(['Time','Lvl','Net worth','K','D','A','LH','Denies'],rows));}`,
`function checkpointTable(p){const rows=Object.entries(p.core.checkpoints??{}).map(([sec,s])=>[clock(Number(sec)),s.level,num(s.goldNetWorth),s.kills,s.deaths,s.assists,s.lastHits,s.denies]);return section('Standard checkpoints','Player state at or immediately before checkpoint',table(['Time','Lvl','Net worth','K','D','A','LH','Denies'],rows));}\nfunction deathRespawnRows(p){const deaths=p.core.deathTimings??[],respawns=p.core.respawns??[];const n=Math.max(deaths.length,respawns.length);return Array.from({length:n},(_,i)=>[deaths[i]?clock(deaths[i].time):'—',respawns[i]?clock(respawns[i].time):'—',respawns[i]?duration(respawns[i].duration):'—']);}`,
'death/respawn helper');
  await write(rel,s);
}

async function updateTests(){
  const rel='inspector-v04/tests/inspector-v04.test.mjs';
  let s=await read(rel);
  s=replaceOnce(s,
`  assert.ok(metrics.some(m=>m.id==='camp_clear_during_exposure'&&m.warning));\n  assert.ok(!metrics.some(m=>/current_ammo|effective_dps|magazine_size/.test(m.id)));`,
`  assert.ok(metrics.some(m=>m.id==='camp_clear_during_exposure'&&m.warning));\n  assert.equal(metrics.find(m=>m.id==='match_clock')?.status,'B');\n  assert.equal(metrics.find(m=>m.id==='match_clock')?.claimId,'replay_clock_30s_offset');\n  assert.equal(metrics.find(m=>m.id==='current_items')?.claimId,'runtime_item_ownership');\n  assert.ok(metrics.some(m=>m.id==='hero_display_name'));\n  assert.ok(metrics.some(m=>m.id==='lane'));\n  assert.ok(!metrics.some(m=>/current_ammo|effective_dps|magazine_size/.test(m.id)));`,
'metric registry regression assertions');
  s=replaceOnce(s,
`  rows.push(row(0,'Alpha',2,1,true,600),row(0,'Bravo',3,2,true,600));`,
`  rows.push(row(-30,'Alpha',2,1,true,100),row(-30,'Bravo',3,2,true,100));\n  rows.push(row(0,'Alpha',2,1,true,600),row(0,'Bravo',3,2,true,600));`,
'pre-match fixture');
  s=replaceOnce(s,
`  assert.equal(bravo.scoreboard.deaths,1);assert.equal(bravo.deathsObserved.length,1);assert.equal(bravo.respawnsObserved.length,1);\n  assert.ok(model.teams.find(t=>t.team===2).goldNetWorthDiff>0);`,
`  assert.equal(bravo.scoreboard.deaths,1);assert.equal(bravo.deathsObserved.length,1);assert.equal(bravo.respawnsObserved.length,1);\n  assert.equal(alpha.core.aliveSeconds,90);\n  assert.equal(bravo.core.aliveSeconds,60);\n  assert.equal(bravo.core.deadSeconds,30);\n  assert.equal(alpha.core.netWorthGainPerMinute,(3000-600)/1.5);\n  assert.ok(model.teams.find(t=>t.team===2).goldNetWorthDiff>0);`,
'timing regression assertions');
  await write(rel,s);
}

async function writeOutputContract(){
  const rel='inspector-v04/OUTPUT_CONTRACT.md';
  const body=`# DeadlockBehavior Inspector Output Contract\n\nThe inspector consumes a **current replay contract**, not the numbered research notebook. A historical script passing is not sufficient to make its output part of replay processing.\n\n## Required core output\n\n- \`player_state.jsonl\` — observed player/controller/pawn state and scoreboard counters.\n- \`integrated_authoritative_player_state_substrate_v01.json\` — authoritative item ownership, permanent world-buff state, and bridge-powerup intervals.\n\nWithout \`player_state.jsonl\`, a replay is not inspector-core-ready.\n\n## Optional domain outputs\n\n- \`behavioral_metrics_v02.json\`\n- \`behavioral_resource_features_summary_v01.json\`\n- \`behavioral_resource_episodes_v01.jsonl\`\n- \`breakable_catalog_v1.json\`\n- \`breakable_action_stream_summary_v1.json\`\n- \`breakable_action_stream_v1.jsonl\`\n- \`breakable_reward_acquisition_summary_v1.json\`\n- \`breakable_reward_acquisition_v1.jsonl\`\n- \`trooper_deaths_typed_v02.jsonl\`\n- \`trooper_ground_soul_one_to_one_summary_v01.json\`\n- \`trooper_ground_soul_one_to_one_v01.jsonl\`\n- \`citemxp_inspector_events_v01.json\`\n- \`citemxp_auto_award_resolution_validation_v02.json\`\n- \`citemxp_auto_award_units_v02.jsonl\`\n- \`citemxp_auto_award_urn_bursts_v02.jsonl\`\n- \`effective_weapon_runtime_events_v01.jsonl\`\n- \`observed_primary_attack_ready_schedule_candidate_v01.json\`\n\n## Cross-replay reference outputs\n\n- \`output/cross_replay/hero_id_display_name_map_v05.json\`\n\nReference resources are build-bound. Missing reference files must degrade presentation rather than invent values.\n\n## Authority rule\n\nEvery inspector metric should either link to a current/provisional claim in \`contracts/claim_registry_v03.json\`, or explicitly identify itself as an observed/debug/derived presentation metric with no promoted claim.\n\nThe inspector's A/B tier is a presentation tier. It must not override \`authorityStatus\`, \`integrityValidation\`, \`semanticValidation\`, or \`replicationStatus\`.\n\n## Replay-processing rule\n\n\`pipeline.json\` remains empty until replay-safe consolidated entrypoints exist. Do not automate \`scripts/001...205\` as an ETL. Promote current extraction entrypoints explicitly, in dependency order, and require each promoted step to emit one or more files from this contract.\n`;
  await write(rel,body);
}

for (const fn of [updateReplayModel,updateMetricRegistry,updateServer,updateApp,updateTests,writeOutputContract]) {
  await fn();
}
console.log('Inspector V05 fixes applied successfully.');
console.log(`Repository: ${repoRoot}`);
console.log('Next: run inspector-v04\\test-inspector.ps1 and inspect git diff.');
