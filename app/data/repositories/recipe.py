"""RecipeRepo : CRUD on `recipe` + `recipe_ingredient` + `recipe_tag`."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domain.models import Recipe, RecipeLine

from ..orm import (
    RecipeIngredientRow,
    RecipeRow,
    RecipeTagRow,
    TagRow,
)
from ._mappers import _recipe_to_domain


class RecipeRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def _load_with_lines(self, recipe_id: int) -> RecipeRow | None:
        stmt = (
            select(RecipeRow)
            .where(RecipeRow.id == recipe_id)
            .options(
                selectinload(RecipeRow.lines).selectinload(RecipeIngredientRow.ingredient),
                selectinload(RecipeRow.tags),
            )
        )
        return self.s.execute(stmt).scalar_one_or_none()

    def get(self, recipe_id: int) -> Recipe | None:
        row = self._load_with_lines(recipe_id)
        return _recipe_to_domain(row) if row else None

    def list_by_ids(self, recipe_ids: list[int] | set[int]) -> dict[int, Recipe]:
        """Bulk-load recipes by IDs (with their lines + tags eagerly loaded)
        in a single SELECT + selectinload. Returns a dict {id: Recipe}.

        Used by `shopping_service.aggregate_shopping_list` to avoid N+1 :
        one SELECT WHERE id IN (...) instead of N individual `get()` calls,
        each of which would trigger its own selectinload roundtrip."""
        ids = list(recipe_ids)
        if not ids:
            return {}
        stmt = (
            select(RecipeRow)
            .where(RecipeRow.id.in_(ids))
            .options(
                selectinload(RecipeRow.lines).selectinload(RecipeIngredientRow.ingredient),
                selectinload(RecipeRow.tags),
            )
        )
        return {r.id: _recipe_to_domain(r) for r in self.s.execute(stmt).scalars()}

    def list_all(self, *, tag_ids: list[int] | None = None) -> list[Recipe]:
        """List recipes alphabetically. Optional `tag_ids` filter — keeps only
        recipes carrying AT LEAST ONE of the given tag ids (OR semantics).
        Empty list / None → no filter."""
        stmt = (
            select(RecipeRow)
            .order_by(RecipeRow.name)
            .options(
                selectinload(RecipeRow.lines).selectinload(RecipeIngredientRow.ingredient),
                selectinload(RecipeRow.tags),
            )
        )
        if tag_ids:
            stmt = stmt.join(RecipeTagRow, RecipeTagRow.recipe_id == RecipeRow.id).where(
                RecipeTagRow.tag_id.in_(tag_ids)
            ).distinct()
        return [_recipe_to_domain(r) for r in self.s.execute(stmt).scalars()]

    def create(self, recipe: Recipe) -> Recipe:
        row = RecipeRow(
            name=recipe.name,
            instructions=recipe.instructions,
            default_portions=recipe.default_portions,
            image_path=recipe.image_path,
        )
        self.s.add(row)
        self.s.flush()
        self._replace_lines(row, recipe.lines)
        self._replace_tags(row, [t.id for t in recipe.tags if t.id is not None])
        self.s.flush()
        return _recipe_to_domain(self._load_with_lines(row.id))  # type: ignore[arg-type]

    def update(self, recipe: Recipe) -> Recipe:
        if recipe.id is None:
            raise ValueError("update requires a Recipe with id")
        row = self._load_with_lines(recipe.id)
        if row is None:
            raise LookupError(f"Recipe {recipe.id} not found")
        row.name = recipe.name
        row.instructions = recipe.instructions
        row.default_portions = recipe.default_portions
        row.image_path = recipe.image_path
        self._replace_lines(row, recipe.lines)
        self._replace_tags(row, [t.id for t in recipe.tags if t.id is not None])
        self.s.flush()
        return _recipe_to_domain(self._load_with_lines(row.id))  # type: ignore[arg-type]

    def set_tags(self, recipe_id: int, tag_ids: list[int]) -> None:
        """Replace the tag set of a recipe atomically."""
        row = self.s.get(RecipeRow, recipe_id)
        if row is None:
            raise LookupError(f"Recipe {recipe_id} not found")
        self._replace_tags(row, tag_ids)
        self.s.flush()

    def _replace_tags(self, row: RecipeRow, tag_ids: list[int]) -> None:
        """Sync the M2M tag set via SQLAlchemy's ORM relation. Assigning a new
        list to `row.tags` makes SQLAlchemy compute the diff and update the
        `recipe_tag` table — including dropping all rows when the new set is empty.
        Going through the ORM (rather than raw SQL DELETE) keeps the in-memory
        identity map consistent."""
        if not tag_ids:
            row.tags = []
            return
        new_tags = self.s.execute(
            select(TagRow).where(TagRow.id.in_(tag_ids))
        ).scalars().all()
        row.tags = list(new_tags)

    def _replace_lines(self, row: RecipeRow, lines: list[RecipeLine]) -> None:
        # Simple strategy: clear and reinsert. Recipes are small (<50 lines).
        row.lines.clear()
        self.s.flush()
        for idx, line in enumerate(lines):
            if line.ingredient.id is None:
                raise ValueError(f"recipe line ingredient '{line.ingredient.name}' has no id")
            row.lines.append(
                RecipeIngredientRow(
                    ingredient_id=line.ingredient.id,
                    quantity_g=line.quantity_g,
                    unit=line.unit,
                    notes=line.notes,
                    ordinal=line.ordinal or idx,
                )
            )

    def delete(self, recipe_id: int) -> None:
        row = self.s.get(RecipeRow, recipe_id)
        if row is not None:
            self.s.delete(row)
            self.s.flush()

    def find_by_ingredient_ids(
        self,
        ingredient_ids: list[int],
        min_match: float = 0.5,
    ) -> list[tuple[Recipe, float, int, int]]:
        """Find recipes that can be cooked from the given ingredients.

        Score = `|recipe.lines ∩ provided| / |recipe.lines|` — the fraction of
        the recipe's ingredients that the user already has. Recipes scoring
        below `min_match` are filtered out. Result is sorted descending by score.

        Returns a list of `(recipe, score, match_count, total_count)` tuples
        so the UI can show "5/7 ingrédients" alongside the percentage.

        Implementation note: walks all recipes Python-side (SELECT … JOIN
        GROUP BY HAVING in SQL would be more code for marginal speedup at the
        scale this app targets — typically < 200 recipes).
        """
        if not ingredient_ids:
            return []
        provided = {int(i) for i in ingredient_ids}
        recipes = self.list_all()
        scored: list[tuple[Recipe, float, int, int]] = []
        for r in recipes:
            recipe_ing_ids = {
                line.ingredient.id for line in r.lines if line.ingredient.id is not None
            }
            if not recipe_ing_ids:
                continue  # no ingredients → undefined score
            common = recipe_ing_ids & provided
            total = len(recipe_ing_ids)
            match = len(common)
            score = match / total
            if score >= min_match:
                scored.append((r, score, match, total))
        scored.sort(key=lambda t: (t[1], t[2]), reverse=True)
        return scored

    def find_by_ingredient_ids_categorized(
        self,
        ingredient_ids: list[int],
        max_missing: int = 3,
    ) -> dict:
        """Refonte UX : 3 catégories de résultats au lieu d'un seuil unique.

        - **ready**     : recettes que l'user peut cuisiner *maintenant* —
                          `recipe ⊆ provided` (tous les ingrédients sont là).
                          Triées par taille de la recette (descendante : les
                          plus complètes d'abord — plus utile que par nom).
        - **missing**   : recettes presque-prêtes, où `1 ≤ missing ≤ max_missing`.
                          On expose la liste des `missing_names` pour que l'UI
                          puisse afficher "complète avec : tomate, basilic".
                          Triées par missing croissant puis par taille recette.
        - **shopping**  : top ingrédients à acheter pour débloquer le plus de
                          recettes parmi `missing`. Pour chaque ingrédient
                          fréquemment manquant, combien de recettes deviennent
                          *ready* si l'user l'achète. Top 5.

        Returns dict with 3 lists. Chaque entrée recette = `(recipe, score,
        match_count, total_count, missing_ids, missing_names)`.
        L'entrée shopping = `(ingredient_id, ingredient_name, unlock_count)`.
        """
        if not ingredient_ids:
            return {"ready": [], "missing": [], "shopping": []}
        provided = {int(i) for i in ingredient_ids}
        recipes = self.list_all()

        # Construit un index global ingredient_id → name (utile pour shopping)
        ing_name_by_id: dict[int, str] = {}

        ready: list[tuple] = []
        missing: list[tuple] = []
        # Pour chaque ingrédient manquant, liste des recettes qu'il déblocquerait
        unlock_by_missing_id: dict[int, set[int]] = {}

        for r in recipes:
            recipe_lines = [
                (line.ingredient.id, line.ingredient.name)
                for line in r.lines if line.ingredient.id is not None
            ]
            if not recipe_lines:
                continue
            recipe_ing_ids = {iid for iid, _ in recipe_lines}
            for iid, name in recipe_lines:
                ing_name_by_id[iid] = name

            common = recipe_ing_ids & provided
            total = len(recipe_ing_ids)
            match = len(common)
            score = match / total if total > 0 else 0.0
            missing_ids = recipe_ing_ids - provided
            missing_names = sorted([
                name for iid, name in recipe_lines if iid in missing_ids
            ])

            if not missing_ids:
                # ready : tous les ingrédients sont disponibles
                ready.append((r, score, match, total, [], []))
            elif len(missing_ids) <= max_missing:
                missing.append((r, score, match, total, sorted(missing_ids), missing_names))
                # Track ingredients dont l'achat débloquerait cette recette
                # uniquement si elle a 1 seul manquant (sinon l'achat de UN
                # ingrédient ne suffit pas à la rendre ready)
                if len(missing_ids) == 1:
                    only_missing = next(iter(missing_ids))
                    unlock_by_missing_id.setdefault(only_missing, set()).add(r.id)

        # Sort ready : plus grosses recettes d'abord (more "satisfying" pour
        # l'user qui voit sa liste exhaustivement utilisable)
        ready.sort(key=lambda t: (-t[3], t[0].name.lower()))
        # Sort missing : moins de manquants d'abord, puis grosse recette
        missing.sort(key=lambda t: (len(t[4]), -t[3], t[0].name.lower()))

        # Build shopping suggestions : top ingrédients qui débloquent le plus de
        # recettes. Triés par count décroissant.
        shopping: list[tuple] = []
        for iid, recipe_ids_set in unlock_by_missing_id.items():
            shopping.append((iid, ing_name_by_id.get(iid, f"id {iid}"), len(recipe_ids_set)))
        shopping.sort(key=lambda t: (-t[2], t[1].lower()))
        shopping = shopping[:5]

        return {"ready": ready, "missing": missing, "shopping": shopping}
