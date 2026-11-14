# 06 — Phases, Acceptance Criteria and CI

Build strictly in this order. Each phase ends with its acceptance checks passing, plus an entry in `docs/specs/DEVIATIONS.md` if anything departed from the spec.

## Phase 0: Source verification spike

**Tasks**

1. Scaffold the repo layout (01 §6), `requirements.txt`, `pipeline/http.py`, and `pipeline/sources/*` with just enough parsing to validate headers.
2. Implement `python -m pipeline verify-sources --date <last trading day> [--json]` for S1–S15.
3. Run it locally.
4. Create a minimal `.github/workflows/verify-sources.yml` (`workflow_dispatch` only) that runs the same command on `ubuntu-latest` and uploads the JSON report as an artifact.
5. Write `docs/specs/SOURCE_STATUS.md`:
   - a table of source × environment (local, actions) → HTTP status, rows, header OK;
   - the observed publish times, by running the check at 17:00, 18:00, 19:00 and 21:00 IST on one day if possible;
   - the units of S3 OI;
   - the S4 `bh` header;
   - the S7 `.xls` layout (a dump of every row);
   - the S8 result (works or blocked, the payload shape, which session steps were needed);
   - the S16 result: the listing endpoint and payload, whether an all-companies date-range listing exists, where the XBRL files live (archives or cookie-gated), the XBRL element names mapped to the 03 §5.10 categories and named holders, and any format differences across the 4 backfill quarters.

**Acceptance**

- The report exists for both environments.
- `SOURCE_STATUS.md` is complete.

**STOP: report to the user before Phase 1.** Report in particular:

- whether S1 and S8 work from GitHub Actions;
- if either is blocked, the plan. S1 blocked → `runIn: ["local"]` for every source and rely on the Windows fallback. S8 blocked → only S8 is set to local.

## Phase 1: Pipeline core and backfill

**Scope:**

- Sources S1, S2, S4 (mcap, bc, bh), S11, S12, S13, S14 and S15.
- The store, the calendar, and the `fetch`, `backfill`, `build`, `update` and `status` commands.
- These generated files: `meta`, `universe`, `daily/`, `cum/`, `symbols/` and `market`.
- JSON Schemas, plus every pipeline test in 03 §10 that applies to these sources.

**Acceptance**

- `python -m pipeline backfill --from 2025-11-01` completes. If interrupted and re-run, it resumes without downloading anything twice.
- `python -m pipeline build` finishes in < 3 minutes, and every output validates against its schema.
- Spot checks, written as tests with values read from the stored CSV:
  - RELIANCE `delivPct` on the latest date equals `DELIV_PER` in S1;
  - `delivValCr` equals `DELIV_QTY × AVG_PRICE / 1e7`.
- The cumulative-sum property test passes.
- `universe.json` has the expected counts: 50 rows with the NIFTY50 bit (or the number of constituents that traded), and about 750 rows with a sector other than "Unclassified".
- Store growth for one day is ≤ 300 KB.

## Phase 2: Frontend MVP and deployment

**Scope:**

- The Vite app shell, global filters, date control (Day mode), Dashboard (P1), Screener in Day mode (P2), Stock page (P5) with the main chart and stats panel, Learn (P9), and Watchlist (P10).
- `update-and-deploy.yml` with the cron schedule, the commit step and Pages deploy.
- `ci.yml`.

**Acceptance**

- The site is live on GitHub Pages at `https://<user>.github.io/<repo>/` and shows the latest date.
- The scheduled workflow ran on its own at least once and committed data.
- Filtering Universe = Nifty 50 shows only Nifty 50 stocks. A shared URL reproduces the exact same view.
- Lighthouse on mobile for the Dashboard: Performance ≥ 85 and Accessibility ≥ 95.
- At 360 px width there is no horizontal page scroll. Every chart can be operated by touch.

## Phase 3: Period compare, heat maps, statistics

**Scope:** Range mode (date control and Screener), Period Compare (P3), Heatmaps (P4, all three tabs), Market Statistics (P8, without the signal-performance table).

**Acceptance**

- A range comparison triggers at most 4 `cum/` fetches. Verify this with a test that mocks `fetch`.
- TS range maths matches the shared Python test vectors.
- The treemap of the Total Market universe renders in < 1 s on a laptop.
- The ⚠ corporate-action marker appears for a stock with a split or bonus inside the range. Pick a real example from the backfilled data and record it in a test.

## Phase 4: Institutions and deals

**Scope:**

- Sources S5, S6, S7, S8, S9 and S10.
- `entities.json` normalisation, with a seed list built from the observed names.
- The `institutional/*` and `deals/*` files.
- Institutions (P6), Deals and Entity pages (P7), and deal markers on the stock chart.

**Acceptance**

- S5, S6 and S7 backfilled. Participant charts show about 1 year.
- S8 collected for 5 consecutive trading days without manual help, from Actions or from the documented local fallback.
- Deal dedupe holds: a re-run on the same day adds 0 rows.
- Round-trip detection is covered by a test built from a real same-day buy+sell pair in the data.
- The entity page for a seeded entity lists all its aliases' deals.
- Every deal row has an `entityCategory`. `entities.json` covers at least the 50 largest FII and 50 largest DII names by deal value. A test asserts that categorisation gives "MUTUAL FUND", "INSURANCE" and "- ODI" names the right category.
- The "FII vs DII by stock" table and the stock-page deal-flow chart match `deals/flows.json` totals.

## Phase 4B: Quarterly shareholding (FII/DII holdings per stock)

**Scope:**

- S16 `fetch-shareholding` (capped daily mode and `--backfill`), with XBRL parsing to the 03 §5.10 shape.
- `holdings/*` files and the `holdings`/`namedHolders` blocks in symbol files.
- Entity linking of named holders to `entities.json`.
- Stock page Ownership section, Institutions → Holdings tab, entity "disclosed holdings", and the Screener ownership columns and presets.

**Acceptance**

- 4 quarters backfilled for ≥ 95% of the universe. Missing companies are listed in the `status` output with reasons.
- For 3 hand-checked companies (one each of Large, Mid and Small), category %s match NSE's shareholding web page for the latest quarter within 0.01 pp. Record them in a test.
- Category totals sum to 100 ± 0.1 for ≥ 99% of filings. Write the failures to a report, don't crash.
- The `dilutionFlag` and `EXITED` caveats render in the UI.
- The capped daily mode stays within `maxRequestsPerRun` and picks up a newly filed quarter within 7 days. Simulate this in a test with a mocked listing.

## Phase 5: F&O signals, signal performance, polish

**Scope:**

- The S3 extract, `futOi`, `buildup`, `pcr` and the confluence badges.
- The F&O pane on the stock page, and the build-up Screener presets.
- `stats/signal_perf.json` and its table.
- CSV export everywhere tables appear, a dark-mode audit, and the empty and error states.

**Acceptance**

- The build-up classification is unit-tested on its boundaries.
- The signal-performance table shows counts and carries the disclaimer.
- All quality bars in 05 §7 hold.

## Phase 6: Optional (ask the user before starting any of these)

| Item | Value | Cost and risk |
|------|-------|---------------|
| BSE delivery data merged by ISIN | Combined NSE+BSE delivery for dual-listed stocks; covers BSE-only companies | A new source family, scrip-code→ISIN mapping, bigger store |
| SAST / insider-trading disclosures | Named holders crossing thresholds | Free-text and XBRL parsing |
| Alerts | e.g. a weekly GitHub Issue or RSS feed of new ACC/DIS signals for the watchlist | The watchlist lives in the browser, so it would need a config file |
| PWA / offline | Faster repeat visits | Small |

## CI (`.github/workflows/ci.yml`)

Runs on every push and pull request:

1. `ruff check` and `pytest` (pipeline).
2. `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm test` (Vitest) and `npm run build` in `site/`.
3. Shared-vector check: the Python test exports the vectors and the TS test consumes them. Both must pass.

## Definition of done (every phase)

- CI is green.
- README.md is updated: what the site is, local setup, running the pipeline, the Windows fallback and the disclaimer.
- There are no TODOs in code that this phase's scope covers.
- Any deviation is recorded in `DEVIATIONS.md` with the reason.
