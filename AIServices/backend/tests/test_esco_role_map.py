"""Module 5.1: the ESCO role map — the import transform (mapped / unmapped, one requirement per phrase, any-of
credit, top-up), the validator (and the real map as a build check), URI drift after a re-import, the post-check on an
unexpected drop, the career-match cache key, and snapshot / restore including the map. Test database and temporary
folders only; the raw dataset is never written."""

import importlib.util
import json
import shutil
from pathlib import Path

import pytest

from app.services.embeddings.normalise import normalise_skill
from app.services.matching import scoring, service
from app.services.professions import esco_role_map
from app.services.professions.esco import parse_esco
from app.services.professions.role_skills import current_skill
from app.services.taxonomy import jobs, pipeline, publishing, snapshots
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture
from tests.test_taxonomy_publish import checks, db, docs, previewed  # noqa: F401 — fixtures and helpers

FIXTURES = Path(__file__).parent / "fixtures" / "esco"
OCC = "http://data.europa.eu/esco/occupation/dev-0001"
UPL = "http://data.europa.eu/esco/skill/upl"
THINK = "http://data.europa.eu/esco/skill/think"
DBG = "http://data.europa.eu/esco/skill/dbg"
EXTRA_SKILLS = [(UPL, "skill/competence", "use programming languages"), (THINK, "skill/competence", "think analytically"),
                (DBG, "skill/competence", "debug software")]


def dataset(tmp_path: Path, drop=()) -> Path:
    """The ESCO fixture plus three phrases for the software developer (a temporary copy; `drop`: skill URIs whose
    relation is left out — a re-import where ESCO no longer lists them)."""
    target = tmp_path / "esco"
    shutil.copytree(FIXTURES, target)

    def append(name, lines):
        path = target / name
        text = path.read_text(encoding="utf8")
        path.write_text(text + ("" if text.endswith("\n") else "\n") + "\n".join(lines) + "\n", encoding="utf8")

    append("skills.csv", [f"KnowledgeSkillCompetence,{uri},{kind},cross-sector,{label},,released,2024-01-01T00:00:00Z,{label}."
                          for uri, kind, label in EXTRA_SKILLS])
    append("occupationSkillRelations.csv", [f"{OCC},software developer,essential,{kind},{uri},{label}"
                                            for uri, kind, label in EXTRA_SKILLS if uri not in drop])
    return target


def role_map(entries=None) -> dict:
    return {"version": 1, "entries": entries if entries is not None else [
        {"occupation_uri": OCC, "occupation": "software developer", "skill_uri": UPL, "phrase": "use programming languages",
         "skills": ["Kotlin", "Java", "Python", "Swift"]},
        {"occupation_uri": OCC, "occupation": "software developer", "skill_uri": THINK, "phrase": "think analytically",
         "skills": []},
    ]}


def developer(result) -> dict:
    return next(d for d in result["docs"] if d["profession_id"] == "esco:dev-0001")


def strip_group(skill: dict) -> dict:
    return {k: v for k, v in skill.items() if k not in ("source", "label", "alternatives", "phrase", "phrase_uri")}


# ── the transform ─────────────────────────────────────────────────────────────
def test_a_mapped_phrase_becomes_one_group_and_unmapped_phrases_stay(tmp_path):
    data = dataset(tmp_path)
    plain = developer(parse_esco(data, "1.2.1", role_map={"entries": []}))
    result = parse_esco(data, "1.2.1", role_map=role_map())
    dev = developer(result)
    # No split: the same requirements, in the same order, with the same name / key / type.
    assert [strip_group(s) for s in dev["skills"]] == plain["skills"]
    groups = [s for s in dev["skills"] if esco_role_map.is_group(s)]
    assert len(groups) == 1
    group = groups[0]
    assert group["name"] == "use programming languages" and group["type"] == "essential" and group["source"] == "role_map"
    assert group["phrase"] == "use programming languages" and group["phrase_uri"] == UPL and group["uri"] == UPL
    assert [a["name"] for a in group["alternatives"]] == ["Kotlin", "Java", "Python", "Swift"]
    assert group["label"] == "Kotlin / Java / Python / … (use programming languages)"
    for uri in (THINK, DBG):  # reviewed-empty and not-in-map phrases are untouched
        skill = next(s for s in dev["skills"] if s.get("uri") == uri)
        assert not esco_role_map.is_group(skill)
    stats = result["stats"]["role_map"]
    assert stats["adjusted_requirements"] == 1 and stats["essential_reviewed_unmapped"] == 1
    # Not in the map: "debug software" (and the fixture's other roles' undescribed essential phrases).
    assert [OCC, DBG] in stats["essential_not_in_map_examples"]
    assert [OCC, THINK] not in stats["essential_not_in_map_examples"] and [OCC, UPL] not in stats["essential_not_in_map_examples"]
    assert stats["stale_entries"] == 0
    assert all(s.get("uri") for d in result["docs"] for s in d["skills"])  # every ESCO skill keeps its URI


def profession(skills) -> dict:
    return {"profession_id": "esco:dev-0001", "title": "software developer", "source": "esco", "skills": skills}


def owned(*names):
    return {normalise_skill(n)[0]: {"name": normalise_skill(n)[1], "source": "manual"} for n in names}


def test_any_one_alternative_satisfies_the_group(tmp_path):
    dev = developer(parse_esco(dataset(tmp_path), "1.2.1", role_map=role_map()))
    plain = profession([strip_group(s) for s in dev["skills"]])
    mapped = profession(dev["skills"])
    phrase_key = normalise_skill("use programming languages")[0]

    for holding in (("Kotlin",), ("Swift", "Java")):
        result = scoring.score_profession(mapped, owned(*holding), {}, current_skill)
        row = next(r for r in result["required"] if r["key"] == phrase_key)
        assert row["status"] == "matched" and row["credit"] == 1.0 and row["via"]["group"] is True
        assert row["via"]["name"] in holding and row["name"].endswith("(use programming languages)")
        assert row["group"]["phrase"] == "use programming languages"
        # The required count is exactly the plain one: a group is one requirement.
        assert result["required_count"] == scoring.score_profession(plain, owned(*holding), {}, current_skill)["required_count"]
    explained = " ".join(scoring.explain(scoring.score_profession(mapped, owned("Kotlin"), {}, current_skill)))
    assert "Kotlin (shows: use programming languages)" in explained

    missing = scoring.score_profession(mapped, owned("Excel"), {}, current_skill)
    row = next(r for r in missing["required"] if r["key"] == phrase_key)
    assert row["status"] == "missing" and row["group"]["alternatives"] == ["Kotlin", "Java", "Python", "Swift"]
    only_group = profession([s for s in dev["skills"] if esco_role_map.is_group(s)])
    assert "learn one of Kotlin, Java, Python or Swift (for use programming languages)" in         " ".join(scoring.explain(scoring.score_profession(only_group, owned("Excel"), {}, current_skill)))

    # Not held through an alternative → the production rule for the phrase: related credit stays 0.5.
    related = {phrase_key: {"user_key": "excel", "similarity": 0.8, "kind": "mixed"}}
    row = next(r for r in scoring.score_profession(mapped, owned("Excel"), related, current_skill)["required"]
               if r["key"] == phrase_key)
    assert row["status"] == "related" and row["credit"] == 0.5
    # Holding the phrase itself still counts as before.
    row = next(r for r in scoring.score_profession(mapped, {phrase_key: {"name": "use programming languages"}}, {},
                                                   current_skill)["required"] if r["key"] == phrase_key)
    assert row["status"] == "matched" and "group" in row and not row["via"].get("group")


def test_the_top_up_counts_a_group_as_one_requirement():
    group = {"name": "use programming languages", "key": normalise_skill("use programming languages")[0], "type": "essential",
             "source": "role_map", "label": "Kotlin (use programming languages)", "phrase": "use programming languages",
             "alternatives": [{"name": "Kotlin", "key": "kotlin"}, {"name": "Java", "key": "java"}]}
    others = [{"name": n, "key": normalise_skill(n)[0], "type": t} for n, t in
              [("Git", "essential"), ("SQL", "essential")] + [(f"skill {i}", "optional") for i in range(12)]]
    with_group = scoring.split_required(profession([group] + others))
    without = scoring.split_required(profession([{k: group[k] for k in ("name", "key", "type")}] + others))
    assert len(with_group[0]) == len(without[0]) == scoring.MIN_REQUIRED
    assert [s["key"] for s in with_group[0]] == [s["key"] for s in without[0]]


# ── the validator ─────────────────────────────────────────────────────────────
def test_the_validator_reports_every_rule():
    good = role_map()
    reference = {"occupations": {OCC}, "skills": {UPL, THINK}, "relations": {(OCC, UPL), (OCC, THINK)}}
    assert esco_role_map.validate(good, **reference) == []
    bad = role_map([
        {"occupation_uri": OCC, "skill_uri": UPL, "skills": ["Kotlin", "Klingon Script"]},
        {"occupation_uri": OCC, "skill_uri": UPL, "skills": []},
        {"occupation_uri": OCC, "skill_uri": THINK, "skills": ["Java"] * 2},
        {"occupation_uri": OCC, "skill_uri": DBG, "skills": ["Python", "Java", "Kotlin", "Swift", "C", "C++", "Go", "Rust", "Ruby"]},
        {"occupation_uri": OCC + "x", "skill_uri": THINK, "skills": ["Java"]},
        {"occupation_uri": OCC, "skill_uri": "http://data.europa.eu/esco/skill/none", "skills": ["Java"]},
        {"occupation_uri": OCC, "skills": ["Java"]},
    ])
    errors = " | ".join(esco_role_map.validate(bad, occupations={OCC}, skills={UPL, THINK, DBG},
                                               relations={(OCC, UPL), (OCC, THINK)}))
    for expected in ("'Klingon Script' is not in the skill list", "duplicate pair", "repeated skill", "9 skills (max 8)",
                     "occupation URI not in the active ESCO data", "skill URI not in the ESCO data",
                     "no longer lists this skill", "occupation_uri and skill_uri are required"):
        assert expected in errors, expected


def test_an_invalid_map_fails_the_import(tmp_path):
    with pytest.raises(esco_role_map.RoleMapError):
        parse_esco(dataset(tmp_path), "1.2.1", role_map=role_map([{"occupation_uri": OCC, "skill_uri": UPL,
                                                                   "skills": ["Not A Skill"]}]))


def test_the_real_map_is_valid_build_check():
    path = Path(__file__).resolve().parents[2] / "scripts" / "check_esco_role_map.py"
    spec = importlib.util.spec_from_file_location("check_esco_role_map", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.check() == []
    doc = esco_role_map.read_map()
    assert all(len(e["skills"]) <= esco_role_map.MAX_SKILLS for e in doc["entries"])
    assert sum(1 for e in doc["entries"] if e["skills"]) == 846


# ── pipeline: drift, preview, post-check, publish, snapshot / restore ─────────
@pytest.fixture
def live_map(db, tmp_path, monkeypatch):  # noqa: F811
    """The map file in the test's data folder (the one snapshots copy and restore)."""
    path = snapshots.DATA_DIR / esco_role_map.MAP_FILE.name
    path.write_text(json.dumps(role_map()), encoding="utf8")
    monkeypatch.setattr(esco_role_map, "MAP_FILE", path)
    esco_role_map.reload_role_map()
    yield path
    esco_role_map.reload_role_map()


async def test_uri_drift_after_a_reimport(db, checks, live_map, tmp_path):  # noqa: F811
    job = await previewed(db, "esco", dataset(tmp_path / "v1"))
    summary = job["diff_summary"]["role_map"]
    assert summary["live_adjusted"] == 0 and summary["staged_adjusted"] == 1 and not summary["dropped"]
    assert [OCC, DBG] in summary["essential_not_in_map_examples"]  # "debug software" is not in the map: shown in the preview
    await publishing.start_publish(job["job_id"], db=db, wait=True)
    assert (await jobs.get_job(job["job_id"], db))["status"] == jobs.PUBLISHED
    # A re-import where ESCO no longer lists the mapped phrase: the entry is stale and the drop is shown.
    job = await previewed(db, "esco", dataset(tmp_path / "v2", drop=(UPL,)))
    summary = job["diff_summary"]["role_map"]
    assert summary["live_adjusted"] == 1 and summary["staged_adjusted"] == 0 and summary["dropped"]
    assert summary["stale_entries"] == 1 and summary["stale_mapped_entries"] == 1
    # The validator (build check) reports the drifted URI against the new data.
    data = dataset(tmp_path / "v3", drop=(UPL,))
    spec = importlib.util.spec_from_file_location("check_map", Path(__file__).resolve().parents[2] / "scripts" / "check_esco_role_map.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    errors = esco_role_map.validate(role_map(), **dict(zip(("occupations", "skills", "relations"), module.raw_reference(data))))
    assert any("no longer lists this skill" in e for e in errors)


async def test_publishing_applies_the_map_and_never_edits_it(db, checks, live_map, tmp_path):  # noqa: F811
    before = live_map.read_bytes()
    job = await previewed(db, "esco", dataset(tmp_path))
    await publishing.start_publish(job["job_id"], db=db, wait=True)
    job = await jobs.get_job(job["job_id"], db)
    assert job["status"] == jobs.PUBLISHED
    assert job["post_publish_checks"]["role_map"] == {"adjusted": 1, "expected": 1, "ok": True}
    assert live_map.read_bytes() == before
    dev = next(d for d in await docs(db, "professions") if d["profession_id"] == "esco:dev-0001")
    assert [s["label"] for s in dev["skills"] if esco_role_map.is_group(s)] == ["Kotlin / Java / Python / … (use programming languages)"]


async def test_an_unexpected_drop_fails_the_post_check_and_rolls_back(db, checks, live_map, tmp_path, monkeypatch):  # noqa: F811
    job = await previewed(db, "esco", dataset(tmp_path))
    real = snapshots.role_map_adjusted

    async def fewer(database, collection=snapshots.PROFESSIONS):
        return max(0, await real(database, collection) - 1)

    monkeypatch.setattr(snapshots, "role_map_adjusted", fewer)
    await publishing.start_publish(job["job_id"], db=db, wait=True)
    job = await jobs.get_job(job["job_id"], db)
    assert job["status"] == jobs.ROLLED_BACK and "ESCO requirement groups" in job["error"]


async def test_snapshot_and_restore_include_the_map(db, checks, live_map, tmp_path):  # noqa: F811
    job = await previewed(db, "esco", dataset(tmp_path))
    await publishing.start_publish(job["job_id"], db=db, wait=True)
    original = live_map.read_bytes()
    snap = await snapshots.create_snapshot(db, created_by="test", reason="publish")
    manifest = json.loads((Path(snap["path"]) / "manifest.json").read_text(encoding="utf8"))
    assert f"data/{live_map.name}" in manifest and snap["counts"]["role_map_adjusted"] == 1
    old_hash = esco_role_map.map_hash()
    live_map.write_text(json.dumps(role_map([])), encoding="utf8")  # the map changed after the snapshot
    esco_role_map.reload_role_map()
    assert esco_role_map.map_hash() != old_hash
    record = await publishing.restore(snap["snapshot_id"], actor="test", db=db)
    assert record["status"] == publishing.RESTORED, record.get("error")
    assert live_map.read_bytes() == original and esco_role_map.map_hash() == old_hash  # restored and reloaded
    assert record["result"]["post_restore_checks"]["role_map"]["ok"]


async def test_the_career_match_cache_key_follows_the_map(live_map, monkeypatch):
    async def fingerprint(_db):
        return "fixed"

    monkeypatch.setattr(pipeline, "live_fingerprint", fingerprint)
    skills = owned("Kotlin")
    first = await service.cache_key(skills, None)
    assert await service.cache_key(skills, None) == first
    live_map.write_text(json.dumps(role_map([])), encoding="utf8")
    esco_role_map.reload_role_map()
    assert await service.cache_key(skills, None) != first  # old results refresh
