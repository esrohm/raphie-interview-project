import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GtmContext } from '../companyAnalysis/confidence.ts';
import { buildPrompt, firstName, inferSegment, STYLE_EXAMPLES, type EmailRequest } from './prompt.ts';
import { checkEmail } from './rules.ts';

const NONE: GtmContext = { tier: 'none', reason: 'test' };

const HIGH: GtmContext = {
  tier: 'high',
  confidence: 0.9,
  facts: {
    vertical: 'igaming',
    companyType: 'operator',
    supportMotion: 'high_volume',
    likelyTicketDrivers: ['withdrawals', 'account_access'],
    operatingRegions: ['US', 'Mars'],
    complianceThemes: ['responsible_gaming'],
    kycAmlIntensity: 'high',
  },
};

const MEDIUM: GtmContext = {
  tier: 'medium',
  confidence: 0.5,
  facts: { vertical: 'igaming', companyType: 'operator', likelyTicketDrivers: ['withdrawals'] },
};

const riverline: EmailRequest = {
  recipientName: 'Jane Doe',
  companyName: 'Riverline Sportsbook',
  description: 'A sportsbook operator with high withdrawal volume and KYC questions',
  tone: 'direct',
};

test('style examples pass our own rules', () => {
  // if these break the rules, we're teaching the model to break them too
  for (const example of STYLE_EXAMPLES) {
    assert.deepEqual(checkEmail(example), []);
  }
});

test('segment comes from the description first', () => {
  const apexPay = 'A payments provider for iGaming operators that supports card, ACH, and crypto on-ramps';
  assert.equal(inferSegment(apexPay, HIGH), 'payments');
  assert.equal(inferSegment('A B2B platform that powers sportsbooks', NONE), 'supplier');
  assert.equal(inferSegment('An affiliate site comparing casino bonuses', NONE), 'affiliate');
  assert.equal(inferSegment('An online casino brand in Ontario', NONE), 'operator');
});

test('segment falls back to the helper when the description is vague', () => {
  assert.equal(inferSegment('A fast growing company in Malta', HIGH), 'operator');
  assert.equal(inferSegment('A fast growing company in Malta', NONE), 'unknown');
});

test('a medium-confidence helper guess does not decide the segment', () => {
  // live run: "A small company based in Malta" at 0.41 got an email saying
  // "we help B2B suppliers like Lumen Labs" as if it were known
  assert.equal(inferSegment('A small company based in Malta', MEDIUM), 'unknown');
  // but the guess still shows up in the hedged research section
  const { input } = buildPrompt({ ...riverline, description: 'A small company based in Malta' }, MEDIUM);
  assert.match(input, /Angle: The type of company is not clear/);
  assert.match(input, /moderate confidence[\s\S]*Company type: operator/);
});

test('tone controls the guidance and sign-off', () => {
  assert.match(buildPrompt(riverline, NONE).instructions, /Sign off exactly with: Best, Raphie/);
  assert.match(
    buildPrompt({ ...riverline, tone: 'warm' }, NONE).instructions,
    /Sign off exactly with: Warm regards, Raphie/,
  );
});

test('input has the recipient, company, and description', () => {
  const { input } = buildPrompt(riverline, NONE);
  assert.match(input, /first name: Jane/);
  assert.match(input, /Company: Riverline Sportsbook/);
  assert.match(input, /high withdrawal volume/);
  assert.match(input, /B2C operator/);
});

test('no helper context means no research section at all', () => {
  assert.doesNotMatch(buildPrompt(riverline, NONE).input, /Background research/);
});

test('medium confidence is hedged and leaves out the detailed fields', () => {
  const { input } = buildPrompt(riverline, MEDIUM);
  assert.match(input, /moderate confidence/);
  assert.match(input, /trust the description/);
  assert.doesNotMatch(input, /Regions:|Compliance themes:/);
});

test('high confidence includes regions and compliance, humanized', () => {
  const { input } = buildPrompt(riverline, HIGH);
  assert.match(input, /high confidence/);
  assert.match(input, /account access/);
  assert.match(input, /state-by-state/);
  assert.match(input, /responsible gaming/);
  // regions we have nothing useful to say about get skipped
  assert.doesNotMatch(input, /Mars/);
});

test('firstName handles extra whitespace', () => {
  assert.equal(firstName('  Alex   Gould '), 'Alex');
  assert.equal(firstName('Cher'), 'Cher');
});

test('B2B vendors that mention who they sell to are suppliers, not operators', () => {
  // these all mention sportsbooks/casinos/operators as customers, and used to
  // get classified as operators because of it
  for (const description of [
    'A fraud and risk scoring vendor for sportsbooks',
    'A compliance and responsible gambling tooling company serving online casinos',
    'A KYC and identity verification platform used by iGaming operators',
    'A geolocation compliance provider for US sportsbooks',
  ]) {
    assert.equal(inferSegment(description, NONE), 'supplier', description);
  }
});

test('operators that mention platforms or customers are still operators', () => {
  for (const description of [
    'A US sportsbook running its own in-house platform',
    'A casino operator for players in New Jersey',
    'A betting app for UK punters',
  ]) {
    assert.equal(inferSegment(description, NONE), 'operator', description);
  }
});
