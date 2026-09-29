import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'

type DevtoolsOptions = {
  name: string
  enabled?: boolean
}

const isDev = import.meta.env?.DEV === true

/**
 * Zustand store with devtools pre-configured. The initializer's `set` accepts an action name as the third argument —
 * always pass one, namespaced by store: set({ theme }, undefined, 'settings/setTheme').
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
