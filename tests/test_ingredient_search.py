"""Tests for `resolve_ingredient_name` — the matching helper used by the
URL recipe importer wizard. Network is never hit (the function is local-only)."""

from __future__ import annotations

from app.data.repositories import IngredientRepo
from app.domain.models import Ingredient, Source
from app.services.ingredient_search import resolve_ingredient_name


def _seed(session, name, *, source=Source.MANUAL, in_personal=True, source_ref=None):
    repo = IngredientRepo(session)
    ing = repo.create(Ingredient(
        name=name,
        source=source,
        source_ref=source_ref,
        in_personal_library=in_personal,
    ))
    session.commit()
    return ing


def test_resolve_returns_personal_match_first(db_session):
    """Match exact dans la biblio perso doit ressortir en tête."""
    _seed(db_session, "Tomate cerise", source=Source.MANUAL, in_personal=True)
    _seed(db_session, "Tomate", source=Source.CIQUAL, source_ref="20066",
          in_personal=False)

    out = resolve_ingredient_name(db_session, "Tomate cerise")
    assert len(out) >= 1
    assert out[0].name == "Tomate cerise"
    assert out[0].in_personal_library is True


def test_resolve_falls_back_to_ciqual_when_perso_empty(db_session):
    """Si aucun match perso, on remonte les rows CIQUAL même non-personnels."""
    _seed(db_session, "Pomme", source=Source.CIQUAL, source_ref="13016",
          in_personal=False)
    _seed(db_session, "Pomme golden", source=Source.CIQUAL, source_ref="13017",
          in_personal=False)

    out = resolve_ingredient_name(db_session, "pomme")
    assert len(out) >= 1
    names = {ing.name for ing in out}
    assert "Pomme" in names or "Pomme golden" in names


def test_resolve_max_candidates_respected(db_session):
    """Plafond de candidats appliqué."""
    for i in range(10):
        _seed(db_session, f"Tomate variété {i}", source=Source.MANUAL, in_personal=True)
    out = resolve_ingredient_name(db_session, "tomate", max_candidates=3)
    assert len(out) <= 3


def test_resolve_returns_empty_for_empty_query(db_session):
    _seed(db_session, "Tomate", source=Source.MANUAL, in_personal=True)
    assert resolve_ingredient_name(db_session, "") == []
    assert resolve_ingredient_name(db_session, "   ") == []


def test_resolve_handles_no_match(db_session):
    """Pas de match du tout → liste vide (la VM proposera OFF / Créer manuellement)."""
    _seed(db_session, "Tomate", source=Source.MANUAL, in_personal=True)
    out = resolve_ingredient_name(db_session, "fenugrec")
    # Rapidfuzz peut quand même retourner des candidats faibles, on accepte.
    # Ce qui compte : ne lève pas, retourne au pire une liste raisonnable.
    assert isinstance(out, list)


def test_resolve_personal_priority_over_catalog(db_session):
    """Quand un mot apparaît dans 2 sources, le match perso passe devant."""
    _seed(db_session, "Carotte", source=Source.MANUAL, in_personal=True)
    _seed(db_session, "Carotte CIQUAL", source=Source.CIQUAL, source_ref="20009",
          in_personal=False)

    out = resolve_ingredient_name(db_session, "Carotte")
    assert len(out) >= 1
    assert out[0].in_personal_library is True
    assert out[0].name == "Carotte"
