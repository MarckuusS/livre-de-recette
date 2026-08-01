"""PantryRepo : CRUD on `pantry_stock` (F1 — frigo / cellier inventory)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.models import PantryStock

from ..orm import PantryStockRow


def _stock_to_domain(row: PantryStockRow) -> PantryStock:
    return PantryStock(
        id=row.id,
        ingredient_id=row.ingredient_id,
        quantity_g=row.quantity_g,
        expiry_date=row.expiry_date,
        notes=row.notes,
        added_at=row.added_at,
        updated_at=row.updated_at,
    )


class PantryRepo:
    """CRUD for `pantry_stock`. Multiple rows per ingredient_id are allowed
    (different batches with different expiry dates). The
    `aggregate_quantity_for_ingredient` helper sums them when the shopping
    list needs the total available stock."""

    def __init__(self, session: Session) -> None:
        self.s = session

    def list_all(self) -> list[PantryStock]:
        """All entries, ordered by expiry date ascending (NULLs last) so the
        page can display "À consommer vite" naturally without a re-sort."""
        stmt = (
            select(PantryStockRow)
            .order_by(
                PantryStockRow.expiry_date.is_(None),  # NULLs last
                PantryStockRow.expiry_date.asc(),
                PantryStockRow.id.asc(),
            )
        )
        return [_stock_to_domain(r) for r in self.s.execute(stmt).scalars()]

    def get(self, stock_id: int) -> PantryStock | None:
        row = self.s.get(PantryStockRow, stock_id)
        return _stock_to_domain(row) if row else None

    def list_for_ingredient(self, ingredient_id: int) -> list[PantryStock]:
        stmt = (
            select(PantryStockRow)
            .where(PantryStockRow.ingredient_id == ingredient_id)
            .order_by(
                PantryStockRow.expiry_date.is_(None),
                PantryStockRow.expiry_date.asc(),
            )
        )
        return [_stock_to_domain(r) for r in self.s.execute(stmt).scalars()]

    def add(self, stock: PantryStock) -> PantryStock:
        row = PantryStockRow(
            ingredient_id=stock.ingredient_id,
            quantity_g=stock.quantity_g,
            expiry_date=stock.expiry_date,
            notes=stock.notes,
        )
        self.s.add(row)
        self.s.flush()
        return _stock_to_domain(row)

    def update(self, stock: PantryStock) -> PantryStock:
        if stock.id is None:
            raise ValueError("update requires a PantryStock with id")
        row = self.s.get(PantryStockRow, stock.id)
        if row is None:
            raise LookupError(f"PantryStock {stock.id} not found")
        row.quantity_g = stock.quantity_g
        row.expiry_date = stock.expiry_date
        row.notes = stock.notes
        self.s.flush()
        return _stock_to_domain(row)

    def delete(self, stock_id: int) -> bool:
        row = self.s.get(PantryStockRow, stock_id)
        if row is None:
            return False
        self.s.delete(row)
        self.s.flush()
        return True

    def aggregate_quantity_by_ingredient(self) -> dict[int, float]:
        """Sum `quantity_g` per ingredient_id across all batches. Returns a
        dict {ingredient_id: total_g} suitable for fast lookup by the
        shopping aggregator (F1 → ShoppingPage pre-check "déjà au frigo")."""
        stmt = select(
            PantryStockRow.ingredient_id,
            func.sum(PantryStockRow.quantity_g),
        ).group_by(PantryStockRow.ingredient_id)
        return {ing_id: float(total or 0) for ing_id, total in self.s.execute(stmt)}

    def expiring_before(self, deadline: datetime) -> list[PantryStock]:
        """Stock entries whose expiry_date <= deadline. Used by the
        "À consommer vite" section."""
        stmt = (
            select(PantryStockRow)
            .where(PantryStockRow.expiry_date.is_not(None))
            .where(PantryStockRow.expiry_date <= deadline)
            .order_by(PantryStockRow.expiry_date.asc())
        )
        return [_stock_to_domain(r) for r in self.s.execute(stmt).scalars()]
