@echo off
rem Launch Claude Desktop with a separate Work profile.
rem Pass --cli to open interactive Work Claude Code, or pass CLI arguments directly.
setlocal
set "CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-work"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-work.ps1"
if errorlevel 1 (
  echo Could not start Claude Desktop Work profile.
  exit /b 1
)

if /i "%~1"=="--cli" (
  call claude
  goto :done
)
if not "%~1"=="" call claude %*
:done
endlocal
