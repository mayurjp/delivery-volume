import { describe, expect, it } from 'vitest';
import { errorSummary, missingMessage } from './errors';

describe('missingMessage', () => {
  it('a missing daily file says there is no data for this date', () => {
    expect(missingMessage('/data/daily/2026-01-01.json?v=2026-11-14T10%3A00%3A00%2B05%3A30: HTTP 404')).toBe(
      'No data for this date.',
    );
  });

  it('a missing holdings or shareholding file says the data is not available for this stock', () => {
    expect(missingMessage('/data/holders/2026-09.json: HTTP 404')).toBe('Not available for this stock.');
    expect(missingMessage('/data/holdings/latest.json: HTTP 404')).toBe('Not available for this stock.');
  });

  it('a missing F&O day file says there is no F&O data for this date', () => {
    expect(missingMessage('/data/fo/2026-01-01.json?v=x: HTTP 404')).toBe('No F&O data for this date.');
  });

  it('other HTTP errors and network or parse failures are real errors', () => {
    expect(missingMessage('/data/market.json: HTTP 500')).toBeNull();
    expect(missingMessage('Failed to fetch')).toBeNull();
    expect(missingMessage('Unexpected token < in JSON')).toBeNull();
  });
});

describe('errorSummary', () => {
  it('hides the URL behind an HTTP status', () => {
    expect(errorSummary('/data/market.json?v=1: HTTP 500')).toBe('the file could not be read');
  });

  it('keeps other messages as they are', () => {
    expect(errorSummary('Failed to fetch')).toBe('Failed to fetch');
  });
});
