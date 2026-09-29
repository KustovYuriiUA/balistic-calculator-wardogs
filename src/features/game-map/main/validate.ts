import {
  LAYER_STATES, type GameClick, type LayerMemory, type LayerState, type LayerStatus,
} from '@/shared/ipc'

// What the layer page sends, checked field by field: a page is never trusted with main's state.

const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max ? v : null

export function cleanStatus(value: unknown): LayerStatus {
  const s = (value || {}) as Partial<Record<keyof LayerStatus, unknown>>
  const progress = s.progress
  return {
    state: LAYER_STATES.includes(s.state as LayerState) ? s.state as LayerState : 'error',
    key: text(s.key, 100),
    isRecognised: s.isRecognised === true,
    isCalibrated: s.isCalibrated === true,
    source: s.source === 'rim' || s.source === 'terrain' ? s.source : null,
    world: text(s.world, 40),
    metresPerPixel: Number.isFinite(s.metresPerPixel) ? s.metresPerPixel as number : null,
    isOpen: typeof s.isOpen === 'boolean' ? s.isOpen : null,
    progress: Number.isFinite(progress) && (progress as number) >= 0 && (progress as number) <= 1
      ? progress as number
      : null,
    isFailed: s.isFailed === true,
    message: text(s.message, 200),
  }
}

export function cleanClick(value: unknown): GameClick | null {
  const c = (value || {}) as Partial<Record<keyof GameClick, unknown>>
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return null
  const x = c.x as number
  const y = c.y as number
  if (Math.abs(x) > 1e4 || Math.abs(y) > 1e4 || (c.button !== 'left' && c.button !== 'right')) return null
  const isTargetPin = Number.isSafeInteger(c.pin) && (c.pin as number) > 0
  return {
    x,
    y,
    button: c.button,
    pin: c.pin === 'player' || isTargetPin ? c.pin as GameClick['pin'] : null,
  }
}

/** Game x = x0 + a·s/100 at capture pixel a: coordinates within the maps, a scale within reason. */
export function cleanMemory(value: unknown): LayerMemory | null {
  const m = (value || {}) as Partial<Record<keyof LayerMemory, unknown>>
  const world = typeof m.world === 'string' && /^[a-z]{1,20}$/.test(m.world) ? m.world : null
  const f = (m.fix || {}) as Partial<Record<'x0' | 'y0' | 's', unknown>>
  if (!world || !['x0', 'y0', 's'].every((k) => Number.isFinite(f[k as 'x0']))) return null
  const x0 = f.x0 as number
  const y0 = f.y0 as number
  const s = f.s as number
  if (Math.abs(x0) > 1e4 || Math.abs(y0) > 1e4 || !(s > 0 && s < 1000)) return null
  const isKey = typeof m.key === 'string' && /^[a-z]{1,20}\/[a-z0-9-]{1,60}$/.test(m.key)
  return {
    world,
    key: isKey ? m.key as string : null,
    fix: {
      x0,
      y0,
      s,
    },
  }
}

/** Poll rate of the in-game map capture, frames per second. */
export const FPS_CHOICES = [15, 30, 60, 120]

export const DEFAULT_FPS = 60

export const cleanFps = (v: unknown) =>
  FPS_CHOICES.includes(v as number) ? v as number : DEFAULT_FPS
