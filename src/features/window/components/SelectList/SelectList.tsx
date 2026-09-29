import {
  useEffect, useLayoutEffect, useRef, useState, type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'

import type { OverlayMode } from '@/shared/ipc'
import { getMode, useOverlayMode } from '@/store'

const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable]'

/** As if the user picked the option: React's onChange follows the native change event. */
function pick(select: HTMLSelectElement, value: string) {
  if (select.value === value) return
  select.value = value
  select.dispatchEvent(new Event('change', {
    bubbles: true,
  }))
}

interface OpenList {
  select: HTMLSelectElement
  /** The mode it was opened in: a mode change closes it. */
  mode: OverlayMode
}

/** Outside the keyboard mode the window has no keyboard, so the game keeps its focus: a native <select> does not
 * open then, and it gets its list from here. A click into a text field asks for the keyboard. */
export function SelectList() {
  const [open, setOpen] = useState<OpenList | null>(null)
  const [style, setStyle] = useState<CSSProperties>({
    visibility: 'hidden',
  })
  const listRef = useRef<HTMLDivElement>(null)
  const mode = useOverlayMode()
  const select = open?.mode === mode ? open.select : null

  useEffect(() => {
    const api = window.overlay
    if (!api) return
    const close = () => setOpen(null)
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element
      const inList = listRef.current?.contains(target)
      const field = target.closest?.('select')
      if (!inList && !field) close()
      if (getMode() === 'keyboard') return
      if (field) {
        e.preventDefault()
        if (field.disabled) return
        setOpen((list) => (list?.select === field
          ? null
          : {
            select: field,
            mode: getMode(),
          }))
        return
      }
      if (target.closest?.(TEXT_FIELD)) api.keyboard()
    }
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    addEventListener('resize', close)
    addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      removeEventListener('resize', close)
      removeEventListener('scroll', onScroll, true)
    }
  }, [])

  // Under the field, or above it where there is more room.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!select || !list) return
    const r = select.getBoundingClientRect()
    const below = innerHeight - r.bottom - 8
    const above = r.top - 8
    const isDown = below >= Math.min(list.scrollHeight, 240) || below >= above
    setStyle({
      left: Math.max(4, Math.min(r.left, innerWidth - list.offsetWidth - 4)),
      minWidth: r.width,
      maxHeight: Math.max(120, isDown ? below : above),
      top: isDown ? r.bottom + 2 : undefined,
      bottom: isDown ? undefined : innerHeight - r.top + 2,
    })
  }, [select])

  if (!select) return null
  const choose = (value: string) => {
    setOpen(null)
    pick(select, value)
  }
  return createPortal(
    <div ref={listRef} className="select-list" data-for={select.id} role="listbox" style={style}>
      {[...select.options].map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          disabled={option.disabled}
          aria-selected={option.selected}
          onClick={() => choose(option.value)}
        >
          {option.textContent}
        </button>
      ))}
    </div>,
    document.body,
  )
}
