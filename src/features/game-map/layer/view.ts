import { t } from '@/shared/i18n'
import type { Scene } from '@/shared/ipc'

import type { Point, Ring } from '../core'
import type { Calibration } from './engine'
import type { Crop } from './frame-io'

const NS = 'http://www.w3.org/2000/svg'

const $ = (id: string) => document.getElementById(id)!

type Attrs = Record<string, string | number>

function el(parent: Element, tag: string, attrs: Attrs = {}) {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent.append(node)
  return node
}

export interface ViewState {
  calibration: Calibration | null
  crop: Crop | null
  ring: Ring | null
  isMarking: boolean
  /** The recognised zone's title, when the rim calibrates. */
  zoneTitle: string | null
  /** What the search is doing, or null: nothing to say. */
  busy: string | null
  scene: Scene | null
}

// The layer's own drawing: the detected rim, the zone badge, the search line, and the overlay's pins, lines and
// solution label, as on its own map. The pins are redrawn only when something moved.
export function createView() {
  let drawn = ''

  function toWindow(cal: Calibration, crop: Crop, p: Point) {
    const q = cal.toPixel(p.x, p.y)
    return {
      x: q.x / crop.k + crop.ox,
      y: q.y / crop.k + crop.oy,
    }
  }

  function drawMarks(cal: Calibration | null, crop: Crop | null, scene: Scene | null) {
    const key = cal && crop && scene ? JSON.stringify([cal.id, crop.k, crop.ox, crop.oy, scene]) : ''
    if (key === drawn) return
    drawn = key
    const g = $('marks')
    g.replaceChildren()
    if (!cal || !crop || !scene) return
    const at = (p: Point) => toWindow(cal, crop, p)
    const sel = scene.targets.find((x) => x.id === scene.selected)
    const line = (a: Point, b: Point, cls: string) => {
      const p = at(a)
      const q = at(b)
      el(g, 'line', {
        x1: p.x,
        y1: p.y,
        x2: q.x,
        y2: q.y,
        class: cls,
      })
    }
    if (scene.player) {
      for (const x of scene.targets) if (x !== sel) line(scene.player, x, 'ray')
      if (sel) line(scene.player, sel, 'ray chosen')
      if (sel && scene.hit) line(sel, scene.hit, 'miss')
      if (scene.aim) line(scene.player, scene.aim, 'aim')
    }
    if (sel) {
      const q = at(sel)
      el(g, 'circle', {
        cx: q.x,
        cy: q.y,
        r: 17,
        class: 'halo',
      })
    }
    const pin = (p: Point, label: string, cls: string, id?: string | number) => {
      const q = at(p)
      const node = el(g, 'g', {
        class: 'pin ' + cls,
        ...(id === undefined ? {} : {
          'data-pin': id,
        }),
      })
      el(node, 'circle', {
        cx: q.x,
        cy: q.y,
        r: 11,
      })
      el(node, 'text', {
        x: q.x,
        y: q.y,
      }).textContent = label
    }
    for (const x of scene.targets) pin(x, String(x.id), x === sel ? 'target chosen' : 'target', x.id)
    if (scene.player) pin(scene.player, t('tools.me'), 'me', 'player')
    if (scene.aim) pin(scene.aim, '+', 'aim-pin')
    if (scene.hit) pin(scene.hit, '×', 'hit-pin')
    if (sel && scene.label) {
      const q = at(sel)
      el(g, 'text', {
        x: q.x + 19,
        y: q.y + 4,
        class: 'pin-label',
      }).textContent = scene.label
    }
  }

  function draw(s: ViewState) {
    const {
      calibration: cal, crop, ring,
    } = s
    const body = document.body
    body.classList.toggle('weak', Boolean(ring?.isWeak))
    body.classList.toggle('guess', Boolean(cal && cal.source !== 'rim'))
    body.classList.toggle('marking', s.isMarking && Boolean(cal))
    $('busy').hidden = !s.busy
    if (s.busy) $('busy-text').textContent = s.busy
    if (!cal) {
      $('badge').hidden = true
      drawMarks(null, null, null)
      return
    }
    $('badge').hidden = false
    $('badge-title').textContent = s.zoneTitle ?? t('gm.byTerrain', {
      world: cal.worldName,
    })
    $('badge-note').textContent = t(s.isMarking
      ? 'layer.noteMarking'
      : s.zoneTitle && ring?.isWeak ? 'layer.noteWeak' : 'layer.noteIdle')
    drawMarks(cal, crop, s.scene)
  }

  return {
    draw,
    /** The language changed: the pins' labels too. */
    invalidate: () => {
      drawn = ''
    },
    setPassing(isPassing: boolean) {
      document.body.classList.toggle('passing', isPassing)
      $('pass-hint').hidden = !isPassing
    },
    applyTexts() {
      document.documentElement.lang = document.documentElement.lang || 'en'
      document.title = t('layer.title')
      $('busy-text').textContent = t('layer.busyWait')
      $('pass-hint').textContent = t('layer.passHint')
    },
  }
}
