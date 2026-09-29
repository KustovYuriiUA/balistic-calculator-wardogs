import { useEffect } from 'react'

import type { MapTool } from '@/shared/ipc'

import { getFirePlan, type ViewKind } from '../stores/firePlan'
import { presetSelector, selectedTargetSelector } from '../stores/firePlan/selectors'

const TOOLS: Record<string, MapTool> = {
  KeyG: 'player',
  KeyT: 'target',
  KeyH: 'hit',
}

const VIEWS: Record<string, ViewKind> = {
  KeyF: 'region',
  KeyZ: 'zone',
  KeyR: 'all',
  Equal: 'in',
  NumpadAdd: 'in',
  Minus: 'out',
  NumpadSubtract: 'out',
}

/** Physical key codes, so the hotkeys work on the Russian layout too. True when the key did something. */
function hotkey(code: string, isCtrl: boolean) {
  const state = getFirePlan()
  const { actions } = state
  if (isCtrl) {
    if (code !== 'KeyZ') return false
    actions.undo()
    return true
  }
  if (TOOLS[code]) {
    actions.setTool(TOOLS[code])
    return true
  }
  if (/^(Digit|Numpad)[1-9]$/.test(code)) {
    const target = presetSelector(state).targets[Number(code.slice(-1)) - 1]
    if (!target) return false
    actions.choose(target.id)
    return true
  }
  if (code === 'Delete') {
    const target = selectedTargetSelector(state)
    if (!target) return false
    actions.removeTarget(target.id)
    return true
  }
  if (VIEWS[code]) {
    actions.requestView(VIEWS[code])
    return true
  }
  return false
}

/** The map's hotkeys, while the map is shown and no text field has the keyboard. */
export function useHotkeys(isActive: boolean) {
  useEffect(() => {
    if (!isActive) return
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.altKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return
      if (hotkey(e.code, e.ctrlKey)) e.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isActive])
}
