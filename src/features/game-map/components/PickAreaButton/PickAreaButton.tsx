import { t } from '@/shared/i18n'
import { useGameMapStatus } from '@/store'

/** Opens the frame picker over the screen (desktop only). */
export function PickAreaButton() {
  const status = useGameMapStatus()
  if (!window.overlay) return null
  const isFirst = !status || status.state === 'no-area'
  return (
    <button id="pick-area" type="button" className="ghost" title={t('area.pickTitle')} onClick={() => window.overlay?.gameMap.pick()}>
      <span className="long">{t(isFirst ? 'area.pick' : 'area.change')}</span>
      <span className="short">{t('area.pickShort')}</span>
    </button>
  )
}
