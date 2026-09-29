import { gameMapSelector, modeSelector, overlayActionsSelector, updateSelector } from './selectors'
import { useOverlayStore } from './store'

export const useOverlayMode = () => useOverlayStore(modeSelector)

export const useGameMapStatus = () => useOverlayStore(gameMapSelector)

export const useUpdateState = () => useOverlayStore(updateSelector)

export const useOverlayActions = () => useOverlayStore(overlayActionsSelector)
