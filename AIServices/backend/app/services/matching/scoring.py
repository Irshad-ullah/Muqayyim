"""
Career matching scores (Module 5 FE-3 / FE-4, FR7.2–FR7.5) — pure functions, no I/O.

Skill-to-skill only (FE-4): every role skill is compared with each of the user's skills
individually by cosine similarity of their own embeddings. There is no averaged profile
vector, no profession-level vector and no weighting by skill source.

Credit for one role skill = the best credit over the user's skills (credit rule, 09b2):
  same canonical key                                              → matched, 1.0
  user skill described, role skill described, sim ≥ 0.73, mutual_nn → related, 0.5
  user skill described, role skill not described (ESCO label), sim ≥ 0.73 → related, 0.5
  otherwise                                                        → missing, 0
The pair kind is decided HERE from both skills' actual description status. (The index's
search_related labels a pair "described" whenever it is not "mixed", which includes an
undescribed user skill; such pairs get no credit.)

Match % = Σ credits over the REQUIRED role skills ÷ their number × 100. Required: O*NET
in-demand, ESCO essential, topped up to MIN_REQUIRED in stored order (O*NET: in-demand →
hot; ESCO: essential → optional). The other role skills are shown as optional, not counted.
"""

import re
from typing import Dict, Iterable, List, Optional, Tuple

MATCHED, RELATED, MISSING = "matched", "related", "missing"
MATCHED_CREDIT, RELATED_CREDIT = 1.0, 0.5
MIN_REQUIRED = 10
LOW_MATCH_PERCENT = 20.0  # display only: the "low match" note when even the best result is below it
ALGORITHM_VERSION = "1"  # part of the cache key; bump when the scoring rules change

SOURCE_LABELS = {"manual": "your profile", "cv": "your CV", "github": "GitHub"}
ATTRIBUTION = {
    "onet": "O*NET 31.0 Database, U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), "
            "used under CC BY 4.0, modified",
    "esco": "ESCO v1.2.1 © European Union",
}


# ── required / optional ───────────────────────────────────────────────────────
def is_flagged(skill: dict, source: str) -> bool:
    if source == "onet":
        return bool(skill.get("in_demand"))
    if source == "esco":
        return skill.get("type") == "essential"
    return skill.get("type") != "optional"  # manual professions: everything but explicit optionals


def split_required(profession: dict, minimum: int = MIN_REQUIRED) -> Tuple[List[dict], List[dict]]:
    """(required, optional) in stored order. Short required lists are topped up to `minimum`
    from the remaining skills in stored order."""
    skills = list(profession.get("skills") or [])
    source = profession.get("source")
    flagged = [i for i, s in enumerate(skills) if is_flagged(s, source)]
    chosen = set(flagged)
    for i in range(len(skills)):
        if len(chosen) >= minimum:
            break
        chosen.add(i)
    required = [s for i, s in enumerate(skills) if i in chosen]
    optional = [s for i, s in enumerate(skills) if i not in chosen]
    return required, optional


# ── credits ───────────────────────────────────────────────────────────────────
def related_credits(pairs: Iterable[dict], user_described: Dict[str, bool], role_described) -> Dict[str, dict]:
    """search_related pairs → {role_key: best qualifying pair} (highest similarity).
    `role_described(role_name) -> bool`."""
    best: Dict[str, dict] = {}
    for pair in pairs:
        if not user_described.get(pair["user_key"]):
            continue  # an undescribed user skill earns no related credit
        if role_described(pair["role_name"]):
            if not pair.get("mutual_nn"):
                continue
            kind = "described"
        else:
            kind = "mixed"
        current = best.get(pair["role_key"])
        if current is None or pair["similarity"] > current["similarity"]:
            best[pair["role_key"]] = {**pair, "kind": kind}
    return best


def assess(skill_key: str, skill_name: str, owned: Dict[str, dict], related: Dict[str, dict]) -> dict:
    """One role skill → {name, key, status, credit, via?}."""
    if skill_key in owned:
        user = owned[skill_key]
        return {"name": skill_name, "key": skill_key, "status": MATCHED, "credit": MATCHED_CREDIT,
                "via": {"name": user["name"], "source": user.get("source")}}
    pair = related.get(skill_key)
    if pair:
        user = owned.get(pair["user_key"], {"name": pair["user_key"]})
        return {"name": skill_name, "key": skill_key, "status": RELATED, "credit": RELATED_CREDIT,
                "via": {"name": user["name"], "source": user.get("source"), "similarity": pair["similarity"],
                        "kind": pair["kind"]}}
    return {"name": skill_name, "key": skill_key, "status": MISSING, "credit": 0.0}


def score_profession(profession: dict, owned: Dict[str, dict], related: Dict[str, dict], current_skill) -> dict:
    """The full breakdown of one profession. `current_skill(skill) -> (key, name)` applies today's aliases."""
    required, optional = split_required(profession)

    def rows(skills):
        out, seen = [], set()
        for skill in skills:
            key, name = current_skill(skill)
            if key in seen:
                continue  # two stored names that now share a key count once
            seen.add(key)
            out.append(assess(key, name, owned, related))
        return out

    required_rows, optional_rows = rows(required), rows(optional)
    optional_rows = [r for r in optional_rows if r["key"] not in {q["key"] for q in required_rows}]
    total = len(required_rows)
    credits = sum(r["credit"] for r in required_rows)
    return {
        "profession_id": profession["profession_id"],
        "title": profession.get("title"),
        "source": profession.get("source"),
        "source_version": profession.get("source_version"),
        "category": profession.get("category") or "Other",
        "description": profession.get("description"),
        "score": round(100.0 * credits / total, 1) if total else 0.0,
        "required_count": total,
        "matched": sum(r["status"] == MATCHED for r in required_rows),
        "related": sum(r["status"] == RELATED for r in required_rows),
        "missing": sum(r["status"] == MISSING for r in required_rows),
        "required": required_rows,
        "optional": optional_rows,
        "gaps": [r["name"] for r in required_rows if r["status"] == MISSING],
        "optional_gaps": [r["name"] for r in optional_rows if r["status"] == MISSING],
        "attribution": ATTRIBUTION.get(profession.get("source")),
    }


# ── duplicates across sources ─────────────────────────────────────────────────
def normalise_title(title: Optional[str]) -> str:
    """Lowercase, punctuation to spaces, a plural -s dropped from words longer than 3 letters
    ("Software Developers" == "software developer"). Exact matches only — no alternative titles."""
    text = re.sub(r"[^a-z0-9+#/ ]", " ", (title or "").lower())
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in text.split())


def merge_duplicates(scored: List[dict]) -> List[dict]:
    """One result per normalised title. The result shows the higher-scoring record (its score,
    title and skill list); `sources` lists every record; `categories` is the union (for the filter).
    Ties keep the first record (O*NET before ESCO by profession_id order)."""
    groups: Dict[str, List[dict]] = {}
    order: List[str] = []
    for item in scored:
        key = normalise_title(item["title"])
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(item)
    merged = []
    for key in order:
        members = groups[key]
        primary = max(members, key=lambda m: (m["score"], -members.index(m)))
        merged.append({
            **primary,
            "sources": [{"profession_id": m["profession_id"], "source": m["source"], "title": m["title"],
                         "score": m["score"], "category": m["category"], "source_version": m.get("source_version"),
                         "attribution": m.get("attribution")} for m in members],
            "categories": sorted({m["category"] for m in members}),
            "members": members,
        })
    return merged


def rank(results: List[dict]) -> List[dict]:
    """Highest score first; ties by more matched skills, then title (deterministic)."""
    return sorted(results, key=lambda r: (-r["score"], -r["matched"], (r["title"] or "").lower(), r["profession_id"]))


# ── explanations (template-based, deterministic) ─────────────────────────────
def _join(names: List[str], limit: int = 5) -> str:
    shown = names[:limit]
    rest = len(names) - len(shown)
    text = ", ".join(shown[:-1]) + (" and " if len(shown) > 1 else "") + shown[-1] if shown else ""
    return f"{text} and {rest} more" if rest > 0 else text


def _from(source: Optional[str]) -> str:
    return SOURCE_LABELS.get(source or "", "your profile")


def explain(result: dict) -> List[str]:
    """Sentences explaining one result, built only from its breakdown and the user's skill sources."""
    required = result["required"]
    matched = [r for r in required if r["status"] == MATCHED]
    related = [r for r in required if r["status"] == RELATED]
    missing = [r for r in required if r["status"] == MISSING]
    lines = [f"{result['title']} needs {result['required_count']} key skills; your match is {result['score']:.0f}%: "
             f"{len(matched)} matched, {len(related)} related and {len(missing)} missing."]
    if matched:
        by_source: Dict[str, List[str]] = {}
        for r in matched:
            by_source.setdefault(_from(r["via"].get("source")), []).append(r["name"])
        parts = [f"{_join(names)} (from {label})" for label, names in by_source.items()]
        lines.append("You already have " + "; ".join(parts) + ".")
    if related:
        pairs = [f"{r['name']} (close to your {r['via']['name']}, similarity {r['via']['similarity']:.2f})" for r in related[:4]]
        more = f" and {len(related) - 4} more" if len(related) > 4 else ""
        lines.append("Related skills count half: " + ", ".join(pairs) + more + ".")
    if missing:
        lines.append(f"To close the gap, learn {_join([r['name'] for r in missing])}.")
    else:
        lines.append("You have or are close to every key skill for this role.")
    if result["source"] == "esco":
        lines.append("ESCO lists broader competences, so scores for ESCO roles tend to be lower than for O*NET roles.")
    return lines


def summary(result: dict) -> dict:
    """The list view of one (merged) result — no skill breakdown."""
    return {k: result[k] for k in ("profession_id", "title", "source", "category", "categories", "score",
                                   "required_count", "matched", "related", "missing", "sources", "attribution")} | {
        "gap_count": len(result["gaps"]),
        "top_matched": [r["name"] for r in result["required"] if r["status"] == MATCHED][:5],
    }
