import { MAP_LANDMARKS, isWorld, type WorldId } from '@/data/landmarks'
import { range, type GamePoint } from '@/shared/geometry'

export interface Target {
  /** 1…n in list order: card N is hotkey N. */
  id: number
  point: GamePoint
  /** Range to set, metres, as typed or calculated. */
  distance: string
  /** Impact point as text, empty until marked. */
  hit: string
  previousAim: string
  shots: number
  /** The player position the shot data belongs to; another position resets it. */
  origin: string | null
}

export interface Preset {
  player: GamePoint | null
  targets: Target[]
  selected: number | null
  next: number
}

export interface LandmarkSelection {
  region: string
  zone: string
}

/** One preset per map, region and zone. */
export const presetKey = (world: WorldId, selection: LandmarkSelection) =>
  JSON.stringify([world, selection.region, selection.zone])

export const emptyPreset = (): Preset => ({
  player: null,
  targets: [],
  selected: null,
  next: 1,
})

export const originKey = (p: GamePoint | null) => p ? `${p.x},${p.y}` : null

export const pointText = (p: GamePoint) => `x${p.x.toFixed(2)}, y${p.y.toFixed(2)}`

/** The first region with zone data, and its first zone. */
export function defaultSelection(world: WorldId): LandmarkSelection {
  const data = MAP_LANDMARKS[world]
  const rotation = data.rotations.find((r) => data.zones.some((z) => z.rotation === r.id))
    || data.rotations[0]
  return {
    region: rotation.id,
    zone: data.zones.find((z) => z.rotation === rotation.id)?.id || '',
  }
}

/** The zone stays only if it belongs to the region; else the region's first zone. */
export function fitSelection(world: WorldId, selection: LandmarkSelection): LandmarkSelection {
  const zones = MAP_LANDMARKS[world].zones.filter((z) => z.rotation === selection.region)
  return zones.some((z) => z.id === selection.zone)
    ? selection
    : {
      region: selection.region,
      zone: zones[0]?.id || '',
    }
}

/** Numbers follow the list order: card N is hotkey N, and the next target gets the next free number. */
export function renumber(preset: Preset): Preset {
  const ids = new Map(preset.targets.map((t, i) => [t.id, i + 1]))
  return {
    ...preset,
    targets: preset.targets.map((t) => ({
      ...t,
      id: ids.get(t.id)!,
    })),
    selected: preset.selected === null ? null : ids.get(preset.selected) ?? null,
    next: preset.targets.length + 1,
  }
}

/** Another player position: every target's range from the new one, impacts cleared. */
export function resetShots(preset: Preset): Preset {
  const player = preset.player
  return {
    ...preset,
    targets: preset.targets.map((t) => ({
      ...t,
      distance: player ? range(player, t.point).toFixed(2) : '',
      hit: '',
      previousAim: '',
      shots: 0,
      origin: originKey(player),
    })),
  }
}

export interface SavedPlan {
  world: WorldId | null
  selections: Partial<Record<WorldId, LandmarkSelection>>
  presets: Record<string, Preset>
}

const STORAGE_KEY = 'shot-map-presets-v1'

const isPoint = (p: unknown): p is GamePoint => {
  const q = p as GamePoint | null
  return Boolean(q
    && Number.isFinite(q.x)
    && Number.isFinite(q.y)
    && Math.abs(q.x) <= 1e9
    && Math.abs(q.y) <= 1e9)
}

const text = (v: unknown) => typeof v === 'string' ? v.slice(0, 200) : ''

// localStorage 'shot-map-presets-v1', the format of 1.x: {version: 1, world, selections: [[world, {region, zone}]],
// presets: [[JSON [world, region, zone], preset]]}. Anything malformed is dropped entry by entry.
/** null: nothing saved; throws on a file that cannot be read at all. */
export function readPlan(): SavedPlan | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  const data = JSON.parse(raw)
  if (data.version !== 1) throw new Error('version')
  const plan: SavedPlan = {
    world: isWorld(data.world) ? data.world : null,
    selections: {},
    presets: {},
  }
  for (const [world, choice] of data.selections || []) {
    if (!isWorld(world)) continue
    const meta = MAP_LANDMARKS[world]
    if (!meta.rotations.some((r) => r.id === choice?.region)) continue
    const hasZone = meta.zones.some((z) => z.rotation === choice.region && z.id === choice.zone)
    plan.selections[world] = {
      region: choice.region,
      zone: hasZone ? choice.zone : '',
    }
  }
  for (const [key, value] of data.presets || []) {
    const [world, region, zone] = JSON.parse(key)
    if (!isWorld(world)) continue
    const meta = MAP_LANDMARKS[world]
    const isKnown = meta.rotations.some((r) => r.id === region)
      && (!zone || meta.zones.some((z) => z.rotation === region && z.id === zone))
    if (!isKnown || !Array.isArray(value?.targets)) continue
    const ids = new Set<number>()
    const targets: Target[] = []
    for (const t of value.targets) {
      if (!Number.isSafeInteger(t?.id) || t.id < 1 || ids.has(t.id) || !isPoint(t.point)) continue
      ids.add(t.id)
      const hit = text(t.hit)
      targets.push({
        id: t.id,
        point: {
          x: t.point.x,
          y: t.point.y,
        },
        distance: text(t.distance),
        hit,
        previousAim: text(t.previousAim),
        origin: typeof t.origin === 'string' ? t.origin : null,
        shots: Number.isSafeInteger(t.shots) && t.shots >= 0 && t.shots < 1e4
          ? t.shots
          : hit ? 1 : 0,
      })
    }
    // Presets saved with gaps in the numbering (before renumbering existed) come back numbered 1…n.
    plan.presets[key] = renumber({
      player: isPoint(value.player)
        ? {
          x: value.player.x,
          y: value.player.y,
        }
        : null,
      targets,
      selected: ids.has(value.selected) ? value.selected : targets[0]?.id ?? null,
      next: 1,
    })
  }
  return plan
}

/** false when the profile cannot be written (full disk, no access). */
export function writePlan(world: WorldId, selections: SavedPlan['selections'], presets: Record<string, Preset>) {
  const payload = JSON.stringify({
    version: 1,
    world,
    selections: Object.entries(selections),
    presets: Object.entries(presets),
  })
  try {
    localStorage.setItem(STORAGE_KEY, payload)
    return true
  } catch {
    return false
  }
}
