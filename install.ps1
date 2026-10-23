# Install the e2e-playground skills for any AI coding tool that reads SKILL.md folders.
#
#   .\install.ps1                      # every tool found on this machine
#   .\install.ps1 -Tools codex,gemini  # only these
#   .\install.ps1 -Dest D:\my\skills   # any other tool: its skills folder
#   .\install.ps1 -Copy                # copy instead of link (links follow `git pull`)
#
# Claude Code is better served by the plugin (one source, no duplicates):
#   /plugin marketplace add Nextjingjing/e2e-playground
#   /plugin install e2e-playground@e2e-playground
param(
  [string[]]$Tools = @(),
  [string]$Dest,
  [switch]$Copy
)
$ErrorActionPreference = "Stop"
$src = Join-Path $PSScriptRoot "plugins\e2e-playground\skills"
$homeDir = $env:USERPROFILE
$targets = [ordered]@{
  codex  = Join-Path $homeDir ".codex\skills"    # OpenAI Codex CLI / IDE / app
  gemini = Join-Path $homeDir ".gemini\skills"   # Gemini CLI
  agents = Join-Path $homeDir ".agents\skills"   # shared location several tools scan
  claude = Join-Path $homeDir ".claude\skills"   # only if you don't use the plugin
}

function Install-Into($dir) {
  New-Item -ItemType Directory -Force $dir | Out-Null
  foreach ($skill in Get-ChildItem $src -Directory) {
    $to = Join-Path $dir $skill.Name
    if (Test-Path $to) { Write-Host "  skip $($skill.Name) (already in $dir)"; continue }
    if ($Copy) { Copy-Item $skill.FullName $to -Recurse }
    else { New-Item -ItemType Junction -Path $to -Target $skill.FullName | Out-Null }  # no admin needed
    Write-Host "  + $($skill.Name) -> $to"
  }
}

if ($Dest) { Install-Into $Dest; return }
if ($Tools.Count -eq 0) {
  # default: tools that are installed here (claude is left to the plugin)
  if (Get-Command codex -ErrorAction SilentlyContinue)  { $Tools += "codex" }
  if (Get-Command gemini -ErrorAction SilentlyContinue) { $Tools += "gemini" }
  $Tools += "agents"
}
foreach ($t in $Tools) {
  if (-not $targets.Contains($t)) { throw "unknown tool '$t' (use: $($targets.Keys -join ', ') or -Dest <folder>)" }
  Write-Host "$t -> $($targets[$t])"
  Install-Into $targets[$t]
}
Write-Host "Done. Restart the tool so it picks the skills up."
