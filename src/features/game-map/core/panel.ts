import type { Rect, RgbaImage } from './types'

export interface Panel extends Rect {
  score: number
}

// The in-game map panel inside a loosely drawn area: the largest near-square whose four sides are straight lines
// running unbroken from one side to the other. Grid lines and the cursor's crosshair are straight too, but only the
// panel's edges make that square. The panel is square within half a per cent; 1.5 % keeps the shadow it casts on
// the sky from passing as an edge.
/** Outer edge lines in image pixels, or null. */
export function findMapPanel(img: RgbaImage, {
  step = 12, minShare = .8, squareness = .015,
} = {}): Panel | null {
  const {
    width: w, height: h, data: d,
  } = img
  const L = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) L[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2]
  // Prefix sums of edge maps: how many rows y0…y1 have a vertical edge at column x (and the same for rows).
  const colSum = new Uint32Array(w * (h + 1))
  const rowSum = new Uint32Array(h * (w + 1))
  for (let x = 1; x < w - 1; x++) {
    for (let y = 0; y < h; y++) {
      const isEdge = Math.abs(L[y * w + x + 1] - L[y * w + x - 1]) > step
      colSum[x * (h + 1) + y + 1] = colSum[x * (h + 1) + y] + (isEdge ? 1 : 0)
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      const isEdge = Math.abs(L[(y + 1) * w + x] - L[(y - 1) * w + x]) > step
      rowSum[y * (w + 1) + x + 1] = rowSum[y * (w + 1) + x] + (isEdge ? 1 : 0)
    }
  }
  const colShare = (x: number, y0: number, y1: number) =>
    (colSum[x * (h + 1) + y1] - colSum[x * (h + 1) + y0]) / Math.max(1, y1 - y0)
  const rowShare = (y: number, x0: number, x1: number) =>
    (rowSum[y * (w + 1) + x1] - rowSum[y * (w + 1) + x0]) / Math.max(1, x1 - x0)
  // Candidate lines: local peaks of the full-length share, the 16 strongest each way.
  const peaks = (n: number, share: (i: number) => number) => {
    const s: number[] = []
    for (let i = 1; i < n - 1; i++) s.push(share(i))
    const out: {
      at: number,
      s: number
    }[] = []
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i] >= .5 && s[i] >= s[i - 1] && s[i] >= s[i + 1]) {
        out.push({
          at: i + 1,
          s: s[i],
        })
      }
    }
    return out.sort((a, b) => b.s - a.s).slice(0, 16).map((p) => p.at)
  }
  const cols = peaks(w, (x) => colShare(x, 0, h))
  const rows = peaks(h, (y) => rowShare(y, 0, w))
  let best: Panel | null = null
  for (const l of cols) {
    for (const r of cols) {
      const size = r - l
      if (size < Math.min(w, h) * .5) continue
      for (const t of rows) {
        for (const b of rows) {
          const tall = b - t
          if (tall <= 0 || Math.abs(tall - size) > Math.max(3, size * squareness)) continue
          // Each side unbroken along the span between the other two (a few px in from the corners).
          const score = Math.min(
            colShare(l, t + 3, b - 3),
            colShare(r, t + 3, b - 3),
            rowShare(t, l + 3, r - 3),
            rowShare(b, l + 3, r - 3),
          )
          if (score < minShare) continue
          const area = size * tall
          const isLarger = !best || area > best.width * best.height + 4 * size
          const isAsLargeButCleaner = best
            && Math.abs(area - best.width * best.height) <= 4 * size
            && score > best.score
          if (isLarger || isAsLargeButCleaner) {
            best = {
              x: l,
              y: t,
              width: size,
              height: tall,
              score,
            }
          }
        }
      }
    }
  }
  return best
}

// Once the area is fitted to the panel, the panel's frame lies on the area's edges. A strip across one edge
// (vertical: the strip runs top to bottom): the share of its length that one straight edge covers, best line of the
// strip. An open map scores 1 on every side, the 3D world behind a closed one about 0.1–0.3 (up to 0.7 on one side).
export function lineShare(
  {
    width: w, height: h, data: d,
  }: RgbaImage,
  isVertical: boolean,
  { step = 12, skip = 6 } = {},
): number {
  const n = isVertical ? w : h
  const len = isVertical ? h : w
  const L = (i: number, j: number) => {
    const o = (isVertical ? j * w + i : i * w + j) * 4
    return .299 * d[o] + .587 * d[o + 1] + .114 * d[o + 2]
  }
  let best = 0
  for (let i = 1; i < n - 1; i++) {
    let hits = 0
    for (let j = skip; j < len - skip; j++) if (Math.abs(L(i + 1, j) - L(i - 1, j)) > step) hits++
    best = Math.max(best, hits / Math.max(1, len - 2 * skip))
  }
  return best
}

export interface EdgeStrip extends Rect {
  isVertical: boolean
}

/** Strips across the four edges of rect, margin px to each side of it: left, right, top, bottom. */
export function edgeStrips({
  x, y, width: w, height: h,
}: Rect, margin: number): EdgeStrip[] {
  const m = margin
  return [
    {
      x: x - m,
      y,
      width: 2 * m,
      height: h,
      isVertical: true,
    },
    {
      x: x + w - m,
      y,
      width: 2 * m,
      height: h,
      isVertical: true,
    },
    {
      x,
      y: y - m,
      width: w,
      height: 2 * m,
      isVertical: false,
    },
    {
      x,
      y: y + h - m,
      width: w,
      height: 2 * m,
      isVertical: false,
    },
  ]
}

/** Open when three sides show the frame: an icon or the cursor may cover part of one. */
export const panelOpen = (shares: number[]) => shares.filter((s) => s >= .6).length >= 3
