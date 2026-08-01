"""Unit conversion table for quantities entered in the UI.

Storage stays in grams (CIQUAL convention — see CLAUDE.md). Conversion happens at
the UI boundary via the `QuantityField` widget, which uses these helpers.

Volume → mass conversions assume a default density of 1 g/ml (water-like). For
liquids with a known density we'd extend `Ingredient` later; for the MVP this
default is "good enough" and matches what most cooking apps do.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Unit:
    code: str               # stable machine identifier (used in combobox itemData)
    label: str              # user-facing French label
    grams_per_unit: float   # how many grams one of this unit weighs


# Order = display order in dropdowns. "g" is first because it's the default and
# the most common case for ingredients in the personal library.
UNITS: list[Unit] = [
    Unit("g",       "g",            1.0),
    Unit("kg",      "kg",        1000.0),
    Unit("mg",      "mg",           0.001),
    Unit("ml",      "ml",           1.0),     # density 1 g/ml
    Unit("cl",      "cl",          10.0),
    Unit("dl",      "dl",         100.0),
    Unit("L",       "L",         1000.0),
    Unit("c_cafe",  "c. à café",    5.0),     # ~5 ml
    Unit("c_soupe", "c. à soupe",  15.0),     # ~15 ml
    Unit("tasse",   "tasse",      250.0),     # ~250 ml
    Unit("pincee",  "pincée",       1.0),
]

UNIT_BY_CODE: dict[str, Unit] = {u.code: u for u in UNITS}
DEFAULT_UNIT_CODE = "g"


def to_grams(value: float, unit_code: str) -> float:
    """Convert a value entered in `unit_code` to grams.

    Raises KeyError if the unit code is unknown — caller is expected to only pass
    codes that came from `UNITS`.
    """
    return value * UNIT_BY_CODE[unit_code].grams_per_unit


def from_grams(grams: float, unit_code: str) -> float:
    """Convert a stored gram value back to display in `unit_code`."""
    return grams / UNIT_BY_CODE[unit_code].grams_per_unit


def label_for(unit_code: str) -> str:
    return UNIT_BY_CODE[unit_code].label
