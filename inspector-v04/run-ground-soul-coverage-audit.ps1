param(
  [string]$Replay = "104373259",
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
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  & $NodePath ".\scripts\206-audit-ground-soul-economic-coverage-v01.mjs" $Replay
  if ($LASTEXITCODE -ne 0) { throw "Ground Soul coverage audit failed with exit code $LASTEXITCODE" }
}
finally { Pop-Location }
