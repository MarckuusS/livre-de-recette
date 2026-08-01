"""Tests for the service layer (search dispatching + meal-plan aggregation)."""

from __future__ import annotations

from app.data.repositories import IngredientRepo, MealPlanRepo, RecipeRepo
from app.domain.models import (
    Ingredient,
    MealPlanEntry,
    MealSlot,
    Recipe,
    RecipeLine,
    Source,
)
from app.services import ingredient_search, nutrition_service


# --------------------------------------------------------------------------- #
# ingredient_search.search_local
# --------------------------------------------------------------------------- #


def test_search_local_returns_matches(db_session):
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(name="Tomate", source=Source.MANUAL))
    repo.create(Ingredient(name="Tomate cerise", source=Source.MANUAL))
    repo.create(Ingredient(name="Carotte", source=Source.MANUAL))

    result = ingredient_search.search_local(db_session, "tom")
    names = {m.name for m in result.matches}
    assert "Tomate" in names
    assert "Tomate cerise" in names
    assert "Carotte" not in names
    assert result.looks_like_barcode is False


def test_search_local_flags_barcode_input(db_session):
    result = ingredient_search.search_local(db_session, "3017620422003")
    assert result.is_empty
    assert result.looks_like_barcode is True


def test_search_local_eight_digit_is_barcode(db_session):
    # EAN-8 is also a real format we should accept.
    result = ingredient_search.search_local(db_session, "12345678")
    assert result.looks_like_barcode is True


def test_search_local_empty_query(db_session):
    result = ingredient_search.search_local(db_session, "  ")
    assert result.is_empty
    assert result.looks_like_barcode is False


# --------------------------------------------------------------------------- #
# nutrition_service.aggregate_entries
# --------------------------------------------------------------------------- #


def test_aggregate_recipe_via_service(db_session):
    ing_repo = IngredientRepo(db_session)
    flour = ing_repo.create(Ingredient(name="Flour", source=Source.MANUAL, kcal_per_100g=350.0))
    db_session.commit()

    recipe_repo = RecipeRepo(db_session)
    r = recipe_repo.create(
        Recipe(name="Bread", default_portions=4, lines=[RecipeLine(ingredient=flour, quantity_g=400)])
    )
    db_session.commit()

    total, per_portion = nutrition_service.aggregate_recipe(db_session, r.id)  # type: ignore[arg-type]
    assert total.kcal == 1400.0
    assert per_portion.kcal == 350.0


def test_aggregate_day_mixes_recipe_and_ingredient(db_session):
    ing_repo = IngredientRepo(db_session)
    bread = ing_repo.create(Ingredient(name="Pain", source=Source.MANUAL, kcal_per_100g=265.0))
    flour = ing_repo.create(Ingredient(name="Flour", source=Source.MANUAL, kcal_per_100g=350.0))
    db_session.commit()

    recipe_repo = RecipeRepo(db_session)
    r = recipe_repo.create(
        Recipe(
            name="Galette",
            default_portions=2,
            lines=[RecipeLine(ingredient=flour, quantity_g=200)],  # 700 kcal total, 350/portion
        )
    )
    db_session.commit()

    plan = MealPlanRepo(db_session)
    plan.add(
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=0,
            slot=MealSlot.MORNING,
            ingredient_id=bread.id,
            quantity_g=80.0,  # 80 * 265 / 100 = 212 kcal
        )
    )
    plan.add(
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=0,
            slot=MealSlot.NOON,
            recipe_id=r.id,
            portions=1.0,  # 350 kcal (one portion of the galette)
        )
    )
    plan.add(
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=1,  # different day
            slot=MealSlot.MORNING,
            ingredient_id=bread.id,
            quantity_g=80.0,
        )
    )
    db_session.commit()

    monday = nutrition_service.aggregate_day(db_session, "2026-W18", 0)
    assert abs(monday.kcal - (212.0 + 350.0)) < 1e-6

    week = nutrition_service.aggregate_week(db_session, "2026-W18")
    # Two days of bread + one galette portion
    assert abs(week.kcal - (212.0 + 350.0 + 212.0)) < 1e-6


def test_aggregate_recipe_with_two_portions(db_session):
    """Adding 2 portions of a 4-portion recipe contributes half of recipe total."""
    ing_repo = IngredientRepo(db_session)
    flour = ing_repo.create(Ingredient(name="Flour", source=Source.MANUAL, kcal_per_100g=350.0))
    db_session.commit()
    recipe_repo = RecipeRepo(db_session)
    r = recipe_repo.create(
        Recipe(name="Bread", default_portions=4, lines=[RecipeLine(ingredient=flour, quantity_g=400)])
    )  # 1400 kcal total
    db_session.commit()

    plan = MealPlanRepo(db_session)
    plan.add(
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=0,
            slot=MealSlot.NOON,
            recipe_id=r.id,
            portions=2.0,
        )
    )
    db_session.commit()

    day = nutrition_service.aggregate_day(db_session, "2026-W18", 0)
    assert abs(day.kcal - 700.0) < 1e-6  # 1400 / 4 * 2
