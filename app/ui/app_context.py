"""Application-wide DB context for the UI layer.

The UI does not own a DB session — viewmodels open one via this context every time
they need to read/write. This is simpler than long-lived sessions and avoids the
classic SQLAlchemy "stale identity map" issue when the underlying data changes.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.data.db import init_schema, make_engine, make_session_factory, session_scope


class AppContext:
    """Holds the engine + session factory. One instance per running app."""

    def __init__(self, engine: Engine, factory: sessionmaker[Session]) -> None:
        self._engine = engine
        self._factory = factory

    @classmethod
    def from_default(cls) -> AppContext:
        engine = make_engine()
        init_schema(engine)
        return cls(engine, make_session_factory(engine))

    @contextmanager
    def session(self) -> Iterator[Session]:
        with session_scope(self._factory) as s:
            yield s

    def shutdown(self) -> None:
        self._engine.dispose()
