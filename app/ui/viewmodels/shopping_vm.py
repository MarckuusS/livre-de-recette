"""ViewModel for the shopping list page (F1).

Sa propre `iso_week` (indépendante de CalendarViewModel) — l'utilisateur peut
préparer sa liste de courses pour une semaine différente de celle qu'il consulte
sur le calendrier. Slots `setIsoWeek`, `shiftWeek`, `refresh` symétriques avec
ceux de CalendarViewModel.

L'agrégation passe par `app.services.shopping_service.aggregate_shopping_list`
— pas de logique métier ici, juste de l'orchestration.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from PySide6.QtCore import Property, QObject, Signal, Slot
from PySide6.QtGui import QClipboard, QGuiApplication
from PySide6.QtQml import QmlElement

from app.domain.models import IsoWeek
from app.services import shopping_service
from app.ui.app_context import AppContext
from app.ui.models import ShoppingListModel

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1

log = logging.getLogger(__name__)


@QmlElement
class ShoppingViewModel(QObject):
    """Shopping list for one ISO week. Recomputes on demand (refresh / week
    change / external trigger from CalendarViewModel)."""

    week_changed = Signal()
    list_changed = Signal()  # items / total / missing count refreshed

    def __init__(self, ctx: AppContext | None = None, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self._iso_week: str = IsoWeek.from_date(datetime.now()).value
        self._model = ShoppingListModel(self)
        self._total_eur: str = "0.00"
        self._missing_price_count: int = 0
        if ctx is not None:
            self.refresh()

    # ============================================================ QML-facing

    @Property(QObject, constant=True)
    def items(self) -> ShoppingListModel:
        return self._model

    @Property(str, notify=week_changed)
    def isoWeek(self) -> str:  # noqa: N802
        return self._iso_week

    @Property(str, notify=list_changed)
    def totalEur(self) -> str:  # noqa: N802
        return self._total_eur

    @Property(int, notify=list_changed)
    def missingPriceCount(self) -> int:  # noqa: N802
        return self._missing_price_count

    @Property(int, notify=list_changed)
    def itemCount(self) -> int:  # noqa: N802
        return self._model.rowCount()

    @Slot(str)
    def setIsoWeek(self, value: str) -> None:  # noqa: N802
        self.set_iso_week(value)

    @Slot(int)
    def shiftWeek(self, weeks: int) -> None:  # noqa: N802
        self.shift_week(weeks)

    @Slot()
    def refreshList(self) -> None:  # noqa: N802
        self.refresh()

    @Slot(int, bool)
    def setInFridge(self, ingredient_id: int, in_fridge: bool) -> None:  # noqa: N802
        """Toggle the local 'déjà au frigo' state for one row. Not persisted —
        cleared on every refresh."""
        # Find the row and use setData to keep the model's dataChanged signal in play.
        for row in range(self._model.rowCount()):
            idx = self._model.index(row, 0)
            current_id = self._model.data(idx, ShoppingListModel.IngredientIdRole)
            if current_id == ingredient_id:
                self._model.setData(idx, in_fridge, ShoppingListModel.InFridgeRole)
                return

    @Slot(result=str)
    def asText(self) -> str:  # noqa: N802
        """Return the shopping list as a plain-text block (for external display
        — copy-paste, mail, SMS). Cf. `shopping_service.format_as_text`."""
        if self.ctx is None:
            return ""
        with self.ctx.session() as s:
            shopping_list = shopping_service.aggregate_shopping_list(s, self._iso_week)
        return shopping_service.format_as_text(shopping_list)

    @Slot(result=bool)
    def copyToClipboard(self) -> bool:  # noqa: N802
        """Place the rendered text on the system clipboard. Returns True on
        success, False if no QGuiApplication is running (test contexts)."""
        text = self.asText()
        app = QGuiApplication.instance()
        if app is None:
            return False
        clipboard: QClipboard = app.clipboard()
        clipboard.setText(text)
        return True

    # ============================================================ Python-side

    @property
    def iso_week(self) -> str:
        return self._iso_week

    def set_iso_week(self, value: str) -> None:
        IsoWeek(value=value)
        self._iso_week = value
        self.week_changed.emit()
        self.refresh()

    def shift_week(self, weeks: int) -> None:
        year = int(self._iso_week[:4])
        week = int(self._iso_week[6:])
        monday = datetime.fromisocalendar(year, week, 1)
        new_monday = monday + timedelta(weeks=weeks)
        self._iso_week = IsoWeek.from_date(new_monday).value
        self.week_changed.emit()
        self.refresh()

    def refresh(self) -> None:
        if self.ctx is None:
            return
        with self.ctx.session() as s:
            shopping_list = shopping_service.aggregate_shopping_list(s, self._iso_week)
        self._model.set_items(shopping_list.items)
        self._total_eur = str(shopping_list.total_eur)
        self._missing_price_count = shopping_list.missing_price_count
        self.list_changed.emit()
