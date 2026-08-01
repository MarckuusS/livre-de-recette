"""Pure domain models. No Qt, no SQLAlchemy. Source of truth for the business shape."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Source(str, Enum):
    CIQUAL = "ciqual"
    OPENFOODFACTS = "openfoodfacts"
    MANUAL = "manual"
    # Plan v3 : ingrédients identifiés par leur ID produit Lidl Plus
    # (renvoyé par l'API). Le `source_ref` stocke l'art_id Lidl ; ça
    # permet un mapping déterministe lors des imports de tickets Lidl
    # (`IngredientRepo.find_by_source_ref(LIDL, art_id)`).
    LIDL = "lidl"


class MealSlot(str, Enum):
    """Slots of a day in the meal-plan grid. Default 3 (matin / midi / soir),
    plus 2 optional snack slots (B3) that can be enabled via menu Affichage.

    DB stores the string value verbatim (`'morning'`, `'snack_morning'`, …).
    The QML grid is rendered ordered : morning → snack_morning → noon →
    snack_afternoon → evening, matching the day chronologically."""

    MORNING = "morning"
    SNACK_MORNING = "snack_morning"     # ~10h
    NOON = "noon"
    SNACK_AFTERNOON = "snack_afternoon"  # ~16h
    EVENING = "evening"


class Ingredient(BaseModel):
    """An ingredient as stored in the local library. Nutrition is per 100 g (CIQUAL convention).

    Validators (A1) :
      - `name` : non-empty after trimming.
      - Macros per 100 g (`kcal_per_100g`, `proteins_g`, …) : None ou ≥ 0 quand
        renseignés. None signifie "inconnu" et est distinct de 0 (ex. CIQUAL
        n'a pas mesuré la donnée). Un nombre négatif est toujours invalide.
      - `price_eur` : None ou > 0. Un prix nul ou négatif n'a pas de sens.
      - `price_quantity_g`, `piece_weight_g` : None ou > 0.
    """

    model_config = ConfigDict(frozen=False)

    id: int | None = None
    name: str
    source: Source = Source.MANUAL
    source_ref: str | None = None  # CIQUAL code or EAN barcode
    # Marque commerciale (ex: "Pâturages", "Carrefour Bio"). Auto-rempli pour
    # les ingrédients OFF depuis le champ `brands` de l'API ; éditable
    # manuellement par l'utilisateur via le formulaire. None pour CIQUAL et
    # les manual sans marque.
    brand: str | None = None

    # Macros per 100 g — None means "unknown", which differs from 0.
    kcal_per_100g: float | None = None
    proteins_g: float | None = None
    carbs_g: float | None = None
    sugars_g: float | None = None
    fats_g: float | None = None
    saturated_fats_g: float | None = None
    fiber_g: float | None = None
    salt_g: float | None = None

    # Cost is user-provided (OFF does not expose price).
    price_eur: Decimal | None = None
    price_quantity_g: float | None = None  # weight the price refers to (e.g. 250 g pack)

    # Optional weight of one "piece" (1 egg ~60 g, 1 onion ~150 g, 1 garlic clove ~5 g).
    # When set, the QuantityField in pickers exposes a "pièce" unit that converts to
    # grams via this weight. None = the ingredient has no natural piece size (oil,
    # rice, salt, …).
    piece_weight_g: float | None = None

    # Poids cuit pour 100 g cru. NULL = pas de conversion connue, on assume 1:1
    # (huile, sel, légumes crus mangés crus). Pour les féculents qui boivent
    # de l'eau (riz, pâtes, légumineuses) : ex 300.0 = 100 g de riz cru →
    # 300 g cuit. Sert à estimer le poids d'une portion servie sur la page
    # Recettes. Les valeurs nutritionnelles restent calculées en cru
    # (convention CIQUAL — `proteins_g` etc. sont par 100 g cru).
    cooked_weight_per_100g_raw: float | None = None

    # True when the user has explicitly added this entry to their working library.
    # CIQUAL/OFF rows seeded silently start at False — they remain searchable from the
    # picker but don't clutter the Ingredients tab until the user picks/imports them.
    in_personal_library: bool = False

    # CIQUAL classification: 2 levels are persisted (the 3rd level is too granular).
    # Empty for OFF and manual entries.
    category_l1: str | None = None
    category_l2: str | None = None

    # C3 : seasonality. CSV of months 1..12 ("6,7,8,9" = juin-sept). NULL =
    # no data (the QML "🌱 de saison" badge isn't shown). Set automatically
    # by `app/data/seeds/seasons.py` for ~50 well-known ingredients ;
    # editable by the user.
    season_months: str | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    # ---- Validators ----

    @field_validator("name")
    @classmethod
    def _name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Le nom de l'ingrédient ne peut pas être vide.")
        return v

    @field_validator(
        "kcal_per_100g", "proteins_g", "carbs_g", "sugars_g",
        "fats_g", "saturated_fats_g", "fiber_g", "salt_g",
    )
    @classmethod
    def _macros_non_negative(cls, v: float | None) -> float | None:
        # None = "inconnu" (différent de 0). Un nombre négatif est invalide.
        if v is not None and v < 0:
            raise ValueError("Les macros par 100 g ne peuvent pas être négatives.")
        return v

    @field_validator("price_eur")
    @classmethod
    def _price_strictly_positive(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v <= 0:
            raise ValueError("Le prix doit être strictement positif.")
        return v

    @field_validator("price_quantity_g", "piece_weight_g", "cooked_weight_per_100g_raw")
    @classmethod
    def _quantity_strictly_positive(cls, v: float | None) -> float | None:
        if v is not None and v <= 0:
            raise ValueError("Une quantité (g) doit être strictement positive.")
        return v

    @property
    def price_per_g(self) -> Decimal | None:
        if self.price_eur is None or not self.price_quantity_g:
            return None
        return self.price_eur / Decimal(str(self.price_quantity_g))


class RecipeLine(BaseModel):
    """One ingredient inside a recipe, normalized to grams.

    `unit` (refonte UX) : code d'unité saisi par l'utilisateur dans le
    QuantityField (g, kg, ml, cl, dl, L, c_cafe, c_soupe, tasse, pincee,
    _piece). Stocké pour restitution fidèle au reload — sans ce champ
    l'heuristique du QuantityField écrase le choix utilisateur. Optional
    pour rétrocompat avec les recettes saisies avant la migration.
    """

    ingredient: Ingredient
    quantity_g: float = Field(gt=0)  # validé par Pydantic via Field
    unit: str | None = None
    notes: str | None = None
    ordinal: int = Field(default=0, ge=0)


class Tag(BaseModel):
    """A user-or-system-defined label that can be attached to recipes
    (entrée / plat principal / végétarien / rapide / …)."""

    model_config = ConfigDict(frozen=False)

    id: int | None = None
    name: str
    # Hex color for the chip fill in QML. Default = neutral gray. Format `#RRGGBB`
    # or `#RRGGBBAA`. No validation — Qt accepts anything reasonable.
    color_hex: str = "#9ca3af"
    created_at: datetime | None = None

    @field_validator("name")
    @classmethod
    def _name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Le nom du tag ne peut pas être vide.")
        return v


class Recipe(BaseModel):
    id: int | None = None
    name: str
    instructions: str = ""
    default_portions: int = Field(default=1, ge=1)
    image_path: str | None = None
    lines: list[RecipeLine] = Field(default_factory=list)
    tags: list[Tag] = Field(default_factory=list)

    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator("name")
    @classmethod
    def _name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Le nom de la recette ne peut pas être vide.")
        return v


class NutritionTotal(BaseModel):
    """Aggregated nutrition values. All fields in absolute units (not per 100 g)."""

    kcal: float = 0.0
    proteins_g: float = 0.0
    carbs_g: float = 0.0
    sugars_g: float = 0.0
    fats_g: float = 0.0
    saturated_fats_g: float = 0.0
    fiber_g: float = 0.0
    salt_g: float = 0.0

    def __add__(self, other: NutritionTotal) -> NutritionTotal:
        return NutritionTotal(
            kcal=self.kcal + other.kcal,
            proteins_g=self.proteins_g + other.proteins_g,
            carbs_g=self.carbs_g + other.carbs_g,
            sugars_g=self.sugars_g + other.sugars_g,
            fats_g=self.fats_g + other.fats_g,
            saturated_fats_g=self.saturated_fats_g + other.saturated_fats_g,
            fiber_g=self.fiber_g + other.fiber_g,
            salt_g=self.salt_g + other.salt_g,
        )

    def divided_by(self, n: float) -> NutritionTotal:
        if n <= 0:
            raise ValueError("portions must be > 0")
        return NutritionTotal(
            kcal=self.kcal / n,
            proteins_g=self.proteins_g / n,
            carbs_g=self.carbs_g / n,
            sugars_g=self.sugars_g / n,
            fats_g=self.fats_g / n,
            saturated_fats_g=self.saturated_fats_g / n,
            fiber_g=self.fiber_g / n,
            salt_g=self.salt_g / n,
        )


class IsoWeek(BaseModel):
    """ISO week key '<year>-W<week>'. Used as the calendar's natural key."""

    value: str

    @field_validator("value")
    @classmethod
    def _validate(cls, v: str) -> str:
        # Format YYYY-Www, week 01-53.
        if len(v) != 8 or v[4:6] != "-W":
            raise ValueError(f"invalid ISO week '{v}', expected 'YYYY-Www'")
        year = int(v[:4])
        week = int(v[6:])
        if not (2000 <= year <= 2100):
            raise ValueError(f"year out of range: {year}")
        if not (1 <= week <= 53):
            raise ValueError(f"week out of range: {week}")
        return v

    @classmethod
    def from_date(cls, dt: datetime) -> IsoWeek:
        iso = dt.isocalendar()
        return cls(value=f"{iso.year:04d}-W{iso.week:02d}")


class WeeklyCostSnapshot(BaseModel):
    """A snapshot of the total meal-plan cost for a given ISO week.

    Auto-captured by the calendar viewmodel on every refresh — the latest
    snapshot for a week reflects the most recent state. Used to draw the
    "12 dernières semaines" mini-graph in the calendar page (F9).
    """

    model_config = ConfigDict(frozen=True)

    iso_week: str
    total_eur: Decimal
    missing_count: int = 0
    captured_at: datetime | None = None


class PriceHistoryEntry(BaseModel):
    """One observed price for an ingredient at a given store/date.

    Drives the price-history table + line chart (button next to the price
    field on the Ingredients page). The "current price" on the ingredient
    itself remains the user-curated reference value — this table is purely
    additive observation history. Re-stamping the ingredient's reference
    price is the user's choice (e.g. via a "Set as current" button in the
    dialog) — we don't auto-overwrite.
    """

    model_config = ConfigDict(frozen=False)

    id: int | None = None
    ingredient_id: int
    price_eur: Decimal = Field(gt=0)
    quantity_g: float = Field(gt=0)  # the reference quantity (pack size, …)
    store: str | None = None  # enseigne — Auchan / Lidl / Carrefour / …
    recorded_at: datetime  # date the price was observed (user-set)
    notes: str | None = None
    created_at: datetime | None = None

    @property
    def price_per_100g(self) -> Decimal:
        """Convenience: normalize to a comparable €/100g figure."""
        return self.price_eur * Decimal("100") / Decimal(str(self.quantity_g))


class CookingLogEntry(BaseModel):
    """One observation of a recipe being cooked (C2).

    Stored per recipe to build a cooking history : "j'ai mis trop de sel
    la dernière fois", count of times cooked this month, last rating.
    Notes is the most useful field — short free text the user adds after
    a cooking session.
    """

    model_config = ConfigDict(frozen=False)

    id: int | None = None
    recipe_id: int
    cooked_at: datetime
    rating: int | None = Field(default=None)  # 1-5 stars, optional
    notes: str | None = None
    created_at: datetime | None = None

    @field_validator("rating")
    @classmethod
    def _rating_in_range(cls, v: int | None) -> int | None:
        if v is None:
            return None
        if not 1 <= v <= 5:
            raise ValueError("La note doit être comprise entre 1 et 5.")
        return v


class PantryStock(BaseModel):
    """An entry in the user's fridge / pantry inventory (F1).

    Tracks how much of an ingredient the user has on hand and (optionally)
    when it expires. The `PantryPage` displays three sections derived from
    `expiry_date - today` :
      - "À consommer vite" (≤ 5 days, badge red)
      - "À surveiller"     (≤ 14 days, badge orange)
      - "En stock"         (the rest, grouped by `ingredient.category_l1`)

    Linked with the shopping list : `aggregate_shopping_list` reads stock
    levels and pre-checks "déjà au frigo" when `quantity_g >= required`.
    """

    model_config = ConfigDict(frozen=False)

    id: int | None = None
    ingredient_id: int
    quantity_g: float = Field(gt=0)
    expiry_date: datetime | None = None  # None = no expiry tracked (e.g. salt)
    notes: str | None = None
    added_at: datetime | None = None
    updated_at: datetime | None = None


class MealPlanEntry(BaseModel):
    """One item placed in a slot of the weekly calendar.

    XOR rule: exactly one of recipe_id / ingredient_id is set.
    """

    id: int | None = None
    iso_week: str
    day_of_week: int = Field(ge=0, le=6)  # 0 = Monday
    slot: MealSlot

    recipe_id: int | None = None
    ingredient_id: int | None = None

    quantity_g: float | None = None  # used when ingredient_id is set
    portions: float | None = None  # used when recipe_id is set
    ordinal: int = 0

    @field_validator("quantity_g", "portions")
    @classmethod
    def _strictly_positive_when_set(cls, v: float | None) -> float | None:
        if v is not None and v <= 0:
            raise ValueError("quantity_g et portions doivent être strictement positifs.")
        return v

    @model_validator(mode="after")
    def _exclusive_target(self) -> MealPlanEntry:
        has_recipe = self.recipe_id is not None
        has_ingredient = self.ingredient_id is not None
        if has_recipe == has_ingredient:
            raise ValueError(
                "MealPlanEntry must reference exactly one of recipe_id / ingredient_id"
            )
        if has_recipe and self.portions is None:
            raise ValueError("portions is required when recipe_id is set")
        if has_ingredient and self.quantity_g is None:
            raise ValueError("quantity_g is required when ingredient_id is set")
        return self
