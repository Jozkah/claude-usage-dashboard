# One-time Windows setup: start dashboard at sign-in and add a Desktop shortcut.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$startupScript = Join-Path $PSScriptRoot 'start-dashboard.ps1'
$openScript = Join-Path $PSScriptRoot 'open-dashboard.ps1'
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startupScript + '"'

Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' `
  -Name 'ClaudeUsageDashboard' -Value ('"' + $powershell + '" ' + $arguments)

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Dashboard.lnk'))
$shortcut.TargetPath = $powershell
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $openScript + '"'
$shortcut.WorkingDirectory = $root
$icon = Join-Path $root 'assets\claude.ico'
if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = $icon + ',0' }
$shortcut.Save()

& $startupScript
Write-Output 'Dashboard installed for Windows sign-in. Desktop shortcut ready.'
