"""Loads config/*.json."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
STORE_DIR = ROOT / "store"


@lru_cache(maxsize=None)
def _load(name: str) -> dict:
    return json.loads((CONFIG_DIR / name).read_text(encoding="utf-8"))


def settings() -> dict:
    return _load("settings.json")


def signals() -> dict:
    return _load("signals.json")


def env() -> str:
    return os.environ.get("PIPELINE_ENV", "local")


def run_here(source_key: str) -> bool:
    """A source whose runIn excludes the current environment is skipped."""
    return env() in settings()["sources"].get(source_key, {}).get("runIn", ["actions", "local"])
