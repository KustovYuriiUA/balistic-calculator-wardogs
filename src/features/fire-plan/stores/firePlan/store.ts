import { MAP_LANDMARKS, isWorld, type WorldId } from '@/data/landmarks'
import { MAP_EXTENT, range, type GamePoint } from '@/shared/geometry'
import { t } from '@/shared/i18n'
import type { MapTool } from '@/shared/ipc'
import { zoneTitle } from '@/shared/zones'
import { createStore } from '@/store/createStore'

import type { Calculator, FirePlanState, FirePlanStore } from './types'
import {
  calculateBase,
  calculateCorrection,
  emptyFields,
  type CalcField,
  type CalcFields,
} from '../../core/calculator'
import {
  defaultSelection,
  emptyPreset,
  fitSelection,
  originKey,
  pointText,
  presetKey,
  readPlan,
  renumber,
  resetShots,
  writePlan,
  type LandmarkSelection,
  type Preset,
  type Target,
} from '../../core/presets'
import { parseCoordinate } from '../../core/shot'
import { previousShot } from '../../core/solution'

const UNDO_LIMIT = 50

// The plan is written only once it was read: an early write would replace the saved plan with an empty one.
let isStorageReady = false

const emptyCalculator = (): Calculator => ({
  fields: emptyFields(),
  errors: {},
  result: null,
  status: 'coords',
  baseMetres: null,
  isAutomaticBase: false,
  isAimDetailsOpen: false,
  copy: 'idle',
  focus: null,
})

export const defaultState: FirePlanState = {
  world: 'kavkazi',
  selections: {},
  presets: {},
  tool: 'player',
  undo: {},
  saveStatus: 'autosave',
  mapError: '',
  toast: null,
  view: {
    kind: 'region',
    id: 0,
  },
  entry: '',
  calculator: emptyCalculator(),
}

// ── Reading the current preset ──────────────────────────────────────────────────────────────────────────────────

export const selectionOf = (s: FirePlanState, world: WorldId = s.world): LandmarkSelection =>
  s.selections[world] ?? defaultSelection(world)

export const keyOf = (s: FirePlanState) => presetKey(s.world, selectionOf(s))

// One shared empty preset: a selector must not hand out a new object on every call.
const EMPTY_PRESET: Preset = Object.freeze(emptyPreset()) as Preset

export const presetOf = (s: FirePlanState): Preset => s.presets[keyOf(s)] ?? EMPTY_PRESET

export const selectedOf = (p: Preset): Target | undefined =>
  p.targets.find((x) => x.id === p.selected)

const withPreset = (s: FirePlanState, preset: Preset): FirePlanState => ({
  ...s,
  presets: {
    ...s.presets,
    [keyOf(s)]: preset,
  },
})

const withTarget = (preset: Preset, target: Target): Preset => ({
  ...preset,
  targets: preset.targets.map((x) => (x.id === target.id ? target : x)),
})

let focusRequests = 0
const focusOn = (field: CalcField | null) => (field
  ? {
    field,
    id: ++focusRequests,
  }
  : null)

const parseOrNull = (text: string) => {
  try {
    return parseCoordinate(text)
  } catch {
    return null
  }
}

// ── The calculator form ↔ the selected target ───────────────────────────────────────────────────────────────────

/** The form's shot data into the selected target: range, impact, previous aim and the position they belong to. */
function saveForm(s: FirePlanState): FirePlanState {
  const preset = presetOf(s)
  const target = selectedOf(preset)
  if (!target) return s
  const { fields } = s.calculator
  return withPreset(s, withTarget(preset, {
    ...target,
    distance: fields.distance,
    hit: fields.hit,
    previousAim: fields.previousAim,
    shots: fields.hit ? target.shots : 0,
    origin: originKey(parseOrNull(fields.player)),
  }))
}

/** A snapshot of the current preset for Ctrl+Z, before every change of points. */
function remember(s: FirePlanState): FirePlanState {
  const saved = saveForm(s)
  const key = keyOf(saved)
  const stack = [...(saved.undo[key] ?? []), JSON.stringify(presetOf(saved))].slice(-UNDO_LIMIT)
  return {
    ...saved,
    undo: {
      ...saved.undo,
      [key]: stack,
    },
  }
}

const invalidated = (c: Calculator): Calculator => ({
  ...c,
  result: null,
  status: 'calc',
})

// The selected target into the calculator: its points and shot data, the range to it, and its correction when an
// impact is marked. Shot data of another player position is dropped.
function loadSelected(s: FirePlanState): FirePlanState {
  let preset = presetOf(s)
  let target = selectedOf(preset)
  if (target && target.origin !== originKey(preset.player)) {
    target = {
      ...target,
      distance: '',
      hit: '',
      previousAim: '',
      shots: 0,
    }
  }
  const fields: CalcFields = {
    player: preset.player ? pointText(preset.player) : '',
    target: target ? pointText(target.point) : '',
    hit: target?.hit || '',
    previousAim: target?.previousAim || '',
    distance: target?.distance || '',
  }
  let calc: Calculator = {
    ...invalidated(s.calculator),
    errors: {},
    baseMetres: null,
    isAutomaticBase: false,
  }
  if (preset.player && target) {
    const savedDistance = target.distance
    const base = calculateBase(fields)
    if (base.isOk) {
      fields.distance = base.metres.toFixed(2)
      calc = {
        ...calc,
        result: base.result,
        status: 'range',
        baseMetres: base.metres,
        isAutomaticBase: true,
        copy: 'idle',
      }
    } else {
      calc = {
        ...calc,
        errors: base.errors,
      }
    }
    if (savedDistance) {
      fields.distance = savedDistance
      if (!target.hit && calc.result) {
        calc = {
          ...calc,
          result: {
            ...calc.result,
            distance: Number(savedDistance.replace(',', '.')),
            note: {
              kind: 'base',
            },
          },
        }
      }
    }
    target = {
      ...target,
      distance: fields.distance,
      origin: originKey(preset.player),
    }
    if (target.hit) {
      const shot = calculateCorrection(fields)
      calc = shot.isOk
        ? {
          ...calc,
          errors: {},
          result: shot.result,
          status: 'estimate',
          copy: 'idle',
        }
        : {
          ...invalidated(calc),
          errors: shot.errors,
          isAimDetailsOpen: calc.isAimDetailsOpen || shot.invalid === 'previousAim',
        }
    }
    preset = withTarget(preset, target)
  }
  return withPreset({
    ...s,
    calculator: {
      ...calc,
      fields,
    },
  }, preset)
}

// ── Preset switches ─────────────────────────────────────────────────────────────────────────────────────────────

function switchPreset(
  s: FirePlanState,
  change: (s: FirePlanState) => FirePlanState,
): FirePlanState {
  let next = change(saveForm(s))
  next = {
    ...next,
    selections: {
      ...next.selections,
      [next.world]: fitSelection(next.world, selectionOf(next)),
    },
    entry: '',
    mapError: '',
    toast: null,
  }
  next = {
    ...next,
    tool: presetOf(next).player ? 'target' : 'player',
  }
  next = loadSelected(next)
  return {
    ...next,
    view: {
      kind: 'region',
      id: next.view.id + 1,
    },
  }
}

// ── Points ──────────────────────────────────────────────────────────────────────────────────────────────────────

function placePoint(s: FirePlanState, raw: GamePoint, tool: MapTool): FirePlanState {
  const isOnMap = Number.isFinite(raw.x) && Number.isFinite(raw.y)
    && raw.x >= 0 && raw.y >= 0 && raw.x <= MAP_EXTENT && raw.y <= MAP_EXTENT
  if (!isOnMap) {
    return {
      ...s,
      mapError: t('err.mapRange'),
    }
  }
  const point = {
    x: Number(raw.x.toFixed(2)),
    y: Number(raw.y.toFixed(2)),
  }
  let next = saveForm({
    ...s,
    mapError: '',
  })
  if (tool === 'player') {
    next = remember(next)
    next = withPreset(next, resetShots({
      ...presetOf(next),
      player: point,
    }))
    next = {
      ...next,
      tool: 'target',
    }
  } else if (tool === 'target') {
    next = remember(next)
    const preset = presetOf(next)
    const id = preset.next
    next = withPreset(next, {
      ...preset,
      targets: [...preset.targets, {
        id,
        point,
        distance: '',
        hit: '',
        previousAim: '',
        shots: 0,
        origin: null,
      }],
      selected: id,
      next: id + 1,
    })
  } else {
    const preset = presetOf(next)
    const target = selectedOf(preset)
    if (!target) {
      return {
        ...next,
        mapError: t('err.pickTarget'),
      }
    }
    if (!preset.player || !target.distance) {
      return {
        ...next,
        mapError: t('err.setPosition'),
      }
    }
    next = remember(next)
    // A new impact after a correction was fired with the corrected range and aim: it chains from them.
    const previous = previousShot(preset, target)
    const isChained = previous && previous.distance !== null
    next = withPreset(next, withTarget(presetOf(next), {
      ...target,
      distance: isChained ? previous.distance!.toFixed(2) : target.distance,
      previousAim: isChained ? pointText(previous.aim) : target.previousAim,
      shots: isChained ? (target.shots || 1) + 1 : 1,
      hit: pointText(point),
    }))
  }
  return loadSelected(next)
}

function removeTarget(s: FirePlanState, id: number): FirePlanState {
  let next = remember(s)
  const preset = presetOf(next)
  const targets = preset.targets.filter((x) => x.id !== id)
  next = withPreset(next, renumber({
    ...preset,
    targets,
    selected: preset.selected === id ? targets[0]?.id ?? null : preset.selected,
  }))
  return withToast(loadSelected(next), t('toast.targetRemoved', {
    id,
  }), true)
}

let toasts = 0
const withToast = (s: FirePlanState, text: string, isUndoable = false): FirePlanState => ({
  ...s,
  toast: {
    text,
    isUndoable,
    id: ++toasts,
  },
})

// ── The store ───────────────────────────────────────────────────────────────────────────────────────────────────

export const useFirePlanStore = createStore<FirePlanStore>(
  (set, get) => {
    const apply = (change: (s: FirePlanState) => FirePlanState, action: string) => {
      set(change(get()), undefined, action)
    }
    return {
      ...defaultState,
      actions: {
        start: () => apply((s) => {
          isStorageReady = true
          let next: FirePlanState = s
          try {
            const plan = readPlan()
            if (plan) {
              next = {
                ...next,
                world: plan.world ?? next.world,
                selections: plan.selections,
                presets: plan.presets,
              }
            }
          } catch {
            next = {
              ...next,
              saveStatus: 'readError',
            }
          }
          next = {
            ...next,
            selections: {
              ...next.selections,
              [next.world]: fitSelection(next.world, selectionOf(next)),
            },
          }
          next = {
            ...next,
            tool: presetOf(next).player ? 'target' : 'player',
          }
          return loadSelected(next)
        }, 'firePlan/start'),
        setWorld: (world) => apply((s) => switchPreset(s, (x) => ({
          ...x,
          world,
        })), 'firePlan/setWorld'),
        setRegion: (region) => apply((s) => switchPreset(s, (x) => ({
          ...x,
          selections: {
            ...x.selections,
            [x.world]: {
              region,
              zone: selectionOf(x).zone,
            },
          },
        })), 'firePlan/setRegion'),
        setZone: (zone) => apply((s) => switchPreset(s, (x) => ({
          ...x,
          selections: {
            ...x.selections,
            [x.world]: {
              region: selectionOf(x).region,
              zone,
            },
          },
        })), 'firePlan/setZone'),
        setTool: (tool) => set({
          tool,
        }, undefined, 'firePlan/setTool'),
        place: (point, tool) => apply((s) => placePoint(s, point, tool ?? s.tool), 'firePlan/place'),
        placeFromGame: ({
          x, y, button, pin,
        }) => {
          const { actions } = get()
          if (pin === 'player') {
            actions.removePlayer()
            return
          }
          if (typeof pin === 'number' && presetOf(get()).targets.some((target) => target.id === pin)) {
            actions.clickTarget(pin)
            return
          }
          actions.place({
            x,
            y,
          }, button === 'right' ? 'hit' : undefined)
        },
        setEntry: (entry) => set({
          entry,
        }, undefined, 'firePlan/setEntry'),
        placeEntry: (text) => apply((s) => {
          try {
            return placePoint(s, parseCoordinate(text), s.tool)
          } catch (error) {
            return {
              ...s,
              mapError: (error as Error).message,
            }
          }
        }, 'firePlan/placeEntry'),
        choose: (id) => apply((s) => {
          const next = saveForm(s)
          return loadSelected(withPreset(next, {
            ...presetOf(next),
            selected: id,
          }))
        }, 'firePlan/choose'),
        clickTarget: (id) => {
          const { actions } = get()
          if (presetOf(get()).selected === id) actions.removeTarget(id)
          else actions.choose(id)
        },
        removeTarget: (id) => apply((s) => removeTarget(s, id), 'firePlan/removeTarget'),
        // Clicking the own pin removes the position; targets stay, their impacts reset (Ctrl+Z restores).
        removePlayer: () => apply((s) => {
          let next = remember(s)
          next = withPreset(next, resetShots({
            ...presetOf(next),
            player: null,
          }))
          next = loadSelected({
            ...next,
            tool: 'player',
          })
          return withToast(next, t('toast.positionRemoved'), true)
        }, 'firePlan/removePlayer'),
        resetCorrection: () => apply((s) => {
          const preset = presetOf(s)
          const target = selectedOf(preset)
          if (!target?.hit) return s
          let next = remember(s)
          const saved = presetOf(next)
          next = withPreset(next, withTarget(saved, {
            ...selectedOf(saved)!,
            hit: '',
            previousAim: '',
            shots: 0,
            distance: saved.player ? range(saved.player, target.point).toFixed(2) : '',
          }))
          return withToast(loadSelected(next), t('toast.correctionReset', {
            id: target.id,
          }), true)
        }, 'firePlan/resetCorrection'),
        undo: () => apply((s) => {
          const key = keyOf(s)
          const stack = s.undo[key]
          if (!stack?.length) return withToast(s, t('toast.nothingToUndo'))
          const restored = JSON.parse(stack[stack.length - 1]) as Preset
          let next: FirePlanState = {
            ...s,
            undo: {
              ...s.undo,
              [key]: stack.slice(0, -1),
            },
            mapError: '',
          }
          next = loadSelected(withPreset(next, restored))
          const tool = restored.player ? (next.tool === 'player' ? 'target' : next.tool) : 'player'
          return withToast({
            ...next,
            tool,
          }, t('toast.undone'))
        }, 'firePlan/undo'),
        followGameZone: (key) => {
          const [world, id] = key.split('/')
          if (!isWorld(world)) return
          const zone = MAP_LANDMARKS[world].zones.find((z) => z.id === id)
          const current = get()
          if (!zone || key === current.world + '/' + selectionOf(current).zone) return
          apply((s) => withToast(switchPreset(s, (x) => ({
            ...x,
            world,
            selections: {
              ...x.selections,
              [world]: {
                region: zone.rotation,
                zone: zone.id,
              },
            },
          })), t('toast.gameZone', {
            title: zoneTitle(key),
          })), 'firePlan/followGameZone')
        },
        requestView: (kind) => set((s) => ({
          view: {
            kind,
            id: s.view.id + 1,
          },
        }), undefined, 'firePlan/requestView'),
        showToast: (text, isUndoable = false) => apply((s) => withToast(s, text, isUndoable), 'firePlan/showToast'),
        hideToast: () => set({
          toast: null,
        }, undefined, 'firePlan/hideToast'),
        // Typing in the calculator: the result is stale, and the preset follows the form (a new position drops the
        // shot data of the old one; a target typed without one on the map becomes one).
        inputField: (field, value) => apply((s) => {
          const c = s.calculator
          const fields = {
            ...c.fields,
            [field]: value,
          }
          const errors = {
            ...c.errors,
            [field]: undefined,
            form: undefined,
          }
          let isAutomaticBase = c.isAutomaticBase
          let baseMetres = c.baseMetres
          if (field === 'player' || field === 'target') {
            if (isAutomaticBase) fields.distance = ''
            isAutomaticBase = false
            baseMetres = null
          }
          if (field === 'distance') {
            isAutomaticBase = false
            baseMetres = null
          }
          let preset = presetOf(s)
          if (field === 'player' && preset.player && originKey(parseOrNull(value)) !== originKey(preset.player)) {
            preset = {
              ...preset,
              targets: preset.targets.map((x) => ({
                ...x,
                distance: '',
                hit: '',
                previousAim: '',
                shots: 0,
                origin: null,
              })),
            }
            fields.hit = ''
            fields.previousAim = ''
            fields.distance = ''
            errors.hit = undefined
            errors.previousAim = undefined
            errors.distance = undefined
          }
          let next = withPreset({
            ...s,
            calculator: {
              ...invalidated(c),
              fields,
              errors,
              isAutomaticBase,
              baseMetres,
            },
          }, preset)
          // The form into the preset: the position, the target (created when there is none), the shot data.
          preset = {
            ...presetOf(next),
            player: parseOrNull(fields.player),
          }
          const point = parseOrNull(fields.target)
          if (point) {
            let target = selectedOf(preset)
            if (!target) {
              target = {
                id: preset.next,
                point,
                distance: '',
                hit: '',
                previousAim: '',
                shots: 0,
                origin: null,
              }
              preset = {
                ...preset,
                targets: [...preset.targets, target],
                selected: target.id,
                next: preset.next + 1,
              }
            }
            preset = withTarget(preset, {
              ...target,
              point,
            })
          }
          next = withPreset(next, preset)
          return saveForm(next)
        }, 'firePlan/inputField'),
        calculateBase: () => apply((s) => {
          const c = s.calculator
          const outcome = calculateBase(c.fields)
          if (!outcome.isOk) {
            return {
              ...s,
              calculator: {
                ...invalidated(c),
                errors: outcome.errors,
                baseMetres: null,
                focus: focusOn(outcome.invalid),
              },
            }
          }
          return {
            ...s,
            calculator: {
              ...c,
              fields: {
                ...c.fields,
                distance: outcome.metres.toFixed(2),
              },
              errors: {},
              result: outcome.result,
              status: 'range',
              baseMetres: outcome.metres,
              isAutomaticBase: true,
              copy: 'idle',
            },
          }
        }, 'firePlan/calculateBase'),
        calculateCorrection: () => apply((s) => {
          const c = s.calculator
          const outcome = calculateCorrection(c.fields)
          if (!outcome.isOk) {
            return {
              ...s,
              calculator: {
                ...invalidated(c),
                errors: outcome.errors,
                isAimDetailsOpen: c.isAimDetailsOpen || outcome.invalid === 'previousAim',
                focus: focusOn(outcome.invalid),
              },
            }
          }
          return {
            ...s,
            calculator: {
              ...c,
              errors: {},
              result: outcome.result,
              status: 'estimate',
              copy: 'idle',
            },
          }
        }, 'firePlan/calculateCorrection'),
        fill: (fields) => {
          set((s) => ({
            calculator: {
              ...s.calculator,
              fields,
            },
          }), undefined, 'firePlan/fill')
          get().actions.calculateCorrection()
          return get().calculator.result
        },
        example: () => {
          get().actions.fill({
            player: 'Y102 X88',
            target: 'Y80 X72',
            hit: 'Y93 X80',
            distance: '2720,29',
            previousAim: '',
          })
        },
        setAimDetailsOpen: (isOpen) => set((s) => ({
          calculator: {
            ...s.calculator,
            isAimDetailsOpen: isOpen,
          },
        }), undefined, 'firePlan/setAimDetailsOpen'),
        setCopy: (copy) => set((s) => ({
          calculator: {
            ...s.calculator,
            copy,
          },
        }), undefined, 'firePlan/setCopy'),
      },
    }
  },
  {
    name: 'FirePlanStore',
  },
)

// Autosave: every change of the plan once it was read (a separate save per map, region with spawns and zone).
let lastSaved = ''
useFirePlanStore.subscribe((s) => {
  if (!isStorageReady) return
  const payload = JSON.stringify([s.world, s.selections, s.presets])
  if (payload === lastSaved) return
  const isSaved = writePlan(s.world, s.selections, s.presets)
  if (isSaved) lastSaved = payload
  const saveStatus = isSaved ? 'saved' : 'notSaved'
  if (s.saveStatus !== saveStatus) {
    useFirePlanStore.setState({
      saveStatus,
    }, undefined, 'firePlan/autosave')
  }
})
