param(
  [string]$TavernWeaveRoot = (Join-Path $PSScriptRoot '..\..\TavernWeave'),
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh')
)

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Join-Path $TavernWeaveRoot 'skills'))
$target = [IO.Path]::GetFullPath((Join-Path $DshHome 'skills\tavernweave'))
$presetSource = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\presets\tavernweave-native'))
$presetTarget = [IO.Path]::GetFullPath((Join-Path $DshHome '.agent-presets\tavernweave-native'))

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "TavernWeave skills directory not found: $source"
}
$skillDirs = @(Get-ChildItem -LiteralPath $source -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'SKILL.md') })
if ($skillDirs.Count -ne 20) {
  throw "Expected 20 TavernWeave skills, found $($skillDirs.Count): $source"
}

New-Item -ItemType Directory -Force -Path (Split-Path $target), (Split-Path $presetTarget) | Out-Null
if (Test-Path -LiteralPath $target) {
  $item = Get-Item -LiteralPath $target -Force
  if (-not $item.LinkType -or ([IO.Path]::GetFullPath($item.Target) -ne $source)) {
    throw "Refusing to replace existing non-matching skill root: $target"
  }
} else {
  New-Item -ItemType Junction -Path $target -Target $source | Out-Null
}

if (Test-Path -LiteralPath $presetTarget) {
  $item = Get-Item -LiteralPath $presetTarget -Force
  if (-not $item.PSIsContainer -or $item.LinkType) {
    throw "Refusing to replace existing preset path: $presetTarget"
  }
} else {
  New-Item -ItemType Directory -Path $presetTarget | Out-Null
}
Copy-Item -LiteralPath (Join-Path $presetSource 'agent.cordis.yml') -Destination (Join-Path $presetTarget 'agent.cordis.yml') -Force
Copy-Item -LiteralPath (Join-Path $presetSource 'preset.yml') -Destination (Join-Path $presetTarget 'preset.yml') -Force

[pscustomobject]@{
  preset = $presetTarget
  skillRoot = $target
  skillCount = $skillDirs.Count
  next = 'Restart DSH or create a new session, then choose TavernWeave 原生工坊 in the Agent preset selector.'
} | ConvertTo-Json -Compress
