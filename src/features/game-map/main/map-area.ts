import fs from 'node:fs'
import path from 'node:path'

import type { Rect } from '@/shared/ipc'

// The screen area of the in-game map panel: chosen once with the area picker, saved in userData/map-area.json.

export const MIN_AREA = 120

export interface SavedArea {
  display: {
    id: string
    bounds: Rect
  }
  rect: Rect
  /** The rectangle was fitted to the in-game map panel found inside the drawn one (snapArea). */
  isSnapped: boolean
}

interface DisplayLike {
  id: number | string
  bounds: Rect
}

export interface ResolvedArea<D extends DisplayLike = DisplayLike> {
  display: D
  rect: Rect
  isSnapped: boolean
}

const isInt = (v: unknown): v is number => Number.isSafeInteger(v)

const isRect = (r: Partial<Rect> | null | undefined): r is Rect => Boolean(r
  && isInt(r.x) && isInt(r.y) && isInt(r.width) && isInt(r.height)
  && r.width > 0 && r.height > 0)

const copyRect = (r: Rect): Rect => ({
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
})

// On disk the file keeps 1.x's field name: snapped.
interface AreaFile {
  display?: {
    id?: unknown
    bounds?: Partial<Rect>
  }
  rect?: Partial<Rect>
  snapped?: unknown
}

export function validArea(area: unknown): SavedArea | null {
  const {
    display, rect, snapped,
  } = (area || {}) as AreaFile
  const hasDisplay = display && typeof display.id === 'string' && display.id.length <= 40 && isRect(display.bounds)
  if (!hasDisplay || !isRect(rect)) return null
  if (rect.width < MIN_AREA || rect.height < MIN_AREA) return null
  const b = display.bounds as Rect
  const isOnDisplay = rect.x >= b.x && rect.y >= b.y && rect.x + rect.width <= b.x + b.width
    && rect.y + rect.height <= b.y + b.height
  if (!isOnDisplay) return null
  return {
    display: {
      id: display.id as string,
      bounds: copyRect(b),
    },
    rect: copyRect(rect),
    isSnapped: snapped === true,
  }
}

// The panel must be nearly square, at least half the area's size, and within the drawn area grown by 10 % on each
// side; anything else is not the panel.
/** The map panel the layer found in and around the saved area → the area fitted to it. */
export function snapArea(
  saved: SavedArea,
  panel: Partial<Rect> | null | undefined,
): SavedArea | null {
  if (![panel?.x, panel?.y, panel?.width, panel?.height].every(Number.isFinite)) return null
  const p = panel as Rect
  const r = saved.rect
  const grow = Math.max(r.width, r.height) * .1
  const rect = {
    x: Math.round(p.x),
    y: Math.round(p.y),
    width: Math.round(p.width),
    height: Math.round(p.height),
  }
  const isSquare = Math.abs(rect.width - rect.height) <= Math.max(4, rect.width * .03)
  if (!isSquare || rect.width < r.width * .5 || rect.height < r.height * .5) return null
  const isNear = rect.x >= r.x - grow && rect.y >= r.y - grow
    && rect.x + rect.width <= r.x + r.width + grow && rect.y + rect.height <= r.y + r.height + grow
  if (!isNear) return null
  return validArea({
    display: saved.display,
    rect,
    snapped: true,
  })
}

export function readArea(file: string): SavedArea | null {
  try {
    return validArea(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/** A saved area only applies to the same monitor at the same position and resolution. */
export function resolveArea<D extends DisplayLike>(
  saved: SavedArea | null,
  displays: D[],
): ResolvedArea<D> | null {
  if (!saved) return null
  const display = displays.find((d) => String(d.id) === saved.display.id)
  const b = display?.bounds
  const s = saved.display.bounds
  if (!display || !b || b.x !== s.x || b.y !== s.y
    || b.width !== s.width || b.height !== s.height) return null
  return {
    display,
    rect: saved.rect,
    isSnapped: saved.isSnapped,
  }
}

/** The picker's rectangle in window coordinates of that display → a saved area, clamped to the display. */
export function areaFromSelection(
  selection: Partial<Rect> | null | undefined,
  display: DisplayLike,
) {
  const b = display.bounds
  const sel = selection as Rect
  if (![sel?.x, sel?.y, sel?.width, sel?.height].every(Number.isFinite)) return null
  const x0 = Math.max(0, Math.round(sel.x))
  const y0 = Math.max(0, Math.round(sel.y))
  const x1 = Math.min(b.width, Math.round(sel.x + sel.width))
  const y1 = Math.min(b.height, Math.round(sel.y + sel.height))
  return validArea({
    display: {
      id: String(display.id),
      bounds: b,
    },
    rect: {
      x: b.x + x0,
      y: b.y + y0,
      width: x1 - x0,
      height: y1 - y0,
    },
  })
}

export function saveArea(file: string, area: SavedArea): boolean {
  try {
    fs.mkdirSync(path.dirname(file), {
      recursive: true,
    })
    const temporary = file + '.tmp'
    const onDisk = {
      display: area.display,
      rect: area.rect,
      snapped: area.isSnapped,
    }
    fs.writeFileSync(temporary, JSON.stringify(onDisk))
    fs.renameSync(temporary, file)
    return true
  } catch (error) {
    console.warn('Could not save the game map area:', (error as Error).message)
    return false
  }
}
