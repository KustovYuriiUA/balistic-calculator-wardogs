import { useOverlayStore } from './store'
import type { OverlayStore } from './types'

export const modeSelector = (state: OverlayStore) => state.mode

export const gameMapSelector = (state: OverlayStore) => state.gameMap

export const updateSelector = (state: OverlayStore) => state.update

export const overlayActionsSelector = (state: OverlayStore) => state.actions

/** For handlers outside React (the focusless select list decides on mousedown). */
export const getMode = () => modeSelector(useOverlayStore.getState())

/** For code outside React: the preload's listeners, subscribed once at start. */
export const getOverlayActions = () => overlayActionsSelector(useOverlayStore.getState())
