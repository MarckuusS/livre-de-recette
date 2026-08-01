"""Tests for OFF reachability check (F10).

`is_off_alive` is HTTP-bound — we don't hit the real network in unit tests.
We patch httpx.Client.head to simulate success / timeout / error responses.

The viewmodel itself is exercised via its public Python API (`_update_state`)
without firing the actual ping (which is in `_do_check`). Threading + Qt
event loops are out of scope here ; the integration smoke-test verifies the
end-to-end flow.
"""

from __future__ import annotations

import httpx
import pytest

from app.services.openfoodfacts import is_off_alive


# ============================================================ is_off_alive


def test_is_off_alive_returns_true_on_2xx(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Resp:
        status_code = 200

    def fake_get(self, url, *args, **kwargs):
        return _Resp()

    monkeypatch.setattr(httpx.Client, "get", fake_get)
    assert is_off_alive(timeout=1.0) is True


def test_is_off_alive_returns_true_on_3xx(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Resp:
        status_code = 301

    monkeypatch.setattr(httpx.Client, "get", lambda self, url, *a, **kw: _Resp())
    assert is_off_alive(timeout=1.0) is True


def test_is_off_alive_returns_false_on_5xx(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Resp:
        status_code = 503

    monkeypatch.setattr(httpx.Client, "get", lambda self, url, *a, **kw: _Resp())
    assert is_off_alive(timeout=1.0) is False


def test_is_off_alive_returns_false_on_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get(self, url, *a, **kw):
        raise httpx.TimeoutException("simulated")

    monkeypatch.setattr(httpx.Client, "get", fake_get)
    assert is_off_alive(timeout=0.5) is False


def test_is_off_alive_returns_false_on_connect_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get(self, url, *a, **kw):
        raise httpx.ConnectError("simulated")

    monkeypatch.setattr(httpx.Client, "get", fake_get)
    assert is_off_alive(timeout=0.5) is False


def test_is_off_alive_swallows_oserror(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get(self, url, *a, **kw):
        raise OSError("disk on fire")

    monkeypatch.setattr(httpx.Client, "get", fake_get)
    assert is_off_alive(timeout=0.5) is False


# ============================================================ NetworkStatusViewModel


def test_network_vm_initial_state_optimistic_online() -> None:
    """Avoid flashing 'offline' for 2 s at startup before the first ping
    completes."""
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])
    from app.ui.viewmodels.network_vm import NetworkStatusViewModel
    # Disable the timer/initial check by setting huge values
    vm = NetworkStatusViewModel(check_interval_ms=10**9, initial_delay_ms=10**9)
    assert vm.online is True
    assert vm.lastCheckedHuman == "jamais vérifié"


def test_network_vm_update_state_emits_only_on_change() -> None:
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])
    from app.ui.viewmodels.network_vm import NetworkStatusViewModel
    vm = NetworkStatusViewModel(check_interval_ms=10**9, initial_delay_ms=10**9)

    online_emissions: list = []
    last_check_emissions: list = []
    vm.online_changed.connect(lambda: online_emissions.append(True))
    vm.last_checked_changed.connect(lambda: last_check_emissions.append(True))

    # First check : same as initial (True) → online_changed not emitted, but
    # last_checked_changed always emits.
    vm._update_state(True)
    assert len(online_emissions) == 0
    assert len(last_check_emissions) == 1

    # Status changes to offline → both emit
    vm._update_state(False)
    assert len(online_emissions) == 1
    assert vm.online is False
    assert len(last_check_emissions) == 2

    # Stays offline → online_changed silent
    vm._update_state(False)
    assert len(online_emissions) == 1


def test_network_vm_last_checked_human_format() -> None:
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])
    from app.ui.viewmodels.network_vm import NetworkStatusViewModel
    vm = NetworkStatusViewModel(check_interval_ms=10**9, initial_delay_ms=10**9)
    assert vm.lastCheckedHuman == "jamais vérifié"

    vm._update_state(True)
    # Format HH:MM:SS — 8 chars
    assert len(vm.lastCheckedHuman) == 8
    assert vm.lastCheckedHuman[2] == ":"
    assert vm.lastCheckedHuman[5] == ":"
