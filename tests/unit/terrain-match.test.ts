import assert from 'node:assert/strict'

import { test } from 'vitest'

import * as T from '@/features/game-map/core'
import { fft2 } from '@/features/game-map/core/terrain/fft'
import { MAP_EXTENT } from '@/shared/geometry'

// Synthetic terrain, 512² = 32 m/px for the 16 384 m world: coarse blobs, finer detail and noise.
function terrain(seed: number): T.LumaImage {
  let s = seed
  const rnd = () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }
  const grid = (n: number) => {
    const g = Float32Array.from({
      length: (n + 1) * (n + 1),
    }, rnd)
    return (x: number, y: number) => {
      const gx = x * n
      const gy = y * n
      const i = Math.min(n - 1, Math.floor(gx))
      const j = Math.min(n - 1, Math.floor(gy))
      const fx = gx - i
      const fy = gy - j
      const a = g[j * (n + 1) + i]
      const b = g[j * (n + 1) + i + 1]
      const c = g[(j + 1) * (n + 1) + i]
      const d = g[(j + 1) * (n + 1) + i + 1]
      return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
    }
  }
  const coarse = grid(24)
  const fine = grid(160)
  const n = 512
  const data = new Float32Array(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      data[y * n + x] = 120 * coarse(x / n, y / n) + 80 * fine(x / n, y / n) + 20 * rnd()
    }
  }
  return {
    width: n,
    height: n,
    data,
  }
}

// A capture of w×h pixels at s metres per pixel with its corner at game units (x0, y0), greyed and noisy like the game.
function capture(map: T.LumaImage, at: T.Fix, w = 300, h = 280, seed = 5): T.Capture {
  const I = T.integralOf(map)
  const k = map.width / MAP_EXTENT
  const l = T.resampleBox(
    I,
    at.x0 * k,
    (MAP_EXTENT - at.y0) * k,
    (at.x0 + w * at.s / 100) * k,
    (MAP_EXTENT - at.y0 + h * at.s / 100) * k,
    w,
    h,
  )
  let r = seed
  const noise = () => {
    r = (r * 16807) % 2147483647
    return r / 2147483647 - .5
  }
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const g = .6 * l.data[i] + 40 + noise() * 12
    rgba.set([g, g + 8, g, 255], i * 4)
  }
  return T.captureOf({
    width: w,
    height: h,
    data: rgba,
  })
}

// The capture template of terrain/fix.ts (captureTemplate, not exported) rebuilt from the public steps: the
// capture's centre inside a 10 % inset, resampled to level r at scale s, high-passed with the levels' radius (3).
// Not zero-meaned: searchWide and searchWidePair zero-mean the template themselves.
function templateOf(cap: T.Capture, r: number, s: number, max: number): T.LumaImage {
  const inset = .1
  const iw = cap.width * (1 - 2 * inset)
  const ih = cap.height * (1 - 2 * inset)
  const k = Math.min(1, max / Math.max(iw, ih) * r / s)
  const w = Math.max(4, Math.floor(iw * s / r * k))
  const h = Math.max(4, Math.floor(ih * s / r * k))
  const cw = w * r / s
  const ch = h * r / s
  const x0 = (cap.width - cw) / 2
  const y0 = (cap.height - ch) / 2
  return T.highPass(T.resampleBox(cap.I, x0, y0, x0 + cw, y0 + ch, w, h), 3)
}

const metres = (a: T.Fix, b: T.Fix, cap: T.Capture) => {
  const p = T.fixToWorld(a, cap.width / 2, cap.height / 2)
  const q = T.fixToWorld(b, cap.width / 2, cap.height / 2)
  return Math.hypot(p.x - q.x, p.y - q.y) * 100
}

const home = T.mapPyramid(terrain(11))
const other = T.mapPyramid(terrain(97))

test('FFT forward and inverse give the input back', () => {
  const n = 16
  const re = Float64Array.from({
    length: n * n,
  }, (_, i) => Math.sin(i * .37) * 10 + i % 5)
  const im = new Float64Array(n * n)
  const copy = Float64Array.from(re)
  fft2(re, im, n, false)
  fft2(re, im, n, true)
  for (let i = 0; i < n * n; i++) {
    assert.ok(Math.abs(re[i] / (n * n) - copy[i]) < 1e-9 && Math.abs(im[i] / (n * n)) < 1e-9)
  }
})

test('Two templates through one packed FFT give the same peaks as two single searches', () => {
  const cap = capture(terrain(11), {
    x0: 52.3,
    y0: 101.7,
    s: 40,
  })
  const level = home[1]
  const a = templateOf(cap, level.r, 40, 80)
  const b = templateOf(cap, level.r, 44, 80)
  const [pa, pb] = T.searchWidePair(level, a, b, 2)
  for (const [pair, single] of [[pa, T.searchWide(level, a, 2)], [pb, T.searchWide(level, b, 2)]]) {
    assert.equal(pair.length, single.length)
    pair.forEach((p, i) => {
      assert.equal(p.u, single[i].u)
      assert.equal(p.v, single[i].v)
      assert.ok(Math.abs(p.score - single[i].score) < 1e-9)
    })
  }
})

test('Pyramid levels halve down to 128² at 32, 64 and 128 m/px', () => {
  assert.deepEqual(home.map((l) => [l.r, l.img.width]), [[32, 512], [64, 256], [128, 128]])
})

test('Acquisition finds scale and position of a capture without any circle, and rejects another map', () => {
  const truth = {
    x0: 52.3,
    y0: 101.7,
    s: 18,
  }
  const cap = capture(terrain(11), truth)
  const range = {
    minS: 8,
    maxS: 60,
  }
  const fix = T.acquireFix(home, cap, range)
  assert.ok(fix?.isConfident, JSON.stringify(fix))
  assert.ok(
    metres(fix, truth, cap) < 40 && Math.abs(fix.s / truth.s - 1) < .03,
    `${metres(fix, truth, cap).toFixed(1)} m, s ${fix.s.toFixed(2)}`,
  )
  const wrong = T.acquireFix(other, cap, range)
  assert.ok(wrong && !wrong.isConfident && wrong.score < fix.score - .2, JSON.stringify(wrong && {
    score: wrong.score,
    lead: wrong.lead,
  }))
})

test('Tracking follows a small pan and zoom; recovery a wheel-notch jump; a frame of another map is lost', () => {
  const truth = {
    x0: 40,
    y0: 120,
    s: 20,
  }
  const map = terrain(11)
  const cap = capture(map, truth)
  const tracked = T.trackFix(home, cap, {
    x0: 40.4,
    y0: 119.7,
    s: 20 * 1.025,
  })
  assert.ok(tracked && metres(tracked, truth, cap) < 40, 'tracked')
  const jumped = {
    x0: 38.5,
    y0: 121.2,
    s: 20 * 1.22,
  }
  const recovered = T.trackFix(home, cap, jumped) || T.recoverFix(home, cap, jumped)
  assert.ok(recovered && metres(recovered, truth, cap) < 40, 'recovered')
  assert.equal(T.trackFix(home, capture(terrain(97), truth), truth), null, 'another map drops the lock')
})

test('Game units ↔ capture pixels of a fix', () => {
  const fix = {
    x0: 65.12,
    y0: 108.82,
    s: 1.334,
  }
  const p = T.fixToWorld(fix, 400, 300)
  assert.ok(Math.abs(p.x - (65.12 + 4 * 1.334)) < 1e-9)
  assert.ok(Math.abs(p.y - (108.82 - 3 * 1.334)) < 1e-9)
  const back = T.worldToFix(fix, p.x, p.y)
  assert.ok(Math.abs(back.x - 400) < 1e-9 && Math.abs(back.y - 300) < 1e-9)
})
