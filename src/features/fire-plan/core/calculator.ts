import { azimuth, type GamePoint } from '@/shared/geometry'
import { t } from '@/shared/i18n'

import { calculateShot, parseCoordinate } from './shot'

export type CalcField = 'player' | 'target' | 'hit' | 'distance' | 'previousAim'

export type CalcFields = Record<CalcField, string>

export const emptyFields = (): CalcFields => ({
  player: '',
  target: '',
  hit: '',
  distance: '',
  previousAim: '',
})

export type CalcErrors = Partial<Record<CalcField | 'form', string>>

export interface CalcDiagram {
  player: GamePoint
  target: GamePoint
  hit?: GamePoint
  aim?: GamePoint
}

export type CalcNote =
  | {
    kind: 'test'
  }
  | {
    kind: 'base'
  }
  | {
    kind: 'coefficient'
  }
  | {
    kind: 'previous'
    distance: number
    coefficient: number
  }

/** A shown result: the range to the target (base) or the corrected shot. */
export interface CalcResult {
  kind: 'base' | 'shot'
  aim: GamePoint
  azimuth: number | null
  /** Metres to set; null when the range fired is not known (only the coefficient applies). */
  distance: number | null
  coefficient: number | null
  targetDistance: number
  hitDistance: number | null
  note: CalcNote
  diagram: CalcDiagram
}

export interface Parsed {
  points: Partial<Record<CalcField, GamePoint>>
  errors: CalcErrors
  /** The first field with an error, to focus. */
  invalid: CalcField | null
}

function parseFields(fields: CalcFields, names: CalcField[]): Parsed {
  const parsed: Parsed = {
    points: {},
    errors: {},
    invalid: null,
  }
  for (const name of names) {
    if (name === 'previousAim' && !fields.previousAim.trim()) continue
    try {
      parsed.points[name] = parseCoordinate(fields[name])
    } catch (error) {
      parsed.errors[name] = (error as Error).message
      parsed.invalid ??= name
    }
  }
  return parsed
}

export type BaseOutcome =
  | {
    isOk: true
    metres: number
    result: CalcResult
  }
  | {
    isOk: false
    errors: CalcErrors
    invalid: CalcField | null
  }

/** The range from the position to the target: becomes the test shot's range. */
export function calculateBase(fields: CalcFields): BaseOutcome {
  const {
    points, errors, invalid,
  } = parseFields(fields, ['player', 'target'])
  if (invalid) {
    return {
      isOk: false,
      errors,
      invalid,
    }
  }
  const player = points.player!
  const target = points.target!
  const metres = Math.hypot(target.x - player.x, target.y - player.y) * 100
  if (metres < .005) {
    return {
      isOk: false,
      errors: {
        target: t('calc.samePoint'),
      },
      invalid: null,
    }
  }
  return {
    isOk: true,
    metres,
    result: {
      kind: 'base',
      aim: target,
      azimuth: azimuth(player, target),
      distance: Number(metres.toFixed(2)),
      coefficient: null,
      targetDistance: metres,
      hitDistance: null,
      note: {
        kind: 'test',
      },
      diagram: {
        player,
        target,
      },
    },
  }
}

const RANGE = /^[+]?\d+(?:[.,]\d+)?$/

export type ShotOutcome =
  | {
    isOk: true
    result: CalcResult
  }
  | {
    isOk: false
    errors: CalcErrors
    invalid: CalcField | null
  }

/** The corrected shot from the impact of the test shot (and the range fired, when given). */
export function calculateCorrection(fields: CalcFields): ShotOutcome {
  const parsed = parseFields(fields, ['player', 'target', 'hit', 'previousAim'])
  const { points, errors } = parsed
  let invalid = parsed.invalid
  const raw = fields.distance.trim()
  const compact = raw.replace(/\s/g, '')
  const distance = raw ? Number(compact.replace(',', '.')) : null
  const isBadDistance = raw !== '' && (!RANGE.test(compact) || !Number.isFinite(distance) || (distance as number) <= 0)
  if (isBadDistance) {
    errors.distance = t('calc.positiveMetres')
    invalid ??= 'distance'
  }
  if (invalid) {
    return {
      isOk: false,
      errors,
      invalid,
    }
  }
  const player = points.player!
  const target = points.target!
  const hit = points.hit!
  try {
    const shot = calculateShot(player, target, hit, distance, points.previousAim || target)
    return {
      isOk: true,
      result: {
        kind: 'shot',
        aim: shot.aim,
        azimuth: azimuth(player, shot.aim),
        distance: shot.distance,
        coefficient: shot.coefficient,
        targetDistance: shot.targetDistance,
        hitDistance: shot.hitDistance,
        note: shot.distance === null
          ? {
            kind: 'coefficient',
          }
          : {
            kind: 'previous',
            distance: distance!,
            coefficient: shot.coefficient,
          },
        diagram: {
          player,
          target,
          hit,
          aim: shot.aim,
        },
      },
    }
  } catch (error) {
    return {
      isOk: false,
      errors: {
        form: (error as Error).message,
      },
      invalid: null,
    }
  }
}

/** The aim point as the game's coordinates are typed: "Y78.54 X74.23". */
export const aimCoordinates = (aim: GamePoint) => `Y${aim.y.toFixed(2)} X${aim.x.toFixed(2)}`
