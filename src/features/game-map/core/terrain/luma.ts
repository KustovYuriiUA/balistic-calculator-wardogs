import type { LumaImage, RgbaImage } from '../types'

export interface Integral {
  width: number
  height: number
  sum: Float64Array
}

export function lumaOf({
  width, height, data,
}: RgbaImage): LumaImage {
  const out = new Float32Array(width * height)
  for (let i = 0; i < out.length; i++) {
    out[i] = .299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2]
  }
  return {
    width,
    height,
    data: out,
  }
}

/** Summed-area table: any box average in O(1). */
export function integralOf({
  width: w, height: h, data,
}: LumaImage, isSquared = false): Integral {
  const s = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x]
      row += isSquared ? v * v : v
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row
    }
  }
  return {
    width: w,
    height: h,
    sum: s,
  }
}

/** Bilinear at a fractional point, so box averages work for any footprint, even below a pixel. */
function integralAt(I: Integral, px: number, py: number): number {
  const w = I.width
  const h = I.height
  const x = Math.max(0, Math.min(w, px))
  const y = Math.max(0, Math.min(h, py))
  const x0 = Math.min(w - 1, Math.floor(x))
  const y0 = Math.min(h - 1, Math.floor(y))
  const fx = x - x0
  const fy = y - y0
  const s = I.sum
  const W = w + 1
  const a = s[y0 * W + x0]
  const b = s[y0 * W + x0 + 1]
  const c = s[(y0 + 1) * W + x0]
  const d = s[(y0 + 1) * W + x0 + 1]
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
}

/** The box x0…x1, y0…y1 of an image (given by its integral) onto a w×h grid of box averages. */
export function resampleBox(
  I: Integral,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  h: number,
): LumaImage {
  const out = new Float32Array(w * h)
  const dx = (x1 - x0) / w
  const dy = (y1 - y0) / h
  const area = dx * dy
  for (let j = 0; j < h; j++) {
    const ya = y0 + j * dy
    const yb = ya + dy
    for (let i = 0; i < w; i++) {
      const xa = x0 + i * dx
      const xb = xa + dx
      const box = integralAt(I, xb, yb)
        - integralAt(I, xa, yb)
        - integralAt(I, xb, ya)
        + integralAt(I, xa, ya)
      out[j * w + i] = box / area
    }
  }
  return {
    width: w,
    height: h,
    data: out,
  }
}

/** Removes slow brightness changes (the zone's tint, vignettes): subtracts a box blur of the given radius. */
export function highPass(img: LumaImage, radius: number): LumaImage {
  const I = integralOf(img)
  const { width: w, height: h } = img
  const out = new Float32Array(w * h)
  const s = I.sum
  const W = w + 1
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(h, y + radius + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(w, x + radius + 1)
      const box = s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0]
      out[y * w + x] = img.data[y * w + x] - box / ((x1 - x0) * (y1 - y0))
    }
  }
  return {
    width: w,
    height: h,
    data: out,
  }
}
