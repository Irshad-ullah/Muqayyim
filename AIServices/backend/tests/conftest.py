import os
import sys

# Make `app` importable and give the internal key a test value before settings load.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")
os.environ.setdefault("CORE_SERVICE_URL", "http://core.test")
# Skill embeddings: never load or download the real model in unit tests.
os.environ.setdefault("EMBEDDING_AUTOLOAD", "false")
os.environ.setdefault("ROLE_INDEX_AUTOLOAD", "false")
os.environ.setdefault("SERVICE_HEARTBEAT_ENABLED", "false")

import hashlib  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402

REAL_DATA_DIR = Path(__file__).resolve().parents[1] / "app" / "data"


@pytest.fixture(scope="session", autouse=True)
def real_data_files_are_never_written():
    """09c rule: tests use temporary copies of the data files. Fail the run if any
    real app/data/*.json file changed."""
    def digest():
        return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(REAL_DATA_DIR.glob("*.json"))}

    before = digest()
    yield
    changed = [name for name, value in digest().items() if before.get(name) != value]
    assert not changed, f"Tests modified the real data files: {changed}"


@pytest.fixture(autouse=True)
def fake_embedder(request, monkeypatch):
    """Every test gets the deterministic fake embedder; loading the real model
    fails loudly unless the test is marked `slow` (run with `pytest -m slow`)."""
    from app.services.embeddings import model as model_module
    from app.services.embeddings.fake import FakeEmbedder

    if request.node.get_closest_marker("slow"):
        model_module.use_embedder(None)
        yield None
        return

    def forbidden(self):
        raise AssertionError("Unit tests must not load the real embedding model (mark the test `slow`).")

    monkeypatch.setattr(model_module.ModelManager, "load_sync", forbidden)
    fake = FakeEmbedder()
    model_module.use_embedder(fake)
    yield fake
    model_module.use_embedder(None)
