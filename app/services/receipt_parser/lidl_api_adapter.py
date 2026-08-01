"""Adaptateur JSON Lidl Plus API → ParsedReceipt (Plan v3, Phase 5).

La lib `lidl-plus` (PyPI) renvoie chaque ticket en JSON structuré. Cet
adapter convertit ce JSON dans notre format domaine `ParsedReceipt`, sans
dépendance à la lib elle-même — il accepte juste un `dict` Python.

C'est le seul morceau de la Phase 5 qui peut être testé sans authentifier
chez Lidl : on injecte des fixtures JSON et on vérifie que le mapping est
correct.

**Format de réponse Lidl Plus** (basé sur l'observation de la lib comm.) :

```json
{
  "id": "0888338655391103020526",
  "date": "2026-05-02T16:09:13",
  "store": {"id": "3386", "name": "AHUY Vigier"},
  "totalAmount": "35.62",
  "currency": "EUR",
  "items": [
    {
      "id": "0082231",
      "name": "Concombre",
      "quantity": "2",
      "currentUnitPrice": "1.29",
      "originalUnitPrice": "1.29",
      "currentTotalPrice": "2.58",
      "taxGroup": "5.5",
      "isWeight": false,
      "discounts": []
    },
    ...
  ]
}
```

**Notes** :
- Le champ `quantity` peut être un float (vrac au poids, ex. "0.420 kg").
  Pour l'instant on cast en `int` après round vers le bas — un yaourt à 0.5
  kg serait stocké comme `quantity=0` ce qui n'est pas idéal. À enrichir
  Phase 5+ si besoin réel.
- `taxGroup` est un str ("5.5", "20.0") — on le mappe en code TVA simple
  ("A" pour 5.5%, "B" pour 20%) pour rester cohérent avec Intermarché.
- Les `discounts` ne sont pas (encore) répercutés dans ParsedLine. Pour
  l'utilisateur c'est OK : le `currentUnitPrice` reflète déjà le prix payé.
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.domain.receipt import ParsedLine, ParsedReceipt

log = logging.getLogger(__name__)


def _to_decimal(value: Any) -> Decimal | None:
    """Cast tolérant str/int/float → Decimal. Retourne None si invalide."""
    if value is None:
        return None
    try:
        # Decimal(float) introduit du bruit binaire — passer par str
        return Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError):
        return None


def _to_int_qty(value: Any) -> int:
    """Quantité Lidl peut être '2' ou '0.420' (vrac kg). On cast en int en
    arrondissant : pour les unités c'est OK, pour le vrac on perd la précision
    mais le total_price reste correct (somme exacte ticket)."""
    if value is None:
        return 1
    try:
        f = float(str(value).replace(",", "."))
        return max(1, int(round(f)))
    except (TypeError, ValueError):
        return 1


def _tax_to_vat_code(tax_group: Any) -> str:
    """Mappe le `taxGroup` Lidl (str ou number, ex. "5.5", "20.0") vers un
    code TVA letter compatible avec notre heuristique food/non-food.

    - 5.5% → "A" (alimentaire usuel)
    - 10%  → "C" (intermédiaire — ex. restauration)
    - 20%  → "B" (taux normal — souvent non-alimentaire)
    - autre → "" (inconnu, par défaut considéré food via la heuristique)
    """
    if tax_group is None:
        return ""
    try:
        rate = float(str(tax_group).replace(",", "."))
    except (TypeError, ValueError):
        return ""
    if abs(rate - 5.5) < 0.1:
        return "A"
    if abs(rate - 20.0) < 0.5:
        return "B"
    if abs(rate - 10.0) < 0.5:
        return "C"
    return ""


def _parse_iso_date(s: Any) -> datetime | None:
    """Lidl émet des dates ISO 8601 (ex. '2026-05-02T16:09:13'). On parse en
    datetime ; si le format est inattendu on log et on retourne None."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s))
    except ValueError:
        log.warning("Format de date Lidl inattendu : %r", s)
        return None


def adapt_lidl_json(ticket_json: dict[str, Any]) -> ParsedReceipt:
    """Convertit un dict JSON ticket Lidl en `ParsedReceipt`.

    Tolérant aux champs manquants : un ticket dégradé donnera un
    `ParsedReceipt` partiel mais non-pétant. C'est mieux que de lever pour
    rien — le dialog de review affiche ce qu'il y a et l'utilisateur peut
    décider.

    Pas de DB ici, pas de Qt ici — juste data → data. Testable trivialement.
    """
    items_raw = ticket_json.get("items", []) or []

    lines: list[ParsedLine] = []
    for item in items_raw:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or "").strip()
        art_id = (item.get("id") or "").strip()
        if not name and not art_id:
            continue   # ligne totalement vide, on saute

        unit_price = _to_decimal(item.get("currentUnitPrice"))
        total_price = _to_decimal(item.get("currentTotalPrice"))
        quantity = _to_int_qty(item.get("quantity"))
        vat_code = _tax_to_vat_code(item.get("taxGroup"))

        # Si on n'a que le total, on déduit l'unitaire par division ;
        # à l'inverse si on n'a que l'unitaire, on calcule le total.
        if total_price is None and unit_price is not None and quantity:
            total_price = unit_price * Decimal(quantity)
        if unit_price is None and total_price is not None and quantity:
            unit_price = total_price / Decimal(quantity)

        lines.append(ParsedLine(
            raw_name=name or f"Article {art_id}",
            store_key=art_id or name.casefold(),   # art_id stable si dispo
            quantity=quantity,
            unit_price=unit_price,
            total_price=total_price,
            vat_code=vat_code,
        ))

    return ParsedReceipt(
        store="lidl",
        ticket_id=(ticket_json.get("id") or "").strip() or None,
        date=_parse_iso_date(ticket_json.get("date")),
        lines=lines,
        raw_text="",   # pas de raw_text utile (on a déjà le JSON struct)
        total_eur=_to_decimal(ticket_json.get("totalAmount")),
    )


__all__ = ["adapt_lidl_json"]
