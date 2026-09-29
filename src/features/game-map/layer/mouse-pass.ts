import type { MapLayerApi } from '@/shared/ipc'

// The game's map in marker mode: a wheel zooms it and a drag moves it. The app hands the mouse to the game for that;
// the wheel notch or the drag that asked is lost (the game never saw it: nothing is ever sent to the game), the next
// ones reach it. The layer takes the mouse back after a wheel once the cursor moves off to aim, or the map has stood
// still for a moment; after a drag once the cursor and the map have both stood still for a moment; and after
// WHEEL_MAX_MS or DRAG_MAX_MS whatever happens. "The map stood still" is its calibration standing still: the game
// animates icons and units on a map that does not move.

const PASS_MOVE_PX = 10
const PASS_STILL_MS = 600
const PASS_MIN_MS = 800
const WHEEL_MAX_MS = 4000
const DRAG_PX = 12
const DRAG_STILL_MS = 700
const DRAG_MIN_MS = 1500
const DRAG_MAX_MS = 8000

interface Pass {
  kind: 'wheel' | 'drag'
  x: number
  y: number
  at: number
  movedAt: number
  pinged: number
}

interface MousePassOptions {
  api: MapLayerApi
  /** Marker mode is on and the map is calibrated. */
  canPass: () => boolean
  /** When the calibration last moved. */
  movedAt: () => number
  onChange: (isPassing: boolean) => void
}

export function createMousePass({
  api, canPass, movedAt, onChange,
}: MousePassOptions) {
  let pass: Pass | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let press: {
    x: number,
    y: number
  } | null = null
  let isDragged = false

  function end(shouldTell = true) {
    if (!pass) return
    pass = null
    clearInterval(timer)
    onChange(false)
    if (shouldTell) api.pass(false)
  }

  function start(kind: Pass['kind'], e: MouseEvent) {
    if (pass || !canPass()) return
    const now = performance.now()
    pass = {
      kind,
      x: e.clientX,
      y: e.clientY,
      at: now,
      movedAt: now,
      pinged: now,
    }
    onChange(true)
    api.pass(true)
    timer = setInterval(() => {
      const p = pass
      if (!p) return
      const t = performance.now()
      const long = t - p.at
      const still = t - Math.max(p.at, movedAt())
      const isOver = p.kind === 'wheel'
        ? (long >= PASS_MIN_MS && still >= PASS_STILL_MS) || long >= WHEEL_MAX_MS
        : (long >= DRAG_MIN_MS && t - p.movedAt >= DRAG_STILL_MS && still >= DRAG_STILL_MS)
          || long >= DRAG_MAX_MS
      if (isOver) {
        end()
        return
      }
      // Still needed: the app gives the mouse back by itself 3 s after the last word from here.
      if (t - p.pinged >= 1000) {
        p.pinged = t
        api.pass(true)
      }
    }, 50)
  }

  addEventListener('wheel', (e) => start('wheel', e), {
    passive: true,
  })
  addEventListener('mousedown', (e) => {
    press = canPass() && !pass
      ? {
        x: e.clientX,
        y: e.clientY,
      }
      : null
    isDragged = false
  })
  addEventListener('mouseup', () => {
    press = null
  })
  // Moves reach the page while the mouse is with the game too (forwarded by the app).
  addEventListener('mousemove', (e) => {
    const isDrag = press && !pass && e.buttons
      && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= DRAG_PX
    if (isDrag) {
      isDragged = true
      press = null
      start('drag', e)
    }
    if (!pass) return
    if (pass.kind === 'wheel' && Math.hypot(e.clientX - pass.x, e.clientY - pass.y) >= PASS_MOVE_PX) end()
    else pass.movedAt = performance.now()
  })
  api.onPass((isOn) => {
    if (!isOn) end(false)
  })

  return {
    /** Marker mode went off: the game has the mouse anyway. */
    stop() {
      end(false)
      press = null
    },
    /** The click that ends a drag is not a click. */
    takeDrag() {
      const was = isDragged
      isDragged = false
      return was
    },
  }
}
