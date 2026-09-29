import { azimuth, range, type GamePoint } from '@/shared/geometry'

import type { Preset, Target } from './presets'
import { calculateShot, parseCoordinate } from './shot'

const toNumber = (text: string) => Number(text.replace(',', '.'))

interface Solution {
  aim: GamePoint
  distance: number | null
  coefficient?: number
  hitDistance?: number
}

/** The shot for a target: corrected once an impact is marked, else straight at the target. null on bad data. */
function solve(preset: Preset, t: Target): Solution | null {
  const player = preset.player
  if (!player) return null
  try {
    if (!t.hit) {
      return {
        aim: t.point,
        distance: toNumber(String(t.distance || '')) || range(player, t.point),
      }
    }
    const distance = t.distance?.trim() ? toNumber(t.distance) : null
    const previousAim = t.previousAim ? parseCoordinate(t.previousAim) : t.point
    return calculateShot(player, t.point, parseCoordinate(t.hit), distance, previousAim)
  } catch {
    return null
  }
}

export interface FireSolution {
  isCorrected: boolean
  azimuth: number | null
  /** Change of azimuth by the correction, degrees, −180…180. */
  delta: number
  range: number | null
  coefficient?: number
  hitDistance?: number
  targetDistance: number
  aim: GamePoint
  shots: number
}

/** What to dial in the game for this target. null without a position or target; isError: bad impact data. */
export function fire(
  preset: Preset,
  t: Target | undefined,
): FireSolution | { isError: true } | null {
  const player = preset.player
  if (!player || !t) return null
  const result = solve(preset, t)
  if (!result) {
    return {
      isError: true,
    }
  }
  const isCorrected = Boolean(t.hit)
  const base = azimuth(player, t.point)
  const az = isCorrected ? azimuth(player, result.aim) : base
  return {
    isCorrected,
    azimuth: az,
    delta: isCorrected && az !== null && base !== null ? (az - base + 540) % 360 - 180 : 0,
    range: result.distance,
    coefficient: result.coefficient,
    hitDistance: result.hitDistance,
    targetDistance: range(player, t.point),
    aim: result.aim,
    shots: t.shots || (isCorrected ? 1 : 0),
  }
}

export const isValidFire = (f: ReturnType<typeof fire>): f is FireSolution => Boolean(f && !('isError' in f))

/** The previous correction, for chaining a new impact from it. */
export const previousShot = (preset: Preset, t: Target) => (t.hit ? solve(preset, t) : null)
