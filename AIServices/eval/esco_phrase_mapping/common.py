"""
Module 5.1 sandbox — shared loading for the ESCO phrase-mapping experiment.

SANDBOX RULES: nothing here changes production code, data or settings. The database is only
read; models are loaded in this process; outputs go to ./results (and the reranker download to
./models, git-ignored).

Definitions used throughout:
- an "ESCO essential phrase" = a distinct role skill that is ESSENTIAL for at least one ACTIVE ESCO
  role and has NO curated description (it is embedded by its ESCO label; that is why it can earn
  at most 0.5 today). Its ESCO skill type ("skill/competence" = ability phrase, "knowledge") is kept.
- a "described skill" = a skill in app/data/skill_descriptions.json (the curated, tool-like skills),
  embedded as "Name: description" exactly like the vector cache does.
"""

import ctypes
import json
import os
import sys
from collections import defaultdict
from ctypes import wintypes
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import numpy as np  # noqa: E402
from pymongo import MongoClient  # noqa: E402

from app.config.settings import settings  # noqa: E402
from app.services.embeddings import descriptions as descriptions_module  # noqa: E402
from app.services.embeddings.descriptions import build_embed_text, get_description_provider  # noqa: E402
from app.services.professions.role_skills import current_skill  # noqa: E402

RESULTS = HERE / "results"
MODELS = HERE / "models"


def db():
    return MongoClient(settings.MONGODB_URL)[settings.AI_DB_NAME]


def essential_phrases(database=None):
    """{name: {key, skill_type, roles: [titles]}} for undescribed essential skills of active ESCO roles."""
    database = database if database is not None else db()
    provider = get_description_provider()
    types = {d["label"]: d.get("skill_type") for d in database["esco_skills"].find({}, {"label": 1, "skill_type": 1})}
    phrases = defaultdict(lambda: {"roles": []})
    for prof in database["professions"].find({"active": True, "source": "esco"}, {"title": 1, "skills": 1}):
        for skill in prof["skills"]:
            if skill.get("type") != "essential":
                continue
            key, name = current_skill(skill)
            if provider.lookup(name) is not None:
                continue
            entry = phrases[name]
            entry["key"] = key
            entry["skill_type"] = types.get(skill.get("original_label") or name)
            entry["roles"].append(prof["title"])
    return dict(phrases)


def described_skills():
    """[(name, description)] — the curated skills (sorted by name)."""
    curated = json.loads(Path(descriptions_module.CURATED_FILE).read_text(encoding="utf8"))
    return sorted((name, entry if isinstance(entry, str) else entry.get("description", "")) for name, entry in curated.items())


def bi_encoder():
    from app.services.embeddings.model import get_embedder, get_manager

    manager = get_manager()
    manager.load_sync()
    manager.ready_event.set()
    return get_embedder()


def embed_phrases_and_skills(embedder, phrases, skills):
    """(phrase names, phrase matrix, skill names, skill matrix) — the same text rule as the cache."""
    phrase_names = sorted(phrases)
    phrase_matrix = embedder.embed_texts([build_embed_text(p).text for p in phrase_names])
    skill_names = [name for name, _ in skills]
    skill_matrix = embedder.embed_texts([build_embed_text(n).text for n in skill_names])
    return phrase_names, np.asarray(phrase_matrix), skill_names, np.asarray(skill_matrix)


class _Counters(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]


def memory_mb():
    """(current, peak) working set of this process in MB (Windows API; no extra package needed)."""
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.K32GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(_Counters), wintypes.DWORD]
    kernel32.K32GetProcessMemoryInfo.restype = wintypes.BOOL
    counters = _Counters()
    counters.cb = ctypes.sizeof(_Counters)
    if not kernel32.K32GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise OSError(ctypes.get_last_error(), "GetProcessMemoryInfo failed")
    return round(counters.WorkingSetSize / 2**20), round(counters.PeakWorkingSetSize / 2**20)
