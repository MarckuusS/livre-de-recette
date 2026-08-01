"""Tests for the QAbstractListModel subclasses in `app.ui.models`.

These tests don't need a QApplication — `QObject.data()` is a direct method call
and doesn't require an event loop. We test:
  - rowCount() / data() on every role
  - roleNames() exposes the expected QML-facing names
  - Decimal serialization (priceEur → str)
  - set_items() resets correctly
  - data() on invalid index returns None
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from PySide6.QtCore import QModelIndex, Qt

from app.domain.models import (
    Ingredient,
    MealPlanEntry,
    MealSlot,
    Recipe,
    RecipeLine,
    Source,
)
from app.ui.models import (
    IngredientListModel,
    MealPlanModel,
    RecipeListModel,
)
from app.ui.models.meal_plan_model import MealPlanRow

# ============================================================ IngredientListModel


def _ingredient(**overrides) -> Ingredient:
    """Build a sane default Ingredient with optional overrides."""
    base = {
        "id": 1,
        "name": "Carotte",
        "source": Source.CIQUAL,
        "source_ref": "20066",
        "kcal_per_100g": 41.0,
        "proteins_g": 0.9,
        "carbs_g": 8.4,
        "fats_g": 0.2,
        "in_personal_library": True,
        "category_l1": "fruits, legumes",
        "category_l2": "legumes",
        "piece_weight_g": 125.0,
    }
    base.update(overrides)
    return Ingredient(**base)


def test_ingredient_list_model_empty():
    model = IngredientListModel()
    assert model.rowCount() == 0
    assert model.data(model.index(0, 0)) is None


def test_ingredient_list_model_set_items_basic():
    model = IngredientListModel()
    model.set_items([_ingredient(id=1, name="Carotte"), _ingredient(id=2, name="Tomate")])
    assert model.rowCount() == 2
    assert model.data(model.index(0, 0), IngredientListModel.NameRole) == "Carotte"
    assert model.data(model.index(1, 0), IngredientListModel.NameRole) == "Tomate"


def test_ingredient_list_model_all_simple_roles():
    model = IngredientListModel()
    ing = _ingredient()
    model.set_items([ing])
    idx = model.index(0, 0)

    assert model.data(idx, IngredientListModel.IdRole) == 1
    assert model.data(idx, IngredientListModel.NameRole) == "Carotte"
    assert model.data(idx, IngredientListModel.SourceRole) == "ciqual"  # enum.value
    assert model.data(idx, IngredientListModel.SourceRefRole) == "20066"
    assert model.data(idx, IngredientListModel.KcalRole) == 41.0
    assert model.data(idx, IngredientListModel.ProteinsRole) == 0.9
    assert model.data(idx, IngredientListModel.CarbsRole) == 8.4
    assert model.data(idx, IngredientListModel.FatsRole) == 0.2
    assert model.data(idx, IngredientListModel.PieceWeightGRole) == 125.0
    assert model.data(idx, IngredientListModel.InLibraryRole) is True
    assert model.data(idx, IngredientListModel.CategoryL1Role) == "fruits, legumes"
    assert model.data(idx, IngredientListModel.CategoryL2Role) == "legumes"


def test_ingredient_list_model_decimal_serialized_as_str():
    """priceEur should reach QML as a string (Decimal isn't QML-native)."""
    model = IngredientListModel()
    model.set_items([_ingredient(price_eur=Decimal("3.50"), price_quantity_g=1000.0)])
    idx = model.index(0, 0)
    price = model.data(idx, IngredientListModel.PriceEurRole)
    assert isinstance(price, str)
    assert price == "3.50"
    assert model.data(idx, IngredientListModel.PriceQuantityGRole) == 1000.0


def test_ingredient_list_model_none_price():
    model = IngredientListModel()
    model.set_items([_ingredient(price_eur=None, price_quantity_g=None)])
    idx = model.index(0, 0)
    assert model.data(idx, IngredientListModel.PriceEurRole) is None
    assert model.data(idx, IngredientListModel.PriceQuantityGRole) is None


def test_ingredient_list_model_display_role_fallback():
    """Without a specific role, DisplayRole should give back the name."""
    model = IngredientListModel()
    model.set_items([_ingredient(name="Pomme")])
    idx = model.index(0, 0)
    assert model.data(idx) == "Pomme"
    assert model.data(idx, Qt.ItemDataRole.DisplayRole) == "Pomme"


def test_ingredient_list_model_invalid_index():
    model = IngredientListModel()
    model.set_items([_ingredient()])
    assert model.data(QModelIndex()) is None
    assert model.data(model.index(99, 0)) is None
    assert model.data(model.index(-1, 0)) is None


def test_ingredient_list_model_role_names():
    model = IngredientListModel()
    names = model.roleNames()
    # Convert QByteArray values to bytes for comparison
    name_set = {bytes(v) for v in names.values()}
    expected = {b"ingredientId", b"name", b"source", b"sourceRef", b"kcal",
                b"proteins", b"carbs", b"fats", b"priceEur", b"priceQuantityG",
                b"pieceWeightG", b"inLibrary", b"categoryL1", b"categoryL2"}
    assert expected.issubset(name_set)


def test_ingredient_list_model_set_items_resets():
    """A second set_items() should fully replace the previous content, not append."""
    model = IngredientListModel()
    model.set_items([_ingredient(id=1, name="A"), _ingredient(id=2, name="B")])
    model.set_items([_ingredient(id=3, name="C")])
    assert model.rowCount() == 1
    assert model.data(model.index(0, 0), IngredientListModel.NameRole) == "C"


def test_ingredient_list_model_item_at():
    model = IngredientListModel()
    a = _ingredient(id=1, name="A")
    b = _ingredient(id=2, name="B")
    model.set_items([a, b])
    assert model.item_at(0).name == "A"
    assert model.item_at(1).name == "B"
    assert model.item_at(99) is None
    assert model.item_at(-1) is None


# ============================================================ RecipeListModel


def _recipe(**overrides) -> Recipe:
    base = {
        "id": 1,
        "name": "Chili",
        "default_portions": 4,
        "instructions": "Etape 1.\nEtape 2.\nEtape 3.",
        "lines": [],
        "created_at": datetime(2026, 5, 1, 12, 0, 0),
        "updated_at": datetime(2026, 5, 1, 12, 0, 0),
    }
    base.update(overrides)
    return Recipe(**base)


def test_recipe_list_model_basic():
    model = RecipeListModel()
    line = RecipeLine(ingredient=_ingredient(), quantity_g=100.0, ordinal=0)
    model.set_items([_recipe(name="Chili", lines=[line, line, line])])
    idx = model.index(0, 0)
    assert model.data(idx, RecipeListModel.NameRole) == "Chili"
    assert model.data(idx, RecipeListModel.PortionsRole) == 4
    assert model.data(idx, RecipeListModel.LineCountRole) == 3


def test_recipe_list_model_instructions_head_takes_first_line():
    model = RecipeListModel()
    model.set_items([_recipe(instructions="Premiere etape.\nDeuxieme etape.")])
    idx = model.index(0, 0)
    assert model.data(idx, RecipeListModel.InstructionsHeadRole) == "Premiere etape."


def test_recipe_list_model_instructions_head_truncates():
    model = RecipeListModel()
    long = "X" * 200
    model.set_items([_recipe(instructions=long)])
    idx = model.index(0, 0)
    head = model.data(idx, RecipeListModel.InstructionsHeadRole)
    assert head.endswith("…")
    assert len(head) <= 80


def test_recipe_list_model_empty_instructions():
    model = RecipeListModel()
    model.set_items([_recipe(instructions="")])
    idx = model.index(0, 0)
    assert model.data(idx, RecipeListModel.InstructionsHeadRole) == ""


def test_recipe_list_model_role_names():
    model = RecipeListModel()
    name_set = {bytes(v) for v in model.roleNames().values()}
    assert {b"recipeId", b"name", b"defaultPortions", b"lineCount", b"instructionsHead"}.issubset(name_set)


# ============================================================ MealPlanModel


def test_meal_plan_model_recipe_entry():
    model = MealPlanModel()
    entry = MealPlanEntry(
        id=42,
        iso_week="2026-W18",
        day_of_week=0,
        slot=MealSlot.NOON,
        recipe_id=2,
        portions=1.0,
    )
    row = MealPlanRow(entry=entry, description="🍽 Chili (1 portion)")
    model.set_rows([row])
    idx = model.index(0, 0)
    assert model.data(idx, MealPlanModel.IdRole) == 42
    assert model.data(idx, MealPlanModel.DayOfWeekRole) == 0
    assert model.data(idx, MealPlanModel.SlotRole) == "noon"
    assert model.data(idx, MealPlanModel.KindRole) == "recipe"
    assert model.data(idx, MealPlanModel.RecipeIdRole) == 2
    assert model.data(idx, MealPlanModel.IngredientIdRole) is None
    assert model.data(idx, MealPlanModel.PortionsRole) == 1.0
    assert model.data(idx, MealPlanModel.DescriptionRole) == "🍽 Chili (1 portion)"


def test_meal_plan_model_ingredient_entry():
    model = MealPlanModel()
    entry = MealPlanEntry(
        id=99,
        iso_week="2026-W18",
        day_of_week=2,
        slot=MealSlot.MORNING,
        ingredient_id=5,
        quantity_g=80.0,
    )
    row = MealPlanRow(entry=entry, description="🥕 Carotte (80 g)")
    model.set_rows([row])
    idx = model.index(0, 0)
    assert model.data(idx, MealPlanModel.KindRole) == "ingredient"
    assert model.data(idx, MealPlanModel.IngredientIdRole) == 5
    assert model.data(idx, MealPlanModel.RecipeIdRole) is None
    assert model.data(idx, MealPlanModel.QuantityGRole) == 80.0
    assert model.data(idx, MealPlanModel.SlotRole) == "morning"


def test_meal_plan_model_role_names():
    model = MealPlanModel()
    name_set = {bytes(v) for v in model.roleNames().values()}
    expected = {b"entryId", b"dayOfWeek", b"slot", b"kind", b"recipeId",
                b"ingredientId", b"quantityG", b"portions", b"description"}
    assert expected.issubset(name_set)
