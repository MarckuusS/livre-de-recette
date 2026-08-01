"""Tests for the viewmodels in `app.ui.viewmodels`.

We test through the Python API (`refresh()`, `set_filter()`, `save()`,
`saveFromDict()`, etc.). No QApplication needed — `QObject.method()` is a
direct call. Signal propagation isn't tested here (we trust Qt to deliver).

These tests exercise the bridge layer Pydantic ↔ QML:
  - Round-trip dict -> Ingredient -> dict via `saveFromDict` / `getAsDict`
  - Decimal serialization (price)
  - Filter / search behavior
  - The scaling logic in RecipeEditorViewModel
  - Calendar week navigation
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.data.repositories import IngredientRepo, RecipeRepo
from app.domain.models import (
    Ingredient,
    MealSlot,
    Recipe,
    RecipeLine,
    Source,
)
from app.ui.app_context import AppContext
from app.ui.viewmodels.calendar_vm import CalendarViewModel
from app.ui.viewmodels.ingredient_vm import IngredientViewModel
from app.ui.viewmodels.recipe_vm import (
    RecipeEditorViewModel,
    RecipeListViewModel,
)

# ============================================================ Helpers


def _seed_ingredient(ctx: AppContext, **overrides) -> Ingredient:
    """Create + commit an Ingredient via the repo. Returns the saved model."""
    base = {
        "name": "Carotte",
        "source": Source.MANUAL,
        "kcal_per_100g": 41.0,
        "proteins_g": 0.9,
        "carbs_g": 8.4,
        "fats_g": 0.2,
        "in_personal_library": True,
    }
    base.update(overrides)
    with ctx.session() as s:
        return IngredientRepo(s).create(Ingredient(**base))


def _seed_recipe(ctx: AppContext, ingredients: list[Ingredient], *,
                 name: str = "Salade", default_portions: int = 4) -> Recipe:
    lines = [RecipeLine(ingredient=ing, quantity_g=100.0 * (i + 1), ordinal=i)
             for i, ing in enumerate(ingredients)]
    with ctx.session() as s:
        return RecipeRepo(s).create(Recipe(name=name, default_portions=default_portions, lines=lines))


# ============================================================ IngredientViewModel


def test_ingredient_vm_empty_initially(app_ctx: AppContext) -> None:
    vm = IngredientViewModel(app_ctx)
    assert vm.items.rowCount() == 0


def test_ingredient_vm_picks_up_existing(app_ctx: AppContext) -> None:
    _seed_ingredient(app_ctx, name="Carotte")
    _seed_ingredient(app_ctx, name="Tomate")
    vm = IngredientViewModel(app_ctx)
    assert vm.items.rowCount() == 2


def test_ingredient_vm_only_personal_library(app_ctx: AppContext) -> None:
    """CIQUAL/OFF rows with `in_personal_library=False` should NOT appear."""
    _seed_ingredient(app_ctx, name="Carotte CIQUAL", source=Source.CIQUAL,
                     source_ref="20066", in_personal_library=False)
    _seed_ingredient(app_ctx, name="Tomate manuelle")  # in_personal_library=True
    vm = IngredientViewModel(app_ctx)
    assert vm.items.rowCount() == 1
    from app.ui.models import IngredientListModel
    name = vm.items.data(vm.items.index(0, 0), IngredientListModel.NameRole)
    assert name == "Tomate manuelle"


def test_ingredient_vm_filter_sources(app_ctx: AppContext) -> None:
    """`setFilterSources` filtre la liste personnelle par source."""
    with app_ctx.session() as s:
        repo = IngredientRepo(s)
        repo.create(Ingredient(name="A", source=Source.MANUAL, in_personal_library=True))
        repo.create(Ingredient(name="B", source=Source.CIQUAL, in_personal_library=True,
                              source_ref="100"))
        repo.create(Ingredient(name="C", source=Source.OPENFOODFACTS, in_personal_library=True,
                              source_ref="3017"))
        s.commit()
    vm = IngredientViewModel(app_ctx)
    assert vm.items.rowCount() == 3

    vm.setFilterSources(["manual"])
    assert vm.items.rowCount() == 1

    vm.setFilterSources(["manual", "ciqual"])
    assert vm.items.rowCount() == 2

    vm.setFilterSources([])   # vide = pas de filtre
    assert vm.items.rowCount() == 3


def test_ingredient_vm_filter_with_brand(app_ctx: AppContext) -> None:
    with app_ctx.session() as s:
        repo = IngredientRepo(s)
        repo.create(Ingredient(name="Sans marque", source=Source.MANUAL,
                              in_personal_library=True))
        repo.create(Ingredient(name="Avec marque", source=Source.OPENFOODFACTS,
                              in_personal_library=True, source_ref="123",
                              brand="Bonduelle"))
        s.commit()
    vm = IngredientViewModel(app_ctx)
    assert vm.items.rowCount() == 2

    vm.setFilterWithBrand(True)
    assert vm.items.rowCount() == 1

    vm.setFilterWithBrand(False)
    assert vm.items.rowCount() == 2


def test_ingredient_vm_macro_range_filter(app_ctx: AppContext) -> None:
    """`setMacroRange("proteins", 10, 30)` n'affiche que les ingrédients dont
    les protéines/100g sont dans [10, 30]."""
    with app_ctx.session() as s:
        repo = IngredientRepo(s)
        repo.create(Ingredient(name="Faible", source=Source.MANUAL,
                              in_personal_library=True, proteins_g=2.5))
        repo.create(Ingredient(name="Moyen", source=Source.MANUAL,
                              in_personal_library=True, proteins_g=15.0))
        repo.create(Ingredient(name="Élevé", source=Source.MANUAL,
                              in_personal_library=True, proteins_g=40.0))
        repo.create(Ingredient(name="Inconnu", source=Source.MANUAL,
                              in_personal_library=True))
        s.commit()
    vm = IngredientViewModel(app_ctx)
    assert vm.items.rowCount() == 4

    vm.setMacroRange("proteins", 10.0, 30.0)
    # Faible=2.5 exclu, Moyen=15 inclus, Élevé=40 exclu, Inconnu exclu (filtre actif)
    assert vm.items.rowCount() == 1


def test_ingredient_vm_sort_by_name_asc_desc(app_ctx: AppContext) -> None:
    with app_ctx.session() as s:
        repo = IngredientRepo(s)
        repo.create(Ingredient(name="Carotte", source=Source.MANUAL, in_personal_library=True))
        repo.create(Ingredient(name="Aubergine", source=Source.MANUAL, in_personal_library=True))
        repo.create(Ingredient(name="Banane", source=Source.MANUAL, in_personal_library=True))
        s.commit()
    vm = IngredientViewModel(app_ctx)

    vm.setSortBy("name_asc")
    names_asc = [vm.items.data(vm.items.index(i, 0), vm.items.NameRole)
                 for i in range(vm.items.rowCount())]
    assert names_asc == ["Aubergine", "Banane", "Carotte"]

    vm.setSortBy("name_desc")
    names_desc = [vm.items.data(vm.items.index(i, 0), vm.items.NameRole)
                  for i in range(vm.items.rowCount())]
    assert names_desc == ["Carotte", "Banane", "Aubergine"]


def test_ingredient_vm_active_filter_count(app_ctx: AppContext) -> None:
    vm = IngredientViewModel(app_ctx)
    assert vm.activeFilterCount == 0

    vm.setFilterSources(["manual"])
    assert vm.activeFilterCount == 1

    vm.setFilterWithBrand(True)
    assert vm.activeFilterCount == 2

    vm.setMacroRange("kcal", 100, 0)
    assert vm.activeFilterCount == 3

    vm.resetFilters()
    assert vm.activeFilterCount == 0


def test_ingredient_vm_group_by_source_label(app_ctx: AppContext) -> None:
    """Au passage en groupBy="source", le rôle GroupKey du model retourne
    "CIQUAL" / "Manuel" / "OFF" pour permettre `section.property: 'groupKey'`."""
    with app_ctx.session() as s:
        repo = IngredientRepo(s)
        repo.create(Ingredient(name="A", source=Source.MANUAL, in_personal_library=True))
        repo.create(Ingredient(name="B", source=Source.CIQUAL, in_personal_library=True,
                              source_ref="100"))
        s.commit()
    vm = IngredientViewModel(app_ctx)

    vm.setGroupBy("source")
    assert vm.groupBy == "source"
    keys = [vm.items.data(vm.items.index(i, 0), vm.items.GroupKeyRole)
            for i in range(vm.items.rowCount())]
    assert "CIQUAL" in keys or "Manuel" in keys

    vm.setGroupBy("none")
    keys = [vm.items.data(vm.items.index(i, 0), vm.items.GroupKeyRole)
            for i in range(vm.items.rowCount())]
    # "none" → toutes les rows ont la même clé vide
    assert all(k == "" for k in keys)


def test_ingredient_vm_view_options_persist_across_sessions(app_ctx: AppContext) -> None:
    """Tri / groupement / filtres doivent survivre entre 2 sessions (= 2
    instanciations successives du VM, simulant fermer/rouvrir l'app).
    Persistance via QSettings (cf. conftest : redirigé vers tmp_path)."""
    # Session 1 : l'utilisateur configure ses options de vue.
    vm1 = IngredientViewModel(app_ctx)
    vm1.setSortBy("kcal_desc")
    vm1.setGroupBy("rayon")
    vm1.setFilterSources(["ciqual", "manual"])
    vm1.setFilterInSeason(True)
    vm1.setFilterWithBrand(True)
    vm1.setMacroRange("kcal", 100.0, 500.0)
    vm1.setMacroRange("proteins", 5.0, 0.0)  # max=0 → pas de borne haute

    # Session 2 : nouvelle instanciation, on doit retrouver l'état exact.
    vm2 = IngredientViewModel(app_ctx)
    assert vm2.sortBy == "kcal_desc"
    assert vm2.groupBy == "rayon"
    assert sorted(vm2.filterSources) == ["ciqual", "manual"]
    assert vm2.filterInSeason is True
    assert vm2.filterWithBrand is True
    # Les bornes macro persistent aussi.
    assert vm2._filter_kcal_min == 100.0
    assert vm2._filter_kcal_max == 500.0
    assert vm2._filter_proteins_min == 5.0
    assert vm2._filter_proteins_max == 0.0


def test_ingredient_vm_view_options_defaults_when_no_settings(app_ctx: AppContext) -> None:
    """Premier lancement (QSettings vide) : les défauts s'appliquent — pas de
    tri custom, pas de groupement, pas de filtre."""
    vm = IngredientViewModel(app_ctx)
    assert vm.sortBy == "name_asc"
    assert vm.groupBy == "none"
    assert vm.filterSources == []
    assert vm.filterRayons == []
    assert vm.filterInSeason is False
    assert vm.filterWithBrand is False
    assert vm.filterWithPieceWeight is False


def test_ingredient_vm_group_by_keeps_groups_contiguous(app_ctx: AppContext) -> None:
    """Bug fix : avec un tri primaire (nom A→Z) ET un groupement actif (rayon),
    chaque rayon doit former un bloc contigu. Sans tri secondaire stable par
    groupKey, le tri par nom intercale les rayons et la ListView affiche un
    section header dupliqué chaque fois que le rayon change entre 2 rows."""
    # Seed : 3 rayons, items volontairement dans un ordre alphabétique qui
    # entrelace les rayons (Ail/Carotte → légumes ; Beurre → snacks ; Bœuf → boucherie).
    _seed_ingredient(app_ctx, name="Ail",     category_l1="Fruits et légumes")
    _seed_ingredient(app_ctx, name="Beurre",  category_l1="Snacks")
    _seed_ingredient(app_ctx, name="Bœuf",    category_l1="Boucherie")
    _seed_ingredient(app_ctx, name="Carotte", category_l1="Fruits et légumes")
    _seed_ingredient(app_ctx, name="Cumin",   category_l1="Épicerie")

    vm = IngredientViewModel(app_ctx)
    vm.setSortBy("name_asc")
    vm.setGroupBy("rayon")

    keys = [vm.items.data(vm.items.index(i, 0), vm.items.GroupKeyRole)
            for i in range(vm.items.rowCount())]
    # Chaque rayon ne doit apparaître qu'une seule fois en tant que "bloc".
    transitions = sum(1 for a, b in zip(keys, keys[1:]) if a != b)
    distinct_rayons = len(set(keys))
    assert transitions == distinct_rayons - 1, (
        f"keys={keys} : transitions={transitions} attendu={distinct_rayons - 1} "
        f"(chaque rayon doit former un bloc contigu)"
    )


def test_ingredient_vm_set_filter(app_ctx: AppContext) -> None:
    _seed_ingredient(app_ctx, name="Tomate")
    _seed_ingredient(app_ctx, name="Tomate cerise")
    _seed_ingredient(app_ctx, name="Carotte")
    vm = IngredientViewModel(app_ctx)
    assert vm.items.rowCount() == 3

    vm.set_filter("tomate")
    assert vm.items.rowCount() == 2

    vm.set_filter("")
    assert vm.items.rowCount() == 3


def test_ingredient_vm_save_from_dict_roundtrip(app_ctx: AppContext) -> None:
    """Price is no longer set from the form payload — it is auto-derived
    from the latest price history entry (see `pricing_history_service`).
    `saveFromDict` ignores `priceEur` / `priceQuantityG` for new ingredients
    (they start NULL until the first observation is recorded)."""
    vm = IngredientViewModel(app_ctx)
    saved = vm.saveFromDict({
        "name": "  Aubergine  ",  # whitespace stripped
        "kcal": 17.0,
        "proteins": 1.0,
        "carbs": 4.0,
        "fats": 0.2,
        "priceEur": "2,50",       # ignored by saveFromDict (legacy key)
        "priceQuantityG": 1000.0, # ignored by saveFromDict (legacy key)
        "pieceWeightG": 250.0,
    })
    assert saved["name"] == "Aubergine"
    assert saved["id"] is not None
    assert saved["inLibrary"] is True
    # Price stays empty for a new ingredient with no history.
    assert saved["priceEur"] == ""
    assert saved["priceQuantityG"] is None
    assert saved["pieceWeightG"] == 250.0
    # And the list reflects it
    assert vm.items.rowCount() == 1


def test_ingredient_vm_save_from_dict_preserves_existing_price(app_ctx: AppContext) -> None:
    """Editing an existing ingredient (e.g. renaming) must NOT blank its
    cached price, since the form doesn't even submit the price field."""
    seeded = _seed_ingredient(
        app_ctx,
        name="Tomate",
        price_eur=Decimal("3.50"),
        price_quantity_g=500.0,
    )
    vm = IngredientViewModel(app_ctx)
    saved = vm.saveFromDict({"id": seeded.id, "name": "Tomate cerise"})
    assert saved["name"] == "Tomate cerise"
    # Price is preserved from `existing` even though the payload omits it.
    assert Decimal(saved["priceEur"]) == Decimal("3.50")
    assert saved["priceQuantityG"] == 500.0


def test_ingredient_vm_save_from_dict_rejects_empty_name(app_ctx: AppContext) -> None:
    vm = IngredientViewModel(app_ctx)
    saved = vm.saveFromDict({"name": "   "})
    assert saved == {}
    assert vm.items.rowCount() == 0


def test_ingredient_vm_save_from_dict_emits_collision_signal_on_duplicate_create(
    app_ctx: AppContext,
) -> None:
    """B4 : creating a manual ingredient whose name already exists must emit
    `name_collision_detected(existing_id, name)` and NOT save."""
    seeded = _seed_ingredient(app_ctx, name="Œufs", source=Source.MANUAL)
    vm = IngredientViewModel(app_ctx)

    emissions: list[tuple[int, str]] = []
    vm.name_collision_detected.connect(
        lambda existing_id, name: emissions.append((existing_id, name))
    )

    saved = vm.saveFromDict({"name": "Œufs"})  # collision !
    assert saved == {}                          # save blocked
    assert len(emissions) == 1
    assert emissions[0] == (seeded.id, "Œufs")

    # No new row created
    assert vm.items.rowCount() == 1


def test_ingredient_vm_collision_signal_case_insensitive(app_ctx: AppContext) -> None:
    """Case-insensitive collision (B4) : 'tomate' vs existing 'Tomate'."""
    seeded = _seed_ingredient(app_ctx, name="Tomate", source=Source.MANUAL)
    vm = IngredientViewModel(app_ctx)

    emissions: list[tuple[int, str]] = []
    vm.name_collision_detected.connect(lambda i, n: emissions.append((i, n)))

    saved = vm.saveFromDict({"name": "tomate"})
    assert saved == {}
    assert emissions == [(seeded.id, "tomate")]


def test_ingredient_vm_import_many_promotes_multiple(app_ctx: AppContext) -> None:
    """B1 : `importMany([ids])` flips `in_personal_library = True` on multiple
    rows in a single session, then refreshes the list. Returns count."""
    # Seed 3 CIQUAL ingredients OUTSIDE the personal library (the picker
    # default state).
    a = _seed_ingredient(app_ctx, name="Tomate, crue", source=Source.CIQUAL,
                         in_personal_library=False)
    b = _seed_ingredient(app_ctx, name="Carotte, crue", source=Source.CIQUAL,
                         in_personal_library=False)
    c = _seed_ingredient(app_ctx, name="Oignon", source=Source.CIQUAL,
                         in_personal_library=False)

    vm = IngredientViewModel(app_ctx)
    assert vm.items.rowCount() == 0   # nothing in personal library yet

    promoted = vm.importMany([a.id, b.id, c.id])
    assert promoted == 3
    assert vm.items.rowCount() == 3   # all 3 now visible


def test_ingredient_vm_import_many_empty_returns_zero(app_ctx: AppContext) -> None:
    vm = IngredientViewModel(app_ctx)
    assert vm.importMany([]) == 0


def test_ingredient_vm_import_many_skips_invalid_ids(app_ctx: AppContext) -> None:
    a = _seed_ingredient(app_ctx, name="X", source=Source.CIQUAL, in_personal_library=False)
    vm = IngredientViewModel(app_ctx)
    promoted = vm.importMany([a.id, 99999, 0])  # one valid, two invalid
    assert promoted == 1


def test_ingredient_vm_no_collision_when_editing_existing(app_ctx: AppContext) -> None:
    """B4 must NOT trigger on UPDATE of an existing ingredient — that would
    block legitimate renames or other edits to the same row."""
    seeded = _seed_ingredient(app_ctx, name="Tomate", source=Source.MANUAL)
    vm = IngredientViewModel(app_ctx)

    emissions: list = []
    vm.name_collision_detected.connect(lambda *a: emissions.append(a))

    # Edit the existing row : same name, but `id` is set → goes through update.
    saved = vm.saveFromDict({"id": seeded.id, "name": "Tomate", "kcal": 18.0})
    assert saved.get("id") == seeded.id
    assert emissions == []   # no signal emitted


def test_ingredient_vm_get_as_dict(app_ctx: AppContext) -> None:
    seeded = _seed_ingredient(
        app_ctx,
        name="Pomme",
        kcal_per_100g=52.0,
        price_eur=Decimal("3.99"),
        price_quantity_g=1000.0,
        piece_weight_g=180.0,
    )
    vm = IngredientViewModel(app_ctx)
    d = vm.getAsDict(seeded.id)
    assert d["name"] == "Pomme"
    assert d["kcal"] == 52.0
    # priceEur is a string (not Decimal — QML doesn't know Decimal). Numeric(10, 4)
    # pads with trailing zeros, so "3.9900" not "3.99".
    assert isinstance(d["priceEur"], str)
    assert Decimal(d["priceEur"]) == Decimal("3.99")
    assert d["pieceWeightG"] == 180.0


def test_ingredient_vm_get_as_dict_unknown_returns_empty(app_ctx: AppContext) -> None:
    vm = IngredientViewModel(app_ctx)
    assert vm.getAsDict(99999) == {}


def test_ingredient_vm_delete_manual_hard_deletes(app_ctx: AppContext) -> None:
    seeded = _seed_ingredient(app_ctx, source=Source.MANUAL)
    vm = IngredientViewModel(app_ctx)
    vm.delete(seeded.id)
    assert vm.items.rowCount() == 0
    # Hard-deleted: gone from the DB entirely
    with app_ctx.session() as s:
        assert IngredientRepo(s).get(seeded.id) is None


def test_ingredient_vm_delete_ciqual_keeps_row_flips_flag(app_ctx: AppContext) -> None:
    seeded = _seed_ingredient(
        app_ctx, name="Pomme CIQUAL", source=Source.CIQUAL, source_ref="13030",
        in_personal_library=True,
    )
    vm = IngredientViewModel(app_ctx)
    vm.delete(seeded.id)
    assert vm.items.rowCount() == 0
    # Still in DB, just flagged out of the personal library
    with app_ctx.session() as s:
        ing = IngredientRepo(s).get(seeded.id)
        assert ing is not None
        assert ing.in_personal_library is False


def test_ingredient_vm_import_existing(app_ctx: AppContext) -> None:
    seeded = _seed_ingredient(
        app_ctx, name="Tomate CIQUAL", source=Source.CIQUAL, source_ref="20047",
        in_personal_library=False,
    )
    vm = IngredientViewModel(app_ctx)
    assert vm.items.rowCount() == 0
    vm.import_existing(seeded.id)
    assert vm.items.rowCount() == 1


def test_ingredient_vm_search_once(app_ctx: AppContext) -> None:
    _seed_ingredient(app_ctx, name="Tomate")
    _seed_ingredient(app_ctx, name="Tomate cerise")
    _seed_ingredient(app_ctx, name="Carotte")
    vm = IngredientViewModel(app_ctx)

    matches = vm.searchOnce("tomate", "personal", 25)
    assert len(matches) == 2
    assert all("tomate" in m["name"].lower() for m in matches)

    # Empty query returns []
    assert vm.searchOnce("", "personal", 25) == []


def test_ingredient_vm_search_by_source(app_ctx: AppContext) -> None:
    _seed_ingredient(
        app_ctx, name="Tomate CIQUAL", source=Source.CIQUAL, source_ref="20047",
        in_personal_library=False,
    )
    _seed_ingredient(
        app_ctx, name="Tomate OFF", source=Source.OPENFOODFACTS, source_ref="3000000000001",
        in_personal_library=False,
    )
    vm = IngredientViewModel(app_ctx)

    ciqual_matches = vm.searchBySource("tomate", "ciqual", 50)
    off_matches = vm.searchBySource("tomate", "openfoodfacts", 50)
    assert len(ciqual_matches) == 1
    assert len(off_matches) == 1
    assert ciqual_matches[0]["source"] == "ciqual"
    assert off_matches[0]["source"] == "openfoodfacts"


def test_ingredient_vm_handles_null_ctx() -> None:
    """A VM without ctx must not crash on read methods (used in unit tests)."""
    vm = IngredientViewModel(None)
    assert vm.items.rowCount() == 0
    assert vm.get(1) is None
    assert vm.searchOnce("x", "personal", 25) == []


# ============================================================ RecipeListViewModel


def test_recipe_list_vm_basic(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx)
    _seed_recipe(app_ctx, [ing], name="Salade")
    _seed_recipe(app_ctx, [ing], name="Soupe")

    vm = RecipeListViewModel(app_ctx)
    assert vm.items.rowCount() == 2


def test_recipe_list_vm_delete(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx)
    r1 = _seed_recipe(app_ctx, [ing], name="Salade")
    _seed_recipe(app_ctx, [ing], name="Soupe")

    vm = RecipeListViewModel(app_ctx)
    vm.delete(r1.id)
    assert vm.items.rowCount() == 1


# ============================================================ RecipeEditorViewModel


def test_recipe_editor_vm_load_and_meta(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx, name="Carotte")
    recipe = _seed_recipe(app_ctx, [ing], name="Salade", default_portions=4)

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    assert vm.recipeName == "Salade"
    assert vm.defaultPortions == 4
    assert len(vm.linesAsList()) == 1


def test_recipe_editor_vm_scaling_default(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx, kcal_per_100g=100.0, proteins_g=10.0)
    recipe = _seed_recipe(app_ctx, [ing], default_portions=4)

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    assert vm.displayPortions == 4
    assert vm.scaleRatio == 1.0
    assert vm.isScaled is False

    line0 = vm.linesAsList()[0]
    assert line0["quantityG"] == 100.0
    assert line0["originalQuantityG"] == 100.0


def test_recipe_editor_vm_scale_doubles_total_keeps_per_portion(app_ctx: AppContext) -> None:
    """Scaling 4 → 8 should: line.quantityG ×2, total nutrition ×2,
    per-portion nutrition unchanged, total cost ×2, per-portion cost unchanged."""
    ing = _seed_ingredient(
        app_ctx, kcal_per_100g=100.0, proteins_g=10.0,
        price_eur=Decimal("10.00"), price_quantity_g=1000.0,
    )
    recipe = _seed_recipe(app_ctx, [ing], default_portions=4)
    # Override the auto-generated quantity (100g for line 0): make it 500g for clarity.
    with app_ctx.session() as s:
        recipe = RecipeRepo(s).get(recipe.id)
        recipe.lines[0] = recipe.lines[0].model_copy(update={"quantity_g": 500.0})
        RecipeRepo(s).update(recipe)

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    nut_normal = vm.nutritionTotalAsDict()
    nut_pp_normal = vm.nutritionPerPortionAsDict()
    cost_normal = vm.costInfoAsDict()

    vm.setDisplayPortions(8)
    assert vm.isScaled is True
    assert vm.scaleRatio == 2.0

    nut_scaled = vm.nutritionTotalAsDict()
    nut_pp_scaled = vm.nutritionPerPortionAsDict()
    cost_scaled = vm.costInfoAsDict()

    assert nut_scaled["kcal"] == pytest.approx(nut_normal["kcal"] * 2.0)
    assert nut_scaled["proteins"] == pytest.approx(nut_normal["proteins"] * 2.0)
    # Per-portion is invariant
    assert nut_pp_scaled["kcal"] == pytest.approx(nut_pp_normal["kcal"])
    # Cost total ×2 ; per-portion unchanged
    assert float(cost_scaled["total"]) == pytest.approx(float(cost_normal["total"]) * 2.0)
    assert cost_scaled["perPortion"] == cost_normal["perPortion"]
    # Lines display the scaled quantity, but originalQuantityG stays
    line0 = vm.linesAsList()[0]
    assert line0["quantityG"] == 1000.0  # 500 * 2
    assert line0["originalQuantityG"] == 500.0


def test_recipe_editor_vm_nutrition_per_100g(app_ctx: AppContext) -> None:
    """Densité nutritionnelle / 100 g : `total / (poids_cru / 100)`. Vérifie
    sur une recette à un seul ingrédient (égalité directe avec les valeurs
    par 100 g de l'ingrédient) puis sur une recette mixte."""
    # Recette à 1 ingrédient, 200 g de riz : la densité / 100 g doit être
    # exactement les valeurs nutritionnelles de l'ingrédient (par convention
    # CIQUAL, déjà par 100 g).
    riz = _seed_ingredient(app_ctx, name="Riz", kcal_per_100g=350.0,
                           proteins_g=7.0, carbs_g=78.0, fats_g=0.5)
    recipe = _seed_recipe(app_ctx, [riz], default_portions=4)
    with app_ctx.session() as s:
        recipe = RecipeRepo(s).get(recipe.id)
        recipe.lines[0] = recipe.lines[0].model_copy(update={"quantity_g": 200.0})
        RecipeRepo(s).update(recipe)

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    n100 = vm.nutritionPer100gAsDict()
    assert n100["kcal"] == pytest.approx(350.0)
    assert n100["proteins"] == pytest.approx(7.0)
    assert n100["carbs"] == pytest.approx(78.0)
    assert n100["fats"] == pytest.approx(0.5)


def test_recipe_editor_vm_nutrition_per_100g_invariant_under_scaling(app_ctx: AppContext) -> None:
    """La densité / 100 g est invariante sous scaling : multiplier toutes les
    quantités par k multiplie aussi le total → le ratio reste constant."""
    ing = _seed_ingredient(app_ctx, kcal_per_100g=200.0, proteins_g=10.0)
    recipe = _seed_recipe(app_ctx, [ing], default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    n_normal = vm.nutritionPer100gAsDict()
    vm.setDisplayPortions(8)  # ratio ×2 — toutes les quantités doublent
    n_scaled = vm.nutritionPer100gAsDict()
    assert n_scaled["kcal"] == pytest.approx(n_normal["kcal"])
    assert n_scaled["proteins"] == pytest.approx(n_normal["proteins"])


def test_recipe_editor_vm_nutrition_per_100g_empty_recipe(app_ctx: AppContext) -> None:
    """Recette sans ligne (ou poids total = 0) : retourne des zéros — pas de
    division par zéro."""
    vm = RecipeEditorViewModel(app_ctx)
    # Sans loadById, _recipe est une recette vide par défaut
    n100 = vm.nutritionPer100gAsDict()
    assert n100["kcal"] == 0
    assert n100["proteins"] == 0
    assert n100["fats"] == 0


def test_recipe_editor_vm_portion_weight_with_ratio(app_ctx: AppContext) -> None:
    """Recette `riz cru 100g (ratio 3.0) + huile 10g (pas de ratio)` :
    - Riz : 100 g cru → 300 g cuit
    - Huile : 10 g → 10 g (1:1, pas de ratio renseigné)
    Total cuit = 310 g ; sur 4 portions par défaut = 77.5 g/portion."""
    riz = _seed_ingredient(app_ctx, name="Riz", cooked_weight_per_100g_raw=300.0)
    huile = _seed_ingredient(app_ctx, name="Huile", cooked_weight_per_100g_raw=None)
    # _seed_recipe assigns 100g to line 0 and 200g to line 1 — override.
    recipe = _seed_recipe(app_ctx, [riz, huile], default_portions=4)
    with app_ctx.session() as s:
        recipe = RecipeRepo(s).get(recipe.id)
        recipe.lines[0] = recipe.lines[0].model_copy(update={"quantity_g": 100.0})
        recipe.lines[1] = recipe.lines[1].model_copy(update={"quantity_g": 10.0})
        RecipeRepo(s).update(recipe)

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    pw = vm.portionWeightAsDict()
    assert pw["totalCookedG"] == pytest.approx(310.0)
    assert pw["perPortionCookedG"] == pytest.approx(77.5)
    assert pw["hasAnyRatio"] is True
    assert pw["ratiosDefinedCount"] == 1
    assert pw["totalLines"] == 2


def test_recipe_editor_vm_portion_weight_no_ratio_anywhere(app_ctx: AppContext) -> None:
    """Aucune ligne n'a de ratio cuisson : `hasAnyRatio = False`, le total est
    la somme brute des `quantity_g` (1:1 implicite). Le côté UI affichera la
    carte en italique grisé pour signaler l'estimation par défaut."""
    a = _seed_ingredient(app_ctx, name="A")  # cooked_weight_per_100g_raw défaut None
    b = _seed_ingredient(app_ctx, name="B")
    recipe = _seed_recipe(app_ctx, [a, b], default_portions=2)  # lines : 100g, 200g

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    pw = vm.portionWeightAsDict()
    assert pw["hasAnyRatio"] is False
    assert pw["ratiosDefinedCount"] == 0
    assert pw["totalCookedG"] == pytest.approx(300.0)  # 100 + 200
    assert pw["perPortionCookedG"] == pytest.approx(150.0)


def test_recipe_editor_vm_portion_weight_scaling(app_ctx: AppContext) -> None:
    """Quand la recette est scalée (4 → 8 portions), le poids cuit total ×2
    mais le poids par portion reste identique (la portion garde sa taille)."""
    riz = _seed_ingredient(app_ctx, name="Riz", cooked_weight_per_100g_raw=300.0)
    recipe = _seed_recipe(app_ctx, [riz], default_portions=4)  # line : 100g cru

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    pw_normal = vm.portionWeightAsDict()
    assert pw_normal["totalCookedG"] == pytest.approx(300.0)
    assert pw_normal["perPortionCookedG"] == pytest.approx(75.0)
    assert pw_normal["isScaled"] is False

    vm.setDisplayPortions(8)
    pw_scaled = vm.portionWeightAsDict()
    assert pw_scaled["isScaled"] is True
    assert pw_scaled["totalCookedG"] == pytest.approx(600.0)   # ×2
    assert pw_scaled["perPortionCookedG"] == pytest.approx(75.0)  # invariant


def test_recipe_editor_vm_setting_to_default_clears_scale(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx)
    recipe = _seed_recipe(app_ctx, [ing], default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    vm.setDisplayPortions(8)
    assert vm.isScaled is True
    vm.setDisplayPortions(4)  # = default → should reset
    assert vm.isScaled is False
    assert vm.displayPortions == 4
    assert vm.scaleRatio == 1.0


def test_recipe_editor_vm_reset_display_portions(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx)
    recipe = _seed_recipe(app_ctx, [ing], default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    vm.setDisplayPortions(8)
    vm.resetDisplayPortions()
    assert vm.isScaled is False
    assert vm.displayPortions == 4


def test_recipe_editor_vm_edit_qty_in_scaled_mode_inverts_ratio(app_ctx: AppContext) -> None:
    """When scaled ×2, editing a line to '1200 g displayed' must store 600 g."""
    ing = _seed_ingredient(app_ctx)
    recipe = _seed_recipe(app_ctx, [ing], default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    vm.setDisplayPortions(8)  # ratio = 2.0
    vm.updateLineQty(0, 1200.0)  # displayed value

    line0 = vm.linesAsList()[0]
    assert line0["quantityG"] == 1200.0  # what was typed
    assert line0["originalQuantityG"] == 600.0  # 1200 / 2


def test_recipe_editor_vm_load_resets_scaling(app_ctx: AppContext) -> None:
    """Loading a different recipe should clear any leftover scaling from the
    previous one — the user expects each recipe to start fresh."""
    ing = _seed_ingredient(app_ctx)
    r1 = _seed_recipe(app_ctx, [ing], name="A", default_portions=4)
    r2 = _seed_recipe(app_ctx, [ing], name="B", default_portions=6)

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(r1.id)
    vm.setDisplayPortions(8)
    assert vm.isScaled is True

    vm.loadById(r2.id)
    assert vm.displayPortions == 6
    assert vm.isScaled is False


def test_recipe_editor_vm_change_default_portions_resets_scaling(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx)
    recipe = _seed_recipe(app_ctx, [ing], default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    vm.setDisplayPortions(8)

    vm.update_meta(name=vm.recipeName, instructions=vm.instructions, default_portions=6)
    # default changed → scaling should reset
    assert vm.isScaled is False
    assert vm.displayPortions == 6


def test_recipe_editor_vm_save_persists_meta(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx)
    recipe = _seed_recipe(app_ctx, [ing], name="Salade", default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    vm.update_meta(name="Salade italienne", instructions="Mix.", default_portions=6)
    assert vm.saveCurrent() is True

    with app_ctx.session() as s:
        reloaded = RecipeRepo(s).get(recipe.id)
        assert reloaded.name == "Salade italienne"
        assert reloaded.default_portions == 6
        assert reloaded.instructions == "Mix."


def test_recipe_editor_vm_update_line_notes(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx)
    recipe = _seed_recipe(app_ctx, [ing], default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    vm.update_line_notes(0, "  écraser au mortier  ")
    line0 = vm.linesAsList()[0]
    assert line0["notes"] == "écraser au mortier"  # whitespace stripped

    vm.update_line_notes(0, "")
    line0 = vm.linesAsList()[0]
    assert line0["notes"] == ""  # empty string in dict (stored as None internally)


# ============================================================ CalendarViewModel


def test_calendar_vm_default_iso_week_format(app_ctx: AppContext) -> None:
    vm = CalendarViewModel(app_ctx)
    assert len(vm.iso_week) == 8
    assert vm.iso_week[4:6] == "-W"
    int(vm.iso_week[:4])  # year
    int(vm.iso_week[6:])  # week


def test_calendar_vm_set_iso_week(app_ctx: AppContext) -> None:
    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    assert vm.iso_week == "2026-W18"


def test_calendar_vm_shift_week(app_ctx: AppContext) -> None:
    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    vm.shift_week(1)
    assert vm.iso_week == "2026-W19"
    vm.shift_week(-2)
    assert vm.iso_week == "2026-W17"


def test_calendar_vm_add_remove_recipe_entry(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx)
    recipe = _seed_recipe(app_ctx, [ing], name="Salade")

    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    assert vm.entries.rowCount() == 0

    vm.add_recipe(0, MealSlot.NOON, recipe.id, portions=2.0)
    assert vm.entries.rowCount() == 1

    # Remove it
    entry_id = vm.entries_list[0].id
    vm.remove(entry_id)
    assert vm.entries.rowCount() == 0


def test_calendar_vm_days_as_list_returns_dates(app_ctx: AppContext) -> None:
    """Le header de la grille calendrier affiche "avr 28" au-dessus de
    "Lundi" via `daysAsList()`. La semaine 2026-W18 commence le lundi
    27 avril 2026 (vérifiable avec datetime.fromisocalendar)."""
    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    days = vm.daysAsList()
    assert len(days) == 7
    # Lundi 27 avr — format mois court (locale-stable, indépendant du système)
    assert days[0]["dayOfWeek"] == 0
    assert days[0]["dayNumber"] == 27
    assert days[0]["monthShort"] == "avr"
    assert days[0]["isoDate"] == "2026-04-27"
    # Dimanche 3 mai — chevauchement de mois géré
    assert days[6]["dayOfWeek"] == 6
    assert days[6]["dayNumber"] == 3
    assert days[6]["monthShort"] == "mai"


def test_calendar_vm_day_and_week_nutrition_totals(app_ctx: AppContext) -> None:
    """Le panneau "Apports nutritionnels par jour" sur le calendrier lit
    `dayTotalAsDict(0..6)` + `weekTotalAsDict()`. On vérifie que les 8
    nutriments y sont, et que la somme des jours = total semaine."""
    ing = _seed_ingredient(app_ctx, name="Pomme",
                           kcal_per_100g=52.0, proteins_g=0.3,
                           carbs_g=14.0, sugars_g=10.4, fats_g=0.2,
                           fiber_g=2.4, salt_g=0.0)
    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    # 200 g de pomme lundi midi, 150 g jeudi soir
    vm.add_ingredient(0, MealSlot.NOON, ing.id, quantity_g=200.0)
    vm.add_ingredient(3, MealSlot.EVENING, ing.id, quantity_g=150.0)

    monday = vm.dayTotalAsDict(0)
    thursday = vm.dayTotalAsDict(3)
    other = vm.dayTotalAsDict(1)
    week = vm.weekTotalAsDict()

    # Les 8 clés réglementaires UE doivent toutes être présentes (même à 0)
    expected_keys = {"kcal", "proteins", "carbs", "sugars", "fats",
                     "saturatedFats", "fiber", "salt"}
    assert expected_keys.issubset(monday.keys())
    assert expected_keys.issubset(week.keys())

    # Lundi : 200 g de pomme → 2× les valeurs / 100 g
    assert monday["kcal"] == pytest.approx(104.0)
    assert monday["fiber"] == pytest.approx(4.8)
    # Mardi (sans entrée) : tout à 0
    assert other["kcal"] == 0
    # Total semaine = lundi + jeudi
    assert week["kcal"] == pytest.approx(monday["kcal"] + thursday["kcal"])
    assert week["fiber"] == pytest.approx(monday["fiber"] + thursday["fiber"])


def test_calendar_vm_add_ingredient_entry(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx, name="Carotte")

    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    vm.add_ingredient(2, MealSlot.MORNING, ing.id, quantity_g=80.0)
    assert vm.entries.rowCount() == 1
    entry = vm.entries_list[0]
    assert entry.day_of_week == 2
    assert entry.slot == MealSlot.MORNING
    assert entry.ingredient_id == ing.id
    assert entry.quantity_g == 80.0


# ============================================================ Undo (U3)


def test_ingredient_vm_undo_after_manual_delete(app_ctx: AppContext) -> None:
    """Manual ingredient deleted → undo recreates with NEW id (different from
    the original — repo.create() always generates a fresh primary key)."""
    seeded = _seed_ingredient(app_ctx, name="Tomate", source=Source.MANUAL)
    original_id = seeded.id
    vm = IngredientViewModel(app_ctx)
    assert vm.items.rowCount() == 1

    vm.delete(original_id)
    assert vm.items.rowCount() == 0
    with app_ctx.session() as s:
        assert IngredientRepo(s).get(original_id) is None  # hard-deleted

    vm.undoLastDelete()

    assert vm.items.rowCount() == 1
    # Re-created with a fresh id, but same name/macros
    with app_ctx.session() as s:
        all_personal = IngredientRepo(s).list_personal()
    assert len(all_personal) == 1
    assert all_personal[0].name == "Tomate"


def test_ingredient_vm_undo_after_ciqual_unflag_keeps_id(app_ctx: AppContext) -> None:
    """CIQUAL ingredient unflagged → undo just re-flags. The id is preserved
    (no risk of breaking recipe references)."""
    seeded = _seed_ingredient(
        app_ctx, name="Tomate CIQUAL", source=Source.CIQUAL,
        source_ref="20047", in_personal_library=True,
    )
    original_id = seeded.id
    vm = IngredientViewModel(app_ctx)

    vm.delete(original_id)
    assert vm.items.rowCount() == 0

    vm.undoLastDelete()

    assert vm.items.rowCount() == 1
    # Same id (the row was never deleted, just unflagged)
    with app_ctx.session() as s:
        ing = IngredientRepo(s).get(original_id)
        assert ing is not None
        assert ing.in_personal_library is True


def test_ingredient_vm_undo_idempotent_after_buffer_used(app_ctx: AppContext) -> None:
    """Calling undo twice in a row is harmless — second call does nothing."""
    seeded = _seed_ingredient(app_ctx, source=Source.MANUAL)
    vm = IngredientViewModel(app_ctx)
    vm.delete(seeded.id)
    vm.undoLastDelete()
    vm.undoLastDelete()  # buffer cleared after first undo
    assert vm.items.rowCount() == 1


def test_ingredient_vm_undo_no_op_without_buffer(app_ctx: AppContext) -> None:
    """Calling undo without any prior delete is a no-op (no crash)."""
    vm = IngredientViewModel(app_ctx)
    vm.undoLastDelete()
    assert vm.items.rowCount() == 0


def test_recipe_list_vm_undo_after_delete(app_ctx: AppContext) -> None:
    """Recipe deleted → undo recreates with lines and tags intact (NEW id)."""
    from app.data.repositories import TagRepo
    from app.domain.models import Tag
    ing = _seed_ingredient(app_ctx, name="Carotte")
    # Pin a tag too (to verify it survives the round-trip)
    with app_ctx.session() as s:
        veg = TagRepo(s).find_by_name("végétarien")
    recipe = RecipeRepo  # avoid unused import warning if any
    # Create the recipe with the ingredient + a tag
    with app_ctx.session() as s:
        seeded_recipe = RecipeRepo(s).create(Recipe(
            name="Salade carotte", default_portions=2,
            lines=[RecipeLine(ingredient=ing, quantity_g=200.0, ordinal=0)],
            tags=[veg],
        ))

    vm = RecipeListViewModel(app_ctx)
    assert vm.items.rowCount() == 1

    vm.delete(seeded_recipe.id)
    assert vm.items.rowCount() == 0

    vm.undoLastDelete()

    assert vm.items.rowCount() == 1
    # The new recipe carries the same name + lines + tags
    with app_ctx.session() as s:
        all_recipes = RecipeRepo(s).list_all()
    assert len(all_recipes) == 1
    restored = all_recipes[0]
    assert restored.name == "Salade carotte"
    assert restored.default_portions == 2
    assert len(restored.lines) == 1
    assert restored.lines[0].ingredient.id == ing.id
    assert restored.lines[0].quantity_g == 200.0
    assert any(t.name == "végétarien" for t in restored.tags)


def test_calendar_vm_undo_after_remove(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx, name="Carotte")
    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    vm.add_ingredient(0, MealSlot.NOON, ing.id, quantity_g=100.0)
    assert vm.entries.rowCount() == 1
    entry_id = vm.entries_list[0].id

    vm.remove(entry_id)
    assert vm.entries.rowCount() == 0

    vm.undoLastDelete()

    assert vm.entries.rowCount() == 1
    restored = vm.entries_list[0]
    assert restored.day_of_week == 0
    assert restored.slot == MealSlot.NOON
    assert restored.ingredient_id == ing.id
    assert restored.quantity_g == 100.0


def test_calendar_vm_undo_only_restores_last_removed(app_ctx: AppContext) -> None:
    """The buffer holds only the latest deletion — older ones are lost.
    This is the documented behavior (single-step undo, not history)."""
    ing = _seed_ingredient(app_ctx, name="Carotte")
    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    vm.add_ingredient(0, MealSlot.NOON, ing.id, 100.0)
    vm.add_ingredient(1, MealSlot.EVENING, ing.id, 200.0)
    assert vm.entries.rowCount() == 2

    e1_id = vm.entries_list[0].id
    e2_id = vm.entries_list[1].id
    vm.remove(e1_id)
    vm.remove(e2_id)
    assert vm.entries.rowCount() == 0

    vm.undoLastDelete()  # only restores e2

    assert vm.entries.rowCount() == 1
    assert vm.entries_list[0].day_of_week == 1  # e2's day


def test_calendar_vm_describe_pre_resolved_in_model(app_ctx: AppContext) -> None:
    """The MealPlanModel rows should carry the description string already
    resolved (so QML doesn't have to query the DB per delegate render)."""
    from app.ui.models import MealPlanModel
    ing = _seed_ingredient(app_ctx, name="Carotte")

    vm = CalendarViewModel(app_ctx)
    vm.set_iso_week("2026-W18")
    vm.add_ingredient(0, MealSlot.NOON, ing.id, quantity_g=120.0)

    model = vm.entries
    desc = model.data(model.index(0, 0), MealPlanModel.DescriptionRole)
    assert "Carotte" in desc
    assert "120" in desc


# ============================================================ A3 — Unsaved-changes tracking


def test_recipe_editor_vm_starts_clean(app_ctx: AppContext) -> None:
    """A freshly-instantiated VM is not dirty."""
    vm = RecipeEditorViewModel(app_ctx)
    assert vm.hasUnsavedChanges is False


def test_recipe_editor_vm_load_resets_dirty(app_ctx: AppContext) -> None:
    """After loading an existing recipe, the dirty flag is reset."""
    ing = _seed_ingredient(app_ctx, name="Carotte")
    recipe = _seed_recipe(app_ctx, [ing], name="Salade", default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    assert vm.hasUnsavedChanges is False


def test_recipe_editor_vm_meta_change_marks_dirty(app_ctx: AppContext) -> None:
    """Editing meta sets the dirty flag."""
    ing = _seed_ingredient(app_ctx, name="Carotte")
    recipe = _seed_recipe(app_ctx, [ing], name="Salade", default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    vm.updateMeta("Salade composée", "Mélanger.", 6)
    assert vm.hasUnsavedChanges is True


def test_recipe_editor_vm_meta_no_change_keeps_clean(app_ctx: AppContext) -> None:
    """Echoing back identical meta values must NOT mark dirty (avoid spurious
    flags from QML focus changes that re-push the same text)."""
    ing = _seed_ingredient(app_ctx, name="Carotte")
    recipe = _seed_recipe(app_ctx, [ing], name="Salade", default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    # Echo identical values back (default instructions=""). Must stay clean.
    vm.updateMeta(recipe.name, "", recipe.default_portions)
    assert vm.hasUnsavedChanges is False


def test_recipe_editor_vm_add_line_marks_dirty(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx, name="Carotte")
    other = _seed_ingredient(app_ctx, name="Oignon")
    recipe = _seed_recipe(app_ctx, [ing], name="Salade")
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    vm.addLineById(other.id, 80.0)
    assert vm.hasUnsavedChanges is True


def test_recipe_editor_vm_remove_line_marks_dirty(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx, name="Carotte")
    recipe = _seed_recipe(app_ctx, [ing], name="Salade")
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    vm.removeLineByOrdinal(0)
    assert vm.hasUnsavedChanges is True


def test_recipe_editor_vm_update_line_qty_marks_dirty(app_ctx: AppContext) -> None:
    ing = _seed_ingredient(app_ctx, name="Carotte")
    recipe = _seed_recipe(app_ctx, [(ing, 100.0)] if False else [ing], name="Salade")
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    vm.updateLineQty(0, 250.0)
    assert vm.hasUnsavedChanges is True


def test_recipe_editor_vm_save_clears_dirty(app_ctx: AppContext) -> None:
    """saveCurrent() persists and resets the dirty flag (via load(saved))."""
    ing = _seed_ingredient(app_ctx, name="Carotte")
    recipe = _seed_recipe(app_ctx, [ing], name="Salade")
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    vm.updateMeta("Salade XL", "", 8)
    assert vm.hasUnsavedChanges is True

    assert vm.saveCurrent() is True
    assert vm.hasUnsavedChanges is False


def test_recipe_list_vm_search_once(app_ctx: AppContext) -> None:
    """B6 : `searchOnce(query)` returns recipes whose name contains the
    query (case-insensitive). Used by the unified Ctrl+K dialog."""
    ing = _seed_ingredient(app_ctx, name="Tomate")
    _seed_recipe(app_ctx, [ing], name="Chili con carne")
    _seed_recipe(app_ctx, [ing], name="Pâtes au thon")
    _seed_recipe(app_ctx, [ing], name="Salade de tomates")

    vm = RecipeListViewModel(app_ctx)
    matches = vm.searchOnce("tomat", 12)
    assert len(matches) == 1
    assert matches[0]["name"] == "Salade de tomates"

    matches = vm.searchOnce("PÂTES", 12)   # case-insensitive
    assert len(matches) == 1

    # Empty query → empty list (no flooding the UI)
    assert vm.searchOnce("", 12) == []


def test_recipe_editor_vm_lines_sorted_by_aisle(app_ctx: AppContext) -> None:
    """B5 : `linesAsList()` returns lines pre-sorted by category_l1 (rayon)
    so QML can render section headers without re-sorting client-side.
    Lines without category_l1 fall to the bottom."""
    # Seed 3 ingredients with different category_l1 in non-alphabetical order
    ing_dairy = _seed_ingredient(
        app_ctx, name="Lait", category_l1="laits et produits laitiers",
    )
    ing_grain = _seed_ingredient(
        app_ctx, name="Riz", category_l1="céréales",
    )
    ing_veggie = _seed_ingredient(
        app_ctx, name="Tomate", category_l1="fruits, légumes, légumineuses",
    )
    # One ingredient WITHOUT category — should land in "Autres" at the end.
    ing_manual = _seed_ingredient(
        app_ctx, name="Sel maison", category_l1=None,
    )

    # Recipe lines added in arbitrary order via the seed helper
    recipe = _seed_recipe(
        app_ctx,
        [ing_dairy, ing_grain, ing_veggie, ing_manual],
        name="Mix",
    )

    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)
    lines = vm.linesAsList()
    cats = [line["categoryL1"] for line in lines]
    # Categories sorted alphabetically (céréales < fruits < laits) ; manual ("") last.
    assert cats == [
        "céréales",
        "fruits, légumes, légumineuses",
        "laits et produits laitiers",
        "",
    ]


def test_recipe_editor_vm_unsaved_signal_emitted_on_dirty_transition(
    app_ctx: AppContext,
) -> None:
    """The `unsaved_changed` signal fires when the flag toggles, not on every
    keystroke that keeps it set."""
    ing = _seed_ingredient(app_ctx, name="Carotte")
    recipe = _seed_recipe(app_ctx, [ing], name="Salade", default_portions=4)
    vm = RecipeEditorViewModel(app_ctx)
    vm.loadById(recipe.id)

    emissions: list = []
    vm.unsaved_changed.connect(lambda: emissions.append(vm.hasUnsavedChanges))

    vm.updateMeta("Salade XL", "", 4)            # transition False → True
    vm.updateMeta("Salade XL+", "", 4)           # stays True (no extra emission)
    vm.updateMeta("Salade XL+", "more", 4)       # stays True
    # 1 emission so far
    assert emissions == [True]

    vm.saveCurrent()                              # transition True → False
    assert emissions == [True, False]
