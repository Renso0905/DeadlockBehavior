param(
  [Parameter(Mandatory=$true)][string]$Replay,
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
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

$RepoRoot = (Resolve-Path $RepoRoot).Path
$env:DEADLOCK_REPO_ROOT = $RepoRoot
Write-Host "Running DeadlockBehavior production pipeline..."
Write-Host "Repo: $RepoRoot"
Write-Host "Replay: $Replay"
Write-Host "Node: $NodePath"
& $NodePath (Join-Path $PSScriptRoot "production\run-production.mjs") $Replay
exit $LASTEXITCODE
