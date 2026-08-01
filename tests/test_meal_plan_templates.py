"""Tests for named meal-plan templates (C1).

The template stores a JSON snapshot of a week's entries (no FK to live rows).
Applying a template appends entries to a target week — the original is
preserved. Two consecutive applies stack entries (the UI confirms first).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.data.repositories import IngredientRepo, MealPlanRepo, RecipeRepo
from app.domain.models import (
    Ingredient,
    MealPlanEntry,
    MealSlot,
    Recipe,
    Source,
)
from app.services.meal_plan_service import (
    apply_template,
    delete_template,
    list_templates,
    save_as_template,
)


def _seed_ing(s: Session, name: str = "Tomate") -> Ingredient:
    return IngredientRepo(s).create(Ingredient(
        name=name, source=Source.MANUAL, in_personal_library=True,
    ))


def _seed_recipe(s: Session, ing: Ingredient, name: str = "Pâtes") -> Recipe:
    from app.domain.models import RecipeLine
    return RecipeRepo(s).create(Recipe(
        name=name, default_portions=4,
        lines=[RecipeLine(ingredient=ing, quantity_g=200.0, ordinal=0)],
    ))


def _seed_week(s: Session, iso_week: str, ing: Ingredient, recipe: Recipe) -> None:
    """Seed a representative week : 1 recipe entry + 1 ingredient entry."""
    mp = MealPlanRepo(s)
    mp.add(MealPlanEntry(
        iso_week=iso_week, day_of_week=0, slot=MealSlot.NOON,
        recipe_id=recipe.id, portions=2.0,
    ))
    mp.add(MealPlanEntry(
        iso_week=iso_week, day_of_week=2, slot=MealSlot.EVENING,
        ingredient_id=ing.id, quantity_g=150.0,
    ))


# ============================================================ Save


def test_save_as_template_snapshots_entries(db_session: Session) -> None:
    ing = _seed_ing(db_session)
    recipe = _seed_recipe(db_session, ing)
    db_session.commit()
    _seed_week(db_session, "2026-W18", ing, recipe)
    db_session.commit()

    tpl = save_as_template(db_session, "2026-W18", "Menu hiver")
    db_session.commit()

    assert tpl.id is not None
    assert tpl.name == "Menu hiver"
    assert tpl.entry_count == 2


def test_save_as_template_overwrites_existing(db_session: Session) -> None:
    """Saving twice with the same name updates the snapshot in place — no
    UNIQUE-constraint error from the user's perspective."""
    ing = _seed_ing(db_session)
    recipe = _seed_recipe(db_session, ing)
    db_session.commit()

    _seed_week(db_session, "2026-W18", ing, recipe)
    db_session.commit()
    save_as_template(db_session, "2026-W18", "Menu")
    db_session.commit()

    # Add another entry to the source week, save again under the same name
    MealPlanRepo(db_session).add(MealPlanEntry(
        iso_week="2026-W18", day_of_week=4, slot=MealSlot.NOON,
        ingredient_id=ing.id, quantity_g=80.0,
    ))
    db_session.commit()

    tpl = save_as_template(db_session, "2026-W18", "Menu")
    db_session.commit()
    assert tpl.entry_count == 3
    # And only one row in the table
    assert len(list_templates(db_session)) == 1


def test_save_as_template_rejects_empty_name(db_session: Session) -> None:
    import pytest
    with pytest.raises(ValueError):
        save_as_template(db_session, "2026-W18", "")
    with pytest.raises(ValueError):
        save_as_template(db_session, "2026-W18", "   ")


def test_save_as_template_accepts_empty_week(db_session: Session) -> None:
    """Empty week is valid : the template stores [] and applies as no-op."""
    tpl = save_as_template(db_session, "2026-W42", "Vide")
    db_session.commit()
    assert tpl.entry_count == 0


# ============================================================ Apply


def test_apply_template_appends_entries(db_session: Session) -> None:
    ing = _seed_ing(db_session)
    recipe = _seed_recipe(db_session, ing)
    db_session.commit()
    _seed_week(db_session, "2026-W18", ing, recipe)
    db_session.commit()

    tpl = save_as_template(db_session, "2026-W18", "Menu")
    db_session.commit()

    # Apply on a fresh week
    count = apply_template(db_session, tpl.id, "2026-W25")
    db_session.commit()
    assert count == 2

    target = MealPlanRepo(db_session).list_by_week("2026-W25")
    assert len(target) == 2
    # Same shape : 1 recipe entry + 1 ingredient entry
    assert sum(1 for e in target if e.recipe_id is not None) == 1
    assert sum(1 for e in target if e.ingredient_id is not None) == 1
    # Source week is unchanged
    assert len(MealPlanRepo(db_session).list_by_week("2026-W18")) == 2


def test_apply_template_appends_to_existing(db_session: Session) -> None:
    """Two applies on the same week stack entries (the UI confirms first)."""
    ing = _seed_ing(db_session)
    recipe = _seed_recipe(db_session, ing)
    db_session.commit()
    _seed_week(db_session, "2026-W18", ing, recipe)
    db_session.commit()

    tpl = save_as_template(db_session, "2026-W18", "Menu")
    db_session.commit()

    apply_template(db_session, tpl.id, "2026-W25")
    apply_template(db_session, tpl.id, "2026-W25")
    db_session.commit()

    assert len(MealPlanRepo(db_session).list_by_week("2026-W25")) == 4


def test_apply_template_zero_for_unknown_id(db_session: Session) -> None:
    assert apply_template(db_session, 99999, "2026-W25") == 0


# ============================================================ List + delete


def test_list_templates_alphabetical(db_session: Session) -> None:
    ing = _seed_ing(db_session)
    recipe = _seed_recipe(db_session, ing)
    db_session.commit()
    _seed_week(db_session, "2026-W18", ing, recipe)
    db_session.commit()

    save_as_template(db_session, "2026-W18", "Menu vacances")
    save_as_template(db_session, "2026-W18", "Menu hiver")
    save_as_template(db_session, "2026-W18", "Menu été")
    db_session.commit()

    names = [t.name for t in list_templates(db_session)]
    assert names == sorted(names)


def test_delete_template_returns_true(db_session: Session) -> None:
    ing = _seed_ing(db_session)
    recipe = _seed_recipe(db_session, ing)
    db_session.commit()
    _seed_week(db_session, "2026-W18", ing, recipe)
    db_session.commit()

    tpl = save_as_template(db_session, "2026-W18", "X")
    db_session.commit()
    assert delete_template(db_session, tpl.id) is True
    assert list_templates(db_session) == []


def test_delete_template_returns_false_for_missing(db_session: Session) -> None:
    assert delete_template(db_session, 99999) is False
