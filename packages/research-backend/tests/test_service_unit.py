from pathlib import Path


def test_systemd_unit_runs_native_sidecar_as_unprivileged_bob_user() -> None:
    unit = (Path(__file__).parents[1] / "ooda-research-backend.service").read_text()

    assert "User=bob" in unit
    assert "Group=bob" in unit
    assert "EnvironmentFile=/etc/ooda/research-backend.env" in unit
    assert "127.0.0.1" in unit
    assert "/opt/ooda-research-backend/current/.venv/bin/uvicorn" in unit
    assert "StateDirectory=ooda-research-backend" in unit
    assert "ProtectHome=true" in unit
    assert "podman" not in unit
    assert "docker" not in unit
