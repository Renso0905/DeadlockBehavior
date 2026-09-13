param([string]$RepoRoot = "G:\DeadlockBehavior")
$ErrorActionPreference='Stop'
$PatchRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$PayloadRoot=Join-Path $PatchRoot 'payload'
if(-not(Test-Path (Join-Path $RepoRoot 'inspector-v04'))){throw "Inspector root not found: $RepoRoot\inspector-v04"}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot=Join-Path $RepoRoot ("patch-backups\health-regen-production-v01-"+$stamp)
New-Item -ItemType Directory -Force -Path $BackupRoot|Out-Null
$Utf8NoBom=New-Object System.Text.UTF8Encoding -ArgumentList $false
function Read-Utf8([string]$p){[IO.File]::ReadAllText($p)}
function Write-Utf8([string]$p,[string]$t){[IO.File]::WriteAllText($p,$t,$script:Utf8NoBom)}
function Backup([string]$rel){$s=Join-Path $RepoRoot $rel;if(Test-Path $s){$d=Join-Path $BackupRoot $rel;New-Item -ItemType Directory -Force -Path (Split-Path -Parent $d)|Out-Null;Copy-Item $s $d -Force}}
function Patch-Regex([string]$rel,[string]$pattern,[string]$replacement,[string]$marker){
  $p=Join-Path $RepoRoot $rel;$t=Read-Utf8 $p;if($marker -and $t.Contains($marker)){Write-Host "Already applied: $rel" -ForegroundColor DarkGray;return}
  $rx=New-Object Text.RegularExpressions.Regex($pattern,[Text.RegularExpressions.RegexOptions]::Singleline)
  $m=$rx.Matches($t);if($m.Count -ne 1){throw "Expected one patch location in $rel; found $($m.Count). Pattern: $pattern"}
  Write-Utf8 $p ($rx.Replace($t,$replacement,1));Write-Host "Patched: $rel" -ForegroundColor DarkGray
}
function Insert-Before([string]$rel,[string]$needle,[string]$insert,[string]$marker){
  $p=Join-Path $RepoRoot $rel;$t=Read-Utf8 $p;if($marker -and $t.Contains($marker)){Write-Host "Already inserted: $rel" -ForegroundColor DarkGray;return}
  $i=$t.IndexOf($needle,[StringComparison]::Ordinal);if($i -lt 0){throw "Insertion marker not found in ${rel}: $needle"};Write-Utf8 $p ($t.Substring(0,$i)+$insert+$t.Substring($i));Write-Host "Inserted: $rel" -ForegroundColor DarkGray
}

$modify=@('inspector-v04\pipeline.json','inspector-v04\lib\production-capabilities.mjs','inspector-v04\lib\metric-registry.mjs','inspector-v04\lib\replay-model.mjs','inspector-v04\lib\io.mjs','inspector-v04\server.mjs','inspector-v04\public\app.js','inspector-v04\tests\production-pipeline.test.mjs')
foreach($r in $modify){if(-not(Test-Path (Join-Path $RepoRoot $r))){throw "Required current file missing: $r"};Backup $r}

foreach($rel in @('inspector-v04\production\extract-runtime-health-regen.mjs','inspector-v04\lib\runtime-health-regen.mjs','inspector-v04\tests\runtime-health-regen.test.mjs')){
  $s=Join-Path $PayloadRoot $rel;$d=Join-Path $RepoRoot $rel;if(-not(Test-Path $s)){throw "Payload missing: $s"};New-Item -ItemType Directory -Force -Path (Split-Path -Parent $d)|Out-Null;Copy-Item $s $d -Force
}

# Pipeline: edit JSON structurally so formatting cannot break installation.
$pipelinePath=Join-Path $RepoRoot 'inspector-v04\pipeline.json'
$pipeline=Get-Content -Raw $pipelinePath|ConvertFrom-Json
$core=$pipeline.steps|Where-Object {$_.capability -eq 'core_state_economy'}|Select-Object -First 1
if(-not$core){throw 'Core production stage not found in pipeline.json'}
$health=$pipeline.steps|Where-Object {$_.capability -eq 'health_regen'}|Select-Object -First 1
$healthId=if($health -and $health.id){$health.id}else{'health-regen'}
$newHealth=[pscustomobject]@{id=$healthId;label='Extract observed runtime health regeneration';capability='health_regen';required=$true;dependsOn=@($core.id);args=@('inspector-v04/production/extract-runtime-health-regen.mjs','replays/{replay}.dem');ifExists='replays/{replay}.dem';expectedOutputs=@([pscustomobject]@{path='output/{replay}/runtime_health_regen_production_v01.json';minBytes=2},[pscustomobject]@{path='output/{replay}/runtime_health_regen_events_v01.jsonl';minBytes=0})}
if($health){for($i=0;$i -lt $pipeline.steps.Count;$i++){if($pipeline.steps[$i].capability -eq 'health_regen'){$pipeline.steps[$i]=$newHealth;break}}}else{$pipeline.steps=@($pipeline.steps[0],$newHealth)+@($pipeline.steps|Select-Object -Skip 1)}
Write-Utf8 $pipelinePath (($pipeline|ConvertTo-Json -Depth 30)+"`r`n")

# Capability promotion.
$capReplacement=@'
  capability('health_regen', 'Observed runtime health regeneration', 'supported', ['health_regen'], {
    integrityValidation: 'Fresh runtime_health_regen_production_v01.json and runtime_health_regen_events_v01.jsonl must be produced. CCitadelPlayerController.m_flHealthRegen is sampled directly at the PlayerState cadence; finite/nonnegative values and gameplay roster coverage are checked on every eligible replay.',
    semanticValidation: 'PlayerState(t) direct-observation authority. health_regen is the observed networked CCitadelPlayerController.m_flHealthRegen field. It is not inferred from health deltas and is not decomposed into base, item, buff, zone, or ability causes.',
    replicationStatus: 'Inherited from the strongly cross-replay replicated PlayerState(t) authority across five independent replays; direct observedRuntime.healthRegen is inside that validated state boundary.'
  }),
  capability('runtime_item_ownership'
'@
Patch-Regex 'inspector-v04\lib\production-capabilities.mjs' "\s*capability\('health_regen',[\s\S]*?\),\s*capability\('runtime_item_ownership'" $capReplacement "capability('health_regen', 'Observed runtime health regeneration', 'supported'"

# Metric contract wording.
Patch-Regex 'inspector-v04\lib\metric-registry.mjs' "m\('health_regen','Health regeneration',A,'number','PlayerState','Observed runtime health regeneration field\.'\)" "m('health_regen','Observed health regen',A,'number','CCitadelPlayerController.m_flHealthRegen','Direct observed runtime regeneration field; not realized healing or causal decomposition.')" "m('health_regen','Observed health regen'"

# Replay model fingerprint/read/apply; includes production manifest repair if SourceHealth V01 was skipped.
$p=Join-Path $RepoRoot 'inspector-v04\lib\replay-model.mjs';$t=Read-Utf8 $p
if(-not $t.Contains('runtime_health_regen_production_v01.json')){
  $t=$t.Replace("'behavioral_metrics_v02.json',","'runtime_health_regen_production_v01.json','runtime_health_regen_events_v01.jsonl','behavioral_metrics_v02.json',")
  if(-not $t.Contains('runtime_health_regen_production_v01.json')){throw 'Could not extend replay-model fingerprint for health regen'}
}
if(-not $t.Contains("const runtimeHealthRegen=await readJson(join(dir,'runtime_health_regen_production_v01.json'));")){
  $needle="  const runtimeBridge=await readJson(join(dir,'runtime_bridge_buff_ownership_production_v01.json'));"
  if(-not $t.Contains($needle)){throw 'runtimeBridge read marker missing in replay-model'}
  $t=$t.Replace($needle,$needle+"`r`n  const runtimeHealthRegen=await readJson(join(dir,'runtime_health_regen_production_v01.json'));")
}
if(-not $t.Contains("const productionManifest=await readJson(join(dir,'production_manifest_v01.json'));")){
  $needle="  const runtimeHealthRegen=await readJson(join(dir,'runtime_health_regen_production_v01.json'));"
  $t=$t.Replace($needle,$needle+"`r`n  const productionManifest=await readJson(join(dir,'production_manifest_v01.json'));")
  if(-not $t.Contains("production_manifest_v01.json")){$t=$t.Replace("'behavioral_metrics_v02.json',","'production_manifest_v01.json','behavioral_metrics_v02.json',")}
}
if(-not $t.Contains('applyRuntimeHealthRegen(playerByName,runtimeHealthRegen);')){
  $needle='  applyRuntimeBridge(playerByName,runtimeBridge);';if(-not $t.Contains($needle)){throw 'applyRuntimeBridge marker missing'};$t=$t.Replace($needle,$needle+"`r`n  applyRuntimeHealthRegen(playerByName,runtimeHealthRegen);")
}
if(-not $t.Contains('productionManifest,')){
  $needle='    sourceHealth:health,';if(-not $t.Contains($needle)){throw 'sourceHealth model marker missing'};$t=$t.Replace($needle,$needle+"`r`n    productionManifest,")
}
if(-not $t.Contains('function applyRuntimeHealthRegen(')){
$fn=@'
function applyRuntimeHealthRegen(playerByName,artifact){
  if(!artifact || artifact.status!=='RUNTIME_HEALTH_REGEN_PRODUCTION_V01_READY')return;
  const players=[...playerByName.values()];
  for(const row of artifact.players??[]){
    const p=players.find(x=>Number.isInteger(row.controllerEntityIndex)&&x.identity?.controllerEntityIndex===row.controllerEntityIndex)
      ?? players.find(x=>row.steamId!=null&&String(x.identity?.steamId)===String(row.steamId))
      ?? playerByName.get(row.playerName);
    if(!p)continue;
    const events=[...(row.changeEvents??[])].sort((a,b)=>(a.matchTimeSeconds??0)-(b.matchTimeSeconds??0));
    let j=0,current=null;
    for(const s of p.timeline??[]){while(j<events.length&&Number(events[j].matchTimeSeconds)<=Number(s.matchTime)){current=Number(events[j].currentValue);j++;}s.healthRegen=Number.isFinite(current)?current:null;}
    p.healthRegen={gameplayObserved:row.gameplayObserved??null,rawObserved:row.rawObserved??null,gameplaySampleCount:row.gameplaySampleCount??0,pregameSampleCount:row.pregameSampleCount??0,changeCount:row.changeCount??0,firstGameplayValue:row.firstGameplayValue??null,lastGameplayValue:row.lastGameplayValue??null,events,authority:'player_state_t_v1',source:'runtime_health_regen_production_v01.json'};
  }
}

'@
  $needle='function applyRuntimeBridge('; $i=$t.IndexOf($needle,[StringComparison]::Ordinal);if($i -lt 0){throw 'applyRuntimeBridge function marker missing'};$t=$t.Substring(0,$i)+$fn+$t.Substring($i)
}
Write-Utf8 $p $t

# Source files: add dedicated current-production health files.
$p=Join-Path $RepoRoot 'inspector-v04\lib\io.mjs';$t=Read-Utf8 $p
if(-not $t.Contains("['runtime_health_regen','runtime_health_regen_production_v01.json'")){
  $needle="    ['player_state','player_state.jsonl','A','Core state / scoreboard / trajectory'],";if(-not $t.Contains($needle)){throw 'player_state source-health marker missing'}
  $insert=$needle+"`r`n    ['runtime_health_regen','runtime_health_regen_production_v01.json','A','Direct observed CCitadelPlayerController.m_flHealthRegen production summary'],`r`n    ['runtime_health_regen_events','runtime_health_regen_events_v01.jsonl','A','Observed health-regeneration change boundaries'],"
  $t=$t.Replace($needle,$insert);Write-Utf8 $p $t
}

# Evidence endpoint.
$p=Join-Path $RepoRoot 'inspector-v04\server.mjs';$t=Read-Utf8 $p
if(-not $t.Contains("healthRegen:['jsonl','runtime_health_regen_events_v01.jsonl']")){
  $needle="  playerState:['jsonl','player_state.jsonl'],";if(-not $t.Contains($needle)){throw 'playerState evidence marker missing'};$t=$t.Replace($needle,$needle+"`r`n  healthRegen:['jsonl','runtime_health_regen_events_v01.jsonl'],");Write-Utf8 $p $t
}

# UI: direct observed card + dedicated summary/timeline + production-aware Source Health V03.
$p=Join-Path $RepoRoot 'inspector-v04\public\app.js';$t=Read-Utf8 $p
$t=$t.Replace("stat('Health regen',fmt(s?.healthRegen,2),'A')","metricCard('health_regen',fmt(s?.healthRegen,2),'healthRegen','direct observed controller field')")
if(-not $t.Contains('function healthRegenSection(')){
$fn=@'
function healthRegenSection(p,s){const h=p.healthRegen??{},g=h.gameplayObserved??{};return section('Observed health regeneration','Direct CCitadelPlayerController.m_flHealthRegen; gameplay summaries exclude pregame samples and do not infer realized healing or causes.',`<div class="grid">${metricCard('health_regen',fmt(s?.healthRegen,2),'healthRegen','current at scrubber')}${stat('Gameplay mean',fmt(g.mean,2),'A')}${stat('Gameplay median',fmt(g.median,2),'A')}${stat('Gameplay min / max',g.count?`${fmt(g.min,2)} / ${fmt(g.max,2)}`:'—','A')}${stat('Observed changes',h.changeCount??0,'A')}${stat('Gameplay samples',h.gameplaySampleCount??0,'A')}</div><div class="panel chart" style="margin-top:12px"><div class="eyebrow">Observed regen timeline</div>${lineChart(p.timeline,'matchTime','healthRegen',state.time,true)}</div>${evidenceButton('Inspect health-regen changes','healthRegen')}`);}

'@
  $needle='function economy('; $i=$t.IndexOf($needle,[StringComparison]::Ordinal);if($i -lt 0){throw 'economy UI marker missing'};$t=$t.Substring(0,$i)+$fn+$t.Substring($i)
}
if(-not $t.Contains("healthRegenSection(p,s)+section('Quick timelines'")){
  $needle=")+section('Quick timelines'";if(-not $t.Contains($needle)){throw 'Quick timelines UI marker missing'};$t=$t.Replace($needle,")+healthRegenSection(p,s)+section('Quick timelines'")
}
# Add evidence hub card.
if(-not $t.Contains("['Health regeneration changes','healthRegen']")){$t=$t.Replace("['Player-state samples','playerState'],","['Player-state samples','playerState'],['Health regeneration changes','healthRegen'],")}
# Replace Source Health function regardless of whether V02 is present.
# Do not regex-match the function body: it contains nested braces/template literals.
$newHealth=@'
// SOURCE_HEALTH_V03 — production readiness is distinct from research-file availability.
function health(){
  const sources=state.model.sourceHealth??[],manifest=state.model.productionManifest??null,cov=manifest?.coverage??null;
  const productionIds=new Set(['player_state','runtime_health_regen','runtime_health_regen_events','runtime_items','runtime_item_events','runtime_permanent_buffs','runtime_permanent_buff_events','runtime_bridge_buffs','runtime_bridge_buff_events','runtime_primary_fire','runtime_primary_fire_events']);
  const legacyIds=new Set(['integrated_state','primary_ready']);
  const production=sources.filter(s=>productionIds.has(s.id)),legacy=sources.filter(s=>legacyIds.has(s.id)),research=sources.filter(s=>!productionIds.has(s.id)&&!legacyIds.has(s.id));
  const countPresent=rows=>rows.filter(x=>x.present).length;
  const sourceCards=(rows,kind)=>rows.map(s=>`<div class="source ${s.present?'ready':'missing'}"><strong><span class="status-dot"></span>${esc(s.id)} <span class="badge ${kind==='production'?'a':'b'}">${kind}</span></strong><small>${esc(s.purpose)}</small><div class="muted mono" style="margin-top:7px">${esc(s.file)} · ${s.present?bytes(s.bytes):'MISSING'}</div></div>`).join('');
  const ready=cov?.completeAuthoritative,total=cov?.authoritativeTotal,unsupported=cov?.notSupportedAuthoritative??null,failed=cov?.failedAuthoritative??null,blocked=cov?.blockedAuthoritative??null;
  const unsupportedIds=cov?.metricIds?.not_supported??[];
  const headline=Number.isFinite(ready)&&Number.isFinite(total)?`${ready}/${total} authoritative metrics production-ready for ${esc(state.replay)}.`:`Production manifest unavailable for ${esc(state.replay)}.`;
  return `<div class="section-head"><div><h2>Source health</h2><p>${headline} Research and legacy files are reported separately and do not reduce production coverage.</p></div></div>
  <section class="section"><div class="section-head"><div><h2>Authoritative production coverage</h2><p>Replay-generic capabilities produced by the current pipeline.</p></div></div><div class="grid">${stat('Production ready',Number.isFinite(ready)&&Number.isFinite(total)?`${ready} / ${total}`:'—','A')}${stat('Unsupported',unsupported??'—',unsupported===0?'A':'B',unsupportedIds.length?unsupportedIds.join(', '):'none')}${stat('Failed',failed??'—',failed===0?'A':'B')}${stat('Blocked',blocked??'—',blocked===0?'A':'B')}</div></section>
  <section class="section"><div class="section-head"><div><h2>Current production sources</h2><p>${countPresent(production)}/${production.length} current production source files present.</p></div></div><div class="source-grid">${sourceCards(production,'production')}</div></section>
  <section class="section"><div class="section-head"><div><h2>Research / diagnostic backlog</h2><p>${countPresent(research)}/${research.length} research source families present. Missing files here are expected until those domains are promoted.</p></div></div><div class="source-grid">${sourceCards(research,'research')}</div></section>
  <section class="section"><div class="section-head"><div><h2>Legacy / superseded sources</h2><p>${countPresent(legacy)}/${legacy.length} legacy sources present.</p></div></div><div class="source-grid">${sourceCards(legacy,'legacy')}</div></section><div class="section">${cautionStrip()}</div>`;
}
'@
$healthStart=$t.IndexOf('function health(){',[StringComparison]::Ordinal)
$metricCardStart=$t.IndexOf('function metricCard',$healthStart,[StringComparison]::Ordinal)
if($healthStart -lt 0 -or $metricCardStart -lt 0){throw "Source Health boundaries not found in inspector-v04\public\app.js"}
$commentStart=$t.LastIndexOf('// SOURCE_HEALTH_V0',$healthStart,[StringComparison]::Ordinal)
if($commentStart -ge 0){
  $between=$t.Substring($commentStart,$healthStart-$commentStart)
  if($between.IndexOf("`n`n",[StringComparison]::Ordinal) -lt 0){$healthStart=$commentStart}
}
$t=$t.Substring(0,$healthStart)+$newHealth+"`r`n"+$t.Substring($metricCardStart)
Write-Utf8 $p $t

# Production pipeline regression fixture: make health a real producer and move coverage to 68/68.
$p=Join-Path $RepoRoot 'inspector-v04\tests\production-pipeline.test.mjs';$t=Read-Utf8 $p
$t=$t.Replace("PRODUCTION_CAPABILITIES.find(c=>c.id==='health_regen').productionStatus,'not_supported'","PRODUCTION_CAPABILITIES.find(c=>c.id==='health_regen').productionStatus,'supported'")
$t=$t.Replace("flatMap(c=>c.metricIds).length,67","flatMap(c=>c.metricIds).length,68")
$t=$t.Replace("records 67/68 production coverage","records 68/68 production coverage")
if(-not $t.Contains("const healthProducer=join(root,'health-producer.mjs');")){
$healthFixture=@'
  const healthProducer=join(root,'health-producer.mjs');
  await writeFile(healthProducer,`import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';const root=process.argv[2],r=process.argv[3];await mkdir(join(root,'output',r),{recursive:true});await writeFile(join(root,'output',r,'runtime_health_regen_production_v01.json'),'{}\\n');await writeFile(join(root,'output',r,'runtime_health_regen_events_v01.jsonl'),'');`);
'@
  $needle="  const itemProducer=join(root,'item-producer.mjs');";$i=$t.IndexOf($needle,[StringComparison]::Ordinal);if($i -lt 0){throw 'itemProducer fixture marker missing'};$t=$t.Substring(0,$i)+$healthFixture+$t.Substring($i)
}
$rx=New-Object Text.RegularExpressions.Regex("\{id:'health',label:'health',capability:'health_regen',required:false\},")
if($rx.IsMatch($t)){$t=$rx.Replace($t,"{id:'health',label:'health',capability:'health_regen',required:true,dependsOn:['core'],args:[healthProducer,'{repoRoot}','{replay}'],expectedOutputs:[{path:'output/{replay}/runtime_health_regen_production_v01.json',minBytes:2},{path:'output/{replay}/runtime_health_regen_events_v01.jsonl',minBytes:0}]},",1)}
if(-not $t.Contains("runtime_health_regen_production_v01.json")){throw 'Health pipeline fixture was not patched'}
$t=$t.Replace('completeAuthoritative,67','completeAuthoritative,68').Replace('notSupportedAuthoritative,1','notSupportedAuthoritative,0')
# Existing test expects COMPLETE_WITH_UNSUPPORTED; after 68/68 it must be COMPLETE.
$t=$t.Replace("assert.equal(result.status,'COMPLETE_WITH_UNSUPPORTED_CAPABILITIES');","assert.equal(result.status,'COMPLETE');")
if(-not $t.Contains("result.results.find(r=>r.id==='health').status")){
  $needle="  assert.equal(result.results[0].status,'complete');";$t=$t.Replace($needle,$needle+"`r`n  assert.equal(result.results.find(r=>r.id==='health').status,'complete');")
}
Write-Utf8 $p $t

# Final markers.
$checks=@(
 @('inspector-v04\pipeline.json','runtime_health_regen_production_v01.json'),
 @('inspector-v04\lib\production-capabilities.mjs',"capability('health_regen', 'Observed runtime health regeneration', 'supported'"),
 @('inspector-v04\lib\metric-registry.mjs',"m('health_regen','Observed health regen'"),
 @('inspector-v04\lib\replay-model.mjs','function applyRuntimeHealthRegen('),
 @('inspector-v04\lib\io.mjs',"['runtime_health_regen','runtime_health_regen_production_v01.json'"),
 @('inspector-v04\server.mjs',"healthRegen:['jsonl','runtime_health_regen_events_v01.jsonl']"),
 @('inspector-v04\public\app.js','function healthRegenSection('),
 @('inspector-v04\public\app.js','SOURCE_HEALTH_V03'),
 @('inspector-v04\tests\production-pipeline.test.mjs','completeAuthoritative,68')
)
foreach($c in $checks){$q=Join-Path $RepoRoot $c[0];if(-not(Test-Path $q)){throw "Verification file missing: $($c[0])"};if(-not(Read-Utf8 $q).Contains($c[1])){throw "Verification marker missing in $($c[0]): $($c[1])"}}
Write-Host ''
Write-Host 'HEALTH REGEN PRODUCTION V01C INSTALLED' -ForegroundColor Green
Write-Host "Backup: $BackupRoot"
Write-Host 'Next: run Node syntax/tests, then run production on 104373259.'
