# Start the dashboard, wait for /api/health, then open the browser.
# Shortcut target:
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<repo>\scripts\open-dashboard.ps1"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot '_msg.ps1')
Set-Location -LiteralPath $root
$port = if ($env:PORT) { $env:PORT } else { '4777' }
$baseUrl = "http://127.0.0.1:$port"
& (Join-Path $PSScriptRoot 'start-dashboard.ps1')
$ready = $false
for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
  try { $ready = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/health" -TimeoutSec 1).StatusCode -eq 200 }
  catch { Start-Sleep -Seconds 1 }
}
if ($ready) { Start-Process $baseUrl }
else {
  Show-LauncherError 'Dashboard did not start within one minute. Check data\dashboard-watchdog.log (created once the watchdog has started) and data\dashboard-server-error.log.' 'Claude Usage Dashboard'
  exit 1
}
