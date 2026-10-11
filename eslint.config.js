import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['.millennium/**', 'dist/**', 'node_modules/**', 'resources/locales.json']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks, '@stylistic': stylistic },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // House style: single statements go without braces on the next line.
      'curly': ['error', 'multi-or-nest', 'consistent'],
      '@stylistic/max-len': ['error', {
        code: 120,
        ignoreUrls: true,
        // SVG path data cannot be wrapped meaningfully.
        ignorePattern: '^\\s*<path .* d="',
      }],
      '@stylistic/member-delimiter-style': 'error',
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0, maxEOF: 0 }],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/eol-last': 'error',
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: 'always' }],
      '@stylistic/semi': 'error',
      '@stylistic/one-var-declaration-per-line': ['error', 'always'],
    },
  },
  {
    files: ['frontend/steam/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      // Steam's private modules and their test doubles need runtime shape discovery.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
