/**
 * Missing-file wording (05 section 5, Phase 5). The data client rejects with "<url>: HTTP <status>". A 404 is a
 * normal answer for a date or stock that has no file, so it gets a plain sentence instead of an error box.
 */

const NOT_FOUND = /HTTP 404\b/;

/** Plain text for a missing file, or null when the message is a real error. */
export function missingMessage(message: string): string | null {
  if (!NOT_FOUND.test(message)) return null;
  if (/holders|holdings|shareholding/i.test(message)) return 'Not available for this stock.';
  if (/\/fo\//.test(message)) return 'No F&O data for this date.';
  return 'No data for this date.';
}

/** The message a user should see for a failed load (the URL and status are kept out of the sentence). */
export function errorSummary(message: string): string {
  return message.replace(/^\S*?:\s*HTTP \d+$/, 'the file could not be read');
}
