# NSE Delivery Volume Analytics — Build Specs

**Audience:** the implementing coding agent (Claude Sonnet). Read every file in this folder before writing code, then build in the phase order in [06-phases-and-acceptance.md](06-phases-and-acceptance.md). Do not skip Phase 0.

## Files (read in order)

| # | File | What it defines |
|---|------|-----------------|
| 1 | [01-product-and-architecture.md](01-product-and-architecture.md) | Purpose, scope, architecture, tech stack, repo layout, non-functional requirements |
| 2 | [02-data-sources.md](02-data-sources.md) | Every NSE URL, its exact columns and quirks. Most were verified on 2026-11-14 |
| 3 | [03-data-pipeline.md](03-data-pipeline.md) | Python pipeline, CLI, raw store layout, generated JSON contracts, scheduling, backfill |
| 4 | [04-analytics.md](04-analytics.md) | Formula and threshold for every metric and signal |
| 5 | [05-frontend.md](05-frontend.md) | Pages, filters, charts, heat maps, data loading, UX rules |
| 6 | [06-phases-and-acceptance.md](06-phases-and-acceptance.md) | Build order, acceptance criteria per phase, tests, CI |

## Fixed decisions (do not change without asking the user)

1. **NSE only in v1.** No BSE. Keep an `exchange` concept out of the code for now, but don't hard-code anything that would block adding BSE by ISIN later (Phase 6).
2. **Static site, no runtime server.** The browser never calls NSE. A scheduled GitHub Actions job runs a Python pipeline that downloads NSE files, stores them in the repo, and generates JSON. A static site (GitHub Pages) reads only that JSON.
3. **Pipeline:** Python 3.12, `requests`, `pandas`, `xlrd` (one legacy `.xls` source), `jsonschema`, `pytest`.
4. **Frontend:** Vite + React + TypeScript (strict) + Apache ECharts + TanStack Table/Virtual + Tailwind CSS. HashRouter.
5. **History:** backfill from 2025-11-01 (about 1 year). Configurable.
6. **Units in the UI:** money in ₹ Crore with Indian digit grouping (`en-IN`); dates are IST trading dates as `YYYY-MM-DD` strings.
7. **Comparisons across dates use delivery *value* (₹) or delivery *%*, never raw delivery quantity.** Raw quantity breaks on splits and bonus issues.

## Decisions confirmed by the user (2026-11-14)

| Decision | Confirmed choice |
|----------|------------------|
| Repo visibility / host | Public GitHub repo + GitHub Pages |
| Where the fetch runs | GitHub Actions cron first. The user's Windows PC (Task Scheduler + `git push`) is an accepted fallback for any source NSE blocks from GitHub's servers. |
| SME stocks (series SM, ST) | **Excluded entirely.** Drop SM/ST rows at parse time. There is no SME toggle, flag or bucket anywhere. |
| History depth | 1 year (`backfillFrom: 2025-11-01`) |
| Per-stock FII/DII tracking | In scope: named FII/DII deal flows (daily, Phase 4) and quarterly shareholding patterns (Phase 4B) |

## Working rules for the implementer

- Treat NSE file formats as unstable. Validate headers on every fetch. A failure in one source must never stop the other sources.
- Use only the endpoints listed in 02. Ask the user before adding any other site, any paid service, or any login/cookie-based scraping that isn't listed.
- Respect NSE: at most 1 request/second, browser-like headers, retries with backoff, never parallel bursts.
- Record any deviation from these specs, and why, in `docs/specs/DEVIATIONS.md`.
- At the end of Phase 0, **stop and report to the user** before continuing (see 06).
- No investment advice in any UI copy. Signals are descriptive labels, not recommendations.
