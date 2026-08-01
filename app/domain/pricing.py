"""Pure cost calculations. Decimal everywhere to avoid float drift on euro amounts."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from .models import Ingredient, Recipe, RecipeLine

CENT = Decimal("0.01")


def _line_cost(line: RecipeLine) -> Decimal | None:
    """Cost of one recipe line, or None if the ingredient has no price set."""
    price_per_g = line.ingredient.price_per_g
    if price_per_g is None:
        return None
    return (price_per_g * Decimal(str(line.quantity_g))).quantize(CENT, rounding=ROUND_HALF_UP)


def recipe_cost(recipe: Recipe) -> tuple[Decimal, list[RecipeLine]]:
    """Sum line costs. Returns (total, lines_without_price) so the UI can flag missing data."""
    total = Decimal("0.00")
    missing: list[RecipeLine] = []
    for line in recipe.lines:
        c = _line_cost(line)
        if c is None:
            missing.append(line)
        else:
            total += c
    return total.quantize(CENT, rounding=ROUND_HALF_UP), missing


def recipe_cost_per_portion(recipe: Recipe) -> tuple[Decimal, list[RecipeLine]]:
    total, missing = recipe_cost(recipe)
    portions = Decimal(recipe.default_portions)
    return (total / portions).quantize(CENT, rounding=ROUND_HALF_UP), missing


def ingredient_cost(ingredient: Ingredient, quantity_g: float) -> Decimal | None:
    price_per_g = ingredient.price_per_g
    if price_per_g is None:
        return None
    return (price_per_g * Decimal(str(quantity_g))).quantize(CENT, rounding=ROUND_HALF_UP)
