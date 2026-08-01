"""Unified ingredient search.

Local FTS5 first (fast, offline). The OpenFoodFacts fallback is *explicit* — never
called from a keystroke, only when the user clicks "Search online" or types what
looks like a barcode.

The Ingredients tab uses scope='personal' (filters to in_personal_library=1).
The Recipes/Calendar pickers use scope='all' so they can surface CIQUAL & cached OFF
entries that aren't yet in the user's library — picking one promotes it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.data.repositories import (
    IngredientRepo,
    SearchFilters,
    SearchOptions,
    SearchPage,
)
from app.domain.models import Ingredient, Source
from app.services import openfoodfacts

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class SearchResult:
    """Result of a local-only search. The caller decides whether to fall back to OFF."""

    matches: list[Ingredient]
    looks_like_barcode: bool  # True when the input is 8/12/13 all-digit chars
    query: str

    @property
    def is_empty(self) -> bool:
        return len(self.matches) == 0


def _looks_like_barcode(q: str) -> bool:
    s = q.strip()
    return s.isdigit() and len(s) in (8, 12, 13)


def search_local(
    session: Session,
    query: str,
    limit: int = 20,
    *,
    scope: str = "all",
    source: Source | None = None,
) -> SearchResult:
    """FTS5 prefix search against the local DB. No network, no side effects.

    Compatibility wrapper around `search_local_page` for callers that don't need
    pagination/filters/sort (the live picker in Recipes/Calendar). Returns the
    legacy `SearchResult` with the first `limit` matches.

    See `IngredientRepo.search_fts` and `SearchOptions` for full semantics.
    """
    q = query.strip()
    matches: list[Ingredient] = []
    if q:
        repo = IngredientRepo(session)
        matches = repo.search_fts(q, limit=limit, scope=scope, source=source)  # type: ignore[assignment]
    return SearchResult(matches=matches, looks_like_barcode=_looks_like_barcode(q), query=q)


def search_local_page(session: Session, opts: SearchOptions) -> SearchPage:
    """Rich local search used by the Import dialog: filters / sort / pagination.
    Caller may pass an empty query — that's how the dialog says 'show me every
    CIQUAL row in this category, no keyword filtering'."""
    return IngredientRepo(session).search_fts(opts=opts)


def list_local_categories(session: Session, source: Source | None = None) -> list[str]:
    """Distinct level-1 categories present in the DB. Used to populate the
    category dropdown of the import dialog."""
    return IngredientRepo(session).list_categories_l1(source=source)


def fetch_from_openfoodfacts_and_cache(
    session: Session,
    query_or_barcode: str,
    *,
    add_to_personal_library: bool = False,
    page: int = 1,
    page_size: int = 25,
    sort_by: str | None = None,
    filters: SearchFilters | None = None,
) -> tuple[list[Ingredient], int]:
    """Hit OpenFoodFacts, persist the results, and return them.

    Branches on `_looks_like_barcode`:
      - barcode -> /api/v2/product/{ean} (single result or none) — pagination/sort/filters
                   ignored, the EAN identifies a single product.
      - else    -> Search-a-licious — pagination + sort + Lucene filters all forwarded.

    Returns `(matches, total_count)`. For the barcode branch `total_count` is 0 or 1.

    By default fetched rows are cached locally but NOT added to the personal library —
    the user picks which result(s) to promote via the Import dialog's double-click.
    """
    q = query_or_barcode.strip()
    if not q and filters is None:
        # Nothing to search for, don't generate a wildcard query at the API level.
        return [], 0

    repo = IngredientRepo(session)

    if _looks_like_barcode(q):
        ing = openfoodfacts.lookup_barcode(q)
        fetched: list[Ingredient] = [ing] if ing is not None else []
        total = len(fetched)
    else:
        # Translate domain-side filters (SearchFilters) to the API-side dict shape.
        api_filters: dict[str, float | str | None] | None = None
        if filters is not None:
            api_filters = {
                "min_kcal": filters.min_kcal,
                "max_kcal": filters.max_kcal,
                "min_proteins": filters.min_proteins,
                "max_proteins": filters.max_proteins,
                "min_carbs": filters.min_carbs,
                "max_carbs": filters.max_carbs,
                "min_fats": filters.min_fats,
                "max_fats": filters.max_fats,
                "category_tag": filters.category_l1,  # OFF expects "fr:legumes" etc.
            }
        fetched, total = openfoodfacts.search_by_name(
            q,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            filters=api_filters,
        )

    cached: list[Ingredient] = []
    for ing in fetched:
        if add_to_personal_library:
            ing = ing.model_copy(update={"in_personal_library": True})
        cached.append(repo.upsert_by_source_ref(ing))
    return cached, total


def promote_to_personal_library(session: Session, ingredient_id: int) -> Ingredient | None:
    """Flag an existing local ingredient as part of the user's library."""
    return IngredientRepo(session).mark_in_personal_library(ingredient_id, True)


def resolve_ingredient_name(
    session: Session,
    name: str,
    *,
    max_candidates: int = 5,
) -> list[Ingredient]:
    """Resolve a free-text ingredient name to a ranked candidate list.

    Used by the URL recipe importer when matching extracted lines like
    "tomates cerises" against the local DB. Strategy (best-first) :

      1. Exact case-fold match in `in_personal_library=True` (score 1.0)
         — the user's hand-curated entries always win.
      2. FTS5 prefix match in `in_personal_library=True` (top N).
      3. If the personal pool yields < max_candidates : extend with FTS5
         prefix in scope='all' (CIQUAL + cached OFF rows).

    The final list is re-ranked via rapidfuzz token similarity against
    `name`, so close-but-not-prefix matches ("tomate" → "Tomate cerise")
    are surfaced near the top. Personal-library matches keep priority
    (their score gets a +0.1 boost to break ties with library entries).

    Never hits the network. The VM calls
    `fetch_from_openfoodfacts_and_cache(...)` explicitly when the user
    presses "Chercher en ligne" on an unmatched line.
    """
    q = (name or "").strip()
    if not q:
        return []

    repo = IngredientRepo(session)
    seen_ids: set[int] = set()
    pool: list[tuple[Ingredient, float]] = []  # (ingredient, score_boost)

    # 1) Exact match in personal library (case-fold)
    exact = repo.find_by_name(q, source=Source.MANUAL)
    if exact is None:
        # find_by_name is scoped per source — try each
        for src in (Source.CIQUAL, Source.OPENFOODFACTS):
            cand = repo.find_by_name(q, source=src)
            if cand is not None and cand.in_personal_library and cand.id is not None:
                pool.append((cand, 0.10))
                seen_ids.add(cand.id)
                break
    elif exact.in_personal_library and exact.id is not None:
        pool.append((exact, 0.10))
        seen_ids.add(exact.id)

    # 2) FTS prefix in personal library
    personal = repo.search_fts(q, limit=max_candidates * 2, scope="personal")
    for ing in personal:
        if ing.id is not None and ing.id not in seen_ids:
            pool.append((ing, 0.10))
            seen_ids.add(ing.id)

    # 3) Extend with scope='all' (CIQUAL + cached OFF) if needed
    if len(pool) < max_candidates:
        all_scope = repo.search_fts(q, limit=max_candidates * 2, scope="all")
        for ing in all_scope:
            if ing.id is not None and ing.id not in seen_ids:
                pool.append((ing, 0.0))
                seen_ids.add(ing.id)

    if not pool:
        return []

    # Re-rank using rapidfuzz token-set ratio (handles word reordering and
    # accents poorly — but our names are already accent-folded by FTS).
    try:
        from rapidfuzz import fuzz
    except ImportError:
        return [ing for ing, _ in pool[:max_candidates]]

    scored: list[tuple[float, Ingredient]] = []
    for ing, boost in pool:
        sim = fuzz.token_set_ratio(q.lower(), ing.name.lower()) / 100.0
        scored.append((sim + boost, ing))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [ing for _, ing in scored[:max_candidates]]
