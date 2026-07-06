#!/usr/bin/env pwsh
# Bootstrap the separate DATA repo (sharpninja/repairs-data) that the app reads.
# Creates the repo if needed, seeds marketplace.json onto the **approved** branch
# (the published branch the app fetches), and makes it the default branch so PRs
# target it. Run from the app repo root with the GitHub CLI authenticated.
#
#   ./scripts/init-data-repo.ps1 [-Owner sharpninja] [-Repo repairs-data] [-Seed docs/marketplace.json]
[CmdletBinding()]
param(
  [string]$Owner = "sharpninja",
  [string]$Repo  = "repairs-data",
  [string]$Seed  = "docs/marketplace.json"
)
$ErrorActionPreference = "Stop"
$Branch = "approved"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Error "Install the GitHub CLI and run 'gh auth login' first: https://cli.github.com"; exit 1 }
gh auth status *> $null; if ($LASTEXITCODE -ne 0) { Write-Error "Run 'gh auth login' first."; exit 1 }
if (-not (Test-Path $Seed)) { Write-Error "Seed file not found: $Seed"; exit 1 }

# Make sure git pushes to github.com authenticate via gh (idempotent).
gh auth setup-git *> $null

# Create the repo if it doesn't exist yet.
gh repo view "$Owner/$Repo" *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating $Owner/$Repo…"
  gh repo create "$Owner/$Repo" --public -d "Published data catalog for the Repairs app - the app reads the 'approved' branch. Community submissions arrive as PRs."
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  git -C $tmp init -q
  git -C $tmp checkout -q -b $Branch
  Copy-Item $Seed (Join-Path $tmp "marketplace.json")

  $readme = @'
# repairs-data

Published data for the [Repairs](https://github.com/{OWNER}/repairs) app.

The app reads `marketplace.json` from the **`{BRANCH}`** branch directly:
`https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/marketplace.json`

Community submissions arrive as **pull requests against `{BRANCH}`**. The submit
service (see the app repo's `server/`) opens and Claude-moderates them; merging a
PR publishes the change to what every app instance reads. Do not hand-edit outside
of reviewed PRs unless you know what you're doing.
'@
  $readme = $readme.Replace('{OWNER}', $Owner).Replace('{REPO}', $Repo).Replace('{BRANCH}', $Branch)
  Set-Content -Path (Join-Path $tmp "README.md") -Value $readme

  git -C $tmp add -A
  git -C $tmp -c user.email="app@localhost" -c user.name="repairs-bootstrap" commit -qm "Seed approved catalog"
  git -C $tmp remote add origin "https://github.com/$Owner/$Repo.git"
  Write-Host "Pushing the '$Branch' branch…"
  git -C $tmp push -q -u origin $Branch

  # Make 'approved' the default branch so submission PRs target it by default.
  gh repo edit "$Owner/$Repo" --default-branch $Branch *> $null

  Write-Host ""
  Write-Host "✓ Done."
  Write-Host "  App reads: https://raw.githubusercontent.com/$Owner/$Repo/$Branch/marketplace.json"
  Write-Host "  Submit service already defaults to GITHUB_REPO=$Repo GITHUB_BASE=$Branch"
  Write-Host "  Install your GitHub App (or scope the PAT) on $Owner/$Repo."
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
