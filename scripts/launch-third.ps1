$ErrorActionPreference = 'Stop'
$env:CLAUDE_CONFIG_DIR = Join-Path $env:USERPROFILE '.claude-third'
New-Item -ItemType Directory -Force -Path $env:CLAUDE_CONFIG_DIR | Out-Null

$package = Get-AppxPackage -Name Claude | Select-Object -First 1
if (-not $package) { throw 'Claude Desktop is not installed.' }

$source = Join-Path $package.InstallLocation 'app'
$portable = Join-Path $env:LOCALAPPDATA ("ClaudePortableThird\" + $package.Version)
$portableExe = Join-Path $portable 'Claude.exe'
if (-not (Test-Path -LiteralPath $portableExe)) {
  New-Item -ItemType Directory -Force -Path $portable | Out-Null
  & robocopy $source $portable /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS | Out-Null
  if ($LASTEXITCODE -gt 7 -or -not (Test-Path -LiteralPath $portableExe)) {
    throw "Could not prepare portable Claude Desktop ($LASTEXITCODE)."
  }
}

$profile = Join-Path $env:LOCALAPPDATA 'ClaudeProfiles\Third'
New-Item -ItemType Directory -Force -Path $profile | Out-Null
Start-Process -FilePath $portableExe -WorkingDirectory $portable `
  -ArgumentList ('--user-data-dir=' + [char]34 + $profile + [char]34)
