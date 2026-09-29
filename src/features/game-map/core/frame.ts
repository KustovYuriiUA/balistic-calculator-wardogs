import type { FrameColorSpace, LumaImage, PixelRead, PlaneLayout } from './types'

// Capture delivers I420 here (NVIDIA); other GPUs and drivers may give NV12, I420A, I422, I444 or 8-bit RGB.
// Anything else (10-bit, HDR, GPU-only frames) is copied as RGBX by the browser.
export const FRAME_FORMATS = /^(I420A?|I422|I444|NV12|RGB[AX]|BGR[AX])$/

const RGB_FORMAT = /^(RGB|BGR)[AX]$/

interface YuvMaths {
  kr: number
  kb: number
  kg: number
  ys: number
  yo: number
  cs: number
  isNv12: boolean
  sx: number
  sy: number
}

function yuvMaths(format: string, colorSpace?: FrameColorSpace | null): YuvMaths {
  if (!FRAME_FORMATS.test(format)) throw new Error('Unsupported frame format: ' + format)
  const isBt601 = /smpte170m|bt470bg/.test(colorSpace?.matrix || '')
  const kr = isBt601 ? .299 : .2126
  const kb = isBt601 ? .114 : .0722
  const isFullRange = colorSpace?.fullRange === true
  return {
    kr,
    kb,
    kg: 1 - kr - kb,
    ys: isFullRange ? 1 : 255 / 219,
    yo: isFullRange ? 0 : 16,
    cs: isFullRange ? 1 : 255 / 224,
    isNv12: format === 'NV12',
    // Chroma subsampling: I420/I420A/NV12 2×2, I422 2×1, I444 none.
    sx: format === 'I444' ? 0 : 1,
    sy: format === 'I420' || format === 'I420A' || format === 'NV12' ? 1 : 0,
  }
}

/** out: a buffer of the right size to reuse, one frame after another. */
export function frameToRgba(
  buf: Uint8Array,
  layout: PlaneLayout[],
  format: string,
  width: number,
  height: number,
  colorSpace?: FrameColorSpace | null,
  out: Uint8ClampedArray = new Uint8ClampedArray(width * height * 4),
): Uint8ClampedArray {
  if (RGB_FORMAT.test(format)) {
    const isBgr = format[0] === 'B'
    const { offset, stride } = layout[0]
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = offset + y * stride + x * 4
        const o = (y * width + x) * 4
        out[o] = buf[s + (isBgr ? 2 : 0)]
        out[o + 1] = buf[s + 1]
        out[o + 2] = buf[s + (isBgr ? 0 : 2)]
        out[o + 3] = 255
      }
    }
    return out
  }
  const {
    kr, kb, kg, ys, yo, cs, isNv12, sx, sy,
  } = yuvMaths(format, colorSpace)
  const [Y, U, V] = layout
  for (let y = 0; y < height; y++) {
    const row = (y >> sy) * U.stride
    const vrow = isNv12 ? 0 : (y >> sy) * V.stride
    for (let x = 0; x < width; x++) {
      const c = x >> sx
      const l = (buf[Y.offset + y * Y.stride + x] - yo) * ys
      const cb = ((isNv12 ? buf[U.offset + row + c * 2] : buf[U.offset + row + c]) - 128) * cs
      const cr = ((isNv12 ? buf[U.offset + row + c * 2 + 1] : buf[V.offset + vrow + c]) - 128) * cs
      const r = l + 2 * (1 - kr) * cr
      const b = l + 2 * (1 - kb) * cb
      const o = (y * width + x) * 4
      out[o] = r
      out[o + 1] = (l - kr * r - kb * b) / kg
      out[o + 2] = b
      out[o + 3] = 255
    }
  }
  return out
}

/** The same colour maths as frameToRgba, for the few thousand pixels the rim rays look at: converting the whole
 * frame takes ~5 ms. */
export function pixelReader(
  buf: Uint8Array,
  layout: PlaneLayout[],
  format: string,
  colorSpace?: FrameColorSpace | null,
): PixelRead {
  const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
  if (RGB_FORMAT.test(format)) {
    const isBgr = format[0] === 'B'
    const { offset, stride } = layout[0]
    return (x, y, out) => {
      const s = offset + y * stride + x * 4
      out[0] = buf[s + (isBgr ? 2 : 0)]
      out[1] = buf[s + 1]
      out[2] = buf[s + (isBgr ? 0 : 2)]
    }
  }
  const {
    kr, kb, kg, ys, yo, cs, isNv12, sx, sy,
  } = yuvMaths(format, colorSpace)
  const [Y, U, V] = layout
  return (x, y, out) => {
    const c = x >> sx
    const row = (y >> sy) * U.stride
    const l = (buf[Y.offset + y * Y.stride + x] - yo) * ys
    const cb = ((isNv12 ? buf[U.offset + row + c * 2] : buf[U.offset + row + c]) - 128) * cs
    const crAt = isNv12 ? U.offset + row + c * 2 + 1 : V.offset + (y >> sy) * V.stride + c
    const cr = (buf[crAt] - 128) * cs
    const r = l + 2 * (1 - kr) * cr
    const b = l + 2 * (1 - kb) * cb
    out[0] = clamp(r)
    out[1] = clamp((l - kr * r - kb * b) / kg)
    out[2] = clamp(b)
  }
}

/** Luminance straight from the Y plane; null for RGB copies. The terrain match is a normalised correlation, so
 * the limited range of Y (16…235) makes no difference. */
export function frameLuma(
  buf: Uint8Array,
  layout: PlaneLayout[],
  format: string,
  width: number,
  height: number,
  out: Float32Array = new Float32Array(width * height),
): LumaImage | null {
  if (RGB_FORMAT.test(format)) return null
  const { offset, stride } = layout[0]
  for (let y = 0; y < height; y++) {
    const row = offset + y * stride
    const o = y * width
    for (let x = 0; x < width; x++) out[o + x] = buf[row + x]
  }
  return {
    width,
    height,
    data: out,
  }
}
