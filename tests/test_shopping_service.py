"""Tests for `app.services.shopping_service`."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.data.repositories import IngredientRepo, MealPlanRepo, RecipeRepo
from app.domain.models import (
    Ingredient,
    MealPlanEntry,
    MealSlot,
    Recipe,
    RecipeLine,
    Source,
)
from app.domain.shopping import ShoppingItem, ShoppingList
from app.services.shopping_service import (
    aggregate_shopping_list,
    format_as_text,
)


# ============================================================ Fixtures helpers


def _make_ing(db_session, **overrides) -> Ingredient:
    base = {
        "name": "Carotte",
        "source": Source.CIQUAL,
        "category_l1": "fruits, legumes",
        "in_personal_library": True,
        "kcal_per_100g": 41.0,
        "price_eur": Decimal("1.20"),
        "price_quantity_g": 1000.0,
    }
    base.update(overrides)
    return IngredientRepo(db_session).create(Ingredient(**base))


def _make_recipe(db_session, ingredients_with_qty: list[tuple[Ingredient, float]],
                 *, name: str = "Salade", default_portions: int = 4) -> Recipe:
    lines = [RecipeLine(ingredient=ing, quantity_g=qty, ordinal=i)
             for i, (ing, qty) in enumerate(ingredients_with_qty)]
    return RecipeRepo(db_session).create(
        Recipe(name=name, default_portions=default_portions, lines=lines)
    )


# ============================================================ aggregate_shopping_list


def test_empty_week_returns_empty_list(db_session) -> None:
    sl = aggregate_shopping_list(db_session, "2026-W18")
    assert isinstance(sl, ShoppingList)
    assert sl.iso_week == "2026-W18"
    assert sl.items == []
    assert sl.total_eur == Decimal("0.00")
    assert sl.missing_price_count == 0


def test_single_ingredient_entry(db_session) -> None:
    ing = _make_ing(db_session, name="Carotte", price_eur=Decimal("1.20"))
    MealPlanRepo(db_session).add(MealPlanEntry(
        iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
        ingredient_id=ing.id, quantity_g=500.0,
    ))

    sl = aggregate_shopping_list(db_session, "2026-W18")

    assert len(sl.items) == 1
    item = sl.items[0]
    assert item.name == "Carotte"
    assert item.quantity_g == 500.0
    assert item.cost_eur == Decimal("0.60")  # 1.20 €/kg × 500 g
    assert item.has_price is True
    assert sl.total_eur == Decimal("0.60")


def test_aggregates_same_ingredient_across_entries(db_session) -> None:
    ing = _make_ing(db_session, name="Carotte")
    repo = MealPlanRepo(db_session)
    repo.add(MealPlanEntry(iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
                           ingredient_id=ing.id, quantity_g=200.0))
    repo.add(MealPlanEntry(iso_week="2026-W18", day_of_week=2, slot=MealSlot.EVENING,
                           ingredient_id=ing.id, quantity_g=300.0))

    sl = aggregate_shopping_list(db_session, "2026-W18")

    assert len(sl.items) == 1
    assert sl.items[0].quantity_g == 500.0


def test_recipe_entry_expands_lines_scaled_by_portions(db_session) -> None:
    """A recipe planned at `entry.portions=2` for a `default_portions=4` recipe
    should consume 50 % of each line's quantity."""
    carotte = _make_ing(db_session, name="Carotte")
    oignon = _make_ing(db_session, name="Oignon", category_l1="legumes")
    recipe = _make_recipe(
        db_session,
        [(carotte, 200.0), (oignon, 100.0)],
        name="Salade", default_portions=4,
    )
    MealPlanRepo(db_session).add(MealPlanEntry(
        iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
        recipe_id=recipe.id, portions=2.0,  # half the recipe
    ))

    sl = aggregate_shopping_list(db_session, "2026-W18")

    by_name = {it.name: it for it in sl.items}
    assert by_name["Carotte"].quantity_g == 100.0  # 200 × 2/4
    assert by_name["Oignon"].quantity_g == 50.0   # 100 × 2/4


def test_mixed_entries_recipe_and_raw(db_session) -> None:
    """One ingredient appearing in BOTH a recipe and a raw entry should sum."""
    carotte = _make_ing(db_session, name="Carotte")
    recipe = _make_recipe(db_session, [(carotte, 200.0)], default_portions=4)

    repo = MealPlanRepo(db_session)
    # Recipe at 4 portions = full → 200 g of carotte
    repo.add(MealPlanEntry(iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
                           recipe_id=recipe.id, portions=4.0))
    # Plus 100 g raw
    repo.add(MealPlanEntry(iso_week="2026-W18", day_of_week=2, slot=MealSlot.EVENING,
                           ingredient_id=carotte.id, quantity_g=100.0))

    sl = aggregate_shopping_list(db_session, "2026-W18")

    assert len(sl.items) == 1
    assert sl.items[0].quantity_g == 300.0


def test_groups_and_sorts_by_category(db_session) -> None:
    """Items must come back sorted: categorized first (alpha by category, then
    by name), then None-category at the end."""
    a = _make_ing(db_session, name="Carotte", category_l1="fruits, legumes")
    b = _make_ing(db_session, name="Aubergine", category_l1="fruits, legumes")
    c = _make_ing(db_session, name="Boeuf", category_l1="viandes")
    d = _make_ing(db_session, name="Sel", category_l1=None)

    repo = MealPlanRepo(db_session)
    for i, ing in enumerate([a, b, c, d]):
        repo.add(MealPlanEntry(iso_week="2026-W18", day_of_week=i, slot=MealSlot.NOON,
                               ingredient_id=ing.id, quantity_g=100.0))

    sl = aggregate_shopping_list(db_session, "2026-W18")

    names_in_order = [it.name for it in sl.items]
    # "fruits, legumes" → Aubergine, Carotte ; then "viandes" → Boeuf ; then None → Sel
    assert names_in_order == ["Aubergine", "Carotte", "Boeuf", "Sel"]


def test_missing_price_is_counted_not_summed(db_session) -> None:
    a = _make_ing(db_session, name="Avec prix", price_eur=Decimal("2.00"),
                  price_quantity_g=1000.0)
    b = _make_ing(db_session, name="Sans prix", price_eur=None, price_quantity_g=None)

    repo = MealPlanRepo(db_session)
    repo.add(MealPlanEntry(iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
                           ingredient_id=a.id, quantity_g=500.0))
    repo.add(MealPlanEntry(iso_week="2026-W18", day_of_week=1, slot=MealSlot.NOON,
                           ingredient_id=b.id, quantity_g=200.0))

    sl = aggregate_shopping_list(db_session, "2026-W18")

    assert sl.missing_price_count == 1
    assert sl.total_eur == Decimal("1.00")  # only "Avec prix" counted


def test_orphan_recipe_skipped_silently(db_session) -> None:
    """If a meal plan entry references a deleted recipe, it must NOT crash —
    just be ignored and not contribute to the list."""
    carotte = _make_ing(db_session, name="Carotte")
    recipe = _make_recipe(db_session, [(carotte, 100.0)])
    MealPlanRepo(db_session).add(MealPlanEntry(
        iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
        recipe_id=recipe.id, portions=4.0,
    ))
    # Delete the recipe; the meal plan entry now points to nothing
    RecipeRepo(db_session).delete(recipe.id)

    sl = aggregate_shopping_list(db_session, "2026-W18")
    assert sl.items == []
    assert sl.total_eur == Decimal("0.00")


def test_piece_weight_propagates(db_session) -> None:
    """Ingredients with a piece_weight_g must expose it through the shopping
    item so the UI can render '≈ N pièces'."""
    oeuf = _make_ing(db_session, name="Oeuf", piece_weight_g=60.0)
    MealPlanRepo(db_session).add(MealPlanEntry(
        iso_week="2026-W18", day_of_week=0, slot=MealSlot.MORNING,
        ingredient_id=oeuf.id, quantity_g=180.0,  # 3 oeufs
    ))

    sl = aggregate_shopping_list(db_session, "2026-W18")

    assert sl.items[0].piece_weight_g == 60.0
    assert sl.items[0].piece_count == pytest.approx(3.0)


def test_other_weeks_are_independent(db_session) -> None:
    ing = _make_ing(db_session, name="Carotte")
    repo = MealPlanRepo(db_session)
    repo.add(MealPlanEntry(iso_week="2026-W17", day_of_week=0, slot=MealSlot.NOON,
                           ingredient_id=ing.id, quantity_g=100.0))
    repo.add(MealPlanEntry(iso_week="2026-W18", day_of_week=0, slot=MealSlot.NOON,
                           ingredient_id=ing.id, quantity_g=200.0))

    sl_17 = aggregate_shopping_list(db_session, "2026-W17")
    sl_18 = aggregate_shopping_list(db_session, "2026-W18")

    assert sl_17.items[0].quantity_g == 100.0
    assert sl_18.items[0].quantity_g == 200.0


# ============================================================ format_as_text


def test_format_as_text_empty():
    sl = ShoppingList(iso_week="2026-W18", items=[], total_eur=Decimal("0.00"))
    text = format_as_text(sl)
    assert "Liste de courses" in text
    assert "2026-W18" in text
    assert "(aucun ingrédient)" in text


def test_format_as_text_renders_categories_and_total():
    sl = ShoppingList(
        iso_week="2026-W18",
        items=[
            ShoppingItem(ingredient_id=1, name="Carotte", source="ciqual",
                         quantity_g=500, category_l1="legumes",
                         cost_eur=Decimal("0.60")),
            ShoppingItem(ingredient_id=2, name="Boeuf", source="ciqual",
                         quantity_g=300, category_l1="viandes",
                         cost_eur=Decimal("3.60")),
        ],
        total_eur=Decimal("4.20"),
    )
    text = format_as_text(sl)

    assert "Carotte" in text
    assert "Boeuf" in text
    assert "== Legumes ==" in text or "Legumes" in text
    assert "Viandes" in text
    assert "4,20" in text  # total in fr locale


def test_format_as_text_signals_missing_prices():
    sl = ShoppingList(
        iso_week="2026-W18",
        items=[
            ShoppingItem(ingredient_id=1, name="Sel", source="manual",
                         quantity_g=50.0, cost_eur=None),
        ],
        total_eur=Decimal("0.00"),
        missing_price_count=1,
    )
    text = format_as_text(sl)
    assert "1 ingrédient(s) sans prix" in text


def test_format_as_text_renders_pieces_when_piece_weight_set():
    sl = ShoppingList(
        iso_week="2026-W18",
        items=[
            ShoppingItem(ingredient_id=1, name="Oeuf", source="manual",
                         quantity_g=180.0, piece_weight_g=60.0,
                         cost_eur=Decimal("1.50")),
        ],
        total_eur=Decimal("1.50"),
    )
    text = format_as_text(sl)
    assert "pièce" in text  # "3 pièces" appears
    assert "Oeuf" in text


# ============================================================ B2 — N+1 fix
# Locks in the query-count gain. Without batch loading we'd see
# `N(recipes) + N(ingredients) + 1(week)` SELECTs ; with batch we get 3
# (week, recipes-by-ids, ingredients-by-ids), regardless of N.


def test_aggregate_uses_constant_query_count(db_session):
    """The total number of SQL statements should be O(1), not O(N) where N
    is the number of meal plan entries or distinct recipes/ingredients."""
    from sqlalchemy import event

    # 3 distinct recipes, 4 distinct ingredients
    carotte = _make_ing(db_session, name="Carotte")
    oignon  = _make_ing(db_session, name="Oignon")
    riz     = _make_ing(db_session, name="Riz")
    tomate  = _make_ing(db_session, name="Tomate")
    r1 = _make_recipe(db_session, [(carotte, 100.0), (oignon, 50.0)], name="Soupe")
    r2 = _make_recipe(db_session, [(riz, 200.0), (tomate, 150.0)], name="Riz-tomate")
    r3 = _make_recipe(db_session, [(tomate, 100.0), (carotte, 80.0)], name="Salade")

    # 6 entries pointing at these 3 recipes
    mp = MealPlanRepo(db_session)
    for day, recipe in [(0, r1), (1, r2), (2, r3), (3, r1), (4, r2), (5, r3)]:
        mp.add(MealPlanEntry(
            iso_week="2026-W18", day_of_week=day, slot=MealSlot.NOON,
            recipe_id=recipe.id, portions=1.0,
        ))
    db_session.commit()

    # Count SELECTs against the engine while running aggregate.
    select_count = [0]
    def _on_execute(conn, clauseelement, multiparams, params, execution_options):
        sql = str(clauseelement).strip().upper()
        if sql.startswith("SELECT"):
            select_count[0] += 1
    engine = db_session.get_bind()
    event.listen(engine, "before_execute", _on_execute)
    try:
        sl = aggregate_shopping_list(db_session, "2026-W18")
    finally:
        event.remove(engine, "before_execute", _on_execute)

    # 3 distinct recipes + 4 distinct ingredients ; without B2 we'd see
    # 1 (entries) + 6 (recipe.get x6) + 4 (ingredient.get x4) ≥ 11.
    # With B2 we expect ≤ 6 (entries + 1 batch recipes + 1 batch ingredients
    # + a few selectinload roundtrips for lines/tags). Generous upper bound :
    assert select_count[0] <= 8, (
        f"Expected ≤ 8 SELECTs (B2 batch loading), got {select_count[0]} "
        "— possibly an N+1 regression."
    )
    # And the result is still correct
    assert len(sl.items) == 4   # 4 distinct ingredients aggregated
    names = {i.name for i in sl.items}
    assert names == {"Carotte", "Oignon", "Riz", "Tomate"}


def test_aggregate_handles_empty_week(db_session):
    """No entries → no recipes loaded, no ingredients loaded, empty list."""
    sl = aggregate_shopping_list(db_session, "2026-W42")
    assert sl.items == []
    assert sl.total_eur == Decimal("0.00")
    assert sl.missing_price_count == 0
