"""Atomic read/write of store/. Files for a date are written once, after validation."""

from __future__ import annotations

import gzip
import io
import json
import os
import tempfile
from datetime import date
from pathlib import Path

from .config import STORE_DIR


def gz_bytes(data: bytes) -> bytes:
    """gzip with mtime=0 so identical content gives identical bytes (no git diff churn)."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, compresslevel=9) as f:
        f.write(data)
    return buf.getvalue()


def path_for(kind: str, d: date, ext: str = "csv.gz", root: Path | None = None) -> Path:
    return (root or STORE_DIR) / kind / f"{d:%Y}" / f"{d.isoformat()}.{ext}"


def write_atomic(path: Path, data: bytes, force: bool = False) -> bool:
    """Write temp file then rename. Never overwrites an existing file unless force. Returns True if written."""
    if path.exists() and not force:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=path.suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return True


def exists(kind: str, d: date, ext: str = "csv.gz", root: Path | None = None) -> bool:
    return path_for(kind, d, ext, root).exists()


def read_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    return gzip.decompress(data) if path.suffix == ".gz" else data


def list_dates(kind: str, ext: str = "csv.gz", root: Path | None = None) -> list[date]:
    base = (root or STORE_DIR) / kind
    if not base.exists():
        return []
    suffix = "." + ext
    return sorted(date.fromisoformat(p.name[: -len(suffix)]) for p in base.glob(f"*/*{suffix}"))


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, obj, indent: int | None = 1) -> None:
    write_atomic(path, json.dumps(obj, indent=indent, sort_keys=True).encode("utf-8"), force=True)
