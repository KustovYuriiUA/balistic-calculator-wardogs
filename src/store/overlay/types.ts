import type { GameMapStatus, OverlayMode, UpdateState } from '@/shared/ipc'

/** What main tells the overlay window: its mode, the game map layer's state, the updater's. */
export interface OverlayState {
  mode: OverlayMode
  gameMap: GameMapStatus | null
  update: UpdateState | null
}

export interface OverlayActions {
  setMode: (mode: OverlayMode) => void
  setGameMap: (status: GameMapStatus) => void
  setUpdate: (update: UpdateState) => void
  resetOverlay: () => void
}

export interface OverlayStore extends OverlayState {
  actions: OverlayActions
}
