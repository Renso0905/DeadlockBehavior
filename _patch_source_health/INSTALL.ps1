param(
  [string]$RepoRoot = "G:\DeadlockBehavior"
)

$ErrorActionPreference = 'Stop'
$PatchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PayloadRoot = Join-Path $PatchRoot 'payload'
$InspectorRoot = Join-Path $RepoRoot 'inspector-v04'
if (-not (Test-Path $InspectorRoot)) { throw "Inspector root not found: $InspectorRoot" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = Join-Path $RepoRoot ("patch-backups\source-health-semantics-v01-" + $stamp)
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$backupFiles = @(
  'inspector-v04\lib\replay-model.mjs',
  'inspector-v04\public\app.js'
)
foreach ($rel in $backupFiles) {
  $src = Join-Path $RepoRoot $rel
  if (-not (Test-Path $src)) { throw "Required current file missing: $src" }
  $dst = Join-Path $BackupRoot $rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  Copy-Item $src $dst -Force
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
function Read-Utf8([string]$Path) { return [IO.File]::ReadAllText($Path) }
function Write-Utf8([string]$Path,[string]$Text) { [IO.File]::WriteAllText($Path,$Text,$script:Utf8NoBom) }
function Normalize-Lf([string]$Text) { return $Text.Replace("`r`n","`n") }
function Restore-Newlines([string]$Text,[bool]$UseCrLf) { if($UseCrLf){return $Text.Replace("`n","`r`n")} return $Text }

function Ensure-LiteralReplacement([string]$Rel,[string]$Old,[string]$New,[string]$AlreadyMarker) {
  $path=Join-Path $RepoRoot $Rel
  $text=Read-Utf8 $path
  $usesCrLf=$text.Contains("`r`n")
  $norm=Normalize-Lf $text
  if($norm.Contains((Normalize-Lf $AlreadyMarker))) { Write-Host "Already applied: $Rel" -ForegroundColor DarkGray; return }
  $oldNorm=Normalize-Lf $Old
  if(-not $norm.Contains($oldNorm)) { throw "Patch anchor not found in $Rel`n--- anchor ---`n$Old" }
  $norm=$norm.Replace($oldNorm,(Normalize-Lf $New))
  Write-Utf8 $path (Restore-Newlines $norm $usesCrLf)
  Write-Host "Patched: $Rel" -ForegroundColor DarkGray
}

# 1) Make production_manifest_v01.json part of replay-model cache invalidation.
Ensure-LiteralReplacement `
  'inspector-v04\lib\replay-model.mjs' `
  "'runtime_primary_fire_events_v01.jsonl','behavioral_metrics_v02.json'," `
  "'runtime_primary_fire_events_v01.jsonl','production_manifest_v01.json','behavioral_metrics_v02.json'," `
  "'production_manifest_v01.json','behavioral_metrics_v02.json',"

# 2) Read the manifest as a first-class replay-model source.
Ensure-LiteralReplacement `
  'inspector-v04\lib\replay-model.mjs' `
  "  const runtimePrimaryFire=await readJson(join(dir,'runtime_primary_fire_production_v01.json'));" `
  "  const runtimePrimaryFire=await readJson(join(dir,'runtime_primary_fire_production_v01.json'));`n  const productionManifest=await readJson(join(dir,'production_manifest_v01.json'));" `
  "const productionManifest=await readJson(join(dir,'production_manifest_v01.json'));"

# 3) Expose it without changing extraction semantics.
Ensure-LiteralReplacement `
  'inspector-v04\lib\replay-model.mjs' `
  "    sourceHealth:health,`n    players," `
  "    sourceHealth:health,`n    productionManifest,`n    players," `
  "    productionManifest,`n    players,"

# 4) Replace the misleading file-count Source Health view with production-aware semantics.
$appPath=Join-Path $RepoRoot 'inspector-v04\public\app.js'
$appText=Read-Utf8 $appPath
if(-not $appText.Contains('SOURCE_HEALTH_V02')) {
  $newHealth=@'
// SOURCE_HEALTH_V02 — production readiness is not the same thing as research-file availability.
function health(){
  const sources=state.model.sourceHealth??[],manifest=state.model.productionManifest??null,cov=manifest?.coverage??null;
  const productionIds=new Set(['player_state','runtime_items','runtime_item_events','runtime_permanent_buffs','runtime_permanent_buff_events','runtime_bridge_buffs','runtime_bridge_buff_events','runtime_primary_fire','runtime_primary_fire_events']);
  const legacyIds=new Set(['integrated_state','primary_ready']);
  const production=sources.filter(s=>productionIds.has(s.id));
  const legacy=sources.filter(s=>legacyIds.has(s.id));
  const research=sources.filter(s=>!productionIds.has(s.id)&&!legacyIds.has(s.id));
  const countPresent=rows=>rows.filter(x=>x.present).length;
  const sourceCards=(rows,kind)=>rows.map(s=>`<div class="source ${s.present?'ready':'missing'}"><strong><span class="status-dot"></span>${esc(s.id)} <span class="badge ${kind==='production'?'a':'b'}">${kind}</span></strong><small>${esc(s.purpose)}</small><div class="muted mono" style="margin-top:7px">${esc(s.file)} · ${s.present?bytes(s.bytes):'MISSING'}</div></div>`).join('');
  const ready=cov?.completeAuthoritative, total=cov?.authoritativeTotal, unsupported=cov?.notSupportedAuthoritative??null, failed=cov?.failedAuthoritative??null, blocked=cov?.blockedAuthoritative??null;
  const unsupportedIds=cov?.metricIds?.not_supported??[];
  const headline=Number.isFinite(ready)&&Number.isFinite(total)?`${ready}/${total} authoritative metrics production-ready for ${esc(state.replay)}.`:`Production manifest unavailable for ${esc(state.replay)}.`;
  return `<div class="section-head"><div><h2>Source health</h2><p>${headline} Research and legacy files are reported separately and do not reduce production coverage.</p></div></div>
    <section class="section"><div class="section-head"><div><h2>Authoritative production coverage</h2><p>Replay-generic capabilities produced by the current pipeline.</p></div></div><div class="grid">
      ${stat('Production ready',Number.isFinite(ready)&&Number.isFinite(total)?`${ready} / ${total}`:'—','A')}
      ${stat('Unsupported',unsupported??'—',unsupported===0?'A':'B',unsupportedIds.length?unsupportedIds.join(', '):'none')}
      ${stat('Failed',failed??'—',failed===0?'A':'B')}
      ${stat('Blocked',blocked??'—',blocked===0?'A':'B')}
    </div></section>
    <section class="section"><div class="section-head"><div><h2>Current production sources</h2><p>${countPresent(production)}/${production.length} current production source files present. These are the files expected from capabilities already promoted to arbitrary-replay production.</p></div></div><div class="source-grid">${sourceCards(production,'production')}</div></section>
    <section class="section"><div class="section-head"><div><h2>Research / diagnostic backlog</h2><p>${countPresent(research)}/${research.length} research source families present. Missing files here are expected until those domains are promoted into the replay-generic production pipeline.</p></div></div><div class="source-grid">${sourceCards(research,'research')}</div></section>
    <section class="section"><div class="section-head"><div><h2>Legacy / superseded sources</h2><p>${countPresent(legacy)}/${legacy.length} legacy sources present. Dedicated runtime authorities supersede these files where applicable.</p></div></div><div class="source-grid">${sourceCards(legacy,'legacy')}</div></section>
    <div class="section">${cautionStrip()}</div>`;
}
'@
  $pattern='function health\(\)\{.*?\}\r?\n\r?\nfunction metricCard'
  $regex=New-Object System.Text.RegularExpressions.Regex($pattern,[System.Text.RegularExpressions.RegexOptions]::Singleline)
  $matches=$regex.Matches($appText)
  if($matches.Count -ne 1){throw "Expected exactly one Source Health function in inspector-v04\public\app.js; found $($matches.Count)."}
  $replacement=$newHealth+"`r`nfunction metricCard"
  $appText=$regex.Replace($appText,[System.Text.RegularExpressions.MatchEvaluator]{param($m) $replacement},1)
  Write-Utf8 $appPath $appText
  Write-Host 'Patched: inspector-v04\public\app.js' -ForegroundColor DarkGray
} else {
  Write-Host 'Already applied: inspector-v04\public\app.js' -ForegroundColor DarkGray
}

# Add regression coverage. Safe to overwrite this patch-owned test file.
$testSrc=Join-Path $PayloadRoot 'inspector-v04\tests\source-health-semantics.test.mjs'
$testDst=Join-Path $RepoRoot 'inspector-v04\tests\source-health-semantics.test.mjs'
if(-not (Test-Path $testSrc)){throw "Patch payload missing: $testSrc"}
Copy-Item $testSrc $testDst -Force

# Final integrity markers.
$checks=@(
  @{Path='inspector-v04\lib\replay-model.mjs';Marker="production_manifest_v01.json"},
  @{Path='inspector-v04\lib\replay-model.mjs';Marker="productionManifest,"},
  @{Path='inspector-v04\public\app.js';Marker='SOURCE_HEALTH_V02'},
  @{Path='inspector-v04\public\app.js';Marker='Authoritative production coverage'},
  @{Path='inspector-v04\tests\source-health-semantics.test.mjs';Marker='production coverage separately'}
)
foreach($check in $checks){
  $p=Join-Path $RepoRoot $check.Path
  if(-not (Test-Path $p)){throw "Verification file missing: $p"}
  if(-not (Read-Utf8 $p).Contains($check.Marker)){throw "Verification marker missing in $($check.Path): $($check.Marker)"}
}

Write-Host ''
Write-Host 'SOURCE HEALTH SEMANTICS V01 INSTALLED' -ForegroundColor Green
Write-Host "Backup: $BackupRoot"
Write-Host 'Restart the inspector server, then reload the replay model.'
