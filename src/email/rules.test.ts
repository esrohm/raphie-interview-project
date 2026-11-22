import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEmail, checkRequiredContent, checkTone, splitSentences } from './rules.ts';

const rulesHit = (email: string) => checkEmail(email).map((v) => v.rule);

const CLEAN = `Hi Jane,
I'm reaching out from Raphie. We help sportsbooks automate withdrawal and KYC tickets.
Would you be open to a quick call next week?
Best, Raphie`;

test('clean email passes, with greeting and sign-off as their own sentences', () => {
  assert.deepEqual(checkEmail(CLEAN), []);
  const sentences = splitSentences(CLEAN);
  assert.equal(sentences[0], 'Hi Jane,');
  assert.equal(sentences.at(-1), 'Best, Raphie');
  assert.equal(sentences.length, 5);
});

test('style rules', () => {
  const sentence = (n: number) => `${Array.from({ length: n }, () => 'word').join(' ')}.`;
  const cases: Array<[string, string[]]> = [
    ['Hi Jane,\nWe help teams — a lot.', ['em_dash']],
    ['Hi Jane,\nA 15-minute call, Mon–Fri.', []], // hyphens and en dashes are fine
    ['We automate tickets. Furthermore, we help agents.', ['banned_opener']],
    ['We automate tickets. Additionally we help agents.', ['banned_opener']],
    ['We automate tickets and, additionally, help agents.', []], // mid-sentence is allowed
    ['Hi Jane,\nWe help with:\n- Additionally, we route tickets.', ['banned_opener']],
    ['Hi Jane,\n• Furthermore we route tickets.', ['banned_opener']],
    ['That is Fantastic news.', ['banned_word']],
    ['Hi Jane! Hope you are well.', []],
    ['Hi Jane! Hope you are well!', ['too_many_exclamations']],
    ['Raphie automates tickets. Raphie, also, helps agents.', ['repeated_opener']],
    ['We automate tickets. It works well. We also help agents.', []],
    ['We help (a lot.) We also route.', ['repeated_opener']],
    ['We said “hello.” We said it twice.', ['repeated_opener']],
    ["I’m from Raphie. I'm also here.", ['repeated_opener']], // curly and straight apostrophes match
    [sentence(30), []],
    [sentence(31), ['long_sentence']],
  ];
  for (const [email, expected] of cases) assert.deepEqual(rulesHit(email), expected, email);
});

test('splits after a closing quote', () => {
  assert.deepEqual(splitSentences('We said "hello." We said it twice.'), [
    'We said "hello."',
    'We said it twice.',
  ]);
});

const required = (email: string, firstName = 'Jane', companyName = 'Riverline Sportsbook') =>
  checkRequiredContent(email, { firstName, companyName }).map((v) => v.rule);

test('required content passes when everything is there', () => {
  assert.deepEqual(required(`${CLEAN}\nRiverline Sportsbook`), []);
});

test('required content flags a missing name, company, or call ask', () => {
  assert.deepEqual(required('Hello there. We automate tickets.'), [
    'missing_recipient',
    'missing_company',
    'missing_call_ask',
  ]);
});

test('the call ask has to propose meeting, as a question or an offer', () => {
  for (const ask of [
    'Would you be open to a short call?',
    'Worth a quick chat?',
    'Could we meet next week?',
    'Up for a short conversation?',
    // the model's own wording from eval runs, which the brief counts as a suggestion
    "If useful, I'd be happy to set up a short call.",
    'Happy to chat sometime.',
  ]) {
    assert.deepEqual(required(`Hi Jane, Riverline Sportsbook is busy. ${ask}`), [], ask);
  }
  for (const notAsk of [
    // these all mention a meeting word but never actually ask
    'Hi Jane, Riverline Sportsbook players talk to support a lot.',
    'Hi Jane, Riverline Sportsbook players call in at all hours.',
    'Hi Jane, does Riverline Sportsbook see spikes? We could chat.',
  ]) {
    assert.deepEqual(required(notAsk), ['missing_call_ask'], notAsk);
  }
});

test('names have to appear as whole words, ignoring case and curly apostrophes', () => {
  // "Sam" inside "same" and "Al" inside "also" used to count as greeting them
  assert.deepEqual(
    required('Hello. Big Bet Sports has the same issues. Quick call?', 'Sam', 'Big Bet Sports'),
    ['missing_recipient'],
  );
  assert.deepEqual(required('Hello. We also help Big Bet Sports. Quick call?', 'Al', 'Big Bet Sports'), [
    'missing_recipient',
  ]);
  assert.deepEqual(required('Hi José, Big Bet Sports looks busy. Quick call?', 'José', 'Big Bet Sports'), []);
  assert.deepEqual(required('Hi Jane, BOB’S BETS is busy. Quick call?', 'Jane', "Bob's Bets"), []);
});

test('warm emails open with a friendly line before the pitch', () => {
  const warm = (body: string) =>
    checkTone(`Hi Jane,\n${body}\nWarm regards, Raphie`, 'warm').map((v) => v.rule);
  assert.deepEqual(warm("I'm reaching out from Raphie. We help teams."), ['warm_opener']);
  assert.deepEqual(warm('Raphie helps support teams. Quick call?'), ['warm_opener']);
  assert.deepEqual(warm("Hope you're doing well. I'm reaching out from Raphie."), []);
  // greeting and opener on the same line
  assert.deepEqual(checkTone("Hi Jane, I'm reaching out from Raphie.", 'warm').length, 1);
  assert.deepEqual(checkTone("Hi Jane, hope you're well. I'm with Raphie.", 'warm'), []);
  // an exclamation greeting on its own line still counts as the greeting
  assert.deepEqual(checkTone("Hi Jane!\nI'm reaching out from Raphie.", 'warm').length, 1);
  // direct tone gets to the point, so this rule doesn't apply
  assert.deepEqual(checkTone(CLEAN, 'direct'), []);
});
