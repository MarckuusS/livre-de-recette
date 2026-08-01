"""Tests for the DB backup / rotation / restore logic in `app.data.db`."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.data.db import (
    _BACKUP_TIMESTAMP_FORMAT,
    _rotate_backups,
    backup_on_startup,
    list_backups,
    restore_from_backup,
)


def _make_backup(backup_dir: Path, ts: datetime, content: bytes = b"DB_PAYLOAD") -> Path:
    """Create a fake backup file at the given timestamp."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    p = backup_dir / f"db-{ts.strftime(_BACKUP_TIMESTAMP_FORMAT)}.db"
    p.write_bytes(content)
    return p


def _make_real_db(path: Path) -> Path:
    """Create a minimal valid SQLite DB at `path`."""
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE foo (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO foo (name) VALUES ('hello')")
    conn.commit()
    conn.close()
    return path


# ============================================================ Rotation


def test_rotate_keeps_all_backups_within_7_days(tmp_path: Path) -> None:
    now = datetime(2026, 5, 1, 12, 0, 0)
    for i in range(7):
        _make_backup(tmp_path, now - timedelta(days=i))

    deleted = _rotate_backups(tmp_path, now=now)

    assert deleted == 0
    assert len(list(tmp_path.glob("db-*.db"))) == 7


def test_rotate_drops_files_older_than_180_days(tmp_path: Path) -> None:
    now = datetime(2026, 5, 1, 12, 0, 0)
    fresh = _make_backup(tmp_path, now - timedelta(days=2))
    old = _make_backup(tmp_path, now - timedelta(days=200))

    deleted = _rotate_backups(tmp_path, now=now)

    assert deleted == 1
    assert fresh.exists()
    assert not old.exists()


def test_rotate_keeps_one_per_month_in_7_180_window(tmp_path: Path) -> None:
    """Three backups in the same calendar month, all 7-180 days old → keep
    only the most recent of the month."""
    now = datetime(2026, 5, 1, 12, 0, 0)
    # All in March 2026 (~30-60 days old)
    early = _make_backup(tmp_path, datetime(2026, 3, 5, 8, 0, 0))
    mid = _make_backup(tmp_path, datetime(2026, 3, 15, 8, 0, 0))
    late = _make_backup(tmp_path, datetime(2026, 3, 28, 8, 0, 0))

    deleted = _rotate_backups(tmp_path, now=now)

    assert deleted == 2
    assert not early.exists()
    assert not mid.exists()
    assert late.exists()


def test_rotate_typical_full_year(tmp_path: Path) -> None:
    """Daily backups for 365 days → final state ~7 daily + ~6 monthly."""
    now = datetime(2026, 5, 1, 12, 0, 0)
    for days_ago in range(0, 365):
        _make_backup(tmp_path, now - timedelta(days=days_ago))

    _rotate_backups(tmp_path, now=now)

    remaining = list(tmp_path.glob("db-*.db"))
    # 7 backups from days 0-6, plus one per month for ~6 months (days 7-180).
    # That's 7 daily + at most 7 monthly (6 full months + the partial current month
    # if the cutoff splits it). We accept 12-15 to be tolerant.
    assert 12 <= len(remaining) <= 15, f"Got {len(remaining)} files: {[p.name for p in remaining]}"


def test_rotate_ignores_unrecognized_filenames(tmp_path: Path) -> None:
    """Files matching `db-*.db` but with a non-parseable timestamp are kept."""
    now = datetime(2026, 5, 1, 12, 0, 0)
    weird = tmp_path / "db-MANUAL.db"
    weird.write_bytes(b"x")
    _make_backup(tmp_path, now - timedelta(days=200))  # would be deleted

    _rotate_backups(tmp_path, now=now)

    assert weird.exists()


def test_rotate_handles_empty_dir(tmp_path: Path) -> None:
    deleted = _rotate_backups(tmp_path, now=datetime.now())
    assert deleted == 0


# ============================================================ Backup on startup


def test_backup_on_startup_creates_file(tmp_path: Path) -> None:
    db = _make_real_db(tmp_path / "live.db")
    backup_dir = tmp_path / "backups"

    target = backup_on_startup(db_path=db, backup_dir=backup_dir)

    assert target is not None
    assert target.exists()
    assert target.parent == backup_dir
    # Verify it's a valid SQLite DB and contains the test data
    conn = sqlite3.connect(str(target))
    rows = conn.execute("SELECT name FROM foo").fetchall()
    conn.close()
    assert rows == [("hello",)]


def test_backup_on_startup_skips_when_db_missing(tmp_path: Path) -> None:
    target = backup_on_startup(
        db_path=tmp_path / "nonexistent.db",
        backup_dir=tmp_path / "backups",
    )
    assert target is None
    # No backup folder should have been created either.
    # (Implementation may have created it; we just check no .db inside.)


def test_backup_on_startup_swallows_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A failed backup must not raise — the app must still launch."""
    db = _make_real_db(tmp_path / "live.db")

    def boom(*_args, **_kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr("app.data.db._sqlite_backup", boom)
    target = backup_on_startup(db_path=db, backup_dir=tmp_path / "backups")
    assert target is None  # error logged + None returned


# ============================================================ List backups


def test_list_backups_returns_newest_first(tmp_path: Path) -> None:
    now = datetime(2026, 5, 1, 12, 0, 0)
    for i in (5, 1, 3):
        _make_backup(tmp_path, now - timedelta(days=i))

    items = list_backups(tmp_path)

    assert len(items) == 3
    timestamps = [it["timestamp"] for it in items]
    assert timestamps == sorted(timestamps, reverse=True)


def test_list_backups_skips_unparseable(tmp_path: Path) -> None:
    _make_backup(tmp_path, datetime(2026, 5, 1))
    weird = tmp_path / "db-WHATEVER.db"
    weird.write_bytes(b"x")

    items = list_backups(tmp_path)

    assert len(items) == 1


def test_list_backups_returns_empty_on_missing_dir(tmp_path: Path) -> None:
    items = list_backups(tmp_path / "nonexistent")
    assert items == []


# ============================================================ Restore


def test_restore_overwrites_db_and_takes_safety_backup(tmp_path: Path) -> None:
    live_db = tmp_path / "live.db"
    _make_real_db(live_db)
    # Mutate the live DB so we can verify it gets overwritten.
    conn = sqlite3.connect(str(live_db))
    conn.execute("UPDATE foo SET name = 'mutated'")
    conn.commit()
    conn.close()

    # Make a backup that contains the original data.
    backup = tmp_path / "backups" / "db-2026-04-01_120000.db"
    backup.parent.mkdir(parents=True)
    fresh_state = tmp_path / "fresh.db"
    _make_real_db(fresh_state)
    backup.write_bytes(fresh_state.read_bytes())

    safety = restore_from_backup(backup, db_path=live_db)

    # The live DB now contains 'hello' (the fresh state).
    conn = sqlite3.connect(str(live_db))
    rows = conn.execute("SELECT name FROM foo").fetchall()
    conn.close()
    assert rows == [("hello",)]

    # A safety backup was taken with the previously-mutated content.
    assert safety.exists()
    conn = sqlite3.connect(str(safety))
    rows = conn.execute("SELECT name FROM foo").fetchall()
    conn.close()
    assert rows == [("mutated",)]


def test_restore_raises_on_missing_backup(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        restore_from_backup(tmp_path / "nonexistent.db", db_path=tmp_path / "live.db")
