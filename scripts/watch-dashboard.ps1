$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root 'data'
$log = Join-Path $dataDir 'dashboard-watchdog.log'
$serverLog = Join-Path $dataDir 'dashboard-server.log'
$serverErrLog = Join-Path $dataDir 'dashboard-server-error.log'
$server = Join-Path $root 'server\index.js'
$dependency = Join-Path $root 'node_modules\react\package.json'
$port = if ($env:PORT) { $env:PORT } else { '4777' }
$healthUrl = "http://127.0.0.1:$port/api/health"
$maxLogBytes = 1MB
$failuresBeforeRestart = 3
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$created = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\ClaudeUsageDashboardWatchdog', [ref]$created)
if (-not $created) { $mutex.Dispose(); exit 0 }

function Write-WatchLog([string]$message) {
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) $message"
}

# Keep the newest half of a log once it passes the size limit.
function Limit-Log([string]$path) {
  if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -gt $maxLogBytes) {
    $tail = Get-Content -LiteralPath $path -Tail 2000
    Set-Content -LiteralPath $path -Value $tail
  }
}

# PATH first (nvm-windows, Scoop, fnm, Volta, per-user installs), then Program Files.
function Resolve-Tool([string]$name, [string[]]$extensions) {
  foreach ($candidate in $extensions) {
    $found = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Source }
  }
  $fallback = Join-Path $env:ProgramFiles ('nodejs\' + $extensions[0])
  if (Test-Path -LiteralPath $fallback) { return $fallback }
  return $null
}

$child = $null
$failures = 0
try {
  $env:NO_OPEN = '1'
  while ($true) {
    try {
      $node = Resolve-Tool 'node' @('node.exe')
      $npm = Resolve-Tool 'npm' @('npm.cmd')
      if (-not $node -or -not $npm) { throw 'Node.js or npm not found on PATH or in Program Files.' }
      if (-not (Test-Path -LiteralPath $dependency)) {
        Write-WatchLog 'Installing dashboard dependencies.'
        $verb = if (Test-Path -LiteralPath (Join-Path $root 'package-lock.json')) { 'ci' } else { 'install' }
        $install = Start-Process -FilePath $npm -ArgumentList $verb, '--prefer-offline', '--no-audit', '--no-fund' `
          -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru `
          -RedirectStandardOutput (Join-Path $dataDir 'dashboard-install.log') `
          -RedirectStandardError (Join-Path $dataDir 'dashboard-install-error.log')
        if ($install.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $dependency)) {
          throw "npm $verb failed with exit code $($install.ExitCode)."
        }
      }
      $healthy = $false
      try {
        $response = Invoke-WebRequest -UseBasicParsing $healthUrl -TimeoutSec 4
        $healthy = ($response.StatusCode -eq 200)
      } catch { $healthy = $false }

      if ($healthy) {
        $failures = 0
      } else {
        $failures++
        $alive = $child -and -not $child.HasExited
        if ($alive -and $failures -lt $failuresBeforeRestart) {
          # Server we started is still starting up or briefly slow; wait.
        } else {
          if ($alive) {
            Write-WatchLog "Server unresponsive for $failures checks; stopping pid $($child.Id)."
            try { $child.Kill() } catch { }
          }
          Limit-Log $serverLog
          Limit-Log $serverErrLog
          $child = Start-Process -FilePath $node -ArgumentList ('"' + $server + '"') -WorkingDirectory $root `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrLog
          $failures = 0
          Write-WatchLog "Started dashboard server (pid $($child.Id))."
        }
      }
      Limit-Log $log
      Start-Sleep -Seconds 30
    } catch {
      Write-WatchLog $_.Exception.Message
      Start-Sleep -Seconds 60
    }
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
