param(
  [string]$RepoRoot = "G:\DeadlockBehavior",
  [string]$NodePath = ""
)
$ErrorActionPreference='Stop'
if (-not (Test-Path $RepoRoot)) { throw "Repo root not found: $RepoRoot" }
if (-not $NodePath) {
  if (Test-Path "G:\Node\node.exe") { $NodePath="G:\Node\node.exe" }
  else {
    $cmd=Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "Node.js not found. Pass -NodePath." }
    $NodePath=$cmd.Source
  }
}
$PatchRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
& $NodePath (Join-Path $PatchRoot 'install.mjs') $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "Installer failed with exit code $LASTEXITCODE" }
