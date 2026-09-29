# Global store template

Worked example: a `settings` store at `<storeRoot>/settings/`. Replace
`settings`/`Settings`/`theme` with the real entity and fields, and
`<alias>` with the project's import alias.

## Prerequisite: the `createStore` devtools helper

The helper lives at `<storeRoot>/createStore.ts`. **If the project does
not have it yet, create it from this source first:**

```ts
import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'

type DevtoolsOptions = {
  name: string
  enabled?: boolean
}

// __DEV__ exists in React Native; web bundlers define NODE_ENV instead.
declare const __DEV__: boolean | undefined
const isDev =
  typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production'

/**
 * Zustand store with devtools pre-configured. The initializer's `set`
 * accepts an action name as the third argument — always pass one,
 * namespaced by store: set({ theme }, undefined, 'settings/setTheme').
 */
export const createStore = <T>(
  initializer: StateCreator<T, [['zustand/devtools', never]]>,
  options: DevtoolsOptions,
) => {
  return create<T>()(
    devtools(initializer, {
      name: options.name,
      enabled: options.enabled ?? isDev,
    }),
  )
}
```

The `StateCreator<T, [['zustand/devtools', never]]>` typing is what makes
the three-argument `set` compile — without it every named `set` call is a
type error.

## types.ts

```ts
export type Theme = 'light' | 'dark'

export interface SettingsState {
  theme: Theme
}

export interface SettingsActions {
  setTheme: (theme: Theme) => void
  resetSettings: () => void
}

export interface SettingsStore extends SettingsState {
  actions: SettingsActions
}
```

## store.ts

```ts
import { createStore } from '../createStore'

import type { SettingsState, SettingsStore } from './types'

export const defaultState: SettingsState = {
  theme: 'light',
}

export const useSettingsStore = createStore<SettingsStore>(
  (set) => ({
    ...defaultState,
    actions: {
      setTheme: (theme) => set({ theme }, undefined, 'settings/setTheme'),
      resetSettings: () => set({ ...defaultState }, undefined, 'settings/resetSettings'),
    },
  }),
  { name: 'SettingsStore' },
)
```

`defaultState` is explicitly typed and exported (tests and the reset
pattern need it). Action names are namespaced `'settings/...'` so several
global stores stay distinguishable in one Redux DevTools timeline.

## selectors.ts

```ts
import { useSettingsStore } from './store'
import type { SettingsStore } from './types'

export const themeSelector = (state: SettingsStore) => state.theme

export const settingsActionsSelector = (state: SettingsStore) => state.actions

// Non-hook read for use outside React components. Reads getState() once,
// not reactive — components must use useTheme() so they re-render on change.
export const getTheme = () => themeSelector(useSettingsStore.getState())
```

Add non-hook `getX()` readers only when something outside React genuinely
needs them (API clients, event handlers created outside components). If a
non-React consumer must react to changes, it may
`useSettingsStore.subscribe(listener)` — it must keep the returned
unsubscribe function and call it on teardown.

## hooks.ts

```ts
import { useSettingsStore } from './store'

import { settingsActionsSelector, themeSelector } from './selectors'

export const useTheme = () => useSettingsStore(themeSelector)

export const useSettingsActions = () => useSettingsStore(settingsActionsSelector)
```

If a hook returns an object built by a composed selector, wrap the
selector in `useShallow` from `zustand/react/shallow`.

## index.ts — explicit named exports only

```ts
export { useTheme, useSettingsActions } from './hooks'
export { getTheme } from './selectors'
export type { Theme, SettingsState, SettingsActions, SettingsStore } from './types'
```

`useSettingsStore`, the selector functions, and `defaultState` are
internal — tests import them from their files directly.

## Register the store

Add to `<storeRoot>/index.ts`:

```ts
export * from './settings'
```

(The entity barrels are explicit, so the root `export *` cannot hide
collisions.) Consumers then import from the package alias:

```ts
import { useTheme, useSettingsActions } from '<alias>/store'
```
