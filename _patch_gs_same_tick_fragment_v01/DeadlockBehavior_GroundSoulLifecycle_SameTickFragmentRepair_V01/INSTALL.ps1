param(
  [string]$RepoRoot = "G:\DeadlockBehavior",
  [string]$NodePath = ""
)
if (-not $NodePath) {
  if (Test-Path "G:\Node\node.exe") { $NodePath = "G:\Node\node.exe" }
  else { $NodePath = (Get-Command node -ErrorAction Stop).Source }
}
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
& $NodePath (Join-Path $Here 'install.mjs') $RepoRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
