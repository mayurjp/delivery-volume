# NSE Delivery Volume Analytics

A free, static website showing how much of each NSE stock's daily volume ended in actual delivery, how that changes
over time, and what FIIs/DIIs are doing. A Python pipeline downloads NSE end-of-day files into `store/` and generates
JSON; a static site (Phase 2+) reads only that JSON. Specs: [docs/specs/README.md](docs/specs/README.md).

**Status:** Phase 0 (source verification) and Phase 1 (pipeline core + backfill) are implemented. The frontend is
not built yet. Deployment target: `https://mayurjp.github.io/delivery-volume/` (build with `VITE_BASE=/delivery-volume/`).

## Setup (Windows, PowerShell)

```powershell
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

Python 3.12+ is required (CI uses 3.12; the code also runs on 3.14).

## Running the pipeline

```powershell
.venv\Scripts\python -m pipeline verify-sources --date 2026-11-13 --json   # probe every source S1-S16
.venv\Scripts\python -m pipeline backfill --from 2025-11-01                 # resumable; ~1 request/second
.venv\Scripts\python -m pipeline fetch --date 2026-11-13                    # one day
.venv\Scripts\python -m pipeline status                                     # coverage table and gaps
.venv\Scripts\python -m pipeline build --out site/public/data               # rebuild JSON from store/ (offline)
.venv\Scripts\python -m pipeline update                                     # fetch the last 7 days, then build
.venv\Scripts\python -m pytest                                              # tests
```

Backfill can be split into chunks (`--from 2026-01-01 --to 2026-01-31`); files already stored are never downloaded
again. Set `PIPELINE_ENV=actions|local` to choose which sources run (`config/settings.json` -> `runIn`).

SME series (SM, ST) are excluded from every derived output by design.

## Windows fallback (planned, Phase 2)

`scripts/update_local.ps1` will run `update --no-build`, commit `store/` and push, driven by Task Scheduler on
weekdays at 19:30 and 22:30 IST. The PC must be on; a `git pull` happens before every run.

## Disclaimer

Data source: NSE India (nseindia.com). FII/DII figures are provisional. For education only; not investment advice.
Not affiliated with NSE. NSE's terms restrict redistributing its data; keep the site non-commercial.
