#!/usr/bin/env pwsh
#Requires -Version 7
# Orchestrate the store-packaging scripts and print a summary of what was produced.
# Forwards shared params to package-android.ps1 and/or package-ios.ps1.
#
#   $pw = Read-Host -AsSecureString "keystore password"
#   ./scripts/package-apps.ps1 -Platform Both -Domain sharpninja.github.io/repairs `
#       -PackageId dev.sharpninja.repairs -KeystorePath .\release.keystore -KeystorePassword $pw
#
# -DryRun forwards a dry run to each sub-script (validate prerequisites, no build).
[CmdletBinding()]
param(
  [ValidateSet("Android", "iOS", "Both")][string]$Platform = "Both",
  [Parameter(Mandatory)][string]$Domain,
  [string]$PackageId = "dev.sharpninja.repairs",   # Android application id / iOS bundle id
  [string]$AppName = "AI Auto Repairman",
  [string]$KeystorePath,
  [securestring]$KeystorePassword,
  [string]$OutputRoot = "dist",
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$results = @()

if ($Platform -in @("Android", "Both")) {
  if (-not $KeystorePath -or -not $KeystorePassword) { Write-Error "Android packaging needs -KeystorePath and -KeystorePassword."; exit 1 }
  $out = Join-Path $OutputRoot "android"
  $status = "ok"
  try {
    & (Join-Path $PSScriptRoot "package-android.ps1") -Domain $Domain -PackageId $PackageId -KeystorePath $KeystorePath -KeystorePassword $KeystorePassword -Output $out -DryRun:$DryRun
    if ($LASTEXITCODE -ne 0) { $status = "failed" }
  }
  catch { $status = "failed"; Write-Warning "Android: $($_.Exception.Message)" }
  $results += [pscustomobject]@{ Platform = "Android"; Status = $status; Output = $out }
}

if ($Platform -in @("iOS", "Both")) {
  $out = Join-Path $OutputRoot "ios"
  $status = "ok"
  try {
    & (Join-Path $PSScriptRoot "package-ios.ps1") -Domain $Domain -BundleId $PackageId -AppName $AppName -Output $out -DryRun:$DryRun
    if ($LASTEXITCODE -ne 0) { $status = "failed" }
  }
  catch { $status = "failed"; Write-Warning "iOS: $($_.Exception.Message)" }
  $results += [pscustomobject]@{ Platform = "iOS"; Status = $status; Output = $out }
}

Write-Host "`n== Packaging summary =="
Write-Host ("{0,-9} {1,-8} {2}" -f "PLATFORM", "STATUS", "OUTPUT")
foreach ($r in $results) { Write-Host ("{0,-9} {1,-8} {2}" -f $r.Platform, $r.Status, $r.Output) }

if (@($results | Where-Object { $_.Status -ne "ok" }).Count) { exit 1 }
