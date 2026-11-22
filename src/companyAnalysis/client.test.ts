import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCompanyAnalysis, parseAnalysis } from './client.ts';

// trimmed down version of a real response from the endpoint
const RIVERLINE = {
  vertical: 'igaming',
  companyType: 'operator',
  operatingRegions: ['US', 'CA'],
  supportMotion: 'high_volume',
  isCryptoRelated: false,
  kycAmlIntensity: 'high',
  likelyTicketDrivers: ['withdrawals', 'kyc', 'account_access'],
  complianceThemes: ['responsible_gaming', 'aml'],
  confidence: 0.9974874646215341,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// hands back the queued responses in order and counts the calls
function fakeFetch(responses: Array<Response | Error>) {
  const state = { calls: 0 };
  const impl: typeof fetch = () => {
    const next = responses[state.calls++];
    if (next === undefined) return Promise.reject(new Error('fakeFetch ran out of responses'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { impl, state };
}

const noSleep = async () => {};

test('parseAnalysis keeps good fields', () => {
  const parsed = parseAnalysis(RIVERLINE);
  assert.equal(parsed?.companyType, 'operator');
  assert.deepEqual(parsed?.likelyTicketDrivers, ['withdrawals', 'kyc', 'account_access']);
});

test('parseAnalysis treats tbd / n/a as missing', () => {
  const parsed = parseAnalysis({ ...RIVERLINE, kycAmlIntensity: 'tbd', vertical: 'N/A' });
  assert.equal(parsed?.kycAmlIntensity, undefined);
  assert.equal(parsed?.vertical, undefined);
});

test('parseAnalysis rejects responses without a numeric confidence', () => {
  assert.equal(parseAnalysis({ ...RIVERLINE, confidence: 'high' }), null);
  assert.equal(parseAnalysis('nope'), null);
  assert.equal(parseAnalysis(null), null);
});

test('parseAnalysis drops junk inside lists instead of failing', () => {
  const parsed = parseAnalysis({ ...RIVERLINE, operatingRegions: ['US', 42, null, 'EU'] });
  assert.deepEqual(parsed?.operatingRegions, ['US', 'EU']);
});

test('returns the analysis on a 200', async () => {
  const { impl } = fakeFetch([json(200, RIVERLINE)]);
  const result = await fetchCompanyAnalysis('Riverline Sportsbook', { fetchImpl: impl, sleep: noSleep });
  assert.equal(result.ok, true);
});

test('retries a 503 and then succeeds', async () => {
  const { impl, state } = fakeFetch([json(503, {}), json(503, {}), json(200, RIVERLINE)]);
  const result = await fetchCompanyAnalysis('Riverline Sportsbook', { fetchImpl: impl, sleep: noSleep });
  assert.equal(result.ok, true);
  assert.equal(state.calls, 3);
});

test('gives up after the retries run out', async () => {
  const { impl, state } = fakeFetch([json(503, {}), json(503, {}), json(503, {})]);
  const result = await fetchCompanyAnalysis('Riverline Sportsbook', { fetchImpl: impl, sleep: noSleep });
  assert.deepEqual(result, { ok: false, reason: 'endpoint returned 503' });
  assert.equal(state.calls, 3);
});

test('does not retry other errors', async () => {
  const { impl, state } = fakeFetch([json(500, {})]);
  const result = await fetchCompanyAnalysis('x', { fetchImpl: impl, sleep: noSleep });
  assert.equal(result.ok, false);
  assert.equal(state.calls, 1);
});

test('a timeout fails fast without retrying', async () => {
  const timeout = new DOMException('The operation timed out.', 'TimeoutError');
  const { impl, state } = fakeFetch([timeout]);
  const result = await fetchCompanyAnalysis('x', { fetchImpl: impl, sleep: noSleep, timeoutMs: 50 });
  assert.deepEqual(result, { ok: false, reason: 'timed out after 50ms' });
  assert.equal(state.calls, 1);
});
