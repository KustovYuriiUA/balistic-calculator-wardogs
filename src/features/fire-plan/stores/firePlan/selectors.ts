import {
  keyOf, presetOf, selectedOf, selectionOf, useFirePlanStore,
} from './store'
import type { FirePlanStore } from './types'

export const worldSelector = (state: FirePlanStore) => state.world

export const toolSelector = (state: FirePlanStore) => state.tool

export const saveStatusSelector = (state: FirePlanStore) => state.saveStatus

export const mapErrorSelector = (state: FirePlanStore) => state.mapError

export const toastSelector = (state: FirePlanStore) => state.toast

export const viewSelector = (state: FirePlanStore) => state.view

export const entrySelector = (state: FirePlanStore) => state.entry

export const calculatorSelector = (state: FirePlanStore) => state.calculator

export const presetSelector = (state: FirePlanStore) => presetOf(state)

export const presetKeySelector = (state: FirePlanStore) => keyOf(state)

export const selectedTargetSelector = (state: FirePlanStore) => selectedOf(presetSelector(state))

/** Region and zone chosen for the current map (an object: its hook compares shallowly). */
export const selectionSelector = (state: FirePlanStore) => selectionOf(state)

/** "world/zone" of the current choice: what the game map layer calibrates with until it recognises a zone. */
export const zoneKeySelector = (state: FirePlanStore) => state.world + '/' + selectionSelector(state).zone

export const firePlanActionsSelector = (state: FirePlanStore) => state.actions

/** For code outside React: the game map bridge, hotkeys. */
export const getFirePlan = () => useFirePlanStore.getState()
