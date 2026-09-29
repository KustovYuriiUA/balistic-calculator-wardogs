import fs from 'node:fs'
import path from 'node:path'

import {
  app, clipboard, dialog, globalShortcut, ipcMain, nativeImage,
} from 'electron'

import { createMapLayer, type MapLayer } from '@/features/game-map/main'
import { confirmStart, currentUpdate, startUpdater, updateAction } from '@/features/updates/main/updater'
import {
  getLanguage, isLanguage, setLanguage, t, type Language,
} from '@/shared/i18n'
import { LANGUAGE_SYNC, type Scene, type UpdateAction } from '@/shared/ipc'

import { onEvent, onRequest, push } from './ipc'
import { createOverlayWindow } from './overlay-window'
import { readLanguage, saveLanguage } from './settings'
import { openSupport } from './support'
import { createTray } from './tray'

const UPDATE_ACTIONS: UpdateAction[] = ['check', 'restart', 'open']

// Read at run time, as in 1.x: an update started from updates/<version>/ reports its own package.json, and a
// staged test build only needs its package.json changed.
const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as {
  version: string
}
const COORDINATES = /^Y-?\d+(?:\.\d+)? X-?\d+(?:\.\d+)?$/

async function start() {
  const userData = app.getPath('userData')
  // English unless another language was chosen; every window's preload asks for it before its page starts.
  const settingsFile = path.join(userData, 'settings.json')
  setLanguage(readLanguage(settingsFile))
  ipcMain.on(LANGUAGE_SYNC, (event) => {
    event.returnValue = getLanguage()
  })

  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'))
  let mapLayer: MapLayer | null = null
  const isGameMapOpen = () => {
    const s = mapLayer?.status()
    return Boolean(s && (s.isOpen === true || s.isCalibrated))
  }
  const overlay = createOverlayWindow({
    userData,
    icon,
    isEditWanted: () => Boolean(mapLayer?.isMarking()) || isGameMapOpen(),
  })
  const { window } = overlay
  const isFromOverlay = (sender: Electron.WebContents) =>
    !window.isDestroyed() && sender === window.webContents
  app.on('before-quit', overlay.persistPosition)
  // The game-map layer keeps its own window: closing the overlay still ends the app.
  window.on('closed', () => app.quit())
  app.on('second-instance', () => overlay.setKeyboard(true))

  mapLayer = createMapLayer({
    file: path.join(userData, 'map-area.json'),
    memoryFile: path.join(userData, 'game-map-memory.json'),
    diagnostics: path.join(userData, 'diagnostics'),
    // The game map opening or closing, and marker mode, switch the window between viewing and clicking.
    onStatus: (status) => {
      push(window, 'overlay:game-map', status)
      overlay.applyMode()
    },
    onClick: (click) => push(window, 'overlay:game-click', click),
    onNotice: (text) => push(window, 'overlay:game-map-notice', text),
    beforePick: () => window.hide(),
    afterPick: () => {
      overlay.reveal()
      overlay.applyMode()
    },
  })
  const layer = mapLayer
  app.on('before-quit', () => layer.flush())

  // Insert: marker mode on or off, nothing else. The window comes back if it was hidden.
  function toggleMarking() {
    layer.setMarking(!layer.isMarking())
    overlay.reveal()
    overlay.applyMode()
  }

  // Another language (the overlay's select or the tray): remembered, the tray and the layer follow at once, the
  // overlay reloads in it (its points, targets and settings are saved in the page and come back).
  function changeLanguage(next: Language) {
    if (next === getLanguage()) return
    setLanguage(next)
    saveLanguage(settingsFile, next)
    tray.refresh(currentUpdate())
    layer.language(next)
    if (!window.isDestroyed()) {
      window.setTitle(t('app.name'))
      window.webContents.reload()
    }
  }

  const tray = createTray(icon, version, {
    toggleMarking,
    showKeyboard: () => overlay.setKeyboard(true),
    hide: () => window.hide(),
    pickArea: () => layer.pick(),
    snapshot: () => layer.snapshot(),
    reportBug: openSupport,
    setLanguage: changeLanguage,
    reveal: overlay.reveal,
  })

  onEvent('app:set-language', (event, next) => {
    if (isFromOverlay(event.sender) && isLanguage(next)) changeLanguage(next)
  })
  // view: marker mode off, keyboard back (as far as the window can give it: a click on the game takes it).
  onEvent('overlay:view', (event) => {
    if (!isFromOverlay(event.sender)) return
    layer.setMarking(false)
    overlay.setKeyboard(false)
  })
  onEvent('overlay:marking', (event) => {
    if (isFromOverlay(event.sender)) toggleMarking()
  })
  onEvent('overlay:quit', (event) => {
    if (isFromOverlay(event.sender)) app.quit()
  })
  onEvent('overlay:update-action', (event, action) => {
    if (isFromOverlay(event.sender) && UPDATE_ACTIONS.includes(action as UpdateAction)) {
      updateAction(action as UpdateAction)
    }
  })
  onRequest('overlay:paste', async (event) => {
    if (!isFromOverlay(event.sender)) throw new Error(t('main.noAccess'))
    return String(await clipboard.readText()).slice(0, 200)
  })
  onRequest('overlay:copy', async (event, text) => {
    const isCoordinates = typeof text === 'string' && text.length <= 100 && COORDINATES.test(text)
    if (!isFromOverlay(event.sender) || !isCoordinates) throw new Error(t('main.badCoords'))
    await clipboard.writeText(text)
    return true
  })
  onEvent('overlay:scene', (event, scene) => {
    const isScene = scene !== null && typeof scene === 'object' && JSON.stringify(scene).length < 50000
    if (isFromOverlay(event.sender) && isScene) layer.scene(scene as Scene)
  })
  onEvent('overlay:pick-area', (event) => {
    if (isFromOverlay(event.sender)) layer.pick()
  })
  onEvent('overlay:game-map-select', (event, key) => {
    if (isFromOverlay(event.sender) && typeof key === 'string' && key.length <= 100) layer.select(key)
  })
  onEvent('overlay:game-map-settings', (event, settings) => {
    if (isFromOverlay(event.sender)) layer.settings(settings)
  })
  onEvent('overlay:game-map-snapshot', (event) => {
    if (isFromOverlay(event.sender)) layer.snapshot()
  })
  onEvent('overlay:report-bug', (event) => {
    if (isFromOverlay(event.sender)) openSupport()
  })

  startUpdater({
    version,
    userData,
    isEnabled: app.isPackaged || Boolean(process.env.SHOT_UPDATE_FEED),
    onChange: (update) => {
      tray.refresh(update)
      push(window, 'overlay:update', update)
    },
  })
  window.webContents.on('did-finish-load', () => {
    push(window, 'overlay:update', currentUpdate())
    push(window, 'overlay:game-map', layer.status())
    push(window, 'overlay:mode', overlay.mode())
  })
  const isRegistered = globalShortcut.register('Insert', toggleMarking)
  await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  layer.start()
  confirmStart()
  overlay.applyMode()
  overlay.reveal()
  if (!isRegistered) {
    dialog.showMessageBox(window, {
      type: 'warning',
      title: t('dlg.insertTitle'),
      message: t('dlg.insertMessage'),
      detail: t('dlg.insertDetail'),
    })
  }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.setAppUserModelId('local.basketball.shot-overlay')
  app.whenReady().then(start).catch((error: Error) => {
    dialog.showErrorBox(t('dlg.openFailed'), error.message)
    app.quit()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
