import {
  edgeStrips,
  findMapPanel,
  FRAME_FORMATS,
  frameLuma,
  frameToRgba,
  lineShare,
  lumaOf,
  panelOpen,
  pixelReader,
  type LumaImage,
  type PlaneLayout,
  type Rect,
  type RgbaImage,
} from '../core'

/** The saved area in frame pixels (even, for I420 chroma): frame pixel u → window pixel u/k + ox. */
export interface Crop {
  rect: Rect
  k: number
  ox: number
  oy: number
}

export interface AreaConfig {
  rect: Rect
  display: {
    bounds: Rect
  }
}

const even = (n: number) => Math.max(0, Math.floor(n / 2) * 2)

export function cropFor(frame: VideoFrame, config: AreaConfig): Crop {
  const v = frame.visibleRect!
  const b = config.display.bounds
  const k = v.width / b.width
  const x = even((config.rect.x - b.x) * k)
  const y = even((config.rect.y - b.y) * k)
  return {
    rect: {
      x: v.x + x,
      y: v.y + y,
      width: even(Math.min(v.width - x, config.rect.width * k)),
      height: even(Math.min(v.height - y, config.rect.height * k)),
    },
    k,
    ox: x / k - (config.rect.x - b.x),
    oy: y / k - (config.rect.y - b.y),
  }
}

export interface FrameCopy {
  buf: Uint8Array
  layout: PlaneLayout[]
  format: string
  rgba: () => Uint8ClampedArray
}

interface Slot {
  buf: Uint8Array
  rgba: Uint8ClampedArray | null
}

// A rectangle of the frame in a format frameToRgba reads: the frame's own, or RGBX converted by the browser for
// anything else (10-bit, HDR, frames that live on the GPU). Buffers are reused while the size stays the same: no 4 MB
// of garbage per frame at 60 frames a second. Readers of a copy take what they need before the next frame.
export function createFramePool() {
  const slots = new Map<string, Slot>()
  let luma: Float32Array | null = null

  async function copy(frame: VideoFrame, rect: Rect, name: string): Promise<FrameCopy> {
    const isDirect = Boolean(frame.format) && FRAME_FORMATS.test(frame.format!)
    const format = isDirect ? frame.format! : 'RGBX'
    const options: VideoFrameCopyToOptions = isDirect
      ? {
        rect,
      }
      : {
        rect,
        format: 'RGBX',
      }
    const size = frame.allocationSize(options)
    const n = rect.width * rect.height * 4
    let slot = slots.get(name)
    if (!slot || slot.buf.length !== size) {
      slot = {
        buf: new Uint8Array(size),
        rgba: null,
      }
      slots.set(name, slot)
    }
    if (!slot.rgba || slot.rgba.length !== n) slot.rgba = new Uint8ClampedArray(n)
    const layout = await frame.copyTo(slot.buf, options) as PlaneLayout[]
    const kept = slot
    const colorSpace = frame.colorSpace
    return {
      buf: kept.buf,
      layout,
      format,
      rgba: () => frameToRgba(
        kept.buf,
        layout,
        format,
        rect.width,
        rect.height,
        colorSpace,
        kept.rgba!,
      ),
    }
  }

  return {
    copy,
    /** A one-off copy is not worth keeping. */
    drop: (name: string) => slots.delete(name),
    /** A reused buffer for the terrain's luminance. */
    lumaBuffer(n: number) {
      if (luma?.length !== n) luma = new Float32Array(n)
      return luma
    },
  }
}

export type FramePool = ReturnType<typeof createFramePool>

/** The frame as the rim, the zone check and the terrain read it: RGBA of the whole frame only when something needs
 * it (a search, the zone check, the terrain, a snapshot); the tracked rim reads its pixels straight from the copy,
 * the terrain its luminance straight from the Y plane. */
export interface FrameImage extends RgbaImage {
  read: ReturnType<typeof pixelReader>
  luma: LumaImage
}

export function frameImage(
  copy: FrameCopy,
  width: number,
  height: number,
  colorSpace: VideoColorSpace,
  pool: FramePool,
): FrameImage {
  let rgba: Uint8ClampedArray | null = null
  let luma: LumaImage | null = null
  const img: FrameImage = {
    width,
    height,
    read: pixelReader(copy.buf, copy.layout, copy.format, colorSpace),
    get data() {
      rgba ??= copy.rgba()
      return rgba
    },
    get luma() {
      luma ??= frameLuma(
        copy.buf,
        copy.layout,
        copy.format,
        width,
        height,
        pool.lumaBuffer(width * height),
      ) || lumaOf(img)
      return luma
    },
  }
  return img
}

/** A coarse fingerprint of the raw frame (luma of I420/NV12, or mean RGB), before any conversion. */
export function rawSignature(
  buf: Uint8Array,
  layout: PlaneLayout[],
  format: string,
  w: number,
  h: number,
) {
  const out = new Float32Array(256)
  const isYuv = format === 'I420' || format === 'NV12'
  const { offset, stride } = layout[0]
  for (let j = 0, k = 0; j < 16; j++) {
    for (let i = 0; i < 16; i++, k++) {
      const x = Math.floor((i + .5) * w / 16)
      const y = Math.floor((j + .5) * h / 16)
      const o = offset + y * stride + (isYuv ? x : x * 4)
      out[k] = isYuv ? buf[o] : (buf[o] + buf[o + 1] + buf[o + 2]) / 3
    }
  }
  return out
}

const meanGap = (a: Float32Array, b: Float32Array) => {
  let d = 0
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i])
  return d / a.length
}

export const rawUnchanged = (a: Float32Array, b: Float32Array) => meanGap(a, b) < 1.5

/** A coarse fingerprint of the frame (three times the luma stands for the sum of R, G and B): an unchanged map needs
 * no new terrain search. */
export function signature(img: FrameImage) {
  const out = new Float32Array(256)
  const L = img.luma.data
  for (let j = 0, k = 0; j < 16; j++) {
    for (let i = 0; i < 16; i++, k++) {
      const y = Math.floor((j + .5) * img.height / 16)
      const x = Math.floor((i + .5) * img.width / 16)
      out[k] = 3 * L[y * img.width + x]
    }
  }
  return out
}

export const unchanged = (a: Float32Array, b: Float32Array) => meanGap(a, b) < 6

/** The map's frame (panelOpen): four thin strips across the fitted area's edges, 8 screen pixels to each side. */
export async function frameOpen(frame: VideoFrame, crop: Crop, pool: FramePool) {
  const v = frame.visibleRect!
  const m = Math.max(4, Math.round(4 * crop.k) * 2)
  const shares: number[] = []
  const strips = edgeStrips(crop.rect, m)
  for (let i = 0; i < strips.length; i++) {
    const s = strips[i]
    const x = even(Math.max(v.x, s.x))
    const y = even(Math.max(v.y, s.y))
    const w = even(Math.min(v.x + v.width, s.x + s.width) - x)
    const h = even(Math.min(v.y + v.height, s.y + s.height) - y)
    if (w < 4 || h < 4) {
      shares.push(0)
      continue
    }
    const copy = await pool.copy(frame, {
      x,
      y,
      width: w,
      height: h,
    }, 'edge' + i)
    shares.push(lineShare({
      width: w,
      height: h,
      data: copy.rgba(),
    }, s.isVertical))
  }
  return {
    isOpen: panelOpen(shares),
    shares,
  }
}

/** The square map panel in the area grown by 8 % on each side, in screen coordinates; null when not found. */
export async function findPanel(
  frame: VideoFrame,
  crop: Crop,
  config: AreaConfig,
  pool: FramePool,
) {
  const v = frame.visibleRect!
  const b = config.display.bounds
  const c = crop.rect
  const mx = Math.round(c.width * .08)
  const my = Math.round(c.height * .08)
  const x = even(Math.max(v.x, c.x - mx))
  const y = even(Math.max(v.y, c.y - my))
  const w = even(Math.min(v.x + v.width, c.x + c.width + mx) - x)
  const h = even(Math.min(v.y + v.height, c.y + c.height + my) - y)
  const copy = await pool.copy(frame, {
    x,
    y,
    width: w,
    height: h,
  }, 'panel')
  const p = findMapPanel({
    width: w,
    height: h,
    data: copy.rgba(),
  })
  pool.drop('panel')
  if (!p) return null
  return {
    x: b.x + (x + p.x - v.x) / crop.k,
    y: b.y + (y + p.y - v.y) / crop.k,
    width: p.width / crop.k,
    height: p.height / crop.k,
  }
}
