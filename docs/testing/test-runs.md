# Test runs

Appended automatically by `scripts/run_all_tests` (one entry per run, newest last).
Machine-readable copies: `docs/testing/runs/*.json`. Full console output: `docs/testing/runs/raw/` (git-ignored, kept locally).

## 2026-10-15 23:47 Pakistan Standard Time · `99f540a` (main, clean)

Commit: Add a permanent test record: run_all_tests, TEST_LOG, TEST_CATALOG  
Result: **PASS** · total time 240 s

| Suite | Result | Duration | Summary line |
|---|---|---|---|
| AIServices pytest | ✅ 506 passed, 0 failed, 1 skipped, 4 deselected | 149.3 s | `506 passed, 1 skipped, 4 deselected in 149.27s (0:02:29)` |
| AIServices pytest -m slow (real model) | ✅ 2 passed, 0 failed, 2 xfailed, 507 deselected | 18.2 s | `2 passed, 507 deselected, 2 xfailed in 18.19s` |
| CoreServices Jest | ✅ 247 passed, 0 failed | 50.3 s | `Tests: 247 passed, 247 total \| Test Suites: 20 passed, 20 total` |
| API Gateway Jest | ✅ 62 passed, 0 failed | 4.6 s | `Tests: 62 passed, 62 total \| Test Suites: 9 passed, 9 total` |
| Frontend node --test + Vitest | ✅ 46 passed (25 node + 21 Vitest), 0 failed | 5.0 s | `node --test: pass 25, fail 0 (0.2s) \| Vitest: 21 passed (21) (4.8s)` |

Environment: Windows 11 (10.0.26200); Python 3.14.4; Node v24.11.1; MongoDB 8.2.5; torch 2.14.1+cpu, sentence-transformers 6.1.0, faiss-cpu 1.15.1; embedding model `BAAI/bge-small-en-v1.5` (description text, related threshold 0.73).
