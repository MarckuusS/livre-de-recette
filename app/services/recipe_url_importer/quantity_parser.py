"""Best-effort French quantity parser for free-text recipe ingredient lines.

Web recipes give ingredients as strings like :

    "200 g de tomates cerises"
    "1 c. à soupe d'huile d'olive"
    "1/2 oignon"
    "1,5 cuillères à café de sel"
    "Sel, poivre"
    "300 ml de lait"

This module turns those into `(quantity, unit_code, name)` triples where
`unit_code` is a key in `app.domain.units.UNITS` (or None when the unit
is unknown / absent — typical for "Sel, poivre" or "1 oignon" without a
piece weight in the library).

Strategy : a single pass with a sequence of regex captures, plus a small
alias table for unit synonyms. Best-effort — we never raise, we never
fail. When in doubt, return `(None, None, raw_text.strip())` so the user
can fix in the wizard.
"""

from __future__ import annotations

import re
import unicodedata

# --- Unit aliases (case-insensitive, matched on the *ascii-folded* form) ---
# Maps the printed token (after fold/lower) to the code in app.domain.units.UNITS.
# Order matters within each value set : we try longer aliases first to avoid
# "c" matching before "c. a soupe".
_UNIT_ALIASES: list[tuple[str, str]] = [
    # Cuillères — longest first so "c. a soupe" matches before "c"
    ("cuilleres a soupe", "c_soupe"),
    ("cuillere a soupe",  "c_soupe"),
    ("cuilleree a soupe", "c_soupe"),
    ("c. a soupe",        "c_soupe"),
    ("c a soupe",         "c_soupe"),
    ("cas",               "c_soupe"),
    ("c.s.",              "c_soupe"),
    ("c.s",               "c_soupe"),
    ("cs",                "c_soupe"),
    ("cuilleres a cafe",  "c_cafe"),
    ("cuillere a cafe",   "c_cafe"),
    ("cuilleree a cafe",  "c_cafe"),
    ("c. a cafe",         "c_cafe"),
    ("c a cafe",           "c_cafe"),
    ("cac",               "c_cafe"),
    ("c.c.",              "c_cafe"),
    ("c.c",               "c_cafe"),
    ("cc",                "c_cafe"),
    # Volumes
    ("litres", "L"),
    ("litre",  "L"),
    ("ml",     "ml"),
    ("cl",     "cl"),
    ("dl",     "dl"),
    ("l",      "L"),
    # Masses
    ("kilos",      "kg"),
    ("kilogrammes","kg"),
    ("kilogramme", "kg"),
    ("kg",         "kg"),
    ("grammes",    "g"),
    ("gramme",     "g"),
    ("gr",         "g"),
    ("g",          "g"),
    ("mg",         "mg"),
    # Cuisine
    ("tasses", "tasse"),
    ("tasse",  "tasse"),
    ("pincees","pincee"),
    ("pincee", "pincee"),
]

# Articles à stripper en tête du nom après extraction de la qty/unit.
# Chaque article DOIT se terminer par une frontière (espace ou apostrophe)
# pour éviter qu'« de la » matche par erreur le début de « de lait ».
# Ordre : longest-first pour que "de l'" tente avant "de " etc.
_LEADING_ARTICLES = (
    "de l'", "de la ", "des ", "du ", "de ", "d'",
)

# Préfixes "contenant/pièce" — surtout HelloFresh & Co qui formatent en
# "1 pièce(s) Oignon" / "1 paquet(s) Crème liquide". Ils n'ont pas de
# conversion en grammes connue mais doivent être reconnus pour ne pas
# polluer le nom d'ingrédient en aval. Strippés → unit reste None,
# l'utilisateur ajustera la qty via QuantityField (qui détectera
# `piece_weight_g` si défini sur l'ingrédient choisi).
# IMPORTANT : seules les variantes avec "(s)" ou plurielles claires sont
# strippées sans ambiguïté. "1 gousse d'ail" garde "gousse d'ail" comme
# nom car c'est un ingrédient nommé chez Marmiton & Co.
_PIECE_PREFIXES = (
    "piece(s)",   # ascii-folded form of "pièce(s)"
    "pieces",
    "paquet(s)",
    "paquets",
    "sachet(s)",
    "sachets",
    "boite(s)",   # "boîte(s)"
    "boites",
    "tranche(s)",
    "tranches",
    "bouquet(s)",
    "bouquets",
    "branche(s)",
    "branches",
    "feuille(s)",
    "feuilles",
)

# Tokens à stripper si le nom commence ainsi (utiles quand l'unité est absente
# mais la phrase commence par un article). Mêmes contraintes de frontière.
_NAME_STRIPPED_TOKENS = (
    "de l'", "de la ", "des ", "du ", "de ", "d'", "à ", "a ",
)


def _ascii_fold(s: str) -> str:
    """Lowercase + remove diacritics for robust alias matching."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower()


def _parse_number(token: str) -> float | None:
    """Parse a French-style number token. Handles :
       - "200"     → 200.0
       - "1,5"     → 1.5  (French decimal)
       - "1.5"     → 1.5  (English decimal — some sites mix)
       - "1/2"     → 0.5  (fractions)
       - "1 1/2"   → 1.5  (mixed — caller passes the whole "1 1/2" token)
    """
    token = token.strip()
    if not token:
        return None
    # Mixed fraction "1 1/2"
    if " " in token and "/" in token:
        parts = token.split(maxsplit=1)
        whole = _parse_number(parts[0])
        frac = _parse_number(parts[1])
        if whole is not None and frac is not None:
            return whole + frac
        return None
    # Plain fraction "1/2"
    if "/" in token:
        a, _, b = token.partition("/")
        try:
            num = float(a.replace(",", "."))
            den = float(b.replace(",", "."))
            if den == 0:
                return None
            return num / den
        except ValueError:
            return None
    try:
        return float(token.replace(",", "."))
    except ValueError:
        return None


# Regex that captures a number at the start of the string. Order MATTERS in
# alternation : try the most specific patterns first so the regex engine
# doesn't commit to a partial match (e.g. on "1/2", a leading `\d+` would
# greedy-match "1" and never try the fraction branch).
#   1) mixed fraction "1 1/2"
#   2) plain fraction "1/2"
#   3) decimal/integer "1,5" / "200"
_NUMBER_RE = re.compile(
    r"""^\s*
        (?P<num>
            \d+\s+\d+\s*/\s*\d+   # mixed : "1 1/2"
            |
            \d+\s*/\s*\d+          # plain fraction : "1/2"
            |
            \d+(?:[.,]\d+)?        # decimal/integer : "1,5" or "200"
        )
        \s*
    """,
    re.VERBOSE,
)


def _strip_leading_article(name: str) -> str:
    """Remove a leading "de", "d'", "de la", etc. from the name."""
    s = name.strip()
    folded = _ascii_fold(s)
    for art in _LEADING_ARTICLES:
        if folded.startswith(art):
            # Re-strip on the original (preserves accents in the rest)
            s = s[len(art):]
            break
    return s.strip()


def parse_french_quantity(text: str) -> tuple[float | None, str | None, str]:
    """Return `(quantity, unit_code, name)` extracted from a free-text line.

    See module docstring for examples. Always returns a 3-tuple ; the
    `name` is the cleaned remainder (never empty unless the input was
    empty too, in which case it's "")."""
    if not text:
        return (None, None, "")
    s = text.strip()
    if not s:
        return (None, None, "")

    # 1) Try to extract a leading number
    m = _NUMBER_RE.match(s)
    if not m:
        # No number → everything is the name.
        return (None, None, s)
    qty = _parse_number(m.group("num"))
    rest = s[m.end():].strip()
    if qty is None:
        return (None, None, s)

    # 2) Try to extract a unit at the start of `rest`. We scan aliases
    # longest-first (already ordered above). Match on the ascii-folded form
    # but only when followed by a word boundary (space, punct, or end).
    folded_rest = _ascii_fold(rest)
    matched_unit_code: str | None = None
    matched_alias_len = 0
    for alias, code in _UNIT_ALIASES:
        if folded_rest.startswith(alias):
            # Word boundary check : next char must not be a letter/digit.
            after = folded_rest[len(alias):len(alias) + 1]
            if not after or not after.isalnum():
                matched_unit_code = code
                matched_alias_len = len(alias)
                break
    if matched_unit_code is not None:
        rest = rest[matched_alias_len:].strip()
        # Strip trailing dot ("c.s.", "c. à soupe.") and a leading article
        rest = _strip_leading_article(rest)
        # If after stripping we have nothing → name = the original raw text
        # without the qty+unit prefix would be empty. Fall back to raw text.
        if not rest:
            return (qty, matched_unit_code, text.strip())
        return (qty, matched_unit_code, rest)

    # 2.5) Try piece-like prefixes ("pièce(s)", "paquet(s)", "sachet(s)" …)
    # These don't have a gram conversion but we strip them so the
    # ingredient name is clean (e.g. "1 pièce(s) Oignon" → name = "Oignon").
    # Only strip when followed by a word boundary AND a non-empty remainder
    # — otherwise keep the original (don't lose info on "1 pièce" alone).
    for prefix in _PIECE_PREFIXES:
        if folded_rest.startswith(prefix):
            after = folded_rest[len(prefix):len(prefix) + 1]
            if not after or not after.isalnum():
                stripped = rest[len(prefix):].strip()
                stripped = _strip_leading_article(stripped) or stripped
                if stripped:
                    return (qty, None, stripped)
                # No name after the prefix → keep original text as name
                return (qty, None, text.strip())

    # 3) No unit recognized — the qty is "implicit pieces" : "1 oignon",
    # "3 carottes". We return unit_code = None (the VM/UI will decide :
    # if the chosen ingredient has piece_weight_g > 0, show "_piece" in the
    # QuantityField ; otherwise fall back to grams).
    rest = _strip_leading_article(rest) or rest
    # Skip a leading "à" (e.g. "à thé" if we missed an alias)
    folded_rest = _ascii_fold(rest)
    for tok in _NAME_STRIPPED_TOKENS:
        if folded_rest.startswith(tok):
            rest = rest[len(tok):].strip()
            break
    return (qty, None, rest if rest else text.strip())
