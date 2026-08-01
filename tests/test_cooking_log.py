"""Tests for the cooking log feature (C2)."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.data.repositories import CookingLogRepo, IngredientRepo, RecipeRepo
from app.domain.models import (
    CookingLogEntry,
    Ingredient,
    Recipe,
    RecipeLine,
    Source,
)


def _seed_recipe(s: Session) -> Recipe:
    ing = IngredientRepo(s).create(Ingredient(
        name="Tomate", source=Source.MANUAL, in_personal_library=True,
    ))
    return RecipeRepo(s).create(Recipe(
        name="Pâtes", default_portions=2,
        lines=[RecipeLine(ingredient=ing, quantity_g=200.0, ordinal=0)],
    ))


# ============================================================ Domain validators


def test_cooking_log_rating_in_range():
    CookingLogEntry(recipe_id=1, cooked_at=datetime(2026, 5, 1), rating=3)
    CookingLogEntry(recipe_id=1, cooked_at=datetime(2026, 5, 1), rating=None)
    with pytest.raises(Exception):
        CookingLogEntry(recipe_id=1, cooked_at=datetime(2026, 5, 1), rating=0)
    with pytest.raises(Exception):
        CookingLogEntry(recipe_id=1, cooked_at=datetime(2026, 5, 1), rating=6)


# ============================================================ Repo


def test_repo_add_and_list_descending(db_session: Session):
    recipe = _seed_recipe(db_session)
    db_session.commit()
    repo = CookingLogRepo(db_session)
    repo.add(CookingLogEntry(recipe_id=recipe.id,
                             cooked_at=datetime(2026, 1, 15)))
    repo.add(CookingLogEntry(recipe_id=recipe.id,
                             cooked_at=datetime(2026, 3, 10),
                             rating=4, notes="Excellent"))
    repo.add(CookingLogEntry(recipe_id=recipe.id,
                             cooked_at=datetime(2026, 2, 1)))
    db_session.commit()

    history = repo.list_for_recipe(recipe.id)
    # Newest first
    dates = [e.cooked_at for e in history]
    assert dates == sorted(dates, reverse=True)
    assert history[0].rating == 4
    assert history[0].notes == "Excellent"


def test_repo_count_in_window_30_days(db_session: Session):
    recipe = _seed_recipe(db_session)
    db_session.commit()
    repo = CookingLogRepo(db_session)
    now = datetime.now()
    # 3 entries within 30 days
    repo.add(CookingLogEntry(recipe_id=recipe.id, cooked_at=now - timedelta(days=2)))
    repo.add(CookingLogEntry(recipe_id=recipe.id, cooked_at=now - timedelta(days=10)))
    repo.add(CookingLogEntry(recipe_id=recipe.id, cooked_at=now - timedelta(days=25)))
    # 1 entry outside the window
    repo.add(CookingLogEntry(recipe_id=recipe.id, cooked_at=now - timedelta(days=45)))
    db_session.commit()

    assert repo.count_in_window(recipe.id, days=30) == 3
    assert repo.count_in_window(recipe.id, days=60) == 4


def test_repo_delete_returns_true(db_session: Session):
    recipe = _seed_recipe(db_session)
    db_session.commit()
    repo = CookingLogRepo(db_session)
    saved = repo.add(CookingLogEntry(recipe_id=recipe.id, cooked_at=datetime.now()))
    db_session.commit()
    assert repo.delete(saved.id) is True
    assert repo.list_for_recipe(recipe.id) == []


def test_repo_cascade_on_recipe_delete(db_session: Session):
    """Deleting a recipe cascades and clears its cooking log."""
    recipe = _seed_recipe(db_session)
    db_session.commit()
    repo = CookingLogRepo(db_session)
    repo.add(CookingLogEntry(recipe_id=recipe.id, cooked_at=datetime.now()))
    db_session.commit()
    assert len(repo.list_for_recipe(recipe.id)) == 1

    RecipeRepo(db_session).delete(recipe.id)
    db_session.commit()
    assert repo.list_for_recipe(recipe.id) == []


# ============================================================ ViewModel slots


def test_vm_add_cooking_log_returns_dict(app_ctx):
    from app.ui.viewmodels.recipe_vm import RecipeEditorViewModel
    with app_ctx.session() as s:
        recipe = _seed_recipe(s)
        s.commit()

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    saved = vm.addCookingLog({
        "cookedAtIso": "2026-05-02",
        "rating":      4,
        "notes":       "Délicieux",
    })
    assert saved["id"] is not None
    assert saved["cookedAtHuman"] == "02/05/2026"
    assert saved["rating"] == 4
    assert saved["notes"] == "Délicieux"


def test_vm_cooked_times_this_month(app_ctx):
    from app.ui.viewmodels.recipe_vm import RecipeEditorViewModel
    with app_ctx.session() as s:
        recipe = _seed_recipe(s)
        s.commit()

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    assert vm.cookedTimesThisMonth() == 0

    vm.addCookingLog({"cookedAtIso": "", "rating": 0, "notes": ""})  # = today
    vm.addCookingLog({"cookedAtIso": "", "rating": 5, "notes": ""})
    assert vm.cookedTimesThisMonth() == 2


def test_vm_no_recipe_loaded_returns_empty(app_ctx):
    from app.ui.viewmodels.recipe_vm import RecipeEditorViewModel
    vm = RecipeEditorViewModel(app_ctx)
    # No loadById → no recipe
    assert vm.cookingLogAsList() == []
    assert vm.cookedTimesThisMonth() == 0
    assert vm.addCookingLog({"cookedAtIso": "2026-05-01"}) == {}
