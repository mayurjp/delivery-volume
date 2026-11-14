/**
 * CSV export (05 section 4, Phase 5). One helper for every table: plain headers, raw numbers (no ₹ or thousands
 * separators), RFC 4180 quoting, CRLF line endings. Callers pass the rows the user currently sees.
 */

export type CsvCell = string | number | boolean | null | undefined;

/** Quotes a field when it holds a comma, a double quote, or a line break; doubles embedded quotes. */
export function csvEscape(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvText(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))];
  return lines.join('\r\n') + '\r\n';
}

/** `screener` + `2026-11-13` gives `screener-2026-11-13.csv`. Anything that is not a-z, 0-9 or "-" is dropped from the view name. */
export function csvFileName(view: string, date: string): string {
  const slug =
    view
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'table';
  const d = date.replace(/[^0-9a-zA-Z_-]/g, '');
  return d ? `${slug}-${d}.csv` : `${slug}.csv`;
}

/** Saves text as a file through a temporary object URL. Failures (no DOM, blocked download) are swallowed. */
export function downloadCsv(fileName: string, text: string): boolean {
  try {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

/** Builds the file name from the view and date, then saves the rows. */
export function exportCsv(
  view: string,
  date: string,
  headers: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): boolean {
  return downloadCsv(csvFileName(view, date), csvText(headers, rows));
}
