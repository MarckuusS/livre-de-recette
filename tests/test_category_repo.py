"""Tests du CategoryRepo (Phase 5).

On vérifie l'API CRUD + cascade-update au renommage + cascade-clear au delete.
"""

from __future__ import annotations

import pytest

from app.data.repositories import CategoryRepo, IngredientRepo
from app.domain.models import Ingredient, Source


def test_add_l1_creates_root(db_session) -> None:
    repo = CategoryRepo(db_session)
    n = repo.add("Légumes", parent_id=None)
    db_session.commit()

    assert n.id > 0
    assert n.name == "Légumes"
    assert n.parent_id is None
    assert n.ordinal >= 0


def test_add_l2_with_parent(db_session) -> None:
    repo = CategoryRepo(db_session)
    l1 = repo.add("Légumes")
    l2 = repo.add("Verts", parent_id=l1.id)
    db_session.commit()

    assert l2.parent_id == l1.id


def test_add_duplicate_at_same_level_raises(db_session) -> None:
    repo = CategoryRepo(db_session)
    repo.add("Légumes")
    db_session.commit()
    with pytest.raises(ValueError, match="existe déjà"):
        repo.add("Légumes")


def test_add_duplicate_under_different_parents_ok(db_session) -> None:
    """'Verts' peut exister sous 'Légumes' ET sous 'Salades' simultanément."""
    repo = CategoryRepo(db_session)
    l1a = repo.add("Légumes")
    l1b = repo.add("Salades")
    db_session.commit()
    repo.add("Verts", parent_id=l1a.id)
    repo.add("Verts", parent_id=l1b.id)
    db_session.commit()
    assert len(repo.list_l2(l1a.id)) == 1
    assert len(repo.list_l2(l1b.id)) == 1


def test_tree_structure(db_session) -> None:
    repo = CategoryRepo(db_session)
    l1a = repo.add("Légumes")
    l1b = repo.add("Viandes")
    repo.add("Verts", parent_id=l1a.id)
    repo.add("Racines", parent_id=l1a.id)
    db_session.commit()

    tree = repo.tree()
    assert len(tree) == 2
    # Trié par ordinal/name : Légumes (ordinal 0) puis Viandes (ordinal 1)
    by_name = {n.name: n for n in tree}
    assert "Légumes" in by_name
    assert "Viandes" in by_name
    assert len(by_name["Légumes"].children) == 2
    assert len(by_name["Viandes"].children) == 0


def test_rename_cascades_to_ingredients_l1(db_session) -> None:
    """Au renommage d'une L1, les ingrédients qui pointaient dessus sont
    mis à jour automatiquement."""
    cat_repo = CategoryRepo(db_session)
    ing_repo = IngredientRepo(db_session)
    l1 = cat_repo.add("Légumes")
    db_session.commit()

    ing = ing_repo.create(Ingredient(
        name="Tomate", source=Source.MANUAL, category_l1="Légumes",
    ))
    db_session.commit()

    cat_repo.rename(l1.id, "Fruits & légumes")
    db_session.commit()

    refreshed = ing_repo.get(ing.id)
    assert refreshed.category_l1 == "Fruits & légumes"


def test_rename_cascades_to_ingredients_l2(db_session) -> None:
    cat_repo = CategoryRepo(db_session)
    ing_repo = IngredientRepo(db_session)
    l1 = cat_repo.add("Légumes")
    l2 = cat_repo.add("Verts", parent_id=l1.id)
    db_session.commit()

    ing = ing_repo.create(Ingredient(
        name="Épinard", source=Source.MANUAL,
        category_l1="Légumes", category_l2="Verts",
    ))
    db_session.commit()

    cat_repo.rename(l2.id, "Feuillus")
    db_session.commit()

    refreshed = ing_repo.get(ing.id)
    assert refreshed.category_l1 == "Légumes"   # inchangé
    assert refreshed.category_l2 == "Feuillus"   # renommé


def test_rename_to_existing_sibling_raises(db_session) -> None:
    repo = CategoryRepo(db_session)
    a = repo.add("Légumes")
    repo.add("Viandes")
    db_session.commit()
    with pytest.raises(ValueError, match="existe déjà"):
        repo.rename(a.id, "Viandes")


def test_delete_l1_clears_ingredient_categories(db_session) -> None:
    """Supprimer une L1 efface category_l1 ET category_l2 des ingrédients."""
    cat_repo = CategoryRepo(db_session)
    ing_repo = IngredientRepo(db_session)
    l1 = cat_repo.add("Légumes")
    cat_repo.add("Verts", parent_id=l1.id)
    db_session.commit()

    ing = ing_repo.create(Ingredient(
        name="Brocoli", source=Source.MANUAL,
        category_l1="Légumes", category_l2="Verts",
    ))
    db_session.commit()

    cat_repo.delete(l1.id)
    db_session.commit()

    refreshed = ing_repo.get(ing.id)
    assert refreshed.category_l1 is None
    assert refreshed.category_l2 is None


def test_delete_l2_only_clears_l2(db_session) -> None:
    cat_repo = CategoryRepo(db_session)
    ing_repo = IngredientRepo(db_session)
    l1 = cat_repo.add("Légumes")
    l2 = cat_repo.add("Verts", parent_id=l1.id)
    db_session.commit()

    ing = ing_repo.create(Ingredient(
        name="Brocoli", source=Source.MANUAL,
        category_l1="Légumes", category_l2="Verts",
    ))
    db_session.commit()

    cat_repo.delete(l2.id)
    db_session.commit()

    refreshed = ing_repo.get(ing.id)
    assert refreshed.category_l1 == "Légumes"   # inchangé
    assert refreshed.category_l2 is None        # cleared


def test_delete_l1_cascades_to_l2(db_session) -> None:
    """ON DELETE CASCADE supprime les enfants L2."""
    repo = CategoryRepo(db_session)
    l1 = repo.add("Légumes")
    repo.add("Verts", parent_id=l1.id)
    db_session.commit()
    assert len(repo.list_l2(l1.id)) == 1

    repo.delete(l1.id)
    db_session.commit()
    assert repo.list_l1() == []


def test_add_empty_name_raises(db_session) -> None:
    repo = CategoryRepo(db_session)
    with pytest.raises(ValueError, match="vide"):
        repo.add("")
    with pytest.raises(ValueError, match="vide"):
        repo.add("   ")


def test_seed_categories_from_existing_picks_distinct(db_session) -> None:
    """Au boot (init_schema), `_seed_categories_from_existing` pré-remplit
    `category_definition` depuis les catégories distinctes des ingrédients."""
    ing_repo = IngredientRepo(db_session)
    ing_repo.create(Ingredient(name="A", source=Source.MANUAL, category_l1="X"))
    ing_repo.create(Ingredient(name="B", source=Source.MANUAL, category_l1="X", category_l2="Y"))
    ing_repo.create(Ingredient(name="C", source=Source.MANUAL, category_l1="Z"))
    db_session.commit()

    # Re-call la fonction seed (idempotent)
    from app.data.db import _seed_categories_from_existing
    from sqlalchemy import text as sql_text
    _seed_categories_from_existing(db_session.connection())
    db_session.commit()

    repo = CategoryRepo(db_session)
    l1_names = {n.name for n in repo.list_l1()}
    assert "X" in l1_names
    assert "Z" in l1_names
    # Trouve la L1 "X" et vérifie qu'elle a "Y" en enfant
    x_node = next(n for n in repo.list_l1() if n.name == "X")
    l2_names = {n.name for n in repo.list_l2(x_node.id)}
    assert "Y" in l2_names
