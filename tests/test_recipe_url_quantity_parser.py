"""Tests for the French quantity parser used during recipe URL import.

These cover the corpus of typical strings emitted by recipe-scrapers when
it scrapes Marmiton/750g/Hervé Cuisine etc., plus a few edge cases."""

from __future__ import annotations

from app.services.recipe_url_importer.quantity_parser import parse_french_quantity

# ============================================================ Standard cases


def test_grams_with_de() -> None:
    assert parse_french_quantity("200 g de tomates cerises") == (200.0, "g", "tomates cerises")


def test_grams_with_de_l_apostrophe() -> None:
    assert parse_french_quantity("30 g d'huile d'olive") == (30.0, "g", "huile d'olive")


def test_grams_alias_gr() -> None:
    assert parse_french_quantity("500 gr de farine") == (500.0, "g", "farine")


def test_kilograms() -> None:
    assert parse_french_quantity("1 kg de pommes de terre") == (1.0, "kg", "pommes de terre")


def test_milliliters() -> None:
    assert parse_french_quantity("300 ml de lait") == (300.0, "ml", "lait")


def test_centiliters() -> None:
    assert parse_french_quantity("25 cl de vin blanc") == (25.0, "cl", "vin blanc")


def test_liters_short() -> None:
    assert parse_french_quantity("1 l d'eau") == (1.0, "L", "eau")


def test_cuillere_a_soupe_full() -> None:
    assert parse_french_quantity("1 c. à soupe d'huile d'olive") == (1.0, "c_soupe", "huile d'olive")


def test_cuillere_a_soupe_abbrev_cas() -> None:
    assert parse_french_quantity("2 cas de sucre") == (2.0, "c_soupe", "sucre")


def test_cuillere_a_cafe_full() -> None:
    assert parse_french_quantity("1,5 cuillères à café de sel") == (1.5, "c_cafe", "sel")


def test_cuillere_a_cafe_abbrev() -> None:
    assert parse_french_quantity("3 cc de cumin") == (3.0, "c_cafe", "cumin")


def test_pincee() -> None:
    assert parse_french_quantity("1 pincée de poivre") == (1.0, "pincee", "poivre")


def test_tasse() -> None:
    assert parse_french_quantity("2 tasses de riz") == (2.0, "tasse", "riz")


# ============================================================ Numbers : decimals + fractions


def test_decimal_french_comma() -> None:
    qty, _, _ = parse_french_quantity("1,5 kg de carottes")
    assert qty == 1.5


def test_decimal_english_dot() -> None:
    qty, _, _ = parse_french_quantity("0.5 kg de farine")
    assert qty == 0.5


def test_simple_fraction() -> None:
    assert parse_french_quantity("1/2 oignon") == (0.5, None, "oignon")


def test_fraction_with_unit() -> None:
    qty, unit, name = parse_french_quantity("1/4 c. à café de muscade")
    assert qty == 0.25
    assert unit == "c_cafe"
    assert name == "muscade"


# ============================================================ No quantity / no unit cases


def test_no_quantity_at_all() -> None:
    assert parse_french_quantity("Sel, poivre") == (None, None, "Sel, poivre")


def test_quantity_without_unit_is_piece_count() -> None:
    """'1 oignon' / '3 carottes' : qty captured, unit is None — the VM/UI
    will decide whether to interpret as pieces (if piece_weight_g defined)
    or grams."""
    assert parse_french_quantity("1 oignon") == (1.0, None, "oignon")
    assert parse_french_quantity("3 carottes") == (3.0, None, "carottes")


def test_empty_input() -> None:
    assert parse_french_quantity("") == (None, None, "")


def test_whitespace_only() -> None:
    assert parse_french_quantity("   ") == (None, None, "")


# ============================================================ Edge cases


def test_unit_followed_by_word_no_space() -> None:
    """Make sure '50ml' (no space) is parsed as qty=50, unit=ml."""
    qty, unit, name = parse_french_quantity("50ml de crème")
    assert qty == 50.0
    assert unit == "ml"
    assert name == "crème"


def test_quantity_with_extra_whitespace() -> None:
    assert parse_french_quantity("  200  g   de  tomates  ") == (200.0, "g", "tomates")


def test_does_not_match_unit_inside_word() -> None:
    """A single 'g' should not match the 'g' unit when followed by a letter
    (e.g. "1 gousse d'ail" must not be parsed as qty=1, unit=g)."""
    qty, unit, name = parse_french_quantity("1 gousse d'ail")
    assert qty == 1.0
    assert unit is None
    assert "ail" in name


def test_uppercase_unit() -> None:
    qty, unit, _ = parse_french_quantity("100 G de chocolat")
    assert qty == 100.0
    assert unit == "g"


# ============================================================ HelloFresh-style prefixes


def test_piece_s_prefix_stripped() -> None:
    """HelloFresh '1 pièce(s) Oignon' → qty=1, unit=None, name='Oignon'."""
    qty, unit, name = parse_french_quantity("1 pièce(s) Oignon")
    assert qty == 1.0
    assert unit is None
    assert name == "Oignon"


def test_paquet_s_prefix_stripped() -> None:
    qty, unit, name = parse_french_quantity("1 paquet(s) Crème liquide")
    assert qty == 1.0
    assert unit is None
    assert name == "Crème liquide"


def test_sachet_s_prefix_stripped() -> None:
    qty, unit, name = parse_french_quantity("1 sachet(s) Épinards")
    assert qty == 1.0
    assert unit is None
    assert name == "Épinards"


def test_piece_plural_prefix_stripped() -> None:
    qty, unit, name = parse_french_quantity("2 pièce(s) Cuisse de poulet")
    assert qty == 2.0
    assert unit is None
    assert name == "Cuisse de poulet"


def test_pieces_no_parens_stripped() -> None:
    """'2 pieces' (without parens) also stripped."""
    qty, unit, name = parse_french_quantity("2 pieces de tomate")
    assert qty == 2.0
    assert unit is None
    assert name == "tomate"


def test_gousse_kept_as_name() -> None:
    """'1 gousse d'ail' n'a PAS de '(s)' → on garde 'gousse d'ail' comme
    nom (c'est un ingrédient nommé chez Marmiton/750g)."""
    qty, unit, name = parse_french_quantity("1 gousse d'ail")
    assert qty == 1.0
    assert unit is None
    assert "gousse" in name.lower()
    assert "ail" in name


def test_piece_prefix_alone_keeps_original() -> None:
    """'1 pièce(s)' tout seul (sans nom) → on garde le texte original."""
    qty, unit, name = parse_french_quantity("1 pièce(s)")
    assert qty == 1.0
    assert unit is None
    # Le nom retombe sur le texte original (pas vide)
    assert name == "1 pièce(s)"
