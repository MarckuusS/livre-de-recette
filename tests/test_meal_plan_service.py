"""Tests for `app.services.meal_plan_service`.

Covers the previous-week-copy feature (F7) — pure service-level logic, no UI.
"""

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
from app.services.meal_plan_service import (
    copy_previous_week,
    copy_week,
    previous_iso_week,
)


# ============================================================ previous_iso_week


def test_previous_iso_week_normal() -> None:
    assert previous_iso_week("2026-W18") == "2026-W17"
    assert previous_iso_week("2026-W02") == "2026-W01"


def test_previous_iso_week_year_boundary() -> None:
    """Crossing into the previous year — '2026-W01' should yield '2025-W53'
    (or W52 if 2025 isn't a 53-week year). We just check the year decrements
    and the week is the LAST week of the previous year."""
    prev = previous_iso_week("2026-W01")
    assert prev.startswith("2025-W")
    week_num = int(prev[6:])
    assert week_num in (52, 53)


# ============================================================ copy_week


def _seed_basics(db_session) -> tuple[Ingredient, Recipe]:
    """Create one ingredient + one recipe to use in mealplan entries."""
    ing = IngredientRepo(db_session).create(
        Ingredient(name="Carotte", source=Source.MANUAL, in_personal_library=True)
    )
    line = RecipeLine(ingredient=ing, quantity_g=100.0, ordinal=0)
    recipe = RecipeRepo(db_session).create(Recipe(name="Salade", lines=[line]))
    return ing, recipe


def test_copy_week_empty_source_returns_zero(db_session) -> None:
    _seed_basics(db_session)
    count = copy_week(db_session, "2026-W17", "2026-W18")
    assert count == 0
    assert MealPlanRepo(db_session).list_by_week("2026-W18") == []


def test_copy_week_copies_recipe_and_ingredient_entries(db_session) -> None:
    ing, recipe = _seed_basics(db_session)
    repo = MealPlanRepo(db_session)
    # Source: 2 recipe entries + 1 ingredient entry
    repo.add(MealPlanEntry(iso_week="2026-W17", day_of_week=0, slot=MealSlot.NOON,
                           recipe_id=recipe.id, portions=1.0))
    repo.add(MealPlanEntry(iso_week="2026-W17", day_of_week=2, slot=MealSlot.EVENING,
                           recipe_id=recipe.id, portions=2.0))
    repo.add(MealPlanEntry(iso_week="2026-W17", day_of_week=4, slot=MealSlot.MORNING,
                           ingredient_id=ing.id, quantity_g=80.0))

    count = copy_week(db_session, "2026-W17", "2026-W18")

    assert count == 3
    src = repo.list_by_week("2026-W17")
    dst = repo.list_by_week("2026-W18")
    assert len(src) == 3  # source untouched
    assert len(dst) == 3
    # Entries in dst landed in the same (day, slot) cells
    dst_cells = {(e.day_of_week, e.slot.value) for e in dst}
    src_cells = {(e.day_of_week, e.slot.value) for e in src}
    assert dst_cells == src_cells


def test_copy_week_preserves_kind_and_quantities(db_session) -> None:
    ing, recipe = _seed_basics(db_session)
    repo = MealPlanRepo(db_session)
    repo.add(MealPlanEntry(iso_week="2026-W17", day_of_week=1, slot=MealSlot.NOON,
                           recipe_id=recipe.id, portions=2.5))
    repo.add(MealPlanEntry(iso_week="2026-W17", day_of_week=3, slot=MealSlot.MORNING,
                           ingredient_id=ing.id, quantity_g=120.5))

    copy_week(db_session, "2026-W17", "2026-W18")

    dst = repo.list_by_week("2026-W18")
    by_day = {e.day_of_week: e for e in dst}
    assert by_day[1].recipe_id == recipe.id
    assert by_day[1].portions == 2.5
    assert by_day[1].ingredient_id is None
    assert by_day[3].ingredient_id == ing.id
    assert by_day[3].quantity_g == 120.5
    assert by_day[3].recipe_id is None


def test_copy_week_appends_no_replace(db_session) -> None:
    """If dst already has entries, copy_week appends (caller's responsibility
    to clear if they want a clean copy)."""
    ing, _ = _seed_basics(db_session)
    repo = MealPlanRepo(db_session)
    repo.add(MealPlanEntry(iso_week="2026-W17", day_of_week=0, slot=MealSlot.NOON,
                           ingredient_id=ing.id, quantity_g=100.0))
    # Pre-existing entry in dst
    repo.add(MealPlanEntry(iso_week="2026-W18", day_of_week=5, slot=MealSlot.MORNING,
                           ingredient_id=ing.id, quantity_g=50.0))

    count = copy_week(db_session, "2026-W17", "2026-W18")

    assert count == 1
    dst = repo.list_by_week("2026-W18")
    assert len(dst) == 2  # 1 pre-existing + 1 copied


def test_copy_week_same_src_dst_is_noop(db_session) -> None:
    """Guard against the 'oops I doubled the current week' footgun."""
    ing, _ = _seed_basics(db_session)
    repo = MealPlanRepo(db_session)
    repo.add(MealPlanEntry(iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
                           ingredient_id=ing.id, quantity_g=100.0))

    count = copy_week(db_session, "2026-W18", "2026-W18")

    assert count == 0
    assert len(repo.list_by_week("2026-W18")) == 1  # still 1, not doubled


def test_copy_week_creates_independent_entries(db_session) -> None:
    """The copies must be NEW rows with fresh ids — deleting one in dst must
    not affect the source."""
    ing, _ = _seed_basics(db_session)
    repo = MealPlanRepo(db_session)
    repo.add(MealPlanEntry(iso_week="2026-W17", day_of_week=0, slot=MealSlot.NOON,
                           ingredient_id=ing.id, quantity_g=100.0))

    copy_week(db_session, "2026-W17", "2026-W18")

    src = repo.list_by_week("2026-W17")
    dst = repo.list_by_week("2026-W18")
    assert src[0].id != dst[0].id
    # Delete the copy
    repo.remove(dst[0].id)
    assert len(repo.list_by_week("2026-W17")) == 1
    assert len(repo.list_by_week("2026-W18")) == 0


# ============================================================ copy_previous_week (wrapper)


def test_copy_previous_week_uses_iso_week_minus_one(db_session) -> None:
    ing, _ = _seed_basics(db_session)
    repo = MealPlanRepo(db_session)
    repo.add(MealPlanEntry(iso_week="2026-W17", day_of_week=0, slot=MealSlot.NOON,
                           ingredient_id=ing.id, quantity_g=100.0))

    count = copy_previous_week(db_session, "2026-W18")

    assert count == 1
    assert len(repo.list_by_week("2026-W18")) == 1


def test_copy_previous_week_empty_returns_zero(db_session) -> None:
    """No entries in the previous week → returns 0, dst stays empty."""
    _seed_basics(db_session)
    count = copy_previous_week(db_session, "2026-W18")
    assert count == 0
    assert MealPlanRepo(db_session).list_by_week("2026-W18") == []
