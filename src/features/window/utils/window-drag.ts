import type { PointerEvent } from 'react'

import type { DragKind } from '@/shared/ipc'

/** Moving (title bar) and resizing (window edges) through the app, which follows the cursor: Windows' own drag
 * would activate another window for this one, which cannot take focus, and the game would lose the keyboard. */
export function startWindowDrag(e: PointerEvent<HTMLElement>, kind: DragKind) {
  const api = window.overlay
  if (!api || e.button !== 0) return
  e.preventDefault()
  const el = e.currentTarget
  el.setPointerCapture(e.pointerId)
  api.drag(kind, 'start')
  const move = () => api.drag(kind, 'move')
  const end = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('pointercancel', end)
    api.drag(kind, 'end')
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}
