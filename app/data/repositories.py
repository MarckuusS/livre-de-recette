"""Repositories: CRUD + query helpers. ORM <-> Pydantic mapping happens HERE, nowhere else."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import distinct, func, select, text
from sqlalchemy.orm import Session, selectinload

from app.domain.models import (
    Ingredient,
    MealPlanEntry,
    MealSlot,
    Recipe,
    RecipeLine,
    Source,
)

from .orm import IngredientRow, MealPlanEntryRow, RecipeIngredientRow, RecipeRow


# --------------------------------------------------------------------------- #
# Search options — used by the import dialog for filters/sort/pagination.
# --------------------------------------------------------------------------- #


SortField = Literal["rank", "name", "kcal", "proteins", "carbs", "fats"]


@dataclass(frozen=True)
class SearchFilters:
    """Numeric and category filters applied to ingredient search.

    Each `min_*` is inclusive lower bound; each `max_*` is inclusive upper bound.
    None means "no constraint on this dimension".
    """

    min_kcal: float | None = None
    max_kcal: float | None = None
    min_proteins: float | None = None
    max_proteins: float | None = None
    min_carbs: float | None = None
    max_carbs: float | None = None
    min_fats: float | None = None
    max_fats: float | None = None
    category_l1: str | None = None


@dataclass(frozen=True)
class SearchOptions:
    query: str = ""
    scope: str = "all"                # "all" | "personal"
    source: Source | None = None      # restrict to a specific source catalog
    filters: SearchFilters = field(default_factory=SearchFilters)
    sort_by: SortField = "rank"
    sort_desc: bool = False
    page: int = 1
    page_size: int = 25


@dataclass(frozen=True)
class SearchPage:
    matches: list[Ingredient]
    total_count: int
    page: int
    page_size: int

    @property
    def page_count(self) -> int:
        if self.page_size <= 0 or self.total_count <= 0:
            return 1
        return (self.total_count + self.page_size - 1) // self.page_size


# --------------------------------------------------------------------------- #
# Mapping helpers (ORM <-> Pydantic). Kept private to this module.
# --------------------------------------------------------------------------- #


def _ing_to_domain(row: IngredientRow) -> Ingredient:
    return Ingredient(
        id=row.id,
        name=row.name,
        source=Source(row.source),
        source_ref=row.source_ref,
        kcal_per_100g=row.kcal_per_100g,
        proteins_g=row.proteins_g,
        carbs_g=row.carbs_g,
        sugars_g=row.sugars_g,
        fats_g=row.fats_g,
        saturated_fats_g=row.saturated_fats_g,
        fiber_g=row.fiber_g,
        salt_g=row.salt_g,
        price_eur=row.price_eur,
        price_quantity_g=row.price_quantity_g,
        in_personal_library=bool(row.in_personal_library),
        category_l1=row.category_l1,
        category_l2=row.category_l2,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _ing_apply(row: IngredientRow, ing: Ingredient) -> None:
    row.name = ing.name
    row.source = ing.source.value
    row.source_ref = ing.source_ref
    row.kcal_per_100g = ing.kcal_per_100g
    row.proteins_g = ing.proteins_g
    row.carbs_g = ing.carbs_g
    row.sugars_g = ing.sugars_g
    row.fats_g = ing.fats_g
    row.saturated_fats_g = ing.saturated_fats_g
    row.fiber_g = ing.fiber_g
    row.salt_g = ing.salt_g
    row.price_eur = ing.price_eur
    row.price_quantity_g = ing.price_quantity_g
    row.in_personal_library = ing.in_personal_library
    row.category_l1 = ing.category_l1
    row.category_l2 = ing.category_l2


def _recipe_to_domain(row: RecipeRow) -> Recipe:
    return Recipe(
        id=row.id,
        name=row.name,
        instructions=row.instructions,
        default_portions=row.default_portions,
        image_path=row.image_path,
        lines=[
            RecipeLine(
                ingredient=_ing_to_domain(line.ingredient),
                quantity_g=line.quantity_g,
                notes=line.notes,
                ordinal=line.ordinal,
            )
            for line in row.lines
        ],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _entry_to_domain(row: MealPlanEntryRow) -> MealPlanEntry:
    return MealPlanEntry(
        id=row.id,
        iso_week=row.iso_week,
        day_of_week=row.day_of_week,
        slot=MealSlot(row.slot),
        recipe_id=row.recipe_id,
        ingredient_id=row.ingredient_id,
        quantity_g=row.quantity_g,
        portions=row.portions,
        ordinal=row.ordinal,
    )


# --------------------------------------------------------------------------- #
# IngredientRepo
# --------------------------------------------------------------------------- #


class IngredientRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def get(self, ingredient_id: int) -> Ingredient | None:
        row = self.s.get(IngredientRow, ingredient_id)
        return _ing_to_domain(row) if row else None

    def list_all(self, limit: int | None = None) -> list[Ingredient]:
        stmt = select(IngredientRow).order_by(IngredientRow.name)
        if limit is not None:
            stmt = stmt.limit(limit)
        return [_ing_to_domain(r) for r in self.s.execute(stmt).scalars()]

    def list_personal(self, limit: int | None = None) -> list[Ingredient]:
        """Only entries the user has imported / created — drives the Ingredients tab."""
        stmt = (
            select(IngredientRow)
            .where(IngredientRow.in_personal_library.is_(True))
            .order_by(IngredientRow.name)
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        return [_ing_to_domain(r) for r in self.s.execute(stmt).scalars()]

    def find_by_source_ref(self, source: Source, source_ref: str) -> Ingredient | None:
        stmt = select(IngredientRow).where(
            IngredientRow.source == source.value,
            IngredientRow.source_ref == source_ref,
        )
        row = self.s.execute(stmt).scalar_one_or_none()
        return _ing_to_domain(row) if row else None

    def create(self, ing: Ingredient) -> Ingredient:
        row = IngredientRow()
        _ing_apply(row, ing)
        self.s.add(row)
        self.s.flush()
        return _ing_to_domain(row)

    def update(self, ing: Ingredient) -> Ingredient:
        if ing.id is None:
            raise ValueError("update requires an Ingredient with id")
        row = self.s.get(IngredientRow, ing.id)
        if row is None:
            raise LookupError(f"Ingredient {ing.id} not found")
        _ing_apply(row, ing)
        self.s.flush()
        return _ing_to_domain(row)

    def upsert_by_source_ref(self, ing: Ingredient) -> Ingredient:
        """Insert if (source, source_ref) is new, otherwise update in place."""
        if ing.source_ref is None:
            return self.create(ing)
        existing = self.find_by_source_ref(ing.source, ing.source_ref)
        if existing is None:
            return self.create(ing)
        ing_with_id = ing.model_copy(update={"id": existing.id})
        return self.update(ing_with_id)

    def delete(self, ingredient_id: int) -> None:
        row = self.s.get(IngredientRow, ingredient_id)
        if row is not None:
            self.s.delete(row)
            self.s.flush()

    # Mapping from logical sort fields to SQL column refs. Used by both
    # `search_fts` (the rich one) and the legacy positional shim.
    _SORT_COLUMNS: dict[str, str] = {
        "name": "i.name",
        "kcal": "i.kcal_per_100g",
        "proteins": "i.proteins_g",
        "carbs": "i.carbs_g",
        "fats": "i.fats_g",
    }

    def search_fts(
        self,
        query: str | None = None,
        limit: int = 20,
        *,
        scope: str = "all",
        source: Source | None = None,
        opts: SearchOptions | None = None,
    ) -> list[Ingredient] | SearchPage:
        """Search ingredients with optional FTS5 prefix matching, filters, sort and pagination.

        Two call shapes:

        - **Legacy** (for backward compat with existing callers): pass `query`,
          `limit`, `scope`, `source` positionally. Returns `list[Ingredient]`.
        - **New** (for the rich import dialog): pass a `SearchOptions` via `opts`.
          Returns a `SearchPage` (matches + total_count + pagination metadata).

        scope:
          - 'all'      : search the entire local DB (CIQUAL + OFF cache + personal)
          - 'personal' : restrict to entries flagged in_personal_library = 1
        """
        if opts is None:
            # Legacy path: build a minimal opts and unwrap to a list at the end.
            opts = SearchOptions(
                query=query or "",
                scope=scope,
                source=source,
                page=1,
                page_size=limit,
            )
            page = self._search_page(opts)
            return page.matches
        return self._search_page(opts)

    def _search_page(self, opts: SearchOptions) -> SearchPage:
        q = opts.query.strip()

        # ---- Build the WHERE clauses common to count and fetch -----------------
        where: list[str] = []
        params: dict[str, object] = {}
        joins = ""
        order_by = "i.name"  # default, may be overridden below

        if q:
            # Escape FTS5 special chars by quoting each token, then add prefix '*'.
            tokens = [f'"{t}"*' for t in q.split() if t]
            if not tokens:
                return SearchPage(matches=[], total_count=0, page=opts.page, page_size=opts.page_size)
            params["q"] = " ".join(tokens)
            joins = "JOIN ingredient_fts f ON f.rowid = i.id"
            where.append("ingredient_fts MATCH :q")
            order_by = "rank"  # FTS5 relevance score

        if opts.scope == "personal":
            where.append("i.in_personal_library = 1")
        if opts.source is not None:
            where.append("i.source = :source")
            params["source"] = opts.source.value

        # Numeric filters
        f = opts.filters
        if f.min_kcal is not None:
            where.append("i.kcal_per_100g >= :min_kcal")
            params["min_kcal"] = f.min_kcal
        if f.max_kcal is not None:
            where.append("i.kcal_per_100g <= :max_kcal")
            params["max_kcal"] = f.max_kcal
        if f.min_proteins is not None:
            where.append("i.proteins_g >= :min_proteins")
            params["min_proteins"] = f.min_proteins
        if f.max_proteins is not None:
            where.append("i.proteins_g <= :max_proteins")
            params["max_proteins"] = f.max_proteins
        if f.min_carbs is not None:
            where.append("i.carbs_g >= :min_carbs")
            params["min_carbs"] = f.min_carbs
        if f.max_carbs is not None:
            where.append("i.carbs_g <= :max_carbs")
            params["max_carbs"] = f.max_carbs
        if f.min_fats is not None:
            where.append("i.fats_g >= :min_fats")
            params["min_fats"] = f.min_fats
        if f.max_fats is not None:
            where.append("i.fats_g <= :max_fats")
            params["max_fats"] = f.max_fats
        if f.category_l1:
            where.append("i.category_l1 = :cat_l1")
            params["cat_l1"] = f.category_l1

        # ---- Sort: explicit field overrides default ranking. NULLs go last. ----
        if opts.sort_by != "rank":
            col = self._SORT_COLUMNS.get(opts.sort_by, "i.name")
            direction = "DESC" if opts.sort_desc else "ASC"
            # Push NULLs to the end so a sort by proteins doesn't surface unset rows.
            order_by = f"({col} IS NULL), {col} {direction}, i.name ASC"

        where_sql = (" WHERE " + " AND ".join(where)) if where else ""

        # ---- COUNT total (pagination needs this) -------------------------------
        count_sql = text(f"SELECT COUNT(*) FROM ingredient i {joins}{where_sql}")
        total_count = int(self.s.execute(count_sql, params).scalar() or 0)
        if total_count == 0:
            return SearchPage(matches=[], total_count=0, page=opts.page, page_size=opts.page_size)

        # ---- FETCH the ids on the requested page -------------------------------
        page = max(1, opts.page)
        page_size = max(1, opts.page_size)
        offset = (page - 1) * page_size
        params["limit"] = page_size
        params["offset"] = offset
        page_sql = text(
            f"SELECT i.id FROM ingredient i {joins}{where_sql} "
            f"ORDER BY {order_by} LIMIT :limit OFFSET :offset"
        )
        ids = [row[0] for row in self.s.execute(page_sql, params)]
        if not ids:
            return SearchPage(matches=[], total_count=total_count, page=page, page_size=page_size)

        rows = self.s.execute(
            select(IngredientRow).where(IngredientRow.id.in_(ids))
        ).scalars()
        by_id = {r.id: r for r in rows}
        # Preserve the ORDER BY result order.
        matches = [_ing_to_domain(by_id[i]) for i in ids if i in by_id]
        return SearchPage(matches=matches, total_count=total_count, page=page, page_size=page_size)

    def list_categories_l1(self, source: Source | None = None) -> list[str]:
        """Distinct level-1 categories present in the DB. Used to populate the
        category dropdown in the import dialog. Sorted alphabetically."""
        stmt = (
            select(distinct(IngredientRow.category_l1))
            .where(IngredientRow.category_l1.isnot(None))
            .order_by(IngredientRow.category_l1)
        )
        if source is not None:
            stmt = stmt.where(IngredientRow.source == source.value)
        return [c for c in self.s.execute(stmt).scalars() if c]

    def mark_in_personal_library(self, ingredient_id: int, value: bool = True) -> Ingredient | None:
        """Flip the personal-library flag. Used when the user imports/picks an ingredient."""
        row = self.s.get(IngredientRow, ingredient_id)
        if row is None:
            return None
        row.in_personal_library = value
        self.s.flush()
        return _ing_to_domain(row)


# --------------------------------------------------------------------------- #
# RecipeRepo
# --------------------------------------------------------------------------- #


class RecipeRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def _load_with_lines(self, recipe_id: int) -> RecipeRow | None:
        stmt = (
            select(RecipeRow)
            .where(RecipeRow.id == recipe_id)
            .options(selectinload(RecipeRow.lines).selectinload(RecipeIngredientRow.ingredient))
        )
        return self.s.execute(stmt).scalar_one_or_none()

    def get(self, recipe_id: int) -> Recipe | None:
        row = self._load_with_lines(recipe_id)
        return _recipe_to_domain(row) if row else None

    def list_all(self) -> list[Recipe]:
        stmt = (
            select(RecipeRow)
            .order_by(RecipeRow.name)
            .options(selectinload(RecipeRow.lines).selectinload(RecipeIngredientRow.ingredient))
        )
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
        self.s.flush()
        return _recipe_to_domain(self._load_with_lines(row.id))  # type: ignore[arg-type]

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
                    notes=line.notes,
                    ordinal=line.ordinal or idx,
                )
            )

    def delete(self, recipe_id: int) -> None:
        row = self.s.get(RecipeRow, recipe_id)
        if row is not None:
            self.s.delete(row)
            self.s.flush()


# --------------------------------------------------------------------------- #
# MealPlanRepo
# --------------------------------------------------------------------------- #


class MealPlanRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def list_by_week(self, iso_week: str) -> list[MealPlanEntry]:
        stmt = (
            select(MealPlanEntryRow)
            .where(MealPlanEntryRow.iso_week == iso_week)
            .order_by(
                MealPlanEntryRow.day_of_week,
                MealPlanEntryRow.slot,
                MealPlanEntryRow.ordinal,
            )
        )
        return [_entry_to_domain(r) for r in self.s.execute(stmt).scalars()]

    def add(self, entry: MealPlanEntry) -> MealPlanEntry:
        row = MealPlanEntryRow(
            iso_week=entry.iso_week,
            day_of_week=entry.day_of_week,
            slot=entry.slot.value,
            recipe_id=entry.recipe_id,
            ingredient_id=entry.ingredient_id,
            quantity_g=entry.quantity_g,
            portions=entry.portions,
            ordinal=entry.ordinal,
        )
        self.s.add(row)
        self.s.flush()
        return _entry_to_domain(row)

    def remove(self, entry_id: int) -> None:
        row = self.s.get(MealPlanEntryRow, entry_id)
        if row is not None:
            self.s.delete(row)
            self.s.flush()
