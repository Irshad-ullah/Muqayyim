"""
ESCO v1.2.1 (CSV, English) → profession documents and the ESCO skill catalogue.

Files (`_en` suffix optional; columns read by header name):
  occupations_en.csv                conceptUri, iscoGroup, preferredLabel, altLabels, description, code
  skills_en.csv                     conceptUri, skillType, preferredLabel, altLabels, description
  occupationSkillRelations_en.csv   occupationUri, relationType, skillUri
  digitalSkillsCollection_en.csv    conceptUri (optional)

Kept: occupations whose ISCO group starts with ESCO_ISCO_PREFIXES. Their
essential / optional skills come from the relations file, joined by URI.
All skills are returned for ai_db.esco_skills, not only the ones used.
"""

from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict

from app.config.settings import settings
from app.services.embeddings.descriptions import get_description_provider
from app.services.professions.categories import categorise
from app.services.professions.cleaning import clean_esco_label, is_curated
from app.services.professions.csv_io import csv_list, read_rows, split_labels, validate_files
from app.services.professions.store import make_skill, profession_doc

MAX_ALT_TITLES = 15

FILES = {
    "occupations": ["conceptUri", "iscoGroup", "preferredLabel", "altLabels", "description", "code"],
    "skills": ["conceptUri", "skillType", "preferredLabel", "altLabels", "description"],
    "occupationSkillRelations": ["occupationUri", "relationType", "skillUri"],
    "digitalSkillsCollection": ["conceptUri"],
}
# Optional: without it every skill is reported as non-digital (09c).
OPTIONAL = ("digitalSkillsCollection",)


def uri_id(uri: str) -> str:
    """http://data.europa.eu/esco/occupation/<uuid> → <uuid>"""
    return (uri or "").rstrip("/").rsplit("/", 1)[-1]


def parse_esco(data_dir: Path, version: str, *, isco_prefixes=None) -> Dict:
    """→ { docs, esco_skills, stats } without touching the database."""
    prefixes = isco_prefixes if isco_prefixes is not None else csv_list(settings.ESCO_ISCO_PREFIXES)
    paths = validate_files(Path(data_dir), FILES, optional=OPTIONAL)

    digital = ({row["conceptUri"] for row in read_rows(paths["digitalSkillsCollection"])}
               if "digitalSkillsCollection" in paths else set())

    skills, modified, duplicate_rows = {}, {}, 0
    for row in read_rows(paths["skills"]):
        uri = row["conceptUri"]
        if uri in skills:
            # The dataset repeats a few URIs; the most recently modified row wins.
            duplicate_rows += 1
            if (row.get("modifiedDate") or "") <= modified[uri]:
                continue
        modified[uri] = row.get("modifiedDate") or ""
        skills[uri] = {
            "uri": row["conceptUri"],
            "label": row["preferredLabel"],
            "alt_labels": split_labels(row["altLabels"]),
            "description": row["description"],
            "skill_type": row["skillType"],
            "reuse_level": row.get("reuseLevel") or None,
            "digital": row["conceptUri"] in digital,
            "source_version": f"ESCO v{version}",
        }

    occupations, per_group = {}, Counter()
    for row in read_rows(paths["occupations"]):
        group = row["iscoGroup"]
        prefix = next((p for p in sorted(prefixes, key=len, reverse=True) if group.startswith(p)), None)
        if prefix:
            occupations[row["conceptUri"]] = row
            per_group[prefix] += 1

    relations = defaultdict(list)
    relation_types, missing_skill_uris = Counter(), 0
    for row in read_rows(paths["occupationSkillRelations"]):
        if row["occupationUri"] not in occupations:
            continue
        skill = skills.get(row["skillUri"])
        if skill is None:
            missing_skill_uris += 1
            continue
        relation_types[row["relationType"]] += 1
        relations[row["occupationUri"]].append((row["relationType"], skill))

    provider = get_description_provider()
    docs, used, skill_types = [], {}, Counter()
    for uri, occ in occupations.items():
        skill_list = []
        for relation, skill in relations[uri]:
            name = clean_esco_label(skill["label"])
            used[skill["uri"]] = name
            skill_list.append(make_skill(name, "essential" if relation == "essential" else "optional", skill["label"]))
        title = occ["preferredLabel"]
        alt_titles = [t for t in split_labels(occ["altLabels"]) if t.lower() != title.lower()]
        docs.append(profession_doc(
            profession_id=f"esco:{uri_id(uri)}",
            title=title,
            alt_titles=list(dict.fromkeys(alt_titles))[:MAX_ALT_TITLES],
            description=occ["description"],
            category=categorise("esco", occ["iscoGroup"], title),
            source="esco",
            source_code=occ["code"] or occ["iscoGroup"],
            source_version=f"ESCO v{version}",
            skills=skill_list,
        ))

    for uri in used:
        skill_types[skills[uri]["skill_type"] or "unknown"] += 1
    names = {}
    for uri, name in used.items():
        names.setdefault(name, uri)
    curated = sum(1 for n in names if is_curated(n))
    described = [n for n in names if provider.lookup(n)]
    undescribed = Counter()
    for doc in docs:
        for s in doc["skills"]:
            if not provider.lookup(s["name"]):
                undescribed[s["name"]] += 1

    stats = {
        "occupations_kept": len(docs),
        "occupations_per_isco_group": dict(sorted(per_group.items())),
        "relations": dict(relation_types),
        "relations_with_unknown_skill": missing_skill_uris,
        "distinct_skills_used": len(used),
        "distinct_skill_names_used": len(names),
        "skill_type_counts": dict(skill_types),
        "digital_skills_used": sum(1 for uri in used if uri in digital),
        "esco_skills_total": len(skills),
        "esco_skill_duplicate_rows": duplicate_rows,
        "digital_skills_total": len(digital),
        "mapped_to_curated_pct": round(100 * curated / len(names), 1) if names else 0.0,
        "described_pct": round(100 * len(described) / len(names), 1) if names else 0.0,
        "top_undescribed_skills": undescribed.most_common(30),
    }
    return {"docs": docs, "esco_skills": list(skills.values()), "stats": stats}
