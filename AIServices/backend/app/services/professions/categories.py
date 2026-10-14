"""Profession category from SOC / ISCO code prefixes and title keywords (app/data/role_categories.json)."""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

CATEGORIES_FILE = Path(__file__).resolve().parents[2] / "data" / "role_categories.json"


@lru_cache(maxsize=1)
def _config() -> dict:
    data = json.loads(CATEGORIES_FILE.read_text(encoding="utf8"))
    data["_keywords"] = [(re.compile(rf"\b{re.escape(k)}\b", re.IGNORECASE), c) for k, c in data["keywords"]]
    return data


def categories() -> list:
    return list(_config()["categories"])


def _by_prefix(table: dict, code: str) -> Optional[str]:
    matches = [prefix for prefix in table if code.startswith(prefix)]
    return table[max(matches, key=len)] if matches else None


def categorise(source: str, code: str, title: str) -> str:
    config = _config()
    found = None
    if source == "onet" and code:
        found = _by_prefix(config["soc"], code)
    elif source == "esco" and code:
        found = _by_prefix(config["isco"], code)
    if found:
        return found
    for pattern, category in config["_keywords"]:
        if pattern.search(title or ""):
            return category
    return "Other"
