#!/usr/bin/env pwsh
#Requires -Version 7
# Package the PWA for the Apple App Store via PWABuilder's iOS generator.
# Project generation runs cross-platform; the Xcode build / archive / upload
# steps REQUIRE a Mac with Xcode and manual signing, so those are printed as
# follow-up rather than attempted here.
#
#   ./scripts/package-ios.ps1 -Domain sharpninja.github.io/repairs -BundleId dev.sharpninja.repairs
#
# -DryRun validates inputs and skips the PWABuilder network request.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Domain,     # host + path, e.g. sharpninja.github.io/repairs
  [Parameter(Mandatory)][string]$BundleId,   # iOS bundle identifier, e.g. dev.sharpninja.repairs
  [string]$AppName = "AI Auto Repairman",
  [string]$Output = "dist/ios",
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
function Fail($m) { Write-Error $m; exit 1 }

$root = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $root "docs/manifest.webmanifest"

Write-Host "== package-ios (Apple App Store / PWABuilder) =="
if (-not (Test-Path $manifest)) { Fail "Web App Manifest not found at $manifest" }
if (-not $IsMacOS) {
  Write-Warning "This host is not macOS. The Xcode project can be generated here, but building, archiving, and uploading REQUIRE a Mac with Xcode -- run the printed follow-up steps there."
}

$url = "https://$Domain/"
Write-Host "App URL  : $url"
Write-Host "BundleId : $BundleId"
Write-Host "AppName  : $AppName"
Write-Host "Output   : $Output"
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$zipPath = Join-Path $Output "ios-package.zip"

if ($DryRun) {
  Write-Host "`n[DryRun] inputs validated; skipping the PWABuilder request."
}
else {
  Write-Host "`n-- requesting an iOS package from PWABuilder --"
  $body = @{
    url = $url; name = $AppName; bundleId = $BundleId
    imageUrl = "https://$Domain/icon-512.png"
    splashColor = "#faf9f5"; progressBarColor = "#d97757"; statusBarStyle = "default"
    permittedUrls = @()
  } | ConvertTo-Json
  $endpoint = "https://pwabuilder-ios.azurewebsites.net/packages/create"
  $ok = $false
  try {
    Invoke-WebRequest -Uri $endpoint -Method Post -ContentType "application/json" -Body $body -OutFile $zipPath -TimeoutSec 120
    if ((Test-Path $zipPath) -and ((Get-Item $zipPath).Length -gt 0)) { $ok = $true }
  }
  catch { Write-Warning "PWABuilder iOS request failed: $($_.Exception.Message)" }
  if ($ok) {
    Write-Host "✓ Downloaded $zipPath"
    try { Expand-Archive -Path $zipPath -DestinationPath (Join-Path $Output "project") -Force } catch {}
  }
  else {
    Write-Warning "Could not fetch the package automatically (PWABuilder's packaging API changes over time)."
    Write-Host "Fallback: open https://www.pwabuilder.com, enter $url, choose iOS, set Bundle ID $BundleId, and download the package into $Output."
  }
}

Write-Host ""
Write-Host "Manual follow-up (run on a Mac with Xcode):"
Write-Host "  1. Unzip the package and open the generated .xcworkspace / .xcodeproj in Xcode."
Write-Host "  2. Signing & Capabilities: pick your Team and confirm Bundle Identifier '$BundleId'."
Write-Host "  3. Add genuine native functionality before submitting -- Apple guideline 4.2 rejects thin web wrappers."
Write-Host "  4. Product > Archive, then distribute via the Xcode Organizer or Transporter to App Store Connect."
Write-Host ""
Write-Host "✓ Done (project-generation stage)."
exit 0
