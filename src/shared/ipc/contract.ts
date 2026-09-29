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

// Every IPC channel of the app, with what its message carries. Main receives each payload as untrusted input and
// validates it (the types say what a well-behaved page sends, not what arrives).

/** Overlay page → main (ipcRenderer.send). */
export interface OverlayEvents {
  'overlay:hide': []
  'overlay:view': []
  'overlay:edit': []
  'overlay:keyboard': []
  'overlay:marking': []
  'overlay:quit': []
  'overlay:drag': [kind: DragKind, phase: DragPhase]
  'overlay:update-action': [action: UpdateAction]
  'overlay:compact': [isCompact: boolean]
  'overlay:fit-height': [height: number]
  'overlay:zoom': [factor: number]
  'overlay:pick-area': []
  'overlay:scene': [scene: Scene]
  'overlay:game-map-select': [key: string]
  'overlay:game-map-settings': [settings: GameMapSettings]
  'overlay:game-map-snapshot': []
  'app:set-language': [language: Language]
}

/** Overlay page → main (ipcRenderer.invoke): arguments and result. */
export interface OverlayRequests {
  'overlay:paste': [args: [], result: string]
  'overlay:copy': [args: [text: string], result: boolean]
}

/** Main → overlay page (webContents.send). */
export interface OverlayPushes {
  'overlay:mode': [mode: OverlayMode]
  'overlay:update': [update: UpdateState]
  'overlay:game-map': [status: GameMapStatus]
  'overlay:game-click': [click: GameClick]
  'overlay:game-map-notice': [text: string]
}

/** Layer and picker pages → main (ipcRenderer.send). */
export interface LayerEvents {
  'layer:status': [status: LayerStatus]
  'layer:click': [click: GameClick]
  'layer:pass': [isPassing: boolean]
  'layer:panel': [rect: Rect]
  'layer:refit': [rect: Rect]
  'layer:remember': [memory: LayerMemory]
  'layer:snapshot-data': [snapshot: LayerSnapshot]
  'picker:done': [rect: Rect]
  'picker:cancel': []
}

/** Layer page → main (ipcRenderer.invoke). */
export interface LayerRequests {
  'layer:config': [args: [], result: LayerConfig]
}

/** Main → layer and picker pages (webContents.send). */
export interface LayerPushes {
  'layer:selection': [key: string | null]
  'layer:scene': [scene: Scene]
  'layer:marking': [isMarking: boolean]
  'layer:pass': [isPassing: boolean]
  'layer:settings': [settings: GameMapSettings]
  'layer:snapped': []
  'layer:snapshot': []
  'app:language-changed': [language: Language]
}

/** Every preload reads the language synchronously before its page starts (ipcRenderer.sendSync). */
export const LANGUAGE_SYNC = 'app:language'

export type PageEvents = OverlayEvents & LayerEvents
export type PageRequests = OverlayRequests & LayerRequests
export type PagePushes = OverlayPushes & LayerPushes
