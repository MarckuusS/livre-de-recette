"""ORM ↔ Pydantic mapping helpers. Module-private — only used by the repos.

Centralized here (rather than duplicated in each repo file) because the same
helper is consumed by multiple repos : `_ing_to_domain` is used by both
`IngredientRepo` (search hydration) and `RecipeRepo` (recipe lines hydration).
"""

from __future__ import annotations

from app.domain.models import (
    Ingredient,
    MealPlanEntry,
    MealSlot,
    PriceHistoryEntry,
    Recipe,
    RecipeLine,
    Source,
    Tag,
    WeeklyCostSnapshot,
)

from ..orm import (
    IngredientPriceHistoryRow,
    IngredientRow,
    MealPlanEntryRow,
    RecipeRow,
    TagRow,
    WeeklyCostSnapshotRow,
)


def _ing_to_domain(row: IngredientRow) -> Ingredient:
    return Ingredient(
        id=row.id,
        name=row.name,
        source=Source(row.source),
        source_ref=row.source_ref,
        brand=row.brand,
        cooked_weight_per_100g_raw=row.cooked_weight_per_100g_raw,
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
        piece_weight_g=row.piece_weight_g,
        in_personal_library=bool(row.in_personal_library),
        category_l1=row.category_l1,
        category_l2=row.category_l2,
        season_months=row.season_months,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _ing_apply(row: IngredientRow, ing: Ingredient) -> None:
    row.name = ing.name
    row.source = ing.source.value
    row.source_ref = ing.source_ref
    row.brand = ing.brand
    row.cooked_weight_per_100g_raw = ing.cooked_weight_per_100g_raw
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
    row.piece_weight_g = ing.piece_weight_g
    row.in_personal_library = ing.in_personal_library
    row.category_l1 = ing.category_l1
    row.category_l2 = ing.category_l2
    row.season_months = ing.season_months


def _tag_to_domain(row: TagRow) -> Tag:
    return Tag(
        id=row.id,
        name=row.name,
        color_hex=row.color_hex,
        created_at=row.created_at,
    )


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
                unit=line.unit,
                notes=line.notes,
                ordinal=line.ordinal,
            )
            for line in row.lines
        ],
        tags=[_tag_to_domain(t) for t in row.tags],
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


def _cost_to_domain(row: WeeklyCostSnapshotRow) -> WeeklyCostSnapshot:
    return WeeklyCostSnapshot(
        iso_week=row.iso_week,
        total_eur=row.total_eur,
        missing_count=row.missing_count,
        captured_at=row.captured_at,
    )


def _price_to_domain(row: IngredientPriceHistoryRow) -> PriceHistoryEntry:
    return PriceHistoryEntry(
        id=row.id,
        ingredient_id=row.ingredient_id,
        price_eur=row.price_eur,
        quantity_g=row.quantity_g,
        store=row.store,
        recorded_at=row.recorded_at,
        notes=row.notes,
        created_at=row.created_at,
    )
