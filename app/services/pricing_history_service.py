"""Auto-derivation of `ingredient.price_eur` / `price_quantity_g` from
the most recent price history entry.

Design choice : `ingredient.price_eur` is now a *denormalized cache* of
the latest observation in `ingredient_price_history`. The user no longer
edits the price directly on the ingredient form — they record observations
in the history dialog (date, store, price, quantity) and the displayed
"current price" follows the most recent entry by `recorded_at`.

Why denormalize rather than compute on read :

  - Recipe cost calculations and shopping list aggregation read
    `ingredient.price_eur` heavily. Computing per-ingredient on every
    read would mean dozens of subqueries per recipe.
  - The current price changes rarely (each user-recorded observation),
    so a cache invalidation pattern is cheap : we recompute exactly
    once per add/delete of a history entry.

The recompute is idempotent and never raises ; if there is no history
left, both fields are cleared to NULL. Existing rows whose price was set
manually before this feature shipped are NOT touched until the user adds
their first observation — they keep their grandfathered value.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.data.repositories import IngredientRepo, PriceHistoryRepo
from app.domain.models import Ingredient

log = logging.getLogger(__name__)


def recompute_current_price(s: Session, ingredient_id: int) -> Ingredient | None:
    """Refresh `ingredient.price_eur` + `price_quantity_g` from the most
    recent price history entry. If history is empty, both are cleared.

    Returns the updated `Ingredient`, or `None` if the ingredient does
    not exist. Callers are responsible for committing the session.
    """
    if ingredient_id <= 0:
        return None

    ing_repo = IngredientRepo(s)
    ing = ing_repo.get(ingredient_id)
    if ing is None:
        return None

    latest = PriceHistoryRepo(s).latest_for_ingredient(ingredient_id)
    if latest is not None:
        ing.price_eur = latest.price_eur
        ing.price_quantity_g = latest.quantity_g
        log.debug(
            "Recomputed current price for ingredient %d from history "
            "entry %d (recorded %s) : %s €/%g g",
            ingredient_id, latest.id, latest.recorded_at,
            latest.price_eur, latest.quantity_g,
        )
    else:
        ing.price_eur = None
        ing.price_quantity_g = None
        log.debug("Cleared current price for ingredient %d (no history)", ingredient_id)

    return ing_repo.update(ing)
