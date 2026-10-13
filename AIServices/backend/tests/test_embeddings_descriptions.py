"""
09a2 — description-mode embeddings: embed text, description providers, cache
invalidation by text hash, unknown skills, model-derived dimension, related
threshold, and re-embedding a model / text-mode / alias change.
"""

import json
import logging

import httpx
import numpy as np
import pytest
from fastapi import FastAPI

from app.config.settings import settings
from app.middleware.auth import get_current_user
from app.middleware.validation import register_validation_error_handler
from app.routes import embedding_routes, internal_routes
from app.services.embeddings import descriptions as desc_module
from app.services.embeddings import model as model_module
from app.services.embeddings.descriptions import (
    ChainedProvider,
    CuratedFileProvider,
    Description,
    InvalidDescriptionFile,
    build_embed_text,
    use_description_provider,
)
from app.services.embeddings.fake import FakeEmbedder
from app.services.embeddings.matching_config import get_related_threshold
from app.services.embeddings.reembed import reembed_all
from app.services.embeddings.user_profiles import get_user_skill_matrix, upsert_user_skills
from app.services.embeddings.vector_store import ensure_embedding_indexes, get_skill_vectors, text_hash
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture

USER = "507f1f77bcf86cd799439033"
KEY = {"X-Internal-Key": "test-internal-key"}


@pytest.fixture
async def db(real_db):  # noqa: F811
    await ensure_embedding_indexes(real_db)
    return real_db


@pytest.fixture(autouse=True)
def fresh_descriptions():
    use_description_provider(None)
    desc_module.reset_unknown_log()
    yield
    use_description_provider(None)
    desc_module.reset_unknown_log()


class StubProvider:
    name = "stub"

    def __init__(self, mapping):
        self.mapping = mapping

    def lookup(self, canonical):
        text = self.mapping.get(canonical)
        return Description(text, self.name) if text else None


def client():
    app = FastAPI()
    register_validation_error_handler(app)
    app.include_router(embedding_routes.router)
    app.include_router(internal_routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"user_id": USER, "role": "JobSeeker"}
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost")


# ── Text to embed ─────────────────────────────────────────────────────────────
def test_description_mode_uses_name_and_description():
    curated = json.loads(desc_module.CURATED_FILE.read_text(encoding="utf8"))
    result = build_embed_text("Celery", "description")
    assert result.text == f"Celery: {curated['Celery']}"
    assert (result.has_description, result.description_source) == (True, "curated")


def test_description_mode_without_description_falls_back_to_the_name():
    result = build_embed_text("Zorblax", "description")
    assert (result.text, result.has_description, result.description_source) == ("Zorblax", False, None)


def test_name_mode_embeds_bare_names():
    result = build_embed_text("Celery", "name")
    assert (result.text, result.has_description) == ("Celery", False)


def test_unknown_skills_are_logged_once(caplog):
    with caplog.at_level(logging.INFO, logger="app.services.embeddings.descriptions"):
        for _ in range(3):
            build_embed_text("Zorblax", "description")
        build_embed_text("zorblax", "description")
    assert sum("Zorblax" in r.getMessage() or "zorblax" in r.getMessage() for r in caplog.records) == 1


# ── Providers ─────────────────────────────────────────────────────────────────
def test_chain_first_hit_wins():
    chain = ChainedProvider([StubProvider({"React": "first"}), StubProvider({"React": "second", "Go": "only second"})])
    assert chain.lookup("React") == Description("first", "stub")
    assert chain.lookup("Go").description == "only second"
    assert chain.lookup("Zorblax") is None


def test_curated_provider_covers_the_file():
    provider = CuratedFileProvider()
    assert len(provider) >= 800
    assert provider.lookup("reactjs").description == provider.lookup("React").description  # by canonical key


@pytest.mark.parametrize(
    "content",
    ["not json", "[]", "{}", json.dumps({"React": ""}), json.dumps({"reactjs": "x" * 20}), json.dumps({"React": "a", "react": "b"})],
)
def test_invalid_curated_file_fails_fast(tmp_path, content):
    path = tmp_path / "skill_descriptions.json"
    path.write_text(content, encoding="utf8")
    with pytest.raises(InvalidDescriptionFile):
        CuratedFileProvider(path)


# ── Cache identity: key + model + text mode + text hash ───────────────────────
async def test_vector_documents_record_the_embedded_text(db, fake_embedder):
    await get_skill_vectors(["React", "Zorblax"], fake_embedder, db)
    react = await db.skill_vectors.find_one({"key": "react"})
    text = build_embed_text("React").text
    assert react["model"] == fake_embedder.model_name and react["text_mode"] == "description"
    assert react["embedded_text"] == text and react["text_hash"] == text_hash(text)
    assert react["has_description"] is True and react["description_source"] == "curated"
    zorblax = await db.skill_vectors.find_one({"key": "zorblax"})
    assert zorblax["embedded_text"] == "Zorblax" and zorblax["has_description"] is False
    assert zorblax["description_source"] is None


async def test_changed_description_is_re_embedded_and_old_entry_never_returned(db, fake_embedder):
    use_description_provider(StubProvider({"Celery": "Python distributed task queue"}))
    first = await get_skill_vectors(["Celery"], fake_embedder, db)
    use_description_provider(StubProvider({"Celery": "Python task queue for background jobs and scheduling"}))
    second = await get_skill_vectors(["Celery"], fake_embedder, db)
    assert fake_embedder.embedded_texts == [
        "Celery: Python distributed task queue",
        "Celery: Python task queue for background jobs and scheduling",
    ]
    assert not np.allclose(first["celery"], second["celery"])
    docs = await db.skill_vectors.find({"key": "celery"}).to_list(None)
    assert len(docs) == 1 and docs[0]["embedded_text"].endswith("scheduling")  # stale entry removed
    third = await get_skill_vectors(["Celery"], fake_embedder, db)
    assert np.allclose(third["celery"], second["celery"]) and len(fake_embedder.calls) == 2


async def test_text_modes_never_mix(db, fake_embedder):
    described = await get_skill_vectors(["React"], fake_embedder, db, mode="description")
    named = await get_skill_vectors(["React"], fake_embedder, db, mode="name")
    assert not np.allclose(described["react"], named["react"])
    assert fake_embedder.embedded_texts == [build_embed_text("React").text, "React"]
    assert await db.skill_vectors.count_documents({"key": "react"}) == 2


async def test_vectors_without_text_fields_are_ignored(db, fake_embedder):
    # A 09a-style document (no text_mode / text_hash) is never served.
    await db.skill_vectors.insert_one({"key": "react", "name": "React", "vector": [1.0] + [0.0] * 383, "model": fake_embedder.model_name})
    await get_skill_vectors(["React"], fake_embedder, db)
    assert len(fake_embedder.calls) == 1


# ── Unknown skills endpoint ──────────────────────────────────────────────────
async def test_unknown_skills_endpoint(db, fake_embedder):
    await upsert_user_skills(USER, [{"name": "React", "source": "manual"}, {"name": "Zorblax", "source": "manual"}], embedder=fake_embedder, db=db)
    await upsert_user_skills("507f1f77bcf86cd799439044", [{"name": "Zorblax", "source": "cv"}], embedder=fake_embedder, db=db)
    async with client() as c:
        res = await c.get("/internal/embeddings/unknown-skills", headers=KEY)
        no_key = await c.get("/internal/embeddings/unknown-skills")
    assert no_key.status_code == 401
    body = res.json()
    assert body["skills"] == [{"key": "zorblax", "name": "Zorblax", "users": 2}]
    assert body["count"] == 1 and body["text_mode"] == "description"


async def test_health_and_me_report_described_counts(db, fake_embedder):
    await upsert_user_skills(USER, [{"name": n, "source": "manual"} for n in ["React", "Docker", "Zorblax"]], embedder=fake_embedder, db=db)
    async with client() as c:
        health = (await c.get("/api/embeddings/health")).json()
        me = (await c.get("/api/embeddings/me")).json()
    assert health["skills"] == {"total": 3, "described": 2, "undescribed": 1}
    assert health["text_mode"] == "description"
    assert (me["status"], me["skills_count"], me["described_count"]) == ("ready", 3, 2)


# ── Dimension comes from the model ───────────────────────────────────────────
@pytest.mark.parametrize("dimension", [384, 768])
async def test_any_model_dimension_works_end_to_end(db, dimension):
    embedder = FakeEmbedder(dimension=dimension)
    model_module.use_embedder(embedder)
    keys, names, empty = await get_user_skill_matrix(USER, embedder.model_name, db)
    assert empty.shape == (0, dimension)
    await upsert_user_skills(USER, [{"name": n, "source": "manual"} for n in ["React", "Python", "Docker", "Figma"]], embedder=embedder, db=db)
    keys, names, matrix = await get_user_skill_matrix(USER, embedder.model_name, db)
    assert matrix.shape == (4, dimension)
    assert len((await db.skill_vectors.find_one({"key": "react"}))["vector"]) == dimension
    async with client() as c:
        health = (await c.get("/api/embeddings/health")).json()
        mapped = (await c.get("/api/embeddings/me/map")).json()
    assert health["dimension"] == dimension
    assert len(mapped["points"]) == 4 and len(mapped["closestPairs"]) == 3


def test_real_manager_has_no_dimension_until_loaded():
    assert model_module.ModelManager().dimension is None


# ── Related threshold ────────────────────────────────────────────────────────
def test_related_threshold_only_for_the_measured_model_and_mode(caplog, monkeypatch):
    assert settings.EMBEDDING_THRESHOLD_MODEL == "BAAI/bge-small-en-v1.5"
    assert get_related_threshold("BAAI/bge-small-en-v1.5", "description") == 0.72
    with caplog.at_level(logging.WARNING, logger="app.services.embeddings.matching_config"):
        assert get_related_threshold("sentence-transformers/all-MiniLM-L6-v2", "description") is None
        assert get_related_threshold("BAAI/bge-small-en-v1.5", "name") is None
    assert len([r for r in caplog.records if "re-measure" in r.getMessage()]) == 2
    monkeypatch.setattr(settings, "EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
    monkeypatch.setattr(settings, "EMBEDDING_TEXT_MODE", "description")
    assert get_related_threshold() == 0.72


def test_default_configuration():
    assert settings.EMBEDDING_MODEL == "BAAI/bge-small-en-v1.5"
    assert settings.EMBEDDING_TEXT_MODE == "description"
    assert settings.EMBEDDING_RELATED_THRESHOLD == 0.72


# ── Re-embedding a model / text-mode / alias change ─────────────────────────
async def test_reembed_migrates_vectors_and_profiles(db):
    old = FakeEmbedder(model_name="fake/old-model")
    new = FakeEmbedder(model_name="fake/new-model", dimension=768)
    # 09a-era data: old model, name text, and an old canonical name ("Apache Kafka").
    for name, key in [("React", "react"), ("Apache Kafka", "apache kafka"), ("Accounting", "accounting")]:
        await db.skill_vectors.insert_one({"key": key, "name": name, "vector": old.embed_texts([name])[0].tolist(), "model": old.model_name})
    await db.user_skill_profiles.insert_one({
        "user_id": USER,
        "skills": [{"name": "React", "key": "react", "source": "manual"}, {"name": "Apache Kafka", "key": "apache kafka", "source": "cv"}],
        "skills_hash": "old", "model": old.model_name, "embedding_status": "done", "requested_at": 1,
    })

    dry = await reembed_all(db, new, dry_run=True)
    assert dry["to_embed"] == 3 and dry["embedded"] == 0
    assert await db.skill_vectors.count_documents({"model": new.model_name}) == 0

    report = await reembed_all(db, new)
    assert report["embedded"] == 3 and report["profiles_updated"] == 1
    assert report["before"]["vectors_other"] == 3 and report["after"]["vectors_other"] == 0
    assert report["after"]["vectors_current"] == 3 and report["after"]["profiles_current"] == 1
    assert await db.skill_vectors.count_documents({"model": {"$ne": new.model_name}}) == 0
    assert {d["key"] for d in await db.skill_vectors.find().to_list(None)} == {"react", "kafka", "accounting"}

    profile = await db.user_skill_profiles.find_one({"user_id": USER})
    assert (profile["model"], profile["text_mode"], profile["embedding_status"]) == (new.model_name, "description", "done")
    assert profile["skills"][1] == {"name": "Kafka", "key": "kafka", "source": "cv"}  # renamed alias

    model_module.use_embedder(new)
    keys, names, matrix = await get_user_skill_matrix(USER, new.model_name, db)
    assert keys == ["react", "kafka"] and matrix.shape == (2, 768)
    assert np.allclose(matrix, new.embed_texts([build_embed_text(n).text for n in names]), atol=1e-6)
    assert (await reembed_all(db, new))["embedded"] == 0
