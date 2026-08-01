"""Domain models for the receipt import pipeline (Plan v3).

A receipt is a *parsed* representation of the user's grocery purchase :
- store, date, ticket_id (anti-doublon)
- N lines, each with a raw_name (as seen on the ticket), quantity, unit price,
  total price, and optional VAT code.

These are pure data classes (no Qt, no SQLAlchemy). They sit between :
- the parsers (`app/services/receipt_parser/*`) which produce ParsedReceipt
- the matcher (`app/services/receipt_matcher.py`) which produces MatchedReceipt
- the viewmodel (`app/ui/viewmodels/receipt_import_vm.py`) which exposes
  MatchedReceipt to QML for review

The user reviews each MatchedLine in the dialog, optionally overriding the
suggested ingredient or creating a new one, then commits the receipt.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal


@dataclass(frozen=False)
class ParsedLine:
    """One line item as extracted from a receipt, before matching.

    `raw_name` is what the receipt prints (often truncated, e.g.
    "FRANUI FRAMBSE CHOCO" for "Franui Framboise Chocolat"). `store_key`
    is a normalized form used as the lookup key against
    `receipt_alias` :
    - Intermarché : `raw_name.casefold()` after whitespace collapsing
    - Lidl       : the `lidl_art_id` returned by the API (stable Lidl ID)
    - Carrefour  : TBD (likely raw_name normalized)

    `vat_code` is the receipt's VAT bucket (`A`/`B`/`C`/...). Used by
    Intermarché to pre-classify food vs non-food (A=5,5% reduced rate
    typically food, B=20% standard rate often non-food).
    """

    raw_name: str
    store_key: str
    quantity: int = 1
    unit_price: Decimal | None = None
    total_price: Decimal | None = None
    vat_code: str = ""

    @property
    def effective_total(self) -> Decimal:
        """Best-effort total : prefer `total_price` if set, else compute."""
        if self.total_price is not None:
            return self.total_price
        if self.unit_price is not None:
            return self.unit_price * Decimal(self.quantity)
        return Decimal("0")

    @property
    def is_likely_food(self) -> bool:
        """Heuristic : code A en France = TVA 5,5% (alimentaire). Tout autre
        code (B 20%, C 10%) est plus probablement non-alimentaire ou service.
        Le dialog de review masque par défaut les lignes non-A et l'utilisateur
        peut les inclure manuellement (ex : huile d'olive en B)."""
        return self.vat_code == "A" or self.vat_code == ""


@dataclass(frozen=False)
class ParsedReceipt:
    """A receipt extracted from one source (PDF, HTML, API JSON).

    `ticket_id` should be unique per real-world ticket (not per import) — it
    drives the anti-doublon logic. Sources :
    - Intermarché : the long numeric barcode at the bottom of the PDF
    - Lidl       : `data-return-code` (HTML) or `id` (API JSON)
    - Carrefour  : TBD

    `store` is a short slug (`intermarche` / `lidl` / `carrefour`) — used as
    the partition key in `receipt_alias.store` and `imported_receipt.store`.
    """

    store: str
    ticket_id: str | None = None
    date: datetime | None = None
    lines: list[ParsedLine] = field(default_factory=list)
    raw_text: str = ""           # for debug / fallback display
    total_eur: Decimal | None = None

    @property
    def line_count(self) -> int:
        return len(self.lines)

    @property
    def food_lines(self) -> list[ParsedLine]:
        """Subset of lines flagged as likely food (Intermarché VAT A)."""
        return [line for line in self.lines if line.is_likely_food]


@dataclass(frozen=False)
class MatchedLine:
    """A ParsedLine after matcher resolution.

    `chosen_ingredient_id` is the user's final pick (after dialog review).
    `suggestions` are the top candidates produced by the matcher — the UI
    pre-selects the best one but the user can override.

    `match_source` tells the user *why* this match was suggested :
    - "alias"      : found in `receipt_alias` (already-validated mapping)
    - "source_ref" : exact match via Source.LIDL + lidl_art_id (no fuzzy)
    - "fuzzy"      : best fuzzy match via rapidfuzz
    - "none"       : no match, user must create or pick manually
    """

    parsed: ParsedLine
    suggestions: list[int] = field(default_factory=list)   # ingredient ids, best first
    chosen_ingredient_id: int | None = None
    match_source: str = "none"
    match_score: float = 0.0     # 0.0-1.0 ; alias/source_ref = 1.0, fuzzy variable
    add_to_pantry: bool = False  # user toggle in the dialog
    expiry_date: datetime | None = None  # if add_to_pantry, optional expiry
    # Phase 4+ : EAN saisi par l'utilisateur sur la ligne (via le tableau du
    # dialog d'import). Utilisé soit pour lookup OFF immédiat, soit comme
    # source_ref si l'utilisateur clique "Créer" sans ouvrir le mini-form.
    user_barcode: str = ""
    # Refonte UX : quantité réelle saisie par l'utilisateur EN GRAMMES via le
    # `QuantityField` de la cellule Qté. 0.0 = pas encore saisi (le commit
    # tombe sur le fallback : ingredient.price_quantity_g → piece_weight_g ×
    # ticket_qty → 1000g). Si > 0, c'est cette valeur qui prime, et c'est
    # aussi elle qui alimente PantryStock.quantity_g.
    quantity_g: float = 0.0
    # Vrai si l'utilisateur a édité le prix manuellement → bloque les
    # recalculs auto de total_price quand on édite la qty (sinon une promo
    # ou un prix corrigé serait écrasé).
    user_price_override: bool = False


@dataclass(frozen=False)
class MatchedReceipt:
    """A ParsedReceipt with one MatchedLine per parsed line."""

    parsed: ParsedReceipt
    lines: list[MatchedLine] = field(default_factory=list)

    @property
    def is_duplicate(self) -> bool:
        """Set by the matcher when `parsed.ticket_id` already exists in
        `imported_receipt`. The dialog shows a warning + offers force-import."""
        return self._is_duplicate

    @is_duplicate.setter
    def is_duplicate(self, v: bool) -> None:
        self._is_duplicate = v

    _is_duplicate: bool = False
