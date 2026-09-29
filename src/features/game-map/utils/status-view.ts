import { WORLD_NAMES, isWorld } from '@/data/landmarks'
import { display } from '@/shared/format'
import { t } from '@/shared/i18n'
import type { GameMapStatus } from '@/shared/ipc'
import { zoneTitle } from '@/shared/zones'

/** The row's look: the dot's colour and animation in CSS follow it. */
export type RowState =
  | 'no-area'
  | 'starting'
  | 'closed'
  | 'searching'
  | 'acquiring'
  | 'weak'
  | 'error'
  | 'locked'
  | 'guess'
  | 'marking'

export interface StatusView {
  state: RowState
  lead: string
  strong: string
  tip: string
}

export const worldName = (world: string | null) => (world && isWorld(world) ? WORLD_NAMES[world] : world ?? '')

function baseView(s: GameMapStatus, title: string): StatusView {
  const plain = t('gm.lead')
  const open = s.isOpen === true ? t('gm.openLead') : plain
  const view = (state: RowState, lead: string, strong: string, tip: string): StatusView => ({
    state,
    lead,
    strong,
    tip,
  })
  switch (s.state) {
    case 'no-area': return view('no-area', plain, t('gm.pickArea'), t('gm.pickAreaTip'))
    case 'starting': return view('starting', plain, t('gm.starting'), t('gm.startingTip'))
    case 'closed': return view('closed', t('gm.closedLead'), t('gm.closed'), t('gm.closedTip'))
    case 'searching': return view('searching', t('gm.waitLead'), 'M', t('gm.waitTip'))
    case 'acquiring': {
      const strong = t('gm.acquiring', {
        p: Math.round((s.progress ?? 0) * 100),
      })
      return view('acquiring', open, strong, t('gm.acquiringTip'))
    }
    case 'open': return s.isFailed
      ? view('weak', open, t('gm.failed'), t('gm.failedTip'))
      : view('acquiring', open, t('gm.open'), t('gm.openTip'))
    case 'error': return view('error', plain, s.message || t('gm.error'), '')
    case 'weak': return view('weak', t('gm.weakLead'), t('gm.weak'), t('gm.weakTip'))
    default: break
  }
  if (s.source === 'terrain') {
    const strong = t('gm.byTerrain', {
      world: worldName(s.world),
    })
    return view('locked', plain, strong, t('gm.byTerrainTip'))
  }
  if (s.isRecognised) return view('locked', plain, title, t('gm.recognisedTip'))
  return view('guess', t('gm.guessLead'), title, t('gm.guessTip'))
}

/** Every step of the layer shows: capture starting, map closed, open and searching (with progress), found. */
export function statusView(s: GameMapStatus): StatusView {
  const title = s.key ? zoneTitle(s.key) : ''
  const view = baseView(s, title)
  // Marker mode: on the found map the clicks become points; before that it waits for the map.
  if (s.isMarking && s.isCalibrated) {
    return {
      state: 'marking',
      lead: t('gm.markingLead'),
      strong: t('gm.marking'),
      tip: t('gm.markingTip', {
        title: title || worldName(s.world),
      }),
    }
  }
  if (s.isMarking) view.lead = t('gm.markingOnLead') + view.lead
  if (s.metresPerPixel) {
    view.tip += t('gm.mpp', {
      v: display(s.metresPerPixel),
    })
  }
  return view
}
