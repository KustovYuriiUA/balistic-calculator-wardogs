import type { Zone } from '@/data/landmarks'
import { MAP_EXTENT } from '@/shared/geometry'

import type { Circle, Fix, Point, RgbaImage } from './types'

/** Screen ↔ game units: the rim is the zone's radius around its known centre (map north is up). */
export interface RingTransform {
  cx: number
  cy: number
  /** Pixels per game unit (100 m). */
  scale: number
  x: number
  y: number
}

export function ringTransform(circle: Circle, zone: Zone): RingTransform {
  return {
    cx: circle.cx,
    cy: circle.cy,
    scale: circle.r / (zone.radiusM / 100),
    x: zone.pos[0] * MAP_EXTENT,
    y: (1 - zone.pos[1]) * MAP_EXTENT,
  }
}

export function pixelToWorld(t: RingTransform, px: number, py: number): Point {
  return {
    x: t.x + (px - t.cx) / t.scale,
    y: t.y - (py - t.cy) / t.scale,
  }
}

export function worldToPixel(t: RingTransform, x: number, y: number): Point {
  return {
    x: t.cx + (x - t.x) * t.scale,
    y: t.cy - (y - t.y) * t.scale,
  }
}

export interface DiscSample {
  size: number
  lum: Float32Array
  valid: Uint8Array
  count: number
}

/** Luminance of the circle's interior on a size×size grid over its bounding square (the same square as a zone
 * patch). Cells off the frame, near the rim or under saturated icons are left out. */
export function discSample(img: RgbaImage, circle: Circle, size: number): DiscSample {
  const {
    width: w, height: h, data: d,
  } = img
  const cells = size * size
  const lum = new Float32Array(cells)
  const sat = new Float32Array(cells)
  const valid = new Uint8Array(cells)
  const cell = 2 * circle.r / size
  const k = Math.max(1, Math.min(6, Math.round(cell)))
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const a = (i + .5) / size * 2 - 1
      const b = (j + .5) / size * 2 - 1
      if (a * a + b * b > .81) continue
      const x0 = circle.cx - circle.r + i * cell
      const y0 = circle.cy - circle.r + j * cell
      let L = 0
      let S = 0
      let isInside = true
      for (let q = 0; q < k && isInside; q++) {
        for (let p = 0; p < k; p++) {
          const x = Math.floor(x0 + (p + .5) * cell / k)
          const y = Math.floor(y0 + (q + .5) * cell / k)
          if (x < 0 || y < 0 || x >= w || y >= h) {
            isInside = false
            break
          }
          const o = (y * w + x) * 4
          const r = d[o]
          const g = d[o + 1]
          const bl = d[o + 2]
          L += .299 * r + .587 * g + .114 * bl
          S += Math.max(r, g, bl) - Math.min(r, g, bl)
        }
      }
      if (isInside) {
        const c = j * size + i
        lum[c] = L / (k * k)
        sat[c] = S / (k * k)
        valid[c] = 1
      }
    }
  }
  const s: number[] = []
  for (let c = 0; c < cells; c++) if (valid[c]) s.push(sat[c])
  s.sort((x, y) => x - y)
  const limit = (s[s.length >> 1] ?? 0) + 25
  let count = 0
  for (let c = 0; c < cells; c++) {
    if (valid[c] && sat[c] > limit) valid[c] = 0
    count += valid[c]
  }
  return {
    size,
    lum,
    valid,
    count,
  }
}

/** Normalised cross-correlation over the valid cells: immune to the green tint and the map's brightness. */
export function correlate(sample: DiscSample, patch: Uint8Array, minCells = 200): number | null {
  let n = 0
  let ma = 0
  let mb = 0
  for (let c = 0; c < patch.length; c++) {
    if (sample.valid[c]) {
      n++
      ma += sample.lum[c]
      mb += patch[c]
    }
  }
  if (n < minCells) return null
  ma /= n
  mb /= n
  let ab = 0
  let aa = 0
  let bb = 0
  for (let c = 0; c < patch.length; c++) {
    if (sample.valid[c]) {
      const x = sample.lum[c] - ma
      const y = patch[c] - mb
      ab += x * y
      aa += x * x
      bb += y * y
    }
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : null
}

export interface ZoneMatch {
  key: string
  score: number
  margin: number
  /** A clear score and a clear lead over every other zone. */
  isConfident: boolean
}

export function recogniseZone(
  sample: DiscSample,
  patches: Record<string, Uint8Array>,
): ZoneMatch | null {
  let best: {
    key: string,
    score: number
  } | null = null
  let second = -1
  for (const [key, patch] of Object.entries(patches)) {
    const score = correlate(sample, patch)
    if (score === null) continue
    if (!best || score > best.score) {
      if (best) second = best.score
      best = {
        key,
        score,
      }
    } else if (score > second) second = score
  }
  if (!best) return null
  return {
    ...best,
    margin: best.score - second,
    isConfident: best.score >= .4 && best.score - second >= .15,
  }
}

// Two independent findings agreeing, for a rim the patches cannot vouch for (small on a zoomed-out map, or under
// icons): a zone of the map at the place where the terrain fix puts the rim (within 60 m or 4 frame px), and of that
// size (within 8 %).
/** zones: of the map the fix is on; fix: of the same frame. */
export function zoneAtPlace(zones: Zone[], fix: Fix, ring: Circle): Zone | null {
  const x = fix.x0 + ring.cx * fix.s / 100
  const y = fix.y0 - ring.cy * fix.s / 100
  const radius = ring.r * fix.s
  let best: {
    zone: Zone,
    d: number
  } | null = null
  for (const zone of zones) {
    const d = Math.hypot(x - zone.pos[0] * MAP_EXTENT, y - (1 - zone.pos[1]) * MAP_EXTENT) * 100
    const isHere = d <= Math.max(60, 4 * fix.s)
      && Math.abs(radius - zone.radiusM) <= zone.radiusM * .08
    if (isHere && (!best || d < best.d)) {
      best = {
        zone,
        d,
      }
    }
  }
  return best?.zone ?? null
}

export function decodePatch(text: string): Uint8Array {
  const s = atob(text)
  const a = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i)
  return a
}
