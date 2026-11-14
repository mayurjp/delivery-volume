"""Column contracts for generated JSON (03 section 5). Kind: s=string, i=integer, f=float, b=bool, j=json/array."""

from __future__ import annotations

INDICES = ["NIFTY50", "NIFTYNEXT50", "NIFTY100", "NIFTY200", "NIFTY500", "MIDCAP150", "SMALLCAP250",
           "MICROCAP250", "TOTALMARKET", "FNO"]
FLAG = {"t2t": 1, "corpAction": 2, "bulkDeal": 4, "blockDeal": 8, "bandHit": 16, "fnoBan": 32, "high52": 64,
        "low52": 128, "lowLiquidity": 256, "etf": 512, "newListing": 1024, "expiryWeek": 2048}

# (name, kind, decimals)
DAILY = [
    ("sym", "s", None), ("series", "s", None), ("open", "f", 2), ("high", "f", 2), ("low", "f", 2),
    ("close", "f", 2), ("prevClose", "f", 2), ("vwap", "f", 2), ("vol", "i", None), ("turnoverCr", "f", 2),
    ("trades", "i", None), ("delivQty", "i", None), ("delivPct", "f", 2), ("delivValCr", "f", 2),
    ("delivValAvg5", "f", 2), ("delivValAvg20", "f", 2), ("delivValAvg50", "f", 2), ("delivPctAvg20", "f", 2),
    ("volAvg20", "i", None), ("turnoverAvg20Cr", "f", 2), ("tradeSizeRatio", "f", 3), ("spike", "f", 3),
    ("delivPctDiff", "f", 2), ("relVol", "f", 3), ("ret1", "f", 2), ("clv", "f", 3), ("vwapGap", "f", 2),
    ("delivPctZ60", "f", 3), ("delivPctPctile", "f", 2), ("streak", "i", None), ("signal", "s", None),
    ("flags", "i", None), ("futOi", "i", None), ("futOiChgPct", "f", 2), ("buildup", "s", None), ("pcr", "f", 3),
]
SYMBOL_HIST = [
    ("date", "s", None), ("series", "s", None), ("open", "f", 2), ("high", "f", 2), ("low", "f", 2),
    ("close", "f", 2), ("vwap", "f", 2), ("vol", "i", None), ("turnoverCr", "f", 2), ("trades", "i", None),
    ("delivQty", "i", None), ("delivPct", "f", 2), ("delivValCr", "f", 2), ("delivPctAvg20", "f", 2),
    ("spike", "f", 3), ("signal", "s", None), ("flags", "i", None), ("futOi", "i", None),
    ("futOiChgPct", "f", 2), ("buildup", "s", None), ("pcr", "f", 3),
]
CUM = [("sym", "s", None), ("lastClose", "f", 2), ("lastTradeDate", "s", None), ("cDelivValCr", "f", 2),
       ("cTurnoverCr", "f", 2), ("cDelivQty", "i", None), ("cVol", "i", None), ("cDays", "i", None)]
UNIVERSE = [("sym", "s", None), ("f", "s", None), ("name", "s", None), ("isin", "s", None), ("sector", "s", None),
            ("idx", "i", None), ("mcapCr", "f", 2), ("mcapRank", "i", None), ("bucket", "s", None),
            ("listedOn", "s", None), ("aliases", "j", None), ("mcapEstimated", "b", None),
            ("etf", "b", None)]
SPLIT_BONUS = [("sym", "s", None), ("exDate", "s", None), ("kind", "s", None),
              ("purpose", "s", None)]
HOLDINGS_COLS = ["quarter", "filedOn", "promoterPct", "fiiPct", "diiPct", "mfPct", "insurancePct", "bankPct",
                 "pensionPct", "otherDiiPct", "retailPct", "othersPct", "totalShares"]
NAMED_HOLDER_COLS = ["quarter", "category", "subType", "holder", "entityId", "shares", "pct"]
DEAL_FLOW_COLS = ["date", "category", "buyValueCr", "sellValueCr", "netValueCr"]
MARKET_METRICS = ["turnoverCr", "delivValCr", "delivPctW", "medianDelivPct", "adv", "dec", "unch", "spikeCount2x"]
INDEX_CLOSE_NAMES = ["Nifty 50", "Nifty Next 50", "Nifty Bank", "Nifty Midcap 150", "Nifty Smallcap 250"]


def names(cols) -> list[str]:
    return [c[0] for c in cols]
