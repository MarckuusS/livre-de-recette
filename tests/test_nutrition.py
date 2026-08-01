from app.domain.models import Ingredient, NutritionTotal, Recipe, RecipeLine, Source
from app.domain.nutrition import aggregate_lines, aggregate_recipe, ingredient_macros


def make_ingredient(**overrides) -> Ingredient:
    base = dict(
        name="Test",
        source=Source.MANUAL,
        kcal_per_100g=100.0,
        proteins_g=10.0,
        carbs_g=20.0,
        fats_g=5.0,
    )
    base.update(overrides)
    return Ingredient(**base)


def test_aggregate_lines_basic():
    flour = make_ingredient(
        name="Flour", kcal_per_100g=350.0, proteins_g=10.0, carbs_g=70.0, fats_g=1.0
    )
    butter = make_ingredient(
        name="Butter", kcal_per_100g=720.0, proteins_g=0.6, carbs_g=0.0, fats_g=80.0
    )
    lines = [
        RecipeLine(ingredient=flour, quantity_g=200),
        RecipeLine(ingredient=butter, quantity_g=100),
    ]
    total = aggregate_lines(lines)
    # 200g flour -> 700 kcal, 20g proteins, 140g carbs, 2g fats
    # 100g butter -> 720 kcal, 0.6g proteins, 0g carbs, 80g fats
    assert total.kcal == 700.0 + 720.0
    assert total.proteins_g == 20.0 + 0.6
    assert total.carbs_g == 140.0
    assert total.fats_g == 2.0 + 80.0


def test_aggregate_lines_missing_macros_count_as_zero():
    sparse = make_ingredient(name="Sparse", kcal_per_100g=100.0, proteins_g=None, fats_g=None)
    lines = [RecipeLine(ingredient=sparse, quantity_g=100)]
    total = aggregate_lines(lines)
    assert total.kcal == 100.0
    assert total.proteins_g == 0.0
    assert total.fats_g == 0.0


def test_aggregate_recipe_per_portion():
    ing = make_ingredient(kcal_per_100g=400.0)
    recipe = Recipe(
        name="Cake",
        default_portions=4,
        lines=[RecipeLine(ingredient=ing, quantity_g=200)],
    )
    total, per_portion = aggregate_recipe(recipe)
    assert total.kcal == 800.0
    assert per_portion.kcal == 200.0


def test_ingredient_macros_scaling():
    ing = make_ingredient(kcal_per_100g=240.0, proteins_g=12.0)
    total = ingredient_macros(ing, 250.0)
    assert total.kcal == 600.0
    assert total.proteins_g == 30.0


def test_nutrition_total_arithmetic():
    a = NutritionTotal(kcal=10.0, proteins_g=1.0)
    b = NutritionTotal(kcal=20.0, proteins_g=2.0)
    c = a + b
    assert c.kcal == 30.0
    assert c.proteins_g == 3.0
    half = c.divided_by(2)
    assert half.kcal == 15.0


def test_empty_recipe_yields_zero():
    recipe = Recipe(name="Empty", default_portions=1)
    total, per_portion = aggregate_recipe(recipe)
    assert total.kcal == 0.0
    assert per_portion.kcal == 0.0
