"""Tests for the weekly cost history (F9) — repo + auto-archive in CalendarVM."""

from __future__ import annotations

from decimal import Decimal

from app.data.repositories import (
    IngredientRepo,
    MealPlanRepo,
    WeeklyCostRepo,
)
from app.domain.models import (
    Ingredient,
    MealPlanEntry,
    MealSlot,
    Source,
    WeeklyCostSnapshot,
)
from app.ui.app_context import AppContext
from app.ui.viewmodels.calendar_vm import CalendarViewModel


# ============================================================ Repo


def test_weekly_cost_repo_upsert_creates_then_updates(db_session) -> None:
    repo = WeeklyCostRepo(db_session)
    repo.upsert(WeeklyCostSnapshot(
        iso_week="2026-W18", total_eur=Decimal("12.50"), missing_count=0
    ))
    snap = repo.get("2026-W18")
    assert snap is not None
    assert snap.total_eur == Decimal("12.50")

    # Update — same iso_week, different value
    repo.upsert(WeeklyCostSnapshot(
        iso_week="2026-W18", total_eur=Decimal("15.00"), missing_count=2
    ))
    snap = repo.get("2026-W18")
    assert snap.total_eur == Decimal("15.00")
    assert snap.missing_count == 2


def test_weekly_cost_repo_list_recent_oldest_first(db_session) -> None:
    repo = WeeklyCostRepo(db_session)
    for week, total in [("2026-W15", "1"), ("2026-W18", "4"),
                        ("2026-W17", "3"), ("2026-W16", "2")]:
        repo.upsert(WeeklyCostSnapshot(iso_week=week, total_eur=Decimal(total)))

    result = repo.list_recent(weeks=4)

    weeks = [s.iso_week for s in result]
    assert weeks == ["2026-W15", "2026-W16", "2026-W17", "2026-W18"]


def test_weekly_cost_repo_list_recent_caps_to_n(db_session) -> None:
    repo = WeeklyCostRepo(db_session)
    for i in range(20):
        repo.upsert(WeeklyCostSnapshot(
            iso_week=f"2026-W{i + 1:02d}", total_eur=Decimal("1.00")
        ))

    result = repo.list_recent(weeks=12)

    # Latest 12 weeks
    assert len(result) == 12
    assert result[-1].iso_week == "2026-W20"
    assert result[0].iso_week == "2026-W09"


def test_weekly_cost_repo_get_missing_returns_none(db_session) -> None:
    assert WeeklyCostRepo(db_session).get("2026-W18") is None


# ============================================================ CalendarViewModel auto-archive


def _seed_priced_ingredient(ctx: AppContext, **overrides) -> Ingredient:
    base = {
        "name": "Carotte",
        "source": Source.MANUAL,
        "price_eur": Decimal("2.00"),
        "price_quantity_g": 1000.0,
        "in_personal_library": True,
    }
    base.update(overrides)
    with ctx.session() as s:
        return IngredientRepo(s).create(Ingredient(**base))


def test_calendar_vm_auto_archives_on_refresh(app_ctx: AppContext) -> None:
    """Adding an entry triggers refresh which auto-archives the cost."""
    ing = _seed_priced_ingredient(app_ctx)  # 2 €/kg
    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    vm.add_ingredient(0, MealSlot.NOON, ing.id, quantity_g=500.0)  # 1 €

    with app_ctx.session() as s:
        snap = WeeklyCostRepo(s).get("2026-W18")
    assert snap is not None
    assert snap.total_eur == Decimal("1.00")


def test_calendar_vm_auto_archive_overwrites_previous(app_ctx: AppContext) -> None:
    """Adding more entries replaces the previous snapshot — not accumulates."""
    ing = _seed_priced_ingredient(app_ctx)
    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    vm.add_ingredient(0, MealSlot.NOON, ing.id, quantity_g=500.0)   # snap=1.00€
    vm.add_ingredient(1, MealSlot.NOON, ing.id, quantity_g=1000.0)  # snap=3.00€

    with app_ctx.session() as s:
        snap = WeeklyCostRepo(s).get("2026-W18")
    # Only one row per iso_week (PK), with the latest cost
    assert snap.total_eur == Decimal("3.00")


def test_calendar_vm_skips_archive_for_empty_weeks(app_ctx: AppContext) -> None:
    """No need to fill the history with zeros for weeks the user just navigates
    through without planning anything."""
    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W30")  # empty
    # No entry added → no snapshot
    with app_ctx.session() as s:
        assert WeeklyCostRepo(s).get("2026-W30") is None


def test_calendar_vm_cost_history_recent_returns_dicts(app_ctx: AppContext) -> None:
    ing = _seed_priced_ingredient(app_ctx)
    vm = CalendarViewModel(app_ctx)

    # Build a few weeks
    vm.set_iso_week("2026-W17")
    vm.add_ingredient(0, MealSlot.NOON, ing.id, quantity_g=500.0)
    vm.set_iso_week("2026-W18")
    vm.add_ingredient(0, MealSlot.NOON, ing.id, quantity_g=1000.0)

    history = vm.costHistoryRecent(weeks=12)

    assert len(history) == 2
    # Oldest first
    assert history[0]["isoWeek"] == "2026-W17"
    assert history[1]["isoWeek"] == "2026-W18"
    assert "totalEur" in history[0]
    assert "missingCount" in history[0]


def test_calendar_vm_cost_history_caps_at_requested_weeks(app_ctx: AppContext) -> None:
    repo = WeeklyCostRepo
    vm = CalendarViewModel(app_ctx)
    # Pre-fill 15 weeks via the repo directly (faster than setting up entries)
    with app_ctx.session() as s:
        for i in range(1, 16):
            WeeklyCostRepo(s).upsert(WeeklyCostSnapshot(
                iso_week=f"2026-W{i:02d}", total_eur=Decimal("5.00")
            ))

    history = vm.costHistoryRecent(weeks=12)

    assert len(history) == 12
    # Most recent 12 weeks (W04 to W15, oldest first)
    assert history[0]["isoWeek"] == "2026-W04"
    assert history[-1]["isoWeek"] == "2026-W15"


def test_calendar_vm_cost_history_handles_no_data(app_ctx: AppContext) -> None:
    """Empty history returns empty list — UI hides the graph in that case."""
    vm = CalendarViewModel(app_ctx)
    history = vm.costHistoryRecent(weeks=12)
    assert history == []
