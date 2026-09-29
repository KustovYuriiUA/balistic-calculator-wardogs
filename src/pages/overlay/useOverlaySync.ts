import { useEffect } from 'react'

import { useScene, useZoneKey } from '@/features/fire-plan'
import { useFontScale, useIsCompact, usePollFps } from '@/store'

/** What main and the game map layer follow: the zone to calibrate with, the scene to draw, the window's settings. */
export function useOverlaySync() {
  const zoneKey = useZoneKey()
  const scene = useScene()
  const isCompact = useIsCompact()
  const fontScale = useFontScale()
  const pollFps = usePollFps()
  const api = window.overlay

  // The layer calibrates with the selected zone until it recognises the zone on the in-game map itself.
  useEffect(() => {
    api?.gameMap.select(zoneKey)
  }, [api, zoneKey])
  useEffect(() => {
    api?.gameMap.scene(scene)
  }, [api, scene])
  // "Compact" also shrinks the desktop window and "Full view" restores it.
  useEffect(() => {
    api?.compact(isCompact)
  }, [api, isCompact])
  // The whole window is scaled (page zoom), so text, controls and map stay in proportion.
  useEffect(() => {
    api?.zoom(fontScale)
  }, [api, fontScale])
  useEffect(() => {
    api?.gameMap.settings({
      fps: pollFps,
    })
  }, [api, pollFps])
}
