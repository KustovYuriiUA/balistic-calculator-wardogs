import type { RgbaImage } from './types'

/** A rim's pixels, antialiasing included, stay within this many degrees of its hue. */
export const HUE_SPREAD = 25

// Rim pixels are saturated and bright, of any hue: the zone rim is green by default but can change colour.
// The tinted fill inside the rim and the grey map stay well below.
/** Hue in degrees, −1 for pixels that cannot be a rim. */
export function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const c = max - min
  if (max < 110 || c < 50) return -1
  if (max === r) return 60 * (((g - b) / c + 6) % 6)
  if (max === g) return 60 * ((b - r) / c + 2)
  return 60 * ((r - g) / c + 4)
}

export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export const isRingColor = (r: number, g: number, b: number) => hueOf(r, g, b) >= 0

export function hueMap({
  width: w, height: h, data: d,
}: RgbaImage): Int16Array {
  const out = new Int16Array(w * h)
  for (let i = 0; i < w * h; i++) {
    out[i] = Math.round(hueOf(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) % 360
  }
  return out
}

/** Flat [x0, y0, x1, y1, …] of rim-coloured pixel centres (pixel x covers x…x+1, as for the cursor), of one hue
 * if given. */
export function ringPoints(
  img: RgbaImage,
  hue: number | null = null,
  hues = hueMap(img),
): number[] {
  const w = img.width
  const pts: number[] = []
  for (let i = 0; i < hues.length; i++) {
    const h = hues[i]
    if (h >= 0 && (hue === null || hueGap(h, hue) <= HUE_SPREAD)) {
      pts.push(i % w + .5, Math.floor(i / w) + .5)
    }
  }
  return pts
}

export interface HuePeak {
  hue: number
  n: number
}

/** Peaks of the hue histogram with enough pixels for a rim: the hues worth a circle search. */
export function huePeaks(hues: Int16Array, { min = 150, count = 4 } = {}): HuePeak[] {
  const bins = new Float64Array(36)
  for (const h of hues) if (h >= 0) bins[Math.floor(h / 10) % 36]++
  const smooth = bins.map((v, i) => v + (bins[(i + 35) % 36] + bins[(i + 1) % 36]) / 2)
  const peaks: HuePeak[] = []
  for (let i = 0; i < 36; i++) {
    const isPeak = smooth[i] >= smooth[(i + 35) % 36] && smooth[i] > smooth[(i + 1) % 36]
    if (smooth[i] >= min && isPeak) {
      peaks.push({
        hue: i * 10 + 5,
        n: smooth[i],
      })
    }
  }
  return peaks.sort((a, b) => b.n - a.n).slice(0, count)
}
