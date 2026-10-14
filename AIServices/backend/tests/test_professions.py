"""09b: profession database (O*NET + ESCO importers, CRUD) and the role-skill FAISS index."""

import shutil
from pathlib import Path

import httpx
import numpy as np
import pytest
from fastapi import FastAPI

from app.config.settings import settings
from app.services.embeddings import model as model_module
from app.services.embeddings.model import READY, l2_normalise
from app.services.professions import cleaning
from app.services.professions.categories import categorise
from app.services.professions.csv_io import DatasetError, read_rows, resolve_file, split_labels, validate_files
from app.services.professions.esco import parse_esco
from app.services.professions.imports import preview_import, publish_import
from app.services.professions.onet import parse_onet
from app.services.professions.role_index import (
    INDEX_FILE,
    META_FILE,
    NO_PROFESSIONS,
    READY as INDEX_READY,
    IndexUnavailable,
    RoleSkillIndex,
    ThresholdUnavailable,
    use_role_index,
)
from app.services.professions.store import (
    PROFESSIONS,
    active_sources,
    dedupe_skills,
    ensure_profession_indexes,
    make_skill,
)
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture

FIXTURES = Path(__file__).parent / "fixtures"
ONET = FIXTURES / "onet"
ESCO = FIXTURES / "esco"


@pytest.fixture
def index(tmp_path):
    idx = RoleSkillIndex(tmp_path / "index")
    use_role_index(idx)
    yield idx
    use_role_index(None)


@pytest.fixture
async def db(real_db, index):  # noqa: F811
    await ensure_profession_indexes(real_db)
    yield real_db
    await index.wait_idle()


# ── CSV access ───────────────────────────────────────────────────────────────
def test_resolve_file_accepts_en_suffix_and_plain_names():
    assert resolve_file(ESCO, "occupations").name == "occupations_en.csv"
    assert resolve_file(ESCO, "skills").name == "skills.csv"
    assert resolve_file(ESCO, "nothing") is None


def test_validate_files_lists_every_missing_file_and_column(tmp_path):
    shutil.copy(ONET / "occupation_data.csv", tmp_path / "occupation_data.csv")
    (tmp_path / "job_titles.csv").write_text("O*NET-SOC Code,Title\n", encoding="utf8")
    with pytest.raises(DatasetError) as err:
        validate_files(tmp_path, {
            "occupation_data": ["O*NET-SOC Code", "Title"],
            "job_titles": ["O*NET-SOC Code", "Job Title"],
            "software_skills": ["Workplace Example"],
        }, suffixes=("",))
    message = str(err.value)
    assert "job_titles.csv: missing column(s) ['Job Title']" in message
    assert "missing file: software_skills.csv" in message


def test_validate_files_missing_folder(tmp_path):
    with pytest.raises(DatasetError, match="Dataset folder not found"):
        validate_files(tmp_path / "nope", {"x": []})


def test_bom_and_multiline_fields_are_read_by_header():
    assert (ONET / "occupation_data.csv").read_bytes().startswith(b"\xef\xbb\xbf")
    first = next(read_rows(ONET / "occupation_data.csv"))
    assert first["O*NET-SOC Code"] == "11-1011.00"  # no BOM in the header name
    dev = next(r for r in read_rows(ESCO / "occupations_en.csv") if r["preferredLabel"] == "software developer")
    assert split_labels(dev["altLabels"]) == ["software engineer", "programmer", "software developer", "application developer"]


# ── Label cleaning ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("label, expected", [
    ("Microsoft Excel", "Excel"),
    ("Oracle Java", "Java"),
    ("Apache Kafka", "Kafka"),
    ("Amazon Web Services AWS software", "AWS"),
    ("JavaScript Object Notation JSON", "JSON"),
    ("Hypertext markup language HTML", "HTML"),
    ("Extensible markup language XML", "XML"),
    ("SAS software", "SAS"),
    ("The MathWorks MATLAB", "MATLAB"),
    ("Jenkins CI", "Jenkins"),
    ("Epic Systems", "Epic Systems"),  # unknown: kept as its own skill
])
def test_clean_onet_label(label, expected):
    assert cleaning.clean_onet_label(label) == expected


@pytest.mark.parametrize("label, expected", [
    ("Python (computer programming)", "Python"),
    ("JavaScript", "JavaScript"),
    ("define technical requirements", "define technical requirements"),
])
def test_clean_esco_label(label, expected):
    assert cleaning.clean_esco_label(label) == expected


def test_esco_qualifier_kept_when_base_is_unknown():
    assert cleaning.clean_esco_label("Frobnicate (computer programming)") == "Frobnicate (computer programming)"


# ── Store rules ──────────────────────────────────────────────────────────────
def test_dedupe_keeps_strongest_type():
    skills = dedupe_skills([
        make_skill("Python", "optional", "Python"),
        make_skill("python", "technology", "python", hot=False),
        make_skill("Python", "technology", "Python", hot=True),
        make_skill("Python", "essential", "Python (computer programming)"),
        make_skill("Git", "optional", "Git"),
        make_skill("Git", "technology", "Git", in_demand=False),
    ])
    assert [(s["name"], s["type"]) for s in skills] == [("Python", "essential"), ("Git", "technology")]


def test_active_sources(monkeypatch):
    monkeypatch.setattr(settings, "PROFESSION_SOURCES", "esco, ONET,unknown")
    assert active_sources() == ["onet", "esco"]


def test_categorise_uses_most_specific_prefix_then_keywords():
    assert categorise("onet", "15-1252.00", "Software Developers") == "Development"
    assert categorise("onet", "15-1211.01", "Health Informatics Specialists") == "Data & AI"
    assert categorise("esco", "2512", "software developer") == "Development"
    assert categorise("manual", "", "Chief Banana Officer") == "Other"


# ── O*NET importer ───────────────────────────────────────────────────────────
def onet_docs(**kwargs):
    return {d["source_code"]: d for d in parse_onet(ONET, "31.0", **kwargs)["docs"]}


def test_onet_selects_soc_prefixes_and_excludes_catch_all():
    result = parse_onet(ONET, "31.0")
    codes = [d["source_code"] for d in result["docs"]]
    assert codes == ["15-1252.00", "15-1255.00", "15-2051.00"]
    assert result["stats"]["occupations_excluded"] == [{"code": "15-1299.00", "title": "Computer Occupations, All Other"}]


def test_onet_document_shape():
    dev = onet_docs()["15-1252.00"]
    assert dev["profession_id"] == "onet:15-1252.00"
    assert dev["source"] == "onet" and dev["source_version"] == "O*NET 31.0"
    assert dev["category"] == "Development"
    assert dev["description"].startswith("Research, design")
    # Job Title + Short Title, case-insensitive dedupe, never the title itself.
    assert dev["alt_titles"] == ["Software Engineer", "Application Developer", "App Developer"]
    assert dev["active"] is True


def test_onet_keeps_only_hot_or_in_demand_ordered_in_demand_first():
    dev = onet_docs()["15-1252.00"]
    names = [s["name"] for s in dev["skills"]]
    assert "Excel" not in names  # neither hot nor in demand
    assert names[:3] == ["Python", "Docker", "React"]  # in-demand first
    assert all(s["type"] == "technology" for s in dev["skills"])
    java = next(s for s in dev["skills"] if s["name"] == "Java")
    assert java["original_label"] == "Oracle Java"
    assert java["element_name"] == "Object or component oriented development software"
    assert (java["hot"], java["in_demand"]) == (True, False)


def test_onet_skill_cap():
    dev = onet_docs(cap=3)["15-1252.00"]
    assert [s["name"] for s in dev["skills"]] == ["Python", "Docker", "React"]


def test_onet_fewer_than_five_skills_is_inactive():
    designer = onet_docs()["15-1255.00"]
    assert designer["active"] is False
    assert "only 2 skills" in designer["inactive_reason"]


def test_onet_exclude_is_configurable():
    assert "15-1299.00" in onet_docs(exclude=[])


def test_onet_missing_column_is_reported(tmp_path):
    for name in ("occupation_data.csv", "job_titles.csv"):
        shutil.copy(ONET / name, tmp_path / name)
    (tmp_path / "software_skills.csv").write_text("O*NET-SOC Code,Example\n", encoding="utf8")
    with pytest.raises(DatasetError, match="software_skills.csv: missing column"):
        parse_onet(tmp_path, "31.0")


# ── ESCO importer ────────────────────────────────────────────────────────────
def test_esco_parse():
    result = parse_esco(ESCO, "1.2.1")
    docs = {d["source_code"]: d for d in result["docs"]}
    assert set(docs) == {"2512.4", "2511.1"}  # chef (ISCO 3434) is not ICT
    dev = docs["2512.4"]
    assert dev["profession_id"] == "esco:dev-0001"
    assert dev["alt_titles"] == ["software engineer", "programmer", "application developer"]
    skills = {s["name"]: s for s in dev["skills"]}
    assert skills["Python"]["type"] == "essential"  # essential beats the optional relation
    assert skills["Python"]["original_label"] == "Python (computer programming)"
    assert skills["SQL"]["type"] == "optional"
    assert dev["active"] is True
    assert docs["2511.1"]["active"] is False  # 2 skills


def test_esco_stats_and_all_skills():
    result = parse_esco(ESCO, "1.2.1")
    stats = result["stats"]
    assert stats["relations"] == {"essential": 5, "optional": 4}
    assert stats["skill_type_counts"] == {"knowledge": 5, "skill/competence": 3}
    assert stats["digital_skills_used"] == 3
    assert stats["occupations_per_isco_group"] == {"251": 2}
    # Every skill in the file (not only the used ones), duplicates collapsed to the newest row.
    assert stats["esco_skills_total"] == 9 and stats["esco_skill_duplicate_rows"] == 1
    agile = next(s for s in result["esco_skills"] if s["label"] == "agile project management")
    assert agile["description"] == "The agile project management approach."
    python = next(s for s in result["esco_skills"] if s["label"].startswith("Python"))
    assert python["digital"] is True and python["alt_labels"] == ["Python"]
    assert any(name == "define technical requirements" for name, _ in stats["top_undescribed_skills"])


def test_esco_missing_file(tmp_path):
    shutil.copy(ESCO / "occupations_en.csv", tmp_path / "occupations_en.csv")
    with pytest.raises(DatasetError) as err:
        parse_esco(tmp_path, "1.2.1")
    assert "skills_en.csv or skills.csv" in str(err.value)
    assert "occupationSkillRelations" in str(err.value)


# ── Stub embedder with controlled geometry ───────────────────────────────────
class StubEmbedder:
    """Vectors from a table keyed by skill name (the text before ':'); unknown names are random."""

    model_name = "stub/geometry"

    def __init__(self, table, dimension=8):
        self.dimension = dimension
        self.table = {k.lower(): np.asarray(v, dtype=np.float32) for k, v in table.items()}
        self.ready_event = None

    ready = True
    state = READY

    def embed_texts(self, texts):
        rows = []
        for text in texts:
            name = text.split(":", 1)[0].strip().lower()
            vec = self.table.get(name)
            if vec is None:
                seed = abs(hash(name)) % (2**32)
                vec = np.random.default_rng(seed).standard_normal(self.dimension)
            rows.append(np.pad(vec, (0, self.dimension - len(vec))))
        return l2_normalise(np.array(rows))

    def health(self):
        return {"state": READY, "model": self.model_name, "dimension": self.dimension}


def unit(*values):
    v = np.zeros(8, dtype=np.float32)
    v[: len(values)] = values
    return v / np.linalg.norm(v)


@pytest.fixture
def stub(monkeypatch):
    embedder = StubEmbedder({
        "React": unit(1, 0, 0, 0),
        "Vue.js": unit(0.9, 0, 0, 0.436),       # 0.90 to React
        "Python": unit(0, 1, 0, 0),
        "Django": unit(0, 0.8, 0, 0, 0.6),      # 0.80 to Python
        "Excel": unit(0, 0, 1, 0),              # unrelated
    })
    model_module.use_embedder(embedder)
    monkeypatch.setattr(settings, "EMBEDDING_MODEL", embedder.model_name)
    monkeypatch.setattr(settings, "EMBEDDING_THRESHOLD_MODEL", embedder.model_name)
    monkeypatch.setattr(settings, "EMBEDDING_RELATED_THRESHOLD", 0.73)
    yield embedder
    model_module.use_embedder(None)


async def add_manual(db, pid, title, names, active=True):
    from app.services.professions.store import profession_doc

    doc = profession_doc(profession_id=pid, title=title, alt_titles=[], description="", category="Other",
                         source="manual", source_code="", source_version="manual",
                         skills=[make_skill(n, "essential", n) for n in names])
    doc["active"] = active
    await db[PROFESSIONS].insert_one(doc)


# ── Import services (real ai_db_test) ────────────────────────────────────────
async def test_preview_writes_nothing_and_lists_added(db):
    report = await preview_import("onet", ONET, "31.0", db=db)
    assert report.ok and report.mode == "preview"
    assert report.added == ["onet:15-1252.00", "onet:15-1255.00", "onet:15-2051.00"]
    assert report.occupations == 3 and report.active == 2 and report.inactive == 1
    assert report.warnings and "fewer than 5 skills" in report.warnings[0]
    assert report.stats["occupations_excluded"][0]["code"] == "15-1299.00"
    assert await db[PROFESSIONS].count_documents({}) == 0


async def test_preview_reports_validation_errors(db, tmp_path):
    report = await preview_import("onet", tmp_path, "31.0", db=db)
    assert report.ok is False
    assert "missing file: occupation_data.csv" in report.errors[0]
    bad = await preview_import("linkedin", ONET, "1", db=db)
    assert bad.ok is False and "Unknown source" in bad.errors[0]


async def test_publish_then_preview_shows_unchanged(db, index):
    published = await publish_import("onet", ONET, "31.0", actor="admin-1", db=db)
    assert published.ok, published.errors
    assert published.written["inserted"] == 3
    assert await db[PROFESSIONS].count_documents({"source": "onet"}) == 3
    assert published.index["state"] == INDEX_READY
    log = await db["profession_imports"].find_one({})
    assert log["actor"] == "admin-1" and log["source"] == "onet"

    again = await preview_import("onet", ONET, "31.0", db=db)
    assert again.added == [] and again.updated == [] and again.unchanged == 3


async def test_publish_deactivates_professions_missing_from_dataset(db, monkeypatch):
    await publish_import("onet", ONET, "31.0", db=db, rebuild=False)
    monkeypatch.setattr(settings, "ONET_SOC_PREFIXES", "15-12")  # drops 15-2051 (Data Scientists)
    preview = await preview_import("onet", ONET, "31.0", db=db)
    assert preview.removed == ["onet:15-2051.00"]
    await publish_import("onet", ONET, "31.0", db=db, rebuild=False)
    gone = await db[PROFESSIONS].find_one({"profession_id": "onet:15-2051.00"})
    assert gone["active"] is False and gone["inactive_reason"] == "not in O*NET 31.0"


async def test_publish_esco_stores_all_skills(db):
    report = await publish_import("esco", ESCO, "1.2.1", db=db, rebuild=False)
    assert report.ok
    assert await db["esco_skills"].count_documents({}) == 9
    assert report.written["esco_descriptions_loaded"] == 0  # ESCO_DESCRIPTIONS_ENABLED=false


async def test_esco_descriptions_provider_when_enabled(db, monkeypatch):
    from app.services.embeddings.descriptions import get_description_provider, use_description_provider

    monkeypatch.setattr(settings, "ESCO_DESCRIPTIONS_ENABLED", True)
    try:
        report = await publish_import("esco", ESCO, "1.2.1", db=db, rebuild=False)
        assert report.written["esco_descriptions_loaded"] == 9
        provider = get_description_provider()
        assert provider.lookup("Python").source == "curated"  # curated wins
        found = provider.lookup("define technical requirements")
        assert found.source == "esco" and found.description == "Specify technical properties."
    finally:
        use_description_provider(None)


async def test_admin_deactivation_survives_reimport(db):
    await publish_import("onet", ONET, "31.0", db=db, rebuild=False)
    await db[PROFESSIONS].update_one({"profession_id": "onet:15-1252.00"},
                                     {"$set": {"active": False, "inactive_reason": "disabled by admin", "disabled_by_admin": True}})
    await publish_import("onet", ONET, "31.0", db=db, rebuild=False)
    doc = await db[PROFESSIONS].find_one({"profession_id": "onet:15-1252.00"})
    assert doc["active"] is False and doc["inactive_reason"] == "disabled by admin"


async def test_profession_sources_filter_the_index(db, index, monkeypatch):
    await publish_import("onet", ONET, "31.0", db=db, rebuild=False)
    await publish_import("esco", ESCO, "1.2.1", db=db, rebuild=False)
    monkeypatch.setattr(settings, "PROFESSION_SOURCES", "esco")
    await index.rebuild(db)
    assert {r["profession_id"] for k in index.snapshot.keys for r in index.roles_for_skill(k)} == {"esco:dev-0001"}


# ── Role-skill index ─────────────────────────────────────────────────────────
async def test_index_states_without_professions(db, index):
    with pytest.raises(IndexUnavailable) as err:
        index.roles_for_skill("python")
    assert err.value.code == "INDEX_BUILDING"
    assert await index.rebuild(db) == NO_PROFESSIONS
    with pytest.raises(IndexUnavailable) as err:
        index.search_related(["python"], np.zeros((1, 384), dtype=np.float32))
    assert err.value.code == "NO_PROFESSIONS"


async def test_index_build_persist_and_reload(db, index):
    await publish_import("onet", ONET, "31.0", db=db, rebuild=False)
    assert await index.rebuild(db) == INDEX_READY
    meta = index.snapshot.meta
    assert meta["count"] == 12  # 7 + 6 skills of the 2 active O*NET professions, Python shared
    assert meta["dim"] == 384 and meta["model"] == "fake/hash-embedder" and meta["text_mode"] == "description"
    assert (index.dir / INDEX_FILE).is_file() and (index.dir / META_FILE).is_file()
    assert {r["profession_id"] for r in index.roles_for_skill("python")} == {"onet:15-1252.00", "onet:15-2051.00"}
    assert index.roles_for_skill("python")[0]["type"] == "technology"

    fresh = RoleSkillIndex(index.dir)
    assert await fresh.load_or_build(db) == INDEX_READY
    assert fresh.last_build_seconds is None  # loaded from disk, not rebuilt
    assert fresh.snapshot.keys == index.snapshot.keys
    assert np.allclose(fresh.snapshot.matrix, index.snapshot.matrix)

    # A changed profession invalidates the saved index → rebuilt.
    await add_manual(db, "manual:x", "Extra", ["Rust", "Go", "Kotlin", "Swift", "Elixir"])
    stale = RoleSkillIndex(index.dir)
    assert await stale.load_or_build(db) == INDEX_READY
    assert stale.last_build_seconds is not None
    assert "rust" in stale.snapshot.position


async def test_inactive_professions_are_not_indexed(db, index):
    await add_manual(db, "manual:a", "A", ["React", "Python", "Excel", "Django", "Vue.js"])
    await add_manual(db, "manual:b", "B", ["Haskell", "Erlang", "OCaml", "Prolog", "Lisp"], active=False)
    await index.rebuild(db)
    assert "haskell" not in index.snapshot.position and "react" in index.snapshot.position


async def test_search_related(db, index, stub):
    await add_manual(db, "manual:web", "Web developer", ["React", "Vue.js", "Python", "Django", "Excel"])
    await index.rebuild(db)
    user_keys = ["react", "python"]
    matrix = stub.embed_texts(["React", "Python"])
    results = index.search_related(user_keys, matrix)
    pairs = {(r["user_key"], r["role_key"]): r for r in results}
    assert set(pairs) == {("react", "vue.js"), ("python", "django")}  # owned keys excluded, Excel unrelated
    assert pairs[("react", "vue.js")]["similarity"] == pytest.approx(0.9, abs=1e-3)
    assert all(r["mutual_nn"] for r in results)
    assert results[0]["role_key"] == "vue.js"  # sorted by similarity


async def test_mutual_nearest_neighbour_flag(db, index, stub, monkeypatch):
    stub.table["a skill"] = unit(0.95, 0.312)   # 0.95 to React, 0.31 to Python
    stub.table["b skill"] = unit(0.8, 0.6)      # 0.80 to React, 0.60 to Python
    await add_manual(db, "manual:m", "M", ["A skill", "B skill", "Excel", "Haskell", "Erlang"])
    await index.rebuild(db)
    monkeypatch.setattr(settings, "MUTUAL_NN_K", 1)
    results = index.search_related(["react", "python"], stub.embed_texts(["React", "Python"]))
    flags = {r["role_key"]: r["mutual_nn"] for r in results if r["user_key"] == "react"}
    assert flags == {"a skill": True, "b skill": False}  # B is not React's single nearest role skill


async def test_search_refuses_unmeasured_threshold(db, index):
    await add_manual(db, "manual:a", "A", ["React", "Python", "Excel", "Django", "Vue.js"])
    await index.rebuild(db)
    with pytest.raises(ThresholdUnavailable):
        index.search_related(["react"], np.ones((1, 384), dtype=np.float32))


async def test_rebuild_waits_for_model_without_breaking(db, index, fake_embedder):
    await add_manual(db, "manual:a", "A", ["React", "Python", "Excel", "Django", "Vue.js"])
    fake_embedder.set_ready(False)
    state = await index.rebuild(db, wait_for_model=False)
    assert state == "waiting_for_model" and index.snapshot is None
    fake_embedder.set_ready(True)
    assert await index.rebuild(db) == INDEX_READY


# ── Internal CRUD routes ─────────────────────────────────────────────────────
KEY = {"X-Internal-Key": "k-prof"}


@pytest.fixture
def client(db, monkeypatch):
    from app.routes import profession_routes

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "k-prof")
    app = FastAPI()
    app.include_router(profession_routes.router)
    from app.middleware.validation import register_validation_error_handler

    register_validation_error_handler(app)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost")


async def test_routes_require_internal_key(client):
    async with client as c:
        assert (await c.get("/internal/professions")).status_code == 401
        assert (await c.post("/internal/index/rebuild", headers={"X-Internal-Key": "nope"})).status_code == 403


async def test_crud_manual_profession(client, db, index):
    async with client as c:
        body = {"title": "Platform Engineer", "category": "Infrastructure & Cloud", "description": "Builds platforms",
                "alt_titles": ["Platform Dev", " platform dev ", ""], "actor": "admin-1",
                "skills": [{"name": "Kubernetes"}, {"name": "Terraform"}, {"name": "Go", "type": "optional"},
                           {"name": "AWS", "type": "technology"}, {"name": "Linux"}]}
        res = await c.post("/internal/professions", json=body, headers=KEY)
        assert res.status_code == 201, res.text
        created = res.json()["data"]
        pid = created["profession_id"]
        assert pid.startswith("manual:") and created["source"] == "manual" and created["active"] is True
        assert created["alt_titles"] == ["Platform Dev", "platform dev"]
        assert created["created_by"] == "admin-1"

        dup = await c.post("/internal/professions", json={**body, "title": "platform engineer"}, headers=KEY)
        assert dup.status_code == 409 and dup.json()["code"] == "DUPLICATE_PROFESSION"

        bad = await c.post("/internal/professions", json={"title": "X"}, headers=KEY)
        assert bad.status_code == 422 and bad.json()["code"] == "VALIDATION_ERROR"
        bad_cat = await c.post("/internal/professions", json={"title": "Some role", "category": "Cooking"}, headers=KEY)
        assert bad_cat.status_code == 400

        listed = (await c.get("/internal/professions", params={"search": "platform"}, headers=KEY)).json()
        assert listed["pagination"]["total"] == 1 and listed["data"][0]["profession_id"] == pid

        upd = await c.patch(f"/internal/professions/{pid}", json={"skills": [{"name": "Go"}]}, headers=KEY)
        assert upd.status_code == 200
        assert upd.json()["data"]["active"] is False  # 1 skill < 5

        deleted = await c.delete(f"/internal/professions/{pid}", headers=KEY)
        assert deleted.status_code == 200 and deleted.json()["data"]["inactive_reason"] == "deleted by admin"
        assert await db[PROFESSIONS].count_documents({"profession_id": pid}) == 1  # soft delete

        missing = await c.get("/internal/professions/manual:none", headers=KEY)
        assert missing.status_code == 404 and missing.json()["code"] == "NOT_FOUND"


async def test_imported_professions_only_allow_category_and_active(client, db):
    await publish_import("onet", ONET, "31.0", db=db, rebuild=False)
    async with client as c:
        locked = await c.patch("/internal/professions/onet:15-1252.00", json={"title": "Coders"}, headers=KEY)
        assert locked.status_code == 409 and locked.json()["code"] == "IMPORTED_PROFESSION"
        ok = await c.patch("/internal/professions/onet:15-1252.00", json={"category": "Data & AI"}, headers=KEY)
        assert ok.status_code == 200 and ok.json()["data"]["category"] == "Data & AI"

        page = (await c.get("/internal/professions", params={"source": "onet", "limit": 2, "page": 2}, headers=KEY)).json()
        assert page["pagination"] == {"page": 2, "limit": 2, "total": 3, "pages": 2}
        active = (await c.get("/internal/professions", params={"active": "false"}, headers=KEY)).json()
        assert [p["profession_id"] for p in active["data"]] == ["onet:15-1255.00"]

    # The admin's category survives a re-import.
    await publish_import("onet", ONET, "31.0", db=db, rebuild=False)
    assert (await db[PROFESSIONS].find_one({"profession_id": "onet:15-1252.00"}))["category"] == "Data & AI"


async def test_rebuild_route(client, db, index):
    await add_manual(db, "manual:a", "A", ["React", "Python", "Excel", "Django", "Vue.js"])
    async with client as c:
        res = await c.post("/internal/index/rebuild", params={"wait": "true"}, headers=KEY)
        assert res.status_code == 200 and res.json()["index"]["state"] == INDEX_READY
        assert res.json()["index"]["count"] == 5
        status = (await c.get("/internal/index/status", headers=KEY)).json()
        assert status["index"]["count"] == 5
