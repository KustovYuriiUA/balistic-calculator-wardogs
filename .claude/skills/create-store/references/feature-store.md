# Feature provider store template

Worked example: a `composer` feature store with `search` and `selection`
slices at `<featuresRoot>/composer/stores/composer/`. Each entity the
feature uses gets its own slice; slice names are unique within the
feature. The `selection` slice shows the `get` variant — only add `get`
to a factory whose actions read state.

The store is instance-scoped: every mounted provider owns a fresh store
that dies with it, so the same feature can mount several times (modals,
per-chat, per-wizard) without sharing state.

## types.ts

```ts
export interface SearchState {
  query: string
}

export interface SearchActions {
  setQuery: (query: string) => void
  resetSearch: () => void
}

export interface SearchStore extends SearchState {
  actions: SearchActions
}

export interface SelectionItem {
  id: string
}

export interface SelectionState {
  selected: SelectionItem[]
}

export interface SelectionActions {
  toggleSelect: (item: SelectionItem) => void
  resetSelection: () => void
}

export interface SelectionStore extends SelectionState {
  actions: SelectionActions
}
```

## store.ts — platform-agnostic slice factories

The scoped `set` accepts an optional devtools action name as its second
argument — always pass one, namespaced by slice.

```ts
import type { SearchStore, SelectionStore } from './types'

export type SliceSet<TStore> = (partial: Partial<TStore>, actionName?: string) => void
export type SliceGet<TStore> = () => TStore

export const defaultSearchState: Omit<SearchStore, 'actions'> = {
  query: '',
}

export const createSearchSlice = (set: SliceSet<SearchStore>): SearchStore => ({
  ...defaultSearchState,
  actions: {
    setQuery: (query) => set({ query }, 'search/setQuery'),
    resetSearch: () => set({ ...defaultSearchState }, 'search/resetSearch'),
  },
})

export const defaultSelectionState: Omit<SelectionStore, 'actions'> = {
  selected: [],
}

export const createSelectionSlice = (
  set: SliceSet<SelectionStore>,
  get: SliceGet<SelectionStore>,
): SelectionStore => ({
  ...defaultSelectionState,
  actions: {
    toggleSelect: (item) => {
      const { selected } = get()
      const isSelected = selected.some((entry) => entry.id === item.id)

      set(
        {
          selected: isSelected
            ? selected.filter((entry) => entry.id !== item.id)
            : [...selected, item],
        },
        'selection/toggleSelect',
      )
    },
    resetSelection: () => set({ ...defaultSelectionState }, 'selection/resetSelection'),
  },
})
```

Defaults are explicitly typed (`Omit<XStore, 'actions'>`) so `selected: []`
is `SelectionItem[]`, never `never[]`. No middleware inside slices — the
provider owns middleware.

## StoreProvider.tsx — composes the slices

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createStore, type StoreApi, useStore } from 'zustand'
import { devtools } from 'zustand/middleware'

import { createSearchSlice, createSelectionSlice } from './store'
import type { SearchStore, SelectionStore } from './types'

export interface ComposerStore {
  search: SearchStore
  selection: SelectionStore
}

declare const __DEV__: boolean | undefined
const isDev =
  typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production'

const createComposerStore = (instanceId?: string) =>
  createStore<ComposerStore>()(
    devtools(
      (set, get) => ({
        search: createSearchSlice((partial, actionName) =>
          set(
            (state) => ({ search: { ...state.search, ...partial } }),
            undefined,
            actionName,
          ),
        ),
        selection: createSelectionSlice(
          (partial, actionName) =>
            set(
              (state) => ({ selection: { ...state.selection, ...partial } }),
              undefined,
              actionName,
            ),
          () => get().selection,
        ),
      }),
      {
        name: 'ComposerStore', // one shared devtools connection for all instances
        store: instanceId, // this instance's key inside that connection
        enabled: isDev,
      },
    ),
  )

interface ComposerStoreProviderProps {
  instanceId?: string
  children: ReactNode
}

const StoreContext = createContext<StoreApi<ComposerStore> | null>(null)

export const ComposerStoreProvider = ({ instanceId, children }: ComposerStoreProviderProps) => {
  const [store] = useState(() => createComposerStore(instanceId))

  useEffect(() => {
    return () => {
      // v5: disconnect this instance from Redux DevTools on unmount
      ;(store as { devtools?: { cleanup: () => void } }).devtools?.cleanup()
    }
  }, [store])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useComposerStore<T>(selector: (store: ComposerStore) => T): T {
  const store = useContext(StoreContext)

  if (!store) {
    throw new Error('useComposerStore must be used within ComposerStoreProvider')
  }

  return useStore(store, selector)
}
```

Notes:

- `useState(() => ...)` creates the store exactly once per provider mount
  (the official pattern).
- With the `store` option set, all instances share ONE devtools connection
  keyed per instance, and actions appear as `<instanceId>/search/setQuery`.
  Pass a stable `instanceId` when the feature mounts multiple times at once.
- The devtools middleware no-ops safely when the extension is absent
  (including React Native), so this code ships unchanged to both platforms.

## selectors.ts — root-store-typed, composed from scalars

```ts
import type { ComposerStore } from './StoreProvider'
import type { SearchStore, SelectionStore } from './types'

export const searchQuerySelector = ({ search }: ComposerStore): string => search.query

export const hasQuerySelector = (store: ComposerStore): boolean =>
  searchQuerySelector(store) !== ''

export const searchActionsSelector = ({ search }: ComposerStore): SearchStore['actions'] =>
  search.actions

export const searchSummarySelector = (store: ComposerStore) => ({
  query: searchQuerySelector(store),
  hasQuery: hasQuerySelector(store),
})

export const selectedSelector = ({ selection }: ComposerStore) => selection.selected

export const selectionActionsSelector = ({
  selection,
}: ComposerStore): SelectionStore['actions'] => selection.actions
```

`hasQuerySelector` and `searchSummarySelector` reuse `searchQuerySelector`
— composed selectors never re-derive logic inline.

## hooks.ts — one hook per selector, useShallow on object selectors

```ts
import { useShallow } from 'zustand/react/shallow'

import { useComposerStore } from './StoreProvider'

import {
  hasQuerySelector,
  searchActionsSelector,
  searchQuerySelector,
  searchSummarySelector,
  selectedSelector,
  selectionActionsSelector,
} from './selectors'

export const useSearchQuery = () => useComposerStore(searchQuerySelector)

export const useHasQuery = () => useComposerStore(hasQuerySelector)

export const useSearchSummary = () => useComposerStore(useShallow(searchSummarySelector))

export const useSearchActions = () => useComposerStore(searchActionsSelector)

export const useSelected = () => useComposerStore(selectedSelector)

export const useSelectionActions = () => useComposerStore(selectionActionsSelector)
```

`useSearchSummary` returns an object — `useShallow` is mandatory there
(Zustand v5 has no equality argument; a fresh object per call loops).
`useSelected` returns state the store already holds by reference, so no
wrapper is needed.

## index.ts — explicit named exports only

```ts
export {
  useHasQuery,
  useSearchActions,
  useSearchQuery,
  useSearchSummary,
  useSelected,
  useSelectionActions,
} from './hooks'
export { ComposerStoreProvider } from './StoreProvider'
export type { ComposerStore } from './StoreProvider'
export type {
  SearchActions,
  SearchState,
  SearchStore,
  SelectionActions,
  SelectionItem,
  SelectionState,
  SelectionStore,
} from './types'
```

`useComposerStore`, the selector functions, the slice factories, and the
defaults stay internal — tests import them from their files directly.
Explicit exports turn any name collision into a compile error.

## Register the store

Re-export through the feature's barrels so the package alias exposes it:

```ts
// <featuresRoot>/composer/stores/index.ts
export * from './composer'

// <featuresRoot>/composer/index.ts
export * from './stores'
```

## Consumption in apps

```tsx
import {
  ComposerStoreProvider,
  useSearchQuery,
  useSearchActions,
} from '<alias>/features/composer'

const NewComposerModal = () => (
  <ComposerStoreProvider instanceId="new-composer">
    <Composer />
  </ComposerStoreProvider>
)

// web
const SearchInput = () => {
  const query = useSearchQuery()
  const { setQuery } = useSearchActions()

  return <input value={query} onChange={(e) => setQuery(e.target.value)} />
}

// React Native — identical hooks, native input
const SearchInputNative = () => {
  const query = useSearchQuery()
  const { setQuery } = useSearchActions()

  return <TextInput value={query} onChangeText={setQuery} />
}
```

Apps never build selectors inline and never reach into the package's
internals — hooks from the alias only.
