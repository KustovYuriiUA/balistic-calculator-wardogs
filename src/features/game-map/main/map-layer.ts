import fs from 'node:fs'
import path from 'node:path'

import {
  BrowserWindow, desktopCapturer, screen, shell, type Display,
} from 'electron'

import { lockDown, onEvent, onRequest, push } from '@/main/ipc'
import { t, type Language } from '@/shared/i18n'
import type {
  GameClick, GameMapStatus, LayerConfig, LayerMemory, LayerStatus, Rect, Scene,
} from '@/shared/ipc'

import {
  areaFromSelection, readArea, resolveArea, saveArea, snapArea, type ResolvedArea,
} from './map-area'
import {
  cleanClick, cleanFps, cleanMemory, cleanStatus, DEFAULT_FPS,
} from './validate'

// A click-through window over the in-game map panel: its page captures that screen area, calibrates it to game units
// and draws the overlay's points there. In marker mode (Insert), while the map is calibrated, the layer takes the
// mouse and its clicks go to the overlay as points; a wheel or a drag over it hands the mouse to the game for a
// moment, so the game's map zooms and moves. Neither the layer nor the area picker ever takes the keyboard: the game
// keeps its focus and its sound.

const page = (name: string) => path.join(__dirname, '..', 'dist', name)

// The mouse handed to the game goes back to the layer this long after the layer last asked for it (it asks every
// second while the game's map moves), should the layer not give it back itself.
const PASS_MS = 3000

// A session of their own: page zoom (the overlay's font size) propagates across same-origin pages of one session, and
// the layer draws in exact screen pixels.
const webPreferences = {
  preload: path.join(__dirname, 'layer-preload.cjs'),
  partition: 'game-map-layer',
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
}

const frameless = {
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  hasShadow: false,
  resizable: false,
  movable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  show: false,
  alwaysOnTop: true,
  focusable: false,
}

export interface MapLayerOptions {
  file: string
  memoryFile: string
  diagnostics: string
  onStatus: (status: GameMapStatus) => void
  onClick: (click: GameClick) => void
  onNotice: (text: string) => void
  beforePick: () => void
  afterPick: () => void
}

export interface MapLayer {
  start: () => void
  pick: () => void
  setMarking: (isMarking: boolean) => void
  status: () => GameMapStatus
  isMarking: () => boolean
  select: (key: string) => void
  settings: (settings: unknown) => void
  snapshot: () => boolean
  scene: (scene: Scene) => void
  language: (language: Language) => void
  flush: () => void
}

const hasMoved = (a: Rect, b: Rect) => (['x', 'y', 'width', 'height'] as const).some((k) => Math.abs(a[k] - b[k]) > 3)

export function createMapLayer(options: MapLayerOptions): MapLayer {
  const {
    file, memoryFile, diagnostics, onStatus, onClick, onNotice, beforePick, afterPick,
  } = options
  let layer: BrowserWindow | null = null
  let picker: BrowserWindow | null = null
  let pickerDisplay: Display | null = null
  let area: ResolvedArea<Display> | null = null
  let selection: string | null = null
  let scene: Scene | null = null
  let fps = DEFAULT_FPS
  let status: LayerStatus = cleanStatus({
    state: 'no-area',
  })
  let restart: ReturnType<typeof setTimeout> | undefined
  let isMarking = false
  // isClickable: marker mode on a calibrated map; isTaking: the layer window has the mouse right now; isPassing:
  // handed to the game for a wheel zoom or a drag (layer:pass).
  let isClickable = false
  let isTaking = false
  let isPassing = false
  let passTimer: ReturnType<typeof setTimeout> | undefined

  const isLive = () => Boolean(layer && !layer.isDestroyed())
  const notify = () => onStatus({
    ...status,
    isMarking,
  })

  function endPass() {
    if (!isPassing) return
    isPassing = false
    clearTimeout(passTimer)
    push(layer, 'layer:pass', false)
  }

  // The layer takes the mouse only in marker mode and while the map is calibrated; otherwise every click goes to the
  // game. While passing the game has it too, and marker mode stays on.
  function applyLayer() {
    const isOn = isMarking && status.isCalibrated && isLive()
    const shouldRaise = isOn && !isClickable
    isClickable = isOn
    if (!isMarking || !isLive()) endPass()
    const shouldTake = isOn && !isPassing
    if (!layer || !isLive() || shouldTake === isTaking) return
    isTaking = shouldTake
    layer.setIgnoreMouseEvents(!shouldTake, {
      forward: true,
    })
    if (shouldRaise) {
      layer.setAlwaysOnTop(true, 'screen-saver')
      layer.showInactive()
    }
  }

  function report(next: unknown) {
    status = cleanStatus(next)
    applyLayer()
    notify()
  }

  function resetMouse() {
    clearTimeout(passTimer)
    isClickable = false
    isTaking = false
    isPassing = false
  }

  function close() {
    clearTimeout(restart)
    resetMouse()
    if (layer && !layer.isDestroyed()) layer.destroy()
    layer = null
  }

  /** (Re)creates the layer exactly over the saved area; without a valid area there is nothing to capture. */
  function open() {
    close()
    area = resolveArea(readArea(file), screen.getAllDisplays())
    if (!area) {
      report({
        state: 'no-area',
      })
      return
    }
    const window = new BrowserWindow({
      ...area.rect,
      ...frameless,
      title: t('layer.title'),
      webPreferences: {
        ...webPreferences,
        backgroundThrottling: false,
      },
    })
    layer = window
    lockDown(window)
    window.setAlwaysOnTop(true, 'screen-saver')
    // Our own drawings must never reach the capture; outside marker mode the mouse always goes to the game.
    window.setContentProtection(true)
    window.setIgnoreMouseEvents(true, {
      forward: true,
    })
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.showInactive()
    })
    window.on('closed', () => {
      if (layer !== window) return
      layer = null
      resetMouse()
    })
    window.webContents.on('did-finish-load', () => {
      if (scene) push(window, 'layer:scene', scene)
      if (isMarking) push(window, 'layer:marking', true)
    })
    window.webContents.on('render-process-gone', () => {
      report({
        state: 'error',
        message: t('layer.restarting'),
      })
      restart = setTimeout(open, 3000)
    })
    report({
      state: 'starting',
    })
    window.loadFile(page('layer.html'))
  }

  /** Marker mode: on until Insert again. With the map closed or not found yet it waits for it. */
  function setMarking(isOn: boolean) {
    isMarking = isOn === true
    applyLayer()
    push(layer, 'layer:marking', isMarking)
    notify()
  }

  function pick() {
    if (picker && !picker.isDestroyed()) return
    setMarking(false)
    pickerDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    beforePick()
    // Not focusable either: the game keeps the keyboard, so M still opens its map while the frame is drawn.
    const window = new BrowserWindow({
      ...pickerDisplay.bounds,
      ...frameless,
      title: t('picker.title'),
      webPreferences,
    })
    picker = window
    lockDown(window)
    window.setAlwaysOnTop(true, 'screen-saver')
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.showInactive()
    })
    window.on('closed', () => {
      picker = null
      afterPick()
    })
    window.loadFile(page('area-picker.html'))
  }

  // The last calibration of this very area, kept while the area stays.
  function readMemory(): LayerMemory | null {
    try {
      const m = JSON.parse(fs.readFileSync(memoryFile, 'utf8'))
      return area && JSON.stringify(m?.rect) === JSON.stringify(area.rect) ? cleanMemory(m) : null
    } catch {
      return null
    }
  }

  let memoryTimer: ReturnType<typeof setTimeout> | undefined
  let pendingMemory: (LayerMemory & { rect: Rect }) | null = null

  function saveMemory() {
    if (!pendingMemory || !memoryFile) return
    try {
      fs.mkdirSync(path.dirname(memoryFile), {
        recursive: true,
      })
      fs.writeFileSync(memoryFile, JSON.stringify(pendingMemory))
    } catch (error) {
      console.warn('Could not save the game map calibration:', (error as Error).message)
    }
    pendingMemory = null
  }

  const isFromLayer = (sender: Electron.WebContents) =>
    Boolean(layer && !layer.isDestroyed() && sender === layer.webContents)

  onRequest('layer:config', async (event): Promise<LayerConfig> => {
    if (!isFromLayer(event.sender) || !area) throw new Error(t('layer.noArea'))
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: 0,
        height: 0,
      },
    })
    const displayId = String(area.display.id)
    const source = sources.find((s) => s.display_id === displayId)
      || (sources.length === 1 ? sources[0] : null)
    if (!source) throw new Error(t('layer.noScreen'))
    return {
      sourceId: source.id,
      rect: area.rect,
      display: {
        bounds: area.display.bounds,
      },
      isSnapped: area.isSnapped,
      selection,
      fps,
      memory: readMemory(),
    }
  })

  onEvent('layer:remember', (event, next) => {
    const memory = isFromLayer(event.sender) && area ? cleanMemory(next) : null
    if (!memory || !area) return
    pendingMemory = {
      rect: area.rect,
      ...memory,
    }
    clearTimeout(memoryTimer)
    memoryTimer = setTimeout(saveMemory, 1000)
  })

  // Troubleshooting snapshot: userData/diagnostics/game-map-<time>.png and .json, shown in the file manager.
  onEvent('layer:snapshot-data', (event, data) => {
    if (!isFromLayer(event.sender) || !diagnostics) return
    const d = (data || {}) as {
      png?: unknown
      info?: unknown
    }
    const png = d.png instanceof Uint8Array && d.png.length < 40e6 ? d.png : null
    const info = JSON.stringify(d.info ?? null, null, 1)
    if (info.length > 200000) return
    try {
      fs.mkdirSync(diagnostics, {
        recursive: true,
      })
      const base = path.join(diagnostics, 'game-map-' + new Date().toISOString().replace(/[:.]/g, '-'))
      fs.writeFileSync(base + '.json', info)
      if (png) fs.writeFileSync(base + '.png', png)
      shell.showItemInFolder(base + (png ? '.png' : '.json'))
    } catch (error) {
      console.warn('Could not save the game map snapshot:', (error as Error).message)
    }
  })

  onEvent('layer:status', (event, next) => {
    if (isFromLayer(event.sender)) report(next)
  })

  // The layer found the map panel in and around the drawn area: the area is fitted to it. Unchanged within 3 px only
  // marks the area as fitted; otherwise the layer is rebuilt exactly over the panel.
  onEvent('layer:panel', (event, panel) => {
    if (!isFromLayer(event.sender) || !area || area.isSnapped) return
    const saved = readArea(file)
    const next = saved && snapArea(saved, panel as Rect)
    // Implausible: the drawn area stays, a later frame may find the panel.
    if (!saved || !next) return
    const isMoved = hasMoved(next.rect, saved.rect)
    const isSaved = saveArea(file, isMoved ? next : {
      ...saved,
      isSnapped: true,
    })
    if (!isSaved) return
    if (isMoved) {
      onNotice(t('notice.fitted', {
        w: next.rect.width,
        h: next.rect.height,
      }))
      open()
    } else {
      area.isSnapped = true
      push(layer, 'layer:snapped')
    }
  })

  // The zone rim is in view, the map's frame is not on the area's edges, and the panel was found elsewhere around it
  // (another UI scale in the game): the area moves to that panel, still fitted. Anything implausible is ignored.
  onEvent('layer:refit', (event, panel) => {
    if (!isFromLayer(event.sender) || !area?.isSnapped) return
    const saved = readArea(file)
    const next = saved && snapArea(saved, panel as Rect)
    if (!saved || !next || !hasMoved(next.rect, saved.rect) || !saveArea(file, next)) return
    onNotice(t('notice.moved', {
      w: next.rect.width,
      h: next.rect.height,
    }))
    open()
  })

  onEvent('layer:click', (event, click) => {
    const c = cleanClick(click)
    if (isFromLayer(event.sender) && isClickable && c) onClick(c)
  })

  // A wheel or a drag over the layer in marker mode: the mouse goes to the game until the layer gives it back, or
  // PASS_MS after the layer last asked. Asking again keeps it there while marker mode lasts, even if the map is lost
  // for a moment while it moves.
  onEvent('layer:pass', (event, isOn) => {
    if (!isFromLayer(event.sender)) return
    if (isOn === true && (isClickable || (isPassing && isMarking))) {
      clearTimeout(passTimer)
      isPassing = true
      passTimer = setTimeout(() => {
        endPass()
        applyLayer()
      }, PASS_MS)
    } else if (isOn === true) push(layer, 'layer:pass', false)
    else endPass()
    applyLayer()
  })

  onEvent('picker:done', (event, rect) => {
    if (!picker || event.sender !== picker.webContents || !pickerDisplay) return
    const next = areaFromSelection(rect as Rect, pickerDisplay)
    if (next && saveArea(file, next)) open()
    picker.close()
  })

  onEvent('picker:cancel', (event) => {
    if (picker && event.sender === picker.webContents) picker.close()
  })

  // A new resolution or a monitor change moves the in-game map: the saved area may no longer apply. Work-area
  // changes (taskbar) fire metrics events too; they leave the layer alone.
  let displayTimer: ReturnType<typeof setTimeout> | undefined
  function refresh() {
    const next = resolveArea(readArea(file), screen.getAllDisplays())
    const isSame = layer && next && area
      && JSON.stringify([next.rect, next.display.bounds])
        === JSON.stringify([area.rect, area.display.bounds])
    if (!isSame) open()
  }
  for (const name of ['display-added', 'display-removed', 'display-metrics-changed'] as const) {
    screen.on(name as 'display-added', () => {
      clearTimeout(displayTimer)
      displayTimer = setTimeout(refresh, 500)
    })
  }

  return {
    start: open,
    pick,
    setMarking,
    status: () => ({
      ...status,
      isMarking,
    }),
    isMarking: () => isMarking,
    select(key) {
      selection = key
      push(layer, 'layer:selection', key)
    },
    settings(next) {
      fps = cleanFps((next as { fps?: unknown } | null)?.fps)
      push(layer, 'layer:settings', {
        fps,
      })
    },
    snapshot() {
      push(layer, 'layer:snapshot')
      return isLive()
    },
    scene(next) {
      scene = next
      push(layer, 'layer:scene', next)
    },
    // The layer (and an open picker) redraw their text in the new language.
    language(next) {
      for (const w of [layer, picker]) push(w, 'app:language-changed', next)
    },
    flush: saveMemory,
  }
}
