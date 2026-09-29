import { setLanguage, t } from '@/shared/i18n'
import type { MapLayerApi } from '@/shared/ipc'

const MIN = 120

// A dimmed full-screen window: drag a rectangle around the in-game map panel. Right click cancels (the window never
// takes the keyboard: the game keeps it, so M still opens the map meanwhile).
export function startPicker() {
  if (window.mapLayer) run(window.mapLayer)
}

function run(api: MapLayerApi) {
  setLanguage(api.language)
  const $ = (id: string) => document.getElementById(id)!
  document.title = t('picker.title')
  $('hint-title').textContent = t('picker.hint')
  $('hint-text').textContent = t('picker.text')

  type Point = {
    x: number
    y: number
  }
  let start: Point | null = null
  let box: ReturnType<typeof rectOf> | null = null
  const rectOf = (a: Point, b: Point) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  })

  function show(r: ReturnType<typeof rectOf>) {
    const el = $('rect')
    el.hidden = false
    Object.assign(el.style, {
      left: r.x + 'px',
      top: r.y + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
    })
    $('size').textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`
  }

  addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    start = {
      x: e.clientX,
      y: e.clientY,
    }
    box = null
    document.body.setPointerCapture(e.pointerId)
    document.body.classList.add('dragging')
    $('hint').classList.remove('error')
  })
  addEventListener('pointermove', (e) => {
    if (!start) return
    box = rectOf(start, {
      x: e.clientX,
      y: e.clientY,
    })
    show(box)
  })
  addEventListener('pointerup', () => {
    if (!start) return
    start = null
    if (box && box.width >= MIN && box.height >= MIN) {
      api.picked(box)
      return
    }
    document.body.classList.remove('dragging')
    $('rect').hidden = true
    $('hint').classList.add('error')
    $('hint-text').textContent = t('picker.small', {
      min: MIN,
    })
  })
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.cancel()
  })
  addEventListener('contextmenu', (e) => {
    e.preventDefault()
    api.cancel()
  })
}
