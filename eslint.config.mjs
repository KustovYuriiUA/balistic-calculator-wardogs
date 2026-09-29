import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'
import importPlugin from 'eslint-plugin-import'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores([
    'dist',
    'desktop',
    'release',
    'backup',
    'node_modules',
    '.test-output',
    'src/data/generated',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
  // Import order: the imports-exports canon (.claude/skills/imports-exports).
  {
    files: ['**/*.{ts,tsx,mjs}'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal'],
          pathGroups: [
            {
              pattern: 'react+(|-dom)',
              group: 'builtin',
              position: 'before',
            },
            {
              pattern: '@/**',
              group: 'internal',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['react'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
  },
  // Formatting is ESLint's job, not Prettier's: the code-style canon.
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/max-len': [
        'error',
        {
          code: 100,
          ignoreUrls: true,
          ignoreTemplateLiterals: true,
          ignoreStrings: true,
          ignoreComments: true,
          ignoreRegExpLiterals: true,
        },
      ],
      '@stylistic/indent': ['error', 2],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/array-bracket-spacing': ['error', 'never'],
      // Beyond the canon: the autofix of the rules below leaves these behind.
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/no-multiple-empty-lines': ['error', {
        max: 1,
        maxEOF: 0,
      }],
      '@stylistic/object-property-newline': ['error', {
        allowAllPropertiesOnSameLine: false,
      }],
      '@stylistic/object-curly-newline': [
        'error',
        {
          ObjectExpression: {
            multiline: true,
            minProperties: 1,
          },
          ObjectPattern: {
            multiline: true,
            minProperties: 3,
          },
          ImportDeclaration: {
            multiline: true,
            minProperties: 5,
          },
          ExportDeclaration: {
            multiline: true,
            minProperties: 5,
          },
          // object-property-newline splits type literals too; their braces then follow.
          TSTypeLiteral: {
            multiline: true,
            consistent: true,
          },
        },
      ],
    },
  },
])
