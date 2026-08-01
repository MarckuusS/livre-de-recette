"""Search dataclasses shared by `IngredientRepo.search_fts` and the import dialog.

Module-private (`_search`) because these are internal building blocks ; the
public `__init__.py` re-exports `SearchFilters`, `SearchOptions`, `SearchPage`
to keep the existing call site `from app.data.repositories import SearchOptions`
working."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.domain.models import Ingredient, Source

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
