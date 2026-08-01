"""Domain models for the shopping list feature.

A shopping list is a snapshot of the aggregated ingredients needed for a given
period (typically one ISO week). Pure data; no Qt, no DB. Built by
`app.services.shopping_service.aggregate_shopping_list()`.
"""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ShoppingItem(BaseModel):
    """One line in a shopping list: one ingredient with all quantities summed
    across recipes (with their portion ratios applied) and raw entries."""

    model_config = ConfigDict(frozen=True)

    ingredient_id: int
    name: str
    source: str  # 'ciqual' | 'openfoodfacts' | 'manual'

    quantity_g: float = Field(ge=0)
    # If non-None, the ingredient has a natural piece size — the UI can display
    # "≈ 6 pièces" alongside the gram total to help the user shop.
    piece_weight_g: float | None = None

    # CIQUAL category for grouping in the UI ("Légumes", "Viande", …).
    # None → grouped under "Non catégorisé".
    category_l1: str | None = None

    # Total cost for this line. None when the ingredient has no price set.
    cost_eur: Decimal | None = None

    # F1 : how much of this ingredient is already in the user's pantry.
    # Stamped by `aggregate_shopping_list` from `PantryRepo`. The
    # `ShoppingPage` pre-checks "déjà au frigo" when this is ≥ `quantity_g`.
    in_pantry_g: float = 0.0

    @property
    def has_price(self) -> bool:
        return self.cost_eur is not None

    @property
    def is_covered_by_pantry(self) -> bool:
        """True iff the user already has at least the required quantity at home.
        Drives the auto-check of "déjà au frigo" on the shopping page."""
        return self.in_pantry_g >= self.quantity_g and self.quantity_g > 0

    @property
    def piece_count(self) -> float | None:
        """Approximate number of pieces (`quantity_g / piece_weight_g`) when
        the ingredient has a natural piece size, else None."""
        if not self.piece_weight_g:
            return None
        return self.quantity_g / self.piece_weight_g


class ShoppingList(BaseModel):
    """Snapshot of a shopping list for a given period."""

    model_config = ConfigDict(frozen=True)

    iso_week: str
    items: list[ShoppingItem] = Field(default_factory=list)
    # Sum of `cost_eur` over all items that have a price. Items without a price
    # are excluded from the total but counted in `missing_price_count`.
    total_eur: Decimal = Decimal("0.00")
    missing_price_count: int = 0

    @property
    def item_count(self) -> int:
        return len(self.items)
