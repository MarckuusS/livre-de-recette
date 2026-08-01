import pytest

from app.domain.units import (
    DEFAULT_UNIT_CODE,
    UNIT_BY_CODE,
    UNITS,
    from_grams,
    label_for,
    to_grams,
)


def test_default_unit_is_grams():
    assert DEFAULT_UNIT_CODE == "g"
    assert UNIT_BY_CODE["g"].grams_per_unit == 1.0


def test_to_grams_basic():
    assert to_grams(1, "g") == 1.0
    assert to_grams(1, "kg") == 1000.0
    assert to_grams(500, "mg") == 0.5
    assert to_grams(1, "L") == 1000.0
    assert to_grams(25, "cl") == 250.0
    assert to_grams(1, "c_soupe") == 15.0
    assert to_grams(2, "tasse") == 500.0


def test_from_grams_inverse():
    assert from_grams(1000, "kg") == 1.0
    assert from_grams(0.5, "mg") == 500.0
    assert from_grams(250, "cl") == 25.0


def test_round_trip():
    for u in UNITS:
        for v in (1.0, 12.5, 0.1, 1000.0):
            grams = to_grams(v, u.code)
            back = from_grams(grams, u.code)
            assert abs(back - v) < 1e-9, f"round-trip failed for {u.code}@{v}"


def test_label_for_known_unit():
    assert label_for("g") == "g"
    assert label_for("c_soupe") == "c. à soupe"
    assert label_for("tasse") == "tasse"


def test_unknown_unit_raises():
    with pytest.raises(KeyError):
        to_grams(1, "parsec")
    with pytest.raises(KeyError):
        from_grams(1, "parsec")


def test_units_codes_are_unique():
    codes = [u.code for u in UNITS]
    assert len(codes) == len(set(codes)), "duplicate unit codes"
