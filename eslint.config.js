import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['node_modules/']),
  js.configs.recommended,
  // type-aware rules catch the stuff that actually bites in async code,
  // like un-awaited promises
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // node:test's test() returns a promise the runner already tracks, so
    // flagging every test() call as "floating" is just noise
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['test', 'describe', 'it', 'suite'] },
          ],
        },
      ],
    },
  },
  {
    // no point type-linting the config file itself
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // last, so prettier owns formatting and eslint stays out of it
  prettier,
);
