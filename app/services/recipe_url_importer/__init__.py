"""Public façade of the recipe URL importer package.

Use `fetch_recipe(url)` from outside this package — the rest are
implementation details exposed for tests."""

from .core import (
    NetworkError,
    NoRecipeFound,
    ParseError,
    RecipeImportError,
    UnsupportedSite,
    fetch_recipe,
)
from .quantity_parser import parse_french_quantity

__all__ = [
    "fetch_recipe",
    "parse_french_quantity",
    "RecipeImportError",
    "UnsupportedSite",
    "NoRecipeFound",
    "ParseError",
    "NetworkError",
]
