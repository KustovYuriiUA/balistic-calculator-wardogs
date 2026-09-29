export type Tab = 'map' | 'calc'

export interface UiState {
  tab: Tab
  /** "Compact" chosen by hand (a narrow window is compact by itself). */
  isCompact: boolean
  isMapShown: boolean
  fontScale: number
  pollFps: number
}

export interface UiActions {
  setTab: (tab: Tab) => void
  setCompact: (isCompact: boolean) => void
  setMapShown: (isShown: boolean) => void
  setFontScale: (scale: number) => void
  setPollFps: (fps: number) => void
  resetUi: () => void
}

export interface UiStore extends UiState {
  actions: UiActions
}
