param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"
$node = if (Test-Path "G:\Node\node.exe") { "G:\Node\node.exe" } else { (Get-Command node -ErrorAction Stop).Source }
& $node (Join-Path $PSScriptRoot "repair.mjs") $RepoRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
