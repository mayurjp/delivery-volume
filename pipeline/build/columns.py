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
    ("flags", "i", None),
]
# F&O columns (03 sections 5.3 and 5.5: futOi, futOiChgPct, buildup, pcr) are all null until Phase 5 wires S3 into the
# build, so they are NOT published now (66 MB of "null," in dist/); Phase 5 appends them here. Consumers read a missing
# column as null.
FNO_COLUMNS = [("futOi", "i", None), ("futOiChgPct", "f", 2), ("buildup", "s", None), ("pcr", "f", 3)]

# Days older than publish.dailyFullTradingDays carry only these columns (07 section 8); the rest show "—" in the UI.
DAILY_SLIM = ["sym", "series", "open", "high", "low", "close", "prevClose", "vwap", "vol", "turnoverCr", "trades",
              "delivQty", "delivPct", "delivValCr", "spike", "delivPctDiff", "ret1", "streak", "signal", "flags"]
SYMBOL_HIST = [
    ("date", "s", None), ("series", "s", None), ("open", "f", 2), ("high", "f", 2), ("low", "f", 2),
    ("close", "f", 2), ("prevClose", "f", 2), ("vwap", "f", 2), ("vol", "i", None), ("turnoverCr", "f", 2), ("trades", "i", None),
    ("delivQty", "i", None), ("delivPct", "f", 2), ("delivValCr", "f", 2), ("delivPctAvg20", "f", 2),
    ("spike", "f", 3), ("signal", "s", None), ("flags", "i", None),
]
CUM = [("sym", "s", None), ("lastClose", "f", 2), ("lastTradeDate", "s", None), ("cDelivValCr", "f", 2),
       ("cTurnoverCr", "f", 2), ("cDelivQty", "i", None), ("cVol", "i", None), ("cDays", "i", None),
       ("cDelivValUpCr", "f", 2), ("cDelivValDnCr", "f", 2), ("cTrades", "i", None)]
# Period snapshots (08 section 4): weekly/{weekEnd}.json and monthly/{YYYY-MM}.json. Slim set only. F&O columns stay null
# until Phase 5 wires S3 into the build.
PERIOD = [
    ("sym", "s", None), ("days", "i", None), ("open", "f", 2), ("high", "f", 2),
    ("low", "f", 2), ("close", "f", 2), ("prevClose", "f", 2), ("vwap", "f", 2), ("vol", "i", None),
    ("turnoverCr", "f", 2), ("trades", "i", None), ("delivQty", "i", None), ("delivPct", "f", 2),
    ("delivValCr", "f", 2), ("ret", "f", 2), ("clv", "f", 3), ("avgTradeSize", "f", 0), ("delivBalance", "f", 3),
    ("delivValAvgN", "f", 2), ("delivPctAvgN", "f", 2), ("turnoverAvgCr", "f", 2), ("spike", "f", 3),
    ("delivPctDiff", "f", 2), ("relTurnover", "f", 3), ("tradeSizeRatio", "f", 3), ("delivPctZ", "f", 3),
    ("delivPctPctile", "f", 2), ("streak", "i", None), ("signal", "s", None), ("flags", "i", None),
    ("adjusted", "i", None),
]
UNIVERSE = [("sym", "s", None), ("f", "s", None), ("name", "s", None), ("isin", "s", None), ("sector", "s", None),
            ("idx", "i", None), ("mcapCr", "f", 2), ("mcapRank", "i", None), ("bucket", "s", None),
            ("listedOn", "s", None), ("aliases", "j", None), ("mcapEstimated", "b", None),
            ("etf", "b", None)]
SPLIT_BONUS = [("sym", "s", None), ("exDate", "s", None), ("kind", "s", None),
              ("purpose", "s", None)]
# Phase 4B holdings (03 section 5.10, 04 section 5.4). Each `*ChgPp` is against the previous stored quarter.
HOLD_QUARTERS = [("quarter", "s", None), ("filedCount", "i", None), ("universeCount", "i", None), ("complete", "b", None)]
HOLD_STOCK = [("sym", "s", None), ("filedOn", "s", None), ("promoterPct", "f", 2), ("fiiPct", "f", 2), ("diiPct", "f", 2),
              ("mfPct", "f", 2), ("insurancePct", "f", 2), ("retailPct", "f", 2), ("fiiChgPp", "f", 2),
              ("diiChgPp", "f", 2), ("mfChgPp", "f", 2), ("promoterChgPp", "f", 2), ("sharesChgPct", "f", 2),
              ("dilutionFlag", "b", None), ("holderCount", "i", None), ("totalShares", "i", None)]
HOLD_NAMED = [("sym", "s", None), ("category", "s", None), ("subType", "s", None), ("holder", "s", None),
              ("entityId", "s", None), ("shares", "i", None), ("pct", "f", 2), ("prevPct", "f", 2), ("chg", "s", None)]
HOLD_AGG = [("quarter", "s", None), ("group", "s", None), ("n", "i", None), ("promoterPct", "f", 2), ("fiiPct", "f", 2),
            ("diiPct", "f", 2), ("mfPct", "f", 2), ("retailPct", "f", 2)]
# per-stock blocks in symbols/{f}.json: the quarter in front of the stock table, and the latest quarter's named holders
HOLDINGS_COLS = ["quarter"] + [c[0] for c in HOLD_STOCK if c[0] != "sym"]
NAMED_HOLDER_COLS = ["quarter", "category", "subType", "holder", "entityId", "shares", "pct", "prevPct", "chg"]
DEAL_FLOW_COLS = ["date", "category", "buyValueCr", "sellValueCr", "netValueCr"]
MARKET_METRICS = ["turnoverCr", "delivValCr", "delivPctW", "medianDelivPct", "adv", "dec", "unch", "spikeCount2x"]
INDEX_CLOSE_NAMES = ["Nifty 50", "Nifty Next 50", "Nifty Bank", "Nifty Midcap 150", "Nifty Smallcap 250"]


def daily_slim_cols() -> list:
    by = {c[0]: c for c in DAILY}
    return [by[n] for n in DAILY_SLIM]


def names(cols) -> list[str]:
    return [c[0] for c in cols]

# Phase 4 (docs/specs/03 5.7 and 5.8): institutional and deals tables. The `s/i/f/b` kinds drive the cell-type checks.
CASH = [("date", "s", None), ("fiiBuy", "f", 2), ("fiiSell", "f", 2), ("fiiNet", "f", 2), ("diiBuy", "f", 2),
        ("diiSell", "f", 2), ("diiNet", "f", 2)]
PARTICIPANT = [("date", "s", None), ("participant", "s", None), ("futIdxLong", "i", None), ("futIdxShort", "i", None),
               ("futStkLong", "i", None), ("futStkShort", "i", None), ("optIdxCallLong", "i", None),
               ("optIdxPutLong", "i", None), ("optIdxCallShort", "i", None), ("optIdxPutShort", "i", None),
               ("optStkCallLong", "i", None), ("optStkPutLong", "i", None), ("optStkCallShort", "i", None),
               ("optStkPutShort", "i", None), ("totalLong", "i", None), ("totalShort", "i", None)]
FII_DERIV = [("date", "s", None), ("category", "s", None), ("level", "s", None), ("buyContracts", "f", 2),
             ("buyAmtCr", "f", 2), ("sellContracts", "f", 2), ("sellAmtCr", "f", 2), ("oiContracts", "f", 2),
             ("oiAmtCr", "f", 2)]
DEALS = [("date", "s", None), ("type", "s", None), ("sym", "s", None), ("client", "s", None),
         ("entityId", "s", None), ("entityName", "s", None), ("entityType", "s", None),
         ("entityCategory", "s", None), ("entityTypeInferred", "b", None), ("side", "s", None), ("qty", "i", None),
         ("price", "f", 2), ("valueCr", "f", 2), ("roundTrip", "b", None)]
FLOWS = [("date", "s", None), ("sym", "s", None), ("category", "s", None), ("buyValueCr", "f", 2),
         ("sellValueCr", "f", 2), ("netValueCr", "f", 2)]
ENTITIES = [("entityId", "s", None), ("entityName", "s", None), ("entityType", "s", None),
            ("entityCategory", "s", None), ("aliases", "j", None), ("dealCount", "i", None),
            ("buyValueCr", "f", 2), ("sellValueCr", "f", 2), ("netValueCr", "f", 2), ("firstDate", "s", None),
            ("lastDate", "s", None), ("topSymbols", "j", None), ("disclosedHoldingsCount", "i", None),
            ("disclosedHoldingsQuarter", "s", None)]
