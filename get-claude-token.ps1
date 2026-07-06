#!/usr/bin/env pwsh
# Capture a Claude subscription token and write it into server\.env.
# Run in a normal PowerShell window:
#     cd F:\GitHub\repairs
#     .\get-claude-token.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $here "server\.env"

if (-not (Test-Path $envFile)) { Write-Host "server\.env not found at $envFile" -ForegroundColor Red; exit 1 }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "'claude' CLI not found on PATH. Install it, or paste the token manually below." -ForegroundColor Yellow
}

$token = $null
if (Get-Command claude -ErrorAction SilentlyContinue) {
  Write-Host "Running 'claude setup-token' - authorize in the browser, then it prints a token..." -ForegroundColor Cyan
  $captured = claude setup-token 2>&1 | Tee-Object -Variable teed | Out-String
  $m = [regex]::Matches($captured, 'sk-ant-oat[0-9A-Za-z_-]+')
  if ($m.Count -gt 0) { $token = $m[$m.Count - 1].Value }
}

if (-not $token) {
  Write-Host "Couldn't auto-capture the token." -ForegroundColor Yellow
  $sec = Read-Host "Paste the token (sk-ant-oat...)" -AsSecureString
  $token = [System.Net.NetworkCredential]::new("", $sec).Password
}
if (-not $token) { Write-Host "No token captured. Aborting." -ForegroundColor Red; exit 1 }

# Replace (or append) the CLAUDE_CODE_OAUTH_TOKEN line in server\.env.
$lines = [System.IO.File]::ReadAllLines($envFile)
$found = $false
$out = foreach ($ln in $lines) {
  if ($ln -match '^CLAUDE_CODE_OAUTH_TOKEN=') { "CLAUDE_CODE_OAUTH_TOKEN=$token"; $found = $true }
  else { $ln }
}
if (-not $found) { $out = @($out) + "CLAUDE_CODE_OAUTH_TOKEN=$token" }
[System.IO.File]::WriteAllLines($envFile, [string[]]$out)

Write-Host ""
Write-Host "OK - wrote CLAUDE_CODE_OAUTH_TOKEN to server\.env (token length $($token.Length))." -ForegroundColor Green
Write-Host "Now tell Claude Code: '.env is ready'." -ForegroundColor Green
