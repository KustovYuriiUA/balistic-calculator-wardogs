import type {
  DragKind,
  DragPhase,
  GameClick,
  GameMapSettings,
  GameMapStatus,
  Language,
  LayerConfig,
  LayerMemory,
  LayerSnapshot,
  LayerStatus,
  OverlayMode,
  Rect,
  Scene,
  UpdateAction,
  UpdateState,
} from './types'

type Listener<T> = (value: T) => void

/** window.overlay: what the overlay window's preload exposes. */
export interface OverlayApi {
  language: Language
  /** The window reloads in the new language. */
  setLanguage: (language: Language) => void
  hide: () => void
  view: () => void
  edit: () => void
  /** Asks for the keyboard: a click into a text field. */
  keyboard: () => void
  marking: () => void
  quit: () => void
  /** Opens the support forum in the browser. */
  reportBug: () => void
  pasteText: () => Promise<string>
  copyCoordinates: (text: string) => Promise<boolean>
  drag: (kind: DragKind, phase: DragPhase) => void
  onMode: (listener: Listener<OverlayMode>) => void
  onUpdate: (listener: Listener<UpdateState>) => void
  update: (action: UpdateAction) => void
  compact: (isCompact: boolean) => void
  fitHeight: (height: number) => void
  zoom: (factor: number) => void
  gameMap: {
    pick: () => void
    select: (key: string) => void
    scene: (scene: Scene) => void
    settings: (settings: GameMapSettings) => void
    snapshot: () => void
    onStatus: (listener: Listener<GameMapStatus>) => void
    onClick: (listener: Listener<GameClick>) => void
    onNotice: (listener: Listener<string>) => void
  }
}

/** window.mapLayer: what the layer and picker windows' preload exposes. */
export interface MapLayerApi {
  language: Language
  onLanguage: (listener: Listener<Language>) => void
  config: () => Promise<LayerConfig>
  status: (status: LayerStatus) => void
  onSelection: (listener: Listener<string | null>) => void
  onScene: (listener: Listener<Scene>) => void
  onMarking: (listener: Listener<boolean>) => void
  click: (click: GameClick) => void
  /** A wheel or a drag in marker mode: the mouse to the game (true) and back (false). */
  pass: (isPassing: boolean) => void
  /** The app gave the mouse back by itself. */
  onPass: (listener: Listener<boolean>) => void
  onSettings: (listener: Listener<GameMapSettings>) => void
  /** The map panel found in and around the area, in screen coordinates: the area is fitted to it. */
  panel: (rect: Rect) => void
  /** The map's frame left the fitted area's edges and the panel was found elsewhere: the area moves to it. */
  refit: (rect: Rect) => void
  onSnapped: (listener: () => void) => void
  remember: (memory: LayerMemory) => void
  onSnapshot: (listener: () => void) => void
  snapshot: (data: LayerSnapshot) => void
  picked: (rect: Rect) => void
  cancel: () => void
}
