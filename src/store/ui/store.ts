import { createStore } from '../createStore'
import type { Tab, UiState, UiStore } from './types'

export const FONT_SCALES = [.9, 1, 1.15, 1.3]

export const POLL_RATES = [15, 30, 60, 120]

// localStorage 'shot-ui-v1', the same fields as 1.x: {tab: 'map' | 'calc', compact, showMap, fontScale, pollFps}.
const KEY = 'shot-ui-v1'

export const defaultState: UiState = {
  tab: 'map',
  isCompact: false,
  isMapShown: true,
  fontScale: 1,
  pollFps: 60,
}

function load(): UiState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}
    return {
      tab: saved.tab === 'calc' ? 'calc' : 'map',
      isCompact: saved.compact === true,
      isMapShown: saved.showMap !== false,
      fontScale: FONT_SCALES.includes(saved.fontScale) ? saved.fontScale : 1,
      pollFps: POLL_RATES.includes(saved.pollFps) ? saved.pollFps : 60,
    }
  } catch {
    return {
      ...defaultState,
    }
  }
}

function save(state: UiState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      tab: state.tab,
      compact: state.isCompact,
      showMap: state.isMapShown,
      fontScale: state.fontScale,
      pollFps: state.pollFps,
    }))
  } catch {
    // Storage off (private profile): the settings last for this session.
  }
}

export const useUiStore = createStore<UiStore>(
  (set, get) => {
    const update = (partial: Partial<UiState>, action: string) => {
      set(partial, undefined, action)
      save(get())
    }
    return {
      ...load(),
      actions: {
        setTab: (tab: Tab) => update({
          tab,
        }, 'ui/setTab'),
        setCompact: (isCompact) => update({
          isCompact,
        }, 'ui/setCompact'),
        setMapShown: (isMapShown) => update({
          isMapShown,
        }, 'ui/setMapShown'),
        setFontScale: (fontScale) => update({
          fontScale: FONT_SCALES.includes(fontScale) ? fontScale : 1,
        }, 'ui/setFontScale'),
        setPollFps: (pollFps) => update({
          pollFps: POLL_RATES.includes(pollFps) ? pollFps : 60,
        }, 'ui/setPollFps'),
        resetUi: () => update({
          ...defaultState,
        }, 'ui/resetUi'),
      },
    }
  },
  {
    name: 'UiStore',
  },
)
