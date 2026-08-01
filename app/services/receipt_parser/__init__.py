"""Receipt parsing dispatch (Plan v3).

Détecte le format du fichier d'entrée et délègue au bon parser :
- `.pdf` avec mots-clés "Intermarché" → `intermarche_parser`
- `.pdf` avec mots-clés "Carrefour"   → `carrefour_parser` (Phase 3)
- `.html` ou `.htm`                    → format-specific (à venir)

Si la détection échoue, lève `UnknownReceiptFormat`. Le dialog d'import
expose alors un message clair à l'utilisateur ("Format non reconnu — vérifie
que c'est bien un ticket Intermarché ou Carrefour").
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.domain.receipt import ParsedReceipt

from .intermarche_parser import parse_intermarche_pdf

log = logging.getLogger(__name__)


class UnknownReceiptFormat(ValueError):
    """Le format du fichier n'est reconnu par aucun parser."""


def parse_receipt(path: Path) -> ParsedReceipt:
    """Parse un fichier ticket en détectant automatiquement son format.

    Stratégie de détection :
    1. Extension du fichier (rapide, mais ambigu pour les PDFs multi-enseignes)
    2. Si PDF : on extrait le texte et on cherche des mots-clés dans le header
       ('INTERMARCHE', 'CARREFOUR', etc.)
    3. Si on ne trouve rien → UnknownReceiptFormat

    Phase 1 : seul Intermarché PDF est implémenté. Carrefour viendra en
    Phase 3, Lidl reste sur l'API en Phase 5 (pas de parser fichier).
    """
    if not path.exists():
        raise FileNotFoundError(f"Fichier introuvable : {path}")

    suffix = path.suffix.lower()
    if suffix == ".pdf":
        # Lecture rapide du texte pour détecter l'enseigne dans le header.
        # On utilise pdfplumber (déjà chargé pour le parser Intermarché lui-même).
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            head = (pdf.pages[0].extract_text() or "")[:500].upper() if pdf.pages else ""

        if "INTERMARCH" in head or "FONTAINE-LES-DIJON" in head:
            return parse_intermarche_pdf(path)
        if "CARREFOUR" in head:
            log.warning("Ticket Carrefour détecté mais le parser n'est pas encore implémenté (Phase 3)")
            raise UnknownReceiptFormat(
                "Carrefour n'est pas encore supporté (Phase 3 du plan)."
            )
        raise UnknownReceiptFormat(
            f"PDF non reconnu : ni Intermarché ni Carrefour. "
            f"En-tête extrait : {head[:120]!r}"
        )

    raise UnknownReceiptFormat(
        f"Extension non supportée : {suffix}. Formats acceptés : .pdf"
    )


__all__ = ["parse_receipt", "UnknownReceiptFormat", "parse_intermarche_pdf"]
