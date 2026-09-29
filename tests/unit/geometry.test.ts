import assert from 'node:assert/strict'

import { afterEach, test } from 'vitest'

import { azimuth, formatAzimuth } from '@/shared/geometry'
import { setLanguage } from '@/shared/i18n'

afterEach(() => {
  setLanguage('en')
})

test('Compass azimuth: cardinal directions, quadrants, wrap and coincident positions', () => {
  const p = {
    x: 20,
    y: 20,
  }
  const cases = [
    [20, 30, 0],
    [30, 20, 90],
    [20, 10, 180],
    [10, 20, 270],
    [30, 30, 45],
    [10, 30, 315],
  ]
  for (const [x, y, expected] of cases) {
    assert.equal(azimuth(p, {
      x,
      y,
    }), expected)
  }
  assert.equal(azimuth(p, p), null)
  assert.ok((azimuth(p, {
    x: 19.99,
    y: 30,
  }) ?? -1) > 359)
})

const DIAL: [number | null, string][] = [
  [0, '000.0°'],
  [43.24, '043.2°'],
  [90, '090.0°'],
  [210.44, '210.4°'],
  [359.96, '000.0°'],
  [null, '—'],
]

test('Azimuth reads like a compass dial: three digits, tenths, wrap to 000', () => {
  for (const [value, expected] of DIAL) assert.equal(formatAzimuth(value), expected)
})

test('Azimuth takes the decimal separator of the language: a comma in Russian', () => {
  setLanguage('ru')
  for (const [value, expected] of DIAL) assert.equal(formatAzimuth(value), expected.replace('.', ','))
  setLanguage('en')
  assert.equal(formatAzimuth(43.24), '043.2°')
})
