import { createStore } from '../createStore'
import type { OverlayState, OverlayStore } from './types'

export const defaultState: OverlayState = {
  mode: 'view',
  gameMap: null,
  update: null,
}

export const useOverlayStore = createStore<OverlayStore>(
  (set) => ({
    ...defaultState,
    actions: {
      setMode: (mode) => set({
        mode,
      }, undefined, 'overlay/setMode'),
      setGameMap: (gameMap) => set({
        gameMap,
      }, undefined, 'overlay/setGameMap'),
      setUpdate: (update) => set({
        update,
      }, undefined, 'overlay/setUpdate'),
      resetOverlay: () => set({
        ...defaultState,
      }, undefined, 'overlay/resetOverlay'),
    },
  }),
  {
    name: 'OverlayStore',
  },
)
