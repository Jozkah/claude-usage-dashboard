param(
  [Parameter(Mandatory)][ValidateSet('Work', 'Third')][string]$Name
)
$ErrorActionPreference = 'Stop'
$logDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'data'
try {
  # Claude Code config dir for this profile (also set by claude-work.cmd for its CLI half).
  $configDir = Join-Path $env:USERPROFILE ('.claude-' + $Name.ToLowerInvariant())
  if ($Name -eq 'Third') {
    $env:CLAUDE_CONFIG_DIR = $configDir
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
  }

  $package = Get-AppxPackage -Name Claude | Select-Object -First 1
  if (-not $package) { throw 'Claude Desktop is not installed.' }

  $source = Join-Path $package.InstallLocation 'app'
  if (-not (Test-Path -LiteralPath (Join-Path $source 'Claude.exe'))) { throw "Claude executable missing: $source" }

  # MSIX redirects direct launches to its running Personal instance. A copy
  # outside WindowsApps keeps Electron's --user-data-dir instance lock separate.
  $portableRoot = Join-Path $env:LOCALAPPDATA ('ClaudePortable' + $Name)
  $portable = Join-Path $portableRoot $package.Version
  $portableExe = Join-Path $portable 'Claude.exe'
  $marker = Join-Path $portable '.complete'
  if (-not ((Test-Path -LiteralPath $portableExe) -and (Test-Path -LiteralPath $marker))) {
    if (Test-Path -LiteralPath $portable) { Remove-Item -LiteralPath $portable -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $portable | Out-Null
    & robocopy $source $portable /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS | Out-Null
    if ($LASTEXITCODE -gt 7 -or -not (Test-Path -LiteralPath $portableExe)) {
      throw "Could not prepare portable Claude Desktop ($LASTEXITCODE)."
    }
    Set-Content -LiteralPath $marker -Value (Get-Date -Format o)
    # Drop copies of older Claude versions.
    Get-ChildItem -LiteralPath $portableRoot -Directory | Where-Object { $_.FullName -ne $portable } |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
  }

  $userDataDir = Join-Path $env:LOCALAPPDATA ('ClaudeProfiles\' + $Name)
  if ($Name -eq 'Work') {
    $legacy = Join-Path $env:LOCALAPPDATA ('Packages\' + $package.PackageFamilyName + '\LocalCache\Local\ClaudeProfiles\Work')
    if (Test-Path -LiteralPath (Join-Path $legacy 'claude-code-sessions')) { $userDataDir = $legacy }
  }
  New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null
  Start-Process -FilePath $portableExe -WorkingDirectory $portable `
    -ArgumentList ('--user-data-dir=' + [char]34 + $userDataDir + [char]34)
} catch {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Add-Content -LiteralPath (Join-Path $logDir 'launcher.log') -Value "$(Get-Date -Format o) [$Name] $($_.Exception.Message)"
  Write-Error $_.Exception.Message
  exit 1
}
