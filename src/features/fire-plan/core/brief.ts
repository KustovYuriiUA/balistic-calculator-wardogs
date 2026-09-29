import { t, type TextKey } from '@/shared/i18n'
import type { MapTool } from '@/shared/ipc'

import type { Preset, Target } from './presets'

export interface Brief {
  step: string
  key: TextKey
  vars?: Record<string, number>
  isDone: boolean
}

/** The next step above the map. Its text carries <b> markup from the dictionary. */
export function briefFor(preset: Preset, target: Target | undefined, tool: MapTool): Brief {
  if (!preset.player) {
    return {
      step: '1/3',
      key: tool === 'player' ? 'brief.placeMe' : 'brief.meFirst',
      isDone: false,
    }
  }
  if (tool === 'player') {
    return {
      step: '',
      key: 'brief.moveMe',
      isDone: false,
    }
  }
  if (!preset.targets.length) {
    return {
      step: '2/3',
      key: 'brief.markTarget',
      isDone: false,
    }
  }
  if (!target) {
    return {
      step: '',
      key: 'brief.pickTarget',
      isDone: false,
    }
  }
  const vars = {
    id: target.id,
  }
  if (tool === 'hit') {
    return {
      step: '',
      key: 'brief.hit',
      vars,
      isDone: false,
    }
  }
  if (!target.hit) {
    return {
      step: '3/3',
      key: 'brief.fire',
      vars,
      isDone: false,
    }
  }
  return {
    step: '✓',
    key: 'brief.done',
    isDone: true,
  }
}

export const briefHtml = (brief: Brief) => t(brief.key, brief.vars)

/** The same text without markup: the game map layer shows it as the next step. */
export const briefText = (brief: Brief) => briefHtml(brief).replace(/<[^>]+>/g, '')
