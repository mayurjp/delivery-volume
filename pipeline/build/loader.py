"""Reads store/ into DataFrames for the build. No network access."""

from __future__ import annotations

import io
from datetime import date
from pathlib import Path

import pandas as pd

from .. import store
from ..config import STORE_DIR
from ..sources import s1_cm_delivery
from ..sources import s11_constituents as s11
from ..symbols import build_alias_map

MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
KEEP_SERIES = ("EQ", "BE", "BZ")  # analytics universe + trade-for-trade days kept for price continuity


def _csv(path: Path, **kw) -> pd.DataFrame:
    return pd.read_csv(io.BytesIO(store.read_bytes(path)), dtype=str, keep_default_na=False, **kw)


def trading_days(root: Path | None = None) -> list[date]:
    return store.list_dates("cm_delivery", root=root)


def load_alias_map(root: Path | None = None) -> dict[str, str]:
    frames = []
    for d in store.list_dates("cm_isin", root=root):
        df = _csv(store.path_for("cm_isin", d, root=root))
        df["date"] = d.isoformat()
        frames.append(df[["date", "symbol", "isin"]])
    return build_alias_map(pd.concat(frames, ignore_index=True)) if frames else {}


def load_delivery(days: list[date], alias: dict[str, str], root: Path | None = None) -> pd.DataFrame:
    """All S1 rows for EQ/BE/BZ (SME already dropped at parse), symbols merged through the alias map."""
    frames = []
    for d in days:
        df = s1_cm_delivery.parse_stored(store.read_bytes(store.path_for("cm_delivery", d, root=root)), d)
        frames.append(df[df["series"].isin(KEEP_SERIES)])
    df = pd.concat(frames, ignore_index=True)
    if alias:
        df["sym"] = df["sym"].replace(alias)
    df = df.drop_duplicates(["sym", "date"], keep="last")
    return df.sort_values(["sym", "date"], kind="stable").reset_index(drop=True)


def load_mcap(d: date, root: Path | None = None) -> pd.DataFrame | None:
    p = store.path_for("mcap", d, root=root)
    if not p.exists():
        return None
    df = _csv(p)
    df["issueSize"] = pd.to_numeric(df["issueSize"], errors="coerce")
    df["mcapRs"] = pd.to_numeric(df["mcapRs"], errors="coerce")
    return df


def load_mcap_history(days: list[date], root: Path | None = None) -> pd.DataFrame:
    """issueSize per (symbol, date) across all stored mcap files (for the estimate fallback)."""
    out = []
    for d in days:
        m = load_mcap(d, root)
        if m is not None:
            m["date"] = d.isoformat()
            out.append(m[["symbol", "date", "issueSize"]])
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame(columns=["symbol", "date", "issueSize"])


def load_etf_symbols(alias: dict[str, str], root: Path | None = None) -> set[str]:
    """Union of the ETF symbols of every stored PR-zip `etf` extract (store/etf/), alias-resolved."""
    out: set[str] = set()
    for d in store.list_dates("etf", root=root):
        out |= set(_csv(store.path_for("etf", d, root=root))["symbol"].str.strip())
    return {alias.get(s, s) for s in out}


def load_corp_actions(alias: dict[str, str], root: Path | None = None) -> pd.DataFrame:
    """Union of every daily `bc` extract, deduplicated on (symbol, exDate, purpose)."""
    frames = []
    for d in store.list_dates("corp_actions", root=root):
        df = _csv(store.path_for("corp_actions", d, root=root))
        frames.append(df)
    cols = ["sym", "exDate", "kind", "purpose"]
    if not frames:
        return pd.DataFrame(columns=cols)
    df = pd.concat(frames, ignore_index=True)
    out = pd.DataFrame({"sym": df["SYMBOL"], "exDate": df["EX_DT"], "kind": df["kind"], "purpose": df["PURPOSE"]})
    out = out[out["exDate"].str.match(r"^\d{4}-\d{2}-\d{2}$")]
    if alias:
        out["sym"] = out["sym"].replace(alias)
    return out.drop_duplicates(["sym", "exDate", "purpose"]).reset_index(drop=True)


def load_band_hits(alias: dict[str, str], root: Path | None = None) -> pd.DataFrame:
    frames = []
    for d in store.list_dates("band_hits", root=root):
        df = _csv(store.path_for("band_hits", d, root=root))
        frames.append(pd.DataFrame({"sym": df["SYMBOL"].str.strip(), "date": d.isoformat()}))
    out = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["sym", "date"])
    if alias:
        out["sym"] = out["sym"].replace(alias)
    return out.drop_duplicates()


def load_ban(alias: dict[str, str], root: Path | None = None) -> pd.DataFrame:
    from ..sources.s12_to_s15 import s14_parse

    rows = []
    for d in store.list_dates("fo_ban", "txt", root=root):
        p = s14_parse(store.path_for("fo_ban", d, "txt", root).read_bytes(), d)
        rows += [(s, d.isoformat()) for s in (p.data or [])]
    out = pd.DataFrame(rows, columns=["sym", "date"])
    if alias:
        out["sym"] = out["sym"].replace(alias)
    return out


def load_hl52(alias: dict[str, str], root: Path | None = None) -> pd.DataFrame:
    """52-week high/low per symbol and file date. file(T) holds values through T-1 (see outputs.hl52_breaks)."""
    frames = []
    for d in store.list_dates("hl52", root=root):
        df = _csv(store.path_for("hl52", d, root=root))
        frames.append(pd.DataFrame({
            "sym": df["symbol"], "date": d.isoformat(),
            "high52": pd.to_numeric(df["high52"], errors="coerce"),
            "low52": pd.to_numeric(df["low52"], errors="coerce"),
        }))
    out = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(
        columns=["sym", "date", "high52", "low52"])
    if alias:
        out["sym"] = out["sym"].replace(alias)
    return out.drop_duplicates(["sym", "date"], keep="last")


def load_indices_close(days: list[date], root: Path | None = None) -> pd.DataFrame:
    frames = []
    for d in days:
        p = store.path_for("indices_close", d, root=root)
        if not p.exists():
            continue
        df = _csv(p)
        df = df[["Index Name", "Closing Index Value"]].copy()
        df["close"] = pd.to_numeric(df["Closing Index Value"], errors="coerce")
        df["date"] = d.isoformat()
        frames.append(df[["Index Name", "date", "close"]])
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["Index Name", "date", "close"])


def latest_snapshot(kind: str, root: Path | None = None) -> tuple[str | None, Path | None]:
    base = (root or STORE_DIR) / kind
    if not base.exists():
        return None, None
    items = sorted(p for p in base.iterdir() if p.name[:2] == "20")
    return (items[-1].name.split(".")[0], items[-1]) if items else (None, None)


def load_constituents(alias: dict[str, str], root: Path | None = None) -> tuple[str | None, dict[str, pd.DataFrame]]:
    asof, path = latest_snapshot("constituents", root)
    out: dict[str, pd.DataFrame] = {}
    if path is None:
        return None, out
    for key in s11.FILES:
        f = path / f"{key}.csv"
        if f.exists():
            df = s11.read_snapshot_csv(f.read_text(encoding="utf-8-sig"))
            if alias:
                df["Symbol"] = df["Symbol"].replace(alias)
            out[key] = df
    return asof, out


def load_equity_list(alias: dict[str, str], root: Path | None = None) -> pd.DataFrame:
    asof, path = latest_snapshot("equity_list", root)
    cols = ["SYMBOL", "NAME OF COMPANY", "DATE OF LISTING", "ISIN NUMBER"]
    if path is None:
        return pd.DataFrame(columns=cols)
    df = pd.read_csv(io.BytesIO(store.read_bytes(path)), dtype=str, keep_default_na=False)
    df.columns = [c.strip() for c in df.columns]
    df = df[cols].copy()
    for c in cols:
        df[c] = df[c].str.strip()
    if alias:
        df["SYMBOL"] = df["SYMBOL"].replace(alias)
    return df.drop_duplicates("SYMBOL")


def load_isin_latest(alias: dict[str, str], root: Path | None = None) -> dict[str, str]:
    d = store.list_dates("cm_isin", root=root)
    if not d:
        return {}
    df = _csv(store.path_for("cm_isin", d[-1], root=root))
    df = df[df["series"].isin(KEEP_SERIES)]
    sym = df["symbol"].replace(alias) if alias else df["symbol"]
    return dict(zip(sym, df["isin"]))
