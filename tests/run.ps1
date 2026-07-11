#!/usr/bin/env pwsh
# Run all tests: backend store/session unit tests + client<->server integration tests.
#   ./tests/run.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Playwright: use a local install if present, else a NODE_PATH global.
if (-not $env:NODE_PATH) {
  if (Test-Path "/opt/node22/lib/node_modules") {
    $env:NODE_PATH = "/opt/node22/lib/node_modules"
  } else {
    # Windows/dev fallback: the global npm root, if it has Playwright.
    $g = (& npm root -g 2>$null)
    if ($g -and (Test-Path (Join-Path $g "playwright"))) { $env:NODE_PATH = $g }
  }
}

Write-Host "== backend store/session unit tests =="
node tests/store.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n== backend admin dashboard unit tests =="
node tests/admin.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n== backend legal endpoints unit tests =="
node tests/legal.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n== backend auth strategy unit tests =="
node tests/auth.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n== backend redirect sign-in unit tests =="
node tests/redirect.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n== backend direct submit auth unit tests =="
node tests/direct-submit-auth.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n== client<->server integration tests =="
node tests/integration.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n== guide slideshow accessibility tests =="
node tests/slideshow.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
