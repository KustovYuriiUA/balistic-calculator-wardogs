import { t } from '@/shared/i18n'
import type { GameMapStatus, OverlayMode } from '@/shared/ipc'

const key = (text: string) => `<kbd>${text}</kbd>`

/** The mode pill and the hint beside it. The hint carries <kbd> markup. */
export function barView(mode: OverlayMode, gameMap: GameMapStatus | null) {
  const ins = key('Insert')
  if (mode === 'keyboard') {
    return {
      pill: t('bar.keyboard'),
      hint: t('bar.keyboardHint'),
    }
  }
  if (gameMap?.isMarking) {
    return {
      pill: t('bar.markers'),
      hint: markingHint(gameMap, ins),
    }
  }
  if (mode === 'edit') {
    return {
      pill: t('bar.map'),
      hint: t('bar.mapHint', {
        ins,
      }),
    }
  }
  return {
    pill: t('bar.view'),
    hint: t('bar.viewHint', {
      ins,
    }),
  }
}

function markingHint(s: GameMapStatus, ins: string) {
  if (s.isCalibrated) {
    return t('bar.markHint', {
      lmb: key(t('key.lmb')),
      rmb: key(t('key.rmb')),
      wheel: key(t('key.wheel')),
      ins,
    })
  }
  if (s.state === 'no-area') {
    return t('bar.pickAreaHint', {
      ins,
    })
  }
  if (s.state === 'closed' || s.state === 'searching') {
    return t('bar.openMapHint', {
      m: key('M'),
      ins,
    })
  }
  return t('bar.searchingHint', {
    ins,
  })
}
