"""
FAISS index of role-skill vectors (Module 5 FE-3 groundwork).

One vector per distinct skill of the active professions, in
faiss.IndexIDMap(IndexFlatIP(dim)); vectors are unit length, so inner product
is cosine similarity. A sidecar maps each FAISS id → skill key and each key →
the professions that need it ({profession_id, type, hot, in_demand}).

Persisted to ROLE_INDEX_DIR:
  role_skills.faiss      the index
  role_skills.meta.json  { model, text_mode, dim, count, built_at, state_hash,
                           keys: [...], names: {...}, roles: {...} }

MongoDB stays the source of truth; the files are a cache. On startup they are
loaded only if model, text mode and state_hash (a hash of every active
profession's skills plus the embedded texts) still match; otherwise the index
is rebuilt in the background. A rebuild builds a new index and swaps it in
atomically under a lock, so searches always see a complete index. Searches
before the first index exists get INDEX_BUILDING; with no active professions
the state is NO_PROFESSIONS.

Matching stays skill-to-skill: there are no averaged role or user vectors.
"""

import asyncio
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import faiss
import numpy as np

from app.config.settings import settings
from app.services.embeddings.descriptions import get_description_provider, text_mode
from app.services.embeddings.matching_config import get_related_threshold
from app.services.embeddings.model import ModelNotReady, get_embedder
from app.services.embeddings.vector_store import plan_texts
from app.services.professions.store import skill_rank
from app.services.professions.role_skills import (
    active_professions,
    current_skill,
    distinct_role_skills,
    ensure_role_skill_vectors,
)

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[3]
INDEX_FILE = "role_skills.faiss"
META_FILE = "role_skills.meta.json"

EMPTY, BUILDING, READY, NO_PROFESSIONS, WAITING_FOR_MODEL, FAILED = (
    "empty", "building", "ready", "no_professions", "waiting_for_model", "failed",
)


class IndexUnavailable(Exception):
    """No usable index yet. `code` is INDEX_BUILDING or NO_PROFESSIONS."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ThresholdUnavailable(Exception):
    """The related threshold was not measured for the active model / text mode."""


def index_dir() -> Path:
    path = Path(settings.ROLE_INDEX_DIR)
    return path if path.is_absolute() else (BACKEND_DIR / path).resolve()


def state_hash(professions: List[dict], model: str, mode: str) -> str:
    """Changes whenever an active profession, a role skill, or an embedded text changes."""
    pairs = distinct_role_skills(professions)
    digest = hashlib.sha256(f"{model}|{mode}".encode())
    for profession in professions:
        skills = sorted((current_skill(s)[0], s["type"], bool(s.get("hot")), bool(s.get("in_demand")))
                        for s in profession.get("skills") or [])
        digest.update(json.dumps([profession["profession_id"], skills]).encode())
    for planned in sorted(plan_texts(pairs, mode), key=lambda p: p.key):
        digest.update(f"{planned.key}={planned.hash}".encode())
    return digest.hexdigest()


def role_map(professions: List[dict]) -> Dict[str, List[dict]]:
    """key → [{profession_id, title, type, hot, in_demand}], one entry per profession
    (the strongest type wins if two stored names now share a key)."""
    roles: Dict[str, Dict[str, dict]] = {}
    for profession in professions:
        for skill in profession.get("skills") or []:
            entry = {
                "profession_id": profession["profession_id"],
                "title": profession.get("title"),
                "type": skill["type"],
                "hot": bool(skill.get("hot")),
                "in_demand": bool(skill.get("in_demand")),
            }
            by_profession = roles.setdefault(current_skill(skill)[0], {})
            current = by_profession.get(profession["profession_id"])
            if current is None or skill_rank(entry) > skill_rank(current):
                by_profession[profession["profession_id"]] = entry
    return {key: list(entries.values()) for key, entries in roles.items()}


@dataclass
class Snapshot:
    index: "faiss.Index"
    matrix: np.ndarray  # row i = vector of keys[i] (FAISS id i)
    keys: List[str]
    names: Dict[str, str]
    roles: Dict[str, List[dict]]
    meta: dict
    position: Dict[str, int] = field(default_factory=dict)

    def __post_init__(self):
        self.position = {key: i for i, key in enumerate(self.keys)}


def build_snapshot(pairs, vectors: Dict[str, np.ndarray], roles, meta: dict) -> Snapshot:
    keys = [key for key, _ in pairs]
    matrix = np.stack([vectors[k] for k in keys]).astype(np.float32)
    index = faiss.IndexIDMap(faiss.IndexFlatIP(matrix.shape[1]))
    index.add_with_ids(matrix, np.arange(len(keys), dtype=np.int64))
    meta = {**meta, "dim": int(matrix.shape[1]), "count": len(keys)}
    return Snapshot(index, matrix, keys, dict(pairs), roles, meta)


class RoleSkillIndex:
    def __init__(self, directory: Optional[Path] = None):
        self.directory = Path(directory) if directory else None
        self._snapshot: Optional[Snapshot] = None
        self._lock = asyncio.Lock()
        self._dirty = False
        self._task: Optional[asyncio.Task] = None
        self.state = EMPTY
        self.error: Optional[str] = None
        self.last_build_seconds: Optional[float] = None

    @property
    def dir(self) -> Path:
        return self.directory or index_dir()

    @property
    def snapshot(self) -> Optional[Snapshot]:
        return self._snapshot

    # ── persistence ──────────────────────────────────────────────────────────
    def save(self, snapshot: Snapshot) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp_index = self.dir / (INDEX_FILE + ".tmp")
        tmp_meta = self.dir / (META_FILE + ".tmp")
        faiss.write_index(snapshot.index, str(tmp_index))
        payload = {**snapshot.meta, "keys": snapshot.keys, "names": snapshot.names, "roles": snapshot.roles}
        tmp_meta.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf8")
        os.replace(tmp_index, self.dir / INDEX_FILE)
        os.replace(tmp_meta, self.dir / META_FILE)

    def read_meta(self) -> Optional[dict]:
        try:
            return json.loads((self.dir / META_FILE).read_text(encoding="utf8"))
        except (OSError, ValueError):
            return None

    def load_files(self, expected: dict) -> bool:
        """Load the persisted index if its meta matches `expected` (model, text_mode, state_hash)."""
        meta = self.read_meta()
        if not meta or any(meta.get(k) != v for k, v in expected.items()):
            return False
        try:
            index = faiss.read_index(str(self.dir / INDEX_FILE))
        except Exception:  # noqa: BLE001 — a corrupt file is rebuilt
            return False
        keys = meta.pop("keys")
        names = meta.pop("names")
        roles = meta.pop("roles")
        if index.ntotal != len(keys) or index.d != meta.get("dim"):
            return False
        # IndexIDMap does not reconstruct by id; the flat storage is in id order.
        if not np.array_equal(faiss.vector_to_array(index.id_map), np.arange(index.ntotal)):
            return False
        flat = faiss.downcast_index(index.index)
        matrix = faiss.vector_to_array(flat.codes).view(np.float32).reshape(index.ntotal, index.d).copy()
        self._snapshot = Snapshot(index, matrix, keys, names, roles, meta)
        self.state, self.error = READY, None
        return True

    # ── building ─────────────────────────────────────────────────────────────
    async def current_state(self, db=None) -> dict:
        embedder = get_embedder()
        professions = await active_professions(db)
        return {
            "professions": professions,
            "expected": {"model": embedder.model_name, "text_mode": text_mode(), "state_hash": state_hash(professions, embedder.model_name, text_mode())},
        }

    async def load_or_build(self, db=None, wait_for_model: bool = True) -> str:
        """Startup: use the saved index if still valid, else rebuild."""
        current = await self.current_state(db)
        if not current["professions"]:
            self._snapshot, self.state = None, NO_PROFESSIONS
            return self.state
        if await asyncio.to_thread(self.load_files, current["expected"]):
            logger.info("Role-skill index loaded: %d skills", self._snapshot.meta["count"])
            return self.state
        return await self.rebuild(db, wait_for_model=wait_for_model)

    async def rebuild(self, db=None, wait_for_model: bool = True, persist: bool = True) -> str:
        """Build a new index from MongoDB and swap it in. Concurrent requests coalesce."""
        if self._lock.locked():
            self._dirty = True  # run once more after the current build
            return BUILDING
        async with self._lock:
            while True:
                self._dirty = False
                await self._build_once(db, wait_for_model, persist)
                if not self._dirty:
                    return self.state

    async def _build_once(self, db, wait_for_model: bool, persist: bool) -> None:
        previous = self.state
        self.state = BUILDING
        started = time.perf_counter()
        try:
            current = await self.current_state(db)
            professions = current["professions"]
            if not professions:
                self._snapshot, self.state = None, NO_PROFESSIONS
                if persist:
                    for name in (INDEX_FILE, META_FILE):
                        (self.dir / name).unlink(missing_ok=True)
                return
            pairs = distinct_role_skills(professions)
            embedder = get_embedder()
            while True:
                try:
                    vectors = await ensure_role_skill_vectors(pairs, embedder, db)
                    break
                except ModelNotReady:
                    event = getattr(embedder, "ready_event", None)
                    if not wait_for_model or event is None:
                        self.state = WAITING_FOR_MODEL if self._snapshot is None else READY
                        return
                    self.state = WAITING_FOR_MODEL
                    await event.wait()
                    self.state = BUILDING
            meta = {**current["expected"], "built_at": datetime.now(timezone.utc).isoformat()}
            snapshot = await asyncio.to_thread(build_snapshot, pairs, vectors, role_map(professions), meta)
            if persist:
                await asyncio.to_thread(self.save, snapshot)
            self._snapshot = snapshot  # atomic swap
            self.last_build_seconds = round(time.perf_counter() - started, 2)
            self.state, self.error = READY, None
            logger.info("Role-skill index built: %d skills from %d professions in %.2fs",
                        snapshot.meta["count"], len(professions), self.last_build_seconds)
        except Exception as exc:  # noqa: BLE001
            from app.services.error_logger import log_error

            self.error = f"{type(exc).__name__}: {exc}"[:300]
            self.state = READY if self._snapshot is not None and previous == READY else FAILED
            log_error(level="error", module="professions", error_type="ROLE_INDEX_BUILD_FAILED",
                      message=f"Role-skill index build failed: {self.error}")

    def schedule_rebuild(self, db=None) -> None:
        """Fire-and-forget rebuild (after an import or a profession change)."""
        if self._task is not None and not self._task.done():
            self._dirty = True
            return
        self._task = asyncio.get_running_loop().create_task(self.rebuild(db))

    async def wait_idle(self) -> None:
        while self._task is not None and not self._task.done():
            await self._task

    # ── queries ──────────────────────────────────────────────────────────────
    def _ready_snapshot(self) -> Snapshot:
        snapshot = self._snapshot
        if snapshot is not None:
            return snapshot
        if self.state == NO_PROFESSIONS:
            raise IndexUnavailable("NO_PROFESSIONS", "No active professions are available yet.")
        raise IndexUnavailable("INDEX_BUILDING", "The role-skill index is being built. Try again shortly.")

    def roles_for_skill(self, key: str) -> List[dict]:
        return list(self._ready_snapshot().roles.get(key, []))

    def search_related(self, user_keys: List[str], user_matrix: np.ndarray, k: int = 50,
                       user_names: Optional[List[str]] = None) -> List[dict]:
        """
        Role skills related to the user's skills, excluding role skills the user
        already has (those are exact matches).

        Each pair has a KIND (matching_config): 'mixed' when the user skill has a
        curated description and the role skill does not, else 'described'. Both
        kinds use the same guarded threshold (0.73); the kind is reported so the
        caller can apply the credit rule (mutual_nn only for described pairs).
        If the threshold is not valid for mixed pairs in the active setup (ESCO
        text other than labels), mixed pairs use the described threshold and are
        flagged `mixed_threshold_unmeasured`.

        mutual_nn: the role skill is among the user skill's MUTUAL_NN_K nearest
        role skills AND the user skill is among the role skill's MUTUAL_NN_K
        nearest user skills. Reported for every pair; whether it is required is
        the caller's credit rule (Module 5).
        """
        snapshot = self._ready_snapshot()
        model, mode = snapshot.meta.get("model"), snapshot.meta.get("text_mode")
        described_threshold = get_related_threshold(model, mode, kind="described")
        if described_threshold is None:
            raise ThresholdUnavailable("No related threshold for the index's model and text mode")
        mixed_threshold = get_related_threshold(model, mode, kind="mixed")
        mixed_fallback = mixed_threshold is None
        if mixed_fallback:
            mixed_threshold = described_threshold
        if not len(user_keys):
            return []
        provider = get_description_provider()
        names = user_names or user_keys
        user_described = [provider.lookup(n) is not None for n in names]
        user_matrix = np.ascontiguousarray(user_matrix, dtype=np.float32)
        owned = set(user_keys)
        nn = settings.MUTUAL_NN_K
        k = min(max(k, nn + len(owned)), snapshot.index.ntotal)
        scores, ids = snapshot.index.search(user_matrix, k)
        lowest = min(described_threshold, mixed_threshold)

        user_top: List[List[str]] = []  # per user skill: its nearest role skills (not owned)
        for row in ids:
            ranked = [snapshot.keys[i] for i in row if i >= 0 and snapshot.keys[i] not in owned]
            user_top.append(ranked[:nn])

        role_described: Dict[str, bool] = {}
        results = []
        for u, (row_scores, row_ids) in enumerate(zip(scores, ids)):
            for score, role_id in zip(row_scores, row_ids):
                if role_id < 0 or score < lowest:
                    continue
                role_key = snapshot.keys[role_id]
                if role_key in owned:
                    continue
                role_name = snapshot.names.get(role_key, role_key)
                if role_key not in role_described:
                    role_described[role_key] = provider.lookup(role_name) is not None
                kind = "mixed" if user_described[u] and not role_described[role_key] else "described"
                threshold = mixed_threshold if kind == "mixed" else described_threshold
                if score < threshold:
                    continue
                # The role skill's nearest user skills.
                sims = user_matrix @ snapshot.matrix[role_id]
                nearest_users = set(np.argsort(-sims)[:nn].tolist())
                results.append({
                    "user_key": user_keys[u],
                    "role_key": role_key,
                    "role_name": role_name,
                    "kind": kind,
                    "threshold": threshold,
                    "similarity": round(float(score), 4),
                    "mutual_nn": role_key in user_top[u] and u in nearest_users,
                    "roles": len(snapshot.roles.get(role_key, [])),
                    **({"mixed_threshold_unmeasured": True} if kind == "mixed" and mixed_fallback else {}),
                })
        return sorted(results, key=lambda r: -r["similarity"])

    def health(self) -> dict:
        snapshot = self._snapshot
        return {
            "state": self.state,
            "count": snapshot.meta["count"] if snapshot else 0,
            "dim": snapshot.meta.get("dim") if snapshot else None,
            "model": snapshot.meta.get("model") if snapshot else None,
            "built_at": snapshot.meta.get("built_at") if snapshot else None,
            "last_build_seconds": self.last_build_seconds,
            "error": self.error,
        }


_index: Optional[RoleSkillIndex] = None


def get_role_index() -> RoleSkillIndex:
    global _index
    if _index is None:
        _index = RoleSkillIndex()
    return _index


def use_role_index(index: Optional[RoleSkillIndex]) -> None:
    """Substitute the index (tests); None resets it."""
    global _index
    _index = index
