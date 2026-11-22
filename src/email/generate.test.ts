import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanModelOutput, generateEmail, normalizeSignOff } from './generate.ts';
import type { Prompt, TextModel } from './model.ts';
import type { CompanyContext, EmailRequest } from './prompt.ts';

const req: EmailRequest = {
  recipientName: 'Jane Doe',
  companyName: 'Riverline Sportsbook',
  description: 'A sportsbook operator',
  tone: 'direct',
};
const context: CompanyContext = { gtm: { tier: 'none', reason: 'test' }, segment: 'operator' };

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
    completeJson: () => Promise.reject(new Error('not used here')),
  };
  return { model, prompts };
}

test('clean first draft goes straight through', async () => {
  const { model, prompts } = fakeModel([GOOD]);
  assert.deepEqual(await generateEmail(req, context, model), { status: 'ok', email: GOOD, attempts: 1 });
  assert.equal(prompts.length, 1);
});

test('asks the model to repair a draft that breaks the rules, naming the problem', async () => {
  const bad = GOOD.replace('Would you', 'Raphie can help. Raphie would love a call. Would you');
  const { model, prompts } = fakeModel([bad, GOOD]);
  const result = await generateEmail(req, context, model);
  assert.equal(result.status, 'ok');
  assert.equal(result.attempts, 2);
  assert.match(prompts[1]?.input ?? '', /You already wrote this draft/);
  assert.match(prompts[1]?.input ?? '', /Two sentences in a row start with "raphie"/);
});

test('a warm email that opens with the pitch gets sent back', async () => {
  const warm = GOOD.replace('Best, Raphie', 'Warm regards, Raphie');
  const fixed = warm.replace("I'm reaching out", "Hope game days are treating you well. I'm reaching out");
  const { model, prompts } = fakeModel([warm, fixed]);
  const result = await generateEmail({ ...req, tone: 'warm' }, context, model);
  assert.equal(result.status, 'ok');
  assert.match(prompts[1]?.input ?? '', /Warm tone/);
});

test('stops after two repairs and flags for review, without patching the text', async () => {
  // The old fallback swapped em dashes for commas, which made comma splices.
  // Now a draft that keeps failing goes to a human as-is.
  const dashy = GOOD.replace('automate withdrawal', 'automate — withdrawal');
  const { model, prompts } = fakeModel([dashy, dashy, dashy]);
  const result = await generateEmail(req, context, model);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.email, dashy);
  assert.equal(prompts.length, 3);
  if (result.status === 'needs_review') {
    assert.deepEqual(
      result.violations.map((v) => v.rule),
      ['em_dash'],
    );
  }
});

test('model errors propagate instead of being swallowed', async () => {
  const model: TextModel = {
    complete: () => Promise.reject(new Error('boom')),
    completeJson: () => Promise.reject(new Error('boom')),
  };
  await assert.rejects(generateEmail(req, context, model), /boom/);
});

test('cleanModelOutput strips code fences and subject lines', () => {
  assert.equal(cleanModelOutput('```\nHi Jane,\nHello.\n```'), 'Hi Jane,\nHello.');
  assert.equal(cleanModelOutput('Subject: Quick question\n\nHi Jane,'), 'Hi Jane,');
});

test('normalizeSignOff joins a split sign-off and leaves everything else alone', () => {
  for (const [input, expected] of [
    ['Thanks.\n\nWarm regards,\nRaphie', 'Thanks.\n\nWarm regards, Raphie'],
    ['Call?\nBest,\n  Raphie.', 'Call?\nWarm regards, Raphie'],
    ['Call?\nWarm regards, Raphie', 'Call?\nWarm regards, Raphie'],
    ['We love Raphie', 'We love Raphie'],
  ] as const) {
    assert.equal(normalizeSignOff(input, 'Warm regards, Raphie'), expected);
  }
});
