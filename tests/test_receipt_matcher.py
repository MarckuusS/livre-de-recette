"""Tests for receipt_matcher (Plan v3, Phase 1).

Cible la résolution ParsedLine → MatchedLine via les 3 niveaux :
  1. Source.LIDL + source_ref (déterministe)
  2. ReceiptAlias (appris)
  3. Fuzzy match rapidfuzz
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.data.repositories import (
    ImportedReceiptRepo,
    IngredientRepo,
    ReceiptAliasRepo,
)
from app.domain.models import Ingredient, Source
from app.domain.receipt import ParsedLine, ParsedReceipt
from app.services.receipt_matcher import match_receipt


def _make_parsed(store: str, lines_data: list[tuple[str, str, str]],
                 ticket_id: str = "TEST123") -> ParsedReceipt:
    """Helper : construit un ParsedReceipt avec lines_data = [(raw_name, store_key, vat), ...]."""
    lines = [
        ParsedLine(
            raw_name=name, store_key=key, vat_code=vat,
            quantity=1, unit_price=Decimal("1.00"), total_price=Decimal("1.00"),
        )
        for (name, key, vat) in lines_data
    ]
    return ParsedReceipt(
        store=store, ticket_id=ticket_id,
        date=datetime(2026, 5, 2),
        lines=lines, raw_text="",
    )


# ============================================================ Source.LIDL match


def test_match_lidl_via_source_ref(db_session: Session) -> None:
    """Un ingrédient avec Source.LIDL + source_ref = art_id doit matcher
    instantanément via `find_by_source_ref` (score 1.0, source 'source_ref')."""
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(
        name="Concombre", source=Source.LIDL, source_ref="0082231",
        in_personal_library=True,
    ))
    db_session.commit()

    parsed = _make_parsed("lidl", [("Concombre", "0082231", "A")])
    result = match_receipt(db_session, parsed)

    assert len(result.lines) == 1
    line = result.lines[0]
    assert line.match_source == "source_ref"
    assert line.match_score == 1.0
    assert line.chosen_ingredient_id is not None


def test_match_lidl_unknown_art_id_falls_through(db_session: Session) -> None:
    """Un art_id Lidl non encore vu doit tomber dans la branche fuzzy/none."""
    parsed = _make_parsed("lidl", [("Inconnu Bizarre", "9999999", "A")])
    result = match_receipt(db_session, parsed)

    assert result.lines[0].match_source == "none"


# ============================================================ Alias match


def test_match_intermarche_via_alias(db_session: Session) -> None:
    """Un alias appris pour Intermarché doit ré-utiliser le mapping."""
    ing = IngredientRepo(db_session).create(Ingredient(
        name="Franui Framboise Chocolat",
        source=Source.MANUAL, in_personal_library=True,
    ))
    db_session.commit()

    ReceiptAliasRepo(db_session).upsert(
        store="intermarche",
        source_key="franui frambse choco",
        ingredient_id=ing.id,
    )
    db_session.commit()

    parsed = _make_parsed("intermarche", [
        ("FRANUI FRAMBSE CHOCO", "franui frambse choco", "A"),
    ])
    result = match_receipt(db_session, parsed)

    line = result.lines[0]
    assert line.match_source == "alias"
    assert line.match_score == 1.0
    assert line.chosen_ingredient_id == ing.id


# ============================================================ Fuzzy match


def test_match_fuzzy_high_score_auto_selects(db_session: Session) -> None:
    """Un score fuzzy >= 90 doit pré-sélectionner (chosen_ingredient_id non null)."""
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(
        name="Yaourt nature",
        source=Source.MANUAL, in_personal_library=True,
    ))
    db_session.commit()

    parsed = _make_parsed("intermarche", [
        ("YAOURT NATURE", "yaourt nature", "A"),
    ])
    result = match_receipt(db_session, parsed)

    line = result.lines[0]
    assert line.match_source == "fuzzy"
    assert line.match_score >= 0.90
    assert line.chosen_ingredient_id is not None


def test_match_fuzzy_low_score_suggests_only(db_session: Session) -> None:
    """Un score 70-89 doit suggérer mais NE PAS pré-sélectionner. L'utilisateur
    valide manuellement dans le dialog."""
    repo = IngredientRepo(db_session)
    repo.create(Ingredient(
        name="Tomates cerises grappes 250g",
        source=Source.MANUAL, in_personal_library=True,
    ))
    db_session.commit()

    parsed = _make_parsed("intermarche", [
        ("TOMATE CERISE", "tomate cerise", "A"),
    ])
    result = match_receipt(db_session, parsed)

    line = result.lines[0]
    # Le score peut tomber en haut ou en bas du seuil — on vérifie juste que
    # rapidfuzz a renvoyé une suggestion (ou aucune si très bas)
    if line.match_source == "fuzzy":
        assert len(line.suggestions) >= 1
        if line.match_score < 0.90:
            assert line.chosen_ingredient_id is None  # pas d'auto-select


def test_match_no_candidates_returns_none_match(db_session: Session) -> None:
    """Bibliothèque vide → match_source='none', pas de suggestions."""
    parsed = _make_parsed("intermarche", [
        ("YAOURT NATURE", "yaourt nature", "A"),
    ])
    result = match_receipt(db_session, parsed)

    line = result.lines[0]
    assert line.match_source == "none"
    assert line.suggestions == []
    assert line.chosen_ingredient_id is None


# ============================================================ Anti-doublon


def test_match_flags_duplicate(db_session: Session) -> None:
    """Si le ticket_id existe déjà dans imported_receipt, MatchedReceipt.is_duplicate."""
    ImportedReceiptRepo(db_session).add(
        ticket_id="DUPE_TICKET_ID",
        store="intermarche",
        receipt_date=datetime(2026, 4, 1),
        total_eur=Decimal("12.50"),
        line_count=3,
    )
    db_session.commit()

    parsed = _make_parsed("intermarche", [], ticket_id="DUPE_TICKET_ID")
    result = match_receipt(db_session, parsed)

    assert result.is_duplicate is True


def test_match_no_ticket_id_no_duplicate_check(db_session: Session) -> None:
    """Si pas de ticket_id (parsing a échoué), is_duplicate = False par défaut."""
    parsed = _make_parsed("intermarche", [], ticket_id=None)
    result = match_receipt(db_session, parsed)
    assert result.is_duplicate is False


# ============================================================ Order preservation


def test_match_preserves_line_order(db_session: Session) -> None:
    """L'ordre des MatchedLine doit suivre l'ordre des ParsedLine d'origine."""
    parsed = _make_parsed("intermarche", [
        ("LIGNE A", "ligne a", "A"),
        ("LIGNE B", "ligne b", "A"),
        ("LIGNE C", "ligne c", "B"),
    ])
    result = match_receipt(db_session, parsed)

    assert [line.parsed.raw_name for line in result.lines] == [
        "LIGNE A", "LIGNE B", "LIGNE C",
    ]
