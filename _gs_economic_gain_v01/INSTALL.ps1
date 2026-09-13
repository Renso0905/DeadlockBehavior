param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$NodePath = "G:\Node\node.exe"
if (-not (Test-Path $NodePath)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Node.js was not found." }
  $NodePath = $cmd.Source
}

& $NodePath (Join-Path $PSScriptRoot "install.mjs") $RepoRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
