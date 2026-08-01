"""Tests for `PriceHistoryRepo`.

The append-only log behaviour mirrors the user expectation: a price entry is
either there or removed, never edited in place. Listing is always sorted
ascending by `recorded_at` so the line chart in QML can render without an
extra sort step.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.data.repositories import IngredientRepo, PriceHistoryRepo
from app.domain.models import Ingredient, PriceHistoryEntry, Source


def _make_ingredient(s: Session, name: str = "Tomate") -> Ingredient:
    repo = IngredientRepo(s)
    saved = repo.create(
        Ingredient(name=name, source=Source.MANUAL, in_personal_library=True)
    )
    s.commit()
    return saved


def _entry(ingredient_id: int, price: str, qty: float, *, store: str | None = None,
           recorded_at: datetime | None = None) -> PriceHistoryEntry:
    return PriceHistoryEntry(
        ingredient_id=ingredient_id,
        price_eur=Decimal(price),
        quantity_g=qty,
        store=store,
        recorded_at=recorded_at or datetime(2026, 5, 1, 12, 0, 0),
    )


# ============================================================ add + list


def test_add_returns_entry_with_id(db_session: Session) -> None:
    ing = _make_ingredient(db_session)
    repo = PriceHistoryRepo(db_session)
    saved = repo.add(_entry(ing.id, "2.50", 250.0, store="Auchan"))
    assert saved.id is not None
    assert saved.ingredient_id == ing.id
    assert saved.price_eur == Decimal("2.50")
    assert saved.quantity_g == 250.0
    assert saved.store == "Auchan"


def test_list_returns_only_matching_ingredient(db_session: Session) -> None:
    ing_a = _make_ingredient(db_session, "Tomate")
    ing_b = _make_ingredient(db_session, "Carotte")
    repo = PriceHistoryRepo(db_session)
    repo.add(_entry(ing_a.id, "2.50", 250.0))
    repo.add(_entry(ing_b.id, "1.10", 1000.0))
    repo.add(_entry(ing_a.id, "2.40", 250.0))
    db_session.commit()

    a_history = repo.list_for_ingredient(ing_a.id)
    b_history = repo.list_for_ingredient(ing_b.id)

    assert len(a_history) == 2
    assert len(b_history) == 1
    assert all(e.ingredient_id == ing_a.id for e in a_history)


def test_list_sorted_ascending_by_recorded_at(db_session: Session) -> None:
    ing = _make_ingredient(db_session)
    repo = PriceHistoryRepo(db_session)
    repo.add(_entry(ing.id, "2.50", 250.0, recorded_at=datetime(2026, 3, 1)))
    repo.add(_entry(ing.id, "2.20", 250.0, recorded_at=datetime(2026, 1, 1)))
    repo.add(_entry(ing.id, "2.40", 250.0, recorded_at=datetime(2026, 2, 1)))
    db_session.commit()

    history = repo.list_for_ingredient(ing.id)
    dates = [e.recorded_at for e in history]
    assert dates == sorted(dates)


def test_list_empty_for_missing_ingredient(db_session: Session) -> None:
    repo = PriceHistoryRepo(db_session)
    assert repo.list_for_ingredient(999) == []


# ============================================================ delete


def test_delete_returns_true_when_present(db_session: Session) -> None:
    ing = _make_ingredient(db_session)
    repo = PriceHistoryRepo(db_session)
    saved = repo.add(_entry(ing.id, "2.50", 250.0))
    db_session.commit()

    assert repo.delete(saved.id) is True
    assert repo.list_for_ingredient(ing.id) == []


def test_delete_returns_false_when_missing(db_session: Session) -> None:
    repo = PriceHistoryRepo(db_session)
    assert repo.delete(999) is False


def test_delete_cascades_when_ingredient_deleted(db_session: Session) -> None:
    """Deleting an ingredient must cascade-clear its price history."""
    ing = _make_ingredient(db_session)
    repo = PriceHistoryRepo(db_session)
    repo.add(_entry(ing.id, "2.50", 250.0))
    repo.add(_entry(ing.id, "2.40", 250.0))
    db_session.commit()
    assert len(repo.list_for_ingredient(ing.id)) == 2

    ing_repo = IngredientRepo(db_session)
    ing_repo.delete(ing.id)
    db_session.commit()
    assert repo.list_for_ingredient(ing.id) == []


# ============================================================ list_known_stores


def test_known_stores_distinct_non_empty(db_session: Session) -> None:
    ing = _make_ingredient(db_session)
    repo = PriceHistoryRepo(db_session)
    repo.add(_entry(ing.id, "2.50", 250.0, store="Auchan"))
    repo.add(_entry(ing.id, "2.20", 250.0, store="Lidl"))
    repo.add(_entry(ing.id, "2.30", 250.0, store="Auchan"))
    repo.add(_entry(ing.id, "2.10", 250.0, store=None))
    repo.add(_entry(ing.id, "2.05", 250.0, store=""))
    db_session.commit()

    stores = repo.list_known_stores()
    assert stores == ["Auchan", "Lidl"]


def test_known_stores_empty_when_none(db_session: Session) -> None:
    repo = PriceHistoryRepo(db_session)
    assert repo.list_known_stores() == []


# ============================================================ latest_for_ingredient


def test_latest_returns_most_recent(db_session: Session) -> None:
    ing = _make_ingredient(db_session)
    repo = PriceHistoryRepo(db_session)
    repo.add(_entry(ing.id, "2.20", 250.0, recorded_at=datetime(2026, 1, 1)))
    repo.add(_entry(ing.id, "2.40", 250.0, recorded_at=datetime(2026, 3, 15)))
    repo.add(_entry(ing.id, "2.30", 250.0, recorded_at=datetime(2026, 2, 1)))
    db_session.commit()

    latest = repo.latest_for_ingredient(ing.id)
    assert latest is not None
    assert latest.price_eur == Decimal("2.40")
    assert latest.recorded_at == datetime(2026, 3, 15)


def test_latest_returns_none_when_empty(db_session: Session) -> None:
    repo = PriceHistoryRepo(db_session)
    assert repo.latest_for_ingredient(999) is None


# ============================================================ domain validation


def test_price_must_be_positive(db_session: Session) -> None:
    ing = _make_ingredient(db_session)
    with pytest.raises(Exception):  # pydantic ValidationError
        _entry(ing.id, "0.00", 250.0)


def test_quantity_must_be_positive(db_session: Session) -> None:
    ing = _make_ingredient(db_session)
    with pytest.raises(Exception):
        PriceHistoryEntry(
            ingredient_id=ing.id,
            price_eur=Decimal("2.50"),
            quantity_g=0.0,
            recorded_at=datetime(2026, 5, 1),
        )


def test_price_per_100g_property() -> None:
    e = PriceHistoryEntry(
        ingredient_id=1,
        price_eur=Decimal("2.50"),
        quantity_g=250.0,
        recorded_at=datetime(2026, 5, 1),
    )
    # 2.50 € for 250 g = 1.00 € for 100 g
    assert e.price_per_100g == Decimal("1.00")
