"""ReceiptAliasRepo : mapping appris (store, source_key) → ingredient_id.

Utilisé pour Intermarché et Carrefour, où les noms de produits sur les
tickets sont tronqués et ne matchent pas exactement les noms en biblio.
Pour Lidl, on stocke directement l'art_id en `ingredient.source_ref` avec
`Source.LIDL`, donc `IngredientRepo.find_by_source_ref()` suffit — pas
besoin de cette table pour Lidl.

L'`upsert` est idempotent : on incrémente `hit_count` à chaque match validé,
mais on n'écrase jamais une correspondance existante avec un ingredient_id
différent (le user doit explicitement supprimer l'alias pour le rebrancher
ailleurs ; on n'implémente pas ce flow en Phase 1, à voir si nécessaire).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..orm import ReceiptAliasRow


class ReceiptAliasRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def find(self, store: str, source_key: str) -> ReceiptAliasRow | None:
        stmt = select(ReceiptAliasRow).where(
            ReceiptAliasRow.store == store,
            ReceiptAliasRow.source_key == source_key,
        )
        return self.s.execute(stmt).scalar_one_or_none()

    def upsert(
        self, store: str, source_key: str, ingredient_id: int,
    ) -> ReceiptAliasRow:
        """Crée l'alias s'il n'existe pas, sinon incrémente `hit_count`.

        Si l'alias existe avec un autre `ingredient_id`, on le met à jour
        (cas : l'utilisateur a corrigé un mapping qu'il avait validé par
        erreur la première fois). Le `hit_count` repart à 1."""
        row = self.find(store, source_key)
        if row is None:
            row = ReceiptAliasRow(
                store=store,
                source_key=source_key,
                ingredient_id=ingredient_id,
                hit_count=1,
            )
            self.s.add(row)
        elif row.ingredient_id == ingredient_id:
            row.hit_count = (row.hit_count or 0) + 1
        else:
            row.ingredient_id = ingredient_id
            row.hit_count = 1
        self.s.flush()
        return row

    def delete_for_ingredient(self, ingredient_id: int) -> int:
        """Quand un ingrédient est supprimé, on garde le cascade DB ; ce
        helper est exposé pour les cas où l'utilisateur veut "oublier" un
        mapping sans supprimer l'ingrédient."""
        stmt = select(ReceiptAliasRow).where(
            ReceiptAliasRow.ingredient_id == ingredient_id
        )
        rows = list(self.s.execute(stmt).scalars())
        for r in rows:
            self.s.delete(r)
        self.s.flush()
        return len(rows)
