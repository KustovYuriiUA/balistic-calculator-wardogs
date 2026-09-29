import { t } from '@/shared/i18n'
import { useIsMapShown, useUiActions } from '@/store'

/** Hides the overlay's own map: the position, the solution and the targets stay. */
export function ToggleMapButton() {
  const isShown = useIsMapShown()
  const { setMapShown } = useUiActions()
  return (
    <button
      id="toggle-map"
      type="button"
      className="ghost"
      title={t(isShown ? 'map.hideTitle' : 'map.showTitle')}
      onClick={() => setMapShown(!isShown)}
    >
      <span className="long">{t(isShown ? 'map.hide' : 'map.show')}</span>
      <span className="short">{t(isShown ? 'map.hideShort' : 'map.showShort')}</span>
    </button>
  )
}
