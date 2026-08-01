"""Service-layer aggregation: load by ID, delegate to domain.nutrition for the math."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.data.repositories import IngredientRepo, MealPlanRepo, RecipeRepo
from app.domain import nutrition
from app.domain.models import MealPlanEntry, NutritionTotal


def aggregate_recipe(session: Session, recipe_id: int) -> tuple[NutritionTotal, NutritionTotal]:
    """(total, per_portion) for the recipe identified by `recipe_id`. Raises if not found."""
    recipe = RecipeRepo(session).get(recipe_id)
    if recipe is None:
        raise LookupError(f"Recipe {recipe_id} not found")
    return nutrition.aggregate_recipe(recipe)


def _scale(total: NutritionTotal, factor: float) -> NutritionTotal:
    return NutritionTotal(
        kcal=total.kcal * factor,
        proteins_g=total.proteins_g * factor,
        carbs_g=total.carbs_g * factor,
        sugars_g=total.sugars_g * factor,
        fats_g=total.fats_g * factor,
        saturated_fats_g=total.saturated_fats_g * factor,
        fiber_g=total.fiber_g * factor,
        salt_g=total.salt_g * factor,
    )


def aggregate_entries(session: Session, entries: list[MealPlanEntry]) -> NutritionTotal:
    """Sum the nutritional contribution of meal-plan entries.

    For a recipe entry with `portions=p`, contribution = (recipe_total / default_portions) * p.
    For an ingredient entry with `quantity_g=g`, contribution = ingredient_macros(ing, g).
    """
    total = NutritionTotal()
    if not entries:
        return total

    ingredient_repo = IngredientRepo(session)
    recipe_repo = RecipeRepo(session)

    for entry in entries:
        if entry.recipe_id is not None:
            recipe = recipe_repo.get(entry.recipe_id)
            if recipe is None:
                continue
            recipe_total = nutrition.aggregate_lines(recipe.lines)
            factor = (entry.portions or 1.0) / max(recipe.default_portions, 1)
            total = total + _scale(recipe_total, factor)
        elif entry.ingredient_id is not None:
            ing = ingredient_repo.get(entry.ingredient_id)
            if ing is None:
                continue
            total = total + nutrition.ingredient_macros(ing, entry.quantity_g or 0)
    return total


def aggregate_day(session: Session, iso_week: str, day_of_week: int) -> NutritionTotal:
    week = MealPlanRepo(session).list_by_week(iso_week)
    day_entries = [e for e in week if e.day_of_week == day_of_week]
    return aggregate_entries(session, day_entries)


def aggregate_week(session: Session, iso_week: str) -> NutritionTotal:
    week = MealPlanRepo(session).list_by_week(iso_week)
    return aggregate_entries(session, week)
