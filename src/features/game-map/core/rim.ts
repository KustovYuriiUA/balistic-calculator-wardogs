import {
  fitCircle, inliersOf, ransacCircle, refineCircle, spread,
} from './circle-fit'
import {
  HUE_SPREAD, hueGap, hueMap, huePeaks, ringPoints,
} from './hue'
import type { Circle, RayImage, RgbaImage, Ring } from './types'

interface RimRays {
  pts: number[]
  visible: number
}

// The zone is a tinted disc whose saturation rises towards its edge and ends in a sharp drop to the grey map; the
// line at the edge is 7 px thick on one screenshot and a 14 px glow on another. So the rim is found on rays across
// the rough circle: the last sharp drop outwards, located where it passes half the local peak. Samples of other
// hues count as grey. visible: how many rays saw the rim area.
export function rimRays(
  img: RayImage,
  c: Circle,
  hue: number,
  { rays = 720, reach = 30 } = {},
): RimRays {
  const { width: w, height: h } = img
  const read = 'read' in img ? img.read : null
  const d = 'read' in img ? null : img.data
  const px = [0, 0, 0]
  const pts: number[] = []
  const steps = reach * 4 + 1
  const sat = new Float32Array(steps)
  let visible = 0
  for (let k = 0; k < rays; k++) {
    const a = k / rays * 2 * Math.PI
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const ex = c.cx + c.r * cos
    const ey = c.cy + c.r * sin
    if (!(ex >= 0 && ey >= 0 && ex < w && ey < h)) continue
    visible++
    let max = 0
    for (let i = 0; i < steps; i++) {
      const t = -reach + i / 2
      const x = Math.floor(c.cx + (c.r + t) * cos)
      const y = Math.floor(c.cy + (c.r + t) * sin)
      let s = 0
      if (x >= 0 && y >= 0 && x < w && y < h) {
        let r: number
        let g: number
        let b: number
        if (read) {
          read(x, y, px)
          r = px[0]
          g = px[1]
          b = px[2]
        } else {
          const o = (y * w + x) * 4
          r = d![o]
          g = d![o + 1]
          b = d![o + 2]
        }
        const mx = Math.max(r, g, b)
        const mn = Math.min(r, g, b)
        if (mx - mn >= 12) {
          const c6 = mx - mn
          const hh = 60 * (mx === r
            ? ((g - b) / c6 + 6) % 6
            : mx === g ? (b - r) / c6 + 2 : (r - g) / c6 + 4)
          if (hueGap(hh, hue) <= HUE_SPREAD + 10) s = c6
        }
      }
      sat[i] = s
      if (s > max) max = s
    }
    if (max < 30) continue
    let edge = -1
    for (let i = steps - 1; i >= 0; i--) {
      if (sat[i] >= max / 2) {
        edge = i
        break
      }
    }
    // Sharp outside: at most a quarter of the peak 8 px beyond the edge, else the ray ended on an icon or a gradient.
    if (edge < 0 || edge + 16 >= steps || sat[edge + 16] > max / 4) continue
    // The zone ends where the tint ends: the outer edge, at half the local peak, interpolated between samples. (The
    // game's axis labels, 100 m apart, confirm this radius; the brightest line just inside it reads 0.5–2 % small.)
    let peak = 0
    for (let i = Math.max(0, edge - 24); i <= edge; i++) if (sat[i] > peak) peak = sat[i]
    let i = edge
    while (i + 1 < steps && sat[i + 1] >= peak / 2) i++
    const inner = sat[i]
    const outer = sat[i + 1]
    const tEdge = -reach + (i + (inner > outer ? (inner - peak / 2) / (inner - outer) : 0)) / 2
    pts.push(c.cx + (c.r + tEdge) * cos, c.cy + (c.r + tEdge) * sin)
  }
  return {
    pts,
    visible,
  }
}

/** Half the width and height, 2×2 box averages: the rough circle search runs on this, the rays on the full frame. */
export function halfImage({
  width: w, height: h, data: d,
}: RgbaImage): RgbaImage {
  const hw = w >> 1
  const hh = h >> 1
  const out = new Uint8ClampedArray(hw * hh * 4)
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const a = ((2 * y) * w + 2 * x) * 4
      const b = a + w * 4
      const o = (y * hw + x) * 4
      for (let c = 0; c < 3; c++) {
        out[o + c] = (d[a + c] + d[a + 4 + c] + d[b + c] + d[b + 4 + c]) / 4
      }
      out[o + 3] = 255
    }
  }
  return {
    width: hw,
    height: hh,
    data: out,
  }
}

interface RimOptions {
  minCoverage?: number
  reach?: number
}

// Two passes of rays on the full frame, the second from the circle the first found, so the rays sit square on the
// rim: 360 rays ±reach px, then 720 rays ±16 px (the edge lies a few px outside the rim and must be seen with 8 px
// beyond it). null unless it is a disc edge, not foliage or an icon: round (small residual) and continuous along
// the part on the frame.
export function rimFromRays(
  img: RayImage,
  rough: Circle,
  hue: number,
  { minCoverage = .15, reach = 24 }: RimOptions = {},
): Ring | null {
  let c: Circle = rough
  let idx: number[] = []
  let rim: RimRays = {
    pts: [],
    visible: 0,
  }
  for (let pass = 0; pass < 2; pass++) {
    rim = rimRays(img, c, hue, pass === 0
      ? {
        rays: 360,
        reach,
      }
      : {
        rays: 720,
        reach: 16,
      })
    const n = rim.pts.length / 2
    if (n < (pass === 0 ? 15 : 30)) return null
    idx = [...Array(n).keys()]
    let f = fitCircle(rim.pts, idx)
    if (!f) return null
    for (const tol of [3, 1.5]) {
      f = refineCircle(rim.pts, idx, f)
      idx = inliersOf(rim.pts, f, tol)
      if (idx.length < 30) return null
    }
    c = refineCircle(rim.pts, idx, f)
  }
  if (c.r < 12) return null
  const { rms, coverage } = spread(rim.pts, idx, c)
  const continuity = idx.length / Math.max(1, rim.visible)
  if (rms > 1.5 || coverage < minCoverage || continuity < .6) return null
  return {
    cx: c.cx,
    cy: c.cy,
    r: c.r,
    hue,
    inliers: idx.length,
    rms,
    coverage,
    continuity,
    isWeak: coverage < .35,
  }
}

/** Every rim-like circle on the frame, largest first: a rough RANSAC circle on pixels of one hue, then the rim
 * found on rays across it. */
export function ringCandidates(img: RgbaImage, { minPoints = 60, minCoverage = .15 } = {}): Ring[] {
  // Frames wider than 600 px are searched at half size (a quarter of the pixels): ring pixels and radii halve.
  const k = img.width > 600 ? 2 : 1
  const small = k === 2 ? halfImage(img) : img
  const hues = hueMap(small)
  const found: Ring[] = []
  const maxR = Math.hypot(small.width, small.height) * 4
  for (const { hue } of huePeaks(hues, {
    min: 150 / k / k,
  })) {
    const pts = ringPoints(small, hue, hues)
    if (pts.length / 2 < minPoints / k) continue
    const rough = ransacCircle(pts, {
      maxR,
      minR: 12 / k,
      iterations: pts.length > 20000 ? 300 : 160,
      isRough: true,
    })
    const isRim = rough
      && rough.inliers >= minPoints / k
      && rough.coverage >= minCoverage
      && rough.rms <= 1.6
    if (!isRim) continue
    const rim = rimFromRays(img, {
      cx: rough.cx * k,
      cy: rough.cy * k,
      r: rough.r * k,
    }, hue, {
      minCoverage,
    })
    if (rim) found.push(rim)
  }
  return found.sort((a, b) => b.r - a.r)
}

/** The rim of the last frame found again near where it should be now: moved on by as much as it moved between the
 * two frames before (a steady pan or zoom), then rays wide enough for the rest of the motion. About a tenth of a full
 * search; null when it moved too far or is gone. */
export function trackRing(
  img: RayImage,
  prev: Ring,
  before: Circle | null = null,
  { minCoverage = .15 } = {},
) {
  const guess: Circle = before
    ? {
      cx: 2 * prev.cx - before.cx,
      cy: 2 * prev.cy - before.cy,
      r: Math.max(12, 2 * prev.r - before.r),
    }
    : {
      cx: prev.cx,
      cy: prev.cy,
      r: prev.r,
    }
  return rimFromRays(img, guess, prev.hue, {
    minCoverage,
    reach: Math.max(24, Math.round(guess.r * .12)),
  })
}

/** The largest rim-like circle, or the largest of the given hue. */
export function detectRing(img: RgbaImage, {
  hue = null as number | null, minPoints = 60, minCoverage = .15,
} = {}) {
  const candidates = ringCandidates(img, {
    minPoints,
    minCoverage,
  })
  return candidates.find((c) => hue === null || hueGap(c.hue, hue) <= HUE_SPREAD) || null
}
