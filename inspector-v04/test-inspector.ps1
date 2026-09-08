param(
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
Push-Location $PSScriptRoot
try { & $NodePath --test .\tests\*.test.mjs }
finally { Pop-Location }
