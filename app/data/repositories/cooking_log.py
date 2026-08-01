"""CookingLogRepo : append-only log of recipe cooking sessions (C2)."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.models import CookingLogEntry

from ..orm import RecipeCookingLogRow


def _to_domain(row: RecipeCookingLogRow) -> CookingLogEntry:
    return CookingLogEntry(
        id=row.id,
        recipe_id=row.recipe_id,
        cooked_at=row.cooked_at,
        rating=row.rating,
        notes=row.notes,
        created_at=row.created_at,
    )


class CookingLogRepo:
    """CRUD for `recipe_cooking_log`. Listing is descending by `cooked_at` so
    the QML history tab shows the most recent session first."""

    def __init__(self, session: Session) -> None:
        self.s = session

    def list_for_recipe(self, recipe_id: int) -> list[CookingLogEntry]:
        stmt = (
            select(RecipeCookingLogRow)
            .where(RecipeCookingLogRow.recipe_id == recipe_id)
            .order_by(RecipeCookingLogRow.cooked_at.desc(),
                      RecipeCookingLogRow.id.desc())
        )
        return [_to_domain(r) for r in self.s.execute(stmt).scalars()]

    def add(self, entry: CookingLogEntry) -> CookingLogEntry:
        row = RecipeCookingLogRow(
            recipe_id=entry.recipe_id,
            cooked_at=entry.cooked_at,
            rating=entry.rating,
            notes=entry.notes,
        )
        self.s.add(row)
        self.s.flush()
        return _to_domain(row)

    def delete(self, entry_id: int) -> bool:
        row = self.s.get(RecipeCookingLogRow, entry_id)
        if row is None:
            return False
        self.s.delete(row)
        self.s.flush()
        return True

    def count_in_window(self, recipe_id: int, days: int = 30) -> int:
        """Count cooking sessions for the recipe in the last `days` days
        (e.g. 30 → "cuisiné 3× ce mois")."""
        deadline = datetime.now() - timedelta(days=days)
        stmt = (
            select(func.count(RecipeCookingLogRow.id))
            .where(RecipeCookingLogRow.recipe_id == recipe_id)
            .where(RecipeCookingLogRow.cooked_at >= deadline)
        )
        return int(self.s.execute(stmt).scalar() or 0)
