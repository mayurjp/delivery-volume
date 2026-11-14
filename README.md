# NSE Delivery Volume Analytics

A free, static website that shows, for NSE-listed stocks, how much of each day's traded volume ended in actual
**delivery** (a change of ownership) rather than being squared off intraday, how that moves against its own history, and
what the price did on the day. A Python pipeline downloads NSE end-of-day files into `store/` and generates JSON; a
static React site reads only that JSON. The browser never talks to NSE. Specs: [docs/specs/README.md](docs/specs/README.md).

- Live site: https://mayurjp.github.io/delivery-volume/ (GitHub Pages, rebuilt by the `update-and-deploy` workflow).
- SME stocks (series SM, ST) are excluded everywhere, by design.
- Labels such as "Up on heavy delivery" describe what happened on a day. They are not predictions or advice.

**Status:** Phase 5B is built (parts 1, 2a and 2b): run forensics end to end. The Stock page's **Runs** tab and smart-money header panel, the **Run library** (`#/runs`: filters, the runs table with CSV, the footprint medians, the odds by quintile, the caveats), the **Learn** "Reading footprints" section with three case studies picked from the data, and the runs shaded on the stock trail. Details: `docs/specs/07-run-forensics.md`, DEVIATIONS #139 to #167. Part 1 (for reference): run forensics in the pipeline (`runs/library.json`, the per-stock `runs` and `runSummary` blocks, `stats/run_footprints.json` with the lift tables and the 60-day version, and the tally track record in `stats/trail_perf.json`), the S4 board meetings (`store/board_meetings/`, `backfill-bm`), and the shared vectors for the daily footprint indicators (`pipeline/footprints.py`). Earlier: Phase 4B is built: **run forensics** in the pipeline (`runs/library.json`, the per-stock `runs` and `runSummary` blocks, `stats/run_footprints.json` with the lift tables and the 60-day version, and the tally track record in `stats/trail_perf.json`), the S4 board meetings (`store/board_meetings/`, `backfill-bm`), and the shared vectors for the daily footprint indicators (`pipeline/footprints.py`). The Runs tab and the library page are the next part. Details: `docs/specs/07-run-forensics.md` and DEVIATIONS #139 to #149. Phase 4B is built: the S16 **shareholding pipeline** (`fetch-shareholding`, `store/shareholding/`, the `holdings/*` files with named holders, dilution flags and Promoter entity tags), the **holdings UI** (the stock page Ownership section, the Institutions Holdings tab, the entity page's disclosed holdings and the Screener ownership columns and presets) and the trail's **holdings indicators**. The backfill of the remaining companies runs on GitHub Actions, so only 19 stocks show holdings locally until it lands. Phase 4 adds **institutions and deals**: FII and DII cash (`#/institutions`), participant derivatives positioning (S5/S6, about one year), FII derivatives statistics (S7, backfilled), the **Deals** page (`#/deals`) with an FII vs DII table by stock, **entity pages** (`#/entity/:id`) built from `config/entities.json`, deal markers and a deal-flow chart on every stock page, and the trail's **named deals** indicator (07 section 6A). Deal history before 2026-11-14 is incomplete on busy days (the historical endpoint returns at most 70 records per request); daily collection is complete from 2026-11-14. Phase 3C added the Smart Money Trail (`#/trail`, `#/trail/:sym`), S17 symbol changes and the rolling publish window. Phase 3B added 3 years of history and the D / W / M / Q / Custom timeframes. Phases 0-2 are done: the pipeline and backfill, the Dashboard, Screener, Stock page, Learn and Watchlist, the workflows, and daily collection.

## Setup (Windows, PowerShell)

```powershell
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
cd site
npm ci
```

Python 3.14 and Node 24 are used locally and in CI (see `docs/specs/DEVIATIONS.md`).

## Running locally

Pipeline (from the repo root):

```powershell
.venv\Scripts\python -m pipeline status                                     # coverage table and gaps (incl. shareholding)
.venv\Scripts\python -m pipeline fetch-shareholding [--backfill] [--max-requests N]   # S16 holdings: capped daily, or resumable backfill
.venv\Scripts\python -m pipeline backfill --from 2025-11-01                 # resumable; about 1 request/second
.venv\Scripts\python -m pipeline backfill --from 2025-11-01 --sources s5,s6,s7   # participant OI/volume and FII derivatives statistics
.venv\Scripts\python -m pipeline update                                     # fetch the last 7 days + FII/DII + deals, then build
.venv\Scripts\python -m pipeline update --no-build                          # fetch only
.venv\Scripts\python -m pipeline collect                                    # only the latest FII/DII cash and bulk/block deals
.venv\Scripts\python -m pipeline backfill-deals --from 2025-11-01           # one-off historical bulk/block deals (see notes)
.venv\Scripts\python -m pipeline backfill-bm --from 2025-11-03           # S4 board meetings (results dates), one PR zip per day, resumable
.venv\Scripts\python -m pipeline fetch --date 2026-11-14 --sources s17 --force   # NSE symbol changes snapshot (also re-checked weekly by update)
.venv\Scripts\python -m pipeline merge-history                                # move staged extra history (.history_staging/) into store/ (idempotent)
.venv\Scripts\python -m pipeline build --out site/public/data               # rebuild the JSON from store/ (offline)
.venv\Scripts\python -m pipeline verify-sources --date 2026-11-13 --json    # probe every source
.venv\Scripts\python -m pytest                                              # tests
.venv\Scripts\ruff check pipeline                                           # lint
```

Site (from `site/`; the JSON must exist in `site/public/data/` first, so run `pipeline build` once):

```powershell
npm run dev                                                # dev server
npm run lint ; npx tsc --noEmit ; npm test                 # eslint + prettier, types, Vitest
$env:VITE_BASE = '/delivery-volume/' ; npm run build       # production build into site/dist
node scripts/smoke.mjs                                     # Playwright smoke test (needs: npx playwright install chromium-headless-shell)
$env:SMOKE_THEME='dark'; node scripts/smoke.mjs            # same in dark mode (axe WCAG 2 A/AA runs on every route)
# Lighthouse (manual; not a dependency), against `npx vite preview --base /delivery-volume/` of the production build:
#   $env:CHROME_PATH='<playwright chromium>\chrome.exe'; npx -y lighthouse@13.6.0 http://localhost:<port>/delivery-volume/ --only-categories=performance,accessibility --form-factor=mobile --chrome-flags="--headless=new"
```

`PIPELINE_ENV=actions|local` chooses which sources run (`config/settings.json` -> `runIn`). Notes:

- F&O (S3, Phase 5): `update` and `backfill` fetch the UDiFF F&O bhavcopy and reduce it to `store/fo_extract/` (a day
  that is already stored is not fetched again). The history from 2024-07-08 was loaded before the S3 source existed and is
  in the same format. Only F&O stocks carry F&O data: `fo/{date}.json` for the last 260 trading days and an `fo` block in
  each F&O stock's symbol file. Open interest is in shares; volume is in contracts.
- Bulk/block deals and FII/DII cash can only be fetched for the latest day, so every missed day is lost. Keep the
  schedule running. `backfill-deals` uses NSE's historical endpoint, which returns at most 70 records per request, so
  busy bulk-deal days are truncated; the days are listed in `store/deals/_backfill.json`.
- The Actions workflow does not commit `store/logs/`.

## Scheduled updates and the Windows fallback

GitHub Actions (`.github/workflows/update-and-deploy.yml`) runs on weekdays at about 19:00 and 22:00 IST and at 08:00 IST
the next morning, fetches new data, commits `store/` as `github-actions[bot]`, rebuilds and deploys. If NSE blocks the
GitHub runner for any source, run the same update from your PC:

1. Make sure `.venv` exists (Setup above) and that `git push` works without a prompt (credential manager or a token).
2. Test it once by hand: `powershell -ExecutionPolicy Bypass -File scripts\update_local.ps1`. The script pulls first,
   runs `pipeline update --no-build` with `PIPELINE_ENV=local`, commits `store/` only if something changed, and pushes.
   The push starts the build and deploy jobs.
3. Create two Task Scheduler tasks (weekdays Mon-Fri, 19:30 and 22:30 IST; set your PC's time zone or convert):
   - Program: `powershell.exe`
   - Arguments: `-NoProfile -ExecutionPolicy Bypass -File "C:\Python\Claude\DeliveryVolume\scripts\update_local.ps1"`
   - Start in: `C:\Python\Claude\DeliveryVolume`
   - Settings: tick **Run task as soon as possible after a scheduled start is missed**.
4. The PC must be on (or wake) at those times. The script runs `git pull --rebase` before every run.

To make only one source run locally, set its `runIn` to `["local"]` in `config/settings.json`.

## Repository layout

`pipeline/` (Python), `config/` (settings, signal thresholds), `store/` (committed raw data), `site/` (Vite + React +
TypeScript + Tailwind + ECharts), `scripts/` (Windows fallback), `docs/specs/` (specs, `SOURCE_STATUS.md`,
`DEVIATIONS.md`), `.github/workflows/`.

## Disclaimer

Data source: NSE India (nseindia.com). FII/DII figures are provisional. For education only; not investment advice.
Not affiliated with NSE. NSE's terms restrict redistributing its data; keep the site non-commercial.
