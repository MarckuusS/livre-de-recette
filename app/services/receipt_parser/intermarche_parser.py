"""Parser PDF pour les tickets de caisse Intermarché.

Le PDF Intermarché contient du texte natif (pas une image scannée). On extrait
via `pdfplumber` puis on parse ligne par ligne avec des regex hand-tuned sur
le format Intermarché observé en mai 2026.

Format de référence (sample fourni par l'utilisateur, magasin Fontaine-lès-Dijon) :

    SAS GREECE-25
    RUE DES PRES POTETS
    21121 FONTAINE-LES-DIJON
    ...
    FRANUI FRAMBSE CHOCO     6,06 EUR A
    L'ANGELYS SORB ORASA     5,29 EUR A
    DOM LOUCHE INOX          3,70 EUR B
    ELEPHANT KIT DE LAVA    25,99 EUR B
    PAT CREME UHT SE 18%     2,09 EUR A
        MONTANT DU          43,13 EUR
    ...
    16:35:41 2/05/2026
    202605021635010402310718  ← ticket id (18-24 chiffres)

Limitations connues (à enrichir avec d'autres samples) :
- Multi-quantité : non vérifiée. Si format `YAOURT NATURE 3x1,25 = 3,75`,
  parser à enrichir.
- Vrac au poids : non vérifié. Format probable
  `TOMATES 0,420 kg x 4,50 = 1,89` à supporter.
- Promotions / remises : non vérifiées sur ce sample.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pdfplumber

from app.domain.receipt import ParsedLine, ParsedReceipt

log = logging.getLogger(__name__)


# Ligne d'article : "<NOM>  <PRIX>,XX EUR <CODE_TVA>"
# - <NOM> : 2-40 caractères, lazy (s'arrête au premier groupe d'espaces avant
#           le pattern prix). Le PDF d'Intermarché utilise des espaces simples
#           dans le texte extrait par pdfplumber (les doubles espaces visuels
#           du ticket sont normalisés).
# - <PRIX> : nombre avec virgule décimale, suivi de " EUR " puis code TVA en majuscule
# Le moteur regex utilise le pattern lazy `(.{2,40}?)` ; il prend le minimum
# possible et laisse le suffixe `\s+\d+,\d{2}\s+EUR\s+[A-Z]` ancrer la position.
_ARTICLE_RE = re.compile(
    r'^(.{2,40}?)\s+(\d+,\d{2})\s+EUR\s+([A-Z])\s*$',
    re.MULTILINE,
)

# Date+heure du footer : "16:35:41 2/05/2026"
_DATE_RE = re.compile(
    r'(\d{2}):(\d{2}):(\d{2})\s+(\d{1,2})/(\d{1,2})/(\d{4})'
)

# ID du ticket : 18-24 chiffres seuls sur leur ligne (le barcode du footer)
_TICKET_ID_RE = re.compile(r'^(\d{18,24})$', re.MULTILINE)

# Total payé : "MONTANT DU  43,13 EUR" — utilisé pour reporter le total
_TOTAL_RE = re.compile(
    r'MONTANT\s+DU\s+(\d+,\d{2})\s+EUR',
    re.IGNORECASE,
)


def parse_intermarche_pdf(path: Path) -> ParsedReceipt:
    """Extrait un ticket Intermarché depuis un PDF natif.

    Lève `ValueError` si aucune ligne d'article n'est trouvée — typiquement
    signe que le PDF n'est pas un ticket Intermarché ou que le format a
    changé.
    """
    with pdfplumber.open(path) as pdf:
        text = "\n".join((p.extract_text() or "") for p in pdf.pages)

    if not text.strip():
        raise ValueError(
            "PDF Intermarché vide ou non extractible — vérifie qu'il s'agit "
            "bien d'un PDF avec texte natif (pas une image scannée)."
        )

    lines: list[ParsedLine] = []
    for m in _ARTICLE_RE.finditer(text):
        raw_name, price_str, vat_code = m.groups()
        raw_name = raw_name.strip()
        # On normalise le nom comme clé d'alias : casefold + collapse whitespace.
        # "FRANUI  FRAMBSE  CHOCO" → "franui frambse choco"
        store_key = " ".join(raw_name.split()).casefold()
        price = Decimal(price_str.replace(",", "."))
        lines.append(ParsedLine(
            raw_name=raw_name,
            store_key=store_key,
            quantity=1,                 # Intermarché : 1 ligne = 1 article (vrai sur le sample)
            unit_price=price,
            total_price=price,
            vat_code=vat_code,
        ))

    if not lines:
        raise ValueError(
            "Aucune ligne d'article détectée dans le PDF — format peut-être "
            "modifié. Texte extrait (premiers 300 chars) : "
            + repr(text[:300])
        )

    date = _extract_date(text)
    ticket_id = _extract_ticket_id(text)
    total = _extract_total(text)

    log.info(
        "Parsed Intermarché receipt: %d lines, total=%s, date=%s, ticket_id=%s",
        len(lines), total, date, ticket_id,
    )
    return ParsedReceipt(
        store="intermarche",
        ticket_id=ticket_id,
        date=date,
        lines=lines,
        raw_text=text,
        total_eur=total,
    )


def _extract_date(text: str) -> datetime | None:
    m = _DATE_RE.search(text)
    if m is None:
        return None
    h, mn, s, d, mo, y = (int(g) for g in m.groups())
    try:
        return datetime(y, mo, d, h, mn, s)
    except ValueError:
        return None


def _extract_ticket_id(text: str) -> str | None:
    m = _TICKET_ID_RE.search(text)
    return m.group(1) if m is not None else None


def _extract_total(text: str) -> Decimal | None:
    m = _TOTAL_RE.search(text)
    if m is None:
        return None
    try:
        return Decimal(m.group(1).replace(",", "."))
    except Exception:
        return None
