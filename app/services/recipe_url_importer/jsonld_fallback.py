"""Schema.org JSON-LD fallback parser for sites unsupported by recipe-scrapers.

Most modern recipe sites embed a `<script type="application/ld+json">` block
containing a Schema.org `Recipe` object. This module locates and parses
those blocks. It's deliberately tolerant : sites use many variations
(@graph wrappers, list-typed @type, ISO 8601 durations, etc.).

Used as a fallback : if `recipe-scrapers` doesn't recognize the site,
we still try this generic path because most WordPress + WP Recipe Maker
blogs (very common in French food blogs) emit valid JSON-LD that the
upstream lib hasn't enumerated.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from bs4 import BeautifulSoup

from app.domain.url_recipe import ExtractedIngredient, ExtractedRecipe

from .quantity_parser import parse_french_quantity

log = logging.getLogger(__name__)


# ISO 8601 duration : "PT15M", "PT1H30M", "PT2H" → minutes (int)
_ISO_DURATION_RE = re.compile(r"^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?", re.IGNORECASE)


def _iso_duration_to_minutes(iso: str | None) -> int | None:
    if not iso or not isinstance(iso, str):
        return None
    m = _ISO_DURATION_RE.match(iso.strip().upper())
    if not m:
        return None
    days, hours, mins = m.groups()
    total = 0
    if days:
        total += int(days) * 24 * 60
    if hours:
        total += int(hours) * 60
    if mins:
        total += int(mins)
    return total or None


def _coerce_str(value: Any) -> str:
    """Schema.org sometimes wraps strings in 1-element lists or HTML."""
    if value is None:
        return ""
    if isinstance(value, list):
        return _coerce_str(value[0]) if value else ""
    if isinstance(value, dict):
        # Sometimes a textual property is a localized object {@value: "...", @language: "fr"}
        return _coerce_str(value.get("@value") or value.get("text") or "")
    return str(value).strip()


def _is_recipe_node(node: Any) -> bool:
    if not isinstance(node, dict):
        return False
    t = node.get("@type")
    if t == "Recipe":
        return True
    return bool(isinstance(t, list) and "Recipe" in t)


def _find_recipe_in_payload(payload: Any) -> dict | None:
    """Walk a parsed JSON-LD payload (dict or list) and return the first
    Recipe-typed node found. Handles `@graph` wrappers and plain lists."""
    if isinstance(payload, list):
        for item in payload:
            found = _find_recipe_in_payload(item)
            if found:
                return found
        return None
    if isinstance(payload, dict):
        if _is_recipe_node(payload):
            return payload
        graph = payload.get("@graph")
        if graph is not None:
            return _find_recipe_in_payload(graph)
    return None


def _portions_from_yield(yield_value: Any) -> int:
    """`recipeYield` is sometimes "4", sometimes "4 portions", sometimes
    a list ["4", "4 portions"]. Returns 1 if nothing parseable."""
    s = _coerce_str(yield_value)
    if not s:
        return 1
    m = re.search(r"\d+", s)
    if m:
        try:
            return max(1, int(m.group()))
        except ValueError:
            return 1
    return 1


def _instructions_from_jsonld(value: Any) -> str:
    """`recipeInstructions` can be :
    - a single string
    - a list of strings
    - a list of {@type: HowToStep, text: "..."} objects
    - a {@type: HowToSection, itemListElement: [...]}
    Concat into a single newline-separated string."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            chunk = _instructions_from_jsonld(item)
            if chunk:
                parts.append(chunk)
        return "\n".join(parts)
    if isinstance(value, dict):
        # HowToStep / HowToSection
        if value.get("@type") == "HowToSection":
            return _instructions_from_jsonld(value.get("itemListElement", []))
        return _coerce_str(value.get("text") or value.get("name") or "")
    return ""


def parse_jsonld_recipe(html: str, source_url: str) -> ExtractedRecipe | None:
    """Locate the first Schema.org Recipe in the page's JSON-LD blocks.

    Returns None if no `<script type="application/ld+json">` contains a
    Recipe (caller can decide to surface NoRecipeFound). Never raises on
    malformed JSON — logs and skips the offending block."""
    if not html:
        return None
    soup = BeautifulSoup(html, "lxml")
    scripts = soup.find_all("script", attrs={"type": "application/ld+json"})

    recipe_node: dict | None = None
    for script in scripts:
        raw = script.string or script.get_text() or ""
        raw = raw.strip()
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            log.debug("JSON-LD block skipped (parse error: %s)", exc)
            continue
        node = _find_recipe_in_payload(payload)
        if node is not None:
            recipe_node = node
            break

    if recipe_node is None:
        return None

    name = _coerce_str(recipe_node.get("name"))
    instructions = _instructions_from_jsonld(recipe_node.get("recipeInstructions"))
    portions = _portions_from_yield(recipe_node.get("recipeYield"))
    prep = _iso_duration_to_minutes(recipe_node.get("totalTime"))
    if prep is None:
        # Fallback : prepTime + cookTime
        p1 = _iso_duration_to_minutes(recipe_node.get("prepTime"))
        p2 = _iso_duration_to_minutes(recipe_node.get("cookTime"))
        if p1 or p2:
            prep = (p1 or 0) + (p2 or 0)

    image_url: str | None = None
    image = recipe_node.get("image")
    if isinstance(image, str):
        image_url = image
    elif isinstance(image, list) and image:
        image_url = _coerce_str(image[0])
    elif isinstance(image, dict):
        image_url = _coerce_str(image.get("url") or image.get("@id"))

    raw_ingredients = recipe_node.get("recipeIngredient") or []
    if not isinstance(raw_ingredients, list):
        raw_ingredients = [raw_ingredients]

    ingredients: list[ExtractedIngredient] = []
    for raw in raw_ingredients:
        line = _coerce_str(raw)
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
        name=name or "(recette sans titre)",
        instructions=instructions,
        default_portions=portions,
        prep_time_min=prep,
        image_url=image_url or None,
        source_url=source_url,
        ingredients=ingredients,
    )
