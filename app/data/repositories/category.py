"""Repository for `category_definition` (Phase 5 — refonte UX catégories).

API simple :
- `list_l1()`            → liste des catégories racines triées par ordinal puis nom
- `list_l2(parent_id)`   → enfants d'une L1
- `tree()`               → structure complète {L1: [L2, ...]} pour l'éditeur
- `add(name, parent_id)` → crée une catégorie ; lève ValueError si nom déjà pris
- `rename(id, new_name)` → renomme + cascade-update des Ingredient.category_l1/l2
                            par MATCH sur l'ancien nom
- `delete(id)`           → supprime + cascade-clear des Ingredient.category_l1/l2
                            qui pointaient dessus (set NULL)
- `set_ordinal(id, n)`   → réordonne

Les Ingredient continuent de stocker des chaînes (TEXT), pas des FK — on
maintient la rétrocompat avec CIQUAL et les imports qui utilisent les noms
directement.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..orm import CategoryDefinitionRow, IngredientRow


@dataclass
class CategoryNode:
    """Snapshot domaine pour exposition aux callers (VM / tests)."""
    id: int
    name: str
    parent_id: int | None
    ordinal: int
    children: list["CategoryNode"]


class CategoryRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    # ============================================================ Lecture

    def list_l1(self) -> list[CategoryNode]:
        rows = self.s.execute(
            select(CategoryDefinitionRow)
            .where(CategoryDefinitionRow.parent_id.is_(None))
            .order_by(CategoryDefinitionRow.ordinal, CategoryDefinitionRow.name)
        ).scalars().all()
        return [self._to_node(r, with_children=False) for r in rows]

    def list_l2(self, parent_id: int) -> list[CategoryNode]:
        rows = self.s.execute(
            select(CategoryDefinitionRow)
            .where(CategoryDefinitionRow.parent_id == parent_id)
            .order_by(CategoryDefinitionRow.ordinal, CategoryDefinitionRow.name)
        ).scalars().all()
        return [self._to_node(r, with_children=False) for r in rows]

    def tree(self) -> list[CategoryNode]:
        """Retourne l'arbre complet (L1 + L2 enfants) en 2 queries seulement."""
        all_rows = self.s.execute(
            select(CategoryDefinitionRow)
            .order_by(CategoryDefinitionRow.ordinal, CategoryDefinitionRow.name)
        ).scalars().all()
        by_parent: dict[int | None, list[CategoryDefinitionRow]] = {}
        for r in all_rows:
            by_parent.setdefault(r.parent_id, []).append(r)
        result: list[CategoryNode] = []
        for l1 in by_parent.get(None, []):
            children = [self._to_node(c, with_children=False) for c in by_parent.get(l1.id, [])]
            result.append(CategoryNode(
                id=l1.id, name=l1.name, parent_id=None,
                ordinal=l1.ordinal, children=children,
            ))
        return result

    def find_by_name(self, name: str, parent_id: int | None) -> CategoryDefinitionRow | None:
        return self.s.execute(
            select(CategoryDefinitionRow)
            .where(
                CategoryDefinitionRow.name == name,
                CategoryDefinitionRow.parent_id.is_(parent_id) if parent_id is None
                else CategoryDefinitionRow.parent_id == parent_id,
            )
        ).scalar_one_or_none()

    # ============================================================ Mutation

    def add(self, name: str, parent_id: int | None = None) -> CategoryNode:
        name = (name or "").strip()
        if not name:
            raise ValueError("Le nom de la catégorie ne peut pas être vide.")
        if self.find_by_name(name, parent_id) is not None:
            raise ValueError(f"La catégorie « {name} » existe déjà à ce niveau.")
        # Position : à la fin (max ordinal + 1)
        siblings = (
            self.list_l1() if parent_id is None
            else self.list_l2(parent_id)
        )
        next_ord = max((s.ordinal for s in siblings), default=-1) + 1
        row = CategoryDefinitionRow(
            name=name, parent_id=parent_id, ordinal=next_ord,
        )
        self.s.add(row)
        try:
            self.s.flush()
        except IntegrityError as exc:
            self.s.rollback()
            raise ValueError(f"Conflit d'unicité : {exc}") from exc
        return self._to_node(row, with_children=False)

    def rename(self, category_id: int, new_name: str) -> CategoryNode | None:
        new_name = (new_name or "").strip()
        if not new_name:
            raise ValueError("Le nouveau nom ne peut pas être vide.")
        row = self.s.get(CategoryDefinitionRow, category_id)
        if row is None:
            return None
        old_name = row.name
        if new_name == old_name:
            return self._to_node(row, with_children=False)

        # Vérifie qu'aucun sibling n'a déjà ce nom
        if self.find_by_name(new_name, row.parent_id) is not None:
            raise ValueError(f"La catégorie « {new_name } » existe déjà à ce niveau.")

        # Cascade-update des Ingredient avant de modifier la row (pour pouvoir
        # encore matcher sur l'ancien nom).
        is_l1 = row.parent_id is None
        col = IngredientRow.category_l1 if is_l1 else IngredientRow.category_l2
        self.s.execute(
            update(IngredientRow).where(col == old_name).values({col: new_name})
        )

        row.name = new_name
        self.s.flush()
        return self._to_node(row, with_children=False)

    def delete(self, category_id: int) -> bool:
        row = self.s.get(CategoryDefinitionRow, category_id)
        if row is None:
            return False
        # Cascade-clear : les Ingredient qui pointaient sur cette catégorie
        # par nom voient leur champ passer à NULL.
        is_l1 = row.parent_id is None
        if is_l1:
            self.s.execute(
                update(IngredientRow)
                .where(IngredientRow.category_l1 == row.name)
                .values({IngredientRow.category_l1: None, IngredientRow.category_l2: None})
            )
        else:
            self.s.execute(
                update(IngredientRow)
                .where(IngredientRow.category_l2 == row.name)
                .values({IngredientRow.category_l2: None})
            )
        self.s.delete(row)   # ON DELETE CASCADE supprime aussi les enfants
        self.s.flush()
        return True

    def set_ordinal(self, category_id: int, ordinal: int) -> bool:
        row = self.s.get(CategoryDefinitionRow, category_id)
        if row is None:
            return False
        row.ordinal = max(0, int(ordinal))
        self.s.flush()
        return True

    # ============================================================ Helpers

    @staticmethod
    def _to_node(
        row: CategoryDefinitionRow, *, with_children: bool,
    ) -> CategoryNode:
        return CategoryNode(
            id=row.id,
            name=row.name,
            parent_id=row.parent_id,
            ordinal=row.ordinal,
            children=[],   # populated by tree() only
        )
