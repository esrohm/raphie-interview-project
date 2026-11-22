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

test('tier boundaries, including 0.15 vs 0.85 from the brief', () => {
  for (const [confidence, tier] of [
    [0.15, 'none'],
    [0.39, 'none'],
    [0.4, 'medium'],
    [0.69, 'medium'],
    [0.7, 'high'],
    [0.85, 'high'],
  ] as const) {
    assert.equal(toGtmContext({ ...base, confidence }).tier, tier, String(confidence));
  }
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

test('high tier keeps crypto only when true, and KYC intensity only when high (any case)', () => {
  const ctx = toGtmContext({ ...base, isCryptoRelated: true, kycAmlIntensity: 'low' });
  if (ctx.tier !== 'high') return assert.fail('expected high tier');
  assert.equal(ctx.facts.isCryptoRelated, true);
  assert.equal(ctx.facts.kycAmlIntensity, undefined);
  const upper = toGtmContext({ ...base, kycAmlIntensity: 'High' });
  if (upper.tier !== 'high') return assert.fail('expected high tier');
  assert.equal(upper.facts.kycAmlIntensity, 'high');
});
