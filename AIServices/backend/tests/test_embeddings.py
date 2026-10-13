"""
Skill embeddings (Module 2 FE-4/FE-5): normalisation, vector cache, parse-time
embeddings, user skill profiles, internal + user APIs, re-embedding.
Uses the deterministic fake embedder (conftest) and a real throwaway MongoDB.
"""

import asyncio
from unittest.mock import AsyncMock

import httpx
import numpy as np
import pytest
from fastapi import FastAPI

from app.middleware.auth import get_current_user
from app.middleware.validation import register_validation_error_handler
from app.routes import cv_routes, embedding_routes, internal_routes
from app.services import core_client
from app.services.embeddings import model as model_module
from app.services.embeddings.fake import FakeEmbedder
from app.services.embeddings.normalise import normalise_skill, normalise_skills
from app.services.embeddings.descriptions import build_embed_text
from app.services.embeddings.reembed import reembed_all
from app.services.embeddings.user_profiles import (
    EmbeddingsPending,
    get_user_skill_matrix,
    process_pending,
    upsert_user_skills,
    wait_for_background,
)
from app.services.embeddings.vector_store import ensure_embedding_indexes, get_skill_vectors
from tests.cv_fixtures import SAMPLE_CV_LINES, make_pdf
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture

USER_A = "507f1f77bcf86cd799439011"
USER_B = "507f1f77bcf86cd799439022"
KEY = {"X-Internal-Key": "test-internal-key"}


def texts(names):
    """What is embedded for each canonical name (description mode)."""
    return [build_embed_text(n).text for n in names]


@pytest.fixture
async def db(real_db):  # noqa: F811
    await ensure_embedding_indexes(real_db)
    return real_db


def app_for(user_id=USER_A):
    app = FastAPI()
    register_validation_error_handler(app)
    app.include_router(cv_routes.router)
    app.include_router(embedding_routes.router)
    app.include_router(internal_routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"user_id": user_id, "role": "JobSeeker"}
    return app


def client(user_id=USER_A):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app_for(user_id)), base_url="http://localhost")


async def put_skills(user_id, skills, requested_at=None):
    async with client() as c:
        body = {"skills": skills, **({"requestedAt": requested_at} if requested_at is not None else {})}
        return await c.put(f"/internal/embeddings/users/{user_id}", json=body, headers=KEY)


# ── Normalisation ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("name", ["ReactJS", "react.js", "React", "  react   JS ", "REACT"])
def test_react_variants_share_one_key(name):
    assert normalise_skill(name) == ("react", "React")


def test_an_alias_alone_is_stored_under_its_canonical_name():
    # "ReactJS" with no "React" anywhere still becomes "React" (aliased skills are canonical).
    assert normalise_skills(["ReactJS"]) == [("react", "React")]
    assert normalise_skills(["nodejs", "k8s", "sklearn"]) == [
        ("node.js", "Node.js"), ("kubernetes", "Kubernetes"), ("scikit learn", "Scikit-learn"),
    ]


@pytest.mark.parametrize(
    "name, expected",
    [
        ("JS", ("javascript", "JavaScript")),
        ("ts", ("typescript", "TypeScript")),
        ("Node JS", ("node.js", "Node.js")),
        ("express", ("express.js", "Express.js")),
        ("postgres", ("postgresql", "PostgreSQL")),
        ("Mongo", ("mongodb", "MongoDB")),
        ("ML", ("machine learning", "Machine Learning")),
        ("nlp", ("natural language processing", "Natural Language Processing")),
        ("GCP", ("google cloud", "Google Cloud")),
        ("ci / cd", ("ci/cd", "CI/CD")),
        ("cicd", ("ci/cd", "CI/CD")),
        ("HTML5", ("html", "HTML")),
        ("css3", ("css", "CSS")),
        ("VueJS", ("vue.js", "Vue.js")),
        ("tf", ("tensorflow", "TensorFlow")),
        ("scikit learn", ("scikit learn", "Scikit-learn")),
        ("C++", ("c++", "C++")),
    ],
)
def test_aliases(name, expected):
    assert normalise_skill(name) == expected


def test_unknown_skills_keep_the_users_spelling():
    assert normalise_skill("  Muqayyim   Design\tSystem ") == ("muqayyim design system", "Muqayyim Design System")
    assert normalise_skill("data-wrangling")[0] == normalise_skill("Data Wrangling")[0]
    assert normalise_skill("") == ("", "")
    assert normalise_skill(None) == ("", "")


# ── Embedder ──────────────────────────────────────────────────────────────────
def test_vectors_are_unit_length_384_dim_float32(fake_embedder):
    v = fake_embedder.embed_texts(["React", "Accounting"])
    assert v.shape == (2, 384) and v.dtype == np.float32
    assert np.allclose(np.linalg.norm(v, axis=1), 1.0, atol=1e-5)
    assert np.array_equal(v[0], fake_embedder.embed_texts(["React"])[0])  # deterministic


def test_model_manager_never_loads_in_unit_tests():
    with pytest.raises(AssertionError):
        model_module.ModelManager().load_sync()


# ── Vector cache ──────────────────────────────────────────────────────────────
async def test_second_request_embeds_nothing(db, fake_embedder):
    first = await get_skill_vectors(["React", "reactjs", "Python"], fake_embedder, db)
    assert list(first) == ["react", "python"]
    assert fake_embedder.embedded_texts == texts(["React", "Python"])
    second = await get_skill_vectors(["react.js", "Python"], fake_embedder, db)
    assert fake_embedder.embedded_texts == texts(["React", "Python"])  # zero new embed calls
    assert np.allclose(second["react"], first["react"])
    assert await db.skill_vectors.count_documents({}) == 2
    doc = await db.skill_vectors.find_one({"key": "react"})
    assert doc["name"] == "React" and doc["model"] == fake_embedder.model_name and len(doc["vector"]) == 384


async def test_concurrent_inserts_do_not_error(db):
    a, b = FakeEmbedder(), FakeEmbedder()
    results = await asyncio.gather(*[get_skill_vectors(["Docker", "Kubernetes", "Go"], e, db) for e in (a, b, a, b)])
    assert all(set(r) == {"docker", "kubernetes", "go"} for r in results)
    assert await db.skill_vectors.count_documents({}) == 3


async def test_vectors_of_another_model_are_ignored(db, fake_embedder):
    await db.skill_vectors.insert_one({"key": "react", "name": "React", "vector": [1.0] + [0.0] * 383, "model": "other/model"})
    vectors = await get_skill_vectors(["React"], fake_embedder, db)
    assert fake_embedder.embedded_texts == texts(["React"])  # not served from the other model
    assert not np.allclose(vectors["react"][:1], [1.0])
    assert await db.skill_vectors.count_documents({"key": "react"}) == 2


async def test_misses_need_the_model(db):
    loading = FakeEmbedder(ready=False)
    with pytest.raises(model_module.ModelNotReady):
        await get_skill_vectors(["React"], loading, db)


# ── Parse-time embeddings (FE-4) ──────────────────────────────────────────────
@pytest.fixture
def parse_env(db, monkeypatch, tmp_path):
    monkeypatch.setattr(core_client, "notify_cv_status", AsyncMock(return_value=True))
    monkeypatch.setattr(cv_routes.settings, "UPLOAD_DIRECTORY", str(tmp_path))
    return db


async def parse_sample(c):
    up = await c.post("/api/cv/upload", files={"file": ("cv.pdf", make_pdf(SAMPLE_CV_LINES), "application/pdf")})
    return await c.post(f"/api/cv/parse/{up.json()['file_id']}")


async def test_parse_sets_canonical_skills_and_done(parse_env, fake_embedder):
    async with client() as c:
        res = await parse_sample(c)
    assert res.status_code == 200
    assert "embedding_status" not in res.json()  # response shape unchanged
    await wait_for_background()
    record = await parse_env.cv_parsed_data.find_one({"user_id": USER_A})
    assert record["skills_canonical"] == [s["name"] for s in record["parsed_data"]["skills"]]
    assert {"JavaScript", "Node.js", "MongoDB"} <= set(record["skills_canonical"])
    assert record["embedding_status"] == "done"
    assert await parse_env.skill_vectors.count_documents({}) == len(record["skills_canonical"])


async def test_parse_while_model_loads_is_pending_then_done(parse_env, fake_embedder):
    fake_embedder.set_ready(False)
    async with client() as c:
        res = await parse_sample(c)
    assert res.status_code == 200
    await wait_for_background()
    assert (await parse_env.cv_parsed_data.find_one({"user_id": USER_A}))["embedding_status"] == "pending"
    fake_embedder.set_ready(True)
    assert (await process_pending(fake_embedder, parse_env))["parses"] == 1
    assert (await parse_env.cv_parsed_data.find_one({"user_id": USER_A}))["embedding_status"] == "done"


async def test_embedding_failure_never_affects_the_parse(parse_env, fake_embedder, monkeypatch):
    def broken(texts):
        raise RuntimeError("model crashed")

    monkeypatch.setattr(fake_embedder, "embed_texts", broken)
    async with client() as c:
        res = await parse_sample(c)
    assert res.status_code == 200 and res.json()["parsing_status"] == "parsed"
    await wait_for_background()
    record = await parse_env.cv_parsed_data.find_one({"user_id": USER_A})
    assert record["embedding_status"] == "failed" and record["parsing_status"] == "parsed"


# ── User skill profiles (FE-5, FR-B9) ─────────────────────────────────────────
SKILLS = [
    {"name": "React", "source": "manual"},
    {"name": "Node JS", "source": "cv"},
    {"name": "Docker", "source": "github"},
]


async def test_store_skills_and_vectors(db, fake_embedder):
    res = await put_skills(USER_A, SKILLS)
    assert res.status_code == 200 and res.json() == {
        "success": True, "updated": True, "skills_count": 3, "embedding_status": "done",
    }
    record = await db.user_skill_profiles.find_one({"user_id": USER_A}, {"_id": 0})
    assert set(record) == {"user_id", "skills", "skills_hash", "model", "text_mode", "embedding_status", "requested_at", "updated_at"}
    assert record["skills"] == [
        {"name": "React", "key": "react", "source": "manual"},
        {"name": "Node.js", "key": "node.js", "source": "cv"},
        {"name": "Docker", "key": "docker", "source": "github"},
    ]
    # No profile vector and no weights anywhere.
    assert not any(k in str(record).lower() for k in ("weight", "vector", "average", "mean"))
    assert await db.skill_vectors.count_documents({}) == 3


async def test_unchanged_skills_do_no_work(db, fake_embedder):
    await put_skills(USER_A, SKILLS)
    calls = len(fake_embedder.calls)
    res = await put_skills(USER_A, list(reversed(SKILLS)))
    assert res.status_code == 200 and res.json()["updated"] is False
    assert len(fake_embedder.calls) == calls


async def test_dedupe_by_key_first_source_wins(db):
    res = await put_skills(
        USER_A,
        [
            {"name": "reactjs", "source": "github"},
            {"name": "ReactJS", "source": "cv"},
            {"name": "React", "source": "manual"},
            {"name": "react.js", "source": "cv"},
            {"name": "Python", "source": "cv"},
        ],
    )
    assert res.json()["skills_count"] == 2
    record = await db.user_skill_profiles.find_one({"user_id": USER_A})
    assert record["skills"] == [
        {"name": "React", "key": "react", "source": "manual"},
        {"name": "Python", "key": "python", "source": "cv"},
    ]


async def test_empty_list_deletes_and_delete_endpoint(db):
    await put_skills(USER_A, SKILLS)
    res = await put_skills(USER_A, [])
    assert res.json()["deleted"] is True
    assert await db.user_skill_profiles.count_documents({}) == 0
    await put_skills(USER_A, SKILLS)
    async with client() as c:
        res = await c.delete(f"/internal/embeddings/users/{USER_A}", headers=KEY)
        missing = await c.delete(f"/internal/embeddings/users/{USER_A}", headers=KEY)
        no_key = await c.delete(f"/internal/embeddings/users/{USER_A}")
    assert res.json() == {"success": True, "deleted": True}
    assert missing.json()["deleted"] is False
    assert no_key.status_code == 401
    assert await db.skill_vectors.count_documents({}) == 3  # shared cache stays


async def test_model_not_ready_is_202_pending_then_completed(db, fake_embedder):
    fake_embedder.set_ready(False)
    res = await put_skills(USER_A, SKILLS)
    assert res.status_code == 202 and res.json()["embedding_status"] == "pending"
    assert (await db.user_skill_profiles.find_one({"user_id": USER_A}))["embedding_status"] == "pending"
    with pytest.raises(EmbeddingsPending):
        await get_user_skill_matrix(USER_A, fake_embedder.model_name, db)
    fake_embedder.set_ready(True)
    assert (await process_pending(fake_embedder, db))["users"] == 1
    assert (await db.user_skill_profiles.find_one({"user_id": USER_A}))["embedding_status"] == "done"


async def test_latest_request_wins(db):
    await put_skills(USER_A, SKILLS, requested_at=2000)
    res = await put_skills(USER_A, [{"name": "Go", "source": "manual"}], requested_at=1000)
    assert res.json()["stale"] is True
    assert len((await db.user_skill_profiles.find_one({"user_id": USER_A}))["skills"]) == 3


async def test_user_skill_matrix_order(db, fake_embedder):
    assert await get_user_skill_matrix(USER_A, fake_embedder.model_name, db) == ([], [], pytest.approx(np.zeros((0, 384))))
    await put_skills(USER_A, SKILLS)
    keys, names, matrix = await get_user_skill_matrix(USER_A, fake_embedder.model_name, db)
    assert keys == ["react", "node.js", "docker"] and names == ["React", "Node.js", "Docker"]
    assert matrix.shape == (3, 384)
    assert np.allclose(matrix, fake_embedder.embed_texts(texts(names)), atol=1e-6)


async def test_internal_endpoint_validates_input(db):
    async with client() as c:
        res = await c.put(f"/internal/embeddings/users/{USER_A}", json={"skills": [{"name": "", "source": "x"}]}, headers=KEY)
    assert res.status_code == 422 and res.json()["code"] == "VALIDATION_ERROR"


# ── User API ──────────────────────────────────────────────────────────────────
async def test_me_statuses(db, fake_embedder):
    async with client() as c:
        none = (await c.get("/api/embeddings/me")).json()
        assert none["status"] == "none" and none["skills_count"] == 0 and none["model"] == fake_embedder.model_name
        fake_embedder.set_ready(False)
        await put_skills(USER_A, SKILLS)
        assert (await c.get("/api/embeddings/me")).json()["status"] == "pending"
        fake_embedder.set_ready(True)
        await process_pending(fake_embedder, db)
        ready = (await c.get("/api/embeddings/me")).json()
    assert ready["status"] == "ready" and ready["skills_count"] == 3 and ready["updated_at"]


async def test_map_needs_three_skills(db):
    await put_skills(USER_A, SKILLS[:2])
    async with client() as c:
        res = await c.get("/api/embeddings/me/map")
    assert res.status_code == 400
    assert res.json() == {"success": False, "code": "NOT_ENOUGH_SKILLS", "message": "Add at least 3 skills to see your skill map."}


async def test_map_pending_and_model_loading(db, fake_embedder):
    fake_embedder.set_ready(False)
    await put_skills(USER_A, SKILLS)
    async with client() as c:
        loading = await c.get("/api/embeddings/me/map")
        fake_embedder.set_ready(True)
        pending = await c.get("/api/embeddings/me/map")
    assert loading.status_code == 503 and loading.json()["code"] == "MODEL_LOADING"
    assert pending.status_code == 503 and pending.json()["code"] == "EMBEDDINGS_PENDING"


async def test_map_points_and_pairs_from_full_vectors(db, fake_embedder):
    skills = SKILLS + [{"name": "Python", "source": "cv"}, {"name": "Figma", "source": "manual"}]
    await put_skills(USER_A, skills)
    async with client() as c:
        body = (await c.get("/api/embeddings/me/map")).json()
    # Stored in source order manual → cv → github (dedupe order); source is display only.
    names = ["React", "Figma", "Node.js", "Python", "Docker"]
    assert [p["name"] for p in body["points"]] == names
    assert [p["source"] for p in body["points"]] == ["manual", "manual", "cv", "cv", "github"]
    assert all(-1.0001 <= p["x"] <= 1.0001 and -1.0001 <= p["y"] <= 1.0001 for p in body["points"])
    assert max(abs(p["x"]) for p in body["points"]) == pytest.approx(1.0)

    m = fake_embedder.embed_texts(texts(names)).astype(np.float64)
    sims = m @ m.T
    expected = sorted(
        ((names[i], names[j], sims[i, j]) for i in range(5) for j in range(i + 1, 5)), key=lambda t: -t[2]
    )[:3]
    assert body["closestPairs"] == [{"a": a, "b": b, "similarity": round(float(s), 2)} for a, b, s in expected]


async def test_users_only_see_their_own_data(db):
    await put_skills(USER_A, SKILLS)
    async with client(USER_B) as c:
        me = (await c.get("/api/embeddings/me")).json()
        mapped = await c.get("/api/embeddings/me/map")
    assert me["status"] == "none" and me["skills_count"] == 0
    assert mapped.status_code == 400 and mapped.json()["code"] == "NOT_ENOUGH_SKILLS"


async def test_health_reports_state_model_and_dimension(fake_embedder):
    async with client() as c:
        body = (await c.get("/api/embeddings/health")).json()
    assert (body["state"], body["model"], body["dimension"]) == ("ready", fake_embedder.model_name, 384)


# ── Re-embedding for a model change ───────────────────────────────────────────
async def test_reembed_dry_run_writes_nothing(db, fake_embedder):
    await put_skills(USER_A, SKILLS)
    new = FakeEmbedder(model_name="fake/new-model")
    before = await db.skill_vectors.count_documents({})
    report = await reembed_all(db, new, dry_run=True)
    assert report["to_embed"] == 3 and report["embedded"] == 0
    assert await db.skill_vectors.count_documents({}) == before
    assert (await db.user_skill_profiles.find_one({"user_id": USER_A}))["model"] == fake_embedder.model_name


async def test_reembed_updates_model_without_mixing(db, fake_embedder):
    await put_skills(USER_A, SKILLS)
    await get_skill_vectors(["Accounting"], fake_embedder, db)  # a cached key no profile uses
    new = FakeEmbedder(model_name="fake/new-model")
    report = await reembed_all(db, new)
    assert report["embedded"] == 4 and report["profiles_updated"] == 1
    assert await db.skill_vectors.count_documents({"model": "fake/new-model"}) == 4
    assert await db.skill_vectors.count_documents({"model": fake_embedder.model_name}) == 0  # removed after success
    model_module.use_embedder(new)
    keys, names, matrix = await get_user_skill_matrix(USER_A, "fake/new-model", db)
    assert np.allclose(matrix, new.embed_texts(texts(names)), atol=1e-6)  # only new-model vectors
    assert not np.allclose(matrix, fake_embedder.embed_texts(texts(names)), atol=1e-3)
    assert (await reembed_all(db, new))["embedded"] == 0  # idempotent


# ── Real model (slow; `pytest -m slow`) ───────────────────────────────────────
@pytest.fixture(scope="module")
def real_model():
    manager = model_module.ModelManager()
    manager.load_sync()
    return manager


def real_cos(manager, a, b):
    va, vb = manager.embed_texts(texts([a, b]))
    assert va.shape == (manager.dimension,) and abs(float(np.linalg.norm(va)) - 1) < 1e-4
    return float(va @ vb)


@pytest.mark.slow
def test_real_model_description_mode_similarity(real_model):
    """bge-small-en-v1.5 + "Name: description" text against the 0.72 related threshold."""
    from app.config.settings import settings
    from app.services.embeddings.matching_config import get_related_threshold

    assert real_model.model_name == settings.EMBEDDING_MODEL == "BAAI/bge-small-en-v1.5"
    threshold = get_related_threshold()
    assert threshold == 0.72
    assert real_cos(real_model, "React", "Next.js") > threshold > real_cos(real_model, "React", "Accounting")
    assert real_cos(real_model, "Celery", "Cooking") < threshold


@pytest.mark.slow
@pytest.mark.xfail(
    strict=True,
    reason="Measured 0.744 with the benchmark's exact text (Redux and Redis seed descriptions); "
    "a known false positive at 0.72 (benchmark precision 0.977). Seed descriptions must not change.",
)
def test_real_model_redux_redis_below_threshold(real_model):
    assert real_cos(real_model, "Redux", "Redis") < 0.72
