"""TagRepo : CRUD on the global `tag` table (used by recipes, M2M)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import Tag

from ..orm import TagRow
from ._mappers import _tag_to_domain


class TagRepo:
    """CRUD on the `tag` table. Tags are global (not user-scoped) — same set
    available across all recipes."""

    def __init__(self, session: Session) -> None:
        self.s = session

    def list_all(self) -> list[Tag]:
        rows = self.s.execute(select(TagRow).order_by(TagRow.name)).scalars()
        return [_tag_to_domain(r) for r in rows]

    def get(self, tag_id: int) -> Tag | None:
        row = self.s.get(TagRow, tag_id)
        return _tag_to_domain(row) if row else None

    def find_by_name(self, name: str) -> Tag | None:
        row = self.s.execute(
            select(TagRow).where(TagRow.name == name)
        ).scalar_one_or_none()
        return _tag_to_domain(row) if row else None

    def create(self, tag: Tag) -> Tag:
        row = TagRow(name=tag.name, color_hex=tag.color_hex)
        self.s.add(row)
        self.s.flush()
        return _tag_to_domain(row)

    def update(self, tag: Tag) -> Tag:
        if tag.id is None:
            raise ValueError("update requires a Tag with id")
        row = self.s.get(TagRow, tag.id)
        if row is None:
            raise LookupError(f"Tag {tag.id} not found")
        row.name = tag.name
        row.color_hex = tag.color_hex
        self.s.flush()
        return _tag_to_domain(row)

    def delete(self, tag_id: int) -> None:
        """Hard delete. SQLite cascades drop the `recipe_tag` rows automatically
        (PRAGMA foreign_keys=ON is set on every connection in `db.py`).

        After deletion we expire the session — otherwise any `Recipe` already
        loaded with this tag in its `tags` collection would still show it stale.
        """
        row = self.s.get(TagRow, tag_id)
        if row is not None:
            self.s.delete(row)
            self.s.flush()
            self.s.expire_all()
