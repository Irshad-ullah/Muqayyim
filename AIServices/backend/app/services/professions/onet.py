"""
O*NET 31.0 (CSV) → profession documents.

Files (columns read by header name):
  occupation_data.csv  O*NET-SOC Code, Title, Description
  job_titles.csv       O*NET-SOC Code, Title, Job Title, Short Title, Source(s)
  software_skills.csv  O*NET-SOC Code, Title, Workplace Example, Element ID, Element Name,
                       Hot Technology, In Demand

Kept: SOC codes starting with ONET_SOC_PREFIXES minus ONET_SOC_EXCLUDE.
Skills: software rows flagged Hot Technology or In Demand only, at most
ONET_SKILLS_CAP per occupation (in-demand first, then hot), type 'technology'.
"""

from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List

from app.config.settings import settings
from app.services.embeddings.descriptions import get_description_provider
from app.services.professions.categories import categorise
from app.services.professions.cleaning import clean_onet_label, is_curated
from app.services.professions.csv_io import csv_list, read_rows, validate_files
from app.services.professions.store import make_skill, profession_doc

MAX_ALT_TITLES = 15

FILES = {
    "occupation_data": ["O*NET-SOC Code", "Title", "Description"],
    "job_titles": ["O*NET-SOC Code", "Job Title", "Short Title"],
    "software_skills": ["O*NET-SOC Code", "Workplace Example", "Element Name", "Hot Technology", "In Demand"],
}


def _yes(value: str) -> bool:
    return (value or "").strip().upper() in ("Y", "YES", "TRUE", "1")


def selected(code: str, prefixes: List[str], exclude: List[str]) -> bool:
    return code not in exclude and any(code.startswith(p) for p in prefixes)


def parse_onet(data_dir: Path, version: str, *, prefixes=None, exclude=None, cap=None) -> Dict:
    """→ { docs, stats } without touching the database."""
    prefixes = prefixes if prefixes is not None else csv_list(settings.ONET_SOC_PREFIXES)
    exclude = exclude if exclude is not None else csv_list(settings.ONET_SOC_EXCLUDE)
    cap = cap if cap is not None else settings.ONET_SKILLS_CAP
    paths = validate_files(Path(data_dir), FILES, suffixes=("",))

    occupations, excluded = {}, []
    for row in read_rows(paths["occupation_data"]):
        code = row["O*NET-SOC Code"]
        if code in exclude and any(code.startswith(p) for p in prefixes):
            excluded.append({"code": code, "title": row["Title"]})
        if selected(code, prefixes, exclude):
            occupations[code] = row

    alt_titles = defaultdict(list)
    for row in read_rows(paths["job_titles"]):
        code = row["O*NET-SOC Code"]
        if code not in occupations:
            continue
        for title in (row.get("Job Title"), row.get("Short Title")):
            if title and title.lower() not in {t.lower() for t in alt_titles[code]} and title != occupations[code]["Title"]:
                alt_titles[code].append(title)

    rows_by_code = defaultdict(list)
    for row in read_rows(paths["software_skills"]):
        code = row["O*NET-SOC Code"]
        if code in occupations and (_yes(row["Hot Technology"]) or _yes(row["In Demand"])):
            rows_by_code[code].append(row)

    provider = get_description_provider()
    docs, labels, unmapped = [], 0, Counter()
    skills_total = mapped = described = 0
    for code, occ in occupations.items():
        # In-demand first, then hot; file order within each group.
        ordered = sorted(rows_by_code[code], key=lambda r: (not _yes(r["In Demand"]), not _yes(r["Hot Technology"])))[:cap]
        skills = []
        for row in ordered:
            label = row["Workplace Example"]
            labels += 1
            name = clean_onet_label(label)
            if not is_curated(name):
                unmapped[label] += 1
            skills.append(make_skill(
                name, "technology", label,
                hot=_yes(row["Hot Technology"]), in_demand=_yes(row["In Demand"]),
                element_name=row.get("Element Name") or None,
            ))
        doc = profession_doc(
            profession_id=f"onet:{code}",
            title=occ["Title"],
            alt_titles=alt_titles[code][:MAX_ALT_TITLES],
            description=occ["Description"],
            category=categorise("onet", code, occ["Title"]),
            source="onet",
            source_code=code,
            source_version=f"O*NET {version}",
            skills=skills,
        )
        docs.append(doc)
        skills_total += len(doc["skills"])
        mapped += sum(1 for s in doc["skills"] if is_curated(s["name"]))
        described += sum(1 for s in doc["skills"] if provider.lookup(s["name"]))

    stats = {
        "occupations_kept": [{"code": d["source_code"], "title": d["title"]} for d in docs],
        "occupations_excluded": excluded,
        "software_rows_kept": labels,
        "skills_kept": skills_total,
        "mapped_to_curated_pct": round(100 * mapped / skills_total, 1) if skills_total else 0.0,
        "described_pct": round(100 * described / skills_total, 1) if skills_total else 0.0,
        "top_unmapped_labels": unmapped.most_common(30),
    }
    return {"docs": docs, "stats": stats}
