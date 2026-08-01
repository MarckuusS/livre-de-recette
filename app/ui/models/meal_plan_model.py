"""QAbstractListModel for the weekly meal plan entries.

The model holds the flat list of `MealPlanEntry` for one ISO week. The QML view
filters by `dayOfWeek` and `slot` to render the 7×3 grid (Monday→Sunday × morning/noon/evening).

Each row exposes a pre-rendered `description` string ("🍽 Chili con carne (4 portions)" /
"🥕 Carotte (200 g)") so the QML doesn't have to re-resolve recipe / ingredient names.
The viewmodel populates this string when refreshing.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from PySide6.QtCore import QAbstractListModel, QByteArray, QModelIndex, Property, Qt

from app.domain.models import MealPlanEntry


@dataclass(frozen=True)
class MealPlanRow:
    """One displayable entry. Bundles the raw entry + a pre-resolved description.

    `description` is computed by the viewmodel (which has DB access) so the model
    itself stays a pure data-holder.
    """
    entry: MealPlanEntry
    description: str


class MealPlanModel(QAbstractListModel):
    IdRole          = Qt.ItemDataRole.UserRole + 1
    DayOfWeekRole   = Qt.ItemDataRole.UserRole + 2  # 0=Monday … 6=Sunday
    SlotRole        = Qt.ItemDataRole.UserRole + 3  # "morning" | "noon" | "evening"
    KindRole        = Qt.ItemDataRole.UserRole + 4  # "recipe" | "ingredient"
    RecipeIdRole    = Qt.ItemDataRole.UserRole + 5
    IngredientIdRole = Qt.ItemDataRole.UserRole + 6
    QuantityGRole   = Qt.ItemDataRole.UserRole + 7
    PortionsRole    = Qt.ItemDataRole.UserRole + 8
    DescriptionRole = Qt.ItemDataRole.UserRole + 9

    _ROLE_NAMES: dict[int, QByteArray] = {
        IdRole:           QByteArray(b"entryId"),
        DayOfWeekRole:    QByteArray(b"dayOfWeek"),
        SlotRole:         QByteArray(b"slot"),
        KindRole:         QByteArray(b"kind"),
        RecipeIdRole:     QByteArray(b"recipeId"),
        IngredientIdRole: QByteArray(b"ingredientId"),
        QuantityGRole:    QByteArray(b"quantityG"),
        PortionsRole:     QByteArray(b"portions"),
        DescriptionRole:  QByteArray(b"description"),
    }

    def __init__(self, parent: Any = None) -> None:
        super().__init__(parent)
        self._rows: list[MealPlanRow] = []

    def set_rows(self, rows: list[MealPlanRow]) -> None:
        self.beginResetModel()
        self._rows = list(rows)
        self.endResetModel()

    def rowCount(self, parent: QModelIndex | None = None) -> int:  # noqa: N802
        if parent is None:
            parent = QModelIndex()
        if parent.isValid():
            return 0
        return len(self._rows)

    def data(self, index: QModelIndex, role: int = Qt.ItemDataRole.DisplayRole) -> Any:  # noqa: N802
        if not index.isValid() or not (0 <= index.row() < len(self._rows)):
            return None
        row = self._rows[index.row()]
        getter = _ROLE_GETTERS.get(role)
        if getter is not None:
            return getter(row)
        if role == Qt.ItemDataRole.DisplayRole:
            return row.description
        return None

    def roleNames(self) -> dict[int, QByteArray]:  # noqa: N802
        return self._ROLE_NAMES

    @Property("QVariantMap", constant=True)
    def Roles(self) -> dict[str, int]:  # noqa: N802
        """Map of role names → integer IDs, for QML use without magic numbers."""
        return {bytes(name).decode(): role_id for role_id, name in self._ROLE_NAMES.items()}


_ROLE_GETTERS: dict[int, Callable[[MealPlanRow], Any]] = {
    MealPlanModel.IdRole:           lambda r: r.entry.id,
    MealPlanModel.DayOfWeekRole:    lambda r: r.entry.day_of_week,
    MealPlanModel.SlotRole:         lambda r: r.entry.slot.value,
    MealPlanModel.KindRole:         lambda r: "recipe" if r.entry.recipe_id is not None else "ingredient",
    MealPlanModel.RecipeIdRole:     lambda r: r.entry.recipe_id,
    MealPlanModel.IngredientIdRole: lambda r: r.entry.ingredient_id,
    MealPlanModel.QuantityGRole:    lambda r: r.entry.quantity_g,
    MealPlanModel.PortionsRole:     lambda r: r.entry.portions,
    MealPlanModel.DescriptionRole:  lambda r: r.description,
}
