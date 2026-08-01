"""MealPlanRepo : CRUD on `meal_plan_entry` rows (the calendar grid)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import MealPlanEntry

from ..orm import MealPlanEntryRow
from ._mappers import _entry_to_domain


class MealPlanRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def list_by_week(self, iso_week: str) -> list[MealPlanEntry]:
        stmt = (
            select(MealPlanEntryRow)
            .where(MealPlanEntryRow.iso_week == iso_week)
            .order_by(
                MealPlanEntryRow.day_of_week,
                MealPlanEntryRow.slot,
                MealPlanEntryRow.ordinal,
            )
        )
        return [_entry_to_domain(r) for r in self.s.execute(stmt).scalars()]

    def add(self, entry: MealPlanEntry) -> MealPlanEntry:
        row = MealPlanEntryRow(
            iso_week=entry.iso_week,
            day_of_week=entry.day_of_week,
            slot=entry.slot.value,
            recipe_id=entry.recipe_id,
            ingredient_id=entry.ingredient_id,
            quantity_g=entry.quantity_g,
            portions=entry.portions,
            ordinal=entry.ordinal,
        )
        self.s.add(row)
        self.s.flush()
        return _entry_to_domain(row)

    def remove(self, entry_id: int) -> None:
        row = self.s.get(MealPlanEntryRow, entry_id)
        if row is not None:
            self.s.delete(row)
            self.s.flush()
