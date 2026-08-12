from types import SimpleNamespace

from research_backend import db


def test_build_engine_checks_pooled_connections_before_checkout(monkeypatch):
    captured: dict[str, object] = {}
    sentinel = object()

    def fake_create_engine(database_url: str, **options: object):
        captured["database_url"] = database_url
        captured["options"] = options
        return sentinel

    monkeypatch.setattr(db, "create_engine", fake_create_engine)

    engine = db.build_engine(
        SimpleNamespace(database_url="postgresql://research.example/vault")  # type: ignore[arg-type]
    )

    assert engine is sentinel
    assert captured == {
        "database_url": "postgresql://research.example/vault",
        "options": {"echo": False, "pool_pre_ping": True},
    }
