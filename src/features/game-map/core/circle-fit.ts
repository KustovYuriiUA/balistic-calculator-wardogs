import type { Circle } from './types'

/** Algebraic (Kåsa) least-squares circle through the points listed in idx, on mean-centred coordinates. */
export function fitCircle(pts: number[], idx: number[]): Circle | null {
  const m = idx.length
  if (m < 3) return null
  let mx = 0
  let my = 0
  for (const i of idx) {
    mx += pts[2 * i]
    my += pts[2 * i + 1]
  }
  mx /= m
  my /= m
  let suu = 0
  let svv = 0
  let suv = 0
  let suz = 0
  let svz = 0
  let sz = 0
  for (const i of idx) {
    const u = pts[2 * i] - mx
    const v = pts[2 * i + 1] - my
    const z = u * u + v * v
    suu += u * u
    svv += v * v
    suv += u * v
    suz += u * z
    svz += v * z
    sz += z
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-9) return null
  const D = (suv * svz - svv * suz) / det
  const E = (suv * suz - suu * svz) / det
  const r2 = (D * D + E * E) / 4 + sz / m
  if (r2 <= 0) return null
  return {
    cx: mx - D / 2,
    cy: my - E / 2,
    r: Math.sqrt(r2),
  }
}

type Matrix3 = number[][]

function det3(m: Matrix3): number {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
}

function solve3(A: Matrix3, b: number[]): number[] | null {
  const d = det3(A)
  if (Math.abs(d) < 1e-12) return null
  return [0, 1, 2].map((k) => det3(A.map((row, i) => row.map((v, j) => j === k ? b[i] : v))) / d)
}

/** Geometric refinement (Gauss–Newton on the distance to the rim): the algebraic fit shrinks the radius on short
 * arcs. */
export function refineCircle(pts: number[], idx: number[], c: Circle): Circle {
  let {
    cx, cy, r,
  } = c
  for (let step = 0; step < 6; step++) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    const g = [0, 0, 0]
    for (const i of idx) {
      const dx = pts[2 * i] - cx
      const dy = pts[2 * i + 1] - cy
      const d = Math.hypot(dx, dy) || 1e-9
      const j = [-dx / d, -dy / d, -1]
      const f = d - r
      for (let p = 0; p < 3; p++) {
        g[p] -= j[p] * f
        for (let q = 0; q < 3; q++) A[p][q] += j[p] * j[q]
      }
    }
    const delta = solve3(A, g)
    if (!delta) break
    cx += delta[0]
    cy += delta[1]
    r += delta[2]
    if (Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) < 1e-3) break
  }
  if (r <= 0) return c
  return {
    cx,
    cy,
    r,
  }
}

function circumcircle(pts: number[], i: number, j: number, k: number): Circle | null {
  const ax = pts[2 * i]
  const ay = pts[2 * i + 1]
  const bx = pts[2 * j]
  const by = pts[2 * j + 1]
  const cx = pts[2 * k]
  const cy = pts[2 * k + 1]
  const isTooClose = Math.hypot(ax - bx, ay - by) < 4
    || Math.hypot(bx - cx, by - cy) < 4
    || Math.hypot(ax - cx, ay - cy) < 4
  if (isTooClose) return null
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-6) return null
  const a2 = ax * ax + ay * ay
  const b2 = bx * bx + by * by
  const c2 = cx * cx + cy * cy
  const x = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
  const y = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
  return {
    cx: x,
    cy: y,
    r: Math.hypot(ax - x, ay - y),
  }
}

export function inliersOf(pts: number[], c: Circle, tolerance: number): number[] {
  const idx: number[] = []
  for (let i = 0; i < pts.length / 2; i++) {
    if (Math.abs(Math.hypot(pts[2 * i] - c.cx, pts[2 * i + 1] - c.cy) - c.r) <= tolerance) {
      idx.push(i)
    }
  }
  return idx
}

/** Residual and angular coverage (72 bins of 5°) of the inliers around a circle. */
export function spread(pts: number[], idx: number[], c: Circle): {
  rms: number,
  coverage: number
} {
  let square = 0
  const bins = new Uint8Array(72)
  for (const i of idx) {
    const dx = pts[2 * i] - c.cx
    const dy = pts[2 * i + 1] - c.cy
    square += (Math.hypot(dx, dy) - c.r) ** 2
    bins[Math.min(71, Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 72))] = 1
  }
  return {
    rms: Math.sqrt(square / idx.length),
    coverage: bins.reduce((s, v) => s + v, 0) / 72,
  }
}

export interface RansacCircle extends Circle {
  inliers: number
  rms: number
  coverage: number
}

interface RansacOptions {
  iterations?: number
  tolerance?: number
  minR?: number
  maxR?: number
  isRough?: boolean
}

// RANSAC on circumcircles of random triples: icons, markers and other green blobs do not pull the fit. The seed
// is fixed so the same frame always gives the same circle. isRough: the caller refines the circle itself (rays
// across the rim), so hypotheses are scored on fewer points and the final refinement is skipped — a third of the cost.
export function ransacCircle(
  pts: number[],
  {
    iterations = 160, tolerance = 2.5, minR = 12, maxR = 1e5, isRough = false,
  }: RansacOptions = {},
): RansacCircle | null {
  const n = pts.length / 2
  if (n < 3) return null
  const stride = Math.max(1, Math.floor(n / (isRough ? 800 : 2500)))
  let seed = 0x2f6b5d1
  let best: Circle | null = null
  let bestCount = 0
  const pick = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return Math.floor(seed / 4294967296 * n)
  }
  for (let k = 0; k < iterations; k++) {
    const c = circumcircle(pts, pick(), pick(), pick())
    if (!c || c.r < minR || c.r > maxR) continue
    let count = 0
    for (let q = 0; q < n; q += stride) {
      if (Math.abs(Math.hypot(pts[2 * q] - c.cx, pts[2 * q + 1] - c.cy) - c.r) <= tolerance) count++
    }
    if (count > bestCount) {
      bestCount = count
      best = c
    }
  }
  if (!best) return null
  let idx = inliersOf(pts, best, tolerance + 1)
  let c = idx.length >= 3 ? fitCircle(pts, idx) : null
  if (!c) return null
  if (isRough) idx = inliersOf(pts, c, tolerance)
  else {
    for (const tol of [tolerance, tolerance]) {
      c = refineCircle(pts, idx, c)
      idx = inliersOf(pts, c, tol)
      if (idx.length < 3) return null
    }
    c = refineCircle(pts, idx, c)
  }
  if (idx.length < 3) return null
  return {
    cx: c.cx,
    cy: c.cy,
    r: c.r,
    inliers: idx.length,
    ...spread(pts, idx, c),
  }
}
