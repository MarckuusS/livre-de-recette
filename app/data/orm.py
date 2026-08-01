"""SQLAlchemy ORM tables. Mapped to/from domain Pydantic models at the repository layer."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class IngredientRow(Base):
    __tablename__ = "ingredient"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    source_ref: Mapped[str | None] = mapped_column(String(50))
    # Marque commerciale (Pâturages, Carrefour Bio, etc.). Auto-rempli pour
    # OFF depuis `brands`, éditable. Migration inline `_migrate_add_brand`.
    brand: Mapped[str | None] = mapped_column(String(150))

    kcal_per_100g: Mapped[float | None] = mapped_column()
    proteins_g: Mapped[float | None] = mapped_column()
    carbs_g: Mapped[float | None] = mapped_column()
    sugars_g: Mapped[float | None] = mapped_column()
    fats_g: Mapped[float | None] = mapped_column()
    saturated_fats_g: Mapped[float | None] = mapped_column()
    fiber_g: Mapped[float | None] = mapped_column()
    salt_g: Mapped[float | None] = mapped_column()

    price_eur: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    price_quantity_g: Mapped[float | None] = mapped_column()

    # Optional weight of one "piece" (egg, onion, garlic clove…). When non-NULL,
    # the UI quantity field exposes a "pièce" unit converting through this factor.
    piece_weight_g: Mapped[float | None] = mapped_column()
    # Poids cuit pour 100 g cru (riz, pâtes, légumineuses…). NULL = 1:1.
    # Migration inline `_migrate_add_cooked_weight_per_100g_raw`.
    cooked_weight_per_100g_raw: Mapped[float | None] = mapped_column()

    # User-curated working set flag. False = source catalog only (CIQUAL/OFF cache).
    in_personal_library: Mapped[bool] = mapped_column(default=False, server_default="0")

    # CIQUAL classifies foods on 3 levels; we only persist 2 (granular enough for a
    # category dropdown without exploding the UI). OFF rows leave both NULL for now.
    category_l1: Mapped[str | None] = mapped_column(String(150))
    category_l2: Mapped[str | None] = mapped_column(String(150))

    # C3 : seasonality — comma-separated month numbers (1-12) for which the
    # ingredient is "in season" in France. NULL = unknown / always available
    # (e.g. salt, oil, rice). Seeded for ~50 common ingredients via
    # `app/data/seeds/seasons.py`.
    season_months: Mapped[str | None] = mapped_column(String(50))

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        # Idempotent CIQUAL/OFF imports rely on this uniqueness.
        Index("ix_ingredient_source_ref", "source", "source_ref", unique=True),
    )


class TagRow(Base):
    __tablename__ = "tag"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    color_hex: Mapped[str] = mapped_column(String(9), default="#9ca3af")

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class RecipeTagRow(Base):
    """M2M association table between recipe and tag.

    Explicit class (rather than a bare `Table`) so it shows up in `Base.metadata`
    consistently and benefits from SQLAlchemy's mapper discovery.
    """

    __tablename__ = "recipe_tag"

    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipe.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("tag.id", ondelete="CASCADE"), primary_key=True
    )


class RecipeRow(Base):
    __tablename__ = "recipe"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    instructions: Mapped[str] = mapped_column(Text, default="")
    default_portions: Mapped[int] = mapped_column(Integer, default=1)
    image_path: Mapped[str | None] = mapped_column(String(500))

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    lines: Mapped[list[RecipeIngredientRow]] = relationship(
        back_populates="recipe",
        cascade="all, delete-orphan",
        order_by="RecipeIngredientRow.ordinal",
    )

    tags: Mapped[list[TagRow]] = relationship(
        "TagRow",
        secondary="recipe_tag",
        order_by="TagRow.name",
    )


class RecipeIngredientRow(Base):
    __tablename__ = "recipe_ingredient"

    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipe.id", ondelete="CASCADE"), primary_key=True
    )
    ingredient_id: Mapped[int] = mapped_column(
        ForeignKey("ingredient.id", ondelete="RESTRICT"), primary_key=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True, default=0)

    quantity_g: Mapped[float] = mapped_column(nullable=False)
    notes: Mapped[str | None] = mapped_column(String(200))
    # Refonte UX : code d'unité saisi par l'utilisateur (g, ml, c_cafe, _piece…).
    # Stocké pour que QuantityField restitue la même unité au reload de la
    # recette — sans ce champ, l'heuristique "_piece si pieceWeightG > 0" écrase
    # le choix de l'utilisateur. NULL = ancienne ligne (héritée d'avant la
    # migration), QuantityField retombe sur le default ("g" ou "_piece" selon
    # pieceWeightG).
    unit: Mapped[str | None] = mapped_column(String(16))

    recipe: Mapped[RecipeRow] = relationship(back_populates="lines")
    ingredient: Mapped[IngredientRow] = relationship()


class WeeklyCostSnapshotRow(Base):
    """One row per ISO week — the *latest* observed total cost. Upsert pattern :
    `iso_week` is the primary key, every refresh overwrites the previous value
    so the snapshot tracks the current state of the plan, not a manual archive."""

    __tablename__ = "weekly_cost_snapshot"

    iso_week: Mapped[str] = mapped_column(String(8), primary_key=True)
    total_eur: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    missing_count: Mapped[int] = mapped_column(Integer, default=0)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class RecipeCookingLogRow(Base):
    """Per-recipe cooking history (C2). Append-only log : add an entry when
    a recipe is cooked, optionally rate (1-5) and add notes. Cascade-deletes
    with the recipe."""

    __tablename__ = "recipe_cooking_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipe.id", ondelete="CASCADE"), nullable=False, index=True
    )
    cooked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    rating: Mapped[int | None] = mapped_column(Integer)  # 1-5 stars, nullable
    notes: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_cooking_log_recipe_date", "recipe_id", "cooked_at"),
    )


class MealPlanTemplateRow(Base):
    """A named, reusable weekly meal plan (C1).

    Stores the template's entries as a JSON snapshot rather than relational
    rows. Why : a template is a *recipe of a week* — applied to a target
    ISO week it duplicates entries (each with its own id), but the original
    template never references real `meal_plan_entry` rows. JSON keeps the
    save/apply path simple (no shadow table, no constraints to maintain).

    The snapshot shape is :
        [
          { "day_of_week": 0, "slot": "noon", "recipe_id": 12, "portions": 2.0 },
          { "day_of_week": 0, "slot": "evening", "ingredient_id": 5, "quantity_g": 80.0 },
          ...
        ]
    """

    __tablename__ = "meal_plan_template"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class PantryStockRow(Base):
    """User's fridge / pantry inventory (F1). One row per ingredient *batch*
    (a same ingredient may have several rows with different expiry dates :
    "yaourts qui périment dans 3j" + "yaourts achetés hier" = 2 rows). The
    `PantryRepo.aggregate_quantity_for_ingredient(id)` helper sums batches
    when the shopping list needs the total available stock.

    Cascade-deletes with the ingredient.
    """

    __tablename__ = "pantry_stock"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ingredient_id: Mapped[int] = mapped_column(
        ForeignKey("ingredient.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quantity_g: Mapped[float] = mapped_column(nullable=False)
    expiry_date: Mapped[datetime | None] = mapped_column(DateTime)
    notes: Mapped[str | None] = mapped_column(String(500))
    added_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_pantry_stock_ingredient", "ingredient_id"),
        Index("ix_pantry_stock_expiry", "expiry_date"),
    )


class IngredientPriceHistoryRow(Base):
    """User-recorded observed prices for an ingredient over time.

    Append-only log; the *current* reference price stays on `ingredient.price_eur`
    and is updated by the user when they decide a new observation should become
    the reference. Cascade-deletes with the ingredient.
    """

    __tablename__ = "ingredient_price_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ingredient_id: Mapped[int] = mapped_column(
        ForeignKey("ingredient.id", ondelete="CASCADE"), nullable=False, index=True
    )
    price_eur: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    quantity_g: Mapped[float] = mapped_column(nullable=False)
    store: Mapped[str | None] = mapped_column(String(100))
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_price_history_ingredient_date", "ingredient_id", "recorded_at"),
    )


class ImportedReceiptRow(Base):
    """Anti-doublon des tickets de caisse importés (Plan v3).

    Le `ticket_id` est l'identifiant unique du ticket réel (pas de l'import) :
    - Intermarché : barcode numérique du footer du PDF (~24 chiffres)
    - Lidl Plus   : `data-return-code` (HTML) ou `id` (réponse API)
    - Carrefour   : TBD

    Avant d'importer, le matcher consulte cette table : si `ticket_id` existe,
    le dialog affiche "Déjà importé le X, ignorer ou forcer ?"."""

    __tablename__ = "imported_receipt"

    ticket_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    store: Mapped[str] = mapped_column(String(20), nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    receipt_date: Mapped[datetime | None] = mapped_column(DateTime)
    total_eur: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    line_count: Mapped[int] = mapped_column(Integer, default=0)


class ReceiptAliasRow(Base):
    """Mapping appris : nom-tronqué-de-ticket → ingredient_id (Plan v3).

    Pour Intermarché et Carrefour, les noms de produits sur les tickets sont
    tronqués (ex : "FRANUI FRAMBSE CHOCO" pour "Franui Framboise Chocolat").
    Cette table mémorise la correction utilisateur lors du premier import :
    la prochaine fois que le même `source_key` apparaît, le matcher l'utilise
    en match déterministe (score 1.0).

    Pour Lidl, on N'utilise PAS cette table — l'API renvoie un `art_id` stable
    qu'on stocke directement en `ingredient.source_ref` avec `Source.LIDL`,
    ce qui permet `find_by_source_ref()` direct.

    `source_key` est normalisé (casefold + whitespace collapsé) pour matcher
    indépendamment de la casse et de l'espacement.
    """

    __tablename__ = "receipt_alias"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store: Mapped[str] = mapped_column(String(20), nullable=False)
    source_key: Mapped[str] = mapped_column(String(200), nullable=False)
    ingredient_id: Mapped[int] = mapped_column(
        ForeignKey("ingredient.id", ondelete="CASCADE"), nullable=False, index=True
    )
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_receipt_alias_store_key", "store", "source_key", unique=True),
    )


class CategoryDefinitionRow(Base):
    """Refonte UX (Phase 5) : table éditable des catégories (L1 + L2).

    Structure hiérarchique simple : `parent_id IS NULL` → L1 ; sinon → L2.
    Le `name` reste la clé fonctionnelle (Ingredient.category_l1/l2 stockent
    des chaînes, pas des FK — choix pragmatique pour rétrocompat avec CIQUAL
    qui seede ~50 catégories en TEXT). Au renommage, on cascade-update les
    ingrédients par MATCH sur l'ancien nom.

    `ordinal` permet à l'utilisateur de réordonner les catégories dans
    l'éditeur (drag-up/down). Les nouvelles catégories sont ajoutées à la fin.
    """

    __tablename__ = "category_definition"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("category_definition.id", ondelete="CASCADE")
    )
    ordinal: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        # Unicité du nom DANS UN MÊME PARENT (deux L2 "Verts" sous deux L1
        # différents sont autorisés, mais pas deux "Verts" sous le même L1).
        Index(
            "ix_category_definition_unique_in_parent",
            "parent_id", "name", unique=True,
        ),
    )


class LidlPlusSettingsRow(Base):
    """Configuration de l'auto-fetch Lidl Plus (Plan v3 Phase 5).

    Singleton de fait : une seule ligne (PK fixe = 1). On stocke ici l'état
    persistant (toggle, dernière sync, intervalle) ; les credentials sont en
    dehors de la DB, dans le Windows Credential Manager via `keyring` (jamais
    en clair).

    `last_fetched_at` sert au paramètre `since` de la prochaine requête API,
    pour ne pas re-fetcher des tickets déjà connus.
    """

    __tablename__ = "lidl_plus_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(Integer, default=0, nullable=False)
    poll_interval_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class MealPlanEntryRow(Base):
    __tablename__ = "meal_plan_entry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    iso_week: Mapped[str] = mapped_column(String(8), nullable=False)
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)
    slot: Mapped[str] = mapped_column(String(10), nullable=False)

    recipe_id: Mapped[int | None] = mapped_column(ForeignKey("recipe.id", ondelete="CASCADE"))
    ingredient_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingredient.id", ondelete="CASCADE")
    )

    quantity_g: Mapped[float | None] = mapped_column()
    portions: Mapped[float | None] = mapped_column()
    ordinal: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (
        # Defensive: at least the DB layer agrees with the Pydantic XOR rule.
        CheckConstraint(
            "(recipe_id IS NOT NULL AND ingredient_id IS NULL) OR "
            "(recipe_id IS NULL AND ingredient_id IS NOT NULL)",
            name="ck_meal_plan_entry_xor",
        ),
        Index("ix_meal_plan_week", "iso_week", "day_of_week", "slot"),
    )
