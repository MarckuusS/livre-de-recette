"""Tests du repo `LidlPlusSettingsRepo` (Plan v3, Phase 5).

Ce repo gère un singleton (une seule ligne `id=1`) avec lazy-create. On vérifie
le comportement attendu : init transparent, persistance des champs, garde-fou
sur l'intervalle de polling.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.data.repositories import LidlPlusSettingsRepo


def test_get_creates_default_row_lazily(db_session) -> None:
    """Premier appel à `get()` crée la ligne avec valeurs par défaut."""
    repo = LidlPlusSettingsRepo(db_session)
    settings = repo.get()
    db_session.commit()

    assert settings.enabled is False
    assert settings.poll_interval_minutes == 60
    assert settings.last_fetched_at is None
    assert settings.last_error is None


def test_set_enabled_persists(db_session) -> None:
    repo = LidlPlusSettingsRepo(db_session)
    repo.set_enabled(True)
    db_session.commit()

    repo2 = LidlPlusSettingsRepo(db_session)
    assert repo2.get().enabled is True


def test_set_poll_interval_floor(db_session) -> None:
    """Floor à 5 minutes pour éviter que l'utilisateur DDOS Lidl."""
    repo = LidlPlusSettingsRepo(db_session)
    repo.set_poll_interval(2)
    db_session.commit()
    assert repo.get().poll_interval_minutes == 5

    repo.set_poll_interval(0)
    db_session.commit()
    assert repo.get().poll_interval_minutes == 5

    repo.set_poll_interval(120)
    db_session.commit()
    assert repo.get().poll_interval_minutes == 120


def test_mark_fetched_clears_last_error(db_session) -> None:
    """Une sync réussie efface l'erreur précédente."""
    repo = LidlPlusSettingsRepo(db_session)
    repo.mark_error("Auth failure")
    db_session.commit()
    assert repo.get().last_error == "Auth failure"

    when = datetime(2026, 5, 2, 10, 30)
    repo.mark_fetched(when)
    db_session.commit()
    settings = repo.get()
    assert settings.last_fetched_at == when
    assert settings.last_error is None


def test_mark_error_truncates_long_messages(db_session) -> None:
    """Garde-fou : message d'erreur tronqué à 500 chars."""
    repo = LidlPlusSettingsRepo(db_session)
    repo.mark_error("X" * 1000)
    db_session.commit()
    assert len(repo.get().last_error) == 500


def test_mark_fetched_uses_now_by_default(db_session) -> None:
    repo = LidlPlusSettingsRepo(db_session)
    before = datetime.now()
    repo.mark_fetched()
    db_session.commit()
    after = datetime.now()
    at = repo.get().last_fetched_at
    assert at is not None
    assert before - timedelta(seconds=1) <= at <= after + timedelta(seconds=1)
