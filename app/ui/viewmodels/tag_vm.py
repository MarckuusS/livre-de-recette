"""ViewModel for the global tag catalog (F4).

Source unique de tous les tags disponibles dans l'app — partagée entre l'éditeur
de recette (chips éditables) et la liste de recettes (filtre multi-select).
Stateless (pas de DB session de longue durée) ; QML appelle `listAll()` à la
demande.
"""

from __future__ import annotations

import logging
from typing import Any

from PySide6.QtCore import QObject, Signal, Slot
from PySide6.QtQml import QmlElement

from app.data.repositories import TagRepo
from app.domain.models import Tag
from app.ui.app_context import AppContext

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1

log = logging.getLogger(__name__)


def _tag_to_dict(t: Tag) -> dict[str, Any]:
    return {
        "id":        t.id,
        "name":      t.name,
        "colorHex":  t.color_hex,
    }


@QmlElement
class TagListViewModel(QObject):
    """Read-only catalog of tags. Edition (rename / color change) lives outside
    Phase 2 — the user can use the seeded tags as-is."""

    tags_changed = Signal()

    def __init__(self, ctx: AppContext | None = None, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx

    @Slot(result="QVariantList")
    def listAll(self) -> list[dict[str, Any]]:  # noqa: N802
        """All available tags as dicts. Sorted alphabetically."""
        if self.ctx is None:
            return []
        with self.ctx.session() as s:
            tags = TagRepo(s).list_all()
        return [_tag_to_dict(t) for t in tags]
