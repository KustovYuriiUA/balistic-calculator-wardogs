import { setLanguage, t } from '@/shared/i18n'
import type { MapLayerApi } from '@/shared/ipc'

import { createEngine } from './engine'
import { createMousePass } from './mouse-pass'
import { createView } from './view'

// Game-map layer: captures the in-game map panel and calibrates it to game units, by the zone rim when it is in view
// and by the terrain (offline satellite map) otherwise; recognises the zone and draws the overlay's points over the
// in-game map. Click-through, except in marker mode (Insert) while the map is calibrated, when clicks become points in
// the overlay and a wheel or a drag still moves the game's map. It never takes the keyboard. Excluded from capture.
export function startLayer() {
  if (window.mapLayer) run(window.mapLayer)
}

function run(api: MapLayerApi) {
  setLanguage(api.language)
  const view = createView()
  view.applyTexts()
  const engine = createEngine(api, view)
  const pass = createMousePass({
    api,
    canPass: () => engine.isMarking() && Boolean(engine.calibration()),
    movedAt: engine.calMovedAt,
    onChange: view.setPassing,
  })

  // Marker mode: left click places the overlay's current tool (or hits a pin), right click marks the impact.
  function click(e: MouseEvent, button: 'left' | 'right') {
    if (pass.takeDrag()) return
    if (!engine.isMarking()) return
    const p = engine.toWorld(e.clientX, e.clientY)
    if (!p) return
    const target = e.target as Element | null
    const hit = button === 'left' ? (target?.closest?.('[data-pin]') as HTMLElement | null)?.dataset.pin : undefined
    api.click({
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      button,
      pin: hit === undefined ? null : hit === 'player' ? 'player' : Number(hit),
    })
  }
  addEventListener('click', (e) => click(e, 'left'))
  addEventListener('contextmenu', (e) => {
    e.preventDefault()
    click(e, 'right')
  })

  api.onMarking((isOn) => {
    if (!isOn) pass.stop()
    engine.setMarking(isOn)
  })
  api.onSettings((next) => engine.setFps(next?.fps))
  // Troubleshooting snapshot: the frame exactly as analysed (PNG) and what the layer made of it.
  api.onSnapshot(async () => {
    let png: Uint8Array | null = null
    const img = engine.lastImage()
    if (img) {
      const canvas = new OffscreenCanvas(img.width, img.height)
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
      png = new Uint8Array(await (await canvas.convertToBlob({
        type: 'image/png',
      })).arrayBuffer())
    }
    api.snapshot({
      png,
      info: engine.snapshotInfo(),
    })
  })
  api.onSnapped(engine.setSnapped)
  api.onScene(engine.setScene)
  api.onSelection(engine.setSelection)
  // Another language chosen in the overlay: the badge, the search line and the pins follow at once.
  api.onLanguage((next) => {
    setLanguage(next)
    document.title = t('layer.title')
    view.applyTexts()
    view.invalidate()
    engine.refresh()
  })

  // For the checks: game units at a point of this window, and the timings (no readout is shown: the game prints its
  // own next to its cursor).
  Object.assign(window, {
    layerAt: (x: number, y: number) => engine.toWorld(x, y),
    layerStats: engine.stats,
  })
  engine.start()
}
