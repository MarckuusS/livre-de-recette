"""IngredientRepo : CRUD + FTS5 search + filters/sort/pagination."""

from __future__ import annotations

from sqlalchemy import distinct, select, text
from sqlalchemy.orm import Session

from app.domain.models import Ingredient, Source

from ..orm import IngredientRow
from ._mappers import _ing_apply, _ing_to_domain
from ._search import SearchOptions, SearchPage


class IngredientRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def get(self, ingredient_id: int) -> Ingredient | None:
        row = self.s.get(IngredientRow, ingredient_id)
        return _ing_to_domain(row) if row else None

    def list_by_ids(self, ingredient_ids: list[int] | set[int]) -> dict[int, Ingredient]:
        """Bulk-load by IDs in a single SELECT. Returns a dict {id: Ingredient}
        so callers can do O(1) lookup. Empty IDs → empty dict (no SQL emitted).

        Used by `shopping_service.aggregate_shopping_list` to avoid N+1 :
        one SELECT WHERE id IN (...) instead of N individual `get()` calls."""
        ids = list(ingredient_ids)
        if not ids:
            return {}
        stmt = select(IngredientRow).where(IngredientRow.id.in_(ids))
        return {r.id: _ing_to_domain(r) for r in self.s.execute(stmt).scalars()}

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

    def find_by_name(
        self,
        name: str,
        source: Source = Source.MANUAL,
    ) -> Ingredient | None:
        """Case-insensitive lookup by name within a single source. Used by
        `IngredientViewModel.saveFromDict` (B4) to detect duplicate manual
        entries before creating a new one ("Œufs" already exists). Whitespace
        is stripped before comparison ; only the same source is matched
        because CIQUAL/OFF use `source_ref` as their natural key.

        Implementation : we filter in Python with `str.casefold()` rather than
        SQL `LOWER()` because SQLite's default `LOWER()` only handles ASCII
        — it leaves Unicode like "Œ" untouched, which would miss collisions
        on French names (Œufs vs œufs). The candidate set (rows of one
        source for one user) is small enough that this is fine."""
        normalized = (name or "").strip().casefold()
        if not normalized:
            return None
        stmt = select(IngredientRow).where(IngredientRow.source == source.value)
        for row in self.s.execute(stmt).scalars():
            if (row.name or "").strip().casefold() == normalized:
                return _ing_to_domain(row)
        return None

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
