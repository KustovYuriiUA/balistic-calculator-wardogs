import {
  Calculator,
  FireSolution,
  MapError,
  MapTools,
  MatchBar,
  OfflineMap,
  PositionEntry,
  StatusBar,
  TargetList,
  Toast,
  useFirePlanActions,
  useHotkeys,
  useShotTool,
} from '@/features/fire-plan'
import { GameMapRow, PickAreaButton } from '@/features/game-map'
import { UpdatePill } from '@/features/updates'
import {
  ResizeGrips,
  SelectList,
  SiteHeader,
  ToggleMapButton,
  ViewTabs,
  WindowBar,
  useWindowLayout,
} from '@/features/window'
import { t } from '@/shared/i18n'
import { useTab, useUiActions } from '@/store'

import { useOverlaySync } from './useOverlaySync'

export function App() {
  const tab = useTab()
  const { setTab } = useUiActions()
  const { showToast } = useFirePlanActions()
  const isMap = tab === 'map'

  useWindowLayout()
  useOverlaySync()
  useHotkeys(isMap)
  useShotTool()

  const actions = (
    <>
      <PickAreaButton />
      <ToggleMapButton />
    </>
  )
  return (
    <>
      <WindowBar updatePill={<UpdatePill />} notify={showToast} />
      <main>
        <SiteHeader />
        <ViewTabs />
        <section id="map-workspace" aria-label={t('map.workspace')} hidden={!isMap}>
          <div className="terrain-layout">
            <div className="map-column">
              <MapTools actions={actions} />
              <OfflineMap />
              <MapError />
            </div>
            <aside className="target-panel" aria-label={t('panel.label')}>
              <MatchBar />
              <GameMapRow />
              <FireSolution onManual={() => setTab('calc')} />
              <PositionEntry />
              <TargetList />
            </aside>
          </div>
          <StatusBar />
        </section>
        <Calculator isHidden={isMap} />
      </main>
      <ResizeGrips />
      <Toast />
      <SelectList />
    </>
  )
}
