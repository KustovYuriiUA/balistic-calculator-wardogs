import { fft2 } from './fft'
import {
  spectrumOf, windowStats, zeroMean, type Level, type Template,
} from './pyramid'
import type { LumaImage } from '../types'

export interface Peak {
  score: number
  u: number
  v: number
}

/** NCC peaks from a raw correlation (not yet divided by n²): the best few, at least half a template apart. */
function peaksOf(level: Level, corr: Float64Array, t: Template, count: number): Peak[] {
  const n = level.img.width
  const scale = 1 / (n * n)
  const best: Peak[] = []
  for (let v = 0; v <= n - t.height; v++) {
    for (let u = 0; u <= n - t.width; u++) {
      const w = windowStats(level, u, v, t.width, t.height)
      if (w <= 1e-6) continue
      const score = corr[v * n + u] * scale / Math.sqrt(w * t.energy)
      if (best.length === count && score <= best[count - 1].score) continue
      const near = best.findIndex(
        (p) => Math.abs(p.u - u) < t.width / 2 && Math.abs(p.v - v) < t.height / 2,
      )
      if (near >= 0) {
        if (best[near].score >= score) continue
        best.splice(near, 1)
      }
      best.push({
        score,
        u,
        v,
      })
      best.sort((x, y) => y.score - x.score)
      if (best.length > count) best.pop()
    }
  }
  return best
}

/** NCC of the template everywhere on the level (FFT), best peaks first. Valid positions only: no wrap-around. */
export function searchWide(level: Level, tpl: LumaImage, count = 3): Peak[] {
  const n = level.img.width
  const t = zeroMean(tpl)
  if (t.width > n || t.height > n || t.energy <= 0) return []
  const S = spectrumOf(level)
  const re = new Float64Array(n * n)
  const im = new Float64Array(n * n)
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) re[y * n + x] = t.data[y * t.width + x]
  }
  fft2(re, im, n, false)
  for (let k = 0; k < n * n; k++) {
    const ar = S.re[k]
    const ai = S.im[k]
    const br = re[k]
    const bi = -im[k]
    re[k] = ar * br - ai * bi
    im[k] = ar * bi + ai * br
  }
  fft2(re, im, n, true)
  return peaksOf(level, re, t, count)
}

// Both templates are real: packed as re + i·im into one forward FFT, their spectra split by symmetry, and both
// correlations come back from one inverse FFT (real and imaginary part). About half the cost of two searches.
export function searchWidePair(
  level: Level,
  tplA: LumaImage,
  tplB: LumaImage,
  count = 2,
): [Peak[], Peak[]] {
  const n = level.img.width
  const a = zeroMean(tplA)
  const b = zeroMean(tplB)
  const fits = (t: Template) => t.width <= n && t.height <= n && t.energy > 0
  if (!fits(a) || !fits(b)) {
    return [
      fits(a) ? searchWide(level, tplA, count) : [],
      fits(b) ? searchWide(level, tplB, count) : [],
    ]
  }
  const S = spectrumOf(level)
  const re = new Float64Array(n * n)
  const im = new Float64Array(n * n)
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) re[y * n + x] = a.data[y * a.width + x]
  }
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) im[y * n + x] = b.data[y * b.width + x]
  }
  fft2(re, im, n, false)
  const pr = new Float64Array(n * n)
  const pi = new Float64Array(n * n)
  for (let ky = 0; ky < n; ky++) {
    for (let kx = 0; kx < n; kx++) {
      const k = ky * n + kx
      const m = ((n - ky) % n) * n + (n - kx) % n
      const zr = re[k]
      const zi = im[k]
      const wr = re[m]
      const wi = -im[m]
      const ar = (zr + wr) / 2
      const ai = (zi + wi) / 2
      const br = (zi - wi) / 2
      const bi = -(zr - wr) / 2
      const sr = S.re[k]
      const si = S.im[k]
      // S·conj(A) and S·conj(B)
      const c1r = sr * ar + si * ai
      const c1i = si * ar - sr * ai
      const c2r = sr * br + si * bi
      const c2i = si * br - sr * bi
      pr[k] = c1r - c2i
      pi[k] = c1i + c2r
    }
  }
  fft2(pr, pi, n, true)
  return [peaksOf(level, pr, a, count), peaksOf(level, pi, b, count)]
}

/** Direct NCC at one integer position; −1 off the level or on a flat window. */
export function nccAt(level: Level, t: Template, u: number, v: number): number {
  const n = level.img.width
  if (u < 0 || v < 0 || u + t.width > n || v + t.height > n) return -1
  const w = windowStats(level, u, v, t.width, t.height)
  if (w <= 1e-6) return -1
  let dot = 0
  const d = level.img.data
  for (let y = 0; y < t.height; y++) {
    const row = (v + y) * n + u
    const tr = y * t.width
    for (let x = 0; x < t.width; x++) dot += d[row + x] * t.data[tr + x]
  }
  return dot / Math.sqrt(w * t.energy)
}
