import { useEffect } from 'react'

import { useGameMapStatus, useIsMapShown, useOverlayMode, useUiActions } from '@/store'

import { useCompactView } from './useCompactView'

/** The body's classes and mode: the page's CSS lays the window out by them. */
export function useWindowLayout() {
  const mode = useOverlayMode()
  const gameMap = useGameMapStatus()
  const isMapShown = useIsMapShown()
  const { isCompact, isCompactView } = useCompactView()
  const { setTab } = useUiActions()
  const isDesktop = Boolean(window.overlay)

  useEffect(() => {
    const body = document.body
    body.classList.toggle('desktop', isDesktop)
    body.classList.toggle('view-only', isDesktop && mode === 'view')
    body.classList.toggle('marking', Boolean(gameMap?.isMarking))
    body.classList.toggle('compact-map', isCompactView)
    // Only a compact window chosen by hand follows the content's height; a narrowed one keeps its size.
    body.classList.toggle('fit-height', isDesktop && isCompact)
    body.classList.toggle('map-hidden', !isMapShown)
    if (isDesktop) body.dataset.mode = mode
  }, [isDesktop, mode, gameMap?.isMarking, isCompactView, isCompact, isMapShown])

  // The calculator has no compact layout.
  useEffect(() => {
    if (isCompactView) setTab('map')
  }, [isCompactView, setTab])

  // A compact desktop window's height follows the content (viewing shows less than editing), within the screen.
  useEffect(() => {
    const api = window.overlay
    const main = document.querySelector('main')
    if (!api || !isCompact || !main) return
    const fit = () => api.fitHeight(Math.ceil(main.getBoundingClientRect().bottom + scrollY + 8))
    const observer = new ResizeObserver(() => requestAnimationFrame(fit))
    observer.observe(main)
    return () => observer.disconnect()
  }, [isCompact])
}
