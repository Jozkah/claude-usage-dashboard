# Hidden launcher for the Work profile (claude-work.cmd remains for terminal/CLI use).
# Shortcut target:
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<repo>\scripts\claude-work.ps1"
. (Join-Path $PSScriptRoot '_msg.ps1')
& (Join-Path $PSScriptRoot 'launch-profile.ps1') -Name Work
if (-not $?) { Show-LauncherError 'Could not start Claude Desktop Work profile. See data\launcher.log.' 'Claude Work'; exit 1 }
