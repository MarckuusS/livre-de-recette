"""Tests for ingredient seasonality (C3)."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.data.repositories import IngredientRepo
from app.domain.models import Ingredient, Source
from app.ui.viewmodels.ingredient_vm import _ing_to_dict, _parse_season_months


# ============================================================ CSV parsing


def test_parse_empty_returns_empty_set():
    assert _parse_season_months(None) == set()
    assert _parse_season_months("") == set()
    assert _parse_season_months("   ") == set()


def test_parse_well_formed():
    assert _parse_season_months("6,7,8,9") == {6, 7, 8, 9}


def test_parse_strips_whitespace_and_skips_invalid():
    assert _parse_season_months("1, 2, 3,bad,5,") == {1, 2, 3, 5}


def test_parse_clamps_out_of_range():
    """Months outside 1..12 are silently dropped (defensive against a corrupted CSV)."""
    assert _parse_season_months("0,13,5,99") == {5}


# ============================================================ _ing_to_dict


def test_ing_to_dict_in_season_now_true_when_current_month_in_csv():
    # Use a fixed datetime so the test is deterministic regardless of clock.
    with patch("app.ui.viewmodels.ingredient_vm.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2026, 7, 15)  # juillet
        ing = Ingredient(name="Tomate", season_months="6,7,8,9")
        d = _ing_to_dict(ing)
    assert d["inSeasonNow"] is True
    assert d["hasSeasonality"] is True
    assert d["seasonMonths"] == "6,7,8,9"


def test_ing_to_dict_in_season_now_false_when_out_of_season():
    with patch("app.ui.viewmodels.ingredient_vm.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2026, 1, 15)
        ing = Ingredient(name="Tomate", season_months="6,7,8,9")
        d = _ing_to_dict(ing)
    assert d["inSeasonNow"] is False
    assert d["hasSeasonality"] is True


def test_ing_to_dict_no_seasonality_when_null():
    ing = Ingredient(name="Sel", season_months=None)
    d = _ing_to_dict(ing)
    assert d["inSeasonNow"] is False
    assert d["hasSeasonality"] is False
    assert d["seasonMonths"] == ""


# ============================================================ Seeder


def test_seeder_stamps_known_ingredient(db_session: Session) -> None:
    """C3 : after `init_schema()` — which the db_session fixture runs — known
    ingredients should have `season_months` set even if seeded with NULL.
    Insert a CIQUAL-style "Tomate, crue" row that mimics a CIQUAL seed, then
    re-run the seeder and check it got a value."""
    repo = IngredientRepo(db_session)
    saved = repo.create(Ingredient(
        name="Tomate, crue", source=Source.CIQUAL, in_personal_library=False,
    ))
    db_session.commit()
    # Initially NULL (we just created it, the seeder ran during init_schema
    # *before* the row existed)
    assert saved.season_months is None

    # Re-run the seeder
    from app.data.db import _seed_seasonality
    _seed_seasonality(db_session.connection())
    db_session.commit()

    refetched = repo.get(saved.id)
    assert refetched is not None
    assert refetched.season_months == "6,7,8,9,10"  # tomate


def test_seeder_idempotent_keeps_user_override(db_session: Session) -> None:
    """A user-edited season_months must not be overwritten by re-seeding."""
    repo = IngredientRepo(db_session)
    saved = repo.create(Ingredient(
        name="Tomate, crue", source=Source.CIQUAL, in_personal_library=False,
        season_months="3,4,5",  # user override (unrealistic but tests the guard)
    ))
    db_session.commit()
    assert saved.season_months == "3,4,5"

    from app.data.db import _seed_seasonality
    _seed_seasonality(db_session.connection())
    db_session.commit()

    refetched = repo.get(saved.id)
    assert refetched.season_months == "3,4,5"   # untouched


def test_seeder_skips_unknown_names(db_session: Session) -> None:
    """An ingredient whose name doesn't match any pattern stays NULL."""
    repo = IngredientRepo(db_session)
    saved = repo.create(Ingredient(
        name="Inconnu xyz", source=Source.MANUAL, in_personal_library=True,
    ))
    db_session.commit()

    from app.data.db import _seed_seasonality
    _seed_seasonality(db_session.connection())
    db_session.commit()

    refetched = repo.get(saved.id)
    assert refetched.season_months is None


# ============================================================ Migration


def test_migration_adds_column(db_session: Session) -> None:
    """The `season_months` column should be present after init_schema (the
    db_session fixture already ran it)."""
    cols = {row[1] for row in db_session.execute(text("PRAGMA table_info(ingredient)"))}
    assert "season_months" in cols
