import {
  compactSelector,
  fontScaleSelector,
  mapShownSelector,
  pollFpsSelector,
  tabSelector,
  uiActionsSelector,
} from './selectors'
import { useUiStore } from './store'

export const useTab = () => useUiStore(tabSelector)

export const useIsCompact = () => useUiStore(compactSelector)

export const useIsMapShown = () => useUiStore(mapShownSelector)

export const useFontScale = () => useUiStore(fontScaleSelector)

export const usePollFps = () => useUiStore(pollFpsSelector)

export const useUiActions = () => useUiStore(uiActionsSelector)
