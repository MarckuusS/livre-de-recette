"""Tests for the OpenFoodFacts client. Network is mocked via httpx MockTransport."""

from __future__ import annotations

import json

import httpx
import pytest

from app.domain.models import Source
from app.services import openfoodfacts as off


def make_client(handler):
    transport = httpx.MockTransport(handler)
    return httpx.Client(
        base_url="https://world.openfoodfacts.org",
        transport=transport,
        headers={"User-Agent": "test", "Accept": "application/json"},
    )


def test_lookup_barcode_found():
    payload = {
        "status": 1,
        "product": {
            "code": "3017620422003",
            "product_name_fr": "Nutella",
            "brands": "Ferrero, Ferrara",
            "nutriments": {
                "energy-kcal_100g": 539,
                "proteins_100g": 6.3,
                "carbohydrates_100g": 57.5,
                "sugars_100g": 56.3,
                "fat_100g": 30.9,
                "saturated-fat_100g": 10.6,
                "fiber_100g": 0.0,
                "salt_100g": 0.107,
            },
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v2/product/3017620422003"
        return httpx.Response(200, content=json.dumps(payload))

    with make_client(handler) as c:
        ing = off.lookup_barcode("3017620422003", client=c)
    assert ing is not None
    assert ing.source == Source.OPENFOODFACTS
    assert ing.source_ref == "3017620422003"
    assert ing.kcal_per_100g == 539.0
    assert ing.proteins_g == 6.3
    # Refonte UX : la marque va dans le champ `brand` (séparé du nom).
    # On garde le premier nom de marque (Ferrero) avant la virgule.
    assert ing.name == "Nutella"
    assert ing.brand == "Ferrero"


def test_lookup_barcode_not_found_returns_none():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps({"status": 0}))

    with make_client(handler) as c:
        ing = off.lookup_barcode("0000000000000", client=c)
    assert ing is None


def test_lookup_barcode_404_returns_none():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, content=b"")

    with make_client(handler) as c:
        ing = off.lookup_barcode("1111111111111", client=c)
    assert ing is None


def test_lookup_barcode_rejects_non_digits():
    with pytest.raises(ValueError):
        off.lookup_barcode("not-a-barcode")


def test_lookup_barcode_kj_only_falls_back_to_kcal():
    payload = {
        "status": 1,
        "product": {
            "code": "1234567890123",
            "product_name": "Old format",
            "nutriments": {"energy_100g": 1000},  # 1000 kJ -> ~239 kcal
        },
    }

    def handler(_):
        return httpx.Response(200, content=json.dumps(payload))

    with make_client(handler) as c:
        ing = off.lookup_barcode("1234567890123", client=c)
    assert ing is not None
    assert ing.kcal_per_100g is not None
    assert 238.0 < ing.kcal_per_100g < 240.0


def test_lookup_barcode_skips_when_no_name():
    payload = {"status": 1, "product": {"code": "9999999999999", "nutriments": {}}}

    def handler(_):
        return httpx.Response(200, content=json.dumps(payload))

    with make_client(handler) as c:
        ing = off.lookup_barcode("9999999999999", client=c)
    assert ing is None


def _make_search_client(handler):
    """Search-a-licious is on a different host than the main OFF API, so test
    helpers can't reuse `make_client` (which targets world.openfoodfacts.org)."""
    transport = httpx.MockTransport(handler)
    return httpx.Client(
        base_url="https://search.openfoodfacts.org",
        transport=transport,
        headers={"User-Agent": "test", "Accept": "application/json"},
    )


def test_search_by_name_returns_list_and_total():
    # Search-a-licious schema: {"hits": [...], "count": N} with brands as a list.
    payload = {
        "hits": [
            {
                "code": "111",
                "product_name_fr": "Tomate cerise",
                "brands": ["Marque A", "Marque B"],
                "nutriments": {"energy-kcal_100g": 18, "proteins_100g": 0.9},
            },
            {
                "code": "222",
                "product_name_fr": "Tomate confite",
                "nutriments": {"energy-kcal_100g": 130},
            },
            {"code": "333", "nutriments": {}},  # no name -> filtered out
        ],
        "count": 247,  # total hits across all pages
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search"
        assert request.url.params.get("q") == "tomate"
        assert request.url.params.get("page") == "1"
        assert request.url.params.get("page_size") == "10"
        assert request.url.params.get("langs") == "fr,en"
        return httpx.Response(200, content=json.dumps(payload))

    with _make_search_client(handler) as client:
        results, total = off.search_by_name("tomate", page_size=10, client=client)
    assert len(results) == 2
    assert total == 247
    # Refonte UX : la marque est désormais dans `brand` (champ séparé), plus
    # concaténée dans le nom.
    assert results[0].name == "Tomate cerise"
    assert results[0].brand == "Marque A"


def test_search_by_name_lucene_filters_and_sort():
    """Numeric filters become Lucene range expressions; supported sort_by values
    are forwarded to the API; unsupported ones (macro sorts) fall back silently."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["q"] = request.url.params.get("q")
        captured["sort_by"] = request.url.params.get("sort_by")
        captured["page"] = request.url.params.get("page")
        return httpx.Response(200, content=json.dumps({"hits": [], "count": 0}))

    # 1. name_desc IS supported -> forwarded as -product_name
    with _make_search_client(handler) as client:
        off.search_by_name(
            "yaourt",
            page=3,
            page_size=20,
            sort_by="name_desc",
            filters={"min_proteins": 5.0, "max_proteins": 30.0, "category_tag": "fr:yaourts"},
            client=client,
        )
    assert "yaourt" in captured["q"]
    assert "nutriments.proteins_100g:[5.0 TO 30.0]" in captured["q"]
    assert 'categories_tags:"fr:yaourts"' in captured["q"]
    assert captured["sort_by"] == "-product_name"
    assert captured["page"] == "3"


def test_search_by_name_unsupported_sort_falls_back_silently():
    """Macro sorts (proteins_desc etc.) are not accepted by Search-a-licious so
    we MUST NOT send them — the API returns HTTP 400. The client just omits
    the param; the UI is responsible for hinting the limitation to the user."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["sort_by"] = request.url.params.get("sort_by")
        return httpx.Response(200, content=json.dumps({"hits": [], "count": 0}))

    with _make_search_client(handler) as client:
        off.search_by_name("boeuf", sort_by="proteins_desc", client=client)
    assert captured["sort_by"] is None  # not present in the URL


def test_search_by_name_empty_query_and_no_filters_no_call():
    """Empty query AND no filters -> avoid hitting the API with '*:*' which
    would page through the entire OFF dataset."""
    def handler(_):
        raise AssertionError("should not be called")

    with _make_search_client(handler) as client:
        results, total = off.search_by_name("   ", client=client)
    assert results == []
    assert total == 0


def test_network_error_wrapped_in_off_error():
    def handler(_):
        raise httpx.ConnectError("boom")

    with make_client(handler) as c, pytest.raises(off.OpenFoodFactsError):
        off.lookup_barcode("1234567890123", client=c)
