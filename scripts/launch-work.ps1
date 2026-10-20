$ErrorActionPreference = 'Stop'

$package = Get-AppxPackage -Name Claude | Select-Object -First 1
if (-not $package) { throw 'Claude Desktop is not installed.' }

$source = Join-Path $package.InstallLocation 'app'
$exe = Join-Path $source 'Claude.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Claude executable missing: $exe" }

# MSIX now redirects direct launches to its running Personal instance. A copy
# outside WindowsApps keeps Electron's --user-data-dir instance lock separate.
$portable = Join-Path $env:LOCALAPPDATA ("ClaudePortableWork\" + $package.Version)
$portableExe = Join-Path $portable 'Claude.exe'
if (-not (Test-Path -LiteralPath $portableExe)) {
  New-Item -ItemType Directory -Force -Path $portable | Out-Null
  & robocopy $source $portable /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS | Out-Null
  if ($LASTEXITCODE -gt 7 -or -not (Test-Path -LiteralPath $portableExe)) {
    throw "Could not prepare portable Claude Desktop ($LASTEXITCODE)."
  }
}

$legacyProfile = Join-Path $env:LOCALAPPDATA ("Packages\" + $package.PackageFamilyName + "\LocalCache\Local\ClaudeProfiles\Work")
$currentProfile = Join-Path $env:LOCALAPPDATA 'ClaudeProfiles\Work'
$profile = if (Test-Path -LiteralPath (Join-Path $legacyProfile 'claude-code-sessions')) {
  $legacyProfile
} else {
  $currentProfile
}
New-Item -ItemType Directory -Force -Path $profile | Out-Null
Start-Process -FilePath $portableExe -WorkingDirectory $portable -ArgumentList ('--user-data-dir=' + [char]34 + $profile + [char]34)
