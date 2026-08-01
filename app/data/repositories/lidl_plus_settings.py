"""Repository for Lidl Plus auto-fetch settings (Plan v3, Phase 5).

Singleton-style table : il n'existe qu'une seule ligne (PK=1). Le repo expose
get/upsert + helpers pour mettre à jour `last_fetched_at` et `last_error`
sans toucher au reste de la config.

Les **credentials** (refresh token, email, password) ne sont JAMAIS dans
cette DB — uniquement dans le Windows Credential Manager via `keyring`.
Ici on garde juste ce qui peut être en clair sans risque de sécurité.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..orm import LidlPlusSettingsRow


@dataclass
class LidlPlusSettings:
    """Snapshot domaine des settings (immutable côté lecture). Le repo upsert
    accepte un nouveau snapshot et le persiste."""
    enabled: bool = False
    poll_interval_minutes: int = 60
    last_fetched_at: datetime | None = None
    last_error: str | None = None


class LidlPlusSettingsRepo:
    """Singleton row : `id=1`. Le repo crée la ligne au premier accès (lazy
    upsert) pour que le caller n'ait jamais à gérer le cas 'pas encore
    initialisé'."""

    PK = 1

    def __init__(self, session: Session) -> None:
        self.s = session

    def _row(self) -> LidlPlusSettingsRow:
        row = self.s.get(LidlPlusSettingsRow, self.PK)
        if row is None:
            row = LidlPlusSettingsRow(id=self.PK, enabled=0, poll_interval_minutes=60)
            self.s.add(row)
            self.s.flush()   # garantit que la ligne existe avant le commit final
        return row

    def get(self) -> LidlPlusSettings:
        row = self._row()
        return LidlPlusSettings(
            enabled=bool(row.enabled),
            poll_interval_minutes=row.poll_interval_minutes,
            last_fetched_at=row.last_fetched_at,
            last_error=row.last_error,
        )

    def set_enabled(self, value: bool) -> None:
        row = self._row()
        row.enabled = 1 if value else 0

    def set_poll_interval(self, minutes: int) -> None:
        row = self._row()
        row.poll_interval_minutes = max(5, int(minutes))   # min 5 min, jamais < pour DDOS

    def mark_fetched(self, at: datetime | None = None) -> None:
        row = self._row()
        row.last_fetched_at = at or datetime.now()
        row.last_error = None

    def mark_error(self, message: str) -> None:
        row = self._row()
        row.last_error = message[:500]   # garde-fou taille
