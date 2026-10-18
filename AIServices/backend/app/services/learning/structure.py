"""
Learning path structure (Module 6, FR8.1–FR8.2): deterministic, testable, works without the LLM.

From ONE selected career match:
  1. skills    the role's MISSING required rows under production scoring (matching.service.compute, related credit
               off); an any-of group becomes one module whose skill is the user's chosen alternative (default: the
               first); at most MAX_MODULES modules, essential tier first; the rest is reported as `more`.
  2. order     essential tier, then optional tier; inside a tier: quick wins first (missing rows with a related hint
               to a held skill), then the remaining skills; both blocks ordered greedily by nearest neighbour on our
               skill vectors (start: the skill closest to the user's skills; next: the remaining skill closest to the
               last one; ties by key) — similar skills sit together.
  3. prerequisites (optional, from the enrichment LLM): accepted only between two skills of the path, never a
               self-pair, never closing a cycle (pairs are taken in the given order); applied by a minimal stable
               reorder — a prerequisite that comes after its dependant moves to just before it. Without the LLM there
               are no pairs and the order of step 2 stands.

Nothing here calls the LLM or writes anything except the shared vector cache (a skill not yet embedded).
"""

import hashlib
import json
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from app.services.embeddings.model import get_embedder
from app.services.embeddings.normalise import normalise_skill
from app.services.embeddings.vector_store import get_skill_vectors
from app.services.matching import service
from app.services.professions.role_skills import current_skill

MAX_MODULES = 8
ESSENTIAL, OPTIONAL = "essential", "optional"


class ProfessionNotFound(Exception):
    pass


class InvalidChoice(Exception):
    def __init__(self, message: str):
        self.safe_message = message
        super().__init__(message)


def _types(profession: dict) -> Dict[str, str]:
    """role-skill key → stored type (essential / optional / technology)."""
    out = {}
    for skill in profession.get("skills") or []:
        key = current_skill(skill)[0]
        out.setdefault(key, skill.get("type") or OPTIONAL)
    return out


def _tier(stored_type: str) -> str:
    return ESSENTIAL if stored_type == ESSENTIAL else OPTIONAL


def candidates(member: dict, profession: dict, choices: Optional[Dict[str, str]] = None) -> List[dict]:
    """The member's missing required rows → module candidates in role order (any-of → the chosen alternative)."""
    choices = choices or {}
    types = _types(profession)
    out = []
    for position, row in enumerate(member["required"]):
        if row["status"] != "missing":
            continue
        group = row.get("group")
        alternatives = [{"name": n, "key": normalise_skill(n)[0]} for n in (group or {}).get("alternatives", [])]
        chosen_key = choices.get(row["key"])
        if alternatives:
            keys = [a["key"] for a in alternatives]
            if chosen_key is not None and chosen_key not in keys:
                raise InvalidChoice(f"{chosen_key!r} is not an alternative of {row['name']!r}")
            chosen = alternatives[keys.index(chosen_key)] if chosen_key else alternatives[0]
        else:
            if chosen_key is not None and chosen_key != row["key"]:
                raise InvalidChoice(f"{row['name']!r} has no alternatives")
            chosen = {"name": row["name"], "key": row["key"]}
        hint = row.get("related_hint")
        out.append({
            "requirement_key": row["key"], "requirement": row["name"], "key": chosen["key"], "skill": chosen["name"],
            "alternatives": alternatives, "tier": _tier(types.get(row["key"], OPTIONAL)), "position": position,
            "quick_win": bool(hint), "hint": {"skill": hint["skill"], "similarity": hint["similarity"]} if hint else None,
        })
    return out


def nearest_neighbour_order(items: List[dict], vectors: Dict[str, np.ndarray], anchor: Optional[np.ndarray]) -> List[dict]:
    """Greedy chain: first the item closest to `anchor` (the user's skills; None → role order), then repeatedly the
    remaining item closest to the last one. Items without a vector keep their role order after the others."""
    with_vec = [i for i in items if i["key"] in vectors]
    without = [i for i in items if i["key"] not in vectors]
    ordered: List[dict] = []
    remaining = sorted(with_vec, key=lambda i: (i["position"], i["key"]))
    current = anchor
    while remaining:
        if current is None:
            pick = remaining[0]
        else:
            pick = max(remaining, key=lambda i: (round(float(vectors[i["key"]] @ current), 6), -i["position"], i["key"]))
        ordered.append(pick)
        remaining.remove(pick)
        current = vectors[pick["key"]]
    return ordered + sorted(without, key=lambda i: (i["position"], i["key"]))


def order_modules(items: List[dict], vectors: Dict[str, np.ndarray], user_matrix: Optional[np.ndarray]) -> List[dict]:
    """Tier (essential, optional) → quick wins → the rest; nearest-neighbour chains inside each block."""
    out: List[dict] = []
    for tier in (ESSENTIAL, OPTIONAL):
        block_items = [i for i in items if i["tier"] == tier]
        last = None
        for quick in (True, False):
            block = [i for i in block_items if i["quick_win"] == quick]
            if not block:
                continue
            if last is not None:
                anchor = last
            elif user_matrix is not None and len(user_matrix):
                # closest to any held skill: start from the item with the highest max-similarity
                best = max((i for i in block if i["key"] in vectors),
                           key=lambda i: (round(float((user_matrix @ vectors[i["key"]]).max()), 6), -i["position"], i["key"]),
                           default=None)
                anchor = vectors[best["key"]] if best is not None else None
            else:
                anchor = None
            chain = nearest_neighbour_order(block, vectors, anchor)
            out.extend(chain)
            if chain and chain[-1]["key"] in vectors:
                last = vectors[chain[-1]["key"]]
    return out


def validate_prerequisites(pairs: Iterable[Sequence[str]], keys: Sequence[str]) -> Tuple[List[Tuple[str, str]], List[dict]]:
    """→ (accepted (before, after) key pairs, rejected [{pair, reason}]). A pair is accepted only between two skills
    of the path, never a self-pair or a duplicate, never closing a cycle (checked against the pairs accepted so far)."""
    allowed = set(keys)
    accepted: List[Tuple[str, str]] = []
    rejected: List[dict] = []
    edges: Dict[str, set] = {k: set() for k in keys}

    def reaches(start: str, goal: str) -> bool:
        stack, seen = [start], set()
        while stack:
            node = stack.pop()
            if node == goal:
                return True
            if node in seen:
                continue
            seen.add(node)
            stack.extend(edges[node])
        return False

    for pair in pairs:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            rejected.append({"pair": pair, "reason": "not a pair"})
            continue
        before, after = (normalise_skill(str(p))[0] for p in pair)
        if before not in allowed or after not in allowed:
            rejected.append({"pair": list(pair), "reason": "skill not in the path"})
        elif before == after:
            rejected.append({"pair": list(pair), "reason": "a skill cannot be its own prerequisite"})
        elif (before, after) in accepted:
            rejected.append({"pair": list(pair), "reason": "duplicate"})
        elif reaches(after, before):
            rejected.append({"pair": list(pair), "reason": "would create a cycle"})
        else:
            accepted.append((before, after))
            edges[before].add(after)
    return accepted, rejected


def apply_prerequisites(modules: List[dict], pairs: Sequence[Tuple[str, str]]) -> List[dict]:
    """Minimal stable reorder: while a prerequisite comes after its dependant, move it to just before the dependant.
    The pairs are acyclic (validate_prerequisites), so this ends; untouched modules keep their relative order."""
    order = list(modules)
    for _ in range(len(order) * len(pairs) + 1):
        index = {m["key"]: i for i, m in enumerate(order)}
        violation = next(((b, a) for b, a in pairs if index[b] > index[a]), None)
        if violation is None:
            break
        before, after = violation
        item = order.pop(index[before])
        order.insert(index[after] if index[after] < index[before] else index[after] - 1, item)
    for m in order:
        m["prerequisites"] = [b for b, a in pairs if a == m["key"]]
    return order


def skills_hash(owned: Dict[str, dict]) -> str:
    return hashlib.sha256(json.dumps(sorted(owned), ensure_ascii=False).encode()).hexdigest()


async def dataset_hash(db) -> str:
    from app.services.taxonomy.pipeline import live_fingerprint
    from app.services.taxonomy.snapshots import curated_dataset_hash

    return hashlib.sha256(f"{await live_fingerprint(db)}|{curated_dataset_hash()}".encode()).hexdigest()


async def build(owned: Dict[str, dict], profession_id: str, db, choices: Optional[Dict[str, str]] = None,
                prerequisites: Optional[Iterable[Sequence[str]]] = None) -> dict:
    """The path structure for one career match (owned = the user's skills, as service.user_skills returns them)."""
    results = await service.compute(owned, db, related_credit=False)
    member = next((m for r in results for m in r["members"] if m["profession_id"] == profession_id), None)
    if member is None:
        raise ProfessionNotFound(profession_id)
    profession = await db["professions"].find_one({"profession_id": profession_id}, {"skills": 1})
    items = candidates(member, profession or {}, choices)
    essential = [i for i in items if i["tier"] == ESSENTIAL]
    optional = [i for i in items if i["tier"] == OPTIONAL]
    kept = (essential + optional)[:MAX_MODULES]
    more = (essential + optional)[MAX_MODULES:]

    names = {i["key"]: i["skill"] for i in kept}
    vectors: Dict[str, np.ndarray] = {}
    user_matrix = None
    embedder = get_embedder()
    if kept and embedder.ready:
        found = await get_skill_vectors(list(names.values()) + [v["name"] for v in owned.values()], embedder, db)
        vectors = {k: np.asarray(v, dtype=np.float32) for k, v in found.items()}
        user_rows = [vectors[k] for k in owned if k in vectors]
        user_matrix = np.stack(user_rows) if user_rows else None
    modules = order_modules(kept, vectors, user_matrix)
    accepted, rejected = validate_prerequisites(prerequisites or [], [m["key"] for m in modules])
    modules = apply_prerequisites(modules, accepted)
    for index, m in enumerate(modules, 1):
        m["order"] = index
        m.pop("position", None)
    return {
        "profession_id": profession_id, "title": member["title"], "source": member["source"],
        "source_version": member.get("source_version"), "match_score": member["score"],
        "modules": modules, "more": {"count": len(more), "skills": [i["skill"] for i in more]},
        "prerequisites": {"accepted": [list(p) for p in accepted], "rejected": rejected},
        "snapshot": {"skills_hash": skills_hash(owned), "dataset_hash": await dataset_hash(db),
                     "scoring_mode": "exact", "algorithm": "learning-structure@1"},
    }
