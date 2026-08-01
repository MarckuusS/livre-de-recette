"""Thin wrapper around the `recipe-scrapers` library.

`recipe-scrapers` knows ~400 sites natively, including all the major French
ones (Marmiton, 750g, Hervé Cuisine, Cuisine AZ, …). We map its scraper
interface to our domain `ExtractedRecipe`.

When the site is unsupported and no Schema.org JSON-LD is detectable in
"wild mode", the lib raises `WebsiteNotImplementedError` /
`NoSchemaFoundInWildMode` — we catch both and return None so the caller
can fall back to our hand-roll JSON-LD parser.
"""

from __future__ import annotations

import logging
from typing import Any

from app.domain.url_recipe import ExtractedIngredient, ExtractedRecipe

from .quantity_parser import parse_french_quantity

log = logging.getLogger(__name__)


def _safe_call(fn: Any, default: Any = None) -> Any:
    """Some scrapers raise on missing fields (e.g. yields() when not
    present). Wrap with try/except to keep extraction best-effort."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 — recipe-scrapers errors are diverse
        log.debug("scraper accessor failed (%s) — defaulting", exc)
        return default


def _portions_from_yield(yield_str: str | None) -> int:
    if not yield_str:
        return 1
    import re
    m = re.search(r"\d+", yield_str)
    return max(1, int(m.group())) if m else 1


def try_recipe_scrapers(url: str, html: str | None = None) -> ExtractedRecipe | None:
    """Try to parse the recipe via `recipe-scrapers`. Returns None when the
    site is not supported (caller falls back to JSON-LD generic parser).

    `html` is optional — if the caller already fetched the page, pass it
    here so we don't make a second HTTP round-trip. Otherwise the lib does
    its own fetch.
    """
    try:
        from recipe_scrapers import scrape_html, scrape_me
        from recipe_scrapers._exceptions import (
            NoSchemaFoundInWildMode,
            WebsiteNotImplementedError,
        )
    except ImportError:
        log.warning("recipe-scrapers not installed — skipping native scraper")
        return None

    try:
        scraper = (
            scrape_html(html=html, org_url=url) if html is not None
            else scrape_me(url)
        )
    except WebsiteNotImplementedError:
        log.debug("recipe-scrapers : site not implemented for %s", url)
        return None
    except NoSchemaFoundInWildMode:
        log.debug("recipe-scrapers : no schema found in wild mode for %s", url)
        return None
    except Exception as exc:  # noqa: BLE001 — diverse upstream exceptions
        log.warning("recipe-scrapers : unexpected error on %s : %s", url, exc)
        return None

    name = _safe_call(scraper.title, "") or "(recette sans titre)"
    instructions = _safe_call(scraper.instructions, "") or ""
    yields = _safe_call(scraper.yields, "")
    total_time = _safe_call(scraper.total_time, None)  # int (minutes) or None
    image_url = _safe_call(scraper.image, None)

    raw_ingredients: list[str] = _safe_call(scraper.ingredients, []) or []
    ingredients: list[ExtractedIngredient] = []
    for raw in raw_ingredients:
        line = (raw or "").strip()
        if not line:
            continue
        qty, unit, parsed_name = parse_french_quantity(line)
        ingredients.append(
            ExtractedIngredient(
                raw_text=line,
                parsed_name=parsed_name,
                parsed_quantity=qty,
                parsed_unit=unit,
            )
        )

    return ExtractedRecipe(
        name=name.strip(),
        instructions=instructions.strip(),
        default_portions=_portions_from_yield(yields),
        prep_time_min=total_time if isinstance(total_time, int) and total_time > 0 else None,
        image_url=image_url or None,
        source_url=url,
        ingredients=ingredients,
    )
