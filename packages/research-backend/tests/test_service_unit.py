from pathlib import Path

from research_backend.config import Settings


def test_systemd_unit_runs_native_sidecar_as_unprivileged_bob_user() -> None:
    unit = (Path(__file__).parents[1] / "ooda-research-backend.service").read_text()

    assert "User=bob" in unit
    assert "Group=bob" in unit
    assert "EnvironmentFile=/etc/ooda/research-backend.env" in unit
    assert "127.0.0.1" in unit
    assert "/opt/ooda-research-backend/current/.venv/bin/uvicorn" in unit
    assert "StateDirectory=ooda-research-backend" in unit
    assert "ExecStart=/usr/bin/env" in unit
    assert "HOME=/var/lib/ooda-research-backend" in unit
    assert "RESEARCH_VAULT_PATH=/var/lib/ooda-research-backend/vault" in unit
    assert "SOURCES_DIR=/var/lib/ooda-research-backend/vault/sources" in unit
    assert "KBS_DIR=/var/lib/ooda-research-backend/vault/kbs" in unit
    assert "ReadWritePaths=/var/lib/ooda-research-backend" in unit
    assert "UMask=0077" in unit
    assert "ProtectHome=true" in unit
    assert "podman" not in unit
    assert "docker" not in unit


def test_production_state_root_derives_writable_legacy_paths(tmp_path: Path) -> None:
    state_root = tmp_path / "ooda-research-backend" / "vault"
    settings = Settings.from_overrides(
        {
            "DATABASE_URL": "postgresql://unused",
            "RESEARCH_VAULT_PATH": str(state_root),
        }
    )

    sources_dir = Path(settings.sources_dir)
    kbs_dir = Path(settings.kbs_dir)
    for directory, marker in (
        (sources_dir / "chats", "import.json"),
        (sources_dir / "youtube", "stats_cache.json"),
        (kbs_dir / "ooda", "compiled.json"),
    ):
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / marker
        target.write_text("stateful route write", encoding="utf-8")
        assert target.read_text(encoding="utf-8") == "stateful route write"
        assert target.is_relative_to(state_root)
