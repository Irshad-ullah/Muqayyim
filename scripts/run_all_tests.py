#!/usr/bin/env python
"""
Run every Muqayyim test suite and record the result permanently.

Suites (each in its own process; the suites create and drop their own test
databases, ai_db_test / core_db_test, so every run starts from a fresh state):
  ai        AIServices pytest (normal; slow tests deselected by pytest.ini)
  ai-slow   AIServices pytest -m slow (real embedding model; known xfails expected)
  core      CoreServices Jest
  gateway   API Gateway Jest
  frontend  CoreServices/frontend: node --test, then Vitest

Writes:
  docs/testing/test-runs.md                 one appended entry per run (human-readable)
  docs/testing/runs/<date>-<commit>.json    the same, machine-readable
  docs/testing/runs/raw/<date>-<commit>/    full console output per suite (git-ignored)

Exit code: 0 when every suite passed (expected xfails are not failures), else 1.
Secrets: no .env value is read or written by this script; raw logs are passed
through a masking filter (JWTs, Bearer tokens, key=value secrets) before saving.

Usage (from the repo root): scripts/run_all_tests.ps1, scripts/run_all_tests.sh,
or  AIServices/backend/venv/Scripts/python scripts/run_all_tests.py [--only ai,core]
"""

import argparse
import json
import os
import platform
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AI = ROOT / "AIServices" / "backend"
PY = AI / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
TESTING = ROOT / "docs" / "testing"
RUNS = TESTING / "runs"
LOG_MD = TESTING / "test-runs.md"
WIN = os.name == "nt"

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
SECRET_PATTERNS = [
    (re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"), "[JWT]"),
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}"), r"\1[TOKEN]"),
    (re.compile(r"(?i)\b([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|INTERNAL_KEY)[A-Z0-9_]*\s*[=:]\s*)(\S+)"), r"\1[MASKED]"),
    (re.compile(r"(?i)(x-internal-key['\"]?\s*[:=]\s*['\"]?)[^\s'\",}]+"), r"\1[MASKED]"),
    (re.compile(r"mongodb(\+srv)?://[^\s/@]+:[^\s/@]+@"), "mongodb://[CREDENTIALS]@"),
]

SUITES = {
    "ai": {"label": "AIServices pytest", "cwd": AI,
           "cmd": [str(PY), "-m", "pytest", "-q", "-p", "no:warnings", "-p", "no:cacheprovider"], "kind": "pytest"},
    "ai-slow": {"label": "AIServices pytest -m slow (real model)", "cwd": AI,
                "cmd": [str(PY), "-m", "pytest", "-q", "-p", "no:warnings", "-p", "no:cacheprovider", "-m", "slow"],
                "kind": "pytest"},
    "core": {"label": "CoreServices Jest", "cwd": ROOT / "CoreServices", "cmd": ["npm", "test"], "kind": "jest"},
    "gateway": {"label": "API Gateway Jest", "cwd": ROOT / "API Gateway", "cmd": ["npm", "test"], "kind": "jest"},
    "frontend": {"label": "Frontend node --test + Vitest", "cwd": ROOT / "CoreServices" / "frontend",
                 "cmd": ["npm", "test"], "kind": "frontend"},
}


def mask(text: str) -> str:
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def run(cmd, cwd, timeout=None) -> subprocess.CompletedProcess:
    env = {**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0", "CI": "true", "PYTHONIOENCODING": "utf-8"}
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          shell=WIN and cmd[0] == "npm", env=env, timeout=timeout)


def out(cmd, cwd=ROOT) -> str:
    try:
        return run(cmd, cwd, timeout=120).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


# ── parsing ───────────────────────────────────────────────────────────────────
def parse_pytest(text: str) -> dict:
    lines = [l for l in text.splitlines() if re.search(r"\b(passed|failed|error|no tests ran|deselected)\b", l)]
    line = lines[-1].strip("= ").strip() if lines else ""
    counts = {k: 0 for k in ("passed", "failed", "skipped", "xfailed", "xpassed", "errors", "deselected")}
    for n, word in re.findall(r"(\d+) (passed|failed|skipped|xfailed|xpassed|errors?|deselected)", line):
        counts["errors" if word.startswith("error") else word] += int(n)
    duration = re.search(r"in ([\d.]+)s", line)
    return {"counts": counts, "duration_s": float(duration.group(1)) if duration else None, "summary": line}


def parse_jest(text: str) -> dict:
    tests = re.findall(r"^Tests:\s+(.*)$", text, re.M)
    line = tests[-1].strip() if tests else ""
    counts = {k: 0 for k in ("passed", "failed", "skipped", "todo", "total")}
    for n, word in re.findall(r"(\d+) (passed|failed|skipped|todo|total)", line):
        counts[word] = int(n)
    time_match = re.findall(r"^Time:\s+([\d.]+)\s*s", text, re.M)
    suites = re.findall(r"^Test Suites:\s+(.*)$", text, re.M)
    return {"counts": counts, "duration_s": float(time_match[-1]) if time_match else None,
            "summary": f"Tests: {line}" + (f" | Test Suites: {suites[-1].strip()}" if suites else "")}


def parse_frontend(text: str) -> dict:
    node = {k: int(v) for k, v in re.findall(r"^[ℹi]\s+(pass|fail|skipped|todo|cancelled)\s+(\d+)", text, re.M)}
    node_ms = re.findall(r"^[ℹi]\s+duration_ms\s+([\d.]+)", text, re.M)
    vit_line = re.findall(r"^\s*Tests\s+(.*\(\d+\))\s*$", text, re.M)
    vit = {"passed": 0, "failed": 0, "skipped": 0}
    if vit_line:
        for n, word in re.findall(r"(\d+) (passed|failed|skipped)", vit_line[-1]):
            vit[word] = int(n)
    vit_dur = re.findall(r"^\s*Duration\s+([\d.]+)(ms|s)", text, re.M)
    vit_s = (float(vit_dur[-1][0]) / (1000 if vit_dur[-1][1] == "ms" else 1)) if vit_dur else None
    counts = {"passed": node.get("pass", 0) + vit["passed"], "failed": node.get("fail", 0) + vit["failed"],
              "skipped": node.get("skipped", 0) + vit["skipped"], "node_passed": node.get("pass", 0),
              "node_failed": node.get("fail", 0), "vitest_passed": vit["passed"], "vitest_failed": vit["failed"]}
    node_s = float(node_ms[-1]) / 1000 if node_ms else None
    summary = (f"node --test: pass {node.get('pass', 0)}, fail {node.get('fail', 0)}"
               + (f" ({node_s:.1f}s)" if node_s is not None else "")
               + f" | Vitest: {vit_line[-1].strip() if vit_line else 'not found'}"
               + (f" ({vit_s:.1f}s)" if vit_s is not None else ""))
    return {"counts": counts, "duration_s": round((node_s or 0) + (vit_s or 0), 2) or None, "summary": summary}


PARSERS = {"pytest": parse_pytest, "jest": parse_jest, "frontend": parse_frontend}


# ── environment ───────────────────────────────────────────────────────────────
def environment() -> dict:
    py_probe = (
        "import json, importlib.metadata as m, sys\n"
        "def v(p):\n"
        "    try: return m.version(p)\n"
        "    except Exception: return None\n"
        "out = {'python': sys.version.split()[0], 'packages': {p: v(p) for p in ("
        "'torch','sentence-transformers','faiss-cpu','numpy','fastapi','pymongo','motor','pytest','spacy')}}\n"
        "try:\n"
        "    from app.config.settings import settings\n"
        "    out['embedding_model'] = settings.EMBEDDING_MODEL\n"
        "    out['embedding_text_mode'] = settings.EMBEDDING_TEXT_MODE\n"
        "    out['related_threshold'] = settings.EMBEDDING_RELATED_THRESHOLD\n"
        "    from pymongo import MongoClient\n"
        "    c = MongoClient(settings.MONGODB_URL, serverSelectionTimeoutMS=3000)\n"
        "    out['mongodb'] = c.server_info()['version']\n"
        "except Exception as e:\n"
        "    out.setdefault('mongodb', 'unavailable (' + type(e).__name__ + ')')\n"
        "print(json.dumps(out))\n"
    )
    try:
        info = json.loads(out([str(PY), "-c", py_probe], cwd=AI) or "{}")
    except ValueError:
        info = {}

    def node_pkg(folder: str, name: str):
        path = ROOT / folder / "node_modules" / name / "package.json"
        try:
            return json.loads(path.read_text(encoding="utf8"))["version"]
        except (OSError, ValueError, KeyError):
            return None

    node_packages = {
        "core:express": node_pkg("CoreServices", "express"), "core:jest": node_pkg("CoreServices", "jest"),
        "core:mongoose": node_pkg("CoreServices", "mongoose"),
        "gateway:express": node_pkg("API Gateway", "express"), "gateway:jest": node_pkg("API Gateway", "jest"),
        "gateway:http-proxy-middleware": node_pkg("API Gateway", "http-proxy-middleware"),
        "frontend:react": node_pkg("CoreServices/frontend", "react"),
        "frontend:vite": node_pkg("CoreServices/frontend", "vite"),
        "frontend:vitest": node_pkg("CoreServices/frontend", "vitest"),
    }
    return {
        "os": f"{platform.system()} {platform.release()} ({platform.version()})",
        "python": info.get("python"),
        "node": out(["node", "--version"]),
        "npm": out(["npm", "--version"]) if not WIN else out(["cmd", "/c", "npm", "--version"]),
        "mongodb": info.get("mongodb"),
        "python_packages": info.get("packages", {}),
        "node_packages": node_packages,
        "embedding_model": info.get("embedding_model"),
        "embedding_text_mode": info.get("embedding_text_mode"),
        "related_threshold": info.get("related_threshold"),
    }


def git_info() -> dict:
    status = out(["git", "status", "--porcelain"])
    return {
        "commit": out(["git", "rev-parse", "--short", "HEAD"]),
        "commit_full": out(["git", "rev-parse", "HEAD"]),
        "branch": out(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        "subject": out(["git", "log", "-1", "--format=%s"]),
        "clean": status == "",
        "changed_files": len(status.splitlines()) if status else 0,
    }


# ── report ────────────────────────────────────────────────────────────────────
def suite_failed(result: dict) -> bool:
    c = result["counts"]
    return result["exit_code"] != 0 or c.get("failed", 0) > 0 or c.get("errors", 0) > 0 or result["summary"] == ""


def counts_text(name: str, c: dict) -> str:
    if name.startswith("ai"):
        parts = [f"{c['passed']} passed", f"{c['failed']} failed"]
        parts += [f"{c[k]} {k}" for k in ("skipped", "xfailed", "xpassed", "errors", "deselected") if c.get(k)]
        return ", ".join(parts)
    if name == "frontend":
        return (f"{c['passed']} passed ({c['node_passed']} node + {c['vitest_passed']} Vitest), {c['failed']} failed"
                + (f", {c['skipped']} skipped" if c.get("skipped") else ""))
    return f"{c['passed']} passed, {c['failed']} failed" + (f", {c['skipped']} skipped" if c.get("skipped") else "")


def append_markdown(record: dict) -> None:
    TESTING.mkdir(parents=True, exist_ok=True)
    if not LOG_MD.exists():
        LOG_MD.write_text(
            "# Test runs\n\n"
            "Appended automatically by `scripts/run_all_tests` (one entry per run, newest last).\n"
            "Machine-readable copies: `docs/testing/runs/*.json`. Full console output: "
            "`docs/testing/runs/raw/` (git-ignored, kept locally).\n",
            encoding="utf8")
    g, e = record["git"], record["environment"]
    tree = "clean" if g["clean"] else f"{g['changed_files']} uncommitted change(s)"
    lines = [
        "",
        f"## {record['started_local']} · `{g['commit']}` ({g['branch']}, {tree})",
        "",
        f"Commit: {g['subject']}  ",
        f"Result: **{'PASS' if record['passed'] else 'FAIL'}** · total time {record['duration_s']:.0f} s",
        "",
        "| Suite | Result | Duration | Summary line |",
        "|---|---|---|---|",
    ]
    for s in record["suites"]:
        status = "✅" if s["status"] == "passed" else "❌"
        duration = f"{s['duration_s']:.1f} s" if s.get("duration_s") else f"{s['wall_s']:.0f} s (wall)"
        summary = s["summary"].replace("|", r"\|")  # a raw | would split the table cell
        lines.append(f"| {s['label']} | {status} {counts_text(s['name'], s['counts'])} | {duration} | `{summary}` |")
    pk = e["python_packages"]
    lines += [
        "",
        f"Environment: {e['os']}; Python {e['python']}; Node {e['node']}; MongoDB {e['mongodb']}; "
        f"torch {pk.get('torch')}, sentence-transformers {pk.get('sentence-transformers')}, faiss-cpu {pk.get('faiss-cpu')}; "
        f"embedding model `{e['embedding_model']}` ({e['embedding_text_mode']} text, related threshold {e['related_threshold']}).",
        "",
    ]
    with open(LOG_MD, "a", encoding="utf8") as handle:
        handle.write("\n".join(lines))


def main() -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows consoles default to cp1252
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma-separated subset of: " + ", ".join(SUITES))
    args = parser.parse_args()
    names = [n.strip() for n in args.only.split(",")] if args.only else list(SUITES)

    started = datetime.now(timezone.utc)
    git = git_info()  # recorded BEFORE the run writes its own files
    stamp = started.astimezone().strftime("%Y-%m-%dT%H%M%S")
    run_id = f"{stamp}-{git['commit']}"
    raw_dir = RUNS / "raw" / run_id
    raw_dir.mkdir(parents=True, exist_ok=True)
    print(f"Test run {run_id} — {git['branch']} @ {git['commit']} ({'clean' if git['clean'] else 'uncommitted changes'})")

    results = []
    t0 = time.perf_counter()
    for name in names:
        suite = SUITES[name]
        print(f"→ {suite['label']} …", flush=True)
        t = time.perf_counter()
        try:
            proc = run(suite["cmd"], suite["cwd"], timeout=60 * 60)
            text = ANSI.sub("", (proc.stdout or "") + "\n" + (proc.stderr or ""))
            code = proc.returncode
        except subprocess.TimeoutExpired:
            text, code = "TIMEOUT after 60 minutes", -1
        wall = time.perf_counter() - t
        (raw_dir / f"{name}.log").write_text(mask(text), encoding="utf8")
        parsed = PARSERS[suite["kind"]](text)
        result = {"name": name, "label": suite["label"], "command": " ".join(suite["cmd"][-6:] if name.startswith("ai") else suite["cmd"]),
                  "exit_code": code, "wall_s": round(wall, 1), **parsed}
        result["status"] = "failed" if suite_failed(result) else "passed"
        results.append(result)
        print(f"  {result['status'].upper()}: {counts_text(name, result['counts'])} ({result['summary']})", flush=True)

    record = {
        "run_id": run_id,
        "started_utc": started.isoformat(),
        "started_local": started.astimezone().strftime("%Y-%m-%d %H:%M %Z"),
        "duration_s": round(time.perf_counter() - t0, 1),
        "git": git,
        "environment": environment(),
        "suites": results,
        "passed": all(r["status"] == "passed" for r in results),
        "known_expected_failures": "ai-slow: React↔Python (0.776) and Redux↔Redis (0.744) are strict xfails "
                                   "(docs/changes/09a2-embedding-model-selection.md)",
        "raw_logs": str(raw_dir.relative_to(ROOT)).replace("\\", "/"),
    }
    RUNS.mkdir(parents=True, exist_ok=True)
    (RUNS / f"{run_id}.json").write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    append_markdown(record)
    print(f"{'PASS' if record['passed'] else 'FAIL'} — recorded in docs/testing/test-runs.md and docs/testing/runs/{run_id}.json")
    return 0 if record["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
