import assert from 'node:assert/strict'

import { test } from 'vitest'

import { calculateShot as calc, parseCoordinate as parse } from '@/features/fire-plan/core/shot'

test('Pasted coordinate formats, reversed axes and decimal commas', () => {
  const formats = ['Y102 X88', 'x88 y102', 'Y: 102; X: 88', '102 88', '(102; 88)', '102, 88', 'у102 х88']
  for (const value of formats) {
    assert.deepEqual(parse(value), {
      y: 102,
      x: 88,
    }, value)
  }
  assert.deepEqual(parse('Y-102,5 X+88.2'), {
    y: -102.5,
    x: 88.2,
  })
  const invalid = ['', '102', '102 88 99', 'x1 x2', 'y2', 'NaN 2', 'y1 x2 garbage', 'yInfinity x2', '102,88']
  for (const value of invalid) assert.throws(() => parse(value), value)
})

test('User example uses 100 metres and corrects heading separately from range', () => {
  const result = calc({
    y: 102,
    x: 88,
  }, {
    y: 80,
    x: 72,
  }, {
    y: 93,
    x: 80,
  }, 2720.29410174709)
  assert.ok(Math.abs(result.targetDistance - 2720.29410174709) < 1e-8)
  assert.ok(Math.abs(result.hitDistance - 1204.15945787923) < 1e-8)
  assert.ok(Math.abs(result.coefficient - 2.25908129022886) < 1e-10)
  assert.ok(result.distance !== null && Math.abs(result.distance - 6145.36550917676) < 1e-8)
  assert.ok(Math.abs(result.aim.y - 78.54) < .01)
  assert.ok(Math.abs(result.aim.x - 74.23) < .01)
})

test('Direct hit keeps aim and distance; overshoot reduces setting', () => {
  const p = {
    x: 0,
    y: 0,
  }
  const t = {
    x: 0,
    y: 10,
  }
  assert.deepEqual(calc(p, t, t, 2000), {
    aim: t,
    targetDistance: 1000,
    hitDistance: 1000,
    coefficient: 1,
    distance: 2000,
  })
  assert.equal(calc(p, t, {
    x: 0,
    y: 20,
  }, 2000).distance, 1000)
  assert.equal(calc(p, t, {
    x: 0,
    y: 5,
  }, null).distance, null)
})

test('A repeated calibrated shot accounts for the previous aim', () => {
  const p = {
    x: 0,
    y: 0,
  }
  const t = {
    x: 0,
    y: 10,
  }
  const a = {
    x: 10,
    y: 0,
  }
  const result = calc(p, t, t, 700, a)
  assert.ok(Math.abs(result.aim.x - 10) < 1e-9)
  assert.ok(Math.abs(result.aim.y) < 1e-9)
  assert.equal(result.distance, 700)
})

test('Undefined headings and invalid distance are rejected', () => {
  const p = {
    x: 0,
    y: 0,
  }
  const t = {
    x: 0,
    y: 10,
  }
  assert.throws(() => calc(p, p, t, 10))
  assert.throws(() => calc(p, t, p, 10))
  assert.throws(() => calc(p, t, t, 10, p))
  // '100': a string from an input field must not pass for a range.
  for (const range of [0, -1, NaN, Infinity, '100']) assert.throws(() => calc(p, t, t, range as number))
})
