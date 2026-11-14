// Playwright smoke test (headless Chromium): every Phase 2 route at 360 px and 1280 px.
// Checks: no console errors / page errors / failed requests, no horizontal page scroll, key content present.
// Also reports the gzip transfer size of the initial Dashboard load.
// Usage: VITE_BASE=/delivery-volume/ npm run build && node scripts/smoke.mjs   (starts `vite preview` itself)
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.VITE_BASE ?? '/delivery-volume/';
const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.SMOKE_SHOTS;

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  env: { ...process.env, VITE_BASE: BASE },
  shell: true,
  stdio: 'ignore',
});

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

const failures = [];
const fail = (m) => {
  failures.push(m);
  console.log('  FAIL', m);
};

const ROUTES = [
  { path: '#/', wait: 'h1:has-text("Dashboard")', expect: async (p) => (await p.locator('section[aria-label="Delivery spikes"] li').count()) > 0 },
  { path: '#/screener', wait: 'h1:has-text("Screener")', expect: async (p) => (await p.locator('[aria-label="Screener table"]').count()) === 1 },
  {
    path: '#/screener?u=NIFTY50&p=spikes',
    wait: 'h1:has-text("Screener")',
    expect: async (p) => {
      const t = await p.locator('h1 + p').innerText();
      const n = Number(/([\d,]+) stocks/.exec(t)?.[1]?.replace(/,/g, ''));
      return n > 0 && n <= 50;
    },
  },
  { path: '#/stock/RELIANCE', wait: 'h1:has-text("RELIANCE")', expect: async (p) => (await p.locator('canvas').count()) >= 2 },
  { path: '#/stock/NOSUCHSYM', wait: 'h1:has-text("No stock found")', expect: async () => true },
  { path: '#/learn', wait: 'h1:has-text("Learn")', expect: async (p) => (await p.locator('text=Every delivered share has both a buyer and a seller').count()) > 0 },
  { path: '#/watchlist', wait: 'h1:has-text("Watchlist")', expect: async () => true },
  { path: '#/compare', wait: 'h1:has-text("Period Compare")', expect: async () => true },
];

let initial = null;
try {
  await waitUp();
  const browser = await chromium.launch();
  for (const vp of [{ w: 360, h: 740 }, { w: 1280, h: 800 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, hasTouch: vp.w < 500 });
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
      const sw = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
      const ok = await route.expect(page).catch(() => false);
      console.log(`${ok && sw.s <= sw.c && errors.length === 0 ? 'ok  ' : 'FAIL'} ${label} (scrollWidth ${sw.s} / ${sw.c})`);
      if (sw.s > sw.c) fail(`${label}: horizontal page scroll ${sw.s} > ${sw.c}`);
      if (!ok) fail(`${label}: expected content missing`);
      for (const e of errors) fail(`${label}: ${e}`);
      if (route.path === '#/' && vp.w === 360) {
        initial = { total: bodies.reduce((s, b) => s + b.size, 0), bodies };
      }
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/${vp.w}-${route.path.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: false });
      }
      await page.close();
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
    const sw = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    if (!sw) fail(`${vp.w}px: horizontal scroll with the filter drawer open`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.w}-filters.png` });
    await page.click('[role=dialog] button:has-text("Done")');
    await page.click('button[aria-label^="Theme"]');
    await page.click('button[aria-label^="Theme"]');
    await page.goto(`${ORIGIN}${BASE}#/watchlist${new URL(page.url()).hash.includes('?') ? '?' + page.url().split('?')[1] : ''}`);
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
    console.log(`${errors.length ? 'FAIL' : 'ok  '} ${vp.w}px interactions (filters, theme, star, watchlist, date)`);
    await ctx.close();
  }
  await browser.close();
  if (initial) {
    const js = initial.bodies.filter((b) => b.url.endsWith('.js')).reduce((s, b) => s + b.size, 0);
    const data = initial.bodies.filter((b) => b.url.includes('/data/')).reduce((s, b) => s + b.size, 0);
    console.log(`Initial Dashboard load (gzip): total ${(initial.total / 1024).toFixed(0)} KB; JS ${(js / 1024).toFixed(0)} KB; data ${(data / 1024).toFixed(0)} KB`);
    for (const b of initial.bodies.sort((a, c) => c.size - a.size).slice(0, 8)) console.log(`   ${(b.size / 1024).toFixed(0).padStart(5)} KB  ${b.url.replace(ORIGIN, '')}`);
  }
} finally {
  preview.kill();
  spawn('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nSmoke test passed');
process.exit(failures.length ? 1 : 0);
