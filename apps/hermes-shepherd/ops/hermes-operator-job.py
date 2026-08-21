#!/usr/bin/env python3
"""No-agent Hermes cron entrypoint for Bob's fixed daily operator intents."""

import importlib.util
import os
from pathlib import Path
from types import ModuleType
from typing import Callable


INTENT_BY_FILENAME = {
    "hermes-operator-today.py": "today",
    "hermes-operator-close.py": "close",
}


def _load_plugin() -> ModuleType:
    hermes_home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
    plugin_path = hermes_home / "plugins" / "hermes-operator" / "__init__.py"
    spec = importlib.util.spec_from_file_location("hermes_operator_plugin", plugin_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Hermes operator plugin is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_job(
    entrypoint: str,
    *,
    load_plugin: Callable[[], ModuleType] = _load_plugin,
    emit: Callable[[str], None] = print,
) -> None:
    intent = INTENT_BY_FILENAME.get(Path(entrypoint).name)
    if intent is None:
        raise RuntimeError("Unknown Hermes operator job entrypoint")
    emit(load_plugin().handle_scheduled(intent))


if __name__ == "__main__":
    run_job(__file__)
