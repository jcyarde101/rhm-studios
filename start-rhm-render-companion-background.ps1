$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $projectRoot 'render-companion.pid'

if (Test-Path -LiteralPath $pidFile) {
  $savedPid = [int](Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue)
  if ($savedPid -and (Get-Process -Id $savedPid -ErrorAction SilentlyContinue)) {
    exit 0
  }
}

$stdout = Join-Path $projectRoot 'render-companion.log'
$stderr = Join-Path $projectRoot 'render-companion-error.log'
$env:NODE_USE_SYSTEM_CA = '1'
Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','render:worker' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
