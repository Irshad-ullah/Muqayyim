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

## 2026-10-16 00:00 Pakistan Standard Time · `dd2fce2` (main, clean)

Commit: Record the first full test run (99f540a): all suites pass  
Result: **PASS** · total time 261 s

| Suite | Result | Duration | Summary line |
|---|---|---|---|
| AIServices pytest | ✅ 506 passed, 0 failed, 1 skipped, 4 deselected | 155.5 s | `506 passed, 1 skipped, 4 deselected in 155.54s (0:02:35)` |
| AIServices pytest -m slow (real model) | ✅ 2 passed, 0 failed, 2 xfailed, 507 deselected | 22.7 s | `2 passed, 507 deselected, 2 xfailed in 22.68s` |
| CoreServices Jest | ✅ 247 passed, 0 failed | 57.5 s | `Tests: 247 passed, 247 total \| Test Suites: 20 passed, 20 total` |
| API Gateway Jest | ✅ 62 passed, 0 failed | 5.1 s | `Tests: 62 passed, 62 total \| Test Suites: 9 passed, 9 total` |
| Frontend node --test + Vitest | ✅ 46 passed (25 node + 21 Vitest), 0 failed | 5.4 s | `node --test: pass 25, fail 0 (0.2s) \| Vitest: 21 passed (21) (5.2s)` |

Environment: Windows 11 (10.0.26200); Python 3.14.4; Node v24.11.1; MongoDB 8.2.5; torch 2.14.1+cpu, sentence-transformers 6.1.0, faiss-cpu 1.15.1; embedding model `BAAI/bge-small-en-v1.5` (description text, related threshold 0.73).

## 2026-10-16 00:22 Pakistan Standard Time · `dd2fce2` (main, 18 uncommitted change(s))

Commit: Record the first full test run (99f540a): all suites pass  
Result: **PASS** · total time 254 s

| Suite | Result | Duration | Summary line |
|---|---|---|---|
| AIServices pytest | ✅ 508 passed, 0 failed, 1 skipped, 4 deselected | 152.8 s | `508 passed, 1 skipped, 4 deselected in 152.79s (0:02:32)` |
| AIServices pytest -m slow (real model) | ✅ 2 passed, 0 failed, 2 xfailed, 509 deselected | 20.0 s | `2 passed, 509 deselected, 2 xfailed in 20.03s` |
| CoreServices Jest | ✅ 247 passed, 0 failed | 51.9 s | `Tests: 247 passed, 247 total \| Test Suites: 20 passed, 20 total` |
| API Gateway Jest | ✅ 62 passed, 0 failed | 4.6 s | `Tests: 62 passed, 62 total \| Test Suites: 9 passed, 9 total` |
| Frontend node --test + Vitest | ✅ 101 passed (31 node + 70 Vitest), 0 failed | 9.8 s | `node --test: pass 31, fail 0 (0.2s) \| Vitest: 70 passed (70) (9.6s)` |

Environment: Windows 11 (10.0.26200); Python 3.14.4; Node v24.11.1; MongoDB 8.2.5; torch 2.14.1+cpu, sentence-transformers 6.1.0, faiss-cpu 1.15.1; embedding model `BAAI/bge-small-en-v1.5` (description text, related threshold 0.73).

## 2026-10-16 00:27 Pakistan Standard Time · `dd2fce2` (main, 20 uncommitted change(s))

Commit: Record the first full test run (99f540a): all suites pass  
Result: **PASS** · total time 252 s

| Suite | Result | Duration | Summary line |
|---|---|---|---|
| AIServices pytest | ✅ 508 passed, 0 failed, 1 skipped, 4 deselected | 143.7 s | `508 passed, 1 skipped, 4 deselected in 143.72s (0:02:23)` |
| AIServices pytest -m slow (real model) | ✅ 2 passed, 0 failed, 2 xfailed, 509 deselected | 23.7 s | `2 passed, 509 deselected, 2 xfailed in 23.71s` |
| CoreServices Jest | ✅ 247 passed, 0 failed | 56.4 s | `Tests: 247 passed, 247 total \| Test Suites: 20 passed, 20 total` |
| API Gateway Jest | ✅ 62 passed, 0 failed | 4.8 s | `Tests: 62 passed, 62 total \| Test Suites: 9 passed, 9 total` |
| Frontend node --test + Vitest | ✅ 101 passed (31 node + 70 Vitest), 0 failed | 10.3 s | `node --test: pass 31, fail 0 (0.2s) \| Vitest: 70 passed (70) (10.1s)` |

Environment: Windows 11 (10.0.26200); Python 3.14.4; Node v24.11.1; MongoDB 8.2.5; torch 2.14.1+cpu, sentence-transformers 6.1.0, faiss-cpu 1.15.1; embedding model `BAAI/bge-small-en-v1.5` (description text, related threshold 0.73).

## 2026-10-16 01:08 Pakistan Standard Time · `30ada9f` (main, 2 uncommitted change(s))

Commit: 9c Part 8: Admin UI for professions and skills  
Result: **PASS** · total time 168 s

| Suite | Result | Duration | Summary line |
|---|---|---|---|
| AIServices pytest | ✅ 508 passed, 0 failed, 1 skipped, 4 deselected | 97.1 s | `508 passed, 1 skipped, 4 deselected in 97.07s (0:01:37)` |
| AIServices pytest -m slow (real model) | ✅ 2 passed, 0 failed, 2 xfailed, 509 deselected | 12.5 s | `2 passed, 509 deselected, 2 xfailed in 12.47s` |
| CoreServices Jest | ✅ 247 passed, 0 failed | 36.2 s | `Tests: 247 passed, 247 total \| Test Suites: 20 passed, 20 total` |
| API Gateway Jest | ✅ 62 passed, 0 failed | 4.4 s | `Tests: 62 passed, 62 total \| Test Suites: 9 passed, 9 total` |
| Frontend node --test + Vitest | ✅ 101 passed (31 node + 70 Vitest), 0 failed | 9.7 s | `node --test: pass 31, fail 0 (0.2s) \| Vitest: 70 passed (70) (9.5s)` |

Environment: Windows 11 (10.0.26200); Python 3.14.4; Node v24.11.1; MongoDB 8.2.5; torch 2.14.1+cpu, sentence-transformers 6.1.0, faiss-cpu 1.15.1; embedding model `BAAI/bge-small-en-v1.5` (description text, related threshold 0.73).

## 2026-10-16 09:49 Pakistan Standard Time · `399b120` (main, 2 uncommitted change(s))

Commit: Record the Part 8 walkthrough (16/16) and the post-clean-up run  
Result: **FAIL** · total time 655 s

| Suite | Result | Duration | Summary line |
|---|---|---|---|
| AIServices pytest | ✅ 517 passed, 0 failed, 1 skipped, 4 deselected | 238.3 s | `517 passed, 1 skipped, 4 deselected in 238.28s (0:03:58)` |
| AIServices pytest -m slow (real model) | ✅ 2 passed, 0 failed, 2 xfailed, 518 deselected | 37.8 s | `2 passed, 518 deselected, 2 xfailed in 37.76s` |
| CoreServices Jest | ✅ 247 passed, 0 failed | 182.5 s | `Tests: 247 passed, 247 total \| Test Suites: 20 passed, 20 total` |
| API Gateway Jest | ❌ 61 passed, 1 failed | 19.6 s | `Tests: 1 failed, 61 passed, 62 total \| Test Suites: 1 failed, 8 passed, 9 total` |
| Frontend node --test + Vitest | ✅ 101 passed (31 node + 70 Vitest), 0 failed | 96.9 s | `node --test: pass 31, fail 0 (0.6s) \| Vitest: 70 passed (70) (96.3s)` |

Environment: Windows 11 (10.0.26200); Python 3.14.4; Node v24.11.1; MongoDB 8.2.5; torch 2.14.1+cpu, sentence-transformers 6.1.0, faiss-cpu 1.15.1; embedding model `BAAI/bge-small-en-v1.5` (description text, related threshold 0.73).

## 2026-10-16 10:02 Pakistan Standard Time · `399b120` (main, 5 uncommitted change(s))

Commit: Record the Part 8 walkthrough (16/16) and the post-clean-up run  
Result: **PASS** · total time 438 s

| Suite | Result | Duration | Summary line |
|---|---|---|---|
| AIServices pytest | ✅ 517 passed, 0 failed, 1 skipped, 4 deselected | 238.2 s | `517 passed, 1 skipped, 4 deselected in 238.19s (0:03:58)` |
| AIServices pytest -m slow (real model) | ✅ 2 passed, 0 failed, 2 xfailed, 518 deselected | 41.8 s | `2 passed, 518 deselected, 2 xfailed in 41.80s` |
| CoreServices Jest | ✅ 247 passed, 0 failed | 120.9 s | `Tests: 247 passed, 247 total \| Test Suites: 20 passed, 20 total` |
| API Gateway Jest | ✅ 62 passed, 0 failed | 5.0 s | `Tests: 62 passed, 62 total \| Test Suites: 9 passed, 9 total` |
| Frontend node --test + Vitest | ✅ 101 passed (31 node + 70 Vitest), 0 failed | 13.9 s | `node --test: pass 31, fail 0 (0.3s) \| Vitest: 70 passed (70) (13.7s)` |

Environment: Windows 11 (10.0.26200); Python 3.14.4; Node v24.11.1; MongoDB 8.2.5; torch 2.14.1+cpu, sentence-transformers 6.1.0, faiss-cpu 1.15.1; embedding model `BAAI/bge-small-en-v1.5` (description text, related threshold 0.73).

## 2026-10-16 10:19 Pakistan Standard Time · `25a8044` (main, clean)

Commit: TEST_LOG: the LibreOffice skip is expected; .doc support stays as it is  
Result: **PASS** · total time 288 s

| Suite | Result | Duration | Summary line |
|---|---|---|---|
| AIServices pytest | ✅ 517 passed, 0 failed, 1 skipped, 4 deselected | 193.3 s | `517 passed, 1 skipped, 4 deselected in 193.28s (0:03:13)` |
| AIServices pytest -m slow (real model) | ✅ 2 passed, 0 failed, 2 xfailed, 518 deselected | 14.1 s | `2 passed, 518 deselected, 2 xfailed in 14.13s` |
| CoreServices Jest | ✅ 247 passed, 0 failed | 53.6 s | `Tests: 247 passed, 247 total \| Test Suites: 20 passed, 20 total` |
| API Gateway Jest | ✅ 62 passed, 0 failed | 4.7 s | `Tests: 62 passed, 62 total \| Test Suites: 9 passed, 9 total` |
| Frontend node --test + Vitest | ✅ 101 passed (31 node + 70 Vitest), 0 failed | 10.1 s | `node --test: pass 31, fail 0 (0.2s) \| Vitest: 70 passed (70) (9.8s)` |

Environment: Windows 11 (10.0.26200); Python 3.14.4; Node v24.11.1; MongoDB 8.2.5; torch 2.14.1+cpu, sentence-transformers 6.1.0, faiss-cpu 1.15.1; embedding model `BAAI/bge-small-en-v1.5` (description text, related threshold 0.73).

## 2026-10-16 11:11 Pakistan Standard Time · `3deea26` (main, 3 uncommitted change(s))

Commit: Exclude ISCO 3521 from the ESCO selection (Module 5, FR7.2)  
Result: **PASS** · total time 172 s

| Suite | Result | Duration | Summary line |
|---|---|---|---|
| AIServices pytest | ✅ 535 passed, 0 failed, 1 skipped, 4 deselected | 107.7 s | `535 passed, 1 skipped, 4 deselected in 107.65s (0:01:47)` |
| AIServices pytest -m slow (real model) | ✅ 2 passed, 0 failed, 2 xfailed, 536 deselected | 8.9 s | `2 passed, 536 deselected, 2 xfailed in 8.90s` |
| CoreServices Jest | ✅ 247 passed, 0 failed | 34.6 s | `Tests: 247 passed, 247 total \| Test Suites: 20 passed, 20 total` |
| API Gateway Jest | ✅ 62 passed, 0 failed | 4.1 s | `Tests: 62 passed, 62 total \| Test Suites: 9 passed, 9 total` |
| Frontend node --test + Vitest | ✅ 101 passed (31 node + 70 Vitest), 0 failed | 9.4 s | `node --test: pass 31, fail 0 (0.2s) \| Vitest: 70 passed (70) (9.2s)` |

Environment: Windows 11 (10.0.26200); Python 3.14.4; Node v24.11.1; MongoDB 8.2.5; torch 2.14.1+cpu, sentence-transformers 6.1.0, faiss-cpu 1.15.1; embedding model `BAAI/bge-small-en-v1.5` (description text, related threshold 0.73).
