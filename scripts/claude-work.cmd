@echo off
rem Launch Claude Desktop with a separate Work profile.
rem Pass --cli to open interactive Work Claude Code, or pass CLI arguments directly.
setlocal
set "CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-work"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-profile.ps1" -Name Work
if errorlevel 1 (
  echo Could not start Claude Desktop Work profile. See data\launcher.log.
  exit /b 1
)

if /i "%~1"=="--cli" (
  claude
  goto :done
)
if not "%~1"=="" claude %*
:done
endlocal
