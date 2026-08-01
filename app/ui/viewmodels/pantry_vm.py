"""ViewModel for the Frigo / Cellier inventory page (F1).

Owns the `PantryListModel` and exposes :
  - `items` Property → QML ListView
  - `addStock(ingredient_id, quantity_g, expiry_iso, notes)` slot
  - `updateStock(stock_id, ...)` slot
  - `deleteStock(stock_id)` slot
  - `refresh()` slot

The shopping page reads the same `pantry_stock` table indirectly via
`shopping_service.aggregate_shopping_list` which calls
`PantryRepo.aggregate_quantity_by_ingredient` to compute per-ingredient
totals — used to pre-tick "déjà au frigo".
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from PySide6.QtCore import Property, QObject, Signal, Slot
from PySide6.QtQml import QmlElement

from app.data.repositories import IngredientRepo, PantryRepo
from app.domain.models import PantryStock
from app.ui.app_context import AppContext
from app.ui.models import PantryListModel, PantryRow

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1

log = logging.getLogger(__name__)


def _parse_expiry_iso(s: str | None) -> datetime | None:
    """Parse an ISO date string ("YYYY-MM-DD" or with time) into a datetime.
    Empty / falsy returns None — meaning "no expiry tracked"."""
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    try:
        # Accept "YYYY-MM-DD" by appending midnight, or ISO datetime as-is.
        if len(s) == 10:
            return datetime.fromisoformat(s + "T00:00:00")
        d = datetime.fromisoformat(s.replace("Z", "+00:00").rstrip("Z"))
        if d.tzinfo is not None:
            d = d.replace(tzinfo=None)
        return d
    except ValueError:
        log.warning("Invalid expiry ISO date: %r", s)
        return None


@QmlElement
class PantryViewModel(QObject):
    """Drives the Frigo / Cellier page (F1)."""

    items_changed = Signal()
    error_emitted = Signal(str)
    # Emitted after add/update/delete so the ShoppingPage can refresh too —
    # its "déjà au frigo" pre-coche depends on pantry totals.
    stock_changed = Signal()
    # Refonte UX (Phase 4) : émis quand sort/filter/group change pour que QML
    # rafraîchisse les bindings (notamment `section.property` de la ListView).
    view_options_changed = Signal()

    # Refonte Phase 4 — Options d'affichage (par défaut : comportement legacy)
    SORT_FIELDS = ("urgency", "name", "quantity", "expiry", "category")
    GROUP_FIELDS = ("urgency", "category", "none")

    def __init__(self, ctx: AppContext | None = None, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self._items = PantryListModel(self)
        # Refonte Phase 4 — état d'affichage
        self._sort_by: str = "urgency"
        self._group_by: str = "urgency"
        self._filter_text: str = ""
        self.refresh()

    @Property(QObject, constant=True)
    def items(self) -> PantryListModel:
        return self._items

    # ------------------------------------------------------------ Properties Phase 4

    @Property(str, notify=view_options_changed)
    def sortBy(self) -> str:  # noqa: N802
        return self._sort_by

    @Property(str, notify=view_options_changed)
    def groupBy(self) -> str:  # noqa: N802
        return self._group_by

    @Property(str, notify=view_options_changed)
    def filterText(self) -> str:  # noqa: N802
        return self._filter_text

    # ------------------------------------------------------------ Slots

    @Slot()
    def refreshList(self) -> None:  # noqa: N802
        self.refresh()

    @Slot(str)
    def setSortBy(self, field: str) -> None:  # noqa: N802
        if field not in self.SORT_FIELDS or field == self._sort_by:
            return
        self._sort_by = field
        self.view_options_changed.emit()
        self.refresh()

    @Slot(str)
    def setGroupBy(self, field: str) -> None:  # noqa: N802
        if field not in self.GROUP_FIELDS or field == self._group_by:
            return
        self._group_by = field
        self.view_options_changed.emit()
        # Pas besoin de re-fetch DB — juste re-trier (le groupement est côté QML
        # via `section.property`). Mais on refresh quand même pour cohérence
        # avec l'ordre du tri si l'user veut "tri par catégorie".
        self.refresh()

    @Slot(str)
    def setFilter(self, text: str) -> None:  # noqa: N802
        new_filter = (text or "").strip().casefold()
        if new_filter == self._filter_text:
            return
        self._filter_text = new_filter
        self.view_options_changed.emit()
        self.refresh()

    def refresh(self) -> None:
        if self.ctx is None:
            self._items.set_items([])
            return
        with self.ctx.session() as s:
            pantry = PantryRepo(s).list_all()
            ing_ids = {p.ingredient_id for p in pantry}
            ing_repo = IngredientRepo(s)
            ingredients_by_id = ing_repo.list_by_ids(ing_ids)

        rows: list[PantryRow] = []
        for stock in pantry:
            ing = ingredients_by_id.get(stock.ingredient_id)
            if ing is None:
                # Orphan : ingredient was deleted but cascade should have killed
                # the stock too. Defensive skip.
                continue
            row = PantryRow(
                stock=stock,
                ingredient_name=ing.name,
                ingredient_source=ing.source.value,
                category_l1=ing.category_l1,
                piece_weight_g=ing.piece_weight_g,
            )
            # Refonte Phase 4 : filtre texte sur le nom (case insensitive)
            if self._filter_text and self._filter_text not in row.ingredient_name.casefold():
                continue
            rows.append(row)

        # Refonte Phase 4 : tri selon `_sort_by`
        rows = self._apply_sort(rows)

        self._items.set_items(rows)
        self.items_changed.emit()

    def _apply_sort(self, rows: list[PantryRow]) -> list[PantryRow]:
        """Tri en place selon `_sort_by`. Tous les tris poussent les valeurs
        None à la fin (pas d'expiry = stock long terme = pas urgent)."""

        def _expiry_key(r: PantryRow) -> tuple:
            d = r.days_until_expiry
            return (1, 0) if d is None else (0, d)

        def _category_key(r: PantryRow) -> tuple:
            cat = (r.category_l1 or "~~~").casefold()
            return (cat, r.ingredient_name.casefold())

        if self._sort_by == "urgency":
            # Plus urgent d'abord (faible days_until_expiry), puis nom alpha
            return sorted(rows, key=lambda r: (_expiry_key(r), r.ingredient_name.casefold()))
        if self._sort_by == "name":
            return sorted(rows, key=lambda r: r.ingredient_name.casefold())
        if self._sort_by == "quantity":
            return sorted(rows, key=lambda r: -r.stock.quantity_g)
        if self._sort_by == "expiry":
            return sorted(rows, key=_expiry_key)
        if self._sort_by == "category":
            return sorted(rows, key=_category_key)
        return rows

    @Slot("QVariantMap", result="QVariantMap")
    def addStock(self, payload: dict[str, Any]) -> dict[str, Any]:  # noqa: N802
        """Add a stock entry. Payload :
        `ingredientId` (int, required), `quantityG` (float > 0),
        `expiryIso` (str | "", optional), `notes` (str | "", optional)."""
        if self.ctx is None:
            return {}
        try:
            ingredient_id = int(payload.get("ingredientId") or 0)
            quantity_g = float(payload.get("quantityG") or 0)
            stock = PantryStock(
                ingredient_id=ingredient_id,
                quantity_g=quantity_g,
                expiry_date=_parse_expiry_iso(payload.get("expiryIso")),
                notes=(payload.get("notes") or "").strip() or None,
            )
        except Exception as exc:
            log.warning("addStock: invalid payload %r: %s", payload, exc)
            self.error_emitted.emit(str(exc))
            return {}

        with self.ctx.session() as s:
            saved = PantryRepo(s).add(stock)
            s.commit()
        self.refresh()
        self.stock_changed.emit()
        return _stock_to_dict(saved)

    @Slot("QVariantMap", result="QVariantMap")
    def updateStock(self, payload: dict[str, Any]) -> dict[str, Any]:  # noqa: N802
        """Update an existing stock entry's quantity / expiry / notes.
        `id` is required."""
        if self.ctx is None:
            return {}
        stock_id = int(payload.get("id") or 0)
        if stock_id <= 0:
            return {}
        with self.ctx.session() as s:
            existing = PantryRepo(s).get(stock_id)
            if existing is None:
                return {}
            try:
                updated = PantryStock(
                    id=existing.id,
                    ingredient_id=existing.ingredient_id,
                    quantity_g=float(payload.get("quantityG") or existing.quantity_g),
                    expiry_date=_parse_expiry_iso(payload.get("expiryIso"))
                                if "expiryIso" in payload
                                else existing.expiry_date,
                    notes=(payload.get("notes") or "").strip() or None
                          if "notes" in payload else existing.notes,
                )
            except Exception as exc:
                log.warning("updateStock: invalid payload %r: %s", payload, exc)
                self.error_emitted.emit(str(exc))
                return {}
            saved = PantryRepo(s).update(updated)
            s.commit()
        self.refresh()
        self.stock_changed.emit()
        return _stock_to_dict(saved)

    @Slot(int, result=bool)
    def deleteStock(self, stock_id: int) -> bool:  # noqa: N802
        if self.ctx is None or stock_id <= 0:
            return False
        with self.ctx.session() as s:
            ok = PantryRepo(s).delete(stock_id)
            if ok:
                s.commit()
        if ok:
            self.refresh()
            self.stock_changed.emit()
        return ok

    # ------------------------------------------------------------ Counters (Property)

    @Property(int, notify=items_changed)
    def soonExpiringCount(self) -> int:  # noqa: N802
        """Number of items expiring in ≤ 5 days. Drives the badge on the
        page header (e.g. "À consommer vite : 3")."""
        return sum(
            1 for r in self._items.items()
            if r.days_until_expiry is not None
            and r.days_until_expiry <= PantryListModel.SOON_THRESHOLD_DAYS
        )

    @Property(int, notify=items_changed)
    def totalCount(self) -> int:  # noqa: N802
        return self._items.rowCount()


def _stock_to_dict(s: PantryStock | None) -> dict[str, Any]:
    if s is None:
        return {}
    return {
        "id":           s.id,
        "ingredientId": s.ingredient_id,
        "quantityG":    s.quantity_g,
        "expiryIso":    s.expiry_date.date().isoformat() if s.expiry_date else "",
        "notes":        s.notes or "",
    }
