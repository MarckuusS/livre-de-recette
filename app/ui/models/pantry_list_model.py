"""QAbstractListModel for the Frigo / Cellier inventory (F1).

Wraps a flat list of `(PantryStock, Ingredient)` pairs — the ingredient is
denormalized into the row so QML can render the stock card directly without
issuing per-row lookups (the ViewModel pre-resolves the join).

The QML page filters / groups client-side into 3 sections :
  - "À consommer vite"  : `expiry_days_remaining ≤ 5`
  - "À surveiller"      : `5 < expiry_days_remaining ≤ 14`
  - "En stock"          : the rest (no expiry, or > 14 days)
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

from PySide6.QtCore import QAbstractListModel, QByteArray, QModelIndex, Property, Qt

from app.domain.models import PantryStock


class PantryRow:
    """In-memory join of PantryStock + denormalized ingredient fields. Avoids
    re-querying the DB per row inside `data()`."""

    __slots__ = (
        "stock", "ingredient_name", "ingredient_source",
        "category_l1", "piece_weight_g",
    )

    def __init__(
        self,
        stock: PantryStock,
        ingredient_name: str,
        ingredient_source: str,
        category_l1: str | None,
        piece_weight_g: float | None,
    ) -> None:
        self.stock = stock
        self.ingredient_name = ingredient_name
        self.ingredient_source = ingredient_source
        self.category_l1 = category_l1
        self.piece_weight_g = piece_weight_g

    @property
    def days_until_expiry(self) -> int | None:
        """Whole days from today to `expiry_date`. None when no expiry set.
        Negative = already expired (visible in red on the page)."""
        if self.stock.expiry_date is None:
            return None
        delta = self.stock.expiry_date.date() - datetime.now().date()
        return delta.days


class PantryListModel(QAbstractListModel):
    StockIdRole         = Qt.ItemDataRole.UserRole + 1
    IngredientIdRole    = Qt.ItemDataRole.UserRole + 2
    NameRole            = Qt.ItemDataRole.UserRole + 3
    QuantityGRole       = Qt.ItemDataRole.UserRole + 4
    ExpiryIsoRole       = Qt.ItemDataRole.UserRole + 5   # "YYYY-MM-DD" or ""
    DaysUntilExpiryRole = Qt.ItemDataRole.UserRole + 6   # int | None
    NotesRole           = Qt.ItemDataRole.UserRole + 7
    CategoryL1Role      = Qt.ItemDataRole.UserRole + 8
    PieceWeightGRole    = Qt.ItemDataRole.UserRole + 9
    SourceRole          = Qt.ItemDataRole.UserRole + 10
    UrgencyBucketRole   = Qt.ItemDataRole.UserRole + 11  # "soon" | "watch" | "stock"

    _ROLE_NAMES: dict[int, QByteArray] = {
        StockIdRole:         QByteArray(b"stockId"),
        IngredientIdRole:    QByteArray(b"ingredientId"),
        NameRole:            QByteArray(b"name"),
        QuantityGRole:       QByteArray(b"quantityG"),
        ExpiryIsoRole:       QByteArray(b"expiryIso"),
        DaysUntilExpiryRole: QByteArray(b"daysUntilExpiry"),
        NotesRole:           QByteArray(b"notes"),
        CategoryL1Role:      QByteArray(b"categoryL1"),
        PieceWeightGRole:    QByteArray(b"pieceWeightG"),
        SourceRole:          QByteArray(b"source"),
        UrgencyBucketRole:   QByteArray(b"urgencyBucket"),
    }

    SOON_THRESHOLD_DAYS = 5
    WATCH_THRESHOLD_DAYS = 14

    def __init__(self, parent: Any = None) -> None:
        super().__init__(parent)
        self._items: list[PantryRow] = []

    def set_items(self, items: list[PantryRow]) -> None:
        self.beginResetModel()
        self._items = list(items)
        self.endResetModel()

    def items(self) -> list[PantryRow]:
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
        row = self._items[index.row()]
        getter = _ROLE_GETTERS.get(role)
        if getter is not None:
            return getter(row)
        if role == Qt.ItemDataRole.DisplayRole:
            return row.ingredient_name
        return None

    def roleNames(self) -> dict[int, QByteArray]:  # noqa: N802
        return self._ROLE_NAMES

    @Property("QVariantMap", constant=True)
    def Roles(self) -> dict[str, int]:  # noqa: N802
        return {bytes(name).decode(): role_id for role_id, name in self._ROLE_NAMES.items()}


def _urgency_bucket(row: PantryRow) -> str:
    days = row.days_until_expiry
    if days is None:
        return "stock"
    if days <= PantryListModel.SOON_THRESHOLD_DAYS:
        return "soon"
    if days <= PantryListModel.WATCH_THRESHOLD_DAYS:
        return "watch"
    return "stock"


_ROLE_GETTERS: dict[int, Callable[[PantryRow], Any]] = {
    PantryListModel.StockIdRole:         lambda r: r.stock.id,
    PantryListModel.IngredientIdRole:    lambda r: r.stock.ingredient_id,
    PantryListModel.NameRole:            lambda r: r.ingredient_name,
    PantryListModel.QuantityGRole:       lambda r: r.stock.quantity_g,
    PantryListModel.ExpiryIsoRole:       lambda r: (
        r.stock.expiry_date.date().isoformat() if r.stock.expiry_date else ""
    ),
    PantryListModel.DaysUntilExpiryRole: lambda r: r.days_until_expiry,
    PantryListModel.NotesRole:           lambda r: r.stock.notes or "",
    PantryListModel.CategoryL1Role:      lambda r: r.category_l1 or "Non catégorisé",
    PantryListModel.PieceWeightGRole:    lambda r: r.piece_weight_g,
    PantryListModel.SourceRole:          lambda r: r.ingredient_source,
    PantryListModel.UrgencyBucketRole:   _urgency_bucket,
}
