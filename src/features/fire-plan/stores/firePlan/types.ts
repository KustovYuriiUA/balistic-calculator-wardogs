import type { WorldId } from '@/data/landmarks'
import type { GamePoint } from '@/shared/geometry'
import type { GameClick, MapTool } from '@/shared/ipc'

import type { CalcErrors, CalcField, CalcFields, CalcResult } from '../../core/calculator'
import type { LandmarkSelection, Preset } from '../../core/presets'

export type SaveStatus = 'autosave' | 'saved' | 'notSaved' | 'readError'

/** The calculator's badge: waiting for coordinates, waiting for a calculation, range ready, estimate ready. */
export type CalcStatus = 'coords' | 'calc' | 'range' | 'estimate'

export type ViewKind = 'region' | 'zone' | 'all' | 'in' | 'out'

export interface Toast {
  text: string
  isUndoable: boolean
  id: number
}

export interface Calculator {
  fields: CalcFields
  errors: CalcErrors
  result: CalcResult | null
  status: CalcStatus
  /** "N m to the target": shown after the range was calculated from the two points. */
  baseMetres: number | null
  /** The range field holds the calculated range (cleared again when the points change). */
  isAutomaticBase: boolean
  isAimDetailsOpen: boolean
  copy: 'idle' | 'copied' | 'manual'
  /** A field to focus (an invalid one); id changes on every request. */
  focus: {
    field: CalcField
    id: number
  } | null
}

export interface FirePlanState {
  world: WorldId
  selections: Partial<Record<WorldId, LandmarkSelection>>
  presets: Record<string, Preset>
  tool: MapTool
  undo: Record<string, string[]>
  saveStatus: SaveStatus
  mapError: string
  toast: Toast | null
  /** The offline map is asked to show the region, the zone or the whole map; id changes on every request. */
  view: {
    kind: ViewKind
    id: number
  }
  /** The coordinate field under the position entry. */
  entry: string
  calculator: Calculator
}

export interface FirePlanActions {
  /** Restores the saved plan; once, at start. */
  start: () => void
  setWorld: (world: WorldId) => void
  setRegion: (region: string) => void
  setZone: (zone: string) => void
  setTool: (tool: MapTool) => void
  /** Places the current tool (or the given one) at a point in game units. */
  place: (point: GamePoint, tool?: MapTool) => void
  /** A click on the in-game map (marker mode): a pin hit, an impact (right button) or the current tool. */
  placeFromGame: (click: GameClick) => void
  setEntry: (text: string) => void
  placeEntry: (text: string) => void
  choose: (id: number) => void
  /** First click selects a pin, a click on the selected pin removes it (Ctrl+Z brings it back). */
  clickTarget: (id: number) => void
  removeTarget: (id: number) => void
  removePlayer: () => void
  resetCorrection: () => void
  undo: () => void
  /** The game map layer recognised a zone: the map, region and zone follow it. */
  followGameZone: (key: string) => void
  requestView: (kind: ViewKind) => void
  showToast: (text: string, isUndoable?: boolean) => void
  hideToast: () => void
  inputField: (field: CalcField, value: string) => void
  calculateBase: () => void
  calculateCorrection: () => void
  /** Fills the whole form and calculates the correction (the page's model tool). */
  fill: (fields: CalcFields) => CalcResult | null
  example: () => void
  setAimDetailsOpen: (isOpen: boolean) => void
  setCopy: (copy: Calculator['copy']) => void
}

export interface FirePlanStore extends FirePlanState {
  actions: FirePlanActions
}
