import { contextBridge, ipcRenderer } from 'electron'

import { LANGUAGE_SYNC, type MapLayerApi } from '@/shared/ipc'

import { listen, request, send } from './bridge'

// Shared by the game-map layer and the area picker.
const api: MapLayerApi = {
  language: ipcRenderer.sendSync(LANGUAGE_SYNC),
  onLanguage: (listener) => listen('app:language-changed', listener),
  config: () => request('layer:config'),
  status: (status) => send('layer:status', status),
  onSelection: (listener) => listen('layer:selection', listener),
  onScene: (listener) => listen('layer:scene', listener),
  onMarking: (listener) => listen('layer:marking', listener),
  click: (click) => send('layer:click', click),
  pass: (isPassing) => send('layer:pass', isPassing === true),
  onPass: (listener) => listen('layer:pass', (isPassing) => listener(isPassing === true)),
  onSettings: (listener) => listen('layer:settings', listener),
  panel: (rect) => send('layer:panel', rect),
  refit: (rect) => send('layer:refit', rect),
  onSnapped: (listener) => listen('layer:snapped', listener),
  remember: (memory) => send('layer:remember', memory),
  onSnapshot: (listener) => listen('layer:snapshot', listener),
  snapshot: (data) => send('layer:snapshot-data', data),
  picked: (rect) => send('picker:done', rect),
  cancel: () => send('picker:cancel'),
}

contextBridge.exposeInMainWorld('mapLayer', api)
