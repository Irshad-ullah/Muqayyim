# Muqayyim — project rules

## Test record (required at the end of every part or change)

1. Run `scripts/run_all_tests` (`.\scripts\run_all_tests.ps1` on Windows, `scripts/run_all_tests.sh` in Git Bash).
   It runs every suite (AI, AI slow, Core, Gateway, frontend) and appends the run to `docs/testing/test-runs.md`
   and `docs/testing/runs/<date>-<commit>.json` automatically. A non-zero exit code means a suite failed; the strict
   xfails listed in `docs/testing/TEST_LOG.md` are not failures.
2. Add a section to `docs/testing/TEST_LOG.md`: change name, date, commit(s), suite counts, new test files (one line
   each), manual checks with their data, results and evidence, and problems found by testing with their fixes.
   Mask personal data; write "not recorded" rather than estimating.
3. Update `docs/testing/TEST_CATALOG.md` for every new or changed test (requirement → tests → type → status).
4. Commit these files with the change.

Never print or store secrets (JWT_SECRET, INTERNAL_API_KEY, passwords, tokens) in test output, logs or docs; refer to
variables by name only.
