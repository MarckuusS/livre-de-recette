"""ImportedReceiptRepo : tracking des tickets déjà importés (anti-doublon).

Une seule clé : `ticket_id` (extraite du ticket lui-même, pas de l'import).
Avant chaque import, le matcher / VM consulte `get(ticket_id)` ; s'il existe
déjà, le dialog propose à l'utilisateur d'ignorer ou de forcer l'import.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..orm import ImportedReceiptRow


class ImportedReceiptRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def get(self, ticket_id: str) -> ImportedReceiptRow | None:
        return self.s.get(ImportedReceiptRow, ticket_id)

    def exists(self, ticket_id: str) -> bool:
        return self.get(ticket_id) is not None

    def add(
        self,
        ticket_id: str,
        store: str,
        receipt_date: datetime | None,
        total_eur: Decimal | None,
        line_count: int,
    ) -> ImportedReceiptRow:
        row = ImportedReceiptRow(
            ticket_id=ticket_id,
            store=store,
            receipt_date=receipt_date,
            total_eur=total_eur,
            line_count=line_count,
        )
        self.s.add(row)
        self.s.flush()
        return row

    def list_recent(self, limit: int = 20) -> list[ImportedReceiptRow]:
        """Liste les imports les plus récents — utile pour un futur écran
        d'historique des imports (pas dans le scope Phase 1)."""
        stmt = (
            select(ImportedReceiptRow)
            .order_by(ImportedReceiptRow.imported_at.desc())
            .limit(limit)
        )
        return list(self.s.execute(stmt).scalars())
