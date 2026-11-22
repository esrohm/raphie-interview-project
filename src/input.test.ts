import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DESCRIPTION_LENGTH, parseCompanyName, parseDescription, parseTone } from './input.ts';

test('tone accepts direct/warm and shortcuts, any case', () => {
  for (const raw of ['direct', 'DIRECT', ' d '])
    assert.deepEqual(parseTone(raw), { ok: true, value: 'direct' });
  for (const raw of ['warm', 'Warm', 'w']) assert.deepEqual(parseTone(raw), { ok: true, value: 'warm' });
});

test('tone rejects anything else', () => {
  for (const raw of ['', 'friendly', 'dw']) assert.equal(parseTone(raw).ok, false);
});

test('text fields trim and collapse whitespace', () => {
  assert.deepEqual(parseCompanyName('  Big   Bet Sports '), { ok: true, value: 'Big Bet Sports' });
});

test('text fields reject empty input', () => {
  assert.equal(parseCompanyName('   ').ok, false);
});

test('description has a length cap', () => {
  assert.equal(parseDescription('a'.repeat(MAX_DESCRIPTION_LENGTH)).ok, true);
  assert.equal(parseDescription('a'.repeat(MAX_DESCRIPTION_LENGTH + 1)).ok, false);
});
