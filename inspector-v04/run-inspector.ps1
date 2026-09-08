param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
  [int]$Port = 4177,
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
$env:DEADLOCK_OUTPUT_ROOT = Join-Path $RepoRoot "output"
$env:DEADLOCK_INSPECTOR_PORT = "$Port"

Write-Host "Starting DeadlockBehavior Inspector V04..."
Write-Host "Repo: $RepoRoot"
Write-Host "Node: $NodePath"
Write-Host "Open: http://127.0.0.1:$Port"
& $NodePath (Join-Path $PSScriptRoot "server.mjs")
