# Run every Muqayyim test suite and record the run (docs/testing/).
# Usage (repo root):  .\scripts\run_all_tests.ps1            all suites
#                     .\scripts\run_all_tests.ps1 -Only ai,core
# Exit code: 0 when every suite passed (expected xfails are not failures), else 1.
param([string]$Only = "")

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root "AIServices\backend\venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Error "AIServices venv not found at $python (create it first: see AIServices/SETUP.md)"
    exit 2
}
$runner = Join-Path $PSScriptRoot "run_all_tests.py"
if ($Only) { & $python $runner --only $Only } else { & $python $runner }
exit $LASTEXITCODE
