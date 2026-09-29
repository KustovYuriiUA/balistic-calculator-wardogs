import path from 'node:path'

import { BrowserWindow, screen, type NativeImage } from 'electron'

import { t } from '@/shared/i18n'
import type { DragKind, OverlayMode, Rect } from '@/shared/ipc'

import { lockDown, onEvent, push } from './ipc'
import { readPosition, resolvePosition, savePosition } from './window-position'

// The overlay behaves as an overlay: it never takes the keyboard from the game by itself (a game in the background
// mutes its sound, and its keys, M included, stop working). Its mode follows from three things:
//   view     — click-through, dimmed: the game map is closed and marker mode is off;
//   edit     — clickable without the keyboard: marker mode is on (Insert), or the game map is open;
//   keyboard — focused, for typing: a click into a text field (or the tray); a click on the game ends it.

const DRAG_KINDS: DragKind[] = ['move', 'w', 'e', 's', 'sw', 'se']
const ZOOMS = [.9, 1, 1.15, 1.3]
const COMPACT = {
  width: 420,
  height: 780,
}

export interface OverlayWindowOptions {
  userData: string
  icon: NativeImage
  /** Whether the window should be clickable without the keyboard (marker mode, or the game map open). */
  isEditWanted: () => boolean
}

export interface OverlayWindow {
  window: BrowserWindow
  reveal: () => void
  setKeyboard: (isOn: boolean) => void
  applyMode: () => void
  mode: () => OverlayMode
  persistPosition: () => void
}

export function createOverlayWindow({
  userData, icon, isEditWanted,
}: OverlayWindowOptions): OverlayWindow {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const positionFile = path.join(userData, 'window-position.json')
  const saved = readPosition(positionFile)
  const full = {
    width: Math.min(1080, area.width),
    height: Math.min(850, area.height),
  }
  // "Compact" shrinks the window to the compact layout; fullSize is what "Full view" restores (null: not compact).
  let fullSize: {
    width: number,
    height: number
  } | null = saved?.isCompact ? full : null
  const size = fullSize
    ? {
      width: Math.min(COMPACT.width, area.width),
      height: Math.min(COMPACT.height, area.height),
    }
    : full
  const position = resolvePosition(
    saved,
    size.width,
    size.height,
    screen.getAllDisplays().map((d) => d.workArea),
    area,
  )
  const window = new BrowserWindow({
    title: t('app.name'),
    ...size,
    ...position,
    minWidth: Math.min(360, area.width),
    minHeight: Math.min(200, area.height),
    frame: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#08090a',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  lockDown(window)
  const isMine = (sender: Electron.WebContents) =>
    !window.isDestroyed() && sender === window.webContents

  let isKeyboard = false
  let mode: OverlayMode | null = null
  // A BrowserWindow is created focusable.
  let isFocusable = true

  function reveal() {
    if (window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    const b = window.getBounds()
    const isOnScreen = screen.getAllDisplays().some(
      ({ workArea: r }) => b.x + 100 > r.x && b.x < r.x + r.width
        && b.y + 40 > r.y && b.y < r.y + r.height,
    )
    if (!isOnScreen) window.center()
    window.setAlwaysOnTop(true, 'screen-saver')
    if (!window.isVisible()) window.showInactive()
  }

  function applyMode() {
    if (window.isDestroyed()) return
    const next: OverlayMode = isKeyboard ? 'keyboard' : isEditWanted() ? 'edit' : 'view'
    if (next === mode) return
    mode = next
    window.setIgnoreMouseEvents(mode === 'view', {
      forward: true,
    })
    // On Windows setFocusable also deactivates the window, which hands the foreground to the next window below it,
    // and right after a hotkey the app is allowed to. Called on every mode change, Insert took the keyboard from the
    // game (seen with keyboard-check's stand-in). So only when focusability really changes.
    const wantsFocus = mode === 'keyboard'
    if (wantsFocus !== isFocusable) {
      isFocusable = wantsFocus
      window.setFocusable(wantsFocus)
    }
    window.setOpacity(mode === 'view' ? .85 : 1)
    if (mode === 'keyboard') {
      reveal()
      window.show()
      window.focus()
    }
    push(window, 'overlay:mode', mode)
  }

  function setKeyboard(isOn: boolean) {
    isKeyboard = isOn
    applyMode()
  }

  let positionTimer: ReturnType<typeof setTimeout> | undefined
  function persistPosition() {
    clearTimeout(positionTimer)
    if (window.isDestroyed() || window.isMinimized()) return
    const { x, y } = window.getNormalBounds()
    savePosition(positionFile, {
      x,
      y,
      isCompact: Boolean(fullSize),
    })
  }
  window.on('move', () => {
    clearTimeout(positionTimer)
    positionTimer = setTimeout(persistPosition, 250)
  })
  window.on('hide', persistPosition)
  window.on('close', persistPosition)
  window.on('blur', () => {
    if (isKeyboard) setKeyboard(false)
  })

  // zoom: the font size chosen in the menu (page zoom); the compact window widens with it. contentHeight: the compact
  // window's current maximum, from the content (overlay:fit-height).
  let zoom = 1
  let contentHeight = 0

  /** x of a window of width w that keeps to the nearer screen edge: an overlay parked on the right stays there. */
  function keepSide(b: Rect, work: Rect, w: number) {
    const isRight = b.x + b.width / 2 > work.x + work.width / 2
    return Math.max(work.x, Math.min(isRight ? b.x + b.width - w : b.x, work.x + work.width - w))
  }

  function setCompact(isCompact: boolean) {
    if (window.isDestroyed() || isCompact === Boolean(fullSize)) return
    const b = window.getNormalBounds()
    const work = screen.getDisplayMatching(b).workArea
    if (window.isMaximized()) window.unmaximize()
    if (isCompact) {
      fullSize = {
        width: b.width,
        height: b.height,
      }
    }
    const next = isCompact
      ? {
        width: Math.round(COMPACT.width * zoom),
        height: COMPACT.height,
      }
      : fullSize!
    const w = Math.min(next.width, work.width)
    const h = Math.min(next.height, work.height)
    // The content limit belongs to the compact window only: lifted before the full size comes back.
    if (!isCompact) {
      fullSize = null
      window.setMaximumSize(0, 0)
    }
    contentHeight = 0
    window.setBounds({
      x: keepSide(b, work, w),
      y: Math.max(work.y, Math.min(b.y, work.y + work.height - h)),
      width: w,
      height: h,
    })
    persistPosition()
  }

  onEvent('overlay:hide', (event) => {
    if (isMine(event.sender)) window.hide()
  })
  onEvent('overlay:edit', (event) => {
    if (isMine(event.sender)) setKeyboard(true)
  })
  // A click into a text field: the window takes the keyboard (the game goes to the background until clicked).
  onEvent('overlay:keyboard', (event) => {
    if (isMine(event.sender)) setKeyboard(true)
  })
  onEvent('overlay:compact', (event, isCompact) => {
    if (isMine(event.sender)) setCompact(isCompact === true)
  })

  // The page drags the window (title bar) or one of its edges; the window follows the cursor within its minimum and
  // maximum size. Windows' own drag of the title bar would activate another window (the desktop) for this one, which
  // cannot take focus, and its own frame does nothing then.
  let dragging: {
    kind: DragKind,
    from: Electron.Point,
    bounds: Rect
  } | null = null
  onEvent('overlay:drag', (event, kind, phase) => {
    if (!isMine(event.sender) || !DRAG_KINDS.includes(kind as DragKind)) return
    const p = screen.getCursorScreenPoint()
    if (phase === 'start') {
      dragging = {
        kind: kind as DragKind,
        from: p,
        bounds: window.getBounds(),
      }
      return
    }
    if (!dragging || dragging.kind !== kind) return
    if (phase === 'end') {
      dragging = null
      persistPosition()
      return
    }
    const dx = p.x - dragging.from.x
    const dy = p.y - dragging.from.y
    const b = dragging.bounds
    if (kind === 'move') {
      window.setPosition(b.x + dx, b.y + dy)
      return
    }
    const [minW, minH] = window.getMinimumSize()
    const [maxW, maxH] = window.getMaximumSize()
    const fit = (v: number, lo: number, hi: number) =>
      Math.round(Math.max(lo, hi > 0 ? Math.min(hi, v) : v))
    const isWest = (kind as string).endsWith('w')
    const width = kind === 's' ? b.width : fit(isWest ? b.width - dx : b.width + dx, minW, maxW)
    const height = kind === 'w' || kind === 'e' ? b.height : fit(b.height + dy, minH, maxH)
    window.setBounds({
      x: isWest ? b.x + b.width - width : b.x,
      y: b.y,
      width,
      height,
    })
  })

  // Compact window: the content height (CSS px × zoom, down to the bottom of the screen) is the window's maximum
  // height, so it cannot be dragged into empty space. Dragged shorter, it stays so (the list scrolls). It is resized
  // only when the content changes: grown if it was fitted, shrunk if it is now taller than the content.
  onEvent('overlay:fit-height', (event, height) => {
    const isApplicable = isMine(event.sender)
      && fullSize
      && Number.isFinite(height)
      && !window.isMaximized()
    if (!isApplicable) return
    const b = window.getBounds()
    const work = screen.getDisplayMatching(b).workArea
    const h = Math.round(
      Math.max(200, Math.min(work.y + work.height - b.y, (height as number) * zoom)),
    )
    if (Math.abs(h - contentHeight) <= 2) return
    const isFitted = !contentHeight || Math.abs(b.height - contentHeight) <= 4
    contentHeight = h
    window.setMaximumSize(0, h)
    if (isFitted || b.height > h) {
      window.setBounds({
        ...b,
        height: h,
      })
    }
  })

  onEvent('overlay:zoom', (event, factor) => {
    if (!isMine(event.sender) || !ZOOMS.includes(factor as number)) return
    zoom = factor as number
    window.webContents.setZoomFactor(zoom)
    if (!fullSize) return
    const b = window.getBounds()
    const work = screen.getDisplayMatching(b).workArea
    const w = Math.min(work.width, Math.round(COMPACT.width * zoom))
    window.setBounds({
      ...b,
      x: keepSide(b, work, w),
      width: w,
    })
  })

  return {
    window,
    reveal,
    setKeyboard,
    applyMode,
    mode: () => mode ?? 'view',
    persistPosition,
  }
}
