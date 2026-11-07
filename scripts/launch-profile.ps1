param(
  [Parameter(Mandatory)][ValidatePattern('^[A-Za-z][A-Za-z0-9]{0,31}$')][string]$Name
)
$ErrorActionPreference = 'Stop'
$logDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'data'
function Write-LaunchLog([string]$message) {
  try {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    Add-Content -LiteralPath (Join-Path $logDir 'launcher.log') -Value "$(Get-Date -Format o) [$Name] $message"
  } catch { }
}
try {
  # One launcher per profile at a time: clicking again while the first run is still copying must not pile up.
  $created = $false
  $mutex = [System.Threading.Mutex]::new($true, "Local\ClaudeProfileLaunch$Name", [ref]$created)
  if (-not $created) { Write-LaunchLog 'Another launch for this profile is still running; ignoring this click.'; $mutex.Dispose(); exit 0 }
  # Claude Code config dir for this profile (also set by claude-work.cmd for its CLI half).
  $configDir = Join-Path $env:USERPROFILE ('.claude-' + $Name.ToLowerInvariant())
  if ($Name -ne 'Work') {
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
    Write-LaunchLog "Preparing a separate copy of Claude Desktop $($package.Version) (first launch after an update takes a minute or two)."
    if (Test-Path -LiteralPath $portable) { Remove-Item -LiteralPath $portable -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $portable | Out-Null
    # /MT:4 keeps the copy quick without taking every core
    & robocopy $source $portable /E /MT:4 /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -gt 7 -or -not (Test-Path -LiteralPath $portableExe)) {
      throw "Could not prepare portable Claude Desktop ($LASTEXITCODE)."
    }
    Set-Content -LiteralPath $marker -Value (Get-Date -Format o)
    Write-LaunchLog 'Copy finished.'
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
  # Existing profiles get their chats and Personal's sidebar before Claude loads its in-memory index.
  # First sign-in has no account scope yet; background dashboard sync copies chats once it appears.
  try {
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'Claude.exe'" -ErrorAction Stop |
      Where-Object { $_.CommandLine -match [regex]::Escape($userDataDir) })
  } catch {
    Write-LaunchLog 'Cannot inspect running Claude processes; skipping profile bootstrap.'
    $running = @(1)
  }
  $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $running.Count -and $node) {
    & $node.Source (Join-Path $PSScriptRoot 'bootstrap-profile.mjs') $Name 2>&1 |
      ForEach-Object { Write-LaunchLog "Bootstrap: $_" }
    if ($LASTEXITCODE -ne 0) { Write-LaunchLog "Bootstrap exited with code $LASTEXITCODE." }
  }
  # Starting any account also starts the dashboard sync service, even without its own shortcut.
  & (Join-Path $PSScriptRoot 'start-dashboard.ps1')
  $mutex.ReleaseMutex()
  Start-Process -FilePath $portableExe -WorkingDirectory $portable `
    -ArgumentList ('--user-data-dir=' + [char]34 + $userDataDir + [char]34)
} catch {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Add-Content -LiteralPath (Join-Path $logDir 'launcher.log') -Value "$(Get-Date -Format o) [$Name] $($_.Exception.Message)"
  Write-Error $_.Exception.Message
  exit 1
}
