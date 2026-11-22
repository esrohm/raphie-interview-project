import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL, loadConfig } from './config.ts';

test('missing or blank key is an error', () => {
  assert.equal(loadConfig({}).ok, false);
  assert.equal(loadConfig({ OPENAI_API_KEY: '   ' }).ok, false);
});

test('model falls back to the default when unset or blank', () => {
  for (const env of [{ OPENAI_API_KEY: 'sk-test' }, { OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: '' }]) {
    const result = loadConfig(env);
    assert.ok(result.ok);
    assert.equal(result.config.openaiModel, DEFAULT_MODEL);
  }
});

test('model can be overridden', () => {
  const result = loadConfig({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-5.4' });
  assert.ok(result.ok);
  assert.equal(result.config.openaiModel, 'gpt-5.4');
});
