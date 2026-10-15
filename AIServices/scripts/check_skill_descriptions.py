#!/usr/bin/env python
"""
Quality checks for the curated skill descriptions
(AIServices/backend/app/data/skill_descriptions.json).

Checks:
  - valid JSON, unique keys, every key is a canonical name (normalise_skill)
  - every alias-file canonical name and every CV-parser vocabulary skill present
  - benchmark seed entries (AIServices/data/benchmark_seed_skills.json) present
    and IDENTICAL (the 0.72 related threshold was calibrated on them)
  - non-seed descriptions: 8–20 words, no banned marketing words
  - no non-seed description names more than 2 other canonical skills
    (FROZEN_OVER_LIMIT: older descriptions pushed over by a newer canonical name → warning)
  - every entry has a category (app/data/skill_categories.json); totals per category

Usage (AIServices venv):
  AIServices/backend/venv/Scripts/python AIServices/scripts/check_skill_descriptions.py
Exit code 0 when all checks pass, 1 otherwise. Also run by
tests/test_skill_descriptions.py.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DATA = BACKEND / "app" / "data"
DESCRIPTIONS = DATA / "skill_descriptions.json"
CATEGORIES = DATA / "skill_categories.json"
ALIASES = DATA / "skill_aliases.json"
SEED = ROOT / "data" / "benchmark_seed_skills.json"

MIN_WORDS, MAX_WORDS, MAX_OTHER_SKILLS = 8, 20, 2
BANNED = ["powerful", "popular", "best", "leading", "modern", "easy", "seamless", "cutting-edge"]
# Existing descriptions are never edited. When a later-added canonical skill makes an
# existing description name more than MAX_OTHER_SKILLS skills, it is listed here and
# reported as a warning instead of an error.
FROZEN_OVER_LIMIT = {
    "htmx": "AJAX became a canonical skill in 09b2",
}

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def _load_unique(path: Path) -> dict:
    def no_duplicates(pairs):
        seen = {}
        for key, value in pairs:
            if key in seen:
                raise ValueError(f"duplicate key in {path.name}: {key!r}")
            seen[key] = value
        return seen

    return json.loads(path.read_text(encoding="utf8"), object_pairs_hook=no_duplicates)


def parser_vocabulary() -> list:
    """The CV skill extractor's vocabulary, as canonical names it can output."""
    from app.services.embeddings.normalise import normalise_skill
    from app.services.nlp_extractor import get_nlp_extractor

    extractor = get_nlp_extractor()
    names = set()
    for raw in extractor.technical_skills | extractor.soft_skills:
        shown = raw.title().replace("Js", "JS").replace("Sql", "SQL")  # extractor's display form
        names.add(normalise_skill(shown)[1])
    return sorted(names)


def word_count(text: str) -> int:
    return len(text.split())


def skill_pattern(name: str) -> re.Pattern:
    return re.compile(rf"(?<![\w.+#/-]){re.escape(name)}(?![\w+#])")


def run_checks(vocabulary=None) -> dict:
    from app.services.embeddings.normalise import normalise_skill

    errors, warnings = [], []
    descriptions = _load_unique(DESCRIPTIONS)
    categories = _load_unique(CATEGORIES)
    aliases = _load_unique(ALIASES)["canonical"]
    seed = _load_unique(SEED)

    keys = {}
    for name in descriptions:
        key, canonical = normalise_skill(name)
        if canonical != name:
            errors.append(f"not a canonical name: {name!r} (normalise_skill gives {canonical!r})")
        if key in keys:
            errors.append(f"duplicate canonical key {key!r}: {keys[key]!r} and {name!r}")
        keys[key] = name

    for name in aliases:
        if name not in descriptions:
            errors.append(f"alias canonical missing: {name!r}")
    for name in vocabulary if vocabulary is not None else parser_vocabulary():
        if name not in descriptions:
            errors.append(f"parser vocabulary skill missing: {name!r}")

    for name, text in seed.items():
        if descriptions.get(name) != text:
            errors.append(f"seed entry missing or changed: {name!r}")

    banned = re.compile(r"\b(" + "|".join(re.escape(w) for w in BANNED) + r")\b", re.IGNORECASE)
    patterns = {name: skill_pattern(name) for name in descriptions}
    offenders = []
    for name, text in descriptions.items():
        if not isinstance(text, str) or not text.strip():
            errors.append(f"empty description: {name!r}")
            continue
        is_seed = name in seed
        mentioned = [other for other, p in patterns.items() if other != name and p.search(text)]
        if len(mentioned) > MAX_OTHER_SKILLS:
            offenders.append({"name": name, "seed": is_seed, "frozen": name in FROZEN_OVER_LIMIT, "mentions": mentioned})
        if is_seed:
            continue
        words = word_count(text)
        if not MIN_WORDS <= words <= MAX_WORDS:
            errors.append(f"{words} words (want {MIN_WORDS}-{MAX_WORDS}): {name!r}")
        hit = banned.search(text)
        if hit:
            errors.append(f"banned word {hit.group(0)!r}: {name!r}")
    for o in offenders:
        label = "seed " if o["seed"] else ("frozen " if o["frozen"] else "")
        (warnings if o["seed"] or o["frozen"] else errors).append(
            f"{label}description of {o['name']!r} names {len(o['mentions'])} other skills: {o['mentions']}"
        )

    for name in descriptions:
        if name not in categories:
            errors.append(f"no category: {name!r}")
    for name in categories:
        if name not in descriptions:
            errors.append(f"category for unknown skill: {name!r}")

    by_category = Counter(categories[n] for n in descriptions if n in categories)
    return {
        "total": len(descriptions),
        "seed": sum(1 for n in descriptions if n in seed),
        "new": sum(1 for n in descriptions if n not in seed),
        "by_category": dict(sorted(by_category.items())),
        "errors": errors,
        "warnings": warnings,
    }


def main() -> int:
    report = run_checks()
    print(f"Skill descriptions: {report['total']} total ({report['seed']} benchmark seed, {report['new']} new)")
    print("\nBy category:")
    for category, count in report["by_category"].items():
        print(f"  {count:4d}  {category}")
    if report["warnings"]:
        print(f"\nWarnings ({len(report['warnings'])}, seed and frozen entries are kept unchanged):")
        for w in report["warnings"]:
            print(f"  - {w}")
    if report["errors"]:
        print(f"\nFAILED ({len(report['errors'])} errors):")
        for e in report["errors"]:
            print(f"  - {e}")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
