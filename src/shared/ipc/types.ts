import type { GamePoint } from '@/shared/geometry'
import type { Language } from '@/shared/i18n'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** view: click-through and dimmed; edit: clickable without the keyboard; keyboard: focused, for typing. */
export type OverlayMode = 'view' | 'edit' | 'keyboard'

export type DragKind = 'move' | 'w' | 'e' | 's' | 'sw' | 'se'

export type DragPhase = 'start' | 'move' | 'end'

export type UpdateAction = 'check' | 'restart' | 'open'

export type UpdateStateName = 'idle' | 'checking' | 'latest' | 'manual' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  state: UpdateStateName
  current: string
  isAuto: boolean
  isEnabled: boolean
  /** The check was asked for by the user: its result is shown for a moment even when nothing is new. */
  isManual?: boolean
  version?: string
  progress?: number
  url?: string
  message?: string
}

// closed / open: the map's frame on the fitted area's edges says so; searching: not known (area not fitted yet).
export const LAYER_STATES = [
  'no-area',
  'starting',
  'closed',
  'searching',
  'open',
  'acquiring',
  'locked',
  'weak',
  'error',
] as const

export type LayerState = typeof LAYER_STATES[number]

/** What the layer knows about the game map. source: what calibrates it; open: the map's frame seen (null: not
 * known); progress: of a terrain search, 0…1; isFailed: the last search found nothing. */
export interface LayerStatus {
  state: LayerState
  key: string | null
  isRecognised: boolean
  isCalibrated: boolean
  source: 'rim' | 'terrain' | null
  world: string | null
  metresPerPixel: number | null
  isOpen: boolean | null
  progress: number | null
  isFailed: boolean
  message: string | null
}

export interface GameMapStatus extends LayerStatus {
  isMarking: boolean
}

/** A click on the in-game map in game units; pin: 'player' or a target number when a pin was hit. */
export interface GameClick {
  x: number
  y: number
  button: 'left' | 'right'
  pin: 'player' | number | null
}

export type MapTool = 'player' | 'target' | 'hit'

/** What the layer draws over the in-game map: the overlay's pins, lines and label, and the next step. */
export interface Scene {
  tool: MapTool
  player: GamePoint | null
  selected: number | null
  targets: {
    id: number
    x: number
    y: number
  }[]
  hit: GamePoint | null
  aim: GamePoint | null
  label: string
  hint: string
}

export interface LayerFix {
  x0: number
  y0: number
  s: number
}

/** The layer's last calibration: map, zone and fix, kept across sessions for a quick start. */
export interface LayerMemory {
  world: string
  key: string | null
  fix: LayerFix
}

export interface GameMapSettings {
  fps: number
}

export interface LayerConfig {
  sourceId: string
  rect: Rect
  display: {
    bounds: Rect
  }
  isSnapped: boolean
  selection: string | null
  fps: number
  memory: LayerMemory | null
}

export interface LayerSnapshot {
  png: Uint8Array | null
  info: unknown
}

export type { Language }
