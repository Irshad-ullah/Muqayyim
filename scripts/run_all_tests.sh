#!/usr/bin/env bash
# Run every Muqayyim test suite and record the run (docs/testing/).
# Usage (repo root, Git Bash):  scripts/run_all_tests.sh            all suites
#                               scripts/run_all_tests.sh --only ai,core
# Exit code: 0 when every suite passed (expected xfails are not failures), else 1.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/AIServices/backend/venv/Scripts/python.exe"
[ -x "$PY" ] || PY="$ROOT/AIServices/backend/venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "AIServices venv not found (create it first: see AIServices/SETUP.md)" >&2
  exit 2
fi
"$PY" "$ROOT/scripts/run_all_tests.py" "$@"
