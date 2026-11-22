import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GtmContext } from '../companyAnalysis/confidence.ts';
import { buildPrompt, firstName, STYLE_EXAMPLES, type EmailRequest } from './prompt.ts';
import { checkEmail, checkTone } from './rules.ts';

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

const inputFor = (gtm: GtmContext, req = riverline) => buildPrompt(req, { gtm, segment: 'operator' }).input;

test('style examples pass our own rules, including the warm opener', () => {
  // if these break the rules, we're teaching the model to break them too
  for (const example of STYLE_EXAMPLES) assert.deepEqual(checkEmail(example), []);
  assert.deepEqual(checkTone(STYLE_EXAMPLES[1] ?? '', 'warm'), []);
});

test('input has the recipient, company, description, and segment angle', () => {
  const input = inputFor(NONE);
  assert.match(input, /first name: Jane/);
  assert.match(input, /Company: Riverline Sportsbook/);
  assert.match(input, /high withdrawal volume/);
  assert.match(input, /B2C operator/);
  assert.match(buildPrompt(riverline, { gtm: NONE, segment: 'supplier' }).input, /B2B supplier/);
});

test('tone controls the guidance and sign-off', () => {
  const direct = buildPrompt(riverline, { gtm: NONE, segment: 'operator' }).instructions;
  const warm = buildPrompt({ ...riverline, tone: 'warm' }, { gtm: NONE, segment: 'operator' }).instructions;
  assert.match(direct, /Sign off exactly with: Best, Raphie/);
  assert.match(warm, /Sign off exactly with: Warm regards, Raphie/);
  assert.match(warm, /not about Raphie/);
});

test('no helper context means no research section at all', () => {
  assert.doesNotMatch(inputFor(NONE), /Background research/);
});

test('medium confidence is hedged and leaves out the detailed fields', () => {
  const input = inputFor(MEDIUM);
  assert.match(input, /moderate confidence[\s\S]*Company type: operator/);
  assert.match(input, /trust the description/);
  assert.doesNotMatch(input, /Regions:|Compliance themes:/);
});

test('high confidence includes regions and compliance, humanized', () => {
  const input = inputFor(HIGH);
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
