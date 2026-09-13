param(
  [string]$RepoRoot = "G:\DeadlockBehavior",
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

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
& $NodePath (Join-Path $Here "install.mjs") $RepoRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
