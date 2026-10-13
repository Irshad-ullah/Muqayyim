"""
Skill embeddings — user-facing API (via the gateway at /api/embeddings).

  GET /api/embeddings/me       status of the caller's skill embeddings
  GET /api/embeddings/me/map   2D map (PCA via numpy SVD) + 3 closest pairs
  GET /api/embeddings/health   model state, name and dimension

The user always comes from the JWT; there is no user id in the path, so a
user can only ever see their own data. The map is computed from stored
vectors only (no model needed once a user's vectors exist).
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
import numpy as np

from app.middleware.auth import get_current_user
from app.services.embeddings.model import Embedder, get_embedder
from app.services.embeddings.user_profiles import (
    DONE,
    EmbeddingsPending,
    get_user_skill_matrix,
    get_user_skill_record,
)

router = APIRouter(prefix="/api/embeddings", tags=["Skill embeddings"])

MIN_MAP_SKILLS = 3
NOT_ENOUGH_SKILLS_MESSAGE = "Add at least 3 skills to see your skill map."


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "code": code, "message": message})


def _status(record, embedder: Embedder) -> str:
    if not record:
        return "none"
    ready = record.get("embedding_status") == DONE and record.get("model") == embedder.model_name
    return "ready" if ready else "pending"


@router.get("/health")
async def embeddings_health(embedder: Embedder = Depends(get_embedder)):
    return {"success": True, **embedder.health()}


@router.get("/me")
async def my_embeddings(current_user: dict = Depends(get_current_user), embedder: Embedder = Depends(get_embedder)):
    record = await get_user_skill_record(current_user["user_id"])
    return {
        "success": True,
        "status": _status(record, embedder),
        "skills_count": len(record["skills"]) if record else 0,
        "model": embedder.model_name,
        "updated_at": record.get("updated_at") if record else None,
    }


def pca_2d(matrix: np.ndarray) -> np.ndarray:
    """Project rows onto the first two principal components; each axis scaled to −1…1."""
    centred = matrix - matrix.mean(axis=0, keepdims=True)
    _, _, vt = np.linalg.svd(centred, full_matrices=False)
    coords = centred @ vt[:2].T
    if coords.shape[1] < 2:
        coords = np.hstack([coords, np.zeros((coords.shape[0], 2 - coords.shape[1]))])
    scale = np.abs(coords).max(axis=0)
    scale[scale == 0] = 1.0
    return coords / scale


def closest_pairs(names, matrix: np.ndarray, top: int = 3):
    """Top pairs by cosine similarity on the full 384-dim (unit) vectors."""
    sims = matrix @ matrix.T
    i, j = np.triu_indices(len(names), k=1)
    order = np.argsort(-sims[i, j], kind="stable")[:top]
    return [{"a": names[i[k]], "b": names[j[k]], "similarity": round(float(sims[i[k], j[k]]), 2)} for k in order]


@router.get("/me/map")
async def my_skill_map(current_user: dict = Depends(get_current_user), embedder: Embedder = Depends(get_embedder)):
    user_id = current_user["user_id"]
    record = await get_user_skill_record(user_id)
    if not record or len(record.get("skills") or []) < MIN_MAP_SKILLS:
        return _error(400, "NOT_ENOUGH_SKILLS", NOT_ENOUGH_SKILLS_MESSAGE)
    try:
        keys, names, matrix = await get_user_skill_matrix(user_id, embedder.model_name)
    except EmbeddingsPending:
        if not embedder.ready:
            return _error(503, "MODEL_LOADING", "The skill model is still loading. Please try again in a moment.")
        return _error(503, "EMBEDDINGS_PENDING", "Your skill embeddings are being created. Please try again in a moment.")
    if len(keys) < MIN_MAP_SKILLS:
        return _error(400, "NOT_ENOUGH_SKILLS", NOT_ENOUGH_SKILLS_MESSAGE)

    sources = {s["key"]: s.get("source", "manual") for s in record["skills"]}  # display only
    coords = pca_2d(matrix.astype(np.float64))
    points = [
        {"name": name, "x": round(float(x), 4), "y": round(float(y), 4), "source": sources.get(key, "manual")}
        for key, name, (x, y) in zip(keys, names, coords)
    ]
    return {
        "success": True,
        "points": points,
        "closestPairs": closest_pairs(names, matrix.astype(np.float64)),
        "model": embedder.model_name,
        "skills_count": len(keys),
    }
