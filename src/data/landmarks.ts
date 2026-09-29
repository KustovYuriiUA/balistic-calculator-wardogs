import landmarks from './landmarks.json'

/** Map fraction [u, v] from the north-west corner: game x = u · 163.84, y = (1 − v) · 163.84. */
export type MapFraction = [number, number]

export interface Rotation {
  id: string
  name: string
  towns: string[]
}

export type Faction = 'manticore' | 'valkyra' | 'lonestar'

export interface Spawn {
  pos: MapFraction
  faction: Faction
  town: string
}

export interface Zone {
  id: string
  /** 'Default' is shown as the translation of "Main". */
  name: string
  rotation: string
  pos: MapFraction
  radiusM: number
}

export interface WorldMeta {
  rotations: Rotation[]
  spawns: Spawn[]
  zones: Zone[]
}

export type WorldId = 'kavkazi' | 'europe' | 'northamerica'

// Public Wardogs Zone map metadata; attribution: public/maps/SOURCES.md.
export const MAP_LANDMARKS = landmarks as Record<WorldId, WorldMeta>

export const WORLDS = Object.keys(MAP_LANDMARKS) as WorldId[]

export const WORLD_NAMES: Record<WorldId, string> = {
  kavkazi: 'Kavkazi',
  europe: 'Europe',
  northamerica: 'North America',
}

export const isWorld = (value: unknown): value is WorldId => typeof value === 'string' && value in MAP_LANDMARKS
