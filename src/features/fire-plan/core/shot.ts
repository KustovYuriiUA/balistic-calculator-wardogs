import type { GamePoint } from '@/shared/geometry'
import { t } from '@/shared/i18n'

const NUMBER = '[+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)'
// Latin and Cyrillic x/y: pasted from the game, from a chat, typed on either layout.
const TAGGED = () => new RegExp('([xyху])\\s*[:=]?\\s*(' + NUMBER + ')', 'gi')
const UNTAGGED = new RegExp('^(' + NUMBER + ')(?:\\s*[;]\\s*|\\s+|,\\s+)(' + NUMBER + ')$')

const toNumber = (v: string) => Number(v.replace(',', '.'))

/** "Y102 X88", "x88, y102", "Y: 102; X: 88" or two numbers, Y first: "102 88". Throws with a message for the
 * user. */
export function parseCoordinate(text: string): GamePoint {
  const value = String(text).trim().replace(/−/g, '-')
  const tagged = [...value.matchAll(TAGGED())]
  let point: GamePoint
  if (tagged.length) {
    const rest = value.replace(TAGGED(), '').replace(/[\s,;()[\]{}]/g, '')
    const entries = tagged.map((m) => [/[xх]/i.test(m[1]) ? 'x' : 'y', toNumber(m[2])] as const)
    const isPair = entries.length === 2 && entries[0][0] !== entries[1][0]
    if (rest || !isPair) throw new Error(t('err.twoCoords'))
    point = Object.fromEntries(entries) as unknown as GamePoint
  } else {
    const clean = value.replace(/^[([\s]+|[)\]\s]+$/g, '')
    const match = clean.match(UNTAGGED)
    if (!match) throw new Error(t('err.format'))
    point = {
      y: toNumber(match[1]),
      x: toNumber(match[2]),
    }
  }
  const isFinitePoint = Number.isFinite(point.x) && Number.isFinite(point.y)
  if (!isFinitePoint || Math.max(Math.abs(point.x), Math.abs(point.y)) > 1e9) throw new Error(t('err.finite'))
  return point
}

export interface Shot {
  aim: GamePoint
  targetDistance: number
  hitDistance: number
  coefficient: number
  /** The range to set, or null when the range fired is not known (the coefficient still applies). */
  distance: number | null
}

// The correction assumes a constant angular error and a range proportional to the one fired, from the same
// position: coefficient = distance to target ÷ distance to impact; the direction error is subtracted.
export function calculateShot(
  player: GamePoint,
  target: GamePoint,
  hit: GamePoint,
  distance: number | null,
  previousAim: GamePoint = target,
): Shot {
  const length = (p: GamePoint) => Math.hypot(p.x - player.x, p.y - player.y)
  const targetLength = length(target)
  const hitLength = length(hit)
  if (targetLength < 1e-9) throw new Error(t('err.samePos'))
  if (hitLength < 1e-9) throw new Error(t('err.hitAtPlayer'))
  if (length(previousAim) < 1e-9) throw new Error(t('err.aimAtPlayer'))
  if (distance !== null && (!Number.isFinite(distance) || distance <= 0)) throw new Error(t('err.distancePositive'))
  const bearing = (p: GamePoint) => Math.atan2(p.x - player.x, p.y - player.y)
  const angle = bearing(target) - (bearing(hit) - bearing(previousAim))
  const coefficient = targetLength / hitLength
  const result: Shot = {
    aim: {
      y: player.y + targetLength * Math.cos(angle),
      x: player.x + targetLength * Math.sin(angle),
    },
    targetDistance: targetLength * 100,
    hitDistance: hitLength * 100,
    coefficient,
    distance: distance === null ? null : distance * coefficient,
  }
  if (result.distance !== null && !Number.isFinite(result.distance)) throw new Error(t('err.tooFar'))
  return result
}
