# Middleware: immer and persist

Devtools is always on (see the store templates). Immer and persist are
opt-in per store, chosen in the interview. Composition order is fixed:

```
devtools(persist(immer(initializer)))
```

Devtools outermost — it rewrites `set` to accept the action-name argument,
and inner middlewares must not erase that. Immer innermost — it transforms
the raw `set` into a draft recipe for every layer above it. Never
`immer(devtools(...))`.

## Immer — when and how

**When:** only when updates touch state nested **two or more levels deep**
(`{ ...state, a: { ...state.a, b: { ...state.a.b, x } } }`) or mutate items
inside arrays/records by id. Flat state never needs it — Zustand's `set`
already shallow-merges the top level. Do not add immer "just in case".

**Global store with immer** (replaces the plain `createStore` helper call —
compose inline; the curried `create<T>()(...)` form is required):

```ts
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

export const useTodosStore = create<TodosStore>()(
  devtools(
    immer((set) => ({
      ...defaultState,
      actions: {
        toggleTodo: (id: string) =>
          set(
            (state) => {
              state.todos[id].done = !state.todos[id].done // draft mutation
            },
            undefined,
            'todos/toggleTodo',
          ),
      },
    })),
    { name: 'TodosStore', enabled: isDev },
  ),
)
```

**Recipe rules (immer will throw or silently misbehave otherwise):**

- Block-body arrow functions only: `set((state) => { state.count += 1 })`.
  A concise body `set((state) => (state.count += 1))` *returns* the value —
  broken.
- Mutate the draft OR return a new object — never both in one recipe.
- `Map`/`Set` in state require `enableMapSet()` from `immer` called once at
  the app entry point, before any store code runs. Prefer plain
  `Record<string, T>` — it also survives persist's JSON serialization.
- Class instances in state need `[immerable] = true` or mutations bypass
  the proxy and subscribers never re-render.

**Slices + immer:** middleware is applied only at the provider/store level,
never inside slice factories. If a feature store adopts immer, the
provider's scoped-set wiring changes from spread-merge to draft assignment:

```ts
search: createSearchSlice((partial, actionName) =>
  set(
    (state) => {
      Object.assign(state.search, partial) // draft — no spreads needed
    },
    undefined,
    actionName,
  ),
),
```

Slice factories themselves stay unchanged (they still emit partials), so
slices remain middleware-agnostic.

## Persist — cross-platform pattern

Store code must not import platform storage. The storage adapter is
**injected by each app** at bootstrap; the store defers hydration until
the adapter exists.

**Shared registry** (once per project, e.g. `<storeRoot>/storage.ts`):

```ts
import type { StateStorage } from 'zustand/middleware'

let appStorage: StateStorage | null = null

export const registerStoreStorage = (storage: StateStorage) => {
  appStorage = storage
}

export const getStoreStorage = (): StateStorage => {
  if (!appStorage) throw new Error('registerStoreStorage() must run at app bootstrap')
  return appStorage
}
```

**Persisted global store:**

```ts
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'

import { getStoreStorage } from '../storage'

export const useSettingsStore = create<SettingsStore>()(
  devtools(
    persist(
      (set) => ({
        ...defaultState,
        actions: {
          setTheme: (theme) => set({ theme }, undefined, 'settings/setTheme'),
          resetSettings: () =>
            set({ ...defaultState }, undefined, 'settings/resetSettings'),
        },
      }),
      {
        name: 'settings', // the storage key
        storage: createJSONStorage(() => getStoreStorage()), // thunk = lazy
        version: 1, // set from day one; bump + migrate on shape changes
        partialize: ({ actions: _actions, ...rest }) => rest, // never persist actions
        skipHydration: true, // hydrate after the app registers storage
      },
    ),
    { name: 'SettingsStore', enabled: isDev },
  ),
)
```

**App bootstrap** (each platform, before first render of consumers):

```ts
// web
registerStoreStorage(localStorage)
// React Native — AsyncStorage matches StateStorage as-is; MMKV is the
// faster synchronous choice via a 3-method wrapper
registerStoreStorage(AsyncStorage)

// then hydrate every persisted store:
void useSettingsStore.persist.rehydrate()
```

**Rules:**

- `partialize` always excludes `actions` (they are re-supplied by the
  initializer on rehydrate) and any transient fields.
- `version` + `migrate(persistedState, version)` from day one — without a
  migration, a shape change silently discards users' persisted state.
- Async storage (AsyncStorage) hydrates late: gate UI that depends on
  persisted values on `useXStore.persist.hasHydrated()` /
  `onFinishHydration`, or a `_hasHydrated` flag set via
  `onRehydrateStorage`. Synchronous storage (localStorage, MMKV) doesn't
  need gating — but keep the gate if the store must work with both.
- **Feature (provider) stores:** persist only when each instance has a
  stable identity — key the storage as `name: `${store}-${instanceId}``.
  Anonymous/positional instances must NOT persist: their keys collide
  (last-write-wins) or orphan entries accumulate; persist never
  garbage-collects. Default: persist is for global stores.
