import type { DragKind } from '@/shared/ipc'

import { startWindowDrag } from '../../utils/window-drag'

const EDGES: DragKind[] = ['w', 'e', 's', 'sw', 'se']

/** The window's edges: the app resizes it (see startWindowDrag). */
export function ResizeGrips() {
  if (!window.overlay) return null
  return EDGES.map((edge) => (
    <div key={edge} className="resize-grip" data-resize={edge} onPointerDown={(e) => startWindowDrag(e, edge)} />
  ))
}
