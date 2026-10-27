// Repo-wide lint: type-aware rules for src/**, core rules for functions/scripts.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.wrangler/**',
      '.wrangler-test/**',
      'coverage/**',
    ],
  },
  // Plain JS: Cloudflare Functions + node scripts.
  {
    files: ['functions/**/*.js', 'scripts/**/*.mjs', 'scripts/**/*.js', '*.mjs', '*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // Workers runtime (caches, Request/Response...) + node scripts.
      globals: { ...globals.node, ...globals.serviceworker },
    },
    rules: {
      // Intentional offline-first style: silent fallbacks everywhere.
      // Empty non-catch blocks are still flagged.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // TypeScript app code: type-checked rules + react-hooks.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Polling/offline-first app: fetch-on-mount + pollers legitimately
      // live in effects (their setStates happen async, after awaits — no
      // cascading renders). Warn (not error) so genuine sync-setState
      // loops still surface in reviews.
      'react-hooks/set-state-in-effect': 'warn',
      // Intentional offline-first style: silent fallbacks everywhere.
      // Empty non-catch blocks are still flagged.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
  }
);
