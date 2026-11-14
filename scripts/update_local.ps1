<#
  Windows fallback for the scheduled GitHub Actions job (03 section 7).
  Pulls first, fetches new NSE data into store/, commits it and pushes. The push starts the build and deploy.
  Run from Task Scheduler (see README), or by hand:  powershell -File scripts\update_local.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 1. activate the virtual environment
. "$root\.venv\Scripts\Activate.ps1"

# 2. always start from the latest remote state, so the push below is a fast-forward
git pull --rebase
if ($LASTEXITCODE -ne 0) { throw 'git pull --rebase failed; resolve it by hand and run again' }

# 3. fetch (no build: the Actions deploy job builds the site)
$env:PIPELINE_ENV = 'local'
python -m pipeline update --no-build
if ($LASTEXITCODE -ne 0) { throw "pipeline update failed (exit $LASTEXITCODE)" }

# 4. commit only if the store changed (request logs are not data and are left out)
git add store ':(exclude)store/logs'
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host 'No store changes; nothing to commit.'
    exit 0
}
$latest = python -c "import json; print(json.load(open('store/calendar.json'))['tradingDays'][-1])"
git commit -m "data: $latest (local)"
git pull --rebase
git push
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
Write-Host "Pushed data: $latest"
