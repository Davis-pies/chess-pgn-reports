import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'test-results/**', 'playwright-report/**', '.claude/**', 'vendor/**'] },

  js.configs.recommended,

  {
    // A stale `eslint-disable` comment hides nothing and misleads readers.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },

  {
    // Correctness rules beyond `recommended`, applied everywhere.
    rules: {
      'array-callback-return': 'error',
      'default-case-last': 'error',
      eqeqeq: ['error', 'smart'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-wrappers': 'error',
      'no-return-assign': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-useless-concat': 'error',
      'no-useless-rename': 'error',
      'no-useless-return': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      radix: 'error',
      'require-atomic-updates': 'error',
    },
  },

  {
    // Browser-side application code.
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      // `try { localStorage… } catch {}` is a deliberate guard for browsers
      // that block storage access; there is nothing useful to do on failure.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    // Tests run under `node --test` with jsdom.
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    // Playwright browser tests: Node modules driving a real browser.
    files: ['e2e/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },

  {
    // Config files are Node modules.
    files: ['*.config.js'],
    languageOptions: { globals: globals.node },
  },

  {
    // Dev tooling: plain Node, never shipped to the browser.
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // the watcher skips a path that isn't in this checkout; there is nothing
      // useful to do about it
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
