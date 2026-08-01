"""QAbstractListModel for the shopping list page.

Wraps a flat list of `ShoppingItem`. The QML `ListView` filters / groups by
category client-side. The `inFridge` role is local UI state, mutable per row,
not persisted (Phase 1 — see plan F1).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from PySide6.QtCore import QAbstractListModel, QByteArray, QModelIndex, Property, Qt

from app.domain.shopping import ShoppingItem


class ShoppingListModel(QAbstractListModel):
    IngredientIdRole    = Qt.ItemDataRole.UserRole + 1
    NameRole            = Qt.ItemDataRole.UserRole + 2
    SourceRole          = Qt.ItemDataRole.UserRole + 3
    QuantityGRole       = Qt.ItemDataRole.UserRole + 4
    PieceWeightGRole    = Qt.ItemDataRole.UserRole + 5
    PieceCountRole      = Qt.ItemDataRole.UserRole + 6   # float | None
    CategoryL1Role      = Qt.ItemDataRole.UserRole + 7
    CostEurRole         = Qt.ItemDataRole.UserRole + 8   # str | None (Decimal serialized)
    HasPriceRole        = Qt.ItemDataRole.UserRole + 9
    InFridgeRole        = Qt.ItemDataRole.UserRole + 10  # checkbox state
    InPantryGRole       = Qt.ItemDataRole.UserRole + 11  # F1 — known stock at home (g)
    IsCoveredRole       = Qt.ItemDataRole.UserRole + 12  # F1 — pantry ≥ required ?

    _ROLE_NAMES: dict[int, QByteArray] = {
        IngredientIdRole: QByteArray(b"ingredientId"),
        NameRole:         QByteArray(b"name"),
        SourceRole:       QByteArray(b"source"),
        QuantityGRole:    QByteArray(b"quantityG"),
        PieceWeightGRole: QByteArray(b"pieceWeightG"),
        PieceCountRole:   QByteArray(b"pieceCount"),
        CategoryL1Role:   QByteArray(b"categoryL1"),
        CostEurRole:      QByteArray(b"costEur"),
        HasPriceRole:     QByteArray(b"hasPrice"),
        InFridgeRole:     QByteArray(b"inFridge"),
        InPantryGRole:    QByteArray(b"inPantryG"),
        IsCoveredRole:    QByteArray(b"isCoveredByPantry"),
    }

    def __init__(self, parent: Any = None) -> None:
        super().__init__(parent)
        self._items: list[ShoppingItem] = []
        # ingredient_id -> bool. Survives within a session ; cleared on `set_items`.
        # Seeded from `is_covered_by_pantry` (F1) so the user sees the auto-coche
        # immediately for items already in the fridge — they can untick if needed.
        self._in_fridge: dict[int, bool] = {}

    def set_items(self, items: list[ShoppingItem]) -> None:
        self.beginResetModel()
        self._items = list(items)
        # F1 : auto-seed "déjà au frigo" from pantry coverage.
        self._in_fridge = {
            it.ingredient_id: it.is_covered_by_pantry for it in self._items
        }
        self.endResetModel()

    def items(self) -> list[ShoppingItem]:
        return list(self._items)

    def rowCount(self, parent: QModelIndex | None = None) -> int:  # noqa: N802
        if parent is None:
            parent = QModelIndex()
        if parent.isValid():
            return 0
        return len(self._items)

    def data(self, index: QModelIndex, role: int = Qt.ItemDataRole.DisplayRole) -> Any:  # noqa: N802
        if not index.isValid() or not (0 <= index.row() < len(self._items)):
            return None
        item = self._items[index.row()]
        getter = _ROLE_GETTERS.get(role)
        if getter is not None:
            return getter(item, self._in_fridge.get(item.ingredient_id, False))
        if role == Qt.ItemDataRole.DisplayRole:
            return item.name
        return None

    def setData(self, index: QModelIndex, value: Any, role: int = Qt.ItemDataRole.EditRole) -> bool:  # noqa: N802
        """Allow toggling the `inFridge` checkbox state from QML."""
        if not index.isValid() or not (0 <= index.row() < len(self._items)):
            return False
        if role != self.InFridgeRole:
            return False
        item = self._items[index.row()]
        self._in_fridge[item.ingredient_id] = bool(value)
        self.dataChanged.emit(index, index, [self.InFridgeRole])
        return True

    def roleNames(self) -> dict[int, QByteArray]:  # noqa: N802
        return self._ROLE_NAMES

    @Property("QVariantMap", constant=True)
    def Roles(self) -> dict[str, int]:  # noqa: N802
        """Map of role names → integer IDs, for QML use without magic numbers."""
        return {bytes(name).decode(): role_id for role_id, name in self._ROLE_NAMES.items()}


def _format_cost(item: ShoppingItem) -> str | None:
    return str(item.cost_eur) if item.cost_eur is not None else None


_ROLE_GETTERS: dict[int, Callable[[ShoppingItem, bool], Any]] = {
    ShoppingListModel.IngredientIdRole: lambda i, _f: i.ingredient_id,
    ShoppingListModel.NameRole:         lambda i, _f: i.name,
    ShoppingListModel.SourceRole:       lambda i, _f: i.source,
    ShoppingListModel.QuantityGRole:    lambda i, _f: i.quantity_g,
    ShoppingListModel.PieceWeightGRole: lambda i, _f: i.piece_weight_g,
    ShoppingListModel.PieceCountRole:   lambda i, _f: i.piece_count,
    ShoppingListModel.CategoryL1Role:   lambda i, _f: i.category_l1,
    ShoppingListModel.CostEurRole:      lambda i, _f: _format_cost(i),
    ShoppingListModel.HasPriceRole:     lambda i, _f: i.has_price,
    ShoppingListModel.InFridgeRole:     lambda _i, fridge: fridge,
    ShoppingListModel.InPantryGRole:    lambda i, _f: i.in_pantry_g,
    ShoppingListModel.IsCoveredRole:    lambda i, _f: i.is_covered_by_pantry,
}
