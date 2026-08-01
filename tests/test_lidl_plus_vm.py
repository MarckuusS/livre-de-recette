"""Tests du `LidlPlusViewModel` (Plan v3, Phase 5).

On injecte un fake client Lidl via `_inject_client_factory` pour ne PAS
toucher à la vraie API. Les tests vérifient :
- l'état exposé au QML (enabled, isConnected…)
- le toggle enable/disable persiste
- syncNow filtre via anti-doublon
- une LidlPlusError est propagée en `last_error` + signal QML
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from app.data.repositories import (
    ImportedReceiptRepo,
    LidlPlusSettingsRepo,
)
from app.services import lidl_plus_client
from app.ui.viewmodels.lidl_plus_vm import LidlPlusViewModel


# ============================================================ Fakes


class _FakeLidlClient:
    def __init__(self, tickets: list[dict[str, Any]]) -> None:
        self._tickets = tickets

    def tickets(self) -> list[dict[str, Any]]:
        return self._tickets

    def ticket(self, ticket_id: str) -> dict[str, Any]:
        for t in self._tickets:
            if t.get("id") == ticket_id:
                return t
        raise RuntimeError(f"Ticket {ticket_id} not found in fake")


@pytest.fixture
def lidl_fake(monkeypatch):
    """Patch la factory pour injecter un fake. Restaure en teardown."""
    fake_tickets = [
        {"id": "TICKET-1", "date": "2026-05-02T10:00", "items": []},
        {"id": "TICKET-2", "date": "2026-05-01T10:00", "items": []},
    ]
    fake_client = _FakeLidlClient(fake_tickets)
    lidl_plus_client._inject_client_factory(lambda: fake_client)
    # Force is_available() à retourner True même sans la vraie lib
    monkeypatch.setattr(lidl_plus_client, "is_available", lambda: True)
    yield fake_client
    lidl_plus_client._reset_client_factory()


@pytest.fixture
def lidl_keyring_stub(monkeypatch):
    """Stub keyring : in-memory dict, pas de vraie I/O OS."""
    storage: dict[tuple[str, str], str] = {}

    monkeypatch.setattr(lidl_plus_client, "is_keyring_available", lambda: True)

    def _set(service: str, key: str, value: str) -> None:
        storage[(service, key)] = value

    def _get(service: str, key: str) -> str | None:
        return storage.get((service, key))

    def _delete(service: str, key: str) -> None:
        storage.pop((service, key), None)

    # Le module `keyring` est importé lazy dans le client → on patche le module
    # global après son premier import.
    import sys
    import types
    fake_keyring = types.ModuleType("keyring")
    fake_keyring.set_password = _set
    fake_keyring.get_password = _get
    fake_keyring.delete_password = _delete
    sys.modules["keyring"] = fake_keyring
    yield storage
    sys.modules.pop("keyring", None)


# ============================================================ State / properties


def test_vm_enabled_default_false(app_ctx) -> None:
    vm = LidlPlusViewModel(app_ctx)
    assert vm.enabled is False
    assert vm.pollIntervalMinutes == 60


def test_vm_set_enabled_persists(app_ctx, lidl_fake) -> None:
    vm = LidlPlusViewModel(app_ctx)
    vm.setEnabled(True)
    assert vm.enabled is True

    # Re-instantier doit lire l'état depuis la DB
    vm2 = LidlPlusViewModel(app_ctx)
    assert vm2.enabled is True


def test_vm_enabled_refused_if_lib_missing(app_ctx, monkeypatch) -> None:
    """Si la lib n'est pas dispo, setEnabled(True) doit émettre une erreur
    et garder enabled=False."""
    monkeypatch.setattr(lidl_plus_client, "is_available", lambda: False)
    vm = LidlPlusViewModel(app_ctx)

    received: list[str] = []
    vm.error_emitted.connect(received.append)
    vm.setEnabled(True)

    assert vm.enabled is False
    assert any("lidl-plus" in m.lower() for m in received)


def test_vm_set_poll_interval_persists(app_ctx) -> None:
    vm = LidlPlusViewModel(app_ctx)
    vm.setPollIntervalMinutes(120)
    assert vm.pollIntervalMinutes == 120

    # Garde-fou anti-DDOS : refuse < 5 min
    vm.setPollIntervalMinutes(2)
    assert vm.pollIntervalMinutes == 120   # n'a pas changé


# ============================================================ Sync


def test_vm_sync_filters_already_imported(app_ctx, lidl_fake) -> None:
    """Un ticket déjà importé n'apparaît PAS dans pending_ticket_ids.

    On invoque `_sync_worker` directement (synchrone) plutôt que `syncNow()`
    qui spawn un thread — SQLite in-memory ne partage pas son état entre
    threads, et la logique testée ne dépend pas du threading lui-même."""
    with app_ctx.session() as s:
        ImportedReceiptRepo(s).add(
            ticket_id="TICKET-1", store="lidl",
            receipt_date=None, total_eur=None, line_count=0,
        )
        s.commit()

    vm = LidlPlusViewModel(app_ctx)
    completed: list[tuple[int, str]] = []
    vm.sync_completed.connect(lambda n, msg: completed.append((n, msg)))

    vm._sync_worker()
    assert completed, "sync_completed signal should have fired"
    nb, _msg = completed[0]
    assert nb == 1   # seul TICKET-2 est nouveau
    assert "TICKET-2" in vm.pendingTicketIds()
    assert "TICKET-1" not in vm.pendingTicketIds()


def test_vm_sync_handles_lidl_plus_error(app_ctx, monkeypatch) -> None:
    """Erreur du client → last_error renseigné + signal error_emitted émis."""
    monkeypatch.setattr(lidl_plus_client, "is_available", lambda: True)

    def _failing_client() -> None:
        raise lidl_plus_client.LidlPlusError("API cassée — mettre à jour la lib.")

    lidl_plus_client._inject_client_factory(_failing_client)
    try:
        vm = LidlPlusViewModel(app_ctx)
        errors: list[str] = []
        vm.error_emitted.connect(errors.append)

        vm._sync_worker()

        assert "API cassée" in vm.lastError
        assert any("API cassée" in e for e in errors)
        with app_ctx.session() as s:
            assert "API cassée" in (LidlPlusSettingsRepo(s).get().last_error or "")
    finally:
        lidl_plus_client._reset_client_factory()


def test_vm_sync_now_does_not_double_run(app_ctx, lidl_fake, qtbot) -> None:
    """Si une sync est en cours, un second appel est ignoré (no-op)."""
    vm = LidlPlusViewModel(app_ctx)
    vm._inflight = True

    completed: list[tuple[int, str]] = []
    vm.sync_completed.connect(lambda n, msg: completed.append((n, msg)))

    vm.syncNow()
    qtbot.wait(150)   # rien ne se passe
    assert completed == []


def test_vm_sync_clears_error_on_success(app_ctx, lidl_fake) -> None:
    """Une sync OK efface le last_error précédent."""
    with app_ctx.session() as s:
        LidlPlusSettingsRepo(s).mark_error("Old error")
        s.commit()

    vm = LidlPlusViewModel(app_ctx)
    vm._sync_worker()

    with app_ctx.session() as s:
        assert LidlPlusSettingsRepo(s).get().last_error is None


# ============================================================ Credentials


def test_vm_store_and_purge_credentials(
    app_ctx, lidl_keyring_stub, monkeypatch,
) -> None:
    monkeypatch.setattr(lidl_plus_client, "is_available", lambda: True)
    vm = LidlPlusViewModel(app_ctx)

    assert vm.isConnected is False
    assert vm.connectedEmail == ""

    ok = vm.storeCredentials("user@example.fr", "REFRESH-TOKEN-123")
    assert ok is True
    assert vm.isConnected is True
    assert vm.connectedEmail == "user@example.fr"

    vm.purgeCredentials()
    assert vm.isConnected is False
    assert vm.connectedEmail == ""


def test_vm_store_credentials_fails_without_keyring(
    app_ctx, monkeypatch,
) -> None:
    monkeypatch.setattr(lidl_plus_client, "is_keyring_available", lambda: False)
    vm = LidlPlusViewModel(app_ctx)
    errors: list[str] = []
    vm.error_emitted.connect(errors.append)

    ok = vm.storeCredentials("u@e.fr", "TOKEN")
    assert ok is False
    assert any("keyring" in e.lower() for e in errors)
