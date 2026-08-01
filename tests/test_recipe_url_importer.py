"""Tests for the URL recipe importer (fetch + parse).

HTTP is mocked via `httpx.MockTransport` (same convention as
`test_openfoodfacts.py`). The recipe-scrapers branch is exercised via
monkeypatch because mocking ~400 site-specific scrapers isn't realistic.
The JSON-LD fallback branch is tested with hand-crafted HTML samples
that mirror what real WordPress + WP Recipe Maker pages emit.
"""

from __future__ import annotations

import httpx
import pytest

from app.domain.url_recipe import ExtractedIngredient, ExtractedRecipe
from app.services.recipe_url_importer import (
    NetworkError,
    NoRecipeFound,
    UnsupportedSite,
    fetch_recipe,
)
from app.services.recipe_url_importer.jsonld_fallback import parse_jsonld_recipe

# ============================================================ Helpers


def make_client(handler):
    transport = httpx.MockTransport(handler)
    return httpx.Client(
        transport=transport,
        headers={"User-Agent": "test"},
        follow_redirects=True,
    )


# Minimal Schema.org Recipe embedded in a typical WordPress recipe page.
SAMPLE_JSONLD_HTML = """
<!DOCTYPE html>
<html>
<head><title>Tarte aux pommes</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "Recipe",
  "name": "Tarte aux pommes",
  "image": "https://example.com/tarte.jpg",
  "recipeYield": "6 portions",
  "totalTime": "PT45M",
  "recipeIngredient": [
    "1 pâte brisée",
    "6 pommes",
    "100 g de sucre",
    "50 g de beurre",
    "1 c. à café de cannelle"
  ],
  "recipeInstructions": [
    {"@type": "HowToStep", "text": "Préchauffer le four à 180°C."},
    {"@type": "HowToStep", "text": "Étaler la pâte dans un moule."},
    {"@type": "HowToStep", "text": "Disposer les pommes coupées et enfourner 35 min."}
  ]
}
</script>
</head>
<body>Recette de tarte aux pommes…</body>
</html>
"""

# Page with the Recipe wrapped in a @graph (very common in WP RankMath SEO)
GRAPH_WRAPPED_JSONLD_HTML = """
<!DOCTYPE html>
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@graph": [
    {"@type": "Article", "headline": "Recette du dimanche"},
    {
      "@type": "Recipe",
      "name": "Soupe de courge",
      "recipeYield": "4",
      "recipeIngredient": ["500 g de courge", "1 oignon"],
      "recipeInstructions": "Cuire et mixer."
    }
  ]
}
</script>
</head><body></body></html>
"""

NO_RECIPE_HTML = """
<!DOCTYPE html>
<html><head><title>Page sans recette</title></head>
<body><p>Bienvenue sur mon blog.</p></body></html>
"""


# ============================================================ JSON-LD fallback (unit)


def test_jsonld_fallback_parses_basic_recipe() -> None:
    extracted = parse_jsonld_recipe(SAMPLE_JSONLD_HTML, "https://example.com/tarte")
    assert extracted is not None
    assert extracted.name == "Tarte aux pommes"
    assert extracted.default_portions == 6
    assert extracted.prep_time_min == 45
    assert extracted.image_url == "https://example.com/tarte.jpg"
    assert extracted.source_url == "https://example.com/tarte"
    assert len(extracted.ingredients) == 5
    # Vérifie la passe parse_french_quantity en aval
    by_name = {ing.parsed_name: ing for ing in extracted.ingredients}
    assert by_name["sucre"].parsed_quantity == 100.0
    assert by_name["sucre"].parsed_unit == "g"
    assert by_name["beurre"].parsed_quantity == 50.0
    assert by_name["pommes"].parsed_quantity == 6.0
    assert by_name["pommes"].parsed_unit is None  # piece count
    assert "Préchauffer" in extracted.instructions
    # 3 lignes d'instructions concaténées
    assert extracted.instructions.count("\n") == 2


def test_jsonld_fallback_handles_graph_wrapper() -> None:
    extracted = parse_jsonld_recipe(GRAPH_WRAPPED_JSONLD_HTML, "https://example.com/soupe")
    assert extracted is not None
    assert extracted.name == "Soupe de courge"
    assert extracted.default_portions == 4
    assert len(extracted.ingredients) == 2


def test_jsonld_fallback_returns_none_when_no_recipe() -> None:
    assert parse_jsonld_recipe(NO_RECIPE_HTML, "https://example.com/x") is None


def test_jsonld_fallback_skips_malformed_blocks() -> None:
    """A page with a malformed JSON-LD followed by a valid one should not
    crash — the bad block is skipped, the valid one wins."""
    html = (
        '<html><head>'
        '<script type="application/ld+json">{ this is not json }</script>'
        '<script type="application/ld+json">'
        '{"@type":"Recipe","name":"X","recipeIngredient":["1 oeuf"]}'
        '</script></head></html>'
    )
    extracted = parse_jsonld_recipe(html, "https://example.com/")
    assert extracted is not None
    assert extracted.name == "X"
    assert extracted.ingredients[0].parsed_quantity == 1.0


# ============================================================ fetch_recipe (orchestration)


def test_fetch_recipe_uses_recipe_scrapers_when_available(monkeypatch) -> None:
    """When recipe-scrapers returns an ExtractedRecipe, fetch_recipe must
    skip the JSON-LD fallback and return the scraper output verbatim."""
    fake = ExtractedRecipe(
        name="From scrapers",
        ingredients=[ExtractedIngredient(raw_text="1 oeuf", parsed_name="oeuf",
                                         parsed_quantity=1.0, parsed_unit=None)],
    )

    def fake_scrapers(url: str, html: str | None = None) -> ExtractedRecipe | None:
        return fake

    monkeypatch.setattr(
        "app.services.recipe_url_importer.core.try_recipe_scrapers", fake_scrapers
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html><body>any</body></html>")

    with make_client(handler) as c:
        out = fetch_recipe("https://marmiton.org/recette/123", client=c)
    assert out is fake


def test_fetch_recipe_falls_back_to_jsonld(monkeypatch) -> None:
    """When recipe-scrapers returns None (site unsupported), the JSON-LD
    fallback must take over and return its parsed recipe."""

    def fake_scrapers(url: str, html: str | None = None):
        return None

    monkeypatch.setattr(
        "app.services.recipe_url_importer.core.try_recipe_scrapers", fake_scrapers
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=SAMPLE_JSONLD_HTML)

    with make_client(handler) as c:
        out = fetch_recipe("https://example.com/tarte", client=c)
    assert out.name == "Tarte aux pommes"
    assert len(out.ingredients) == 5


def test_fetch_recipe_unsupported_when_neither_works(monkeypatch) -> None:
    """No scraper, no JSON-LD → UnsupportedSite with friendly message."""
    monkeypatch.setattr(
        "app.services.recipe_url_importer.core.try_recipe_scrapers",
        lambda url, html=None: None,
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=NO_RECIPE_HTML)

    with make_client(handler) as c, pytest.raises(UnsupportedSite) as exc_info:
        fetch_recipe("https://blog-perso.fr/article", client=c)
    assert "pas supporté" in str(exc_info.value).lower() or \
           "aucune recette" in str(exc_info.value).lower()


def test_fetch_recipe_404_friendly(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.recipe_url_importer.core.try_recipe_scrapers",
        lambda url, html=None: None,
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="Not found")

    with make_client(handler) as c, pytest.raises(NetworkError) as exc_info:
        fetch_recipe("https://example.com/missing", client=c)
    msg = str(exc_info.value).lower()
    assert "404" in msg or "introuvable" in msg


def test_fetch_recipe_timeout_friendly(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.recipe_url_importer.core.try_recipe_scrapers",
        lambda url, html=None: None,
    )

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("simulated timeout")

    with make_client(handler) as c, pytest.raises(NetworkError) as exc_info:
        fetch_recipe("https://slow.example.com/", client=c)
    assert "timeout" in str(exc_info.value).lower() or "ne répond" in str(exc_info.value).lower()


def test_fetch_recipe_empty_url_raises_network_error() -> None:
    with pytest.raises(NetworkError):
        fetch_recipe("")
    with pytest.raises(NetworkError):
        fetch_recipe("   ")


def test_fetch_recipe_empty_response_no_recipe(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.recipe_url_importer.core.try_recipe_scrapers",
        lambda url, html=None: None,
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="")

    with make_client(handler) as c, pytest.raises(NoRecipeFound):
        fetch_recipe("https://example.com/blank", client=c)
