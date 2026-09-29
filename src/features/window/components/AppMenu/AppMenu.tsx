import type { Ref } from 'react'

import { t } from '@/shared/i18n'
import {
  FONT_SCALES, POLL_RATES, useFontScale, useGameMapStatus, useIsMapShown, usePollFps, useUiActions,
} from '@/store'

interface AppMenuProps {
  onClose: () => void
  /** A short message over the window. */
  notify: (text: string) => void
  ref?: Ref<HTMLDivElement>
}

/** The title bar's menu (desktop): the overlay's own map is optional, the font size and the game map poll rate. */
export function AppMenu({
  onClose, notify, ref,
}: AppMenuProps) {
  const isMapShown = useIsMapShown()
  const fontScale = useFontScale()
  const pollFps = usePollFps()
  const gameMap = useGameMapStatus()
  const {
    setMapShown, setFontScale, setPollFps,
  } = useUiActions()

  const pickArea = () => {
    onClose()
    window.overlay?.gameMap.pick()
  }
  const snapshot = () => {
    onClose()
    if (!gameMap || gameMap.state === 'no-area') {
      notify(t('toast.pickAreaFirst'))
      return
    }
    window.overlay?.gameMap.snapshot()
    notify(t('toast.snapshot'))
  }
  return (
    <div id="app-menu" ref={ref} className="app-menu" role="menu" aria-label={t('bar.menu')}>
      <label className="menu-check">
        <input id="menu-show-map" type="checkbox" checked={isMapShown} onChange={(e) => setMapShown(e.target.checked)} />
        <span>{t('menu.showMap')}</span>
      </label>
      <div className="menu-group">
        <span>{t('menu.fontSize')}</span>
        <div className="menu-segment" role="group" aria-label={t('menu.fontSize')}>
          {FONT_SCALES.map((f) => (
            <button key={f} type="button" data-font={f} aria-pressed={f === fontScale} onClick={() => setFontScale(f)}>
              {Math.round(f * 100)} %
            </button>
          ))}
        </div>
      </div>
      <div className="menu-group">
        <span>{t('menu.pollRate')}</span>
        <div className="menu-segment" role="group" aria-label={t('menu.fps')}>
          {POLL_RATES.map((fps) => (
            <button key={fps} type="button" data-fps={fps} aria-pressed={fps === pollFps} onClick={() => setPollFps(fps)}>
              {fps}
            </button>
          ))}
        </div>
      </div>
      <button type="button" id="menu-pick-area" className="menu-item" role="menuitem" onClick={pickArea}>
        {t('menu.pickArea')}
      </button>
      <button
        type="button"
        id="menu-snapshot"
        className="menu-item"
        role="menuitem"
        title={t('menu.snapshotTitle')}
        onClick={snapshot}
      >
        {t('menu.snapshot')}
      </button>
    </div>
  )
}
