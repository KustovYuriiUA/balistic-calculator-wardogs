import assert from 'node:assert/strict'

import { test } from 'vitest'

import { ZONE_PATCHES } from '@/data/generated/zone-patches'
import { MAP_LANDMARKS, type Zone } from '@/data/landmarks'
import * as Z from '@/features/game-map/core'

type Colour = number[]

interface SceneCircle {
  cx: number
  cy: number
  r: number
  thickness?: number
}

// Colours sampled from a real in-game map: rim, the rim's tinted fill, terrain outside, a blue unit icon.
const RIM = [61, 178, 129]
const FILL = [89, 113, 94]
const GROUND = [30, 30, 30]
const ICON = [70, 160, 230]

function scene(w: number, h: number, { thickness = 3, ...circle }: SceneCircle): Z.RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + .5 - circle.cx, y + .5 - circle.cy)
      const c = Math.abs(d - circle.r) <= thickness / 2 ? RIM : d < circle.r ? FILL : GROUND
      const o = (y * w + x) * 4
      data.set(c, o)
      data[o + 3] = 255
    }
  }
  return {
    width: w,
    height: h,
    data,
  }
}

function paint(img: Z.RgbaImage, x0: number, y0: number, w: number, h: number, c: Colour) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) img.data.set(c, (y * img.width + x) * 4)
  }
}

const planeAt = (offset: number, stride: number): Z.PlaneLayout => ({
  offset,
  stride,
})

const BT709 = {
  matrix: 'bt709',
  fullRange: false,
}

const BT601_FULL = {
  matrix: 'smpte170m',
  fullRange: true,
}

test('Rim is found despite green and blue icons; centre and outer edge within half a pixel', () => {
  const img = scene(420, 400, {
    cx: 210.3,
    cy: 190.7,
    r: 150.2,
  })
  paint(img, 20, 20, 30, 30, RIM)// a green icon outside the zone
  paint(img, 190, 60, 40, 40, ICON)
  paint(img, 150, 300, 24, 24, RIM)// markers over the fill and on the rim
  const ring = Z.detectRing(img)
  assert.ok(ring)
  // The zone ends at the outer edge of its line: the 3 px line centred on 150.2 ends at 151.7.
  const isPrecise = Math.abs(ring.cx - 210.3) < .5 && Math.abs(ring.cy - 190.7) < .5
    && Math.abs(ring.r - 151.7) < .5
  assert.ok(isPrecise, JSON.stringify(ring))
  assert.equal(ring.isWeak, false)
  assert.ok(ring.coverage > .95)
})

test('Zoomed in: a quarter of the rim is enough but flagged weak; a sliver or no rim is rejected', () => {
  const quarter = Z.detectRing(scene(400, 400, {
    cx: 380,
    cy: 380,
    r: 300,
  }))
  assert.ok(
    quarter && Math.abs(quarter.cx - 380) < 2 && Math.abs(quarter.cy - 380) < 2
      && Math.abs(quarter.r - 300) < 2,
    JSON.stringify(quarter),
  )
  assert.equal(quarter.isWeak, true)
  assert.equal(Z.detectRing(scene(400, 400, {
    cx: 200,
    cy: 1200,
    r: 1010,
  })), null, 'a sliver of a huge circle')
  const empty = scene(300, 300, {
    cx: -999,
    cy: -999,
    r: 1,
  })
  assert.equal(Z.detectRing(empty), null)
  paint(empty, 100, 100, 60, 60, RIM)
  assert.equal(Z.detectRing(empty), null, 'a filled green square is not a rim')
})

test('A 14 px glow that brightens towards a sharp edge (zoomed out) is found at its edge, in any colour', () => {
  // Saturation rises over 14 px up to the disc edge, then drops to the grey map: the look of the rim on Europe.
  const glow = (w: number, h: number, c: Z.Circle, [R, G, B]: Colour): Z.RgbaImage => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x + .5 - c.cx, y + .5 - c.cy) - c.r
        const o = (y * w + x) * 4
        const k = d > 0 ? 0 : d > -14 ? .35 + .65 * (1 + d / 14) : .35
        const grey = 70
        data.set([grey + (R - grey) * k, grey + (G - grey) * k, grey + (B - grey) * k, 255], o)
      }
    }
    return {
      width: w,
      height: h,
      data,
    }
  }
  for (const colour of [[61, 178, 129], [220, 60, 50], [70, 120, 235]]) {
    const ring = Z.detectRing(glow(760, 720, {
      cx: 380.4,
      cy: 360.7,
      r: 330.2,
    }, colour))
    assert.ok(
      ring && Math.hypot(ring.cx - 380.4, ring.cy - 360.7) < 1 && ring.r > 326 && ring.r < 331.5,
      `${colour}: ${JSON.stringify(ring)}`,
    )
  }
})

test('Several circles: the largest wins, or the one of the zone hue; a small marker circle alone is still found', () => {
  const img = scene(700, 700, {
    cx: 350,
    cy: 350,
    r: 300,
  })
  const yellow = [235, 205, 60]
  const marker = (cx: number, cy: number, r: number) => {
    for (let y = 0; y < 700; y++) {
      for (let x = 0; x < 700; x++) {
        const isOnCircle = Math.abs(Math.hypot(x + .5 - cx, y + .5 - cy) - r) <= 1.5
        if (isOnCircle) img.data.set(yellow, (y * 700 + x) * 4)
      }
    }
  }
  marker(220, 260, 40)
  const largest = Z.detectRing(img)
  assert.ok(largest && Math.abs(largest.r - 300) < 2, 'largest')
  const all = Z.ringCandidates(img)
  assert.ok(
    all.length >= 2 && all.some((c) => Math.abs(c.r - 40) < 2),
    JSON.stringify(all.map((c) => [c.r, c.hue])),
  )
  const small = all.find((c) => c.r < 100)
  assert.ok(small)
  const byHue = Z.detectRing(img, {
    hue: small.hue,
  })
  assert.ok(byHue && Math.abs(byHue.r - 40) < 2, 'by hue')
})

test('Map panel inside a loosely drawn area: the square with unbroken sides, not grid lines, crosshair or a shadow', () => {
  const w = 520
  const h = 500
  const img: Z.RgbaImage = {
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
  }
  const px = (i: number, v: number) => {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  let s = 5
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) px(y * w + x, 150 + Math.round(rnd() * 10))// sky-like world, little texture
  }
  const P = {
    x: 61,
    y: 47,
    size: 400,
  }
  for (let y = P.y; y <= P.y + P.size; y++) {
    for (let x = P.x; x <= P.x + P.size; x++) px(y * w + x, 40 + Math.round(rnd() * 60))// textured map
  }
  for (let k = 0; k <= P.size; k++) {// light frame
    px(P.y * w + P.x + k, 200)
    px((P.y + P.size) * w + P.x + k, 200)
    px((P.y + k) * w + P.x, 200)
    px((P.y + k) * w + P.x + P.size, 200)
  }
  for (let x = P.x; x <= P.x + P.size; x++) px((P.y + 150) * w + x, 190)// a grid line each way
  for (let y = P.y; y <= P.y + P.size; y++) px(y * w + P.x + 230, 190)
  for (let x = 0; x < w; x++) px(20 * w + x, 90)// a shadow line across the whole area above the panel (not a panel edge)
  const p = Z.findMapPanel(img)
  assert.ok(
    p && Math.abs(p.x - P.x) <= 2 && Math.abs(p.y - P.y) <= 2
      && Math.abs(p.width - P.size) <= 3 && Math.abs(p.height - P.size) <= 3,
    JSON.stringify(p),
  )
  const inside: Z.RgbaImage = {
    width: 300,
    height: 300,
    data: new Uint8ClampedArray(300 * 300 * 4),
  }
  for (let y = 0; y < 300; y++) {
    const row = (P.y + 50 + y) * w
    inside.data.set(img.data.subarray((row + P.x + 50) * 4, (row + P.x + 350) * 4), y * 300 * 4)
  }
  assert.equal(Z.findMapPanel(inside), null, 'an area drawn inside the panel has no panel edges')
  // Open or closed, from strips across the fitted area's edges: the frame on all four sides, or on three when an icon
  // covers one; not when the panel is gone (the world behind a closed map). The real screenshot: tests/zone-check.cjs.
  const shares = (image: Z.RgbaImage, rect: Z.Rect, m = 6) => Z.edgeStrips(rect, m).map((strip) => {
    const cut: Z.RgbaImage = {
      width: strip.width,
      height: strip.height,
      data: new Uint8ClampedArray(strip.width * strip.height * 4),
    }
    for (let y = 0; y < strip.height; y++) {
      const row = (strip.y + y) * w + strip.x
      cut.data.set(image.data.subarray(row * 4, (row + strip.width) * 4), y * strip.width * 4)
    }
    return Z.lineShare(cut, strip.isVertical)
  })
  const fitted = {
    x: P.x,
    y: P.y,
    width: P.size,
    height: P.size,
  }
  const open = shares(img, fitted)
  assert.ok(open.every((v) => v >= .95) && Z.panelOpen(open), JSON.stringify(open))
  paint(img, P.x - 8, P.y + 50, 24, 300, [20, 20, 20])// a big icon over most of the left side
  const covered = shares(img, fitted)
  assert.ok(covered[0] < .6 && Z.panelOpen(covered), JSON.stringify(covered))
  const world: Z.RgbaImage = {
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
  }
  for (let i = 0; i < w * h; i++) {
    world.data.set([150 + Math.round(rnd() * 10), 150, 150, 255], i * 4)
  }
  for (let x = 0; x < w; x++) world.data.set([90, 90, 90, 255], ((P.y + P.size) * w + x) * 4)// a horizon just where the bottom edge was
  assert.equal(Z.panelOpen(shares(world, fitted)), false, 'one straight line in the world is not the frame')
})

test('Circle fits: algebraic on exact points, geometric refinement on a noisy short arc', () => {
  const rad = (a: number) => a * Math.PI / 180
  const pts: number[] = []
  for (let a = 0; a < 360; a += 7) pts.push(40 + 25 * Math.cos(rad(a)), -12 + 25 * Math.sin(rad(a)))
  const c = Z.fitCircle(pts, [...Array(pts.length / 2).keys()])
  assert.ok(c && Math.abs(c.cx - 40) < 1e-6 && Math.abs(c.cy + 12) < 1e-6)
  assert.ok(Math.abs(c.r - 25) < 1e-6)
  const arc: number[] = []
  let s = 7
  const noise = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647 - .5
  }
  for (let a = 200; a < 260; a += .5) {
    arc.push(500 + 400 * Math.cos(rad(a)) + noise() * 2, 500 + 400 * Math.sin(rad(a)) + noise() * 2)
  }
  const idx = [...Array(arc.length / 2).keys()]
  const algebraic = Z.fitCircle(arc, idx)
  assert.ok(algebraic)
  const refined = Z.refineCircle(arc, idx, algebraic)
  assert.ok(
    Math.abs(refined.r - 400) < 6 && Math.hypot(refined.cx - 500, refined.cy - 500) < 6,
    JSON.stringify(refined),
  )
})

test('Screen ↔ game units from the rim of North America · Zestafona', () => {
  const zone = MAP_LANDMARKS.northamerica.zones.find((z) => z.id === 'zestafona-default')
  assert.ok(zone)
  const t = Z.ringTransform({
    cx: 413.9,
    cy: 432.9,
    r: 374.9,
  }, zone)
  assert.ok(Math.abs(t.scale - 74.98) < .01)
  const centre = Z.pixelToWorld(t, 413.9, 432.9)
  assert.ok(Math.abs(centre.x - zone.pos[0] * 163.84) < 1e-9)
  assert.ok(Math.abs(centre.y - (1 - zone.pos[1]) * 163.84) < 1e-9)
  const east = Z.pixelToWorld(t, 413.9 + 374.9, 432.9)
  const north = Z.pixelToWorld(t, 413.9, 432.9 - 374.9)
  assert.ok(Math.abs(east.x - centre.x - 5) < 1e-9 && Math.abs(north.y - centre.y - 5) < 1e-9, '500 m east and north')
  const back = Z.worldToPixel(t, 70, 100)
  assert.deepEqual(Z.pixelToWorld(t, back.x, back.y).x.toFixed(9), '70.000000000')
})

test('Zone recognition: the right patch wins through tint, brightness, noise and icons; a blend is not confident', () => {
  const N = 16
  let s = 11
  const rnd = () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }
  const texture = () => Uint8Array.from({
    length: N * N,
  }, () => Math.round(rnd() * 255))
  const patches = {
    a: texture(),
    b: texture(),
    c: texture(),
  }
  const sample = (from: Uint8Array): Z.DiscSample => {
    const lum = Float32Array.from(from, (v) => .55 * v + 40 + (rnd() - .5) * 20)
    const valid = new Uint8Array(N * N).fill(1)
    return {
      size: N,
      lum,
      valid,
      count: N * N,
    }
  }
  const correlate = (x: Z.DiscSample, y: Uint8Array) => Z.correlate(x, y, 50)
  const score = correlate(sample(patches.b), patches.b)
  assert.ok(score !== null && score > .9)
  const clean = sample(patches.b)
  for (let i = 0; i < 30; i++) clean.lum[i] = 255// icons, not removed by the saturation filter
  const found = Z.recogniseZone(clean, patches)
  assert.ok(found)
  assert.equal(found.key, 'b')
  assert.equal(found.isConfident, true)
  const mix = sample(patches.a.map((v, i) => (v + patches.b[i]) / 2))
  const blended = Z.recogniseZone(mix, patches)
  assert.ok(blended)
  assert.equal(blended.isConfident, false)
})

test('Disc sampling leaves out cells off the frame, near the rim and under saturated icons', () => {
  const img = scene(200, 200, {
    cx: 100,
    cy: 100,
    r: 90,
  })
  paint(img, 90, 90, 20, 20, ICON)
  const all = Z.discSample(img, {
    cx: 100,
    cy: 100,
    r: 90,
  }, 16)
  assert.ok(all.count > 120 && all.count < 180, String(all.count))
  const centre = 7 * 16 + 7
  assert.equal(all.valid[centre], 0, 'icon cell dropped')
  assert.equal(all.valid[0], 0, 'corner outside the disc')
  const half = Z.discSample(img, {
    cx: 0,
    cy: 100,
    r: 90,
  }, 16)
  assert.ok(half.count < all.count / 2 + 10, 'left half is off the frame')
})

test('Frame formats: BT.709 limited I420 and NV12, BT.601 full range, BGRX', () => {
  const colours = [[61, 178, 129], [255, 255, 255], [0, 0, 0], [230, 40, 20]]
  const kr = .2126
  const kb = .0722
  const yuv = ([r, g, b]: Colour) => {
    const l = kr * r + (1 - kr - kb) * g + kb * b
    return [
      16 + l * 219 / 255,
      128 + (b - l) / (2 * (1 - kb)) * 224 / 255,
      128 + (r - l) / (2 * (1 - kr)) * 224 / 255,
    ].map(Math.round)
  }
  for (const c of colours) {
    const [y, u, v] = yuv(c)
    const i420 = Uint8Array.from([y, y, y, y, u, v])
    const nv12 = Uint8Array.from([y, y, y, y, u, v])
    const a = Z.frameToRgba(i420, [planeAt(0, 2), planeAt(4, 1), planeAt(5, 1)], 'I420', 2, 2, BT709)
    const b = Z.frameToRgba(nv12, [planeAt(0, 2), planeAt(4, 2)], 'NV12', 2, 2, BT709)
    for (const out of [a, b]) {
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(out[12 + k] - c[k]) <= 3, `${c} → ${[...out.slice(12, 15)]}`)
    }
  }
  const [r, g, b] = [61, 178, 129]
  const l = .299 * r + .587 * g + .114 * b
  const full = Uint8Array.from([l, 128 + (b - l) / 1.772, 128 + (r - l) / 1.402].map(Math.round))
  const f = Z.frameToRgba(
    Uint8Array.from([full[0], full[1], full[2]]),
    [planeAt(0, 1), planeAt(1, 1), planeAt(2, 1)],
    'I420',
    1,
    1,
    BT601_FULL,
  )
  assert.ok(
    Math.abs(f[0] - r) <= 2 && Math.abs(f[1] - g) <= 2 && Math.abs(f[2] - b) <= 2,
    String([...f]),
  )
  assert.deepEqual([...Z.frameToRgba(Uint8Array.from([9, 8, 7, 0]), [planeAt(0, 4)], 'BGRX', 1, 1)], [7, 8, 9, 255])
  // Other GPUs and drivers: I420A (alpha plane ignored), I422 (2×1 chroma) and I444 (full chroma) read the same colour.
  const [y, u, v] = yuv([61, 178, 129])
  const layouts: Record<string, [Uint8Array, Z.PlaneLayout[]]> = {
    I420A: [
      Uint8Array.from([y, y, y, y, u, v, 255, 255, 255, 255]),
      [planeAt(0, 2), planeAt(4, 1), planeAt(5, 1), planeAt(6, 2)],
    ],
    I422: [
      Uint8Array.from([y, y, y, y, u, u, v, v]),
      [planeAt(0, 2), planeAt(4, 1), planeAt(6, 1)],
    ],
    I444: [
      Uint8Array.from([y, y, y, y, u, u, u, u, v, v, v, v]),
      [planeAt(0, 2), planeAt(4, 2), planeAt(8, 2)],
    ],
  }
  for (const [format, [buf, layout]] of Object.entries(layouts)) {
    const out = Z.frameToRgba(buf, layout, format, 2, 2, BT709)
    for (const o of [0, 12]) {
      const isGreen = Math.abs(out[o] - 61) <= 3 && Math.abs(out[o + 1] - 178) <= 3
        && Math.abs(out[o + 2] - 129) <= 3
      assert.ok(isGreen, `${format}: ${[...out.slice(o, o + 3)]}`)
    }
  }
  // A reused output buffer is filled in place.
  const reuse = new Uint8ClampedArray(16)
  assert.equal(Z.frameToRgba(...layouts.I444, 'I444', 2, 2, BT709, reuse), reuse)
  // 10-bit and other formats are never read directly: the layer asks the browser for RGBX instead.
  assert.ok(!Z.FRAME_FORMATS.test('I420P10') && !Z.FRAME_FORMATS.test('RGBAF16') && Z.FRAME_FORMATS.test('NV12'))
  assert.throws(() => Z.frameToRgba(new Uint8Array(4), [planeAt(0, 4)], 'I420P10', 1, 1), /Unsupported/)
})

test('Reading single pixels gives the colour of the full conversion, in every format', () => {
  // Random planes for a 6×4 frame (odd strides and offsets, as the browser may lay them out).
  let seed = 7
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed >>> 24
  }
  interface Plane {
    w: number
    h: number
    stride: number
    data: number[]
  }
  const plane = (w: number, h: number, stride: number): Plane => ({
    w,
    h,
    stride,
    data: Array.from({
      length: stride * h,
    }, rnd),
  })
  const pack = (planes: Plane[]): [Uint8Array, Z.PlaneLayout[]] => {
    const layout: Z.PlaneLayout[] = []
    const bytes: number[] = []
    for (const p of planes) {
      layout.push(planeAt(bytes.length + 3, p.stride))
      bytes.push(0, 0, 0, ...p.data)
    }
    return [Uint8Array.from(bytes), layout]
  }
  const W = 6
  const H = 4
  const frames = {
    I420: [plane(W, H, 7), plane(3, 2, 4), plane(3, 2, 5)],
    I420A: [plane(W, H, 6), plane(3, 2, 3), plane(3, 2, 3), plane(W, H, 6)],
    I422: [plane(W, H, 6), plane(3, 4, 3), plane(3, 4, 4)],
    I444: [plane(W, H, 6), plane(W, H, 6), plane(W, H, 7)],
    NV12: [plane(W, H, 6), plane(6, 2, 6)],
    RGBX: [plane(W * 4, H, W * 4)],
    BGRX: [plane(W * 4, H, W * 4 + 4)],
  }
  for (const [format, planes] of Object.entries(frames)) {
    for (const space of [BT709, BT601_FULL]) {
      const [buf, layout] = pack(planes)
      const all = Z.frameToRgba(buf, layout, format, W, H, space)
      const read = Z.pixelReader(buf, layout, format, space)
      const px = [0, 0, 0]
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          read(x, y, px)
          const o = (y * W + x) * 4
          for (let k = 0; k < 3; k++) {
            assert.ok(Math.abs(px[k] - all[o + k]) <= 1, `${format} ${x},${y}: ${px} vs ${[...all.slice(o, o + 3)]}`)
          }
        }
      }
    }
  }
})

test('A recognised rim is followed when the map moves or zooms, and let go when it jumps too far', () => {
  // A tinted disc with a bright rim on a grey map, as the game draws the zone, at (cx, cy) with radius r.
  const W = 640
  const H = 520
  const disc = (cx: number, cy: number, r: number): Z.RgbaImage => {
    const d = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4
        const e = Math.hypot(x + .5 - cx, y + .5 - cy) - r
        let c = [92, 94, 96]
        if (e < 0 && e > -5) c = [61, 178, 129]
        else if (e <= -5) c = [80, 120, 104]
        d[o] = c[0]
        d[o + 1] = c[1]
        d[o + 2] = c[2]
        d[o + 3] = 255
      }
    }
    return {
      width: W,
      height: H,
      data: d,
    }
  }
  const start = Z.ringCandidates(disc(300, 260, 180))[0]
  assert.ok(start && Math.abs(start.r - 180) < 1.5, 'found by the full search')
  for (const [cx, cy, r] of [[300, 260, 180], [322, 248, 180], [300, 260, 196], [290, 270, 166]]) {
    const t = Z.trackRing(disc(cx, cy, r), start)
    assert.ok(
      t && Math.hypot(t.cx - cx, t.cy - cy) < 1 && Math.abs(t.r - r) < 1.5,
      `tracked to ${cx},${cy} r ${r}: ${t && [t.cx, t.cy, t.r].map((v) => v.toFixed(1))}`,
    )
  }
  // A steady pan of 45 px a frame is beyond the rays alone, but the motion of the frame before predicts it.
  const a = Z.trackRing(disc(345, 260, 180), start, null)
  const b = Z.trackRing(disc(390, 260, 180), {
    ...start,
    cx: 345,
  }, start)
  assert.ok(b && Math.abs(b.cx - 390) < 1, 'a steady pan is predicted')
  assert.equal(Z.trackRing(disc(300, 260, 250), start), null, 'a 40 % zoom jump is left to the full search')
  assert.ok(a === null || Math.abs(a.cx - 345) < 1)
})

test('A rim is the zone that sits at its place on the terrain fix, if the size matches', () => {
  // zoneAtPlace reads only id, pos and radiusM.
  const zones = [
    {
      id: 'a',
      pos: [.5, .5],
      radiusM: 500,
    },
    {
      id: 'b',
      pos: [.3, .7],
      radiusM: 500,
    },
  ] as Zone[]
  const fix = {
    x0: 70,
    y0: 95,
    s: 4,
  }
  const ring = (cx: number, r = 125) => ({
    cx,
    cy: 327,
    r,
  })
  // Zone a at game (81.92, 81.92): capture px ((81.92-70)·25, (95-81.92)·25) = (298, 327), radius 125 px.
  assert.equal(Z.zoneAtPlace(zones, fix, ring(298))?.id, 'a')
  assert.equal(Z.zoneAtPlace(zones, fix, ring(298 + 10))?.id, 'a', '40 m off: within 60 m')
  assert.equal(Z.zoneAtPlace(zones, fix, ring(298 + 25)), null, '100 m off')
  assert.equal(Z.zoneAtPlace(zones, fix, ring(298, 140)), null, '12 % too large: a marker circle, not the zone')
})

test('Every control zone has a 64×64 patch generated from the offline maps', () => {
  const keys = Object.entries(MAP_LANDMARKS).flatMap(([world, meta]) => meta.zones.map((z) => `${world}/${z.id}`))
  assert.deepEqual(Object.keys(ZONE_PATCHES.patches).sort(), keys.sort())
  for (const text of Object.values(ZONE_PATCHES.patches)) {
    assert.equal(Z.decodePatch(text).length, ZONE_PATCHES.size ** 2)
  }
})
