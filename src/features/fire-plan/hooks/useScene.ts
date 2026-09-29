import { useMemo } from 'react'

import { formatAzimuth } from '@/shared/geometry'
import type { Scene } from '@/shared/ipc'

import { rangeText, useFireFor } from './useFire'
import { briefFor, briefText } from '../core/brief'
import { parseCoordinate } from '../core/shot'
import { isValidFire } from '../core/solution'
import { usePreset, useSelectedTarget, useTool } from '../stores/firePlan'

function hitOf(text: string | undefined) {
  if (!text) return null
  try {
    const { x, y } = parseCoordinate(text)
    return {
      x,
      y,
    }
  } catch {
    return null
  }
}

/** What the game map layer draws: the pins, the selected target's impact and aim, its solution and the next step. */
export function useScene(): Scene {
  const preset = usePreset()
  const target = useSelectedTarget()
  const tool = useTool()
  const f = useFireFor(preset, target)
  return useMemo(() => {
    const valid = isValidFire(f) ? f : null
    return {
      tool,
      player: preset.player,
      selected: target?.id ?? null,
      targets: preset.targets.map((x) => ({
        id: x.id,
        x: x.point.x,
        y: x.point.y,
      })),
      hit: hitOf(target?.hit),
      aim: valid?.isCorrected
        ? {
          x: valid.aim.x,
          y: valid.aim.y,
        }
        : null,
      label: target && valid ? formatAzimuth(valid.azimuth) + ' · ' + rangeText(valid) : '',
      hint: briefText(briefFor(preset, target, tool)),
    }
  }, [preset, target, tool, f])
}
