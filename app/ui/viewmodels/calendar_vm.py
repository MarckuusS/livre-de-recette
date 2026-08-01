"""ViewModel for the weekly meal-plan calendar.

Phase 2: exposes a `MealPlanModel` for QML, with descriptions pre-resolved
(recipe / ingredient names looked up DB-side once per refresh, not on every
delegate render). Adds @Slot wrappers for navigation and mutations.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from PySide6.QtCore import Property, QObject, Signal, Slot
from PySide6.QtQml import QmlElement

from app.data.repositories import (
    IngredientRepo,
    MealPlanRepo,
    RecipeRepo,
    WeeklyCostRepo,
)
from app.domain import pricing
from app.domain.models import (
    Ingredient,
    IsoWeek,
    MealPlanEntry,
    MealSlot,
    NutritionTotal,
    Recipe,
    WeeklyCostSnapshot,
)
from app.services import meal_plan_service, nutrition_service
from app.ui.app_context import AppContext
from app.ui.models import MealPlanModel
from app.ui.models.meal_plan_model import MealPlanRow

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1


def _describe_with_repos(
    entry: MealPlanEntry,
    recipe_repo: RecipeRepo,
    ingredient_repo: IngredientRepo,
) -> str:
    """Same shape as the legacy `describe_entry` but reuses an open session/repo."""
    if entry.recipe_id is not None:
        recipe: Recipe | None = recipe_repo.get(entry.recipe_id)
        name = recipe.name if recipe else f"recette #{entry.recipe_id}"
        portions = entry.portions or 1.0
        if portions == 1.0:
            return f"🍽 {name} (1 portion)"
        return f"🍽 {name} ({portions:g} portions)"
    if entry.ingredient_id is not None:
        ing: Ingredient | None = ingredient_repo.get(entry.ingredient_id)
        name = ing.name if ing else f"ingrédient #{entry.ingredient_id}"
        return f"🥕 {name} ({entry.quantity_g:g} g)"
    return "?"


@QmlElement
class CalendarViewModel(QObject):
    """Owns the currently-displayed ISO week. Re-emits when entries / week change."""

    week_changed = Signal()  # ISO week or entries changed (re-render the grid)
    deletion_pending_undo = Signal(str)  # label for UndoToast (U3)

    def __init__(self, ctx: AppContext | None = None, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self._iso_week: str = IsoWeek.from_date(datetime.now()).value
        self._model = MealPlanModel(self)
        self._entries: list[MealPlanEntry] = []
        # U3 undo buffer: last removed meal plan entry, restored via repo.add()
        # with a fresh id.
        self._last_deleted: MealPlanEntry | None = None
        self._last_deleted_description: str = ""
        if ctx is not None:
            self.refresh()

    # ============================================================ QML-facing

    @Property(QObject, constant=True)
    def entries(self) -> MealPlanModel:
        return self._model

    @Property(str, notify=week_changed)
    def isoWeek(self) -> str:  # noqa: N802
        return self._iso_week

    @Slot(str)
    def setIsoWeek(self, value: str) -> None:  # noqa: N802
        self.set_iso_week(value)

    @Slot(int)
    def shiftWeek(self, weeks: int) -> None:  # noqa: N802
        self.shift_week(weeks)

    @Slot()
    def refreshWeek(self) -> None:  # noqa: N802
        self.refresh()

    @Slot(int, str, int, float)
    def addRecipe(self, day_of_week: int, slot: str, recipe_id: int, portions: float) -> None:  # noqa: N802
        self.add_recipe(day_of_week, MealSlot(slot), recipe_id, portions)

    @Slot(int, str, int, float)
    def addIngredient(self, day_of_week: int, slot: str, ingredient_id: int, quantity_g: float) -> None:  # noqa: N802
        self.add_ingredient(day_of_week, MealSlot(slot), ingredient_id, quantity_g)

    @Slot(int)
    def removeEntry(self, entry_id: int) -> None:  # noqa: N802
        self.remove(entry_id)

    @Slot(result=int)
    def copyPreviousWeek(self) -> int:  # noqa: N802
        """Append the previous week's entries to the current week. Returns the
        count copied (0 if the previous week was empty). UI is expected to show
        a confirmation prior to the call when the current week is non-empty."""
        return self.copy_previous_week()

    @Slot(result=int)
    def currentWeekEntryCount(self) -> int:  # noqa: N802
        """Used by QML to decide whether to show a confirmation dialog before
        appending the previous week's entries."""
        return len(self._entries)

    # ============================================================ C1 — Templates

    @Slot(str, result="QVariantMap")
    def saveAsTemplate(self, name: str) -> dict[str, Any]:  # noqa: N802
        """C1 : snapshot the current week under `name` (overwrites if same name).
        Returns the template descriptor as a dict, or {} on failure."""
        if self.ctx is None:
            return {}
        try:
            with self.ctx.session() as s:
                tpl = meal_plan_service.save_as_template(s, self._iso_week, name)
                s.commit()
        except ValueError as exc:
            log.warning("saveAsTemplate refused: %s", exc)
            return {}
        return {"id": tpl.id, "name": tpl.name, "entryCount": tpl.entry_count}

    @Slot(int, result=int)
    def applyTemplate(self, template_id: int) -> int:  # noqa: N802
        """C1 : append a template's entries to the current week. Returns the
        count appended. The page should confirm before calling this when the
        current week is non-empty (cf. `currentWeekEntryCount`)."""
        if self.ctx is None or template_id <= 0:
            return 0
        with self.ctx.session() as s:
            count = meal_plan_service.apply_template(s, template_id, self._iso_week)
            if count > 0:
                s.commit()
        if count > 0:
            self.refresh()
        return count

    @Slot(result="QVariantList")
    def listTemplates(self) -> list[dict[str, Any]]:  # noqa: N802
        """All saved templates, alphabetical by name. Each dict has
        `id`, `name`, `entryCount`."""
        if self.ctx is None:
            return []
        with self.ctx.session() as s:
            tpls = meal_plan_service.list_templates(s)
        return [{"id": t.id, "name": t.name, "entryCount": t.entry_count}
                for t in tpls]

    @Slot(int, result=bool)
    def deleteTemplate(self, template_id: int) -> bool:  # noqa: N802
        if self.ctx is None or template_id <= 0:
            return False
        with self.ctx.session() as s:
            ok = meal_plan_service.delete_template(s, template_id)
            if ok:
                s.commit()
        return ok

    @Slot(str, int, result="QVariantList")
    def searchOnce(self, query: str, limit: int = 12) -> list[dict[str, Any]]:  # noqa: N802
        """B6 : one-shot search across the **current week's** entries by their
        rendered description. Used by the unified Ctrl+K dialog. Returns up
        to `limit` dicts with `id`, `iso_week`, `dayOfWeek`, `slot`,
        `description` (the same string the calendar grid shows)."""
        q = (query or "").strip().casefold()
        if not q:
            return []
        out: list[dict[str, Any]] = []
        # Walk the current entries snapshot — already hydrated with description.
        m = self._entries
        from app.ui.models.meal_plan_model import MealPlanModel
        for i in range(m.rowCount()):
            idx = m.index(i, 0)
            desc = m.data(idx, MealPlanModel.DescriptionRole) or ""
            if q in desc.casefold():
                out.append({
                    "id":          m.data(idx, MealPlanModel.IdRole),
                    "isoWeek":     self._iso_week,
                    "dayOfWeek":   m.data(idx, MealPlanModel.DayOfWeekRole),
                    "slot":        m.data(idx, MealPlanModel.SlotRole),
                    "description": desc,
                })
                if len(out) >= limit:
                    break
        return out

    @Slot(int, result="QVariantMap")
    def dayTotalAsDict(self, day_of_week: int) -> dict[str, Any]:  # noqa: N802
        n = self.day_total(day_of_week)
        return _nutrition_to_dict(n)

    @Slot(result="QVariantMap")
    def weekTotalAsDict(self) -> dict[str, Any]:  # noqa: N802
        n = self.week_total()
        return _nutrition_to_dict(n)

    @Slot(result="QVariantMap")
    def weekCostAsDict(self) -> dict[str, Any]:  # noqa: N802
        total, missing = self.week_cost()
        return {"total": str(total), "missingPriceCount": missing}

    @Slot(result="QVariantList")
    def daysAsList(self) -> list[dict[str, Any]]:  # noqa: N802
        """Date de chaque jour de la semaine courante. Utilisé par le QML
        pour afficher "avril 28" au-dessus de "Lundi" dans l'entête grille.

        Retourne 7 dicts dans l'ordre Lundi=0 → Dimanche=6 :
            {dayOfWeek, dayNumber, monthShort, isoDate}

        Le mois est en libellé court FR (jan, fév, mars, …, déc) — pas la
        locale système : reste cohérent avec les libellés "Lundi/…/Dimanche"
        codés en dur ailleurs sur la page."""
        year = int(self._iso_week[:4])
        week = int(self._iso_week[6:])
        monday = datetime.fromisocalendar(year, week, 1)
        months_short = [
            "jan", "fév", "mars", "avr", "mai", "juin",
            "juil", "août", "sep", "oct", "nov", "déc",
        ]
        out: list[dict[str, Any]] = []
        for dow in range(7):
            d = monday + timedelta(days=dow)
            out.append({
                "dayOfWeek":  dow,
                "dayNumber":  d.day,
                "monthShort": months_short[d.month - 1],
                "isoDate":    d.date().isoformat(),
            })
        return out

    @Slot(int, result="QVariantList")
    def costHistoryRecent(self, weeks: int = 12) -> list[dict[str, Any]]:  # noqa: N802
        """Return the last `weeks` weekly cost snapshots, oldest first.
        Used by the mini-graph in CalendarPage (F9)."""
        if self.ctx is None:
            return []
        with self.ctx.session() as s:
            snaps = WeeklyCostRepo(s).list_recent(weeks=weeks)
        return [
            {
                "isoWeek":      sn.iso_week,
                "totalEur":     str(sn.total_eur),
                "missingCount": sn.missing_count,
            }
            for sn in snaps
        ]

    # ============================================================ Python-side

    @property
    def iso_week(self) -> str:
        return self._iso_week

    @property
    def entries_list(self) -> list[MealPlanEntry]:
        """Snapshot of the loaded entries (legacy callers used `.entries` — that
        property is now the QAbstractListModel for QML; this returns the raw list
        for Python tests / scripts)."""
        return list(self._entries)

    def set_iso_week(self, value: str) -> None:
        IsoWeek(value=value)  # validate format
        self._iso_week = value
        self.refresh()

    def shift_week(self, weeks: int) -> None:
        year = int(self._iso_week[:4])
        week = int(self._iso_week[6:])
        monday = datetime.fromisocalendar(year, week, 1)
        new_monday = monday + timedelta(weeks=weeks)
        self._iso_week = IsoWeek.from_date(new_monday).value
        self.refresh()

    def refresh(self) -> None:
        if self.ctx is None:
            return
        with self.ctx.session() as s:
            repo = MealPlanRepo(s)
            recipe_repo = RecipeRepo(s)
            ingredient_repo = IngredientRepo(s)
            self._entries = repo.list_by_week(self._iso_week)
            rows = [
                MealPlanRow(entry=e, description=_describe_with_repos(e, recipe_repo, ingredient_repo))
                for e in self._entries
            ]
        self._model.set_rows(rows)
        # F9 : auto-archive le coût courant à chaque refresh. Permet à la mini-frise
        # historique de toujours refléter l'état le plus récent de chaque semaine.
        # Ne snapshot que si la semaine a au moins une entrée — pas la peine de
        # remplir l'historique de zéros pour des semaines vides.
        if self._entries:
            self._archive_current_cost()
        self.week_changed.emit()

    def _archive_current_cost(self) -> None:
        """Upsert the current week's total cost into `weekly_cost_snapshot`."""
        if self.ctx is None:
            return
        total, missing = self.week_cost()
        with self.ctx.session() as s:
            WeeklyCostRepo(s).upsert(WeeklyCostSnapshot(
                iso_week=self._iso_week,
                total_eur=total,
                missing_count=missing,
            ))

    def entries_for(self, day_of_week: int, slot: MealSlot) -> list[MealPlanEntry]:
        return [e for e in self._entries if e.day_of_week == day_of_week and e.slot == slot]

    # -- mutations ------------------------------------------------------------

    def add_recipe(self, day_of_week: int, slot: MealSlot, recipe_id: int, portions: float = 1.0) -> None:
        if self.ctx is None:
            return
        with self.ctx.session() as s:
            MealPlanRepo(s).add(
                MealPlanEntry(
                    iso_week=self._iso_week,
                    day_of_week=day_of_week,
                    slot=slot,
                    recipe_id=recipe_id,
                    portions=portions,
                )
            )
        self.refresh()

    def add_ingredient(
        self, day_of_week: int, slot: MealSlot, ingredient_id: int, quantity_g: float
    ) -> None:
        if self.ctx is None:
            return
        with self.ctx.session() as s:
            MealPlanRepo(s).add(
                MealPlanEntry(
                    iso_week=self._iso_week,
                    day_of_week=day_of_week,
                    slot=slot,
                    ingredient_id=ingredient_id,
                    quantity_g=quantity_g,
                )
            )
        self.refresh()

    def remove(self, entry_id: int) -> None:
        if self.ctx is None:
            return
        # Snapshot for U3 undo.
        with self.ctx.session() as s:
            repo = MealPlanRepo(s)
            recipe_repo = RecipeRepo(s)
            ingredient_repo = IngredientRepo(s)
            # Find the entry in the locally-loaded list (cheaper than another query)
            target = next((e for e in self._entries if e.id == entry_id), None)
            if target is not None:
                self._last_deleted = target
                self._last_deleted_description = _describe_with_repos(
                    target, recipe_repo, ingredient_repo
                )
            repo.remove(entry_id)
        self.refresh()
        if target is not None:
            self.deletion_pending_undo.emit(f"{self._last_deleted_description} retiré")

    @Slot()
    def undoLastDelete(self) -> None:  # noqa: N802
        """Re-insert the last removed entry. New id assigned."""
        if self.ctx is None or self._last_deleted is None:
            return
        clean = self._last_deleted.model_copy(update={"id": None})
        with self.ctx.session() as s:
            MealPlanRepo(s).add(clean)
        self._last_deleted = None
        self._last_deleted_description = ""
        self.refresh()

    def copy_previous_week(self) -> int:
        """Append the previous week's entries to the current week. Returns the
        count copied. The list refreshes after."""
        if self.ctx is None:
            return 0
        with self.ctx.session() as s:
            count = meal_plan_service.copy_previous_week(s, self._iso_week)
        if count > 0:
            self.refresh()
        return count

    # -- aggregations ---------------------------------------------------------

    def day_total(self, day_of_week: int) -> NutritionTotal:
        if self.ctx is None:
            return NutritionTotal()
        with self.ctx.session() as s:
            return nutrition_service.aggregate_day(s, self._iso_week, day_of_week)

    def week_total(self) -> NutritionTotal:
        if self.ctx is None:
            return NutritionTotal()
        with self.ctx.session() as s:
            return nutrition_service.aggregate_week(s, self._iso_week)

    def week_cost(self) -> tuple[Decimal, int]:
        """Returns (total_cost_eur, count_lines_with_missing_price)."""
        if self.ctx is None:
            return Decimal("0.00"), 0
        total = Decimal("0.00")
        missing = 0
        with self.ctx.session() as s:
            ingredient_repo = IngredientRepo(s)
            recipe_repo = RecipeRepo(s)
            for entry in self._entries:
                if entry.recipe_id is not None:
                    recipe = recipe_repo.get(entry.recipe_id)
                    if recipe is None:
                        continue
                    rec_cost, rec_missing = pricing.recipe_cost(recipe)
                    factor = Decimal(str(entry.portions or 1.0)) / Decimal(
                        max(recipe.default_portions, 1)
                    )
                    total += (rec_cost * factor)
                    missing += len(rec_missing)
                elif entry.ingredient_id is not None:
                    ing = ingredient_repo.get(entry.ingredient_id)
                    if ing is None:
                        continue
                    cost = pricing.ingredient_cost(ing, entry.quantity_g or 0)
                    if cost is None:
                        missing += 1
                    else:
                        total += cost
        return total.quantize(Decimal("0.01")), missing

    # -- description helper (used by the legacy widgets — kept for backward compat) -

    def describe_entry(self, entry: MealPlanEntry) -> str:
        if self.ctx is None:
            return "?"
        with self.ctx.session() as s:
            return _describe_with_repos(entry, RecipeRepo(s), IngredientRepo(s))


def _nutrition_to_dict(n: NutritionTotal) -> dict[str, Any]:
    return {
        "kcal":          n.kcal,
        "proteins":      n.proteins_g,
        "carbs":         n.carbs_g,
        "sugars":        n.sugars_g,
        "fats":          n.fats_g,
        "saturatedFats": n.saturated_fats_g,
        "fiber":         n.fiber_g,
        "salt":          n.salt_g,
    }
