import { useShallow } from 'zustand/react/shallow'

import {
  calculatorSelector,
  entrySelector,
  firePlanActionsSelector,
  mapErrorSelector,
  presetKeySelector,
  presetSelector,
  saveStatusSelector,
  selectedTargetSelector,
  selectionSelector,
  toastSelector,
  toolSelector,
  viewSelector,
  worldSelector,
  zoneKeySelector,
} from './selectors'
import { useFirePlanStore } from './store'

export const useWorld = () => useFirePlanStore(worldSelector)

export const useTool = () => useFirePlanStore(toolSelector)

export const useSaveStatus = () => useFirePlanStore(saveStatusSelector)

export const useMapError = () => useFirePlanStore(mapErrorSelector)

export const useToast = () => useFirePlanStore(toastSelector)

export const useViewRequest = () => useFirePlanStore(viewSelector)

export const useEntry = () => useFirePlanStore(entrySelector)

export const useCalculator = () => useFirePlanStore(calculatorSelector)

export const usePreset = () => useFirePlanStore(presetSelector)

export const usePresetKey = () => useFirePlanStore(presetKeySelector)

export const useSelectedTarget = () => useFirePlanStore(selectedTargetSelector)

export const useSelection = () => useFirePlanStore(useShallow(selectionSelector))

export const useZoneKey = () => useFirePlanStore(zoneKeySelector)

export const useFirePlanActions = () => useFirePlanStore(firePlanActionsSelector)
