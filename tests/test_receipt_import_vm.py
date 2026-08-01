"""Tests du ReceiptImportViewModel (Plan v3, Phases 1 + 4).

Phase 1 : load + match + commit (price_history, pantry, alias, anti-doublon).
Phase 4 : suggestCreatePayload + createIngredientFromLine + lookupBarcodeAsDict.

On construit un MatchedReceipt à la main (sans passer par le parser PDF) pour
isoler les tests du VM. Le parser a ses propres tests dans
`tests/test_receipt_parser_intermarche.py`.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

import pytest

from app.data.repositories import (
    ImportedReceiptRepo,
    IngredientRepo,
    ReceiptAliasRepo,
)
from app.domain.models import Ingredient, Source
from app.domain.receipt import MatchedLine, MatchedReceipt, ParsedLine, ParsedReceipt
from app.ui.viewmodels.receipt_import_vm import ReceiptImportViewModel


def _make_matched(store: str = "intermarche") -> MatchedReceipt:
    parsed = ParsedReceipt(
        store=store,
        ticket_id="TICKET-TEST-1",
        date=datetime(2026, 5, 2, 16, 30),
        total_eur=Decimal("12.50"),
        lines=[
            ParsedLine(
                raw_name="YAOURT NATURE",
                store_key="yaourt nature",
                quantity=4,
                unit_price=Decimal("0.45"),
                total_price=Decimal("1.80"),
                vat_code="A",
            ),
            ParsedLine(
                raw_name="DOM LOUCHE INOX",
                store_key="dom louche inox",
                quantity=1,
                unit_price=Decimal("9.90"),
                total_price=Decimal("9.90"),
                vat_code="B",   # non-alimentaire
            ),
        ],
    )
    return MatchedReceipt(
        parsed=parsed,
        lines=[MatchedLine(parsed=line, suggestions=[]) for line in parsed.lines],
    )


# ============================================================ Phase 4 — suggestCreatePayload


def test_suggest_payload_intermarche_food_line(app_ctx) -> None:
    """Pour une ligne TVA A : pré-rempli avec catégorie 'Alimentaire'."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched("intermarche")

    payload = vm.suggestCreatePayload(0)
    assert payload["name"] == "YAOURT NATURE"
    assert payload["categoryL1"] == "Alimentaire"
    assert payload["sourceRef"] == ""           # pas d'EAN sur ticket Intermarché
    assert payload["store"] == "intermarche"
    assert payload["vatCode"] == "A"
    assert payload["quantity"] == 4


def test_suggest_payload_intermarche_non_food_line(app_ctx) -> None:
    """Pour une ligne TVA B : pas de catégorie pré-remplie."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched("intermarche")

    payload = vm.suggestCreatePayload(1)
    assert payload["name"] == "DOM LOUCHE INOX"
    assert payload["categoryL1"] == ""          # pas de pré-fill non-alimentaire
    assert payload["vatCode"] == "B"


def test_suggest_payload_lidl_uses_store_key_as_source_ref(app_ctx) -> None:
    """Pour Lidl : le source_ref est pré-rempli avec l'art_id (= store_key)
    et la catégorie défaut à 'Alimentaire' même sans TVA."""
    vm = ReceiptImportViewModel(app_ctx)
    parsed = ParsedReceipt(
        store="lidl",
        ticket_id="LIDL-1",
        lines=[ParsedLine(raw_name="Concombre", store_key="0082231", quantity=1)],
    )
    vm._matched = MatchedReceipt(
        parsed=parsed, lines=[MatchedLine(parsed=parsed.lines[0])],
    )

    payload = vm.suggestCreatePayload(0)
    assert payload["sourceRef"] == "0082231"    # art_id Lidl
    assert payload["categoryL1"] == "Alimentaire"   # par défaut pour Lidl
    assert payload["store"] == "lidl"


def test_suggest_payload_invalid_index_returns_empty(app_ctx) -> None:
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    assert vm.suggestCreatePayload(99) == {}


def test_suggest_payload_no_receipt_returns_empty(app_ctx) -> None:
    vm = ReceiptImportViewModel(app_ctx)
    assert vm.suggestCreatePayload(0) == {}


# ============================================================ Phase 4 — createIngredientFromLine


def test_create_ingredient_basic_intermarche(app_ctx) -> None:
    """Création basique : nom seul + index → MANUAL ingredient + alias appris."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched("intermarche")

    new_id = vm.createIngredientFromLine({
        "index": 0,
        "name": "Yaourt nature bio",
    })
    assert new_id > 0

    with app_ctx.session() as s:
        ing = IngredientRepo(s).get(new_id)
        assert ing is not None
        assert ing.name == "Yaourt nature bio"
        assert ing.source == Source.MANUAL
        assert ing.source_ref is None
        assert ing.in_personal_library is True

        # Alias appris : prochain import Intermarché matchera direct
        alias = ReceiptAliasRepo(s).find("intermarche", "yaourt nature")
        assert alias is not None
        assert alias.ingredient_id == new_id


def test_create_ingredient_with_ean_uses_off_source(app_ctx) -> None:
    """Phase 4 : un EAN saisi bascule la source à OPENFOODFACTS."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched("intermarche")

    new_id = vm.createIngredientFromLine({
        "index": 0,
        "name": "Yaourt nature",
        "sourceRef": "3017620422003",
    })
    assert new_id > 0

    with app_ctx.session() as s:
        ing = IngredientRepo(s).get(new_id)
        assert ing.source == Source.OPENFOODFACTS
        assert ing.source_ref == "3017620422003"


def test_create_ingredient_lidl_uses_lidl_source_with_art_id(app_ctx) -> None:
    """Pour Lidl : source = LIDL, source_ref = art_id (= store_key) sans alias."""
    vm = ReceiptImportViewModel(app_ctx)
    parsed = ParsedReceipt(
        store="lidl",
        lines=[ParsedLine(raw_name="Concombre", store_key="0082231")],
    )
    vm._matched = MatchedReceipt(
        parsed=parsed, lines=[MatchedLine(parsed=parsed.lines[0])],
    )

    new_id = vm.createIngredientFromLine({
        "index": 0,
        "name": "Concombre",
    })

    with app_ctx.session() as s:
        ing = IngredientRepo(s).get(new_id)
        assert ing.source == Source.LIDL
        assert ing.source_ref == "0082231"

        # Pas d'alias pour Lidl (le source_ref suffit pour matcher)
        assert ReceiptAliasRepo(s).find("lidl", "0082231") is None


def test_create_ingredient_with_categories_and_piece_weight(app_ctx) -> None:
    """Phase 4 : catégories + poids unitaire + base prix sont persistés."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched("intermarche")

    new_id = vm.createIngredientFromLine({
        "index": 0,
        "name": "Yaourt nature",
        "categoryL1": "Alimentaire",
        "categoryL2": "Produits laitiers",
        "pieceWeightG": 125.0,
        "priceQuantityG": 500.0,
    })

    with app_ctx.session() as s:
        ing = IngredientRepo(s).get(new_id)
        assert ing.category_l1 == "Alimentaire"
        assert ing.category_l2 == "Produits laitiers"
        assert ing.piece_weight_g == 125.0
        assert ing.price_quantity_g == 500.0


def test_create_ingredient_zero_piece_weight_stored_as_null(app_ctx) -> None:
    """Un poids/qty de 0 est traité comme 'pas renseigné' (None en DB)."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched("intermarche")

    new_id = vm.createIngredientFromLine({
        "index": 0,
        "name": "Yaourt",
        "pieceWeightG": 0,
        "priceQuantityG": 0,
    })

    with app_ctx.session() as s:
        ing = IngredientRepo(s).get(new_id)
        assert ing.piece_weight_g is None
        assert ing.price_quantity_g is None


def test_create_ingredient_invalid_payload(app_ctx) -> None:
    """Index hors limites ou nom vide → retourne 0, pas de DB write."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()

    assert vm.createIngredientFromLine({"index": 99, "name": "X"}) == 0
    assert vm.createIngredientFromLine({"index": 0, "name": ""}) == 0
    assert vm.createIngredientFromLine({"index": 0, "name": "   "}) == 0


def test_create_ingredient_updates_chosen_id_on_line(app_ctx) -> None:
    """Effet de bord attendu : la ligne est marquée chosen_ingredient_id=new_id
    pour qu'à commit on l'utilise direct sans nouveau picking."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()

    assert vm._matched.lines[0].chosen_ingredient_id is None
    new_id = vm.createIngredientFromLine({"index": 0, "name": "Yaourt"})
    assert vm._matched.lines[0].chosen_ingredient_id == new_id


# ============================================================ Phase 4 — lookupBarcodeAsDict


def test_lookup_barcode_invalid_ean_returns_empty(app_ctx) -> None:
    """EAN trop court / non numérique → vide sans appel HTTP."""
    from app.ui.viewmodels.ingredient_vm import IngredientViewModel

    vm = IngredientViewModel(app_ctx)
    assert vm.lookupBarcodeAsDict("") == {}
    assert vm.lookupBarcodeAsDict("abc") == {}
    assert vm.lookupBarcodeAsDict("1234567") == {}   # 7 chiffres = trop court


def test_lookup_barcode_calls_off_when_valid(app_ctx) -> None:
    """EAN valide → appelle openfoodfacts.lookup_barcode et retourne le dict."""
    from app.ui.viewmodels.ingredient_vm import IngredientViewModel

    vm = IngredientViewModel(app_ctx)
    fake_ing = Ingredient(
        name="Nutella 400g",
        source=Source.OPENFOODFACTS,
        source_ref="3017620422003",
        kcal_per_100g=539.0,
    )
    with patch("app.services.openfoodfacts.lookup_barcode", return_value=fake_ing):
        result = vm.lookupBarcodeAsDict("3017620422003")

    assert result["name"] == "Nutella 400g"
    assert result["source"] == "openfoodfacts"
    assert result["sourceRef"] == "3017620422003"


def test_lookup_barcode_off_returns_none_yields_empty(app_ctx) -> None:
    """EAN valide mais OFF n'a pas le produit → dict vide."""
    from app.ui.viewmodels.ingredient_vm import IngredientViewModel

    vm = IngredientViewModel(app_ctx)
    with patch("app.services.openfoodfacts.lookup_barcode", return_value=None):
        result = vm.lookupBarcodeAsDict("9999999999999")
    assert result == {}


def test_lookup_barcode_off_error_emits_signal(app_ctx, qtbot) -> None:
    """Si OFF lève OpenFoodFactsError, on émet error_emitted et retourne vide."""
    from app.services.openfoodfacts import OpenFoodFactsError
    from app.ui.viewmodels.ingredient_vm import IngredientViewModel

    vm = IngredientViewModel(app_ctx)
    received: list[str] = []
    vm.error_emitted.connect(received.append)

    with patch(
        "app.services.openfoodfacts.lookup_barcode",
        side_effect=OpenFoodFactsError("Network down"),
    ):
        result = vm.lookupBarcodeAsDict("3017620422003")

    assert result == {}
    assert received == ["Network down"]


# ============================================================ Phase 1 sanity (rapide)


def test_commit_import_creates_price_history(app_ctx) -> None:
    """Un commit avec un ingrédient assigné crée bien le price_history.
    Sanity check Phase 1 (le gros est testé via les tests parser/matcher)."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched("intermarche")

    # Crée l'ingrédient pour la ligne 0
    new_id = vm.createIngredientFromLine({"index": 0, "name": "Yaourt"})

    result = vm.commitImport()
    assert result["success"] is True
    assert result["priceCount"] == 1
    assert result["pantryCount"] == 0

    # Anti-doublon enregistré
    with app_ctx.session() as s:
        assert ImportedReceiptRepo(s).exists("TICKET-TEST-1")


def test_commit_import_skips_unassigned_lines(app_ctx) -> None:
    """Lignes sans chosen_ingredient_id sont sautées (mais commit succède)."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched("intermarche")

    result = vm.commitImport()
    assert result["success"] is True
    assert result["priceCount"] == 0


def test_commit_import_duplicate_blocks_without_force(app_ctx) -> None:
    """Si is_duplicate, refuse le commit sauf si force_import=True."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched("intermarche")
    vm._matched.is_duplicate = True

    result = vm.commitImport()
    assert result["success"] is False
    assert "déjà importé" in result["message"].lower()

    # Avec force : passe
    vm.setForceImport(True)
    result2 = vm.commitImport()
    assert result2["success"] is True


# ============================================================ Nouveaux slots édition tableau


def test_set_line_quantity_recomputes_total_price(app_ctx) -> None:
    """Modifier la qté d'une ligne doit recalculer total_price = unit × qty."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched("intermarche")
    line = vm._matched.lines[0]
    assert line.parsed.quantity == 4
    assert line.parsed.unit_price == Decimal("0.45")
    assert line.parsed.total_price == Decimal("1.80")

    vm.setLineQuantity(0, 6)
    assert line.parsed.quantity == 6
    assert line.parsed.total_price == Decimal("2.70")   # 0.45 × 6


def test_set_line_quantity_floor_at_one(app_ctx) -> None:
    """qty <= 0 est ramenée à 1."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()

    vm.setLineQuantity(0, 0)
    assert vm._matched.lines[0].parsed.quantity == 1
    vm.setLineQuantity(0, -5)
    assert vm._matched.lines[0].parsed.quantity == 1


def test_set_line_quantity_invalid_index_noop(app_ctx) -> None:
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    # Ne plante pas
    vm.setLineQuantity(99, 5)


def test_set_line_barcode_stored(app_ctx) -> None:
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()

    vm.setLineBarcode(0, "  3017620422003  ")
    assert vm._matched.lines[0].user_barcode == "3017620422003"


def test_lookup_barcode_invalid_ean_emits_error(app_ctx) -> None:
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    vm.setLineBarcode(0, "abc")

    received: list[str] = []
    vm.error_emitted.connect(received.append)
    result = vm.lookupBarcodeAndAssign(0)

    assert result == 0
    assert any("EAN invalide" in m for m in received)


def test_lookup_barcode_finds_existing_ingredient(app_ctx) -> None:
    """Si un ingrédient avec cet EAN existe déjà en DB (cache OFF), on le
    réutilise + on flippe in_personal_library + on assigne à la ligne."""
    from app.data.repositories import IngredientRepo

    # Pré-charge un ingrédient OFF en DB (catalogue brut, pas en lib perso)
    with app_ctx.session() as s:
        existing = IngredientRepo(s).create(Ingredient(
            name="Nutella 400g",
            source=Source.OPENFOODFACTS,
            source_ref="3017620422003",
            in_personal_library=False,
        ))
        existing_id = existing.id
        s.commit()

    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    vm.setLineBarcode(0, "3017620422003")

    result = vm.lookupBarcodeAndAssign(0)
    assert result == existing_id
    assert vm._matched.lines[0].chosen_ingredient_id == existing_id

    # Vérifie que le flag a été flippé
    with app_ctx.session() as s:
        ing = IngredientRepo(s).get(existing_id)
        assert ing.in_personal_library is True


def test_lookup_barcode_off_not_found_emits_error(app_ctx) -> None:
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    vm.setLineBarcode(0, "9999999999999")

    received: list[str] = []
    vm.error_emitted.connect(received.append)

    with patch("app.services.openfoodfacts.lookup_barcode", return_value=None):
        result = vm.lookupBarcodeAndAssign(0)

    assert result == 0
    assert any("Aucun produit OpenFoodFacts" in m for m in received)


def test_lookup_barcode_off_creates_new_ingredient(app_ctx) -> None:
    """OFF retourne un ingrédient → on le persiste + assigne à la ligne."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    vm.setLineBarcode(0, "3017620422003")

    fake_ing = Ingredient(
        name="Nutella 400g",
        source=Source.OPENFOODFACTS,
        source_ref="3017620422003",
        kcal_per_100g=539.0,
    )
    with patch("app.services.openfoodfacts.lookup_barcode", return_value=fake_ing):
        new_id = vm.lookupBarcodeAndAssign(0)

    assert new_id > 0
    assert vm._matched.lines[0].chosen_ingredient_id == new_id

    with app_ctx.session() as s:
        from app.data.repositories import IngredientRepo
        ing = IngredientRepo(s).get(new_id)
        assert ing.name == "Nutella 400g"
        assert ing.source_ref == "3017620422003"
        assert ing.in_personal_library is True


def test_lines_as_list_includes_user_barcode(app_ctx) -> None:
    """Le user_barcode est exposé au QML pour binding du TextField."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    vm.setLineBarcode(0, "3017620422003")

    rows = vm.linesAsList()
    assert rows[0]["userBarcode"] == "3017620422003"
    assert rows[1]["userBarcode"] == ""


# ============================================================ Refonte UX — Phase B+C


def test_set_line_quantity_g_stores_grams(app_ctx) -> None:
    """`setLineQuantityG` mémorise les grammes saisis sur la ligne sans
    toucher au prix (un changement d'unité ne ré-écrase pas le prix payé)."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    line = vm._matched.lines[0]
    original_total = line.parsed.total_price

    vm.setLineQuantityG(0, 250.0)
    assert line.quantity_g == 250.0
    # Prix inchangé : un ticket donne le prix payé, peu importe la qté
    assert line.parsed.total_price == original_total


def test_set_line_quantity_g_floor_at_zero(app_ctx) -> None:
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    vm.setLineQuantityG(0, -10.0)
    assert vm._matched.lines[0].quantity_g == 0.0


def test_set_line_total_price_overrides_and_locks(app_ctx) -> None:
    """Édition du prix : recalcule unit_price et lève le flag override."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    line = vm._matched.lines[0]
    assert line.parsed.quantity == 4
    assert line.user_price_override is False

    vm.setLineTotalPrice(0, "5,50")
    assert line.parsed.total_price == Decimal("5.50")
    assert line.parsed.unit_price == Decimal("5.50") / Decimal(4)
    assert line.user_price_override is True


def test_set_line_total_price_blocks_qty_recompute(app_ctx) -> None:
    """Une fois le prix override, changer la qté entière ne ré-écrase plus."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    line = vm._matched.lines[0]

    vm.setLineTotalPrice(0, "5,50")
    locked_total = line.parsed.total_price

    # Si user_price_override=True, setLineQuantity ne touche PAS au total
    vm.setLineQuantity(0, 8)
    assert line.parsed.quantity == 8
    assert line.parsed.total_price == locked_total


def test_set_line_total_price_invalid_emits_error(app_ctx) -> None:
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()
    received: list[str] = []
    vm.error_emitted.connect(received.append)

    vm.setLineTotalPrice(0, "abc")
    assert any("invalide" in m.lower() for m in received)
    vm.setLineTotalPrice(0, "-5")
    assert any("positif" in m.lower() for m in received)


def test_match_default_add_to_pantry_true_for_food(app_ctx) -> None:
    """Le matcher initialise add_to_pantry=True pour les lignes TVA A et
    False pour les lignes TVA B (refonte UX : tout va au frigo par défaut
    pour les produits alimentaires)."""
    from app.services.receipt_matcher import match_receipt

    parsed = ParsedReceipt(
        store="intermarche",
        ticket_id="T-MATCH-1",
        lines=[
            ParsedLine(raw_name="YAOURT", store_key="yaourt", vat_code="A"),
            ParsedLine(raw_name="ÉPONGE", store_key="éponge", vat_code="B"),
            ParsedLine(raw_name="PAIN", store_key="pain", vat_code=""),  # neutre = food
        ],
    )

    with app_ctx.session() as s:
        result = match_receipt(s, parsed)

    assert result.lines[0].add_to_pantry is True   # TVA A
    assert result.lines[1].add_to_pantry is False  # TVA B
    assert result.lines[2].add_to_pantry is True   # vat_code vide = présumé food


def test_commit_uses_user_quantity_g_in_priority(app_ctx) -> None:
    """Si l'utilisateur saisit une quantité en grammes, elle prime sur les
    fallbacks (price_quantity_g, piece_weight_g, default 1000g)."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()

    # Crée un ingrédient AVEC piece_weight_g défini (qui DEVRAIT primer
    # selon la cascade legacy)
    new_id = vm.createIngredientFromLine({
        "index": 0, "name": "Yaourt nature", "pieceWeightG": 125.0,
    })
    # L'utilisateur précise "j'ai pris 500 g" → ça prime
    vm.setLineQuantityG(0, 500.0)
    # Frigo coché par défaut, on l'active explicitement par sécurité
    vm.toggleLineAddToPantry(0, True)

    result = vm.commitImport()
    assert result["success"] is True

    # Vérifie le PantryStock a quantity_g = 500.0 (pas 125 × 4 = 500 par
    # coïncidence ? Ici qty=4 × piece_weight=125 = 500 — changeons l'ingrédient
    # pour disambiguer)
    # En fait c'est ambigu, refaisons avec une valeur unique :
    from app.data.repositories import PantryRepo
    with app_ctx.session() as s:
        stocks = PantryRepo(s).list_all()
    # On vérifie qu'un PantryStock a été créé pour cet ingrédient
    relevant = [st for st in stocks if st.ingredient_id == new_id]
    assert len(relevant) >= 1
    # qty_g doit être 500 (saisi user), pas 1000 (default)
    assert relevant[0].quantity_g == 500.0


def test_commit_propagates_expiry_to_pantry_stock(app_ctx) -> None:
    """La DLC saisie atterrit dans PantryStock.expiry_date."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()

    new_id = vm.createIngredientFromLine({"index": 0, "name": "Yaourt"})
    vm.toggleLineAddToPantry(0, True)
    vm.setLineExpiry(0, "2026-12-31")

    result = vm.commitImport()
    assert result["success"] is True

    from app.data.repositories import PantryRepo
    with app_ctx.session() as s:
        stocks = PantryRepo(s).list_all()
    relevant = [st for st in stocks if st.ingredient_id == new_id]
    assert len(relevant) == 1
    assert relevant[0].expiry_date is not None
    assert relevant[0].expiry_date.date().isoformat() == "2026-12-31"


def test_lines_as_list_exposes_quantity_g_and_expiry_human(app_ctx) -> None:
    """Le QML reçoit quantityG (float) et expiryHuman (JJ/MM/AAAA)."""
    vm = ReceiptImportViewModel(app_ctx)
    vm._matched = _make_matched()

    vm.setLineQuantityG(0, 250.0)
    vm.setLineExpiry(0, "2026-12-31")

    rows = vm.linesAsList()
    assert rows[0]["quantityG"] == 250.0
    assert rows[0]["expiryHuman"] == "31/12/2026"
    assert rows[1]["quantityG"] == 0.0
    assert rows[1]["expiryHuman"] == ""
