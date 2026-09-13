param([string]$RepoRoot = "G:\DeadlockBehavior")
$ErrorActionPreference = 'Stop'
$PatchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repair = Join-Path $PatchRoot 'repair.mjs'
if (-not (Test-Path (Join-Path $RepoRoot 'inspector-v04'))) { throw "Inspector root not found: $RepoRoot\inspector-v04" }
if (-not (Test-Path $Repair)) { throw "Repair payload missing: $Repair" }
$Node = 'G:\Node\node.exe'
if (-not (Test-Path $Node)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'Node executable not found.' }
  $Node = $cmd.Source
}
& $Node $Repair $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "Trooper V01c repair failed with exit code $LASTEXITCODE" }
