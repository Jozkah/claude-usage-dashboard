@echo off
rem Launch Claude Desktop and Claude Code with separate Work profiles.
rem Sign in to each Work profile once; subsequent launches reuse those logins.
setlocal
set "CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-work"

powershell -NoProfile -Command "$pkg = Get-AppxPackage -Name Claude | Select-Object -First 1; if (-not $pkg) { exit 1 }; $exe = Join-Path $pkg.InstallLocation 'app\Claude.exe'; if (-not (Test-Path -LiteralPath $exe)) { exit 1 }; $profile = Join-Path $env:LOCALAPPDATA 'ClaudeProfiles\Work'; New-Item -ItemType Directory -Force -Path $profile | Out-Null; Start-Process -FilePath $exe -ArgumentList ('--user-data-dir=' + [char]34 + $profile + [char]34)"
if errorlevel 1 echo Could not start Claude Desktop Work profile.

call claude %*
endlocal
