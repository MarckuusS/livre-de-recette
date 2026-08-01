"""Aggregate a weekly meal plan into a shopping list.

Walks every `MealPlanEntry` of the period, expands recipes into their lines
(with portion-ratio scaling), sums quantities per ingredient, computes total
cost. Pure orchestration — relies on `domain.pricing.ingredient_cost` for the
price math. Output is a `ShoppingList` Pydantic model, ready for QML / export.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.data.repositories import (
    IngredientRepo,
    MealPlanRepo,
    PantryRepo,
    RecipeRepo,
)
from app.domain import pricing
from app.domain.shopping import ShoppingItem, ShoppingList


def aggregate_shopping_list(s: Session, iso_week: str) -> ShoppingList:
    """Compute the shopping list for the given ISO week.

    Algorithm :
      1. Load all `MealPlanEntry` for the week (1 SELECT).
      2. Bulk-load every referenced recipe (1 SELECT WHERE id IN (...) +
         selectinload of lines & tags) — avoids N+1 (B2).
      3. Walk entries, expand recipes (with portion-ratio scaling), sum
         quantities per ingredient_id into a bucket.
      4. Bulk-load every referenced ingredient (1 SELECT WHERE id IN (...))
         — avoids N+1 again.
      5. Hydrate each bucket entry, compute cost via
         `pricing.ingredient_cost(ing, total_g)`, sort by category then name.

    Missing data (deleted recipes, missing ingredients, missing prices) is
    silently degraded: we skip orphan entries, count missing prices, never
    raise. The UI flags these states.

    B2 perf : a week with 14 entries pointing at 5 distinct recipes (each
    with ~6 ingredients) used to issue ~28 queries (N=14 recipe gets +
    N=14 ingredient gets in the worst case). It now issues 3 :
    list_by_week + list_by_ids(recipes) + list_by_ids(ingredients).
    """
    mp_repo = MealPlanRepo(s)
    recipe_repo = RecipeRepo(s)
    ing_repo = IngredientRepo(s)

    entries = mp_repo.list_by_week(iso_week)

    # 2. Pre-load all referenced recipes in one shot.
    recipe_ids = {e.recipe_id for e in entries if e.recipe_id is not None}
    recipes_by_id = recipe_repo.list_by_ids(recipe_ids)

    # 3. Aggregate quantities per ingredient_id from entries + recipe lines.
    qty_by_ing: dict[int, float] = {}
    for entry in entries:
        if entry.recipe_id is not None:
            recipe = recipes_by_id.get(entry.recipe_id)
            if recipe is None:
                continue  # orphan reference
            default = max(recipe.default_portions, 1)
            ratio = (entry.portions or 1.0) / default
            for line in recipe.lines:
                if line.ingredient.id is None:
                    continue
                qty_by_ing[line.ingredient.id] = (
                    qty_by_ing.get(line.ingredient.id, 0.0)
                    + line.quantity_g * ratio
                )
        elif entry.ingredient_id is not None:
            qty_by_ing[entry.ingredient_id] = (
                qty_by_ing.get(entry.ingredient_id, 0.0)
                + (entry.quantity_g or 0.0)
            )

    # 4. Pre-load all referenced ingredients in one shot.
    ingredients_by_id = ing_repo.list_by_ids(qty_by_ing.keys())

    # 4 bis. Pre-load pantry stock totals (F1) — single SUM ... GROUP BY query.
    # The shopping list will pre-check "déjà au frigo" on items already covered.
    pantry_totals = PantryRepo(s).aggregate_quantity_by_ingredient()

    # 5. Hydrate + compute costs.
    items: list[ShoppingItem] = []
    total = Decimal("0.00")
    missing_count = 0
    for ing_id, total_g in qty_by_ing.items():
        ing = ingredients_by_id.get(ing_id)
        if ing is None:
            continue  # orphan reference (ingredient was deleted between week-load and now)
        cost = pricing.ingredient_cost(ing, total_g)
        if cost is None:
            missing_count += 1
        else:
            total += cost
        items.append(ShoppingItem(
            ingredient_id=ing_id,
            name=ing.name,
            source=ing.source.value,
            quantity_g=total_g,
            piece_weight_g=ing.piece_weight_g,
            category_l1=ing.category_l1,
            cost_eur=cost,
            in_pantry_g=pantry_totals.get(ing_id, 0.0),
        ))

    # 4. Sort: category first (None last), then name. Stable.
    items.sort(key=lambda i: (
        i.category_l1 is None,                       # categorized first
        (i.category_l1 or "").lower(),
        i.name.lower(),
    ))

    return ShoppingList(
        iso_week=iso_week,
        items=items,
        total_eur=total.quantize(Decimal("0.01")),
        missing_price_count=missing_count,
    )


# ============================================================ Text export


def format_as_text(shopping_list: ShoppingList) -> str:
    """Render the shopping list as plain text — copy-pasteable to a phone for
    use at the supermarket. Groups by category, includes piece count when the
    ingredient has a natural piece size, and tallies the total at the bottom."""
    if not shopping_list.items:
        return f"Liste de courses — {shopping_list.iso_week}\n\n(aucun ingrédient)\n"

    out = [f"Liste de courses — {shopping_list.iso_week}", ""]

    # Group by category (preserving the sort order set by aggregate_shopping_list).
    current_category: str | None = "__sentinel__"
    for item in shopping_list.items:
        cat = item.category_l1 or "Non catégorisé"
        if cat != current_category:
            out.append(f"== {cat.capitalize()} ==")
            current_category = cat
        out.append(_format_item_line(item))

    out.append("")
    out.append("─" * 30)
    total_str = f"{shopping_list.total_eur:.2f}".replace(".", ",")
    if shopping_list.missing_price_count > 0:
        out.append(f"Total : {total_str} € · "
                   f"{shopping_list.missing_price_count} ingrédient(s) sans prix")
    else:
        out.append(f"Total : {total_str} €")
    return "\n".join(out) + "\n"


def _format_item_line(item: ShoppingItem) -> str:
    name = item.name[:40].ljust(40)
    qty = _format_quantity(item.quantity_g, item.piece_weight_g)
    cost = ""
    if item.has_price:
        cost = f"  ({item.cost_eur:.2f} €)".replace(".", ",")
    return f"☐ {name} {qty}{cost}"


def _format_quantity(quantity_g: float, piece_weight_g: float | None) -> str:
    """Display strategy:
      - `1234 g` → `1,234 kg` if ≥ 1 kg
      - if piece_weight is set → append `(~ N pièces)` rounded to 0.1
    """
    if quantity_g >= 1000:
        kg = quantity_g / 1000
        base = f"{kg:.3f}".rstrip("0").rstrip(".").replace(".", ",") + " kg"
    else:
        base = f"{quantity_g:.0f} g" if quantity_g >= 10 else f"{quantity_g:.1f} g"

    if piece_weight_g and piece_weight_g > 0:
        pieces = quantity_g / piece_weight_g
        # Round to 0.1 then strip trailing zero
        pieces_str = f"{pieces:.1f}".rstrip("0").rstrip(".").replace(".", ",")
        return f"{base} · ≈ {pieces_str} pièce" + ("s" if pieces > 1 else "")
    return base
