"""ViewModel pour l'éditeur de catégories (Phase 5).

Expose au QML :
- `tree()` → liste de dicts {id, name, children: [{id, name}, ...]} pour
  l'arbre de l'éditeur Paramètres
- `flatL1()` / `l2For(parentId)` → pour le popup picker (en 2 étapes)
- `addL1(name)`, `addL2(parentId, name)`, `rename(id, newName)`,
  `delete(id)` → mutations exposées en slots

Émet `tree_changed` à chaque mutation pour que tous les bindings rafraîchissent
(éditeur Paramètres, popup picker, formulaire IngredientsPage).
"""

from __future__ import annotations

import logging

from PySide6.QtCore import QObject, Signal, Slot
from PySide6.QtQml import QmlElement

from app.data.repositories import CategoryRepo
from app.ui.app_context import AppContext

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1

log = logging.getLogger(__name__)


@QmlElement
class CategoryViewModel(QObject):
    tree_changed = Signal()
    error_emitted = Signal(str)

    def __init__(self, ctx: AppContext | None = None, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx

    # ============================================================ Lecture

    @Slot(result="QVariantList")
    def tree(self) -> list[dict]:
        """Retourne `[{id, name, ordinal, children: [{id, name, ordinal}]}, ...]`
        pour rendre l'arbre dans l'éditeur Paramètres."""
        if self.ctx is None:
            return []
        with self.ctx.session() as s:
            nodes = CategoryRepo(s).tree()
        return [
            {
                "id": n.id, "name": n.name, "ordinal": n.ordinal,
                "children": [
                    {"id": c.id, "name": c.name, "ordinal": c.ordinal}
                    for c in n.children
                ],
            }
            for n in nodes
        ]

    @Slot(result="QVariantList")
    def flatL1(self) -> list[dict]:  # noqa: N802
        """Liste plate des L1 pour le 1er écran du popup picker."""
        if self.ctx is None:
            return []
        with self.ctx.session() as s:
            nodes = CategoryRepo(s).list_l1()
        return [{"id": n.id, "name": n.name} for n in nodes]

    @Slot(int, result="QVariantList")
    def l2For(self, parent_id: int) -> list[dict]:  # noqa: N802
        """Liste plate des L2 enfants d'un L1 — pour le 2ème écran du picker."""
        if self.ctx is None or parent_id <= 0:
            return []
        with self.ctx.session() as s:
            nodes = CategoryRepo(s).list_l2(parent_id)
        return [{"id": n.id, "name": n.name} for n in nodes]

    # ============================================================ Mutations

    @Slot(str, result=int)
    def addL1(self, name: str) -> int:  # noqa: N802
        if self.ctx is None:
            return 0
        try:
            with self.ctx.session() as s:
                node = CategoryRepo(s).add(name, parent_id=None)
                s.commit()
        except ValueError as exc:
            self.error_emitted.emit(str(exc))
            return 0
        self.tree_changed.emit()
        return node.id

    @Slot(int, str, result=int)
    def addL2(self, parent_id: int, name: str) -> int:  # noqa: N802
        if self.ctx is None or parent_id <= 0:
            return 0
        try:
            with self.ctx.session() as s:
                node = CategoryRepo(s).add(name, parent_id=parent_id)
                s.commit()
        except ValueError as exc:
            self.error_emitted.emit(str(exc))
            return 0
        self.tree_changed.emit()
        return node.id

    @Slot(int, str, result=bool)
    def rename(self, category_id: int, new_name: str) -> bool:
        if self.ctx is None or category_id <= 0:
            return False
        try:
            with self.ctx.session() as s:
                result = CategoryRepo(s).rename(category_id, new_name)
                if result is None:
                    return False
                s.commit()
        except ValueError as exc:
            self.error_emitted.emit(str(exc))
            return False
        self.tree_changed.emit()
        return True

    @Slot(int, result=bool)
    def delete(self, category_id: int) -> bool:
        if self.ctx is None or category_id <= 0:
            return False
        with self.ctx.session() as s:
            ok = CategoryRepo(s).delete(category_id)
            if ok:
                s.commit()
        if ok:
            self.tree_changed.emit()
        return ok
