param(
  [switch]$Prepare,
  [string]$NodePath = ""
)

if (-not $NodePath) {
  if (Test-Path "G:\Node\node.exe") { $NodePath = "G:\Node\node.exe" }
  else {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "Node.js was not found. Pass -NodePath or install/add node to PATH." }
    $NodePath = $cmd.Source
  }
}

$InspectorRoot = $PSScriptRoot
$RepoRoot = Split-Path -Parent $InspectorRoot
$Cohort = @('rep01','rep02','rep03','rep04','rep05')

Push-Location $RepoRoot
try {
  if ($Prepare) {
    Write-Host "Preparing Ground Soul V03 replication cohort..." -ForegroundColor Cyan
    foreach ($Replay in $Cohort) {
      $Dem = Join-Path $RepoRoot "replays\$Replay.dem"
      $Out = Join-Path $RepoRoot "output\$Replay"
      $LifecycleSummary = Join-Path $Out 'runtime_ground_soul_lifecycle_production_v01.json'
      $LifecycleEvents = Join-Path $Out 'runtime_ground_soul_lifecycle_events_v01.jsonl'
      $EconomicSummary = Join-Path $Out 'runtime_assigned_gold_economic_credit_production_v01.json'
      $EconomicEvents = Join-Path $Out 'runtime_assigned_gold_economic_credit_events_v01.jsonl'
      if (-not (Test-Path $Dem)) { throw "Replication replay missing: $Dem" }
      if (-not (Test-Path (Join-Path $Out 'player_state.jsonl'))) { throw "player_state.jsonl missing for $Replay. Production/research substrate must exist before V03." }
      if (-not (Test-Path (Join-Path $Out 'player_state_summary.json'))) { throw "player_state_summary.json missing for $Replay." }

      Write-Host ""; Write-Host "[$Replay] prerequisites" -ForegroundColor Yellow
      if (-not ((Test-Path $LifecycleSummary) -and (Test-Path $LifecycleEvents))) {
        Write-Host "  Generating runtime Ground Soul lifecycle..."
        & $NodePath '.\inspector-v04\production\extract-runtime-ground-soul-lifecycle.mjs' $Dem
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      } else { Write-Host "  Runtime Ground Soul lifecycle already present; reusing." }

      if (-not ((Test-Path $EconomicSummary) -and (Test-Path $EconomicEvents))) {
        Write-Host "  Generating current conservative economic-credit output..."
        & $NodePath '.\inspector-v04\production\extract-runtime-assigned-gold-economic-credit.mjs' $Dem
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      } else { Write-Host "  Current economic-credit output already present; reusing." }

      Write-Host "  Refreshing Coverage Audit V01 (includes direct currency0 rescan)..."
      & $NodePath '.\scripts\206-audit-ground-soul-economic-coverage-v01.mjs' $Replay
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

      Write-Host "  Refreshing Collision Audit V02..."
      & $NodePath '.\scripts\207-audit-ground-soul-collision-resolution-v02.mjs' $Replay
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
  }

  Write-Host ""; Write-Host "Running cross-replay Narrow-Isolation Validation V03..." -ForegroundColor Cyan
  & $NodePath '.\scripts\208-validate-ground-soul-narrow-isolation-cross-replay-v03.mjs'
  exit $LASTEXITCODE
}
finally { Pop-Location }
