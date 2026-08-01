from decimal import Decimal

from app.domain.models import Ingredient, Recipe, RecipeLine, Source
from app.domain.pricing import ingredient_cost, recipe_cost, recipe_cost_per_portion


def priced(name: str, price_eur: str, qty_ref_g: float) -> Ingredient:
    return Ingredient(
        name=name,
        source=Source.MANUAL,
        price_eur=Decimal(price_eur),
        price_quantity_g=qty_ref_g,
    )


def unpriced(name: str) -> Ingredient:
    return Ingredient(name=name, source=Source.MANUAL)


def test_recipe_cost_simple():
    flour = priced("Flour", "1.00", 1000)  # 0.001 EUR/g
    butter = priced("Butter", "4.00", 250)  # 0.016 EUR/g
    recipe = Recipe(
        name="Cake",
        default_portions=4,
        lines=[
            RecipeLine(ingredient=flour, quantity_g=500),  # 0.50
            RecipeLine(ingredient=butter, quantity_g=250),  # 4.00
        ],
    )
    total, missing = recipe_cost(recipe)
    assert total == Decimal("4.50")
    assert missing == []


def test_recipe_cost_per_portion():
    flour = priced("Flour", "1.00", 1000)
    recipe = Recipe(
        name="Bread",
        default_portions=4,
        lines=[RecipeLine(ingredient=flour, quantity_g=400)],  # 0.40
    )
    per_portion, _ = recipe_cost_per_portion(recipe)
    assert per_portion == Decimal("0.10")


def test_recipe_cost_flags_missing_prices():
    flour = priced("Flour", "1.00", 1000)
    salt = unpriced("Salt")
    recipe = Recipe(
        name="Bread",
        lines=[
            RecipeLine(ingredient=flour, quantity_g=500),
            RecipeLine(ingredient=salt, quantity_g=10),
        ],
    )
    total, missing = recipe_cost(recipe)
    assert total == Decimal("0.50")
    assert len(missing) == 1
    assert missing[0].ingredient.name == "Salt"


def test_ingredient_cost_returns_none_when_unpriced():
    assert ingredient_cost(unpriced("Salt"), 100) is None


def test_ingredient_cost_decimal_precision():
    cheese = priced("Cheese", "3.99", 250)  # 0.01596 EUR/g
    cost = ingredient_cost(cheese, 80)
    # 80 * 3.99 / 250 = 1.2768 -> 1.28 (ROUND_HALF_UP)
    assert cost == Decimal("1.28")
