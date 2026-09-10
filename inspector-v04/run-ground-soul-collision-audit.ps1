param(
  [Parameter(Position=0)]
  [string]$Replay = "104373259",
  [Parameter(Position=1)]
  [Nullable[double]]$FocusSeconds = $null,
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

$RepoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $RepoRoot
try {
  $args = @(".\scripts\207-audit-ground-soul-collision-resolution-v02.mjs", $Replay)
  if ($null -ne $FocusSeconds) { $args += [string]$FocusSeconds }
  & $NodePath @args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally { Pop-Location }
