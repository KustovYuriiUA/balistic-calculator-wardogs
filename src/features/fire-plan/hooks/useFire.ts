import { useMemo } from 'react'

import { MAP_LANDMARKS, type WorldId } from '@/data/landmarks'
import { display, metres } from '@/shared/format'

import type { LandmarkSelection, Preset, Target } from '../core/presets'
import { fire, type FireSolution } from '../core/solution'
import { usePreset, useSelectedTarget } from '../stores/firePlan'

export const rangeText = (f: FireSolution) => (f.range === null ? '× ' + display(f.coefficient ?? 0) : metres(f.range))

/** The fire solution of a target, recomputed only when the preset or the target changes. */
export function useFireFor(preset: Preset, target: Target | undefined) {
  return useMemo(() => fire(preset, target), [preset, target])
}

export function useSelectedFire() {
  return useFireFor(usePreset(), useSelectedTarget())
}

/** The spawn bases of the region and its zone. */
export function useLandmarkItems(world: WorldId, selection: LandmarkSelection) {
  return useMemo(() => {
    const data = MAP_LANDMARKS[world]
    const region = data.rotations.find((r) => r.id === selection.region)
    return {
      bases: data.spawns.filter((b) => region?.towns.includes(b.town)),
      zone: data.zones.find((z) => z.id === selection.zone),
    }
  }, [world, selection.region, selection.zone])
}
