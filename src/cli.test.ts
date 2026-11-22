import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs the real CLI as a child process. Every case here fails or exits before
// any network call, so these stay fast and don't need an API key.

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

function run(args: string[], options: { input?: string; env?: Record<string, string> } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    input: options.input ?? '',
    // start from a clean env so a real OPENAI_API_KEY in the shell can't leak
    // in and turn a test into a paid API call
    env: { PATH: process.env.PATH ?? '', ...options.env },
    encoding: 'utf8',
    timeout: 10_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const FAKE_KEY = { OPENAI_API_KEY: 'sk-test-not-real' };

test('--help prints usage and exits 0', () => {
  const { code, stderr, stdout } = run(['--help']);
  assert.equal(code, 0);
  assert.match(stderr, /Usage: npm start/);
  // stdout is reserved for the email
  assert.equal(stdout, '');
});

test('unknown flag prints the error and usage', () => {
  const { code, stderr } = run(['--bogus']);
  assert.equal(code, 1);
  assert.match(stderr, /Unknown option '--bogus'/);
  assert.match(stderr, /Usage:/);
});

test('missing API key fails before asking anything', () => {
  const { code, stderr } = run([]);
  assert.equal(code, 1);
  assert.match(stderr, /OPENAI_API_KEY is not set/);
  assert.doesNotMatch(stderr, /Recipient's name/);
});

test('an invalid flag value is an error, not a re-prompt', () => {
  const { code, stderr } = run(
    ['--name', 'Jane Doe', '--company', 'X', '--description', 'y', '--tone', 'loud'],
    {
      env: FAKE_KEY,
    },
  );
  assert.equal(code, 1);
  assert.match(stderr, /Tone has to be "direct" or "warm"/);
});

test('stdin closing mid-prompt counts as cancelled', () => {
  const { code, stderr } = run([], { env: FAKE_KEY, input: 'Jane Doe\n' });
  assert.equal(code, 130);
  assert.match(stderr, /Company name: /);
  assert.match(stderr, /Cancelled/);
});

test('a bad answer re-prompts instead of failing', () => {
  // only give a bad tone and then close stdin, so it re-asks once and then
  // cancels instead of going on to the network calls
  const { code, stderr } = run(['--name', 'Jane Doe', '--company', 'X', '--description', 'y'], {
    env: FAKE_KEY,
    input: 'loud\n',
  });
  assert.equal(code, 130);
  assert.equal(stderr.match(/Tone \(direct \/ warm\): /g)?.length, 2);
  assert.match(stderr, /Tone has to be "direct" or "warm"/);
});

test('--help documents --show-prompt', () => {
  assert.match(run(['--help']).stderr, /--show-prompt/);
});
