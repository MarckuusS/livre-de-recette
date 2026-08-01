"""QAbstractListModel for the recipes library."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from PySide6.QtCore import QAbstractListModel, QByteArray, QModelIndex, Property, Qt

from app.domain.models import Recipe
from app.services.photo_service import absolute_photo_path

_PREVIEW_CHARS = 80


def _instructions_head(r: Recipe) -> str:
    head = (r.instructions or "").strip().splitlines()[0:1]
    preview = head[0] if head else ""
    if len(preview) > _PREVIEW_CHARS:
        preview = preview[: _PREVIEW_CHARS - 1] + "…"
    return preview


class RecipeListModel(QAbstractListModel):
    IdRole              = Qt.ItemDataRole.UserRole + 1
    NameRole            = Qt.ItemDataRole.UserRole + 2
    PortionsRole        = Qt.ItemDataRole.UserRole + 3
    LineCountRole       = Qt.ItemDataRole.UserRole + 4
    InstructionsHeadRole = Qt.ItemDataRole.UserRole + 5  # premiers caractères pour aperçu
    PhotoUrlRole        = Qt.ItemDataRole.UserRole + 6   # absolute file:// URL or "" if no photo

    _ROLE_NAMES: dict[int, QByteArray] = {
        IdRole:               QByteArray(b"recipeId"),
        NameRole:             QByteArray(b"name"),
        PortionsRole:         QByteArray(b"defaultPortions"),
        LineCountRole:        QByteArray(b"lineCount"),
        InstructionsHeadRole: QByteArray(b"instructionsHead"),
        PhotoUrlRole:         QByteArray(b"photoUrl"),
    }

    def __init__(self, parent: Any = None) -> None:
        super().__init__(parent)
        self._items: list[Recipe] = []

    def set_items(self, items: list[Recipe]) -> None:
        self.beginResetModel()
        self._items = list(items)
        self.endResetModel()

    def items(self) -> list[Recipe]:
        return list(self._items)

    def item_at(self, row: int) -> Recipe | None:
        if 0 <= row < len(self._items):
            return self._items[row]
        return None

    def rowCount(self, parent: QModelIndex | None = None) -> int:  # noqa: N802
        if parent is None:
            parent = QModelIndex()
        if parent.isValid():
            return 0
        return len(self._items)

    def data(self, index: QModelIndex, role: int = Qt.ItemDataRole.DisplayRole) -> Any:  # noqa: N802
        if not index.isValid() or not (0 <= index.row() < len(self._items)):
            return None
        r = self._items[index.row()]
        getter = _ROLE_GETTERS.get(role)
        if getter is not None:
            return getter(r)
        if role == Qt.ItemDataRole.DisplayRole:
            return r.name
        return None

    def roleNames(self) -> dict[int, QByteArray]:  # noqa: N802
        return self._ROLE_NAMES

    @Property("QVariantMap", constant=True)
    def Roles(self) -> dict[str, int]:  # noqa: N802
        """Map of role names → integer IDs, for QML use without magic numbers."""
        return {bytes(name).decode(): role_id for role_id, name in self._ROLE_NAMES.items()}


def _photo_url(r: Recipe) -> str:
    """Build a file:// URL for QML's `Image.source` from `recipe.image_path`.
    Returns "" when no photo is set or the file is missing on disk."""
    abs_path = absolute_photo_path(r.image_path)
    if abs_path is None:
        return ""
    return abs_path.as_uri()


_ROLE_GETTERS: dict[int, Callable[[Recipe], Any]] = {
    RecipeListModel.IdRole:               lambda r: r.id,
    RecipeListModel.NameRole:             lambda r: r.name,
    RecipeListModel.PortionsRole:         lambda r: r.default_portions,
    RecipeListModel.LineCountRole:        lambda r: len(r.lines),
    RecipeListModel.InstructionsHeadRole: _instructions_head,
    RecipeListModel.PhotoUrlRole:         _photo_url,
}
