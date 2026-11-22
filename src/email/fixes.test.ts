import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMechanicalFixes } from './fixes.ts';
import { checkEmail } from './rules.ts';

test('replaces em dashes with commas', () => {
  assert.equal(applyMechanicalFixes('We help teams \u2014 a lot.'), 'We help teams, a lot.');
  assert.equal(applyMechanicalFixes('fast\u2014and accurate'), 'fast, and accurate');
});

test('drops banned openers and recapitalizes', () => {
  assert.equal(
    applyMechanicalFixes('We automate tickets. Furthermore, we help agents.'),
    'We automate tickets. We help agents.',
  );
  assert.equal(applyMechanicalFixes('Hi Jane,\nAdditionally we help.'), 'Hi Jane,\nWe help.');
});

test('leaves mid-sentence "additionally" alone', () => {
  const text = 'We automate tickets and, additionally, help agents.';
  assert.equal(applyMechanicalFixes(text), text);
});

test('swaps fantastic for great, keeping case', () => {
  assert.equal(applyMechanicalFixes('Fantastic. That is fantastic.'), 'Great. That is great.');
});

test('keeps only the first exclamation mark', () => {
  assert.equal(applyMechanicalFixes('Hi! Great! Thanks!'), 'Hi! Great. Thanks.');
});

test('output passes the rules it is responsible for', () => {
  const messy = 'Hi Jane!\nThis is fantastic \u2014 really! Furthermore, it works!';
  const rules = checkEmail(applyMechanicalFixes(messy)).map((v) => v.rule);
  assert.deepEqual(rules, []);
});
