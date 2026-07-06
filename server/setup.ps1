#!/usr/bin/env pwsh
# One-shot setup for the repairs submit + moderation service.
#   ./setup.ps1          # interactive: fill .env, then `docker compose up --build`
#   ./setup.ps1 -NoRun   # fill .env only, don't start containers
#
# Fills the secrets you must provide (Google OAuth client ID, a scoped GitHub
# credential, and the Claude subscription token via `claude setup-token`), keeps
# any values already set, then builds and runs the service + moderation monitor.
[CmdletBinding()]
param([switch]$NoRun)
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
$EnvFile = ".env"
$Example = ".env.example"

function Say  ($m) { Write-Host $m -ForegroundColor Cyan }
function Warn ($m) { Write-Host $m -ForegroundColor Yellow }
function Err  ($m) { Write-Host $m -ForegroundColor Red }

# ---- read/write KEY=VALUE in .env (values written literally, incl \n-escaped PEMs) ----
function Get-EnvVal([string]$key) {
  if (-not (Test-Path $EnvFile)) { return "" }
  $line = Get-Content $EnvFile | Where-Object { $_ -match "^$([regex]::Escape($key))=" } | Select-Object -First 1
  if ($line) { return $line.Substring($line.IndexOf('=') + 1) }
  return ""
}
function Set-EnvVal([string]$key, [string]$val) {
  $lines = @()
  if (Test-Path $EnvFile) { $lines = @(Get-Content $EnvFile | Where-Object { $_ -notmatch "^$([regex]::Escape($key))=" }) }
  $lines += "$key=$val"
  Set-Content -Path $EnvFile -Value $lines
}
# A value is "unset" if empty or still the example placeholder.
function Test-Needs([string]$key) {
  $v = Get-EnvVal $key
  return ($v -eq "" -or @("xxxxxxxx.apps.googleusercontent.com", "github_pat_xxx", "sk-ant-oat01-xxxxx") -contains $v)
}
function Read-Secret([string]$label) {
  $sec = Read-Host $label -AsSecureString
  return [System.Net.NetworkCredential]::new("", $sec).Password
}
function Prompt-Value([string]$key, [string]$label, [switch]$Secret) {
  if (-not (Test-Needs $key)) { Say "✓ $label already set."; return }
  $val = if ($Secret) { Read-Secret $label } else { Read-Host $label }
  if ($val) { Set-EnvVal $key $val }
}

# ---- prerequisites ----
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Err "docker is required."; exit 1 }
docker compose version *> $null
if ($LASTEXITCODE -eq 0) { $Compose = @("docker", "compose") }
elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { $Compose = @("docker-compose") }
else { Err "docker compose (or docker-compose) is required."; exit 1 }

# ---- .env ----
if (-not (Test-Path $EnvFile)) { Copy-Item $Example $EnvFile; Say "Created $EnvFile from $Example." }

Say "== Google OAuth =="
Warn "Create a Web OAuth client at https://console.cloud.google.com/apis/credentials"
Warn "and add your app origin to 'Authorized JavaScript origins'."
Prompt-Value "GOOGLE_CLIENT_ID" "Google OAuth client ID"

Say "== GitHub credential =="
function Invoke-GhGenerate {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Warn "node is needed to generate a token - paste a PAT instead."; return $false }
  $owner = Get-EnvVal "GITHUB_OWNER"; if (-not $owner) { $owner = "sharpninja" }
  $repo  = Get-EnvVal "GITHUB_REPO";  if (-not $repo)  { $repo  = "repairs-data" }
  Warn "Create a GitHub App with repo permissions: Contents RW, Pull requests RW, Issues RW, Metadata R;"
  Warn "install it on $owner/$repo; download its private key (.pem). Then:"
  $app = Read-Host "GitHub App ID"
  $pem = Read-Host "Path to the App private key (.pem)"
  if (-not $app -or -not (Test-Path $pem)) { Err "Need an App ID and an existing .pem path."; return $false }
  if (-not (Test-Path "node_modules")) { Say "Installing server deps (one-time)…"; npm install *> $null; if ($LASTEXITCODE -ne 0) { Err "npm install failed."; return $false } }
  Say "Minting a scoped installation token…"
  $env:GITHUB_APP_ID = $app; $env:GITHUB_APP_PRIVATE_KEY_FILE = $pem; $env:GITHUB_OWNER = $owner; $env:GITHUB_REPO = $repo
  $out = node scripts/mint-token.mjs 2>$null
  Remove-Item Env:GITHUB_APP_PRIVATE_KEY_FILE -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0 -or -not $out) { Err "Token generation failed. Check the App ID, key, and that the App is installed on the repo."; return $false }
  try { $j = $out | ConvertFrom-Json } catch { Err "Could not parse the token output."; return $false }
  if (-not $j.token -or -not $j.installationId) { Err "Token generation returned nothing."; return $false }
  $esc = ((Get-Content $pem) -join '\n')   # PEM -> single line with literal \n
  Set-EnvVal "GITHUB_APP_ID" $app
  Set-EnvVal "GITHUB_APP_PRIVATE_KEY" $esc
  Set-EnvVal "GITHUB_APP_INSTALLATION_ID" "$($j.installationId)"
  Set-EnvVal "GITHUB_TOKEN" $j.token
  Say "✓ Scoped token generated (installation #$($j.installationId)). The service auto-refreshes via the App."
  return $true
}
if ((Test-Needs "GITHUB_TOKEN") -and (Test-Needs "GITHUB_APP_ID")) {
  Write-Host "  1) Generate a scoped token from a GitHub App (recommended, least-privilege)"
  Write-Host "  2) Paste a fine-grained PAT"
  $choice = Read-Host "Choose [1/2]"
  if ($choice -eq "1") {
    if (-not (Invoke-GhGenerate)) { Warn "Falling back to pasting a token."; Prompt-Value "GITHUB_TOKEN" "GitHub token" -Secret }
  } else {
    Warn "Fine-grained PAT scoped to the repo with Contents + Pull requests + Issues: Read/Write."
    Prompt-Value "GITHUB_TOKEN" "GitHub token" -Secret
  }
} else { Say "✓ GitHub credential already set." }

Say "== Claude subscription token (for moderation) =="
if (Test-Needs "CLAUDE_CODE_OAUTH_TOKEN") {
  if (Get-Command claude -ErrorAction SilentlyContinue) {
    Say "Running 'claude setup-token' - follow the browser prompt, then it prints a token."
    $captured = claude setup-token 2>&1 | Tee-Object -Variable teed | Out-String
    $m = [regex]::Matches($captured, 'sk-ant-oat[0-9A-Za-z_-]+')
    if ($m.Count -gt 0) { Set-EnvVal "CLAUDE_CODE_OAUTH_TOKEN" $m[$m.Count - 1].Value; Say "✓ Captured Claude token." }
    else { Warn "Couldn't auto-capture the token."; Set-EnvVal "CLAUDE_CODE_OAUTH_TOKEN" (Read-Secret "Paste the token (sk-ant-oat...)") }
  } else {
    Warn "The 'claude' CLI isn't installed here. On a machine logged into your Claude subscription, run:"
    Warn "  npm i -g @anthropic-ai/claude-code && claude setup-token"
    Set-EnvVal "CLAUDE_CODE_OAUTH_TOKEN" (Read-Secret "Paste the token (sk-ant-oat...)")
  }
} else { Say "✓ Claude token already set." }

Say "== Optional =="
$origin = Read-Host "App origin for CORS [$(Get-EnvVal 'ALLOWED_ORIGIN')]"
if ($origin) { Set-EnvVal "ALLOWED_ORIGIN" $origin }

# ---- verify required values ----
$missing = @()
if (Test-Needs "GOOGLE_CLIENT_ID") { $missing += "GOOGLE_CLIENT_ID" }
if (Test-Needs "CLAUDE_CODE_OAUTH_TOKEN") { $missing += "CLAUDE_CODE_OAUTH_TOKEN" }
if ((Test-Needs "GITHUB_TOKEN") -and (Test-Needs "GITHUB_APP_ID")) { $missing += "GITHUB_TOKEN (or a GitHub App)" }
if ($missing.Count -gt 0) { Err "Still unset: $($missing -join ', '). Edit $EnvFile and re-run."; exit 1 }
Say "✓ $EnvFile is ready."

# ---- run ----
if (-not $NoRun) {
  Say "Building and starting the service + moderation monitor…"
  $full = $Compose + @("up", "--build")
  & $full[0] @($full[1..($full.Count - 1)])
} else {
  Say "Done. Start it with:  $($Compose -join ' ') up --build"
}
