// Playwright smoke test (headless Chromium): every Phase 2-3 route at 360 px and 1280 px.
// Checks: no console errors / page errors / failed requests, no horizontal page scroll, key content present.
// Also reports the gzip transfer size of the initial Dashboard load.
// Usage: VITE_BASE=/delivery-volume/ npm run build && node scripts/smoke.mjs   (starts `vite preview` itself)
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.VITE_BASE ?? '/delivery-volume/';
const PORT = Number(process.env.SMOKE_PORT ?? 4173);
const OUTDIR = process.env.SMOKE_OUTDIR; // optional: preview a build made with --outDir (default: dist)
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.SMOKE_SHOTS;
// SMOKE_THEME=dark runs the whole pass in dark mode (the theme is set before the app loads, 05 section 7 dark audit)
const THEME = process.env.SMOKE_THEME === 'dark' ? 'dark' : 'light';
const AXE_TAGS = ['wcag2a', 'wcag2aa'];

const preview = spawn(
  'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort', ...(OUTDIR ? ['--outDir', OUTDIR] : [])],
  {
    env: { ...process.env, VITE_BASE: BASE },
    shell: true,
    stdio: 'ignore',
  },
);

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${ORIGIN}${BASE}`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('vite preview did not start');
}

await waitUp();
const failures = [];
const fail = (m) => {
  failures.push(m);
  console.log('  FAIL', m);
};

const ROUTES = [
  {
    path: '#/',
    wait: 'h1:has-text("Dashboard")',
    expect: async (p) => (await p.locator('section[aria-label="Delivery spikes"] li').count()) > 0,
  },
  {
    path: '#/screener',
    wait: 'h1:has-text("Screener")',
    expect: async (p) => (await p.locator('[aria-label="Screener table"]').count()) === 1,
  },
  {
    path: '#/screener?u=NIFTY50&p=spikes',
    wait: 'h1:has-text("Screener")',
    expect: async (p) => {
      const t = await p.locator('h1 + p').innerText();
      const n = Number(/([\d,]+) stocks/.exec(t)?.[1]?.replace(/,/g, ''));
      return n > 0 && n <= 50;
    },
  },
  {
    path: '#/stock/RELIANCE',
    wait: 'h1:has-text("RELIANCE")',
    // Phase 5: the F&O pane (futures OI with the close, build-up shading, PCR) is on the page for an F&O stock
    expect: async (p) =>
      (await p.locator('canvas').count()) >= 2 &&
      (await p.locator('[data-testid=fo-pane]').count()) === 1 &&
      /Long build-up|Short build-up|Short covering|Long unwinding|No build-up code/.test(
        await p.locator('[data-testid=fo-latest]').innerText(),
      ),
  },
  // 07 section 7: the Stock page Runs tab (chart, runs table, a clicked run opens its footprint card) and the header
  // smart-money panel with its evidence label; the empty states (no runs; not enough history).
  {
    path: '#/stock/NATIONALUM?tab=runs',
    wait: 'h1:has-text("NATIONALUM")',
    expect: async (p) => {
      await p.waitForSelector('[data-testid=runs-table]', { timeout: 25000 });
      const rows = await p.locator('[data-testid=run-row]').count();
      await p.locator('[data-testid=run-row] button').nth(0).click();
      await p.waitForSelector('[data-testid=footprint-card]', { timeout: 10000 });
      const panel = await p.locator('[data-testid=smart-money]').innerText();
      return (
        rows === 12 &&
        (await p.locator('canvas').count()) >= 1 &&
        /Evidence summary, not advice\. You decide\./.test(panel) &&
        /6M: \d+ of 8 footprints lean accumulation/.test(panel)
      );
    },
  },
  {
    path: '#/stock/WELCORP?tab=runs',
    wait: 'h1:has-text("WELCORP")',
    expect: async (p) => {
      await p.waitForSelector('[data-testid=runs-table]', { timeout: 25000 });
      const rows = await p.locator('[data-testid=run-row]').count();
      await p.locator('[data-testid=run-row] button').nth(0).click();
      await p.waitForSelector('[data-testid=footprint-card]', { timeout: 10000 });
      return rows === 9 && (await p.locator('[data-testid=footprint-card]').count()) === 1;
    },
  },
  {
    path: '#/stock/21STCENMGM?tab=runs',
    wait: 'h1:has-text("21STCENMGM")',
    expect: async (p) =>
      (await p.locator('text=No runs of 20% or more in the stored history.').count()) > 0,
  },
  {
    path: '#/stock/ACEVECTOR?tab=runs',
    wait: 'h1:has-text("ACEVECTOR")',
    expect: async (p) => (await p.locator('text=Not enough history yet').count()) > 0,
  },
  {
    path: '#/stock/NATIONALUM',
    wait: 'h1:has-text("NATIONALUM")',
    expect: async (p) =>
      /6M: \d+ of 8 footprints lean accumulation/.test(
        await p.locator('[data-testid=smart-money]').innerText(),
      ),
  },
  {
    path: '#/screener?p=buLB',
    wait: 'h1:has-text("Screener")',
    // a build-up preset: its "Historically" line from signal_perf (or the not-enough-history line)
    expect: async (p) => /Historically|a ranking, not an event/.test(await p.locator('body').innerText()),
  },
  { path: '#/stock/NOSUCHSYM', wait: 'h1:has-text("No stock found")', expect: async () => true },
  {
    path: '#/learn',
    wait: 'h1:has-text("Learn")',
    expect: async (p) =>
      (await p.locator('text=Every delivered share has both a buyer and a seller').count()) > 0,
  },
  { path: '#/watchlist', wait: 'h1:has-text("Watchlist")', expect: async () => true },
  {
    path: '#/compare',
    wait: 'h1:has-text("Period Compare")',
    expect: async (p) => {
      await p.waitForSelector('section[aria-label="Delivery increased"] tbody tr', { timeout: 20000 });
      return (
        (await p.locator('canvas').count()) >= 1 &&
        /vs baseline/.test(await p.locator('[data-testid=range-text]').innerText())
      );
    },
  },
  {
    path: '#/compare?r=1W&bl=20&u=NIFTY500',
    wait: 'h1:has-text("Period Compare")',
    expect: async (p) => {
      await p.waitForSelector('section[aria-label="Delivery decreased"] tbody tr', { timeout: 20000 });
      return true;
    },
  },
  {
    path: '#/screener?rng=1',
    wait: 'h1:has-text("Screener")',
    expect: async (p) => {
      await p.waitForSelector('[aria-label="Screener table"] a', { timeout: 20000 });
      return /vs baseline/.test(await p.locator('[data-testid=range-text]').innerText());
    },
  },
  {
    path: '#/heatmap?u=TOTALMARKET',
    wait: 'h1:has-text("Heatmaps")',
    expect: async (p) => {
      await p.waitForSelector('[data-testid=tree-ms]:has-text("drawn in")', { timeout: 20000 });
      const t = await p.locator('[data-testid=tree-ms]').innerText();
      const ms = Number(/drawn in (\d+) ms/.exec(t)?.[1]);
      console.log(`     treemap (Total Market): ${t.split('.')[0]}`);
      if (ms >= 1000) fail(`treemap took ${ms} ms (limit 1000)`);
      return (await p.locator('canvas').count()) >= 1;
    },
  },
  {
    path: '#/heatmap?t=grid',
    wait: 'h1:has-text("Heatmaps")',
    expect: async (p) => (await p.locator('canvas').count()) >= 1,
  },
  {
    path: '#/heatmap?t=grid&u=NIFTY50&gr=stocks',
    wait: 'h1:has-text("Heatmaps")',
    expect: async (p) => (await p.locator('canvas').count()) >= 1,
  },
  {
    path: '#/heatmap?t=cal&cs=RELIANCE',
    wait: 'h1:has-text("Heatmaps")',
    expect: async (p) => {
      await p.waitForSelector('canvas', { timeout: 20000 });
      return true;
    },
  },
  {
    path: '#/stats',
    wait: 'h1:has-text("Market Statistics")',
    expect: async (p) => {
      await p.waitForSelector('section[aria-label="Signal performance"] tbody tr', { timeout: 20000 });
      return (
        (await p.locator('canvas').count()) >= 3 &&
        /Not a prediction/.test(await p.locator('[data-testid=perf-label]').innerText())
      );
    },
  },
];

// 07 section 6A: the Smart Money Trail (market mode, its controls, an as-of snapshot, stock mode)
ROUTES.push(
  {
    path: '#/trail',
    wait: 'h1:has-text("Smart Money Trail")',
    expect: async (p) => {
      await p.waitForSelector('[data-testid=list-a] tbody tr', { timeout: 25000 });
      await p.waitForSelector('[data-testid=track-record] tbody tr', { timeout: 25000 });
      const hist = await p.locator('[data-testid=history-a]').innerText();
      const ins = await p.locator('[data-testid=insights] li').count();
      const label = await p.locator('[data-testid=evidence-label]').innerText();
      return (
        /Historically/.test(hist) &&
        ins >= 5 &&
        ins <= 10 &&
        /not advice\. You decide/.test(label) &&
        (await p.locator('canvas').count()) >= 2
      );
    },
  },
  {
    path: '#/trail?tw=1Y&tu=NIFTY200',
    wait: 'h1:has-text("Smart Money Trail")',
    expect: async (p) => {
      await p.waitForSelector('[data-testid=list-flip]', { timeout: 25000 });
      return (await p.locator('[data-testid=indicator-rows] li').count()) === 8; // eight footprints (Phase 5)
    },
  },
  {
    path: '#/trail/RELIANCE',
    wait: 'h1:has-text("RELIANCE")',
    expect: async (p) => {
      await p.waitForSelector('[data-testid=narrative] li', { timeout: 25000 });
      await p.waitForSelector('[data-testid=timeline] tbody tr', { timeout: 25000 });
      const n = await p.locator('[data-testid=narrative] li').count();
      return (
        n >= 3 &&
        n <= 5 &&
        (await p.locator('canvas').count()) >= 1 &&
        (await p.locator('[data-testid=sector-compare]').count()) === 1 &&
        (await p.locator('section[aria-label="Named deals"]').count()) === 1 &&
        // Phase 5: the F&O footprint row replaces the "arrives in Phase 5" slot
        /F&O build-up days/.test(await p.locator('[data-testid=stock-indicators]').innerText()) &&
        !/arrives in/.test(await p.locator('body').innerText()) &&
        /No shareholding filings stored for this stock yet/.test(
          await p.locator('[data-testid=holdings-card]').innerText(),
        )
      );
    },
  },
  {
    // a stock with holdings in the store (Phase 4B): bars per quarter, named holders with status, two holdings rows
    path: '#/trail/AUROPHARMA',
    wait: 'h1:has-text("AUROPHARMA")',
    expect: async (p) => {
      await p.waitForSelector('[data-testid=holdings-bars] li', { timeout: 25000 });
      await p.waitForSelector('[data-testid=timeline] tbody tr', { timeout: 25000 });
      const bars = await p.locator('[data-testid=holdings-bars] li').count();
      const named = await p.locator('[data-testid=named-holders] li').count();
      const chips = await p.locator('[data-testid=holdings-chips] .chip').count();
      const foot = await p.locator('section[aria-label="Footprints"]').innerText();
      return (
        bars >= 1 &&
        named >= 1 &&
        chips >= 1 &&
        foot.includes('FII + DII holdings') &&
        foot.includes('Promoter holdings')
      );
    },
  },
  { path: '#/trail/NOSUCHSYM', wait: 'h1:has-text("No stock found")', expect: async () => true },
  // Phase 4: institutions (P6), deals (P7) and the entity page (items of the list above)
  {
    path: '#/institutions',
    wait: 'h1:has-text("Institutions")',
    expect: async (p) => {
      await p.waitForSelector('section[aria-label="Cash summary"]', { timeout: 25000 });
      return (await p.locator('canvas').count()) >= 1;
    },
  },
  {
    path: '#/institutions?tab=deriv',
    wait: 'h1:has-text("Institutions")',
    expect: async (p) => {
      await p.waitForSelector('section[aria-label="Latest positioning"]', { timeout: 25000 });
      return (await p.locator('canvas').count()) >= 3;
    },
  },
  {
    path: '#/institutions?tab=s7',
    wait: 'h1:has-text("Institutions")',
    expect: async (p) => {
      await p.waitForSelector('section[aria-label="FII derivatives on the latest day"]', { timeout: 25000 });
      return (await p.locator('canvas').count()) >= 2;
    },
  },
  {
    path: '#/deals',
    wait: 'h1:has-text("Bulk and block deals")',
    expect: async (p) => {
      await p.waitForSelector('section[aria-label="FII vs DII by stock"]', { timeout: 25000 });
      return (await p.locator('section[aria-label="Deal list"] table').count()) === 1;
    },
  },
  {
    path: '#/entity/goldman-sachs',
    wait: 'h1:has-text("Goldman Sachs")',
    expect: async (p) => (await p.locator('section[aria-label="Aliases"] li').count()) >= 2,
  },
  // Phase 4B: shareholding (S16). Ownership on the stock page (holdings and none), the Holdings tab, a disclosed-holdings entity, the Screener ownership preset
  {
    path: '#/stock/AUROPHARMA',
    wait: 'h1:has-text("AUROPHARMA")',
    expect: async (p) => {
      await p.waitForSelector('[data-testid=ownership-bars] li', { timeout: 25000 });
      return (
        (await p.locator('[data-testid=ownership-bars] li').count()) === 4 &&
        (await p.locator('[data-testid=ownership-changes]').count()) === 1 &&
        (await p.locator('table[aria-label="Named holders above 1%"] tbody tr').count()) > 0
      );
    },
  },
  {
    path: '#/stock/RELIANCE',
    wait: 'section[aria-label="Ownership"]',
    expect: async (p) =>
      /No shareholding filings stored for this stock yet\./.test(
        await p.locator('section[aria-label="Ownership"]').innerText(),
      ),
  },
  {
    path: '#/institutions?tab=holdings',
    wait: '[data-testid=holdings-tab]',
    expect: async (p) => {
      await p.waitForSelector('[data-testid=holdings-trend] tbody tr', { timeout: 25000 });
      return (
        /Holdings stored for \d+ of \d+ companies/.test(
          await p.locator('[data-testid=holdings-coverage]').innerText(),
        ) && (await p.locator('section[aria-label="Biggest changes"] li').count()) > 0
      );
    },
  },
  {
    path: '#/entity/hdfc-mf',
    wait: 'section[aria-label="Disclosed holdings"]',
    expect: async (p) => {
      await p.waitForSelector('[data-testid=disclosed-holdings] tbody tr', { timeout: 25000 });
      return (await p.locator('[data-testid=disclosed-holdings] tbody tr').count()) > 0;
    },
  },
  {
    path: '#/screener?p=fiiUp',
    wait: 'h1:has-text("Screener")',
    expect: async (p) =>
      (await p.locator('button[aria-pressed=true]:has-text("FII stake up last quarter")').count()) === 1 &&
      /ranking, not an event/.test(await p.locator('[data-testid=history-fiiUp]').innerText()),
  },
  {
    path: '#/learn',
    wait: 'h1:has-text("Learn")',
    expect: async (p) => (await p.locator('[data-testid=learn-trail]').count()) === 1,
  },
);
{
  const latest = await (await fetch(`${ORIGIN}${BASE}data/trail/latest.json`)).json();
  const d = latest.snapshots?.[Math.floor((latest.snapshots?.length ?? 0) / 2)];
  if (d) {
    ROUTES.push({
      path: `#/trail?ta=${d}`,
      wait: 'h1:has-text("Smart Money Trail")',
      expect: async (p) => {
        await p.waitForSelector('[data-testid=asof-note]', { timeout: 25000 });
        await p.waitForSelector('[data-testid=list-a] tbody tr', { timeout: 25000 });
        return (await p.locator('[data-testid=list-a] th:has-text("Since")').count()) === 1;
      },
    });
  } else fail('trail/latest.json has no as-of snapshots');
}

// 08 section 6: D / W / M / Q / Custom (N-day bars) / Custom (date range) on Screener, Stock, Compare, Heatmaps and Stats.
const TFS = ['', 'tf=w', 'tf=m', 'tf=q', 'tf=c&n=10', 'tf=r&from=2026-06-01&to=2026-09-30&base=prev'];
const TF_PAGES = [
  {
    base: '#/screener',
    wait: 'h1:has-text("Screener")',
    sel: '[aria-label="Screener table"], [aria-label="Screener table"] a',
  },
  { base: '#/stock/RELIANCE', wait: 'h1:has-text("RELIANCE")', sel: 'canvas' },
  { base: '#/compare', wait: 'h1:has-text("Period Compare")', sel: 'canvas' },
  { base: '#/heatmap?u=NIFTY500', wait: 'h1:has-text("Heatmaps")', sel: 'canvas' },
  { base: '#/heatmap?t=grid', wait: 'h1:has-text("Heatmaps")', sel: 'canvas' },
  { base: '#/stats', wait: 'h1:has-text("Market Statistics")', sel: 'canvas' },
];
for (const pg of TF_PAGES) {
  for (const tf of TFS) {
    const sep = pg.base.includes('?') ? '&' : '?';
    ROUTES.push({
      path: tf ? `${pg.base}${sep}${tf}` : pg.base,
      wait: pg.wait,
      expect: async (p) => {
        await p.waitForSelector(pg.sel, { timeout: 25000 });
        return (
          (await p
            .locator('[data-testid=period-picker], [data-testid=custom-controls], [aria-label=Timeframe]')
            .count()) > 0
        );
      },
    });
  }
}

let initial = null;
try {
  const browser = await chromium.launch();
  for (const vp of [
    { w: 360, h: 740 },
    { w: 1280, h: 800 },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 1,
      hasTouch: vp.w < 500,
    });
    await ctx.addInitScript((theme) => {
      try {
        localStorage.setItem('dv.theme', theme);
      } catch {
        /* storage blocked: the system theme applies */
      }
    }, THEME);
    for (const route of ROUTES) {
      const page = await ctx.newPage();
      const errors = [];
      const bodies = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
      page.on('response', async (r) => {
        if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
        try {
          bodies.push({ url: r.url(), size: gzipSync(await r.body()).length });
        } catch {
          /* redirects have no body */
        }
      });
      const label = `${vp.w}px ${route.path}`;
      await page.goto(`${ORIGIN}${BASE}${route.path}`);
      try {
        await page.waitForSelector(route.wait, { timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 20000 });
        await page.waitForTimeout(400);
      } catch (e) {
        fail(`${label}: ${e.message.split('\n')[0]}`);
      }
      const sw = await page.evaluate(() => ({
        s: document.documentElement.scrollWidth,
        c: document.documentElement.clientWidth,
      }));
      const ok = await route.expect(page).catch(() => false);
      // accessibility: axe (WCAG 2 A and AA) must find no critical or serious violation
      const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      const axeBad = axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      for (const v of axeBad) fail(`${label}: axe ${v.id} (${v.impact}) on ${v.nodes.length} node(s)`);
      console.log(
        `${ok && sw.s <= sw.c && errors.length === 0 ? 'ok  ' : 'FAIL'} ${label} (scrollWidth ${sw.s} / ${sw.c})`,
      );
      if (sw.s > sw.c) fail(`${label}: horizontal page scroll ${sw.s} > ${sw.c}`);
      if (!ok) fail(`${label}: expected content missing`);
      for (const e of errors) fail(`${label}: ${e}`);
      if (route.path === '#/' && vp.w === 360) {
        initial = { total: bodies.reduce((s, b) => s + b.size, 0), bodies };
      }
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({
          path: `${SHOTS}/${vp.w}-${route.path.replace(/[^a-z0-9]+/gi, '_')}.png`,
          fullPage: false,
        });
      }
      await page.close();
    }

    // Daily delivery watch: one tap sets the approved filters and the Delivery spikes preset in the URL
    {
      const wp = await ctx.newPage();
      const werr = [];
      wp.on('console', (m) => m.type() === 'error' && werr.push(`console: ${m.text()}`));
      wp.on('pageerror', (e) => werr.push(`pageerror: ${e.message}`));
      await wp.goto(`${ORIGIN}${BASE}#/screener`);
      await wp.waitForSelector('[data-testid=daily-watch]');
      await wp.click('[data-testid=daily-watch]');
      await wp.waitForSelector('[aria-label="Screener table"] a', { timeout: 20000 });
      const q = new URLSearchParams(wp.url().split('?')[1] ?? '');
      const want = { u: 'NIFTY500', mt: '5', he: '1', hetf: '1', p: 'spikes' };
      for (const [k, v] of Object.entries(want))
        if (q.get(k) !== v) fail(`${vp.w}px watch: ${k}=${q.get(k)} (want ${v})`);
      const count = Number(
        /([\d,]+) stocks/.exec(await wp.locator('h1 + p').innerText())?.[1]?.replace(/,/g, ''),
      );
      if (!(count > 0 && count <= 500)) fail(`${vp.w}px watch: ${count} stocks`);
      if ((await wp.locator('[data-testid="history-acc"]').count()) !== 1)
        fail(`${vp.w}px: history line missing under the ACC preset`);
      const sw2 = await wp.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      if (!sw2) fail(`${vp.w}px: horizontal scroll on the screener with presets`);
      if (SHOTS) await wp.screenshot({ path: `${SHOTS}/${vp.w}-screener-watch.png` });
      for (const e of werr) fail(`${vp.w}px watch: ${e}`);
      console.log(
        `${werr.length ? 'FAIL' : 'ok  '} ${vp.w}px Daily delivery watch (${count} stocks, ${wp.url().split('?')[1]})`,
      );
      await wp.close();
    }

    // the three Smart Money Trail buttons: Dashboard, Screener and Stock page
    for (const [from, testid, want] of [
      ['#/', 'trail-button', /#\/trail$/],
      ['#/screener', 'trail-button', /#\/trail$/],
      ['#/stock/RELIANCE', 'trail-button-stock', /#\/trail\/RELIANCE$/],
    ]) {
      const bp = await ctx.newPage();
      const berr = [];
      bp.on('console', (m) => m.type() === 'error' && berr.push(`console: ${m.text()}`));
      bp.on('pageerror', (e) => berr.push(`pageerror: ${e.message}`));
      await bp.goto(`${ORIGIN}${BASE}${from}`);
      await bp.waitForSelector(`[data-testid=${testid}]`, { timeout: 20000 });
      const text = (await bp.locator(`[data-testid=${testid}]`).first().innerText()).trim();
      await bp.click(`[data-testid=${testid}]`);
      await bp.waitForSelector('h1:has-text("Trail"), h1:has-text("RELIANCE")', { timeout: 20000 });
      if (!want.test(bp.url().split('?')[0])) fail(`${vp.w}px ${from}: trail button went to ${bp.url()}`);
      if (!/Smart Money Trail|trail/i.test(text)) fail(`${vp.w}px ${from}: trail button text "${text}"`);
      for (const e of berr) fail(`${vp.w}px ${from} trail button: ${e}`);
      console.log(`${berr.length ? 'FAIL' : 'ok  '} ${vp.w}px "${text}" button on ${from}`);
      await bp.close();
    }

    // empty and error states (05 section 5): a 404 for a day's file reads as a plain note; a network failure shows the error box
    if (vp.w === 360) {
      const sp = await ctx.newPage();
      const serr = [];
      sp.on('pageerror', (e) => serr.push(`pageerror: ${e.message}`));
      await sp.route('**/data/daily/2026-11-12.json*', (r) => r.fulfill({ status: 404, body: 'not found' }));
      await sp.goto(`${ORIGIN}${BASE}#/screener?d=2026-11-12`);
      await sp
        .waitForSelector('text=No data for this date.', { timeout: 20000 })
        .catch(() => fail('404 date: no plain note'));
      if ((await sp.locator('[role=alert]').count()) !== 0) fail('404 date: shown as an error box');
      await sp.route('**/data/daily/2026-11-11.json*', (r) => r.abort('failed'));
      await sp.goto(`${ORIGIN}${BASE}#/screener?d=2026-11-11`);
      await sp
        .waitForSelector('[role=alert]', { timeout: 20000 })
        .catch(() => fail('network failure: no error box'));
      if ((await sp.locator('[role=alert] button:has-text("Try again")').count()) !== 1)
        fail('error box: no Try again');
      for (const e of serr) fail(`404/error states: ${e}`);
      console.log(
        `${serr.length ? 'FAIL' : 'ok  '} 360px empty and error states (404 date note, network error box)`,
      );
      await sp.close();
      // an unknown symbol gets a message and a way back to search
      const up = await ctx.newPage();
      await up.goto(`${ORIGIN}${BASE}#/stock/NOSUCHSYM`);
      await up.waitForSelector('h1:has-text("No stock found")', { timeout: 20000 });
      if ((await up.locator('input').count()) < 1) fail('unknown symbol: no search box to get back');
      await up.close();
    }

    // interactions: filter drawer, theme toggle, star + watchlist, date control
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(`${ORIGIN}${BASE}#/stock/RELIANCE`);
    await page.waitForSelector('h1:has-text("RELIANCE")');
    await page.click('button[aria-label^="Add RELIANCE"]');
    await page.click('button:has-text("Filters")');
    await page.selectOption('[role=dialog] select', 'NIFTY50');
    await page.waitForTimeout(200);
    const url = page.url();
    if (!url.includes('u=NIFTY50')) fail(`${vp.w}px: filter did not reach the URL (${url})`);
    const sw = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    if (!sw) fail(`${vp.w}px: horizontal scroll with the filter drawer open`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.w}-filters.png` });
    await page.click('[role=dialog] button:has-text("Done")');
    await page.click('button[aria-label^="Theme"]');
    await page.click('button[aria-label^="Theme"]');
    await page.goto(
      `${ORIGIN}${BASE}#/watchlist${new URL(page.url()).hash.includes('?') ? '?' + page.url().split('?')[1] : ''}`,
    );
    await page.waitForSelector('h1:has-text("Watchlist")');
    await page.waitForTimeout(800);
    const hasRow = (await page.locator('[aria-label="Screener table"] a:has-text("RELIANCE")').count()) === 1;
    if (!hasRow) fail(`${vp.w}px: starred RELIANCE missing from the watchlist`);
    // date control: previous trading day changes ?d=
    await page.click('button[aria-label="Previous trading day"]');
    await page.waitForTimeout(200);
    if (!/[?&]d=\d{4}-\d{2}-\d{2}/.test(page.url())) fail(`${vp.w}px: date arrows did not set ?d=`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.w}-watchlist-dark.png` });
    for (const e of errors) fail(`${vp.w}px interactions: ${e}`);
    console.log(
      `${errors.length ? 'FAIL' : 'ok  '} ${vp.w}px interactions (filters, theme, star, watchlist, date)`,
    );
    await ctx.close();
  }
  await browser.close();
  if (initial) {
    const js = initial.bodies.filter((b) => b.url.endsWith('.js')).reduce((s, b) => s + b.size, 0);
    const data = initial.bodies.filter((b) => b.url.includes('/data/')).reduce((s, b) => s + b.size, 0);
    console.log(
      `Initial Dashboard load (gzip): total ${(initial.total / 1024).toFixed(0)} KB; JS ${(js / 1024).toFixed(0)} KB; data ${(data / 1024).toFixed(0)} KB`,
    );
    for (const b of initial.bodies.sort((a, c) => c.size - a.size).slice(0, 8))
      console.log(`   ${(b.size / 1024).toFixed(0).padStart(5)} KB  ${b.url.replace(ORIGIN, '')}`);
  }
} finally {
  preview.kill();
  spawn('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nSmoke test passed');
process.exit(failures.length ? 1 : 0);
