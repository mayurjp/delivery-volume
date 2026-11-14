"""Reads store/ into DataFrames for the build. No network access."""

from __future__ import annotations

import io
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from .. import store
from ..config import STORE_DIR
from ..sources import s1_cm_delivery
from ..sources import s11_constituents as s11
from ..symbols import build_alias_map

MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
KEEP_SERIES = ("EQ", "BE", "BZ")  # analytics universe + trade-for-trade days kept for price continuity


class AliasMap(dict):
    """Static old -> current symbol map (ISIN timeline plus the S17 renames of symbols that no longer trade), with the dated
    S17 renames attached. A plain dict to every caller that resolves undated (current) symbols; `resolve_alias(s, alias,
    dates)` uses the dated rule for rows that carry a date (DEVIATIONS #70)."""

    changes: pd.DataFrame
    isin: dict[str, str]

    def __bool__(self) -> bool:
        return len(self) > 0 or len(self.changes) > 0

    def resolve_dated(self, sym: pd.Series, date: pd.Series) -> pd.Series:
        return resolve_dated(sym, date, self.changes, self.isin)


def resolve_dated(sym: pd.Series, date: pd.Series, changes: pd.DataFrame, isin: dict[str, str]) -> pd.Series:
    """Per-row current symbol. The ISIN timeline wins where it knows the symbol (undated, as before). Otherwise the S17
    renames apply only to rows dated BEFORE the effective date, chained (LTI -> LTIM -> LTM). A mapped row whose target
    symbol already has an unmapped row of its own on the same date is left unmapped (symbol reuse, never a duplicate)."""
    out = sym.astype(object).copy()
    if isin:
        m = out.map(isin)
        out = out.where(m.isna(), m)
    if changes is None or changes.empty:
        return out
    by_old = {o: g.sort_values("effective") for o, g in changes.groupby("old")}
    todo = out.isin(by_old).to_numpy().copy()
    cur = out.to_numpy(dtype=object).copy()
    dts = date.to_numpy(dtype=object)
    for _ in range(8):  # chain depth
        moved = False
        for o in set(cur[todo]) & set(by_old):
            sel = todo & (cur == o)
            g = by_old[o]
            eff = g["effective"].to_numpy(dtype=object)
            idx = np.flatnonzero(sel)
            k = np.searchsorted(eff, dts[idx].astype(str), side="right")  # first change with effective > row date
            ok = k < len(eff)
            new = g["new"].to_numpy(dtype=object)[np.minimum(k, len(eff) - 1)]
            if ok.any():
                cur[idx[ok]] = new[ok]
                moved = True
            todo[idx[~ok]] = False  # nothing (more) applies to these rows
        if not moved:
            break
    res = pd.Series(cur, index=out.index, dtype=object)
    if isin:
        m = res.map(isin)
        res = res.where(m.isna(), m)
    changed = (res != out).to_numpy()
    if changed.any():
        own = pd.MultiIndex.from_arrays([out.to_numpy()[~changed], dts[~changed]])
        clash = pd.MultiIndex.from_arrays([res.to_numpy()[changed], dts[changed]]).isin(own)
        if clash.any():
            fix = np.flatnonzero(changed)[clash]
            res.iloc[fix] = out.iloc[fix]
    return res


def resolve_alias(s: pd.Series, alias: dict[str, str], dates: pd.Series | None = None) -> pd.Series:
    """Series.replace(alias) does one full comparison pass per alias; a dict map is one hash lookup per row. With `dates`
    and an AliasMap, the dated S17 rule applies (DEVIATIONS #70)."""
    if not alias and not (isinstance(alias, AliasMap) and len(alias.changes)):
        return s
    if dates is not None and isinstance(alias, AliasMap):
        return alias.resolve_dated(s, dates)
    m = s.map(alias)
    return m.where(m.notna(), s)


def _csv(path: Path, **kw) -> pd.DataFrame:
    return pd.read_csv(io.BytesIO(store.read_bytes(path)), dtype=str, keep_default_na=False, **kw)


def trading_days(root: Path | None = None) -> list[date]:
    return store.list_dates("cm_delivery", root=root)


def first_date(kind: str, ext: str = "csv.gz", root: Path | None = None) -> str | None:
    d = store.list_dates(kind, ext, root=root)
    return d[0].isoformat() if d else None


def load_symbol_changes(root: Path | None = None) -> pd.DataFrame:
    """The latest S17 snapshot (old, new, effective ISO date, name); empty when none is stored."""
    from ..sources import s17_symbol_change as s17

    _, path = latest_snapshot("ref/symbolchange", root)
    if path is None:
        return pd.DataFrame(columns=["old", "new", "effective", "name"])
    return s17.changes(store.read_bytes(path).decode("utf-8-sig"))


def load_alias_map(root: Path | None = None) -> AliasMap:
    frames = []
    for d in store.list_dates("cm_isin", root=root):
        df = _csv(store.path_for("cm_isin", d, root=root))
        df["date"] = d.isoformat()
        frames.append(df[["date", "symbol", "isin"]])
    isin = build_alias_map(pd.concat(frames, ignore_index=True)) if frames else {}
    changes = load_symbol_changes(root)
    live = set(frames[-1]["symbol"]) if frames else set()
    static = dict(isin)
    # S17 chains resolved to today's symbol, for undated uses, only for symbols that no longer trade (a reused name stays)
    nxt: dict[str, str] = {}
    for r in changes.sort_values("effective").itertuples():
        nxt[r.old] = r.new
    for old in nxt:
        if old in live or old in static:
            continue
        cur, seen = old, {old}
        while cur in nxt and nxt[cur] not in seen:
            cur = nxt[cur]
            seen.add(cur)
        if cur != old:
            static[old] = isin.get(cur, cur)
    out = AliasMap(static)
    out.changes, out.isin = changes, isin
    return out


def load_delivery(days: list[date], alias: dict[str, str], root: Path | None = None) -> pd.DataFrame:
    """All S1 rows for EQ/BE/BZ (SME already dropped at parse), symbols merged through the alias map."""
    frames = []
    for d in days:
        frames.append(s1_cm_delivery.parse_stored_fast(
            store.read_bytes(store.path_for("cm_delivery", d, root=root)), d, KEEP_SERIES))
    df = pd.concat(frames, ignore_index=True)
    if alias:
        df["sym"] = resolve_alias(df["sym"], alias, df["date"])
    for c in ("sym", "series", "date"):  # plain object columns: pandas 3's str dtype is slow to group/compare w/o pyarrow
        df[c] = df[c].astype(object)
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
        out["sym"] = resolve_alias(out["sym"], alias, out["exDate"])
    return out.drop_duplicates(["sym", "exDate", "purpose"]).reset_index(drop=True)


def load_band_hits(alias: dict[str, str], root: Path | None = None) -> pd.DataFrame:
    frames = []
    for d in store.list_dates("band_hits", root=root):
        df = _csv(store.path_for("band_hits", d, root=root))
        frames.append(pd.DataFrame({"sym": df["SYMBOL"].str.strip(), "date": d.isoformat()}))
    out = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["sym", "date"])
    if alias:
        out["sym"] = resolve_alias(out["sym"], alias, out["date"])
    return out.drop_duplicates()


def load_ban(alias: dict[str, str], root: Path | None = None) -> pd.DataFrame:
    from ..sources.s12_to_s15 import s14_parse

    rows = []
    for d in store.list_dates("fo_ban", "txt", root=root):
        p = s14_parse(store.path_for("fo_ban", d, "txt", root).read_bytes(), d)
        rows += [(s, d.isoformat()) for s in (p.data or [])]
    out = pd.DataFrame(rows, columns=["sym", "date"])
    if alias:
        out["sym"] = resolve_alias(out["sym"], alias, out["date"])
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
        out["sym"] = resolve_alias(out["sym"], alias, out["date"])
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
                df["Symbol"] = resolve_alias(df["Symbol"], alias)
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
        df["SYMBOL"] = resolve_alias(df["SYMBOL"], alias)
    return df.drop_duplicates("SYMBOL")


def load_isin_latest(alias: dict[str, str], root: Path | None = None) -> dict[str, str]:
    d = store.list_dates("cm_isin", root=root)
    if not d:
        return {}
    df = _csv(store.path_for("cm_isin", d[-1], root=root))
    df = df[df["series"].isin(KEEP_SERIES)]
    sym = resolve_alias(df["symbol"], alias) if alias else df["symbol"]
    return dict(zip(sym, df["isin"]))


def load_fo(days: list[date], alias: dict[str, str], root: Path | None = None) -> pd.DataFrame:
    """Every stored S3 extract row (store/fo_extract, 03 section 3): sym (alias-resolved, dated), date, instType, expiry,
    optType, oi. Days without an extract simply have no rows (the F&O analytics start on 2024-07-08)."""
    frames = []
    for d in days:
        p = store.path_for("fo_extract", d, root=root)
        if not p.exists():
            continue
        x = pd.read_csv(io.BytesIO(store.read_bytes(p)), dtype={"symbol": str, "instType": str, "expiry": str,
                                                                 "optType": str}, keep_default_na=False)
        x = x[["symbol", "instType", "expiry", "optType", "oi"]].copy()
        x["date"] = d.isoformat()
        frames.append(x)
    out = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(
        columns=["symbol", "instType", "expiry", "optType", "oi", "date"])
    out = out.rename(columns={"symbol": "sym"})
    if alias and len(out):
        # only rows whose symbol can be renamed need the dated rule (it is a per-symbol pass over the rows)
        old = set(alias.keys()) | (set(alias.changes["old"]) if isinstance(alias, AliasMap) else set())
        hit = out["sym"].isin(old).to_numpy()
        if hit.any():
            out.loc[hit, "sym"] = resolve_alias(out.loc[hit, "sym"], alias, out.loc[hit, "date"]).to_numpy()
    return out
