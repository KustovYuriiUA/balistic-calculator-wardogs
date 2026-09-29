import { MAP_EXTENT } from '@/shared/geometry'

import {
  integralOf, lumaOf, resampleBox, type Integral, highPass,
} from './luma'
import { FILTER, zeroMean, type Level, type Template } from './pyramid'
import { nccAt, searchWide, searchWidePair } from './search'
import type { Fix, LumaImage, Point, RgbaImage } from '../types'

/** A capture ready for every search: its luminance integral. */
export interface Capture {
  width: number
  height: number
  I: Integral
}

export interface ScoredFix extends Fix {
  score: number
}

export interface AcquiredFix extends ScoredFix {
  lead: number
  isConfident: boolean
}

export const fixToWorld = (fix: Fix, a: number, b: number): Point => ({
  x: fix.x0 + a * fix.s / 100,
  y: fix.y0 - b * fix.s / 100,
})

export const worldToFix = (fix: Fix, x: number, y: number): Point => ({
  x: (x - fix.x0) * 100 / fix.s,
  y: (fix.y0 - y) * 100 / fix.s,
})

/** A frame the layer read: its luma straight from the Y plane (RGB copies fall back to the RGBA data). */
export type CaptureSource = RgbaImage | {
  luma: LumaImage
}

export function captureOf(img: CaptureSource): Capture {
  const l = 'luma' in img ? img.luma : lumaOf(img)
  return {
    width: l.width,
    height: l.height,
    I: integralOf(l),
  }
}

// Templates skip a margin of the capture on every side: a loosely drawn area has 3D world and grid labels there,
// whose contrast would drown the terrain. 10 % covers the usual slack and costs a tight area little.
const INSET = .1

interface CaptureTemplate {
  tpl: Template
  x0: number
  y0: number
}

/** The capture as a template for level r at scale s (metres per capture pixel), covering the capture's centre;
 * shrunk when it would be larger than max. */
function captureTemplate(cap: Capture, r: number, s: number, max = Infinity): CaptureTemplate {
  const iw = cap.width * (1 - 2 * INSET)
  const ih = cap.height * (1 - 2 * INSET)
  const k = Math.min(1, max / Math.max(iw, ih) * r / s)
  const w = Math.max(4, Math.floor(iw * s / r * k))
  const h = Math.max(4, Math.floor(ih * s / r * k))
  const cw = w * r / s
  const ch = h * r / s
  const x0 = (cap.width - cw) / 2
  const y0 = (cap.height - ch) / 2
  return {
    tpl: zeroMean(highPass(resampleBox(cap.I, x0, y0, x0 + cw, y0 + ch, w, h), FILTER)),
    x0,
    y0,
  }
}

interface Offset {
  x0: number
  y0: number
}

/** Level pixel of the template corner → fix. */
const fixFrom = (level: Level, u: number, v: number, s: number, off: Offset): Fix => ({
  x0: u * level.r / 100 - off.x0 * s / 100,
  y0: MAP_EXTENT - v * level.r / 100 + off.y0 * s / 100,
  s,
})

/** Fix → level pixel of the template corner. */
const cornerOf = (level: Level, fix: Fix, off: Offset) => ({
  u: (fix.x0 + off.x0 * fix.s / 100) * 100 / level.r,
  v: (MAP_EXTENT - fix.y0 + off.y0 * fix.s / 100) * 100 / level.r,
})

/** Parabola through three scores: sub-pixel offset of the peak in −0.5…0.5. */
function vertex(a: number, b: number, c: number): number {
  const d = a - 2 * b + c
  return d < 0 ? Math.max(-.5, Math.min(.5, (a - c) / (2 * d))) : 0
}

/** The fix zoomed by f about the capture's centre, as the in-game map zooms. */
function zoomFix(fix: Fix, cap: Capture, f: number): Fix {
  const c = fixToWorld(fix, cap.width / 2, cap.height / 2)
  const s = fix.s * f
  return {
    x0: c.x - cap.width / 2 * s / 100,
    y0: c.y + cap.height / 2 * s / 100,
    s,
  }
}

interface RefineOptions {
  radius?: number
  scales?: number[]
  max?: number
}

interface Candidate {
  score: number
  u: number
  v: number
  s: number
  tpl: Template
  off: Offset
}

/** Best fix near a guess on one level: integer search ±radius over a few scale factors (ascending), then sub-pixel
 * position and a sub-step scale from parabolas through the neighbouring scores. */
function refineOn(
  level: Level,
  cap: Capture,
  fix: Fix,
  {
    radius = 3, scales = [.97, .985, 1, 1.015, 1.03], max = 128,
  }: RefineOptions = {},
): ScoredFix | null {
  let best: Candidate | null = null
  let k = -1
  const peak: number[] = []
  scales.forEach((f, i) => {
    const zoomed = zoomFix(fix, cap, f)
    const s = zoomed.s
    const {
      tpl, x0, y0,
    } = captureTemplate(cap, level.r, s, max)
    const off = {
      x0,
      y0,
    }
    const c = cornerOf(level, zoomed, off)
    const cu = Math.round(c.u)
    const cv = Math.round(c.v)
    peak[i] = -1
    for (let dv = -radius; dv <= radius; dv++) {
      for (let du = -radius; du <= radius; du++) {
        const score = nccAt(level, tpl, cu + du, cv + dv)
        if (score > peak[i]) peak[i] = score
        if (!best || score > best.score) {
          best = {
            score,
            u: cu + du,
            v: cv + dv,
            s,
            tpl,
            off,
          }
          k = i
        }
      }
    }
  })
  const found = best as Candidate | null
  if (!found || found.score <= -1) return null
  const {
    u, v, tpl, off,
  } = found
  const at = (a: number, b: number) => nccAt(level, tpl, a, b)
  const fu = vertex(at(u - 1, v), found.score, at(u + 1, v))
  const fv = vertex(at(u, v - 1), found.score, at(u, v + 1))
  const d = k > 0 && k < scales.length - 1 ? vertex(peak[k - 1], peak[k], peak[k + 1]) : 0
  const zoom = d < 0 ? (scales[k - 1] / scales[k]) ** -d : (scales[k + 1] / scales[k]) ** d
  return {
    ...zoomFix(fixFrom(level, u + fu, v + fv, found.s, off), cap, zoom),
    score: found.score,
  }
}

/** The level whose template size comes closest to max without exceeding it. */
function levelFor(levels: Level[], cap: Capture, s: number, max: number): Level {
  const fitting = levels.find(
    (l) => Math.max(cap.width, cap.height) * (1 - 2 * INSET) * s / l.r <= max,
  )
  return fitting || levels[levels.length - 1]
}

interface TrackOptions {
  minScore?: number
  /** The two coarser levels only: about a quarter of the time and a few metres less precise, for a map in motion. */
  isQuick?: boolean
}

/** Refines the previous fix on a coarse and then finer levels. null when the map moved too far or closed. */
export function trackFix(
  levels: Level[],
  cap: Capture,
  fix: Fix,
  { minScore = .3, isQuick = false }: TrackOptions = {},
) {
  let f: ScoredFix | Fix = fix
  const passes = isQuick ? [[48, 3], [110, 2]] : [[48, 3], [110, 2], [200, 2]]
  for (const [max, radius] of passes) {
    const r = refineOn(levelFor(levels, cap, f.s, max), cap, f, {
      radius,
      max,
    })
    if (!r) return null
    f = r
  }
  const scored = f as ScoredFix
  return scored.score >= minScore ? scored : null
}

/** After a fast zoom or pan: a coarse search ±10 px over scales from half to double, then the usual refinement. */
export function recoverFix(levels: Level[], cap: Capture, fix: Fix, { minScore = .3 } = {}) {
  const scales: number[] = []
  for (let f = .5; f <= 2.01; f *= 1.1) scales.push(f)
  const coarse = refineOn(levelFor(levels, cap, fix.s, 40), cap, fix, {
    radius: 10,
    scales,
    max: 40,
  })
  return coarse ? trackFix(levels, cap, coarse, {
    minScore,
  }) : null
}

interface AcquireOptions {
  minS?: number
  maxS?: number
  step?: number
  wideMax?: number
  keep?: number
  minScore?: number
  minLead?: number
}

interface WideJob {
  s: number
  level: Level
  tpl: Template
  off: Offset
}

// Wide FFT search over scales (metres per capture pixel; the in-game map's zoom range lies well inside the
// default), then the best candidates refined. It yields its progress (0…1) after every scale or pair of scales, so
// a search can be spread over an event loop, reported and stopped. minLead: the 3D world scores as high as a map
// (0.45 against 0.53) but never with a lead, many places fit it about equally (lead < 0.06); a real map leads by
// 0.4 or more.
export function* acquireSteps(
  levels: Level[],
  cap: Capture,
  {
    minS = .7, maxS = 19, step = 1.08, wideMax = 80, keep = 6, minScore = .3, minLead = .2,
  }: AcquireOptions = {},
): Generator<number, AcquiredFix | null> {
  // The wide search stays on levels of 512² and coarser: an FFT of the 2048² level costs about a second.
  const wide = levels.filter((l) => l.img.width <= 512)
  const candidates: ScoredFix[] = []
  const jobs: WideJob[] = []
  for (let s = minS; s <= maxS; s *= step) {
    const level = levelFor(wide, cap, s, wideMax)
    const {
      tpl, x0, y0,
    } = captureTemplate(cap, level.r, s, wideMax)
    if (tpl.width >= 16 && tpl.height >= 16) {
      jobs.push({
        s,
        level,
        tpl,
        off: {
          x0,
          y0,
        },
      })
    }
  }
  // Neighbouring scales on the same level share their FFTs.
  for (let i = 0; i < jobs.length;) {
    const a = jobs[i]
    const b = jobs[i + 1]?.level === a.level ? jobs[i + 1] : null
    const found = b ? searchWidePair(a.level, a.tpl, b.tpl, 2) : [searchWide(a.level, a.tpl, 2)]
    ;[a, b].forEach((job, k) => {
      if (!job) return
      for (const p of found[k]) {
        candidates.push({
          ...fixFrom(job.level, p.u, p.v, job.s, job.off),
          score: p.score,
        })
      }
    })
    i += b ? 2 : 1
    yield i / jobs.length
  }
  candidates.sort((a, b) => b.score - a.score)
  const refined: ScoredFix[] = []
  for (const c of candidates.slice(0, keep)) {
    const f = trackFix(levels, cap, c, {
      minScore: -1,
    })
    const isKnown = f && refined.some(
      (r) => Math.hypot(r.x0 - f.x0, r.y0 - f.y0) < 1 && Math.abs(r.s / f.s - 1) < .05,
    )
    if (f && !isKnown) refined.push(f)
  }
  refined.sort((a, b) => b.score - a.score)
  const best = refined[0]
  if (!best) return null
  const lead = best.score - (refined[1]?.score ?? 0)
  return {
    ...best,
    lead,
    isConfident: best.score >= minScore && lead >= minLead,
  }
}

export function acquireFix(
  levels: Level[],
  cap: Capture,
  options?: AcquireOptions,
): AcquiredFix | null {
  const steps = acquireSteps(levels, cap, options)
  for (;;) {
    const r = steps.next()
    if (r.done) return r.value
  }
}
