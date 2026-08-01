"""WeeklyCostRepo (F9) : upsert + read for the cost-history mini-graph."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import WeeklyCostSnapshot

from ..orm import WeeklyCostSnapshotRow
from ._mappers import _cost_to_domain


class WeeklyCostRepo:
    """Persists the cost snapshot of each ISO week. Upsert pattern — only the
    latest value per week is kept (the table is keyed on `iso_week`)."""

    def __init__(self, session: Session) -> None:
        self.s = session

    def upsert(self, snapshot: WeeklyCostSnapshot) -> WeeklyCostSnapshot:
        row = self.s.get(WeeklyCostSnapshotRow, snapshot.iso_week)
        if row is None:
            row = WeeklyCostSnapshotRow(
                iso_week=snapshot.iso_week,
                total_eur=snapshot.total_eur,
                missing_count=snapshot.missing_count,
            )
            self.s.add(row)
        else:
            row.total_eur = snapshot.total_eur
            row.missing_count = snapshot.missing_count
            # `captured_at` is auto-bumped by `onupdate=func.now()` only when a
            # mapped column actually changes. To force the bump even when the
            # cost is unchanged, touch it explicitly. Use timezone-naive UTC
            # to match SQLAlchemy's `DateTime` (without tz) elsewhere in the schema.
            row.captured_at = datetime.now(UTC).replace(tzinfo=None)
        self.s.flush()
        return _cost_to_domain(row)

    def get(self, iso_week: str) -> WeeklyCostSnapshot | None:
        row = self.s.get(WeeklyCostSnapshotRow, iso_week)
        return _cost_to_domain(row) if row else None

    def list_recent(self, weeks: int = 12) -> list[WeeklyCostSnapshot]:
        """Return the `weeks` most recent snapshots, **oldest first** (so the
        UI can plot left-to-right with time)."""
        stmt = (
            select(WeeklyCostSnapshotRow)
            .order_by(WeeklyCostSnapshotRow.iso_week.desc())
            .limit(weeks)
        )
        rows = list(self.s.execute(stmt).scalars())
        rows.reverse()  # oldest first
        return [_cost_to_domain(r) for r in rows]
