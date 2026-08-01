"""ViewModel for OFF online/offline status (F10).

Pings `search.openfoodfacts.org` periodically (every 5 minutes by default).
Drives the small status indicator in the main window's bottom bar and
disables the "Chercher en ligne" button in the import dialog when offline.

The ping itself runs in a background thread so the UI never blocks waiting
for OFF — even when OFF is saturated and takes 30+ s to respond.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime

from PySide6.QtCore import Property, QObject, QTimer, Signal, Slot
from PySide6.QtQml import QmlElement

from app.services.openfoodfacts import is_off_alive

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1

log = logging.getLogger(__name__)

_DEFAULT_INTERVAL_MS = 5 * 60 * 1000   # 5 minutes
_INITIAL_DELAY_MS = 2_000              # 2 s — give the UI time to render first


@QmlElement
class NetworkStatusViewModel(QObject):
    """Tracks OFF connectivity. Optimistic by default (`online=True`) so the
    UI doesn't flash 'offline' for 2 seconds at startup before the first ping
    completes."""

    online_changed = Signal()
    last_checked_changed = Signal()

    def __init__(
        self,
        check_interval_ms: int = _DEFAULT_INTERVAL_MS,
        initial_delay_ms: int = _INITIAL_DELAY_MS,
        parent: QObject | None = None,
    ) -> None:
        super().__init__(parent)
        self._online: bool = True
        self._last_checked: datetime | None = None
        self._inflight: bool = False  # avoid stacking pings if a previous one is slow

        self._timer = QTimer(self)
        self._timer.setInterval(check_interval_ms)
        self._timer.timeout.connect(self.checkNow)
        self._timer.start()

        # First ping shortly after startup. `singleShot` schedules it on the
        # main event loop; the actual HTTP work runs in a background thread.
        QTimer.singleShot(initial_delay_ms, self.checkNow)

    # ============================================================ QML-facing

    @Property(bool, notify=online_changed)
    def online(self) -> bool:
        return self._online

    @Property(str, notify=last_checked_changed)
    def lastCheckedHuman(self) -> str:  # noqa: N802
        if self._last_checked is None:
            return "jamais vérifié"
        return self._last_checked.strftime("%H:%M:%S")

    @Slot()
    def checkNow(self) -> None:  # noqa: N802
        """Trigger an immediate ping. Returns immediately — the actual HTTP
        runs in a background thread to avoid blocking the UI."""
        if self._inflight:
            return  # avoid stacking
        self._inflight = True
        threading.Thread(target=self._do_check, daemon=True, name="off-ping").start()

    # ============================================================ background thread

    def _do_check(self) -> None:
        try:
            alive = is_off_alive(timeout=3.0)
        except Exception as exc:  # noqa: BLE001 — defensive; is_off_alive should not raise
            log.warning("OFF ping crashed: %s", exc, exc_info=True)
            alive = False
        # Signal emission from a worker thread is safe : Qt auto-queues to the
        # main event loop when the receiver lives on a different thread.
        self._update_state(alive)

    def _update_state(self, alive: bool) -> None:
        if self._online != alive:
            log.info("OFF status changed: %s", "online" if alive else "offline")
            self._online = alive
            self.online_changed.emit()
        self._last_checked = datetime.now()
        self.last_checked_changed.emit()
        self._inflight = False
