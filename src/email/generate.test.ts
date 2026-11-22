import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GtmContext } from '../companyAnalysis/confidence.ts';
import { cleanModelOutput, generateEmail, normalizeSignOff, type TextModel } from './generate.ts';
import type { EmailRequest, Prompt } from './prompt.ts';

const req: EmailRequest = {
  recipientName: 'Jane Doe',
  companyName: 'Riverline Sportsbook',
  description: 'A sportsbook operator',
  tone: 'direct',
};
const gtm: GtmContext = { tier: 'none', reason: 'test' };

const GOOD = `Hi Jane,
I'm reaching out from Raphie. We help Riverline Sportsbook style teams automate withdrawal tickets.
Would you be open to a quick call?
Best, Raphie`;

// returns the queued drafts in order and remembers every prompt it saw
function fakeModel(drafts: string[]) {
  const prompts: Prompt[] = [];
  const model: TextModel = {
    complete(prompt) {
      prompts.push(prompt);
      const next = drafts[prompts.length - 1];
      return next === undefined
        ? Promise.reject(new Error('fakeModel ran out of drafts'))
        : Promise.resolve(next);
    },
  };
  return { model, prompts };
}

test('clean first draft goes straight through', async () => {
  const { model, prompts } = fakeModel([GOOD]);
  const result = await generateEmail(req, gtm, model);
  assert.deepEqual(result, { status: 'ok', email: GOOD, attempts: 1 });
  assert.equal(prompts.length, 1);
});

test('asks the model to repair a draft that breaks the rules', async () => {
  const bad = GOOD.replace('Would you', 'Raphie can help. Raphie would love a call. Would you');
  const { model, prompts } = fakeModel([bad, GOOD]);
  const result = await generateEmail(req, gtm, model);
  assert.equal(result.status, 'ok');
  assert.equal(result.attempts, 2);
  // the repair prompt has to say what's actually wrong
  assert.match(prompts[1]?.input ?? '', /Two sentences in a row start with "raphie"/);
  assert.match(prompts[1]?.input ?? '', /You already wrote this draft/);
});

test('falls back to mechanical fixes when the model keeps using em dashes', async () => {
  const dashy = GOOD.replace('automate withdrawal', 'automate \u2014 withdrawal');
  const { model } = fakeModel([dashy, dashy, dashy]);
  const result = await generateEmail(req, gtm, model);
  assert.equal(result.status, 'ok');
  assert.equal(result.attempts, 3);
  assert.doesNotMatch(result.email, /\u2014/);
});

test('flags for review when nothing can fix it', async () => {
  const noCompany = GOOD.replace('Riverline Sportsbook style ', '');
  const { model, prompts } = fakeModel([noCompany, noCompany, noCompany]);
  const result = await generateEmail(req, gtm, model);
  assert.equal(result.status, 'needs_review');
  if (result.status !== 'needs_review') return;
  assert.deepEqual(
    result.violations.map((v) => v.rule),
    ['missing_company'],
  );
  // 1 draft + 2 repairs, then it stops asking
  assert.equal(prompts.length, 3);
});

test('model errors propagate instead of being swallowed', async () => {
  const model: TextModel = { complete: () => Promise.reject(new Error('boom')) };
  await assert.rejects(generateEmail(req, gtm, model), /boom/);
});

test('cleanModelOutput strips code fences and subject lines', () => {
  assert.equal(cleanModelOutput('```\nHi Jane,\nHello.\n```'), 'Hi Jane,\nHello.');
  assert.equal(cleanModelOutput('Subject: Quick question\n\nHi Jane,'), 'Hi Jane,');
});

test('normalizeSignOff joins a split sign-off back onto one line', () => {
  assert.equal(
    normalizeSignOff('Thanks for reading.\n\nWarm regards,\nRaphie', 'Warm regards, Raphie'),
    // the blank line before the sign-off stays put
    'Thanks for reading.\n\nWarm regards, Raphie',
  );
  assert.equal(normalizeSignOff('Call?\nBest,\n  Raphie.', 'Best, Raphie'), 'Call?\nBest, Raphie');
  // already on one line, or not a sign-off at all: leave it alone
  assert.equal(normalizeSignOff('Call?\nBest, Raphie', 'Best, Raphie'), 'Call?\nBest, Raphie');
  assert.equal(normalizeSignOff('We love Raphie', 'Best, Raphie'), 'We love Raphie');
});

test('generateEmail normalizes the sign-off to match the tone', async () => {
  const split = GOOD.replace('Best, Raphie', 'Best,\nRaphie');
  const { model } = fakeModel([split]);
  const result = await generateEmail(req, gtm, model);
  assert.equal(result.email, GOOD);
});
