import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEmail, checkRequiredContent, splitSentences } from './rules.ts';

const rulesHit = (email: string) => checkEmail(email).map((v) => v.rule);

const CLEAN = `Hi Jane,
I'm reaching out from Raphie. We help sportsbooks automate withdrawal and KYC tickets.
Would you be open to a quick call next week?
Best, Raphie`;

test('clean email passes', () => {
  assert.deepEqual(checkEmail(CLEAN), []);
});

test('greeting and sign-off are their own sentences', () => {
  const sentences = splitSentences(CLEAN);
  assert.equal(sentences[0], 'Hi Jane,');
  assert.equal(sentences.at(-1), 'Best, Raphie');
  assert.equal(sentences.length, 5);
});

test('flags em dashes', () => {
  assert.deepEqual(rulesHit('Hi Jane,\nWe help teams \u2014 a lot.'), ['em_dash']);
});

test('allows hyphens and en dashes', () => {
  assert.deepEqual(rulesHit('Hi Jane,\nA 15-minute call, Mon–Fri.'), []);
});

test('flags Furthermore / Additionally only at the start of a sentence', () => {
  assert.deepEqual(rulesHit('We automate tickets. Furthermore, we help agents.'), ['banned_opener']);
  assert.deepEqual(rulesHit('We automate tickets. Additionally we help agents.'), ['banned_opener']);
  // mid-sentence is fine per the brief
  assert.deepEqual(rulesHit('We automate tickets and, additionally, help agents.'), []);
});

test('flags fantastic regardless of case', () => {
  assert.deepEqual(rulesHit('That is Fantastic news.'), ['banned_word']);
});

test('allows one exclamation mark but not two', () => {
  assert.deepEqual(rulesHit('Hi Jane! Hope you are well.'), []);
  assert.deepEqual(rulesHit('Hi Jane! Hope you are well!'), ['too_many_exclamations']);
});

test('flags consecutive sentences with the same opener', () => {
  assert.deepEqual(rulesHit('Raphie automates tickets. Raphie, also, helps agents.'), ['repeated_opener']);
  // same opener is fine as long as something sits between them
  assert.deepEqual(rulesHit('We automate tickets. It works well. We also help agents.'), []);
});

test('30 words is fine, 31 is not', () => {
  const sentence = (n: number) => `${Array.from({ length: n }, () => 'word').join(' ')}.`;
  assert.deepEqual(rulesHit(sentence(30)), []);
  assert.deepEqual(rulesHit(sentence(31)), ['long_sentence']);
});

test('catches a banned opener behind a bullet', () => {
  assert.deepEqual(rulesHit('Hi Jane,\nWe help with:\n- Additionally, we route tickets.'), ['banned_opener']);
  assert.deepEqual(rulesHit('Hi Jane,\n• Furthermore we route tickets.'), ['banned_opener']);
});

test('splits after a closing quote or paren', () => {
  assert.deepEqual(splitSentences('We said "hello." We said it twice.'), [
    'We said "hello."',
    'We said it twice.',
  ]);
  assert.deepEqual(rulesHit('We help (a lot.) We also route.'), ['repeated_opener']);
  assert.deepEqual(rulesHit('We said “hello.” We said it twice.'), ['repeated_opener']);
});

test('curly and straight apostrophes count as the same opener', () => {
  assert.deepEqual(rulesHit("I’m from Raphie. I'm also here."), ['repeated_opener']);
});

const expected = { firstName: 'Jane', companyName: 'Riverline Sportsbook' };

test('required content passes when everything is there', () => {
  assert.deepEqual(checkRequiredContent(`${CLEAN}\nRiverline Sportsbook`, expected), []);
});

test('required content flags a missing name, company, or call ask', () => {
  const rules = checkRequiredContent('Hello there. We automate tickets.', expected).map((v) => v.rule);
  assert.deepEqual(rules, ['missing_recipient', 'missing_company', 'missing_call_ask']);
});

test('call ask accepts the usual wordings', () => {
  for (const ask of [
    'open to a short call?',
    'Worth a quick chat?',
    'Could we meet next week?',
    'up for a short conversation?',
  ]) {
    const rules = checkRequiredContent(`Hi Jane, Riverline Sportsbook. ${ask}`, expected).map((v) => v.rule);
    assert.deepEqual(rules, [], ask);
  }
});

test('names have to appear as whole words', () => {
  // "Sam" inside "same" and "Al" inside "also" used to count as greeting them
  const rulesFor = (email: string, firstName: string) =>
    checkRequiredContent(email, { firstName, companyName: 'Big Bet Sports' }).map((v) => v.rule);
  assert.deepEqual(rulesFor('Hello. Big Bet Sports has the same issues. Quick call?', 'Sam'), [
    'missing_recipient',
  ]);
  assert.deepEqual(rulesFor('Hello. We also help Big Bet Sports. Quick call?', 'Al'), ['missing_recipient']);
  assert.deepEqual(rulesFor('Hi José, Big Bet Sports looks busy. Quick call?', 'José'), []);
});

test('curly apostrophes and case still count as the company name', () => {
  const rules = checkRequiredContent('Hi Jane, BOB’S BETS is busy. Quick call?', {
    firstName: 'Jane',
    companyName: "Bob's Bets",
  }).map((v) => v.rule);
  assert.deepEqual(rules, []);
});
