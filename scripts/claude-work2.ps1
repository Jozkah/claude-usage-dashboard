# Hidden launcher for the Work2 profile.
. (Join-Path $PSScriptRoot '_msg.ps1')
& (Join-Path $PSScriptRoot 'launch-profile.ps1') -Name Work2
if (-not $?) { Show-LauncherError 'Could not start Claude Desktop Work2 profile. See data\launcher.log.' 'Claude Work2'; exit 1 }
