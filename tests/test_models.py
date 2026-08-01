from datetime import datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.domain.models import (
    Ingredient,
    IsoWeek,
    MealPlanEntry,
    MealSlot,
    Recipe,
    RecipeLine,
    Source,
    Tag,
)


def test_iso_week_validates_format():
    IsoWeek(value="2026-W01")
    IsoWeek(value="2026-W53")
    with pytest.raises(ValueError):
        IsoWeek(value="2026-01")
    with pytest.raises(ValueError):
        IsoWeek(value="2026-W54")
    with pytest.raises(ValueError):
        IsoWeek(value="2026-W00")


def test_iso_week_from_date():
    # 2026-04-29 is a Wednesday — ISO week 18 of 2026.
    iw = IsoWeek.from_date(datetime(2026, 4, 29))
    assert iw.value == "2026-W18"


def test_meal_plan_entry_recipe_branch():
    e = MealPlanEntry(
        iso_week="2026-W18",
        day_of_week=0,
        slot=MealSlot.NOON,
        recipe_id=42,
        portions=1.0,
    )
    assert e.recipe_id == 42
    assert e.ingredient_id is None


def test_meal_plan_entry_ingredient_branch():
    e = MealPlanEntry(
        iso_week="2026-W18",
        day_of_week=2,
        slot=MealSlot.MORNING,
        ingredient_id=7,
        quantity_g=80.0,
    )
    assert e.ingredient_id == 7


def test_meal_plan_entry_rejects_both_targets():
    with pytest.raises(ValueError):
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=0,
            slot=MealSlot.NOON,
            recipe_id=1,
            ingredient_id=2,
            portions=1.0,
            quantity_g=10.0,
        )


def test_meal_plan_entry_rejects_neither_target():
    with pytest.raises(ValueError):
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=0,
            slot=MealSlot.NOON,
        )


def test_meal_plan_entry_recipe_requires_portions():
    with pytest.raises(ValueError):
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=0,
            slot=MealSlot.NOON,
            recipe_id=1,
        )


def test_meal_plan_entry_ingredient_requires_quantity():
    with pytest.raises(ValueError):
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=0,
            slot=MealSlot.NOON,
            ingredient_id=1,
        )


# ============================================================ A1 — Validators (domain)
# Ces tests vérifient les garde-fous métier ajoutés sur les modèles Pydantic :
#   - Les noms ne peuvent pas être vides (Ingredient, Recipe, Tag).
#   - Les macros par 100 g acceptent None ("inconnu") mais pas les négatifs.
#   - Les prix et quantités sont strictement positifs quand renseignés.
#   - Les portions/quantités d'une entrée calendrier idem.


def test_ingredient_name_cannot_be_empty():
    with pytest.raises(ValidationError):
        Ingredient(name="")
    with pytest.raises(ValidationError):
        Ingredient(name="   ")


def test_ingredient_macros_accept_none_but_reject_negatives():
    # None est valide (= "inconnu", distinct de 0)
    ing = Ingredient(name="Tomate", kcal_per_100g=None, proteins_g=None)
    assert ing.kcal_per_100g is None
    # Zéro reste valide (un aliment réellement à 0 kcal est plausible : eau, etc.)
    ing0 = Ingredient(name="Eau", kcal_per_100g=0.0, proteins_g=0.0)
    assert ing0.kcal_per_100g == 0.0
    # Négatif rejeté
    with pytest.raises(ValidationError):
        Ingredient(name="Bug", kcal_per_100g=-5.0)
    with pytest.raises(ValidationError):
        Ingredient(name="Bug", proteins_g=-0.1)
    with pytest.raises(ValidationError):
        Ingredient(name="Bug", salt_g=-1.0)


def test_ingredient_price_must_be_strictly_positive():
    Ingredient(name="X", price_eur=None)        # OK
    Ingredient(name="X", price_eur=Decimal("0.01"))  # OK
    with pytest.raises(ValidationError):
        Ingredient(name="X", price_eur=Decimal("0"))
    with pytest.raises(ValidationError):
        Ingredient(name="X", price_eur=Decimal("-2.50"))


def test_ingredient_quantities_must_be_strictly_positive():
    Ingredient(name="X", price_quantity_g=None, piece_weight_g=None)
    Ingredient(name="X", price_quantity_g=250.0, piece_weight_g=60.0)
    with pytest.raises(ValidationError):
        Ingredient(name="X", price_quantity_g=0.0)
    with pytest.raises(ValidationError):
        Ingredient(name="X", piece_weight_g=-1.0)


def test_ingredient_cooked_weight_per_100g_raw_validation():
    """Le ratio cru→cuit est optionnel (None = 1:1 implicite). Quand il est
    renseigné il doit être strictement positif (un ratio négatif ou nul n'a
    aucun sens physique : le riz ne perd pas tout son poids à la cuisson)."""
    Ingredient(name="X", cooked_weight_per_100g_raw=None)         # OK : 1:1
    Ingredient(name="Riz", cooked_weight_per_100g_raw=300.0)      # OK : x3
    Ingredient(name="Pois chiche", cooked_weight_per_100g_raw=230.0)
    # Pas autorisé : ≤ 0
    with pytest.raises(ValidationError):
        Ingredient(name="X", cooked_weight_per_100g_raw=0.0)
    with pytest.raises(ValidationError):
        Ingredient(name="X", cooked_weight_per_100g_raw=-50.0)


def test_recipe_name_cannot_be_empty():
    Recipe(name="Chili")
    with pytest.raises(ValidationError):
        Recipe(name="")
    with pytest.raises(ValidationError):
        Recipe(name="   ")


def test_recipe_default_portions_must_be_at_least_one():
    Recipe(name="X", default_portions=1)
    Recipe(name="X", default_portions=4)
    with pytest.raises(ValidationError):
        Recipe(name="X", default_portions=0)
    with pytest.raises(ValidationError):
        Recipe(name="X", default_portions=-2)


def test_recipe_line_quantity_must_be_strictly_positive():
    ing = Ingredient(name="Tomate", source=Source.MANUAL)
    RecipeLine(ingredient=ing, quantity_g=100.0)
    with pytest.raises(ValidationError):
        RecipeLine(ingredient=ing, quantity_g=0.0)
    with pytest.raises(ValidationError):
        RecipeLine(ingredient=ing, quantity_g=-50.0)


def test_recipe_line_ordinal_non_negative():
    ing = Ingredient(name="Tomate")
    RecipeLine(ingredient=ing, quantity_g=100.0, ordinal=0)
    RecipeLine(ingredient=ing, quantity_g=100.0, ordinal=5)
    with pytest.raises(ValidationError):
        RecipeLine(ingredient=ing, quantity_g=100.0, ordinal=-1)


def test_tag_name_cannot_be_empty():
    Tag(name="vegetarien")
    with pytest.raises(ValidationError):
        Tag(name="")
    with pytest.raises(ValidationError):
        Tag(name="   ")


def test_meal_plan_entry_quantity_must_be_strictly_positive():
    with pytest.raises(ValidationError):
        MealPlanEntry(
            iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
            ingredient_id=1, quantity_g=0.0,
        )
    with pytest.raises(ValidationError):
        MealPlanEntry(
            iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
            ingredient_id=1, quantity_g=-100.0,
        )


def test_meal_plan_entry_portions_must_be_strictly_positive():
    with pytest.raises(ValidationError):
        MealPlanEntry(
            iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
            recipe_id=1, portions=0.0,
        )
    with pytest.raises(ValidationError):
        MealPlanEntry(
            iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
            recipe_id=1, portions=-1.0,
        )


# ============================================================ B3 — Snack slots


def test_meal_slot_enum_includes_snacks():
    """B3 : the enum exposes 5 values now : matin / 10 h / midi / 16 h / soir.
    The DB stores the string value verbatim."""
    assert MealSlot.MORNING.value == "morning"
    assert MealSlot.SNACK_MORNING.value == "snack_morning"
    assert MealSlot.NOON.value == "noon"
    assert MealSlot.SNACK_AFTERNOON.value == "snack_afternoon"
    assert MealSlot.EVENING.value == "evening"


def test_meal_plan_entry_accepts_snack_slot():
    e = MealPlanEntry(
        iso_week="2026-W18", day_of_week=0, slot=MealSlot.SNACK_AFTERNOON,
        ingredient_id=1, quantity_g=30.0,
    )
    assert e.slot is MealSlot.SNACK_AFTERNOON
