"""Public façade for the repositories package.

Re-exports every public name so the existing call sites :

    from app.data.repositories import IngredientRepo, RecipeRepo, SearchOptions

continue to work unchanged after the A6 split. The internal organization is :

    repositories/
    ├── _search.py      — SearchFilters / SearchOptions / SearchPage / SortField
    ├── _mappers.py     — ORM ↔ Pydantic helpers (private, used by the repos)
    ├── ingredient.py   — IngredientRepo
    ├── recipe.py       — RecipeRepo
    ├── tag.py          — TagRepo
    ├── meal_plan.py    — MealPlanRepo
    ├── weekly_cost.py  — WeeklyCostRepo
    └── price_history.py — PriceHistoryRepo

Internal modules import each other directly (e.g. `RecipeRepo` does
`from ._mappers import _recipe_to_domain`). Other layers (services, viewmodels)
stay on the public façade — they should never reach into `_mappers` or `_search`.
"""

from __future__ import annotations

from ._search import SearchFilters, SearchOptions, SearchPage, SortField
from .category import CategoryNode, CategoryRepo
from .cooking_log import CookingLogRepo
from .imported_receipt import ImportedReceiptRepo
from .ingredient import IngredientRepo
from .lidl_plus_settings import LidlPlusSettings, LidlPlusSettingsRepo
from .meal_plan import MealPlanRepo
from .pantry import PantryRepo
from .price_history import PriceHistoryRepo
from .receipt_alias import ReceiptAliasRepo
from .recipe import RecipeRepo
from .tag import TagRepo
from .weekly_cost import WeeklyCostRepo

__all__ = [
    "IngredientRepo",
    "RecipeRepo",
    "TagRepo",
    "MealPlanRepo",
    "WeeklyCostRepo",
    "PriceHistoryRepo",
    "PantryRepo",
    "CookingLogRepo",
    "ImportedReceiptRepo",
    "ReceiptAliasRepo",
    "LidlPlusSettings",
    "LidlPlusSettingsRepo",
    "CategoryRepo",
    "CategoryNode",
    "SearchFilters",
    "SearchOptions",
    "SearchPage",
    "SortField",
]
