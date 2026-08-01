"""Pure nutrition aggregation. All inputs come from domain models — no DB, no Qt."""

from __future__ import annotations

from .models import Ingredient, NutritionTotal, Recipe, RecipeLine


def _macros_for(ingredient: Ingredient, quantity_g: float) -> NutritionTotal:
    """Scale per-100g values to the actual quantity. Missing fields contribute 0."""
    factor = quantity_g / 100.0

    def safe(v: float | None) -> float:
        return (v or 0.0) * factor

    return NutritionTotal(
        kcal=safe(ingredient.kcal_per_100g),
        proteins_g=safe(ingredient.proteins_g),
        carbs_g=safe(ingredient.carbs_g),
        sugars_g=safe(ingredient.sugars_g),
        fats_g=safe(ingredient.fats_g),
        saturated_fats_g=safe(ingredient.saturated_fats_g),
        fiber_g=safe(ingredient.fiber_g),
        salt_g=safe(ingredient.salt_g),
    )


def aggregate_lines(lines: list[RecipeLine]) -> NutritionTotal:
    """Sum the macros of all ingredient lines."""
    total = NutritionTotal()
    for line in lines:
        total = total + _macros_for(line.ingredient, line.quantity_g)
    return total


def aggregate_recipe(recipe: Recipe) -> tuple[NutritionTotal, NutritionTotal]:
    """Return (total_for_recipe, per_portion). per_portion uses recipe.default_portions."""
    total = aggregate_lines(recipe.lines)
    per_portion = total.divided_by(recipe.default_portions)
    return total, per_portion


def ingredient_macros(ingredient: Ingredient, quantity_g: float) -> NutritionTotal:
    """Public wrapper used when a calendar entry references a raw ingredient."""
    return _macros_for(ingredient, quantity_g)
