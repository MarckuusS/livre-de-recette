"""Tests de l'adapter JSON Lidl → ParsedReceipt (Plan v3, Phase 5).

L'adapter est pure data → data : pas de réseau, pas de DB. On peut donc
tester avec des fixtures JSON qu'on tient en main.

Le format JSON utilisé reproduit la structure observée de la lib
`lidl-plus` (PyPI) sur Lidl DE/AT/UK. Le support Lidl FR est à valider
en grandeur nature avec un compte réel — si la structure diffère, on
ajustera l'adapter ici.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from app.services.receipt_parser.lidl_api_adapter import adapt_lidl_json


# ============================================================ Sample minimal


def _sample_minimal() -> dict:
    return {
        "id": "0888338655391103020526",
        "date": "2026-05-02T16:09:13",
        "store": {"id": "3386", "name": "AHUY Vigier"},
        "currency": "EUR",
        "totalAmount": "12.50",
        "items": [
            {
                "id": "0082231",
                "name": "Concombre",
                "quantity": "2",
                "currentUnitPrice": "1.29",
                "currentTotalPrice": "2.58",
                "taxGroup": "5.5",
            },
            {
                "id": "0123456",
                "name": "Yaourt nature x4",
                "quantity": "1",
                "currentUnitPrice": "1.85",
                "currentTotalPrice": "1.85",
                "taxGroup": "5.5",
            },
            {
                "id": "0345678",
                "name": "Eponge cuisine",
                "quantity": "1",
                "currentUnitPrice": "2.49",
                "currentTotalPrice": "2.49",
                "taxGroup": "20.0",
            },
        ],
    }


def test_adapter_basic_metadata() -> None:
    parsed = adapt_lidl_json(_sample_minimal())
    assert parsed.store == "lidl"
    assert parsed.ticket_id == "0888338655391103020526"
    assert parsed.date == datetime(2026, 5, 2, 16, 9, 13)
    assert parsed.total_eur == Decimal("12.50")
    assert len(parsed.lines) == 3


def test_adapter_line_uses_art_id_as_store_key() -> None:
    """L'art_id Lidl (`item.id`) doit servir de store_key — c'est lui qui
    sert au matcher pour la résolution déterministe via Source.LIDL."""
    parsed = adapt_lidl_json(_sample_minimal())
    assert parsed.lines[0].store_key == "0082231"
    assert parsed.lines[0].raw_name == "Concombre"
    assert parsed.lines[0].quantity == 2
    assert parsed.lines[0].unit_price == Decimal("1.29")
    assert parsed.lines[0].total_price == Decimal("2.58")


def test_adapter_maps_tax_to_vat_code() -> None:
    """5.5% → A (alimentaire), 20% → B (non-alim)."""
    parsed = adapt_lidl_json(_sample_minimal())
    assert parsed.lines[0].vat_code == "A"   # Concombre 5.5
    assert parsed.lines[2].vat_code == "B"   # Eponge 20.0
    assert parsed.lines[2].is_likely_food is False


def test_adapter_handles_missing_fields_gracefully() -> None:
    """JSON appauvri (champs manquants) ne doit pas planter."""
    parsed = adapt_lidl_json({"items": [{"name": "Test sans id"}]})
    assert len(parsed.lines) == 1
    assert parsed.lines[0].raw_name == "Test sans id"
    assert parsed.lines[0].store_key == "test sans id"
    assert parsed.lines[0].quantity == 1
    assert parsed.lines[0].unit_price is None


def test_adapter_skips_empty_items() -> None:
    """Une ligne sans nom ni id est sautée."""
    parsed = adapt_lidl_json({
        "id": "T1",
        "items": [
            {"name": "", "id": ""},
            {"name": "Bon item", "id": "001"},
            None,   # ne devrait pas planter
            "string-pas-dict",
        ],
    })
    assert len(parsed.lines) == 1
    assert parsed.lines[0].raw_name == "Bon item"


def test_adapter_computes_total_from_unit_when_missing() -> None:
    """Si `currentTotalPrice` est absent, on déduit unit × qty."""
    parsed = adapt_lidl_json({
        "items": [
            {"id": "X", "name": "X", "currentUnitPrice": "2.50", "quantity": "3"},
        ],
    })
    assert parsed.lines[0].total_price == Decimal("7.50")


def test_adapter_computes_unit_from_total_when_missing() -> None:
    """Si `currentUnitPrice` est absent, on déduit total / qty."""
    parsed = adapt_lidl_json({
        "items": [
            {"id": "X", "name": "X", "currentTotalPrice": "9.00", "quantity": "3"},
        ],
    })
    assert parsed.lines[0].unit_price == Decimal("3")


def test_adapter_handles_weight_quantity_as_int_round() -> None:
    """Vrac au poids : `quantity='0.420'` (kg) → cast à 0 → forcé à 1.
    Le total_price reste exact (somme du ticket).

    C'est une approximation honnête : pour le vrac on perd la granularité
    mais le suivi de prix par 100 g/€ utilise `ingredient.price_quantity_g`
    après import si l'utilisateur veut être précis."""
    parsed = adapt_lidl_json({
        "items": [
            {"id": "X", "name": "Tomates vrac", "quantity": "0.420",
             "currentUnitPrice": "4.50", "currentTotalPrice": "1.89"},
        ],
    })
    assert parsed.lines[0].quantity >= 1
    assert parsed.lines[0].total_price == Decimal("1.89")


def test_adapter_invalid_date_returns_none() -> None:
    parsed = adapt_lidl_json({"id": "T", "date": "pas-une-date", "items": []})
    assert parsed.date is None
    assert parsed.ticket_id == "T"


def test_adapter_european_decimal_comma() -> None:
    """Si Lidl envoie '1,29' au lieu de '1.29' (locale FR), on parse OK."""
    parsed = adapt_lidl_json({
        "items": [{"id": "X", "name": "Y", "currentUnitPrice": "1,29", "quantity": "1"}],
    })
    assert parsed.lines[0].unit_price == Decimal("1.29")


def test_adapter_empty_ticket() -> None:
    """Ticket vide (aucun item) — l'adapter ne plante pas, ParsedReceipt.lines == []."""
    parsed = adapt_lidl_json({"id": "T", "items": []})
    assert parsed.lines == []
    assert parsed.ticket_id == "T"


def test_adapter_no_items_field() -> None:
    """`items` carrément absent — fallback sur liste vide."""
    parsed = adapt_lidl_json({"id": "T"})
    assert parsed.lines == []
