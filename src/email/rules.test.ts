import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEmail, splitSentences } from './rules.ts';

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
  assert.deepEqual(rulesHit('Hi Jane,\nWe help teams — a lot.'), ['em_dash']);
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
