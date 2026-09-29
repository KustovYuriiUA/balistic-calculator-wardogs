import type { UiStore } from './types'

export const tabSelector = (state: UiStore) => state.tab

export const compactSelector = (state: UiStore) => state.isCompact

export const mapShownSelector = (state: UiStore) => state.isMapShown

export const fontScaleSelector = (state: UiStore) => state.fontScale

export const pollFpsSelector = (state: UiStore) => state.pollFps

export const uiActionsSelector = (state: UiStore) => state.actions
