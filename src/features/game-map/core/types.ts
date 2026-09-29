export interface Size {
  width: number
  height: number
}

export interface RgbaImage extends Size {
  data: Uint8ClampedArray
}

export interface LumaImage extends Size {
  data: Float32Array
}

/** Fills out with [r, g, b] of pixel (x, y). */
export type PixelRead = (x: number, y: number, out: number[]) => void

export interface ReadableImage extends Size {
  read: PixelRead
}

/** What the rim rays take: RGBA data, or pixels read one at a time straight from a frame copy. */
export type RayImage = RgbaImage | ReadableImage

export interface Point {
  x: number
  y: number
}

export interface Rect extends Size {
  x: number
  y: number
}

export interface Circle {
  cx: number
  cy: number
  r: number
}

/** A rim-like circle on a frame. coverage: share of the circumference seen; continuity: share of the rays that
 * found the rim where the circle is on the frame; isWeak: too short an arc for a precise radius. */
export interface Ring extends Circle {
  hue: number
  inliers: number
  rms: number
  coverage: number
  continuity: number
  isWeak: boolean
}

/** A terrain fix: capture pixel (a, b) → game x = x0 + a·s/100, y = y0 − b·s/100 (s: metres per pixel). */
export interface Fix {
  x0: number
  y0: number
  s: number
}

/** VideoFrame.copyTo() plane layout, without depending on the DOM typings. */
export interface PlaneLayout {
  offset: number
  stride: number
}

export interface FrameColorSpace {
  matrix?: string | null
  fullRange?: boolean | null
}
