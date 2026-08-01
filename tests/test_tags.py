"""Tests for the tags feature (F4) — TagRepo, RecipeRepo tag association,
filter by tags. The default-tag seeding is exercised through the `db_session`
fixture (init_schema seeds them).
"""

from __future__ import annotations

from app.data.repositories import IngredientRepo, RecipeRepo, TagRepo
from app.domain.models import (
    Ingredient,
    Recipe,
    RecipeLine,
    Source,
    Tag,
)


def _ing(s, name="Carotte"):
    return IngredientRepo(s).create(
        Ingredient(name=name, source=Source.MANUAL, in_personal_library=True)
    )


def _recipe(s, name, ingredients_with_qty=None, tags=None):
    lines = [
        RecipeLine(ingredient=ing, quantity_g=qty, ordinal=i)
        for i, (ing, qty) in enumerate(ingredients_with_qty or [])
    ]
    return RecipeRepo(s).create(Recipe(name=name, lines=lines, tags=tags or []))


# ============================================================ Default seed


def test_default_tags_seeded(db_session) -> None:
    tags = TagRepo(db_session).list_all()
    names = [t.name for t in tags]
    assert "entrée" in names
    assert "plat principal" in names
    assert "végétarien" in names
    assert "rapide" in names
    assert len(tags) == 10


def test_default_tag_seed_idempotent(db_session) -> None:
    """Re-running init_schema (via re-creating engine) should NOT duplicate tags."""
    from app.data.db import init_schema, make_engine, make_session_factory
    engine = make_engine("sqlite:///:memory:")
    init_schema(engine)
    init_schema(engine)  # second call — must not error or duplicate
    factory = make_session_factory(engine)
    with factory() as s:
        tags = TagRepo(s).list_all()
    assert len(tags) == 10


# ============================================================ TagRepo CRUD


def test_tag_repo_create_get_update_delete(db_session) -> None:
    repo = TagRepo(db_session)
    n = len(repo.list_all())

    # Create
    custom = repo.create(Tag(name="custom-tag", color_hex="#ff00ff"))
    assert custom.id is not None
    assert len(repo.list_all()) == n + 1

    # Get + find
    assert repo.get(custom.id).name == "custom-tag"
    assert repo.find_by_name("custom-tag").id == custom.id
    assert repo.find_by_name("nonexistent") is None

    # Update
    custom.color_hex = "#00ff00"
    updated = repo.update(custom)
    assert updated.color_hex == "#00ff00"

    # Delete
    repo.delete(custom.id)
    assert repo.get(custom.id) is None


# ============================================================ Recipe ↔ tags


def test_recipe_create_with_tags(db_session) -> None:
    """Creating a recipe with tags persists the M2M association."""
    repo = TagRepo(db_session)
    veg = repo.find_by_name("végétarien")
    rapide = repo.find_by_name("rapide")
    assert veg is not None and rapide is not None

    ing = _ing(db_session)
    recipe = _recipe(db_session, "Salade", [(ing, 200.0)], tags=[veg, rapide])

    # Reload to verify persistence
    fresh = RecipeRepo(db_session).get(recipe.id)
    tag_names = sorted(t.name for t in fresh.tags)
    assert tag_names == ["rapide", "végétarien"]


def test_recipe_set_tags_replaces_atomically(db_session) -> None:
    """`set_tags` should replace the full set, not append."""
    repo = TagRepo(db_session)
    veg = repo.find_by_name("végétarien")
    rapide = repo.find_by_name("rapide")
    placard = repo.find_by_name("du placard")

    ing = _ing(db_session)
    recipe = _recipe(db_session, "Salade", [(ing, 200.0)], tags=[veg])
    rrepo = RecipeRepo(db_session)

    rrepo.set_tags(recipe.id, [rapide.id, placard.id])

    fresh = rrepo.get(recipe.id)
    tag_names = sorted(t.name for t in fresh.tags)
    assert tag_names == ["du placard", "rapide"]


def test_recipe_set_tags_empty_clears_all(db_session) -> None:
    repo = TagRepo(db_session)
    veg = repo.find_by_name("végétarien")
    ing = _ing(db_session)
    recipe = _recipe(db_session, "Salade", [(ing, 200.0)], tags=[veg])

    rrepo = RecipeRepo(db_session)
    rrepo.set_tags(recipe.id, [])

    fresh = rrepo.get(recipe.id)
    assert fresh.tags == []


def test_recipe_update_via_pydantic_persists_tags(db_session) -> None:
    """Updating a recipe via `RecipeRepo.update` (Pydantic model with new tags
    list) must sync the tag set."""
    trepo = TagRepo(db_session)
    veg = trepo.find_by_name("végétarien")
    rapide = trepo.find_by_name("rapide")
    ing = _ing(db_session)

    rrepo = RecipeRepo(db_session)
    recipe = _recipe(db_session, "Salade", [(ing, 200.0)], tags=[veg])

    # Mutate to a different tag set
    updated = recipe.model_copy(update={"tags": [rapide]})
    rrepo.update(updated)

    fresh = rrepo.get(recipe.id)
    assert [t.name for t in fresh.tags] == ["rapide"]


def test_recipe_delete_cascades_to_recipe_tag(db_session) -> None:
    """Deleting a recipe must drop its `recipe_tag` rows (FK ON DELETE CASCADE)."""
    trepo = TagRepo(db_session)
    veg = trepo.find_by_name("végétarien")
    ing = _ing(db_session)
    rrepo = RecipeRepo(db_session)
    recipe = _recipe(db_session, "Salade", [(ing, 200.0)], tags=[veg])

    rrepo.delete(recipe.id)

    # Tag itself still exists
    assert trepo.find_by_name("végétarien") is not None
    # And the recipe is gone
    assert rrepo.get(recipe.id) is None


def test_tag_delete_cascades_to_recipe_tag(db_session) -> None:
    """Deleting a tag drops its `recipe_tag` rows but leaves recipes intact."""
    trepo = TagRepo(db_session)
    custom = trepo.create(Tag(name="my-tag"))
    ing = _ing(db_session)
    rrepo = RecipeRepo(db_session)
    recipe = _recipe(db_session, "Salade", [(ing, 200.0)], tags=[custom])

    trepo.delete(custom.id)

    fresh = rrepo.get(recipe.id)
    assert fresh is not None
    assert fresh.tags == []  # association removed


# ============================================================ Filter list_all by tags


def test_list_all_filter_by_tag_or_semantics(db_session) -> None:
    """The filter is OR : a recipe is shown if it has AT LEAST ONE matching tag."""
    trepo = TagRepo(db_session)
    veg = trepo.find_by_name("végétarien")
    rapide = trepo.find_by_name("rapide")
    dessert = trepo.find_by_name("dessert")
    ing = _ing(db_session)

    a = _recipe(db_session, "Salade veg", [(ing, 100.0)], tags=[veg])
    b = _recipe(db_session, "Pasta rapide", [(ing, 100.0)], tags=[rapide])
    c = _recipe(db_session, "Tarte dessert", [(ing, 100.0)], tags=[dessert])
    d = _recipe(db_session, "Sans tag", [(ing, 100.0)], tags=[])

    rrepo = RecipeRepo(db_session)
    # Filter on veg + rapide — must return A and B, not C nor D
    filtered = rrepo.list_all(tag_ids=[veg.id, rapide.id])
    names = sorted(r.name for r in filtered)
    assert names == ["Pasta rapide", "Salade veg"]


def test_list_all_no_filter_returns_all(db_session) -> None:
    trepo = TagRepo(db_session)
    veg = trepo.find_by_name("végétarien")
    ing = _ing(db_session)
    _recipe(db_session, "A", [(ing, 100.0)], tags=[veg])
    _recipe(db_session, "B", [(ing, 100.0)], tags=[])

    rrepo = RecipeRepo(db_session)
    all_recipes = rrepo.list_all()
    assert len(all_recipes) == 2

    empty_filter = rrepo.list_all(tag_ids=[])
    assert len(empty_filter) == 2  # empty list = no filter


def test_list_all_filter_dedupes_recipes_with_multiple_matches(db_session) -> None:
    """A recipe carrying both 'veg' and 'rapide' should appear ONCE in
    a filter [veg, rapide], not twice (DISTINCT)."""
    trepo = TagRepo(db_session)
    veg = trepo.find_by_name("végétarien")
    rapide = trepo.find_by_name("rapide")
    ing = _ing(db_session)
    _recipe(db_session, "Salade", [(ing, 100.0)], tags=[veg, rapide])

    filtered = RecipeRepo(db_session).list_all(tag_ids=[veg.id, rapide.id])
    assert len(filtered) == 1


# ============================================================ find_by_ingredient_ids (F5)


def test_find_by_ingredients_full_match(db_session) -> None:
    """A recipe whose ingredients are entirely in the provided list scores 1.0."""
    a = _ing(db_session, "A")
    b = _ing(db_session, "B")
    c = _ing(db_session, "C")
    _recipe(db_session, "AB", [(a, 100.0), (b, 100.0)])
    _recipe(db_session, "ABC", [(a, 100.0), (b, 100.0), (c, 100.0)])

    matches = RecipeRepo(db_session).find_by_ingredient_ids(
        [a.id, b.id, c.id], min_match=0.5
    )

    by_name = {m[0].name: (m[1], m[2], m[3]) for m in matches}
    assert by_name["AB"] == (1.0, 2, 2)    # 2/2
    assert by_name["ABC"] == (1.0, 3, 3)   # 3/3


def test_find_by_ingredients_partial_match(db_session) -> None:
    """A recipe with 2/4 ingredients available scores 0.5."""
    a = _ing(db_session, "A")
    b = _ing(db_session, "B")
    c = _ing(db_session, "C")
    d = _ing(db_session, "D")
    _recipe(db_session, "ABCD", [(a, 100.0), (b, 100.0), (c, 100.0), (d, 100.0)])

    matches = RecipeRepo(db_session).find_by_ingredient_ids([a.id, b.id], min_match=0.5)

    assert len(matches) == 1
    recipe, score, match_count, total = matches[0]
    assert recipe.name == "ABCD"
    assert score == 0.5
    assert match_count == 2
    assert total == 4


def test_find_by_ingredients_filters_below_threshold(db_session) -> None:
    a = _ing(db_session, "A")
    b = _ing(db_session, "B")
    c = _ing(db_session, "C")
    d = _ing(db_session, "D")
    e = _ing(db_session, "E")
    _recipe(db_session, "5-ing", [(a, 100.0), (b, 100.0), (c, 100.0), (d, 100.0), (e, 100.0)])

    # Just A available — score 1/5 = 0.2
    matches_high = RecipeRepo(db_session).find_by_ingredient_ids([a.id], min_match=0.5)
    matches_low = RecipeRepo(db_session).find_by_ingredient_ids([a.id], min_match=0.1)

    assert len(matches_high) == 0
    assert len(matches_low) == 1
    assert matches_low[0][1] == 0.2


def test_find_by_ingredients_sorts_by_score_desc(db_session) -> None:
    a = _ing(db_session, "A")
    b = _ing(db_session, "B")
    c = _ing(db_session, "C")
    _recipe(db_session, "Two", [(a, 100.0), (b, 100.0)])      # 2/2 = 1.0
    _recipe(db_session, "Four", [(a, 100.0), (b, 100.0),
                                  (c, 100.0), (_ing(db_session, "D"), 100.0)])  # 3/4 = 0.75
    _recipe(db_session, "Three", [(a, 100.0), (b, 100.0), (c, 100.0)])  # 3/3 = 1.0

    matches = RecipeRepo(db_session).find_by_ingredient_ids(
        [a.id, b.id, c.id], min_match=0.5
    )

    scores = [m[1] for m in matches]
    assert scores == sorted(scores, reverse=True)


def test_find_by_ingredients_empty_input_returns_empty(db_session) -> None:
    a = _ing(db_session, "A")
    _recipe(db_session, "X", [(a, 100.0)])
    assert RecipeRepo(db_session).find_by_ingredient_ids([], min_match=0.5) == []


def test_find_by_ingredients_skips_recipes_without_ingredients(db_session) -> None:
    """A recipe with no lines (rare edge case) must be skipped, not score 0/0."""
    a = _ing(db_session, "A")
    _recipe(db_session, "Empty", [])  # no lines
    _recipe(db_session, "Real", [(a, 100.0)])

    matches = RecipeRepo(db_session).find_by_ingredient_ids([a.id], min_match=0.5)

    names = [m[0].name for m in matches]
    assert "Empty" not in names
    assert "Real" in names


def test_find_by_ingredients_irrelevant_ids_ignored(db_session) -> None:
    """Providing ingredient IDs that aren't in any recipe → just don't bump scores."""
    a = _ing(db_session, "A")
    _recipe(db_session, "X", [(a, 100.0)])

    # 99999 is a nonexistent id
    matches = RecipeRepo(db_session).find_by_ingredient_ids(
        [a.id, 99999], min_match=0.5
    )

    assert len(matches) == 1
    assert matches[0][1] == 1.0  # X has 1/1 ingredients available
