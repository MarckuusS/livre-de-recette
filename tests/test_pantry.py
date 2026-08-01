"""Tests for the Frigo / Cellier feature (F1).

Covers :
  - PantryRepo CRUD + aggregate
  - PantryStock domain validators
  - shopping_service integration : `in_pantry_g` is stamped on ShoppingItem
    and `is_covered_by_pantry` reflects coverage
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.data.repositories import (
    IngredientRepo,
    MealPlanRepo,
    PantryRepo,
    RecipeRepo,
)
from app.domain.models import (
    Ingredient,
    MealPlanEntry,
    MealSlot,
    PantryStock,
    Recipe,
    RecipeLine,
    Source,
)
from app.services.shopping_service import aggregate_shopping_list


def _seed_ing(s: Session, name: str = "Yaourt", price=None, qty=None) -> Ingredient:
    return IngredientRepo(s).create(Ingredient(
        name=name, source=Source.MANUAL, in_personal_library=True,
        price_eur=Decimal(price) if price else None,
        price_quantity_g=qty,
    ))


# ============================================================ Domain validators


def test_pantry_stock_quantity_must_be_positive():
    with pytest.raises(Exception):
        PantryStock(ingredient_id=1, quantity_g=0.0)
    with pytest.raises(Exception):
        PantryStock(ingredient_id=1, quantity_g=-100.0)


def test_pantry_stock_accepts_no_expiry():
    s = PantryStock(ingredient_id=1, quantity_g=200.0)
    assert s.expiry_date is None


# ============================================================ Repo


def test_repo_add_and_list(db_session: Session) -> None:
    ing = _seed_ing(db_session)
    db_session.commit()
    repo = PantryRepo(db_session)
    saved = repo.add(PantryStock(ingredient_id=ing.id, quantity_g=480.0))
    db_session.commit()
    assert saved.id is not None
    items = repo.list_all()
    assert len(items) == 1
    assert items[0].quantity_g == 480.0


def test_repo_list_orders_by_expiry_nulls_last(db_session: Session) -> None:
    ing = _seed_ing(db_session)
    db_session.commit()
    repo = PantryRepo(db_session)
    no_exp = repo.add(PantryStock(ingredient_id=ing.id, quantity_g=100.0))
    far    = repo.add(PantryStock(ingredient_id=ing.id, quantity_g=100.0,
                                  expiry_date=datetime(2026, 12, 1)))
    near   = repo.add(PantryStock(ingredient_id=ing.id, quantity_g=100.0,
                                  expiry_date=datetime(2026, 5, 5)))
    db_session.commit()

    items = repo.list_all()
    assert [i.id for i in items] == [near.id, far.id, no_exp.id]


def test_repo_aggregate_sums_per_ingredient(db_session: Session) -> None:
    a = _seed_ing(db_session, name="A")
    b = _seed_ing(db_session, name="B")
    db_session.commit()
    repo = PantryRepo(db_session)
    repo.add(PantryStock(ingredient_id=a.id, quantity_g=100.0))
    repo.add(PantryStock(ingredient_id=a.id, quantity_g=50.0))
    repo.add(PantryStock(ingredient_id=b.id, quantity_g=200.0))
    db_session.commit()

    agg = repo.aggregate_quantity_by_ingredient()
    assert agg == {a.id: 150.0, b.id: 200.0}


def test_repo_delete_returns_true_when_present(db_session: Session) -> None:
    ing = _seed_ing(db_session)
    db_session.commit()
    repo = PantryRepo(db_session)
    saved = repo.add(PantryStock(ingredient_id=ing.id, quantity_g=100.0))
    db_session.commit()
    assert repo.delete(saved.id) is True
    assert repo.list_all() == []


def test_repo_delete_returns_false_for_missing(db_session: Session) -> None:
    repo = PantryRepo(db_session)
    assert repo.delete(999) is False


def test_repo_cascade_on_ingredient_delete(db_session: Session) -> None:
    """Deleting an ingredient must cascade-clear its pantry rows."""
    ing = _seed_ing(db_session)
    db_session.commit()
    repo = PantryRepo(db_session)
    repo.add(PantryStock(ingredient_id=ing.id, quantity_g=100.0))
    db_session.commit()

    IngredientRepo(db_session).delete(ing.id)
    db_session.commit()
    assert repo.list_all() == []


def test_repo_update_changes_fields(db_session: Session) -> None:
    ing = _seed_ing(db_session)
    db_session.commit()
    repo = PantryRepo(db_session)
    saved = repo.add(PantryStock(ingredient_id=ing.id, quantity_g=100.0))
    db_session.commit()

    updated = repo.update(PantryStock(
        id=saved.id, ingredient_id=ing.id, quantity_g=250.0,
        expiry_date=datetime(2026, 5, 10), notes="Promo",
    ))
    db_session.commit()
    assert updated.quantity_g == 250.0
    assert updated.notes == "Promo"


# ============================================================ Shopping service integration


def test_shopping_aggregate_stamps_in_pantry_g(db_session: Session) -> None:
    """F1 : ShoppingItem.in_pantry_g should reflect the total stock for that
    ingredient."""
    yaourt = _seed_ing(db_session, name="Yaourt", price="2.00", qty=500.0)
    db_session.commit()

    # Add to fridge : 2 batches × 250 g = 500 g
    pantry = PantryRepo(db_session)
    pantry.add(PantryStock(ingredient_id=yaourt.id, quantity_g=250.0))
    pantry.add(PantryStock(ingredient_id=yaourt.id, quantity_g=250.0))
    db_session.commit()

    # Add a meal plan entry that needs 200 g of yaourt
    mp = MealPlanRepo(db_session)
    mp.add(MealPlanEntry(
        iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
        ingredient_id=yaourt.id, quantity_g=200.0,
    ))
    db_session.commit()

    sl = aggregate_shopping_list(db_session, "2026-W18")
    assert len(sl.items) == 1
    item = sl.items[0]
    assert item.in_pantry_g == 500.0
    assert item.quantity_g == 200.0
    # Pantry covers the need (500 ≥ 200)
    assert item.is_covered_by_pantry is True


def test_shopping_aggregate_uncovered_when_short(db_session: Session) -> None:
    yaourt = _seed_ing(db_session, name="Yaourt", price="2.00", qty=500.0)
    db_session.commit()
    PantryRepo(db_session).add(PantryStock(ingredient_id=yaourt.id, quantity_g=100.0))
    db_session.commit()
    mp = MealPlanRepo(db_session)
    mp.add(MealPlanEntry(
        iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
        ingredient_id=yaourt.id, quantity_g=300.0,
    ))
    db_session.commit()

    sl = aggregate_shopping_list(db_session, "2026-W18")
    item = sl.items[0]
    assert item.in_pantry_g == 100.0
    # Pantry insufficient (100 < 300)
    assert item.is_covered_by_pantry is False


def test_shopping_aggregate_zero_pantry_when_no_stock(db_session: Session) -> None:
    yaourt = _seed_ing(db_session, name="Yaourt", price="2.00", qty=500.0)
    db_session.commit()
    mp = MealPlanRepo(db_session)
    mp.add(MealPlanEntry(
        iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
        ingredient_id=yaourt.id, quantity_g=200.0,
    ))
    db_session.commit()

    sl = aggregate_shopping_list(db_session, "2026-W18")
    item = sl.items[0]
    assert item.in_pantry_g == 0.0
    assert item.is_covered_by_pantry is False
