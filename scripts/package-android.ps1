#!/usr/bin/env pwsh
#Requires -Version 7
# Package the PWA as a Google Play app (Trusted Web Activity) with Bubblewrap.
# Generates + builds a signed Android App Bundle (.aab) from docs/manifest.webmanifest
# and writes docs/.well-known/assetlinks.json so Google can verify domain <-> app
# ownership (Digital Asset Links).
#
#   $pw = Read-Host -AsSecureString "keystore password"
#   ./scripts/package-android.ps1 -Domain sharpninja.github.io/repairs `
#       -PackageId dev.sharpninja.repairs -KeystorePath .\release.keystore -KeystorePassword $pw
#
# -DryRun validates prerequisites + writes assetlinks.json, then stops before the build.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Domain,               # host + path, e.g. sharpninja.github.io/repairs
  [Parameter(Mandatory)][string]$PackageId,            # Android application id, e.g. dev.sharpninja.repairs
  [Parameter(Mandatory)][string]$KeystorePath,         # release keystore (.jks/.keystore) — must already exist
  [Parameter(Mandatory)][securestring]$KeystorePassword,
  [string]$KeyAlias = "android",
  [string]$Output = "dist/android",
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
function Fail($m) { Write-Error $m; exit 1 }

$root = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $root "docs/manifest.webmanifest"

Write-Host "== package-android (Trusted Web Activity / Bubblewrap) =="

# --- prerequisites (fail early + name the missing dependency) ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js is required (Bubblewrap runs on Node). Install Node 18+ from https://nodejs.org and re-run." }
if (-not (Get-Command keytool -ErrorAction SilentlyContinue) -and -not (Get-Command java -ErrorAction SilentlyContinue)) {
  Fail "A JDK is required (keytool for signing + fingerprints, and the Android toolchain). Install JDK 17, ensure keytool/java are on PATH, and re-run."
}
if (-not (Test-Path $manifest)) { Fail "Web App Manifest not found at $manifest" }

# --- keystore must already exist: never silently generate a throwaway release keystore ---
if (-not (Test-Path $KeystorePath)) {
  Write-Host ""
  Write-Warning "Release keystore not found: $KeystorePath"
  Write-Host "Create one first and keep it (and its passwords) safe -- losing it means you can never update the app on Play:"
  Write-Host "  keytool -genkeypair -v -keystore `"$KeystorePath`" -alias $KeyAlias -keyalg RSA -keysize 2048 -validity 10000"
  Write-Host "(or let Bubblewrap create one interactively via 'npx @bubblewrap/cli init')."
  Fail "Missing keystore: $KeystorePath"
}

$plainPw = [System.Net.NetworkCredential]::new('', $KeystorePassword).Password
Write-Host "Manifest : $manifest"
Write-Host "Domain   : $Domain"
Write-Host "PackageId: $PackageId"
Write-Host "Keystore : $KeystorePath (alias $KeyAlias)"
Write-Host "Output   : $Output"

# --- SHA-256 cert fingerprint -> docs/.well-known/assetlinks.json ---
Write-Host "`n-- reading the SHA-256 certificate fingerprint --"
$ktOut = & keytool -list -v -keystore $KeystorePath -alias $KeyAlias -storepass $plainPw 2>&1
if ($LASTEXITCODE -ne 0) { Fail "keytool could not read the keystore (wrong password or alias '$KeyAlias'?):`n$($ktOut -join "`n")" }
$m = ($ktOut | Select-String -Pattern 'SHA256:\s*([0-9A-Fa-f:]+)' | Select-Object -First 1)
if (-not $m) { Fail "Could not parse a SHA-256 fingerprint from keytool output." }
$sha = $m.Matches.Groups[1].Value.Trim()
Write-Host "SHA-256  : $sha"

$entry = @{
  relation = @("delegate_permission/common.handle_all_urls")
  target   = @{ namespace = "android_app"; package_name = $PackageId; sha256_cert_fingerprints = @($sha) }
}
$wellKnown = Join-Path $root "docs/.well-known"
New-Item -ItemType Directory -Force -Path $wellKnown | Out-Null
$assetlinksPath = Join-Path $wellKnown "assetlinks.json"
($entry | ConvertTo-Json -Depth 6 -AsArray) | Set-Content -Path $assetlinksPath -Encoding utf8
Write-Host "Wrote    : $assetlinksPath  (must be served at https://$Domain/.well-known/assetlinks.json)"

if ($DryRun) { Write-Host "`n[DryRun] prerequisites OK and assetlinks.json written; skipping the Bubblewrap build."; exit 0 }

# --- Bubblewrap init + build (needs the Android SDK; Bubblewrap fetches it on first run) ---
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$manifestUrl = "https://$Domain/manifest.webmanifest"
Push-Location $Output
try {
  if (-not (Test-Path "twa-manifest.json")) {
    Write-Host "`n-- bubblewrap init ($manifestUrl) --"
    & npx --yes "@bubblewrap/cli" init --manifest $manifestUrl
    if ($LASTEXITCODE -ne 0) { Fail "bubblewrap init failed (see output above)." }
  }
  Write-Host "-- bubblewrap build --"
  & npx --yes "@bubblewrap/cli" build
  if ($LASTEXITCODE -ne 0) { Fail "bubblewrap build failed (see output above)." }
}
finally { Pop-Location }

$aab = Get-ChildItem -Path $Output -Filter *.aab -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Host ""
if ($aab) { Write-Host "✓ Built $($aab.FullName) -- upload to Play Console, and deploy docs/.well-known/assetlinks.json to your domain." }
else { Write-Warning "Build finished but no .aab was found under $Output; check the Bubblewrap output above." }
exit 0
