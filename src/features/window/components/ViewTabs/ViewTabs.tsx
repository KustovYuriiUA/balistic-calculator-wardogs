import { t } from '@/shared/i18n'
import { useTab, useUiActions } from '@/store'

import { useCompactView } from '../../hooks/useCompactView'

/** Map or manual calculation, and the compact layout ("Compact" also shrinks the desktop window). */
export function ViewTabs() {
  const tab = useTab()
  const { setTab, setCompact } = useUiActions()
  const {
    isCompact, isNarrow, isCompactView,
  } = useCompactView()
  const compactText = t(isCompact ? 'tabs.full' : isNarrow ? 'tabs.compactAuto' : 'tabs.compact')
  return (
    <nav className="view-tabs" aria-label={t('tabs.label')}>
      <button id="maps-tab" type="button" aria-pressed={tab === 'map'} onClick={() => setTab('map')}>
        {t('tabs.map')}
      </button>
      <button id="calculator-tab" type="button" aria-pressed={tab === 'calc'} onClick={() => setTab('calc')}>
        {t('tabs.calc')}
      </button>
      <button
        id="compact-toggle"
        type="button"
        aria-pressed={isCompactView}
        title={t('tabs.compactTitle')}
        disabled={isNarrow && !isCompact}
        onClick={() => setCompact(!isCompact)}
      >
        {compactText}
      </button>
    </nav>
  )
}
