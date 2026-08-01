"""ViewModel for the DB backup / restore flow.

Exposes the list of backups to QML and handles the restore action. The restore
itself does NOT relaunch the app — QML is responsible for showing a "restart
required" message and calling `Qt.quit()` after the user acknowledges.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from PySide6.QtCore import QObject, Signal, Slot
from PySide6.QtQml import QmlElement

from app.data.db import (
    default_backup_dir,
    list_backups,
    restore_from_backup,
)

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1

log = logging.getLogger(__name__)


@QmlElement
class BackupViewModel(QObject):
    """Lists backups and orchestrates the restore. Stateless apart from emitting
    signals when QML asks for refreshed data."""

    error_emitted = Signal(str)
    restored = Signal(str)  # path of the safety backup taken before restoring

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)

    @Slot(result="QVariantList")
    def listBackups(self) -> list[dict[str, Any]]:  # noqa: N802
        """Return all backups newest-first. Each entry has `path`, `name`,
        `timestampIso`, `sizeBytes`, `humanSize`."""
        items = list_backups()
        return [
            {
                "path":         entry["path"],
                "name":         entry["name"],
                "timestampIso": entry["timestamp"].isoformat(timespec="seconds"),
                "timestampHuman": entry["timestamp"].strftime("%d/%m/%Y à %Hh%M"),
                "sizeBytes":    entry["sizeBytes"],
                "humanSize":    _format_size(entry["sizeBytes"]),
            }
            for entry in items
        ]

    @Slot(str, result=bool)
    def restoreFromPath(self, backup_path: str) -> bool:  # noqa: N802
        """Restore the live DB from the given backup path. Returns True on success.
        The app MUST be relaunched after this call (the live engine is now stale)."""
        try:
            safety = restore_from_backup(Path(backup_path))
        except FileNotFoundError as exc:
            self.error_emitted.emit(f"Sauvegarde introuvable : {exc}")
            return False
        except Exception as exc:  # noqa: BLE001
            log.error("Restore failed: %s", exc, exc_info=True)
            self.error_emitted.emit(f"Erreur lors de la restauration : {exc}")
            return False
        self.restored.emit(str(safety))
        return True

    @Slot(result=str)
    def backupDirectory(self) -> str:  # noqa: N802
        """Path of the backup directory, for display in the UI."""
        return str(default_backup_dir())


def _format_size(n: int) -> str:
    """Human-readable file size (KB / MB)."""
    if n < 1024:
        return f"{n} o"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} Ko"
    return f"{n / (1024 * 1024):.1f} Mo"
