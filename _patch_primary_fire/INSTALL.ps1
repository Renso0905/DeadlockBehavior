param(
  [string]$RepoRoot = "G:\DeadlockBehavior"
)

$ErrorActionPreference = 'Stop'
$PatchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PayloadRoot = Join-Path $PatchRoot 'payload'
$InspectorRoot = Join-Path $RepoRoot 'inspector-v04'
if (-not (Test-Path $InspectorRoot)) { throw "Inspector root not found: $InspectorRoot" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = Join-Path $RepoRoot ("patch-backups\primary-fire-production-v01b-" + $stamp)
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$modify = @(
  'inspector-v04\pipeline.json',
  'inspector-v04\lib\production-capabilities.mjs',
  'inspector-v04\lib\replay-model.mjs',
  'inspector-v04\lib\io.mjs',
  'inspector-v04\server.mjs',
  'inspector-v04\public\app.js',
  'inspector-v04\tests\production-pipeline.test.mjs'
)
foreach ($rel in $modify) {
  $src = Join-Path $RepoRoot $rel
  if (-not (Test-Path $src)) { throw "Required current file missing: $src" }
  $dst = Join-Path $BackupRoot $rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  Copy-Item $src $dst -Force
}

function Read-Utf8([string]$Path) { return [IO.File]::ReadAllText($Path) }
$Utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
function Write-Utf8([string]$Path,[string]$Text) { [IO.File]::WriteAllText($Path,$Text,$script:Utf8NoBom) }
function Normalize-Lf([string]$Text) { return $Text.Replace("`r`n","`n") }
function Restore-Newlines([string]$Text,[bool]$UseCrLf) {
  if ($UseCrLf) { return $Text.Replace("`n","`r`n") }
  return $Text
}

# Idempotent replacement: safe on a clean tree or after the original V01 installer partially applied.
function Ensure-Replacement([string]$Rel,[string]$Old,[string]$New) {
  $path = Join-Path $RepoRoot $Rel
  $text = Read-Utf8 $path
  $usesCrLf = $text.Contains("`r`n")
  $normText = Normalize-Lf $text
  $normOld = Normalize-Lf $Old
  $normNew = Normalize-Lf $New

  if ($normText.Contains($normNew)) {
    Write-Host "Already applied: $Rel" -ForegroundColor DarkGray
    return
  }
  if (-not $normText.Contains($normOld)) {
    throw "Patch anchor not found in $Rel`n--- old anchor ---`n$Old`n--- expected patched form ---`n$New"
  }
  $patched = $normText.Replace($normOld,$normNew)
  Write-Utf8 $path (Restore-Newlines $patched $usesCrLf)
  Write-Host "Patched: $Rel" -ForegroundColor DarkGray
}

# Idempotent insertion using a short stable marker instead of matching the formatting of a preceding fixture block.
function Ensure-InsertBefore([string]$Rel,[string]$Marker,[string]$Insert,[string]$AlreadyMarker) {
  $path = Join-Path $RepoRoot $Rel
  $text = Read-Utf8 $path
  $usesCrLf = $text.Contains("`r`n")
  $normText = Normalize-Lf $text
  $normMarker = Normalize-Lf $Marker
  $normInsert = Normalize-Lf $Insert
  $normAlready = Normalize-Lf $AlreadyMarker

  if ($normText.Contains($normAlready)) {
    Write-Host "Already inserted: $Rel" -ForegroundColor DarkGray
    return
  }
  $index = $normText.IndexOf($normMarker,[StringComparison]::Ordinal)
  if ($index -lt 0) {
    throw "Insertion marker not found in $Rel`n--- marker ---`n$Marker"
  }
  $patched = $normText.Substring(0,$index) + $normInsert + "`n" + $normText.Substring($index)
  Write-Utf8 $path (Restore-Newlines $patched $usesCrLf)
  Write-Host "Inserted: $Rel" -ForegroundColor DarkGray
}

# New production files + pipeline definition. These copies are intentionally repeatable.
$copyFiles = @(
  'inspector-v04\production\extract-runtime-primary-fire.mjs',
  'inspector-v04\lib\runtime-primary-fire.mjs',
  'inspector-v04\tests\runtime-primary-fire.test.mjs',
  'inspector-v04\pipeline.json'
)
foreach ($rel in $copyFiles) {
  $src = Join-Path $PayloadRoot $rel
  $dst = Join-Path $RepoRoot $rel
  if (-not (Test-Path $src)) { throw "Patch payload missing: $src" }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  Copy-Item $src $dst -Force
}

# Promote the five Primary Fire A metrics from research-supported/not-production to supported production.
$old=@'
  capability('primary_fire_cadence', 'Primary weapon discharge cadence', 'not_supported', [
    'primary_discharges','primary_attack_rate','inter_attack_interval','next_primary_ready','ready_delay'
  ], {
    integrityValidation: 'Pending replay-generic production extractor.',
    semanticValidation: 'A004 primary weapon discharge authority. Firing means weapon discharge, not click/trigger-pull inference.',
    replicationStatus: 'Use current claim-registry replication status; production extraction is pending.'
  }, 'The effective-weapon research pipeline must be consolidated before these metrics can be produced on arbitrary replay import.')
'@
$new=@'
  capability('primary_fire_cadence', 'Primary weapon discharge cadence', 'supported', [
    'primary_discharges','primary_attack_rate','inter_attack_interval','next_primary_ready','ready_delay'
  ], {
    integrityValidation: 'Fresh runtime_primary_fire_production_v01.json and runtime_primary_fire_events_v01.jsonl must be produced. Every promoted discharge is a positive m_nShotNumber transition on a PrimaryWeapon entity, player-linked through the Source2 owner handle; last-attack corroboration and readiness-carrier availability are checked on every eligible replay.',
    semanticValidation: 'primary_weapon_discharge_telemetry current claim plus the promoted observed primary-attack readiness authority. Firing means observed weapon discharge, not click/trigger-pull inference. Readiness is the observed m_flNextPrimaryAttack - m_flLastAttackTime runtime carrier; static fire-rate formulas are not used as runtime authority.',
    replicationStatus: 'Primary discharge telemetry is multi-replay supported. The observed readiness carrier is strongly cross-replay replicated across rep01-rep05 (27,459/27,465 pooled sustained pairs aligned).'
  })
'@
Ensure-Replacement 'inspector-v04\lib\production-capabilities.mjs' $old $new

# Replay model: fingerprint/read the dedicated artifact and let it override only the A cadence fields.
Ensure-Replacement 'inspector-v04\lib\replay-model.mjs' `
  "'player_state.jsonl','player_state_summary.json','integrated_authoritative_player_state_substrate_v01.json','runtime_item_ownership_production_v01.json','runtime_permanent_buff_ownership_production_v01.json','runtime_bridge_buff_ownership_production_v01.json','behavioral_metrics_v02.json'," `
  "'player_state.jsonl','player_state_summary.json','integrated_authoritative_player_state_substrate_v01.json','runtime_item_ownership_production_v01.json','runtime_permanent_buff_ownership_production_v01.json','runtime_bridge_buff_ownership_production_v01.json','runtime_primary_fire_production_v01.json','runtime_primary_fire_events_v01.jsonl','behavioral_metrics_v02.json',"
Ensure-Replacement 'inspector-v04\lib\replay-model.mjs' `
  "  const runtimeBridge=await readJson(join(dir,'runtime_bridge_buff_ownership_production_v01.json'));" `
  "  const runtimeBridge=await readJson(join(dir,'runtime_bridge_buff_ownership_production_v01.json'));`n  const runtimePrimaryFire=await readJson(join(dir,'runtime_primary_fire_production_v01.json'));"
Ensure-Replacement 'inspector-v04\lib\replay-model.mjs' `
  "  const weapon=await aggregateWeaponEvents(join(dir,'effective_weapon_runtime_events_v01.jsonl'),playerByName,offset);" `
  "  const legacyWeapon=await aggregateWeaponEvents(join(dir,'effective_weapon_runtime_events_v01.jsonl'),playerByName,offset);`n  const weapon=applyRuntimePrimaryFire(playerByName,runtimePrimaryFire,legacyWeapon);"

$anchor=@'
async function aggregateWeaponEvents(path,playerByName,offset){
'@
$insert=@'
function applyRuntimePrimaryFire(playerByName,artifact,legacyWeapon=null){
  if(!artifact || artifact.status!=='RUNTIME_PRIMARY_FIRE_PRODUCTION_V01_READY') return legacyWeapon;
  const players=[...playerByName.values()],byPlayer={};
  for(const row of artifact.players??[]){
    const p=players.find(x=>Number.isInteger(row.controllerEntityIndex)&&x.identity?.controllerEntityIndex===row.controllerEntityIndex)
      ?? players.find(x=>row.steamId!=null&&String(x.identity?.steamId)===String(row.steamId))
      ?? playerByName.get(row.playerName);
    if(!p)continue;
    const w={
      ...(p.weapon??{}),
      events:row.dischargeEvents??0,
      discharges:row.discharges??0,
      primaryAttacksPerAliveMinute:row.primaryAttacksPerAliveMinute??null,
      meanInterAttackSeconds:row.interAttackIntervalSeconds?.mean??null,
      medianInterAttackSeconds:row.interAttackIntervalSeconds?.median??null,
      interAttackSampleCount:row.interAttackIntervalSeconds?.count??0,
      meanReadyDelaySeconds:row.readyDelaySeconds?.mean??null,
      medianReadyDelaySeconds:row.readyDelaySeconds?.median??null,
      readyDelaySampleCount:row.readyDelaySeconds?.count??0,
      lastObservedNextPrimaryReady:row.lastObservedNextPrimaryReady??null,
      lastAttackCorroborationRate:row.lastAttackCorroborationRate??null,
      authority:'runtime_primary_attack_ready_schedule',
      source:'runtime_primary_fire_production_v01.json'
    };
    p.weapon=w;byPlayer[p.playerName]=w;
  }
  return {
    ...(legacyWeapon??{}),
    events:artifact.counts?.dischargeEvents??0,
    discharges:artifact.counts?.dischargeUnits??0,
    byPlayer,
    authority:'runtime_primary_attack_ready_schedule',
    source:'runtime_primary_fire_production_v01.json'
  };
}

async function aggregateWeaponEvents(path,playerByName,offset){
'@
Ensure-Replacement 'inspector-v04\lib\replay-model.mjs' $anchor $insert

# Source Health distinguishes production authority from legacy effective-weapon research output.
$old=@'
    ['weapon_events','effective_weapon_runtime_events_v01.jsonl','A/B','Primary fire/reload evidence'],
    ['primary_ready','observed_primary_attack_ready_schedule_candidate_v01.json','A','Primary ready-schedule replay validation'],
'@
$new=@'
    ['runtime_primary_fire','runtime_primary_fire_production_v01.json','A','Replay-generic observed primary discharge and readiness cadence'],
    ['runtime_primary_fire_events','runtime_primary_fire_events_v01.jsonl','A','Observed primary discharge / readiness evidence'],
    ['weapon_events','effective_weapon_runtime_events_v01.jsonl','B','Legacy/research reload and fire-mode evidence'],
    ['primary_ready','observed_primary_attack_ready_schedule_candidate_v01.json','A','Legacy single-replay readiness research artifact; production authority is the dedicated runtime primary-fire artifact'],
'@
Ensure-Replacement 'inspector-v04\lib\io.mjs' $old $new

# Evidence drawer now prefers production Primary Fire events, with a legacy fallback.
Ensure-Replacement 'inspector-v04\server.mjs' `
  "  weapon:['jsonl','effective_weapon_runtime_events_v01.jsonl']," `
  "  weapon:['jsonl','runtime_primary_fire_events_v01.jsonl'],"
Ensure-Replacement 'inspector-v04\server.mjs' `
  "  if(kind==='items'&&!existsSync(path)){def=['json','integrated_authoritative_player_state_substrate_v01.json','players'];path=join(outputRoot,replay,def[1]);}" `
  "  if(kind==='items'&&!existsSync(path)){def=['json','integrated_authoritative_player_state_substrate_v01.json','players'];path=join(outputRoot,replay,def[1]);}`n  if(kind==='weapon'&&!existsSync(path)){def=['jsonl','effective_weapon_runtime_events_v01.jsonl'];path=join(outputRoot,replay,def[1]);}"

# Primary Fire tab: show all five A metrics, including next-primary-ready, from production fields.
$old=@'
function fire(p){const w=p.weapon??{};return playerHero(p)+section('Primary-fire cadence','Discharge/ready schedule is authoritative; reload/fire mode remain observed working telemetry',`<div class="grid">${metricCard('primary_discharges',w.discharges??0,'weapon')}${metricCard('primary_attack_rate',fmt(safeDiv(w.discharges,p.aliveMinutes),2),'weapon')}${metricCard('inter_attack_interval',`${fmt(w.medianInterAttackSeconds,4)} s median`,'weapon',`mean ${fmt(w.meanInterAttackSeconds,4)} s`)}${metricCard('ready_delay',`${fmt(w.medianReadyDelaySeconds,4)} s median`,'weapon',`mean ${fmt(w.meanReadyDelaySeconds,4)} s`)}${metricCard('reload_state',w.reloadTransitions??0,'weapon')}${metricCard('active_fire_mode',w.fireModeChanges??0,'weapon','mode-change events')}</div><div class="warning-box">Exact current ammo, effective magazine size, and effective DPS are intentionally absent. Those remain experimental/unresolved.</div>`)+evidenceButton('Inspect primary weapon runtime events','weapon');}
'@
$new=@'
function fire(p){const w=p.weapon??{},ready=w.lastObservedNextPrimaryReady;return playerHero(p)+section('Primary-fire cadence','Replay-generic observed discharge/ready schedule. Click any A card or the evidence button to inspect production rows.',`<div class="grid">${metricCard('primary_discharges',w.discharges??0,'weapon')}${metricCard('primary_attack_rate',fmt(w.primaryAttacksPerAliveMinute??safeDiv(w.discharges,p.aliveMinutes),2),'weapon')}${metricCard('inter_attack_interval',`${fmt(w.medianInterAttackSeconds,4)} s median`,'weapon',`mean ${fmt(w.meanInterAttackSeconds,4)} s`)}${metricCard('next_primary_ready',ready?.matchTimeSeconds!=null?clock(ready.matchTimeSeconds,true):'—','weapon',ready?.tick!=null?`last observed schedule · tick ${ready.tick}`:'last observed schedule')}${metricCard('ready_delay',`${fmt(w.medianReadyDelaySeconds,4)} s median`,'weapon',`mean ${fmt(w.meanReadyDelaySeconds,4)} s`)}${metricCard('reload_state',w.reloadTransitions??0,'weapon')}${metricCard('active_fire_mode',w.fireModeChanges??0,'weapon','mode-change events')}</div><div class="warning-box"><strong>Semantic boundary:</strong> these A metrics are observed weapon discharges/readiness, not trigger pulls or generic accuracy. Exact current ammo, effective magazine size, effective DPS, and static fire-rate composition remain excluded.</div>`)+evidenceButton('Inspect primary-fire production events','weapon');}
'@
Ensure-Replacement 'inspector-v04\public\app.js' $old $new

# Production-pipeline regression fixture. Every operation below is independently idempotent so it can repair the exact partial state reported by the failed V01 installer.
Ensure-Replacement 'inspector-v04\tests\production-pipeline.test.mjs' `
  "test('pipeline requires fresh outputs and records 62/68 production coverage',async()=>{" `
  "test('pipeline requires fresh outputs and records 67/68 production coverage',async()=>{"

$old=@'
  const bridge=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_bridge_buff_ownership');
  assert.equal(bridge.productionStatus,'supported');
  assert.equal(bridge.metricIds.length,7);
  assert.equal(PRODUCTION_CAPABILITIES.filter(c=>c.productionStatus==='supported').flatMap(c=>c.metricIds).length,62);
'@
$new=@'
  const bridge=PRODUCTION_CAPABILITIES.find(c=>c.id==='runtime_bridge_buff_ownership');
  assert.equal(bridge.productionStatus,'supported');
  assert.equal(bridge.metricIds.length,7);
  const fire=PRODUCTION_CAPABILITIES.find(c=>c.id==='primary_fire_cadence');
  assert.equal(fire.productionStatus,'supported');
  assert.equal(fire.metricIds.length,5);
  assert.equal(PRODUCTION_CAPABILITIES.filter(c=>c.productionStatus==='supported').flatMap(c=>c.metricIds).length,67);
'@
Ensure-Replacement 'inspector-v04\tests\production-pipeline.test.mjs' $old $new

$fireProducer=@'
  const fireProducer=join(root,'fire-producer.mjs');
  await writeFile(fireProducer,`import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';const root=process.argv[2],r=process.argv[3];await mkdir(join(root,'output',r),{recursive:true});await writeFile(join(root,'output',r,'runtime_primary_fire_production_v01.json'),'{}\\n');await writeFile(join(root,'output',r,'runtime_primary_fire_events_v01.jsonl'),'');`);
'@
Ensure-InsertBefore 'inspector-v04\tests\production-pipeline.test.mjs' `
  "  const pipeline={" `
  $fireProducer `
  "  const fireProducer=join(root,'fire-producer.mjs');"

Ensure-Replacement 'inspector-v04\tests\production-pipeline.test.mjs' `
  "    {id:'fire',label:'fire',capability:'primary_fire_cadence',required:false}" `
  "    {id:'fire',label:'fire',capability:'primary_fire_cadence',required:true,dependsOn:['core'],args:[fireProducer,'{repoRoot}','{replay}'],expectedOutputs:[{path:'output/{replay}/runtime_primary_fire_production_v01.json',minBytes:2},{path:'output/{replay}/runtime_primary_fire_events_v01.jsonl',minBytes:0}]}"
Ensure-Replacement 'inspector-v04\tests\production-pipeline.test.mjs' `
  "  assert.equal(result.productionManifest.coverage.completeAuthoritative,62);" `
  "  assert.equal(result.productionManifest.coverage.completeAuthoritative,67);"
Ensure-Replacement 'inspector-v04\tests\production-pipeline.test.mjs' `
  "  assert.equal(result.productionManifest.coverage.notSupportedAuthoritative,6);" `
  "  assert.equal(result.productionManifest.coverage.notSupportedAuthoritative,1);"

# Final marker verification catches a malformed or unexpectedly divergent tree before reporting success.
$verify = @(
  @{Rel='inspector-v04\pipeline.json'; Marker='"id": "primary-fire"'},
  @{Rel='inspector-v04\lib\production-capabilities.mjs'; Marker="capability('primary_fire_cadence', 'Primary weapon discharge cadence', 'supported'"},
  @{Rel='inspector-v04\lib\replay-model.mjs'; Marker='function applyRuntimePrimaryFire('},
  @{Rel='inspector-v04\lib\io.mjs'; Marker="['runtime_primary_fire','runtime_primary_fire_production_v01.json','A'"},
  @{Rel='inspector-v04\server.mjs'; Marker="weapon:['jsonl','runtime_primary_fire_events_v01.jsonl']"},
  @{Rel='inspector-v04\public\app.js'; Marker="metricCard('next_primary_ready'"},
  @{Rel='inspector-v04\tests\production-pipeline.test.mjs'; Marker="const fireProducer=join(root,'fire-producer.mjs');"},
  @{Rel='inspector-v04\tests\production-pipeline.test.mjs'; Marker='completeAuthoritative,67'},
  @{Rel='inspector-v04\tests\production-pipeline.test.mjs'; Marker='notSupportedAuthoritative,1'}
)
foreach ($v in $verify) {
  $path = Join-Path $RepoRoot $v.Rel
  if (-not (Test-Path $path)) { throw "Verification file missing: $($v.Rel)" }
  if (-not (Read-Utf8 $path).Contains($v.Marker)) { throw "Verification marker missing in $($v.Rel): $($v.Marker)" }
}

Write-Host ''
Write-Host 'PRIMARY FIRE PRODUCTION V01b INSTALLED / REPAIRED' -ForegroundColor Green
Write-Host "Backup: $BackupRoot"
Write-Host 'The installer is idempotent and is safe after the failed V01 attempt.'
Write-Host 'New production outputs: runtime_primary_fire_production_v01.json + runtime_primary_fire_events_v01.jsonl'
Write-Host 'Expected authoritative production coverage after a successful replay run: 67/68 (health_regen remains unsupported).'
