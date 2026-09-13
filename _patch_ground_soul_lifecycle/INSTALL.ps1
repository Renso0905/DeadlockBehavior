param([string]$RepoRoot = "G:\DeadlockBehavior")
$ErrorActionPreference = 'Stop'
$node = 'G:\Node\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }
& $node (Join-Path $PSScriptRoot 'install.mjs') $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "Ground Soul lifecycle installer failed with exit code $LASTEXITCODE" }
