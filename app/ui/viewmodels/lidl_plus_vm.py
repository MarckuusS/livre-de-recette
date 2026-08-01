"""ViewModel pilotant l'auto-fetch Lidl Plus (Plan v3, Phase 5).

Responsabilités :
- État UI : enabled / connected / last_fetched_at / pending_tickets_count
- Setup : bouton "Tester la connexion" (lit le refresh_token stocké)
- Polling : timer Qt qui appelle `lidl_plus_client.fetch_recent_tickets`
  toutes les N minutes (configurable, default 60)
- Sync manuelle : bouton "Synchroniser maintenant" (idem mais à la demande)
- Anti-doublon : pour chaque ticket reçu, on filtre via `imported_receipt`
  avant d'enqueue dans le `ReceiptImportViewModel`
- Erreur explicite : si la lib lève, on persiste le message dans `last_error`
  et on l'expose au QML — pas de toast silencieux, pas de retry agressif

Le polling HTTP tourne dans un **thread background** (comme `network_vm`)
pour ne jamais bloquer l'UI.

**État de cette feature** : EXPÉRIMENTAL. La lib `lidl-plus` est testée pour
DE/AT/UK ; le support FR n'est pas garanti. En cas d'échec, l'utilisateur
peut toujours saisir manuellement (Phases 1-4) sans perte de fonctionnalité.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime
from typing import Any

from PySide6.QtCore import Property, QObject, QTimer, Signal, Slot
from PySide6.QtQml import QmlElement

from app.data.repositories import ImportedReceiptRepo, LidlPlusSettingsRepo
from app.services import lidl_plus_client
from app.ui.app_context import AppContext

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1

log = logging.getLogger(__name__)

_DEFAULT_INTERVAL_MS = 60 * 60 * 1000   # 1 h


@QmlElement
class LidlPlusViewModel(QObject):
    """Pilote l'intégration API Lidl. Le polling reste opt-in : tant que
    l'utilisateur n'a pas activé `enabled`, aucune requête réseau n'est faite."""

    state_changed = Signal()           # toute mutation de l'état persistant
    sync_started = Signal()
    sync_completed = Signal(int, str)  # (nb_new_tickets, message)
    error_emitted = Signal(str)
    new_tickets_pending = Signal(list) # liste de ticket_ids prêts à l'import

    def __init__(
        self, ctx: AppContext | None = None, parent: QObject | None = None,
    ) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self._inflight = False         # évite double-sync concurrente
        self._pending_ticket_ids: list[str] = []
        self._last_error: str = ""

        # Timer Qt — son intervalle est piloté par les settings DB.
        self._timer = QTimer(self)
        self._timer.timeout.connect(self.syncNow)
        # Pas de start() ici : on démarre seulement si `enabled=True` au boot.

    def start_if_enabled(self) -> None:
        """À appeler une fois après `__init__` (typiquement depuis main.py)
        pour mettre le timer en route si l'utilisateur a activé l'auto-fetch
        lors d'une session précédente. Idempotent."""
        if self.ctx is None or not lidl_plus_client.is_available():
            return
        with self.ctx.session() as s:
            settings = LidlPlusSettingsRepo(s).get()
        if settings.enabled:
            self._timer.setInterval(settings.poll_interval_minutes * 60 * 1000)
            self._timer.start()
            log.info(
                "Lidl Plus auto-fetch enabled (interval=%d min). "
                "First sync will run in %d s.",
                settings.poll_interval_minutes,
                _DEFAULT_INTERVAL_MS // 1000 // 4,
            )
            # Première sync différée pour ne pas bloquer le boot.
            QTimer.singleShot(15_000, self.syncNow)

    # ============================================================ Properties

    @Property(bool, notify=state_changed)
    def isAvailable(self) -> bool:  # noqa: N802
        """True si la lib `lidl-plus` est installée. Sinon le QML grise le toggle."""
        return lidl_plus_client.is_available()

    @Property(bool, notify=state_changed)
    def isKeyringAvailable(self) -> bool:  # noqa: N802
        return lidl_plus_client.is_keyring_available()

    @Property(bool, notify=state_changed)
    def isConnected(self) -> bool:  # noqa: N802
        """True si un refresh_token est stocké. Pas de validation réseau ici —
        seul `syncNow` peut révéler que le token est expiré."""
        return lidl_plus_client.get_stored_credentials().has_refresh_token

    @Property(str, notify=state_changed)
    def connectedEmail(self) -> str:  # noqa: N802
        return lidl_plus_client.get_stored_credentials().email or ""

    @Property(bool, notify=state_changed)
    def enabled(self) -> bool:
        if self.ctx is None:
            return False
        with self.ctx.session() as s:
            return LidlPlusSettingsRepo(s).get().enabled

    @Property(int, notify=state_changed)
    def pollIntervalMinutes(self) -> int:  # noqa: N802
        if self.ctx is None:
            return 60
        with self.ctx.session() as s:
            return LidlPlusSettingsRepo(s).get().poll_interval_minutes

    @Property(str, notify=state_changed)
    def lastFetchedHuman(self) -> str:  # noqa: N802
        if self.ctx is None:
            return ""
        with self.ctx.session() as s:
            at = LidlPlusSettingsRepo(s).get().last_fetched_at
        return at.strftime("%d/%m/%Y %H:%M") if at else "Jamais"

    @Property(str, notify=state_changed)
    def lastError(self) -> str:  # noqa: N802
        return self._last_error

    @Property(int, notify=state_changed)
    def pendingTicketCount(self) -> int:  # noqa: N802
        return len(self._pending_ticket_ids)

    @Property(bool, notify=state_changed)
    def isSyncing(self) -> bool:  # noqa: N802
        return self._inflight

    # ============================================================ Slots

    @Slot(bool)
    def setEnabled(self, value: bool) -> None:  # noqa: N802
        """Active/désactive l'auto-fetch. Persiste en DB ET arme/désarme le
        timer Qt en conséquence."""
        if self.ctx is None:
            return
        with self.ctx.session() as s:
            repo = LidlPlusSettingsRepo(s)
            repo.set_enabled(value)
            interval_min = repo.get().poll_interval_minutes
            s.commit()
        if value:
            if not lidl_plus_client.is_available():
                self.error_emitted.emit(
                    "Activation impossible : la lib `lidl-plus` n'est pas installée.",
                )
                # Re-flip OFF pour cohérence
                with self.ctx.session() as s2:
                    LidlPlusSettingsRepo(s2).set_enabled(False)
                    s2.commit()
                self.state_changed.emit()
                return
            self._timer.setInterval(interval_min * 60 * 1000)
            self._timer.start()
            log.info("Lidl Plus polling enabled.")
        else:
            self._timer.stop()
            log.info("Lidl Plus polling disabled.")
        self.state_changed.emit()

    @Slot(int)
    def setPollIntervalMinutes(self, minutes: int) -> None:  # noqa: N802
        if self.ctx is None or minutes < 5:
            return
        with self.ctx.session() as s:
            LidlPlusSettingsRepo(s).set_poll_interval(minutes)
            s.commit()
        self._timer.setInterval(minutes * 60 * 1000)
        self.state_changed.emit()

    @Slot(str, str, result=bool)
    def storeCredentials(self, email: str, refresh_token: str) -> bool:  # noqa: N802
        """Persiste un refresh_token obtenu côté QML (ex: après le flow
        captcha). Retourne True/False ; en cas d'échec émet error_emitted."""
        try:
            lidl_plus_client.store_credentials(email.strip(), refresh_token.strip())
        except lidl_plus_client.LidlPlusError as exc:
            self.error_emitted.emit(str(exc))
            return False
        self.state_changed.emit()
        return True

    @Slot()
    def purgeCredentials(self) -> None:  # noqa: N802
        """Bouton 'Désactiver et oublier' : enlève le refresh_token + désactive
        le polling. Sécurité : ça doit être facile à faire."""
        lidl_plus_client.purge_credentials()
        if self.ctx is not None:
            with self.ctx.session() as s:
                LidlPlusSettingsRepo(s).set_enabled(False)
                s.commit()
        self._timer.stop()
        self.state_changed.emit()

    @Slot()
    def syncNow(self) -> None:  # noqa: N802
        """Déclenche une sync manuelle. Lance le fetch dans un thread daemon
        pour ne pas bloquer l'UI ; émet `sync_completed` à la fin (succès ou
        échec)."""
        if self._inflight:
            log.debug("Sync skipped (already in flight)")
            return
        self._inflight = True
        self.sync_started.emit()
        self.state_changed.emit()
        threading.Thread(target=self._sync_worker, daemon=True).start()

    def _sync_worker(self) -> None:
        """Exécuté dans un thread background. Aucun signal Qt ne touche l'UI
        directement depuis ici — on collecte les résultats puis on appelle
        `_finish_sync` via QTimer.singleShot(0) sur le thread principal.

        Wait — ça poserait le même bug que dans le watcher (QTimer hors thread
        Qt). Heureusement, `Signal.emit()` est thread-safe : si le slot
        connecté vit dans le main thread, Qt route via QueuedConnection.
        Donc on émet directement depuis ce thread.
        """
        nb_new = 0
        msg = ""
        new_ids: list[str] = []
        try:
            tickets = lidl_plus_client.fetch_recent_tickets(limit=20)

            # Anti-doublon : on garde uniquement les ticket_ids pas encore
            # importés. La table `imported_receipt` est notre vérité.
            if self.ctx is not None:
                with self.ctx.session() as s:
                    repo = ImportedReceiptRepo(s)
                    new_ids = [
                        str(t.get("id", ""))
                        for t in tickets
                        if t.get("id") and not repo.exists(str(t["id"]))
                    ]
                    LidlPlusSettingsRepo(s).mark_fetched(datetime.now())
                    s.commit()

            self._pending_ticket_ids = new_ids
            nb_new = len(new_ids)
            self._last_error = ""
            msg = (
                f"{nb_new} nouveau{'x' if nb_new > 1 else ''} ticket"
                f"{'s' if nb_new > 1 else ''} Lidl"
                if nb_new
                else "Sync OK — aucun nouveau ticket."
            )
        except lidl_plus_client.LidlPlusError as exc:
            self._last_error = str(exc)
            if self.ctx is not None:
                with self.ctx.session() as s:
                    LidlPlusSettingsRepo(s).mark_error(str(exc))
                    s.commit()
            log.warning("Lidl Plus sync failed: %s", exc)
            msg = str(exc)
            self.error_emitted.emit(msg)
        except Exception as exc:   # noqa: BLE001
            # Catch-all pour ne JAMAIS planter le timer / l'app sur une
            # exception inattendue (lib qui throw n'importe quoi).
            self._last_error = f"Erreur inattendue : {exc}"
            log.exception("Unexpected error in Lidl Plus sync")
            msg = self._last_error
            self.error_emitted.emit(msg)
        finally:
            self._inflight = False
            self.state_changed.emit()
            self.sync_completed.emit(nb_new, msg)
            if new_ids:
                self.new_tickets_pending.emit(new_ids)

    @Slot(str, result="QVariantMap")
    def fetchTicketDetailAsDict(self, ticket_id: str) -> dict[str, Any]:  # noqa: N802
        """Récupère un ticket précis (par ID) et retourne son JSON brut au
        QML pour transmission au `ReceiptImportViewModel`. Pas de DB write
        ici — c'est le commit du dialog d'import qui persistera."""
        try:
            return lidl_plus_client.fetch_ticket_detail(ticket_id)
        except lidl_plus_client.LidlPlusError as exc:
            self._last_error = str(exc)
            self.error_emitted.emit(str(exc))
            return {}

    @Slot(result="QVariantList")
    def pendingTicketIds(self) -> list[str]:  # noqa: N802
        return list(self._pending_ticket_ids)

    @Slot(str)
    def removePendingTicketId(self, ticket_id: str) -> None:  # noqa: N802
        """Retire un ticket de la liste des pendings (après import réussi)."""
        if ticket_id in self._pending_ticket_ids:
            self._pending_ticket_ids.remove(ticket_id)
            self.state_changed.emit()
