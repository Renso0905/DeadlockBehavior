param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
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
& $NodePath (Join-Path $PSScriptRoot 'install.mjs') $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "Ground Soul economic coverage audit patch failed with exit code $LASTEXITCODE" }
