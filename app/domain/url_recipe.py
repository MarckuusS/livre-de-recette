"""Domain models for the URL recipe import pipeline.

A web recipe goes through three states :

  1. Extracted    : raw output of the fetch/parse step (recipe-scrapers or
                    Schema.org JSON-LD fallback). Strings as printed on the
                    page, ingredients still loose ("200 g de tomates cerises").
                    See `ExtractedRecipe` / `ExtractedIngredient`.

  2. Resolved     : per ingredient line, the matcher proposes a list of
                    candidate ingredient ids (perso → CIQUAL → OFF cached).
                    The user picks one (or ignores / creates manually).
                    See `ResolvedLine`.

  3. Committed    : the user clicks "Importer" → the VM builds a regular
                    `Recipe` (Pydantic, app.domain.models) with `RecipeLine`s
                    and persists via `RecipeRepo`. From that point, the
                    new recipe is indistinguishable from one created
                    manually.

These are pure data classes (no Qt, no SQLAlchemy). They sit between :
- `app/services/recipe_url_importer/` (fetch + parse → ExtractedRecipe)
- `app/ui/viewmodels/recipe_url_import_vm.py` (mutable buffer of
  `ResolvedLine`s, exposed to QML during the wizard)
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=False)
class ExtractedIngredient:
    """One ingredient line as printed on the source web page.

    `raw_text` keeps the exact original string for debug / re-extraction.
    `parsed_*` fields are the best-effort output of `parse_french_quantity`
    and may be None when the parser couldn't tell (e.g. "Sel, poivre" or
    "une poignée de noisettes" — the user will fix in the wizard)."""

    raw_text: str
    parsed_name: str
    parsed_quantity: float | None = None
    parsed_unit: str | None = None   # code from app.domain.units.UNITS, or None


@dataclass(frozen=False)
class ExtractedRecipe:
    """Snapshot of a recipe just after fetch/parse, before user review.

    `image_url` is captured but NOT downloaded at commit time — the user
    can attach a photo later through the regular `RecipePhotoBlock`. This
    keeps the import path light (no Pillow at commit, fewer network errors).
    """

    name: str
    instructions: str = ""
    default_portions: int = 1
    prep_time_min: int | None = None
    image_url: str | None = None
    source_url: str = ""
    ingredients: list[ExtractedIngredient] = field(default_factory=list)


@dataclass(frozen=False)
class ResolvedLine:
    """An `ExtractedIngredient` plus the user's resolution state.

    Mutable on purpose — the VM updates this in place as the user picks
    candidates, edits quantities, ignores or creates lines.

    `candidates` is a list of ingredient ids classed best-first by
    `resolve_ingredient_name` (perso > CIQUAL > OFF cached). The QML
    combobox renders these via `ingredientVM.getAsDict(id)`.

    `is_ignored` excludes the line from the final `Recipe` at commit time.
    `is_manual_override` is set when the user edits `parsed_name` so the
    VM knows it should re-search (vs the original parser output).
    """

    extracted: ExtractedIngredient
    candidates: list[int] = field(default_factory=list)   # ingredient ids
    chosen_ingredient_id: int | None = None
    quantity_g: float = 0.0
    unit_code: str = "g"
    is_ignored: bool = False
    is_manual_override: bool = False


@dataclass(frozen=False)
class ResolvedRecipeImport:
    """The full mutable buffer the VM holds during step 1 of the wizard."""

    extracted: ExtractedRecipe
    lines: list[ResolvedLine] = field(default_factory=list)
