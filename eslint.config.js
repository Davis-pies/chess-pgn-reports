import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'coverage/**', '.claude/**'] },

  js.configs.recommended,

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
    // Config files are Node modules.
    files: ['*.config.js'],
    languageOptions: { globals: globals.node },
  },
];
