import fs from 'node:fs'
import path from 'node:path'

import type { Rect } from '@/shared/ipc'

export interface SavedPosition {
  x: number
  y: number
  /** The window was shrunk by "Compact": the next start opens at the compact size. */
  isCompact: boolean
}

// On disk the file keeps 1.x's field name: compact.
export function readPosition(file: string): SavedPosition | null {
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y)) {
      return {
        x: p.x,
        y: p.y,
        isCompact: p.compact === true,
      }
    }
  } catch {
    // No file or not ours: the window opens centred.
  }
  return null
}

/** On the monitor it was left on (negative coordinates included), else centred on the fallback work area. */
export function resolvePosition(
  saved: SavedPosition | null,
  width: number,
  height: number,
  areas: Rect[],
  fallback: Rect,
) {
  const centred = (area: Rect) => ({
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
  })
  if (!saved) return centred(fallback)
  const area = areas.find((r) => saved.x + Math.min(width, 100) > r.x && saved.x < r.x + r.width
    && saved.y >= r.y && saved.y < r.y + r.height - 40)
  if (!area) return centred(fallback)
  return {
    x: Math.max(area.x, Math.min(saved.x, area.x + Math.max(0, area.width - width))),
    y: Math.max(area.y, Math.min(saved.y, area.y + Math.max(0, area.height - height))),
  }
}

export function savePosition(file: string, position: SavedPosition) {
  try {
    fs.mkdirSync(path.dirname(file), {
      recursive: true,
    })
    const temporary = file + '.tmp'
    const onDisk = position.isCompact
      ? {
        x: position.x,
        y: position.y,
        compact: true,
      }
      : {
        x: position.x,
        y: position.y,
      }
    fs.writeFileSync(temporary, JSON.stringify(onDisk))
    fs.renameSync(temporary, file)
  } catch (error) {
    console.warn('Could not save the window position:', (error as Error).message)
  }
}
