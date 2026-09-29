import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  areaFromSelection,
  readArea,
  resolveArea,
  saveArea,
  snapArea,
  validArea,
  type SavedArea,
} from '@/features/game-map/main/map-area'
import {
  FPS_CHOICES,
  cleanClick,
  cleanFps,
  cleanMemory,
  cleanStatus,
} from '@/features/game-map/main/validate'

const rect = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
})

const main = {
  id: 101,
  bounds: rect(0, 0, 2560, 1440),
}
const left = {
  id: 7,
  bounds: rect(-1920, 0, 1920, 1080),
}
const wide = {
  id: 7,
  bounds: rect(0, 0, 5120, 1440),
}

describe('game map area', () => {
  it('a picker rectangle becomes a screen area on that monitor, clamped, at least 120 px', () => {
    expect(areaFromSelection(rect(172.4, 97.6, 876.2, 878), main)).toEqual({
      display: {
        id: '101',
        bounds: main.bounds,
      },
      rect: rect(172, 98, 877, 878),
      isSnapped: false,
    })
    const clamped = areaFromSelection(rect(1500, -20, 600, 500), left)?.rect
    expect(clamped, 'negative monitor, clamped to its edges').toEqual(rect(-420, 0, 420, 480))
    expect(areaFromSelection(rect(10, 10, 119, 400), main)).toBeNull()
    expect(areaFromSelection(rect(NaN, 0, 500, 500), main)).toBeNull()
  })

  it('a saved area applies only to the same monitor at the same position and resolution', () => {
    const area = areaFromSelection(rect(100, 100, 800, 800), main)!
    expect(resolveArea(area, [left, main])).toEqual({
      display: main,
      rect: area.rect,
      isSnapped: false,
    })
    expect(resolveArea(area, [left]), 'monitor unplugged').toBeNull()
    const smaller = {
      ...main,
      bounds: rect(0, 0, 1920, 1080),
    }
    expect(resolveArea(area, [smaller]), 'resolution changed').toBeNull()
    expect(resolveArea(null, [main])).toBeNull()
  })

  it('a loosely drawn area snaps to the map panel found in it; implausible panels are refused', () => {
    // The user's real case: area 1076×987 with a margin of 3D world, panel 880×881 inside it.
    const drawn = areaFromSelection(rect(2031, 216, 1076, 987), wide)!
    expect(snapArea(drawn, rect(2122.4, 276.6, 879.8, 880.9))).toEqual({
      display: drawn.display,
      rect: rect(2122, 277, 880, 881),
      isSnapped: true,
    })
    expect(snapArea(drawn, rect(2122, 277, 880, 700)), 'not square').toBeNull()
    expect(snapArea(drawn, rect(2200, 300, 400, 400)), 'too small for the drawn area').toBeNull()
    expect(snapArea(drawn, rect(1500, 277, 880, 880)), 'far outside the drawn area').toBeNull()
    expect(snapArea(drawn, rect(2122, NaN, 880, 880))).toBeNull()
    const snapped = snapArea(drawn, rect(2122, 277, 880, 881))
    expect(resolveArea(snapped, [wide])?.isSnapped).toBe(true)
  })

  it('the area file keeps 1.x field names; broken or tampered files are ignored', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-area-'))
    const file = path.join(dir, 'nested', 'map-area.json')
    try {
      const drawn = areaFromSelection(rect(100, 100, 800, 800), main)!
      const area = snapArea(drawn, rect(100, 100, 800, 800))!
      expect(saveArea(file, area)).toBe(true)
      expect(readArea(file)).toEqual(area)
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).snapped).toBe(true)
      fs.writeFileSync(file, '{')
      expect(readArea(file)).toBeNull()
      const onDisk = (a: SavedArea) => ({
        display: a.display,
        rect: a.rect,
        snapped: a.isSnapped,
      })
      const outside = {
        ...onDisk(area),
        rect: {
          ...area.rect,
          x: 2000,
        },
      }
      expect(validArea(outside), 'outside the monitor').toBeNull()
      const numericId = {
        ...onDisk(area),
        display: {
          ...area.display,
          id: 5,
        },
      }
      expect(validArea(numericId), 'id must be a string').toBeNull()
    } finally {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
      })
    }
  })
})

describe('game map layer messages', () => {
  const empty = {
    key: null,
    isRecognised: false,
    isCalibrated: false,
    source: null,
    world: null,
    metresPerPixel: null,
    isOpen: null,
    progress: null,
    isFailed: false,
    message: null,
  }

  it('the layer status is sanitised before it reaches the overlay', () => {
    const locked = {
      state: 'locked',
      key: 'northamerica/zestafona-default',
      isRecognised: true,
      isCalibrated: true,
      source: 'rim',
      world: 'northamerica',
      metresPerPixel: 1.33,
      isOpen: true,
    }
    expect(cleanStatus({
      ...locked,
      extra: 1,
    })).toEqual({
      ...empty,
      ...locked,
    })
    expect(cleanStatus({
      state: 'acquiring',
      isOpen: null,
      progress: .35,
    })).toEqual({
      ...empty,
      state: 'acquiring',
      progress: .35,
    })
    for (const state of ['closed', 'open', 'searching']) {
      expect(cleanStatus({
        state,
      }).state).toBe(state)
    }
    const hostile = {
      state: 'hack',
      key: {},
      isRecognised: 'yes',
      isCalibrated: 1,
      source: 'eval',
      world: 'x'.repeat(41),
      metresPerPixel: '1',
      isOpen: 'yes',
      progress: 2,
      isFailed: 1,
      message: 'x'.repeat(500),
    }
    expect(cleanStatus(hostile)).toEqual({
      ...empty,
      state: 'error',
    })
  })

  it('a remembered calibration of the game map has a known shape only', () => {
    const fix = {
      x0: 65.15,
      y0: 108.79,
      s: 1.326,
    }
    const memory = {
      world: 'northamerica',
      key: 'northamerica/zestafona-default',
      fix,
    }
    expect(cleanMemory({
      ...memory,
      extra: 1,
    })).toEqual(memory)
    expect(cleanMemory({
      world: 'europe',
      key: '<b>',
      fix,
    })).toEqual({
      world: 'europe',
      key: null,
      fix,
    })
    const withFix = (change: Partial<typeof fix>) => ({
      world: 'europe',
      fix: {
        ...fix,
        ...change,
      },
    })
    const bad = [
      null,
      {
        world: 'Europe',
        fix,
      },
      {
        world: 'europe',
      },
      withFix({
        s: 0,
      }),
      withFix({
        x0: NaN,
      }),
      withFix({
        y0: 1e6,
      }),
    ]
    for (const value of bad) expect(cleanMemory(value)).toBeNull()
  })

  it('the poll rate of the game map capture is one of the menu choices, 60 by default', () => {
    expect(FPS_CHOICES).toEqual([15, 30, 60, 120])
    for (const v of FPS_CHOICES) expect(cleanFps(v)).toBe(v)
    for (const v of [undefined, 0, 59, '60', 1e6, -5]) expect(cleanFps(v)).toBe(60)
  })

  it('layer clicks: game units, left or right button, a pin is my position or a target number', () => {
    expect(cleanClick({
      x: 70.12,
      y: 103,
      button: 'left',
      pin: 'player',
      extra: 1,
    })).toEqual({
      x: 70.12,
      y: 103,
      button: 'left',
      pin: 'player',
    })
    const right = {
      x: 72,
      y: 101,
      button: 'right',
      pin: 3,
    }
    expect(cleanClick(right)).toEqual(right)
    for (const pin of ['<b>', -1]) {
      expect(cleanClick({
        x: 72,
        y: 101,
        button: 'left',
        pin,
      })?.pin).toBeNull()
    }
    const click = (x: unknown, y: unknown, button: string) => ({
      x,
      y,
      button,
    })
    const bad = [null, click('1', 2, 'left'), click(1, NaN, 'left'), click(1, 2, 'middle'), click(1e9, 2, 'left')]
    for (const value of bad) expect(cleanClick(value)).toBeNull()
  })
})
