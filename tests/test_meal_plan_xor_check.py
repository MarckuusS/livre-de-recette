"""Tests for the CHECK constraint on `meal_plan_entry` (A5).

The XOR rule (exactly one of `recipe_id`/`ingredient_id` is set) is now
enforced in three places :
  - Pydantic `MealPlanEntry._exclusive_target` (in-memory)
  - SQLAlchemy `MealPlanEntryRow.__table_args__.CheckConstraint` (new tables)
  - Inline migration `_migrate_add_meal_plan_entry_xor_check` (existing DBs
    that predate the constraint)
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.data.db import init_schema, make_engine, make_session_factory


# ============================================================ Constraint enforced on fresh DBs


def test_xor_check_rejects_both_null(db_session: Session) -> None:
    """A row with both recipe_id and ingredient_id NULL must be rejected."""
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO meal_plan_entry "
                "(iso_week, day_of_week, slot, ordinal) "
                "VALUES ('2026-W18', 0, 'noon', 0)"
            )
        )
        db_session.commit()


def test_xor_check_rejects_both_set(db_session: Session) -> None:
    """A row with BOTH recipe_id and ingredient_id set must be rejected."""
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO meal_plan_entry "
                "(iso_week, day_of_week, slot, recipe_id, ingredient_id, "
                " quantity_g, portions, ordinal) "
                "VALUES ('2026-W18', 0, 'noon', 1, 2, 100, 1.0, 0)"
            )
        )
        db_session.commit()


def test_xor_check_accepts_recipe_only(db_session: Session) -> None:
    """A row with only recipe_id set is valid."""
    # Need a recipe to satisfy the FK
    db_session.execute(text(
        "INSERT INTO recipe (id, name, default_portions, instructions) "
        "VALUES (1, 'X', 1, '')"
    ))
    db_session.execute(
        text(
            "INSERT INTO meal_plan_entry "
            "(iso_week, day_of_week, slot, recipe_id, portions, ordinal) "
            "VALUES ('2026-W18', 0, 'noon', 1, 1.0, 0)"
        )
    )
    db_session.commit()
    count = db_session.execute(text("SELECT COUNT(*) FROM meal_plan_entry")).scalar()
    assert count == 1


# ============================================================ Migration on legacy DB without CHECK


def test_migration_recreates_table_with_check_on_legacy_db(tmp_path: Path) -> None:
    """If a DB was created before the CHECK was added (no constraint in
    `sqlite_master.sql`), `init_schema()` must recreate the table with the
    constraint, preserving valid rows."""
    db_path = tmp_path / "legacy.db"

    # 1) Simulate a legacy DB : create meal_plan_entry WITHOUT the CHECK
    raw = sqlite3.connect(str(db_path))
    raw.executescript("""
        CREATE TABLE recipe (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                             default_portions INTEGER, instructions TEXT,
                             image_path TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE ingredient (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                                 source TEXT, source_ref TEXT,
                                 kcal_per_100g REAL, proteins_g REAL, carbs_g REAL,
                                 sugars_g REAL, fats_g REAL, saturated_fats_g REAL,
                                 fiber_g REAL, salt_g REAL,
                                 price_eur NUMERIC, price_quantity_g REAL,
                                 piece_weight_g REAL, in_personal_library INTEGER NOT NULL DEFAULT 0,
                                 category_l1 TEXT, category_l2 TEXT,
                                 created_at TEXT, updated_at TEXT);
        CREATE TABLE meal_plan_entry (
            id INTEGER NOT NULL PRIMARY KEY,
            iso_week VARCHAR(8) NOT NULL, day_of_week INTEGER NOT NULL,
            slot VARCHAR(10) NOT NULL,
            recipe_id INTEGER, ingredient_id INTEGER,
            quantity_g FLOAT, portions FLOAT, ordinal INTEGER NOT NULL,
            FOREIGN KEY(recipe_id) REFERENCES recipe(id) ON DELETE CASCADE,
            FOREIGN KEY(ingredient_id) REFERENCES ingredient(id) ON DELETE CASCADE
        );
        INSERT INTO recipe (id, name, default_portions) VALUES (1, 'Chili', 4);
        INSERT INTO meal_plan_entry (iso_week, day_of_week, slot, recipe_id,
                                     portions, ordinal)
        VALUES ('2026-W18', 0, 'noon', 1, 1.0, 0);
    """)
    raw.commit()
    # Sanity : confirm the legacy table has NO CHECK
    sql = raw.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='meal_plan_entry'"
    ).fetchone()[0]
    assert "ck_meal_plan_entry_xor" not in sql
    raw.close()

    # 2) Run init_schema on the legacy DB → migration should fire
    engine = make_engine(f"sqlite:///{db_path.as_posix()}")
    init_schema(engine)

    # 3) Verify the constraint is now present
    factory = make_session_factory(engine)
    with factory() as s:
        sql = s.execute(
            text(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='meal_plan_entry'"
            )
        ).scalar()
        assert "ck_meal_plan_entry_xor" in sql, (
            "Migration should have added the CHECK constraint"
        )

        # 4) Existing valid row preserved
        count = s.execute(text("SELECT COUNT(*) FROM meal_plan_entry")).scalar()
        assert count == 1

        # 5) New invalid row rejected
        with pytest.raises(IntegrityError):
            s.execute(
                text(
                    "INSERT INTO meal_plan_entry "
                    "(iso_week, day_of_week, slot, ordinal) "
                    "VALUES ('2026-W19', 0, 'noon', 0)"
                )
            )
            s.commit()
    engine.dispose()


def test_migration_idempotent(db_session: Session) -> None:
    """Re-running init_schema on a DB that already has the CHECK is a no-op."""
    # The db_session fixture already ran init_schema once. Run it again.
    from app.data.db import _migrate_add_meal_plan_entry_xor_check
    _migrate_add_meal_plan_entry_xor_check(db_session.connection())
    # Constraint still in place
    sql = db_session.execute(
        text("SELECT sql FROM sqlite_master WHERE type='table' AND name='meal_plan_entry'")
    ).scalar()
    assert "ck_meal_plan_entry_xor" in sql
