import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanyAnalysis } from './client.ts';
import { toGtmContext } from './confidence.ts';

const base: CompanyAnalysis = {
  vertical: 'igaming',
  companyType: 'operator',
  operatingRegions: ['US', 'CA'],
  supportMotion: 'high_volume',
  isCryptoRelated: false,
  kycAmlIntensity: 'high',
  likelyTicketDrivers: [
    'withdrawals',
    'kyc',
    'account_access',
    'promos',
    'bet_settlement',
    'payment_methods',
  ],
  complianceThemes: ['responsible_gaming', 'pii', 'aml', 'geolocation'],
  confidence: 0.9,
};

test('no analysis means no helper context', () => {
  assert.equal(toGtmContext(null).tier, 'none');
});

test('0.15 is ignored, 0.85 is used in full (the example from the brief)', () => {
  assert.equal(toGtmContext({ ...base, confidence: 0.15 }).tier, 'none');
  assert.equal(toGtmContext({ ...base, confidence: 0.85 }).tier, 'high');
});

test('tier boundaries', () => {
  assert.equal(toGtmContext({ ...base, confidence: 0.39 }).tier, 'none');
  assert.equal(toGtmContext({ ...base, confidence: 0.4 }).tier, 'medium');
  assert.equal(toGtmContext({ ...base, confidence: 0.69 }).tier, 'medium');
  assert.equal(toGtmContext({ ...base, confidence: 0.7 }).tier, 'high');
});

test('medium tier only passes the broad facts', () => {
  const ctx = toGtmContext({ ...base, confidence: 0.6 });
  assert.equal(ctx.tier, 'medium');
  if (ctx.tier !== 'medium') return;
  assert.deepEqual(Object.keys(ctx.facts).sort(), [
    'companyType',
    'likelyTicketDrivers',
    'supportMotion',
    'vertical',
  ]);
});

test('high tier caps the lists and drops fields that add nothing', () => {
  const ctx = toGtmContext(base);
  assert.equal(ctx.tier, 'high');
  if (ctx.tier !== 'high') return;
  assert.equal(ctx.facts.likelyTicketDrivers.length, 4);
  assert.equal(ctx.facts.complianceThemes.length, 3);
  assert.equal(ctx.facts.isCryptoRelated, undefined);
  assert.equal(ctx.facts.kycAmlIntensity, 'high');
});

test('high tier keeps crypto when it is true', () => {
  const ctx = toGtmContext({ ...base, isCryptoRelated: true, kycAmlIntensity: 'low' });
  if (ctx.tier !== 'high') return assert.fail('expected high tier');
  assert.equal(ctx.facts.isCryptoRelated, true);
  assert.equal(ctx.facts.kycAmlIntensity, undefined);
});

test('KYC intensity is matched case-insensitively', () => {
  const ctx = toGtmContext({ ...base, kycAmlIntensity: 'High' });
  if (ctx.tier !== 'high') return assert.fail('expected high tier');
  assert.equal(ctx.facts.kycAmlIntensity, 'high');
});
