#!/usr/bin/env pwsh
# Run all tests: backend store/session unit tests + client<->server integration tests.
#   ./tests/run.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Playwright: use a local install if present, else a NODE_PATH global.
if (-not $env:NODE_PATH -and (Test-Path "/opt/node22/lib/node_modules")) {
  $env:NODE_PATH = "/opt/node22/lib/node_modules"
}

Write-Host "== backend store/session unit tests =="
node tests/store.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n== client<->server integration tests =="
node tests/integration.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
