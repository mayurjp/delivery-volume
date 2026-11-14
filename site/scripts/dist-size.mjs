// Reports the total size of the build output and enforces the 07 section 8 budget: warn above 800 MB, fail above 900 MB.
// Usage: node scripts/dist-size.mjs [dir]   (default dist; DIST_DIR also works)
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? process.env.DIST_DIR ?? 'dist';
const WARN = 800e6;
const FAIL = 900e6;

function walk(d) {
  let total = 0;
  let files = 0;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) {
      const r = walk(p);
      total += r.total;
      files += r.files;
    } else {
      total += statSync(p).size;
      files++;
    }
  }
  return { total, files };
}

const { total, files } = walk(dir);
const mb = (total / 1e6).toFixed(1);
console.log(`dist size: ${mb} MB in ${files} files (warn above 800 MB, fail above 900 MB)`);
if (total > FAIL) {
  console.log(`::error::dist/ is ${mb} MB, above the 900 MB budget (GitHub Pages limit 1 GB). See docs/specs/07-run-forensics.md section 8 for the fallback.`);
  process.exit(1);
}
if (total > WARN) console.log(`::warning::dist/ is ${mb} MB, above 800 MB. Plan the Cloudflare Pages fallback (07 section 8).`);
