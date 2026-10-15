"""
Direct edits (09c Part 5): small fixes without a full import.

Every edit runs as:
  taxonomy lock → edit snapshot (pool "edit", so it can be undone with restore) →
  apply → (re-embed what changed) → index rebuild → result.
A failure after the snapshot restores it, so a half-applied edit never stays live.
"""

import logging
from typing import Awaitable, Callable, Optional

from app.config.database import get_database
from app.services.professions import crud
from app.services.professions.role_index import READY, get_role_index
from app.services.taxonomy import jobs, snapshots
from app.services.taxonomy.lock import TaxonomyLock

logger = logging.getLogger(__name__)


class EditRefused(Exception):
    """A validation error raised by an edit before it wrote anything."""

    def __init__(self, status: int, code: str, message: str, errors: Optional[list] = None):
        self.status, self.code, self.safe_message, self.errors = status, code, message, errors or []
        super().__init__(message)


VALIDATION_ERRORS = (crud.ProfessionError, EditRefused)


class EditFailed(Exception):
    def __init__(self, message: str, rolled_back: bool):
        self.safe_message = message
        self.rolled_back = rolled_back
        super().__init__(message)


async def run_edit(description: str, actor: str, apply: Callable[[], Awaitable[dict]], db=None,
                   rebuild_index: bool = True) -> dict:
    """Lock, snapshot, apply, rebuild. → {result, snapshot_id, index}. Raises TaxonomyBusy (409),
    the apply function's own validation errors (nothing changed), or EditFailed."""
    db = db if db is not None else get_database()
    lock = await TaxonomyLock(f"edit:{description}"[:120], None, db).acquire()
    try:
        snapshot = await snapshots.create_snapshot(db, created_by=actor, reason="edit")
        try:
            result = await apply()
            index = get_role_index()
            if rebuild_index:
                await index.rebuild(db)
                if index.state != READY:
                    raise RuntimeError(f"index not ready after the edit ({index.state})")
        except VALIDATION_ERRORS:
            await snapshots.delete_snapshot(db, snapshot)  # refused before any write: nothing to undo
            raise
        except Exception as exc:  # noqa: BLE001
            from app.services.error_logger import log_error

            log_error(level="error", module="taxonomy", exc=exc, error_type="TAXONOMY_EDIT_FAILED",
                      message=f"Edit failed ({description}): {type(exc).__name__}")
            try:
                await snapshots.restore_files(db, snapshot)
            except Exception as again:  # noqa: BLE001
                raise EditFailed(f"The edit failed ({jobs.safe_error(exc)}) and restoring snapshot "
                                 f"{snapshot['snapshot_id']} also failed ({jobs.safe_error(again)})", False)
            raise EditFailed(f"The edit failed and was undone ({jobs.safe_error(exc)})", True)
        return {"result": result, "snapshot_id": snapshot["snapshot_id"], "index": get_role_index().health()}
    finally:
        await lock.release()


async def edit_profession(profession_id: str, body: dict, actor: str, db=None) -> dict:
    db = db if db is not None else get_database()
    await crud.get_profession(profession_id, db)  # 404 before taking a snapshot
    return await run_edit(f"profession {profession_id}", actor,
                          lambda: crud.update_profession(profession_id, body, actor, db, rebuild=False), db)


async def reset_profession(profession_id: str, fields: Optional[list], actor: str, db=None) -> dict:
    db = db if db is not None else get_database()
    await crud.get_profession(profession_id, db)
    return await run_edit(f"reset {profession_id}", actor,
                          lambda: crud.reset_to_dataset(profession_id, fields, actor, db, rebuild=False), db)
