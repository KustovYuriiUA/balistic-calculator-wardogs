import { useEffect, useRef, useState, type ReactNode } from 'react'

import { t } from '@/shared/i18n'
import type { OverlayMode } from '@/shared/ipc'
import { useGameMapStatus, useOverlayMode, useUpdateState } from '@/store'

import { barView } from '../../utils/bar-view'
import { startWindowDrag } from '../../utils/window-drag'
import { AppMenu } from '../AppMenu'
import { LanguageSelect } from '../LanguageSelect'
import { Logo } from '../Logo'

interface WindowBarProps {
  /** The updater's pill, between the language and the window buttons. */
  updatePill: ReactNode
  notify: (text: string) => void
}

/** The desktop window's title bar: menu, mode pill (marker mode on the game map), language, hide and quit. It drags
 * the window. */
export function WindowBar({ updatePill, notify }: WindowBarProps) {
  const mode = useOverlayMode()
  const gameMap = useGameMapStatus()
  const update = useUpdateState()
  // The mode the menu was opened in: a mode change (Insert, a click on the game) closes it.
  const [menuMode, setMenuMode] = useState<OverlayMode | null>(null)
  const isMenuOpen = menuMode === mode
  const setMenuOpen = (isOpen: boolean) => setMenuMode(isOpen ? mode : null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuMode(null)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [isMenuOpen])

  const api = window.overlay
  if (!api) return null
  const bar = barView(mode, gameMap)
  const brandTitle = update ? t('app.name') + ' ' + update.current : undefined
  return (
    <>
      <div
        id="window-bar"
        onPointerDown={(e) => {
          if (!(e.target as Element).closest('button,select')) startWindowDrag(e, 'move')
        }}
      >
        <button
          id="menu-button"
          className="menu-button"
          type="button"
          title={t('bar.menu')}
          aria-label={t('bar.menu')}
          aria-haspopup="true"
          aria-expanded={isMenuOpen}
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(!isMenuOpen)
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" /></svg>
        </button>
        <span className="window-brand" id="window-brand" title={brandTitle}><Logo /><span>{t('app.name')}</span></span>
        <button id="overlay-mode" className="mode-pill" type="button" title={t('bar.modeTitle')} onClick={() => api.marking()}>
          {bar.pill}
        </button>
        <span className="window-shortcut" id="overlay-hint" dangerouslySetInnerHTML={{
          __html: bar.hint,
        }} />
        <LanguageSelect id="language-select" />
        {updatePill}
        <button id="hide-overlay" type="button" title={t('bar.hide')} aria-label={t('bar.hideLabel')} onClick={() => api.hide()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" strokeWidth="2" /></svg>
        </button>
        <button id="quit-overlay" type="button" title={t('bar.quit')} aria-label={t('bar.quit')} onClick={() => api.quit()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" strokeWidth="2" /></svg>
        </button>
      </div>
      {isMenuOpen && <AppMenu ref={menuRef} onClose={() => setMenuOpen(false)} notify={notify} />}
    </>
  )
}
