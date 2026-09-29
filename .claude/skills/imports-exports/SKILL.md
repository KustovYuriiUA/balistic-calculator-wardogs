---
name: imports-exports
description: Generate or update index.ts barrel files and fix import syntax to the team canon (grouping, aliases, type imports, barrel consolidation, no deep relatives). Use when the user asks to create/update exports or barrels, wire up a new component's exports, fix, organize, consolidate, dedupe, or clean up imports, replace relative paths, or add import-order linting to a project. Explicit invocation - /imports-exports <what to generate or fix>.
---

# Imports & exports

Project-agnostic canon for import/export syntax in TypeScript React and
React Native codebases, plus the workflows to generate barrels, fix
imports, and roll out enforcement.

## 0. Resolve project conventions first

Look in the injected team rules and CLAUDE.md for: path aliases (and which
of them are runtime-real vs tsconfig-only), barrel locations, files where
the framework requires default exports, and whether ESLint `import/order`
is configured.

- **Found** → use them silently.
- **Missing** → ask once ("what aliases does this project use, and are
  they configured in the bundler or only tsconfig?"), then offer to write
  the answers into the project's rules file so it is never asked again.

## 1. Import canon

**Grouping is mechanical, never semantic.** Imports are grouped by where
the module comes from, separated by blank lines, alphabetized (asc,
case-insensitive) within each group. No section comments — ESLint
`import/order` owns the ordering and `--fix`es it:

```ts
import { useMemo } from 'react'                    // 1. react / react-native
import { StyleSheet, View } from 'react-native'

import { useQueryClient } from '@tanstack/react-query'  // 2. external packages
import { z } from 'zod'

import { Button } from '@/components/ui'           // 3. internal (project alias)
import { spacings } from '@/theme'

import { MenuItem } from './components'            // 4. relative (siblings)
```

**Paths:**

- Deep relative imports (two or more `../`) are forbidden — rewrite to the
  project alias. A single `./` or one `../` is fine for siblings and
  immediate neighbors (local implementation details).
- When a directory has a barrel (`index.ts`), import from the barrel —
  never reach past it into sub-paths (`@/components/ui`, not
  `@/components/ui/Icon`). Barrel imports stay stable when internals move.
  Consolidate: two or more named exports from the same barrel go in
  **one** statement (`import { HStack, Icon, Text } from '@/components/ui'`),
  never one deep line per member. Types re-exported by the barrel come
  from the barrel too.
- **Exception — inside a barrel's own subtree, stay deep.** A file the
  barrel re-exports (e.g. a UI component under `src/components/ui/**`
  importing a sibling) keeps deep imports
  (`@/components/ui/Icon/Icon`) — pulling the barrel from inside itself
  creates a circular import. The same holds for any barrel and its own
  members.
- Use only aliases that exist in the *runtime* config (bundler/babel/
  metro). tsconfig-only aliases compile in the IDE and crash at runtime —
  the project rules list which are real.

**Statements:**

- One import statement per module — merge duplicates.
- Mixed values + types from one module: inline `type` specifier —
  `import { toast, type ToastType } from '@/components/Toast'`.
- All-types import: standalone `import type { X } from '...'`.
- A name used only in type positions gets the `type` keyword. A class or
  enum used at runtime (`new Foo()`, `Enum.Member`) stays bare — mark it
  `type` only when it appears purely in annotations, generics, or
  `extends`.
- No unused imports — remove them.

## 2. Export canon

- **Named exports only.** `export default` is allowed solely where the
  framework demands it (Next.js `page`/`layout`/`error` files, Expo
  Router screens, config files) — the project rules list them.
- Do not export internal helpers or single-use constants; a folder's
  public API is its main component(s), their props types, and whatever
  consumers genuinely need.

**Two-tier barrels:**

| index.ts location | Pattern |
|---|---|
| Inside a component folder (has `.tsx` implementation siblings) | **Explicit named** re-exports |
| In a directory aggregating component folders | **`export *`** per child, alphabetical |
| Store folders | Always explicit named — the create-store skill's canon takes precedence |
| Mixed/ambiguous | Mostly subdirectories → `export *`; mostly implementation files → explicit named |

Component folder (runtime exports first, then types):

```ts
export { Icon } from './Icon'
export type { IconProps } from './Icon'
export type { IconName } from './Icon.codepoints'
```

Aggregator directory:

```ts
export * from './Avatar'
export * from './Button'
export * from './Icon'
```

## 3. Workflows

### Generate or update barrels

1. Decide the tier from the table above.
2. Component folder: read its `.ts`/`.tsx` sources (skip `index.ts`,
   tests, stories), collect exported values and types, write explicit
   re-exports. When in doubt about what is public, export the main
   component and its props type at minimum.
3. Aggregator: one `export *` line per child folder / standalone file,
   alphabetical.
4. New component folder → also add its line to the parent aggregator.

### Fix imports in a file

In order: remove unused → rewrite deep relatives to alias → shorten deep
sub-paths to barrels and consolidate same-barrel imports into one
statement (skip files inside that barrel's own subtree — cycle risk) →
replace tsconfig-only aliases with real ones → merge duplicates → add
`type` keywords → reorder into mechanical groups → verify it compiles
(`tsc --noEmit` or the project's check script).

### Roll out enforcement

If the project has no `import/order` ESLint rule, offer to add it
(`eslint-plugin-import`, flat config), then run `eslint --fix` on the
touched scope:

```js
import importPlugin from 'eslint-plugin-import'

{
  plugins: { import: importPlugin },
  rules: {
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal'],
        pathGroups: [
          { pattern: 'react+(|-native)', group: 'builtin', position: 'before' },
          { pattern: '@/**', group: 'internal', position: 'before' },
        ],
        pathGroupsExcludedImportTypes: ['react'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
  },
}
```

Adjust `pathGroups` to the project's aliases (from the rules file).

**Formatting is ESLint's job — the team does not use Prettier.** Never add
Prettier to a project. When setting up or extending a project's ESLint
config, also add ESLint-based formatting via `@stylistic/eslint-plugin`
with the team's canonical rule block (reference: revouch-web's
`eslint.config.mjs`):

```js
import stylistic from '@stylistic/eslint-plugin'

{
  files: ['**/*.{js,jsx,ts,tsx}'],
  plugins: { '@stylistic': stylistic },
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
    '@stylistic/object-curly-newline': [
      'error',
      {
        ObjectExpression: { multiline: true, minProperties: 1 },
        ObjectPattern: { multiline: true, minProperties: 3 },
        ImportDeclaration: { multiline: true, minProperties: 5 },
        ExportDeclaration: { multiline: true, minProperties: 5 },
      },
    ],
  },
}
```

The `object-curly-newline` block is the multiline-objects canon: every
object **literal** is multiline (one key per line, even `{ id: 1 }`, at
every nesting level and in call arguments); destructuring patterns break
at 3+ keys, import/export braces at 5+ specifiers.

If the project already formats with Prettier, do not rip it out silently —
flag it to the user and let them decide when to migrate.

## 4. Fix scope

Files the current task touches get their imports/exports fixed to canon in
passing. Do NOT sweep unrelated files or the whole repo unless the user
explicitly asks for an audit — unsolicited churn makes PRs unreviewable.
