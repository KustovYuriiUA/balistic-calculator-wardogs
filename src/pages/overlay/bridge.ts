import { getFirePlan } from '@/features/fire-plan'
import { getOverlayActions } from '@/store'

/** The preload's pushes into the stores. Its listeners stay for the page's life, so this runs once, at start. */
export function connectOverlay() {
  const api = window.overlay
  if (!api) return
  const overlay = getOverlayActions()
  const plan = () => getFirePlan().actions
  api.onMode(overlay.setMode)
  api.onUpdate(overlay.setUpdate)
  api.gameMap.onStatus((status) => {
    overlay.setGameMap(status)
    // A zone recognised on the in-game map switches the map, region and zone here.
    if (status.isRecognised && status.key) plan().followGameZone(status.key)
  })
  api.gameMap.onNotice((text) => plan().showToast(text))
  api.gameMap.onClick((click) => plan().placeFromGame(click))
}
