# Install the e2e-playground skills for AI coding tools that read SKILL.md folders.
# Step-by-step guide: docs/INSTALL.md (English) / docs/INSTALL.th.md (ไทย)
#
#   .\install.ps1                         # default: ~/.agents/skills + ~/.codex/skills
#   .\install.ps1 -Tools cursor,copilot   # pick tools (agents codex gemini copilot cursor claude)
#   .\install.ps1 -Dest D:\my\skills      # any other tool: its skills folder
#   .\install.ps1 -Copy                   # copy instead of link (links follow `git pull`)
#   .\install.ps1 -Zip                    # make dist\<skill>.zip for claude.ai / Claude Desktop upload
#   .\install.ps1 -Remove                 # take the links/copies out again
#
# Claude Code: use the plugin instead (one source, no duplicates):
#   /plugin marketplace add Nextjingjing/e2e-playground
#   /plugin install e2e-playground@e2e-playground
param(
  [string[]]$Tools = @("agents", "codex"),
  [string]$Dest,
  [switch]$Copy,
  [switch]$Zip,
  [switch]$Remove
)
$ErrorActionPreference = "Stop"
$src = Join-Path $PSScriptRoot "plugins\e2e-playground\skills"
$h = $env:USERPROFILE
# One folder per tool. ~/.agents/skills is read by Gemini CLI, VS Code Copilot and Cursor, so
# installing there AND into their own folder makes every skill show up twice.
$targets = [ordered]@{
  agents  = Join-Path $h ".agents\skills"    # shared: Gemini CLI, VS Code Copilot, Cursor
  codex   = Join-Path $h ".codex\skills"     # OpenAI Codex CLI / IDE / app
  gemini  = Join-Path $h ".gemini\skills"    # only if you skip "agents"
  copilot = Join-Path $h ".copilot\skills"   # only if you skip "agents"
  cursor  = Join-Path $h ".cursor\skills"    # only if you skip "agents"
  claude  = Join-Path $h ".claude\skills"    # only if you don't use the Claude Code plugin
}
$skills = Get-ChildItem $src -Directory

if ($Zip) {
  $out = Join-Path $PSScriptRoot "dist"
  New-Item -ItemType Directory -Force $out | Out-Null
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  foreach ($s in $skills) {
    $z = Join-Path $out "$($s.Name).zip"
    if (Test-Path $z) { Remove-Item $z }
    # Compress-Archive in PowerShell 5.1 writes "a\b" entry names; other systems need "a/b"
    $archive = [System.IO.Compression.ZipFile]::Open($z, "Create")
    foreach ($f in Get-ChildItem $s.FullName -Recurse -File | Where-Object { $_.FullName -notmatch "__pycache__|node_modules" }) {
      $entry = $s.Name + "/" + $f.FullName.Substring($s.FullName.Length + 1).Replace("\", "/")
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $entry) | Out-Null
    }
    $archive.Dispose()
    Write-Host "  zip $z"
  }
  Write-Host "Upload each zip in claude.ai: Customize > Skills > + (or Settings > Capabilities > Upload skill)."
  return
}

function Apply($dir) {
  foreach ($s in $skills) {
    $to = Join-Path $dir $s.Name
    if ($Remove) {
      if (Test-Path $to) {
        $item = Get-Item $to -Force
        # a junction: drop the link only (Remove-Item -Recurse on a junction can empty the source in PS 5.1)
        if ($item.LinkType) { [System.IO.Directory]::Delete($to, $false) }
        else { Remove-Item $to -Recurse -Force }
        Write-Host "  - $($s.Name)"
      }
      continue
    }
    New-Item -ItemType Directory -Force $dir | Out-Null
    if (Test-Path $to) { Write-Host "  = $($s.Name) already there"; continue }
    if ($Copy) { Copy-Item $s.FullName $to -Recurse }
    else { New-Item -ItemType Junction -Path $to -Target $s.FullName | Out-Null }  # no admin needed
    Write-Host "  + $($s.Name)"
  }
}

if ($Dest) { Write-Host $Dest; Apply $Dest }
else {
  foreach ($t in $Tools) {
    if (-not $targets.Contains($t)) { throw "unknown tool '$t' - use: $($targets.Keys -join ', ') or -Dest <folder>" }
    Write-Host "$t -> $($targets[$t])"
    Apply $targets[$t]
  }
}
Write-Host "Done. Restart the AI tool (or open a new chat) so it loads the skills."
