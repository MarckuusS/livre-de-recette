"""PriceHistoryRepo : append-only log of observed prices per ingredient."""

from __future__ import annotations

from sqlalchemy import distinct, select
from sqlalchemy.orm import Session

from app.domain.models import PriceHistoryEntry

from ..orm import IngredientPriceHistoryRow
from ._mappers import _price_to_domain


class PriceHistoryRepo:
    """CRUD for `ingredient_price_history`. Append-only log : `add` + `delete`,
    no `update` (to fix a typo, delete + re-add). Listing is always sorted by
    `recorded_at` ASC so the line chart can render directly without re-sorting."""

    def __init__(self, session: Session) -> None:
        self.s = session

    def list_for_ingredient(self, ingredient_id: int) -> list[PriceHistoryEntry]:
        stmt = (
            select(IngredientPriceHistoryRow)
            .where(IngredientPriceHistoryRow.ingredient_id == ingredient_id)
            .order_by(IngredientPriceHistoryRow.recorded_at.asc(),
                      IngredientPriceHistoryRow.id.asc())
        )
        return [_price_to_domain(r) for r in self.s.execute(stmt).scalars()]

    def get(self, entry_id: int) -> PriceHistoryEntry | None:
        row = self.s.get(IngredientPriceHistoryRow, entry_id)
        return _price_to_domain(row) if row is not None else None

    def add(self, entry: PriceHistoryEntry) -> PriceHistoryEntry:
        row = IngredientPriceHistoryRow(
            ingredient_id=entry.ingredient_id,
            price_eur=entry.price_eur,
            quantity_g=entry.quantity_g,
            store=entry.store,
            recorded_at=entry.recorded_at,
            notes=entry.notes,
        )
        self.s.add(row)
        self.s.flush()
        return _price_to_domain(row)

    def delete(self, entry_id: int) -> bool:
        row = self.s.get(IngredientPriceHistoryRow, entry_id)
        if row is None:
            return False
        self.s.delete(row)
        self.s.flush()
        return True

    def list_known_stores(self) -> list[str]:
        """Distinct non-empty store names already used. Powers the autocomplete
        combobox in the price-history dialog."""
        stmt = (
            select(distinct(IngredientPriceHistoryRow.store))
            .where(IngredientPriceHistoryRow.store.is_not(None))
            .where(IngredientPriceHistoryRow.store != "")
            .order_by(IngredientPriceHistoryRow.store.asc())
        )
        return [s for s in self.s.execute(stmt).scalars() if s]

    def latest_for_ingredient(self, ingredient_id: int) -> PriceHistoryEntry | None:
        """Most recent observation by `recorded_at` DESC. Returned to the QML
        layer when promoting a history entry to the ingredient's reference price."""
        stmt = (
            select(IngredientPriceHistoryRow)
            .where(IngredientPriceHistoryRow.ingredient_id == ingredient_id)
            .order_by(IngredientPriceHistoryRow.recorded_at.desc(),
                      IngredientPriceHistoryRow.id.desc())
            .limit(1)
        )
        row = self.s.execute(stmt).scalars().first()
        return _price_to_domain(row) if row is not None else None
