# Start the dashboard watchdog without a visible window. No VBScript needed.
# Shortcut target:
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<repo>\scripts\start-dashboard.ps1"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot '_msg.ps1')
Set-Location -LiteralPath $root
try {
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $root -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'watch-dashboard.ps1'))
} catch {
  Show-LauncherError "Could not start the dashboard watchdog: $($_.Exception.Message)" 'Claude Usage Dashboard'
  exit 1
}
