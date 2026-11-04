# Hidden launcher for the Third profile.
# Shortcut target:
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<repo>\scripts\claude-third.ps1"
. (Join-Path $PSScriptRoot '_msg.ps1')
& (Join-Path $PSScriptRoot 'launch-profile.ps1') -Name Third
if (-not $?) { Show-LauncherError 'Could not start Claude Desktop Third profile. See data\launcher.log.' 'Claude Third'; exit 1 }
