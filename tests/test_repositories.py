from decimal import Decimal

import pytest

from app.domain.models import (
    Ingredient,
    MealPlanEntry,
    MealSlot,
    Recipe,
    RecipeLine,
    Source,
)
from app.data.repositories import (
    IngredientRepo,
    MealPlanRepo,
    RecipeRepo,
    SearchFilters,
    SearchOptions,
)


# --------------------------------------------------------------------------- #
# IngredientRepo
# --------------------------------------------------------------------------- #


def test_ingredient_create_and_get(db_session):
    repo = IngredientRepo(db_session)
    saved = repo.create(
        Ingredient(name="Tomate", source=Source.CIQUAL, source_ref="20055", kcal_per_100g=18.0)
    )
    assert saved.id is not None
    assert saved.name == "Tomate"
    fetched = repo.get(saved.id)
    assert fetched is not None
    assert fetched.kcal_per_100g == 18.0


def test_ingredient_cooked_weight_per_100g_raw_persists(db_session):
    """Round-trip ORM : create + reload + update + reload. Vérifie que la
    nouvelle colonne `cooked_weight_per_100g_raw` (migration inline) survit
    au mapping ORM ↔ Pydantic dans les deux sens."""
    repo = IngredientRepo(db_session)
    saved = repo.create(Ingredient(
        name="Riz étuvé", source=Source.MANUAL,
        cooked_weight_per_100g_raw=300.0,
    ))
    fetched = repo.get(saved.id)
    assert fetched is not None
    assert fetched.cooked_weight_per_100g_raw == 300.0

    # Update : modification puis NULL (l'utilisateur efface la valeur).
    fetched = fetched.model_copy(update={"cooked_weight_per_100g_raw": 250.0})
    repo.update(fetched)
    assert repo.get(saved.id).cooked_weight_per_100g_raw == 250.0

    fetched = fetched.model_copy(update={"cooked_weight_per_100g_raw": None})
    repo.update(fetched)
    assert repo.get(saved.id).cooked_weight_per_100g_raw is None


def test_ingredient_upsert_by_source_ref_idempotent(db_session):
    repo = IngredientRepo(db_session)
    repo.upsert_by_source_ref(
        Ingredient(name="Pomme", source=Source.CIQUAL, source_ref="13016", kcal_per_100g=52.0)
    )
    # Second call updates the same row, doesn't insert.
    repo.upsert_by_source_ref(
        Ingredient(name="Pomme golden", source=Source.CIQUAL, source_ref="13016", kcal_per_100g=54.0)
    )
    all_apples = [i for i in repo.list_all() if i.source_ref == "13016"]
    assert len(all_apples) == 1
    assert all_apples[0].name == "Pomme golden"
    assert all_apples[0].kcal_per_100g == 54.0


def test_ingredient_search_fts_prefix(db_session):
    repo = IngredientRepo(db_session)
    for name in ["Tomate", "Tomate cerise", "Tomate confite", "Carotte", "Pomme"]:
        repo.create(Ingredient(name=name, source=Source.MANUAL))

    results = repo.search_fts("tom")
    names = {r.name for r in results}
    assert "Tomate" in names
    assert "Tomate cerise" in names
    assert "Tomate confite" in names
    assert "Carotte" not in names


def test_ingredient_search_fts_handles_diacritics(db_session):
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(name="Échalote", source=Source.MANUAL))
    # Search without accent should still find it (unicode61 remove_diacritics).
    results = repo.search_fts("echalote")
    assert any(r.name == "Échalote" for r in results)


def test_ingredient_search_empty_query_returns_all(db_session):
    """Empty query is a valid input — it means 'no FTS filtering, return everything
    matching the other filters/scope/source'. The import dialog uses this to e.g.
    show 'all CIQUAL items in category Vegetables' without typing a keyword."""
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(name="Foo", source=Source.MANUAL))
    repo.create(Ingredient(name="Bar", source=Source.MANUAL))
    # Empty query in legacy mode returns the full set (paginated by limit=20 here).
    assert len(repo.search_fts("", limit=20)) == 2
    # Whitespace-only behaves identically.
    assert len(repo.search_fts("   ", limit=20)) == 2


def test_ingredient_delete(db_session):
    repo = IngredientRepo(db_session)
    saved = repo.create(Ingredient(name="Trash", source=Source.MANUAL))
    assert saved.id is not None
    repo.delete(saved.id)
    assert repo.get(saved.id) is None


# --------------------------------------------------------------------------- #
# RecipeRepo
# --------------------------------------------------------------------------- #


def test_recipe_create_with_lines(db_session):
    ing_repo = IngredientRepo(db_session)
    flour = ing_repo.create(Ingredient(name="Flour", source=Source.MANUAL, kcal_per_100g=350.0))
    butter = ing_repo.create(
        Ingredient(name="Butter", source=Source.MANUAL, kcal_per_100g=720.0)
    )
    db_session.commit()

    recipe_repo = RecipeRepo(db_session)
    recipe = recipe_repo.create(
        Recipe(
            name="Sablés",
            default_portions=12,
            instructions="Mélanger, cuire.",
            lines=[
                RecipeLine(ingredient=flour, quantity_g=200),
                RecipeLine(ingredient=butter, quantity_g=100, notes="pommade"),
            ],
        )
    )
    assert recipe.id is not None
    assert len(recipe.lines) == 2
    fetched = recipe_repo.get(recipe.id)
    assert fetched is not None
    assert fetched.lines[0].ingredient.name == "Flour"
    assert fetched.lines[1].notes == "pommade"


def test_recipe_line_persists_unit_field(db_session):
    """Bug fix UX : le code d'unité saisi dans QuantityField ("ml", "c_cafe",
    "_piece"…) doit être persisté en DB et restitué tel quel au reload — sans
    ce champ, l'heuristique "_piece if pieceWeightG > 0" écrasait l'unité au
    rechargement de la recette."""
    ing_repo = IngredientRepo(db_session)
    huile = ing_repo.create(Ingredient(name="Huile d'olive", source=Source.MANUAL))
    yaourt = ing_repo.create(Ingredient(
        name="Yaourt nature", source=Source.MANUAL, piece_weight_g=125.0,
    ))
    db_session.commit()

    recipe_repo = RecipeRepo(db_session)
    recipe = recipe_repo.create(Recipe(
        name="Test unit", default_portions=1,
        lines=[
            RecipeLine(ingredient=huile, quantity_g=100.0, unit="ml", ordinal=0),
            RecipeLine(ingredient=yaourt, quantity_g=250.0, unit="_piece", ordinal=1),
        ],
    ))

    fetched = recipe_repo.get(recipe.id)
    assert fetched is not None
    units = sorted([line.unit for line in fetched.lines])
    assert units == ["_piece", "ml"]


def test_recipe_line_unit_nullable_for_legacy_rows(db_session):
    """Compat ascendante : les lignes pré-migration n'ont pas d'unité — on
    accepte None (le QuantityField retombe sur l'heuristique par défaut)."""
    ing_repo = IngredientRepo(db_session)
    flour = ing_repo.create(Ingredient(name="Flour", source=Source.MANUAL))
    db_session.commit()

    recipe_repo = RecipeRepo(db_session)
    recipe = recipe_repo.create(Recipe(
        name="Test legacy", default_portions=1,
        lines=[RecipeLine(ingredient=flour, quantity_g=200.0)],   # pas d'unit
    ))
    fetched = recipe_repo.get(recipe.id)
    assert fetched.lines[0].unit is None


def test_recipe_update_replaces_lines(db_session):
    ing_repo = IngredientRepo(db_session)
    a = ing_repo.create(Ingredient(name="A", source=Source.MANUAL))
    b = ing_repo.create(Ingredient(name="B", source=Source.MANUAL))
    c = ing_repo.create(Ingredient(name="C", source=Source.MANUAL))
    db_session.commit()

    recipe_repo = RecipeRepo(db_session)
    r = recipe_repo.create(
        Recipe(name="R1", lines=[RecipeLine(ingredient=a, quantity_g=10)])
    )
    updated = r.model_copy(
        update={
            "name": "R1bis",
            "lines": [
                RecipeLine(ingredient=b, quantity_g=20),
                RecipeLine(ingredient=c, quantity_g=30),
            ],
        }
    )
    saved = recipe_repo.update(updated)
    assert saved.name == "R1bis"
    assert [line.ingredient.name for line in saved.lines] == ["B", "C"]


def test_recipe_delete_cascades_lines(db_session):
    ing_repo = IngredientRepo(db_session)
    a = ing_repo.create(Ingredient(name="A", source=Source.MANUAL))
    db_session.commit()

    recipe_repo = RecipeRepo(db_session)
    r = recipe_repo.create(Recipe(name="R", lines=[RecipeLine(ingredient=a, quantity_g=10)]))
    assert r.id is not None
    recipe_repo.delete(r.id)
    assert recipe_repo.get(r.id) is None
    # Ingredient itself should not be deleted.
    assert ing_repo.get(a.id) is not None  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# SearchOptions: filters / sort / pagination / categories
# --------------------------------------------------------------------------- #


def _seed_search_corpus(repo: IngredientRepo) -> None:
    """A small mixed corpus used by the search tests below."""
    repo.create(Ingredient(name="Tomate", source=Source.CIQUAL, source_ref="1",
                            kcal_per_100g=18.0, proteins_g=0.9, carbs_g=3.5, fats_g=0.2,
                            category_l1="légumes", category_l2="légumes-fruits"))
    repo.create(Ingredient(name="Lentilles", source=Source.CIQUAL, source_ref="2",
                            kcal_per_100g=320.0, proteins_g=24.0, carbs_g=50.0, fats_g=2.0,
                            category_l1="légumes", category_l2="légumineuses"))
    repo.create(Ingredient(name="Carotte", source=Source.CIQUAL, source_ref="3",
                            kcal_per_100g=36.0, proteins_g=1.0, carbs_g=8.0, fats_g=0.2,
                            category_l1="légumes", category_l2="légumes-racines"))
    repo.create(Ingredient(name="Beurre", source=Source.CIQUAL, source_ref="4",
                            kcal_per_100g=720.0, proteins_g=0.6, carbs_g=0.0, fats_g=82.0,
                            category_l1="matières grasses", category_l2=None))
    repo.create(Ingredient(name="Nutella", source=Source.OPENFOODFACTS, source_ref="3017620422003",
                            kcal_per_100g=540.0, proteins_g=6.0, carbs_g=57.0, fats_g=31.0,
                            in_personal_library=True))


def test_search_filter_min_proteins(db_session):
    repo = IngredientRepo(db_session)
    _seed_search_corpus(repo)
    page = repo.search_fts(opts=SearchOptions(filters=SearchFilters(min_proteins=10.0)))
    names = {m.name for m in page.matches}
    assert "Lentilles" in names         # 24g ≥ 10
    assert "Tomate" not in names        # 0.9g < 10
    assert "Beurre" not in names        # 0.6g < 10


def test_search_filter_category_l1(db_session):
    repo = IngredientRepo(db_session)
    _seed_search_corpus(repo)
    page = repo.search_fts(opts=SearchOptions(filters=SearchFilters(category_l1="légumes")))
    names = sorted(m.name for m in page.matches)
    assert names == ["Carotte", "Lentilles", "Tomate"]


def test_search_sort_by_kcal_desc(db_session):
    repo = IngredientRepo(db_session)
    _seed_search_corpus(repo)
    page = repo.search_fts(opts=SearchOptions(
        sort_by="kcal", sort_desc=True,
        filters=SearchFilters(category_l1="légumes"),
    ))
    # Lentilles (320) > Carotte (36) > Tomate (18)
    assert [m.name for m in page.matches] == ["Lentilles", "Carotte", "Tomate"]


def test_search_pagination(db_session):
    repo = IngredientRepo(db_session)
    _seed_search_corpus(repo)
    p1 = repo.search_fts(opts=SearchOptions(sort_by="name", page=1, page_size=2))
    p2 = repo.search_fts(opts=SearchOptions(sort_by="name", page=2, page_size=2))
    p3 = repo.search_fts(opts=SearchOptions(sort_by="name", page=3, page_size=2))
    assert p1.total_count == 5
    assert p1.page_count == 3
    assert len(p1.matches) == 2
    assert len(p2.matches) == 2
    assert len(p3.matches) == 1
    seen = [m.name for m in p1.matches] + [m.name for m in p2.matches] + [m.name for m in p3.matches]
    assert seen == sorted(seen)  # name ascending across pages


def test_search_combined_query_and_filter(db_session):
    repo = IngredientRepo(db_session)
    _seed_search_corpus(repo)
    page = repo.search_fts(opts=SearchOptions(
        query="lentilles",
        filters=SearchFilters(min_proteins=20.0),
    ))
    assert [m.name for m in page.matches] == ["Lentilles"]


def test_list_categories_l1(db_session):
    repo = IngredientRepo(db_session)
    _seed_search_corpus(repo)
    cats = repo.list_categories_l1(source=Source.CIQUAL)
    assert "légumes" in cats
    assert "matières grasses" in cats
    assert len(cats) == 2  # only two distinct CIQUAL categories in the corpus


# --------------------------------------------------------------------------- #
# MealPlanRepo
# --------------------------------------------------------------------------- #


def test_meal_plan_add_recipe_entry(db_session):
    ing_repo = IngredientRepo(db_session)
    flour = ing_repo.create(Ingredient(name="Flour", source=Source.MANUAL))
    db_session.commit()
    recipe_repo = RecipeRepo(db_session)
    r = recipe_repo.create(Recipe(name="R", lines=[RecipeLine(ingredient=flour, quantity_g=10)]))
    db_session.commit()

    plan_repo = MealPlanRepo(db_session)
    e = plan_repo.add(
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=0,
            slot=MealSlot.NOON,
            recipe_id=r.id,
            portions=2.0,
        )
    )
    assert e.id is not None
    week = plan_repo.list_by_week("2026-W18")
    assert len(week) == 1
    assert week[0].recipe_id == r.id


def test_meal_plan_add_ingredient_entry(db_session):
    ing_repo = IngredientRepo(db_session)
    bread = ing_repo.create(Ingredient(name="Pain", source=Source.MANUAL))
    db_session.commit()

    plan_repo = MealPlanRepo(db_session)
    plan_repo.add(
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=2,
            slot=MealSlot.MORNING,
            ingredient_id=bread.id,
            quantity_g=80.0,
        )
    )
    week = plan_repo.list_by_week("2026-W18")
    assert len(week) == 1
    assert week[0].ingredient_id == bread.id
    assert week[0].quantity_g == 80.0


def test_meal_plan_remove(db_session):
    ing_repo = IngredientRepo(db_session)
    bread = ing_repo.create(Ingredient(name="Pain", source=Source.MANUAL))
    db_session.commit()

    plan_repo = MealPlanRepo(db_session)
    e = plan_repo.add(
        MealPlanEntry(
            iso_week="2026-W18",
            day_of_week=0,
            slot=MealSlot.MORNING,
            ingredient_id=bread.id,
            quantity_g=50.0,
        )
    )
    plan_repo.remove(e.id)  # type: ignore[arg-type]
    assert plan_repo.list_by_week("2026-W18") == []


# --------------------------------------------------------------------------- #
# Personal library flag (in_personal_library)
# --------------------------------------------------------------------------- #


def test_list_personal_excludes_unflagged(db_session):
    repo = IngredientRepo(db_session)
    repo.create(
        Ingredient(name="Tomate, crue", source=Source.CIQUAL, source_ref="20055", in_personal_library=False)
    )
    repo.create(
        Ingredient(name="Mes pâtes", source=Source.MANUAL, in_personal_library=True)
    )
    repo.create(
        Ingredient(name="Nutella", source=Source.OPENFOODFACTS, source_ref="3017620422003", in_personal_library=True)
    )
    personal = repo.list_personal()
    names = {i.name for i in personal}
    assert "Mes pâtes" in names
    assert "Nutella" in names
    assert "Tomate, crue" not in names


def test_search_fts_personal_scope(db_session):
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(name="Tomate cerise", source=Source.CIQUAL, source_ref="1", in_personal_library=False))
    repo.create(Ingredient(name="Tomate du jardin", source=Source.MANUAL, in_personal_library=True))

    all_hits = repo.search_fts("tomate", scope="all")
    personal_hits = repo.search_fts("tomate", scope="personal")
    assert len(all_hits) == 2
    assert len(personal_hits) == 1
    assert personal_hits[0].name == "Tomate du jardin"


def test_search_fts_source_filter(db_session):
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(name="Tomate (CIQUAL)", source=Source.CIQUAL, source_ref="1"))
    repo.create(Ingredient(name="Tomate (OFF)", source=Source.OPENFOODFACTS, source_ref="111"))
    ciqual_only = repo.search_fts("tomate", source=Source.CIQUAL)
    assert len(ciqual_only) == 1
    assert ciqual_only[0].source == Source.CIQUAL


def test_mark_in_personal_library_toggles_flag(db_session):
    repo = IngredientRepo(db_session)
    saved = repo.create(
        Ingredient(name="Tomate", source=Source.CIQUAL, source_ref="20055", in_personal_library=False)
    )
    assert saved.id is not None and saved.in_personal_library is False

    promoted = repo.mark_in_personal_library(saved.id, True)
    assert promoted is not None and promoted.in_personal_library is True
    assert repo.get(saved.id).in_personal_library is True  # type: ignore[union-attr]

    demoted = repo.mark_in_personal_library(saved.id, False)
    assert demoted is not None and demoted.in_personal_library is False


def test_ingredient_decimal_price_roundtrips(db_session):
    repo = IngredientRepo(db_session)
    saved = repo.create(
        Ingredient(
            name="Cheese",
            source=Source.MANUAL,
            price_eur=Decimal("3.99"),
            price_quantity_g=250.0,
        )
    )
    fetched = repo.get(saved.id)  # type: ignore[arg-type]
    assert fetched is not None
    assert fetched.price_eur == Decimal("3.99")
    assert fetched.price_quantity_g == 250.0


# ============================================================ B4 — find_by_name


def test_find_by_name_exact_match(db_session):
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(name="Œufs", source=Source.MANUAL, in_personal_library=True))
    db_session.commit()
    found = repo.find_by_name("Œufs", Source.MANUAL)
    assert found is not None
    assert found.name == "Œufs"


def test_find_by_name_case_insensitive(db_session):
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(name="Tomate", source=Source.MANUAL, in_personal_library=True))
    db_session.commit()
    assert repo.find_by_name("tomate", Source.MANUAL) is not None
    assert repo.find_by_name("TOMATE", Source.MANUAL) is not None
    assert repo.find_by_name("ToMaTe", Source.MANUAL) is not None


def test_find_by_name_strips_whitespace(db_session):
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(name="Carotte", source=Source.MANUAL, in_personal_library=True))
    db_session.commit()
    assert repo.find_by_name("  Carotte  ", Source.MANUAL) is not None


def test_find_by_name_scoped_to_source(db_session):
    """A CIQUAL 'Carotte, crue' must NOT trigger a collision with a manual
    'Carotte' creation — they live in different namespaces."""
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(name="Carotte, crue", source=Source.CIQUAL,
                           source_ref="13030", in_personal_library=True))
    db_session.commit()
    assert repo.find_by_name("Carotte, crue", Source.MANUAL) is None
    assert repo.find_by_name("Carotte, crue", Source.CIQUAL) is not None


def test_find_by_name_no_match(db_session):
    repo = IngredientRepo(db_session)
    assert repo.find_by_name("Inexistant", Source.MANUAL) is None
    # Empty/whitespace queries return None without hitting the DB
    assert repo.find_by_name("", Source.MANUAL) is None
    assert repo.find_by_name("   ", Source.MANUAL) is None


# ============================================================ B2 — list_by_ids


def test_list_by_ids_returns_dict(db_session):
    repo = IngredientRepo(db_session)
    a = repo.create(Ingredient(name="A", source=Source.MANUAL))
    b = repo.create(Ingredient(name="B", source=Source.MANUAL))
    c = repo.create(Ingredient(name="C", source=Source.MANUAL))
    db_session.commit()

    result = repo.list_by_ids([a.id, c.id])
    assert set(result.keys()) == {a.id, c.id}
    assert result[a.id].name == "A"
    assert result[c.id].name == "C"
    assert b.id not in result


def test_list_by_ids_empty_input_no_query(db_session):
    repo = IngredientRepo(db_session)
    assert repo.list_by_ids([]) == {}
    assert repo.list_by_ids(set()) == {}


def test_recipe_list_by_ids_loads_lines_and_tags(db_session):
    from app.data.repositories import RecipeRepo
    ing_repo = IngredientRepo(db_session)
    ing = ing_repo.create(Ingredient(name="Tomate", source=Source.MANUAL))
    db_session.commit()

    recipe_repo = RecipeRepo(db_session)
    r1 = recipe_repo.create(Recipe(
        name="Salade", default_portions=2,
        lines=[RecipeLine(ingredient=ing, quantity_g=200.0, ordinal=0)],
    ))
    r2 = recipe_repo.create(Recipe(name="Pâtes", default_portions=4))
    db_session.commit()

    result = recipe_repo.list_by_ids([r1.id, r2.id])
    assert set(result.keys()) == {r1.id, r2.id}
    # Lines were eagerly loaded — accessing them should not require an
    # additional query (no DetachedInstanceError on a closed session).
    assert len(result[r1.id].lines) == 1
    assert result[r1.id].lines[0].ingredient.name == "Tomate"
    assert result[r2.id].lines == []
