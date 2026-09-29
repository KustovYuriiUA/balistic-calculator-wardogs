---
name: create-store
description: Scaffold a canonical Zustand store (global or feature-scoped with provider and context, slices, selectors, hooks, optional immer/persist middleware). Use when the user asks to create a store, mentions zustand, a store with provider and context, store slices, persisted state, or shared client state. Explicit invocation - /create-store <description>.
---

# Create a Zustand store

Project-agnostic canon for Zustand v5 stores in React and React Native.
Store code is plain React — no `next/*`, no DOM, no React Native imports in
store files, so the same store runs on any platform.

## 0. Resolve project conventions first

Before asking anything, look for the project's store conventions in the
injected team rules and CLAUDE.md (keys: store root, features root, import
alias, shared-package policy, off-canon store inventory).

- **Found** → use them silently.
- **Missing** → ask ONE extra question: *"Where do stores live (store root /
  features root) and what import alias do consumers use?"* Then offer to
  write the answer into the project's rules file (e.g.
  `.claude/rules/stores.md` or CLAUDE.md) so it is never asked again.

The templates below write `<storeRoot>` and `<featuresRoot>` — substitute
the resolved paths, and use the resolved alias in every import example.

## 1. Interview (four questions, then build)

Ask via AskUserQuestion, then build without further check-ins:

1. **Kind** — global or feature-scoped?
   - **Global**: app-lifetime singleton (auth/user, theme, settings).
   - **Feature**: state belongs to a *feature instance* — resets when the
     feature unmounts, or the feature mounts more than once (modals,
     per-chat, per-wizard).
2. **Name and slices** — the store/feature name; for feature stores, the
   entity slices (e.g. "composer: search, selection"). Slice names must be
   unique within a feature.
3. **Fields** — initial state fields per slice (accept a DTO/type to
   derive them).
4. **Middleware** — devtools is always included. Ask: does this store need
   **persist** (state survives restart; storage is injected per platform)?
   Does it need **immer** (only worth it when updates touch state nested
   two or more levels deep)? See
   [references/middleware.md](references/middleware.md).

Do NOT decide *whether* Zustand is warranted — the developer already
decided by invoking this skill.

## 2. Locations

| Kind | Path | Registered in |
|---|---|---|
| Global | `<storeRoot>/<entity>/` | `<storeRoot>/index.ts` |
| Feature | `<featuresRoot>/<feature>/stores/<storeName>/` | the feature's barrel(s) |

Registration is mandatory — a store that isn't re-exported from the
project's public barrels doesn't exist for consumers.

## 3. File set (identical for both kinds)

```
store.ts          # global: useXStore via the createStore devtools helper
                  # feature: createXSlice(set[, get]) factories + defaultState
types.ts          # XState, XActions, XStore extends XState { actions } — plural filename
selectors.ts      # pure selectors; global stores may add non-hook getX() via getState()
hooks.ts          # ALL selector hooks; one per selector; useShallow on object selectors
index.ts          # barrel with EXPLICIT named exports (see §5)
StoreProvider.tsx # feature stores only: provider + use<Feature>Store context hook
```

Never create `actions.ts`, `type.ts` (singular), or hooks inside
`selectors.ts` — those are legacy layouts (§7).

## 4. Canon rules (non-negotiable)

- Every slice/store has an exported, explicitly typed `defaultState`
  (`const defaultState: XState = {...}` — never let `[]` infer `never[]`),
  an `actions` object in state, and a `reset<X>()` action that spreads
  `defaultState`.
- Actions are exposed ONLY through a dedicated `use<X>Actions()` hook —
  the `actions` object reference never changes, so that hook never
  re-renders its consumers.
- Selectors are composed: derived and object selectors reuse the scalar
  selectors, never re-derive logic inline.
- Every object/array-returning selector is wrapped in `useShallow` in its
  hook (Zustand v5 uses `Object.is` — a fresh reference per call causes
  infinite re-render loops). Do not blanket-wrap primitive selectors.
- Devtools on **both** kinds: global via the `createStore` helper, feature
  via `devtools()` in the provider with a stable `name` and per-instance
  `store` id (see the templates). Action names are namespaced:
  `'settings/setTheme'`, `'search/setQuery'`.
- Feature slice factories are platform-agnostic and take a scoped
  `set(partial, actionName?)` — no middleware inside slices, ever.
- Provider exports are feature-prefixed (`<Feature>StoreProvider`,
  `use<Feature>Store`); the file is still `StoreProvider.tsx`.
- Full feature reset = remount the provider. Only add a composed root
  `reset()` action when something must reset state without unmounting.
- Non-React consumers may read via `getX()` and `useXStore.subscribe()`,
  but must retain and call the returned unsubscribe function. Feature
  stores are never accessed from outside their provider tree.

## 5. Public API surface

Barrels use **explicit named exports** so duplicate names become compile
errors instead of silently dropped `export *` collisions. (Store barrels
are the deliberate exception to the team's two-tier barrel convention —
see the imports-exports skill.) Consumers get:
**hooks, types, the provider, and `getX()` readers — nothing else.** The
raw store hook (`useXStore`), `use<Feature>Store`, selector functions, and
`defaultState` stay internal (tests import them from their file directly).

Consumption is always through the project's import alias — never deep
relative reaches into another package's internals:

```tsx
import { useTheme, useSettingsActions } from '<alias>/store'
import { ComposerStoreProvider, useSearchQuery } from '<alias>/features/composer'
```

Full templates — follow them character-for-character after substituting
paths and alias:

- Global store: [references/global-store.md](references/global-store.md)
- Feature provider store: [references/feature-store.md](references/feature-store.md)
- Immer & persist middleware: [references/middleware.md](references/middleware.md)

## 6. Testing

- **Global stores** leak between tests (module singletons). Reset in
  `afterEach`: `useXStore.setState(useXStore.getInitialState(), true)` or
  call the store's `reset<X>()` action.
- **Slice factories** are plain functions taking injected `set`/`get` —
  unit-test them without React.
- **Selectors** are pure — test against plain state objects.
- **Feature stores**: integration-test by rendering inside
  `<XStoreProvider>`; every test gets a fresh isolated store for free.

## 7. Normalize on touch

Any task that MODIFIES an off-canon store must first migrate it to this
canon (same PR, migration commit first). Off-canon markers: an
`actions.ts` file, `type.ts` (singular), hooks defined inside
`selectors.ts`, `export *` barrels, un-namespaced devtools action names.
The project's rules file may carry a concrete inventory of known off-canon
stores — check it. Read-only usage does not trigger migration.
