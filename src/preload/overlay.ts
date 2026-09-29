import { contextBridge, ipcRenderer } from 'electron'

import { LANGUAGE_SYNC, type OverlayApi } from '@/shared/ipc'

import { listen, request, send } from './bridge'

const api: OverlayApi = {
  language: ipcRenderer.sendSync(LANGUAGE_SYNC),
  setLanguage: (language) => send('app:set-language', language),
  hide: () => send('overlay:hide'),
  view: () => send('overlay:view'),
  edit: () => send('overlay:edit'),
  keyboard: () => send('overlay:keyboard'),
  marking: () => send('overlay:marking'),
  quit: () => send('overlay:quit'),
  pasteText: () => request('overlay:paste'),
  copyCoordinates: (text) => request('overlay:copy', text),
  drag: (kind, phase) => send('overlay:drag', kind, phase),
  onMode: (listener) => listen('overlay:mode', listener),
  onUpdate: (listener) => listen('overlay:update', listener),
  update: (action) => send('overlay:update-action', action),
  compact: (isCompact) => send('overlay:compact', isCompact === true),
  fitHeight: (height) => send('overlay:fit-height', height),
  zoom: (factor) => send('overlay:zoom', factor),
  gameMap: {
    pick: () => send('overlay:pick-area'),
    select: (key) => send('overlay:game-map-select', key),
    scene: (scene) => send('overlay:scene', scene),
    settings: (settings) => send('overlay:game-map-settings', settings),
    snapshot: () => send('overlay:game-map-snapshot'),
    onStatus: (listener) => listen('overlay:game-map', listener),
    onClick: (listener) => listen('overlay:game-click', listener),
    onNotice: (listener) => listen('overlay:game-map-notice', listener),
  },
}

contextBridge.exposeInMainWorld('overlay', api)
