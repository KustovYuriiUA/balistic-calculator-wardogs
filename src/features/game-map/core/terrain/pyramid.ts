import { MAP_METRES } from '@/shared/geometry'

import { fft2 } from './fft'
import { highPass, integralOf, type Integral } from './luma'
import type { LumaImage } from '../types'

/** High-pass radius in level pixels, the same on the map and the capture. */
export const FILTER = 3

/** One level of the offline map: r metres per pixel, filtered image, integrals for window sums, FFT for the wide
 * search (computed on first use). */
export interface Level {
  r: number
  img: LumaImage
  I: Integral
  I2: Integral
  spectrum: {
    re: Float64Array
    im: Float64Array
  } | null
}

function makeLevel(img: LumaImage, r: number): Level {
  const f = highPass(img, FILTER)
  return {
    r,
    img: f,
    I: integralOf(f),
    I2: integralOf(f, true),
    spectrum: null,
  }
}

/** Offline map luminance at 8 m/px (2048²) → levels 8, 16, 32, 64, 128 m/px. */
export function mapPyramid(luma: LumaImage): Level[] {
  const levels: Level[] = []
  let img = luma
  let r = MAP_METRES / luma.width
  for (;;) {
    levels.push(makeLevel(img, r))
    if (img.width <= 128) break
    const w = img.width >> 1
    const h = img.height >> 1
    const d = new Float32Array(w * h)
    const s = img.data
    const W = img.width
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        d[y * w + x] = (s[2 * y * W + 2 * x] + s[2 * y * W + 2 * x + 1] + s[(2 * y + 1) * W + 2 * x]
          + s[(2 * y + 1) * W + 2 * x + 1]) / 4
      }
    }
    img = {
      width: w,
      height: h,
      data: d,
    }
    r *= 2
  }
  return levels
}

export function spectrumOf(level: Level) {
  if (level.spectrum) return level.spectrum
  const n = level.img.width
  const re = Float64Array.from(level.img.data)
  const im = new Float64Array(n * n)
  fft2(re, im, n, false)
  level.spectrum = {
    re,
    im,
  }
  return level.spectrum
}

/** Variance sum of the map window for a template of tw×th at level pixel (u, v). */
export function windowStats(level: Level, u: number, v: number, tw: number, th: number): number {
  const W = level.img.width + 1
  const box = (s: Float64Array) =>
    s[(v + th) * W + u + tw] - s[v * W + u + tw] - s[(v + th) * W + u] + s[v * W + u]
  const n = tw * th
  const s1 = box(level.I.sum)
  const s2 = box(level.I2.sum)
  return s2 - s1 * s1 / n
}

export interface Template extends LumaImage {
  energy: number
}

export function zeroMean(t: LumaImage): Template {
  let m = 0
  for (const v of t.data) m += v
  m /= t.data.length
  const d = Float32Array.from(t.data, (v) => v - m)
  let e = 0
  for (const v of d) e += v * v
  return {
    width: t.width,
    height: t.height,
    data: d,
    energy: e,
  }
}
