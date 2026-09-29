import { decimalSeparator } from '@/shared/i18n'

/** Game units across every map: X 0…163.84 to the east, Y 163.84…0 from the north. One unit is 100 m. */
export const MAP_EXTENT = 163.84

export const MAP_METRES = 16384

export interface GamePoint {
  x: number
  y: number
}

/** Game units → the overlay map's 1000×1000 SVG space. */
export function coordToMap(p: GamePoint): GamePoint {
  return {
    x: p.x / MAP_EXTENT * 1000,
    y: (1 - p.y / MAP_EXTENT) * 1000,
  }
}

export function mapToCoord(p: GamePoint): GamePoint {
  return {
    x: p.x / 1000 * MAP_EXTENT,
    y: (1 - p.y / 1000) * MAP_EXTENT,
  }
}

/** Compass bearing in degrees, clockwise from north (+Y); null for the same point. */
export function azimuth(from: GamePoint, to: GamePoint): number | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.hypot(dx, dy) < 1e-9) return null
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360
}

/** Compass dial reading: three digits and tenths, 43.24 → "043.2°" ("043,2°" in Russian). */
export function formatAzimuth(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const [whole, tenth] = (Math.round(value * 10) / 10 % 360).toFixed(1).split('.')
  return whole.padStart(3, '0') + decimalSeparator() + tenth + '°'
}

/** Distance in metres between two game points. */
export const range = (a: GamePoint, b: GamePoint) => Math.hypot(b.x - a.x, b.y - a.y) * 100
