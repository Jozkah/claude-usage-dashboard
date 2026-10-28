$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
$log = Join-Path $root 'data\dashboard-watchdog.log'
$server = Join-Path $root 'server\index.js'
$dependency = Join-Path $root 'node_modules\classic-level\package.json'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null

$created = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\ClaudeUsageDashboardWatchdog', [ref]$created)
if (-not $created) { $mutex.Dispose(); exit 0 }

function Write-WatchLog([string]$message) {
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) $message"
}

try {
  $env:NO_OPEN = '1'
  while ($true) {
    try {
      if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $npm)) {
        throw 'Node.js or npm missing from Program Files.'
      }
      if (-not (Test-Path -LiteralPath $dependency)) {
        Write-WatchLog 'Installing dashboard dependencies.'
        Push-Location $root
        try {
          & $npm ci --prefer-offline --no-audit --no-fund *> (Join-Path $root 'data\dashboard-install.log')
          if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dependency)) {
            throw "npm ci failed with exit code $LASTEXITCODE."
          }
        } finally { Pop-Location }
      }
      try {
        $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4777/api/chats/sync-status' -TimeoutSec 4
        if ($response.StatusCode -ne 200) { throw "Dashboard returned $($response.StatusCode)." }
      } catch {
        Start-Process -FilePath $node -ArgumentList ('"' + $server + '"') -WorkingDirectory $root -WindowStyle Hidden
        Write-WatchLog 'Started dashboard server.'
      }
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
