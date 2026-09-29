import { useGameMapStatus } from '@/store'

import { statusView } from '../../utils/status-view'

/** The game map layer's state, in the row above the fire solution (desktop only). */
export function GameMapRow() {
  const status = useGameMapStatus()
  if (!window.overlay) return null
  const view = status
    ? statusView(status)
    : {
      state: 'no-area',
      lead: '',
      strong: '',
      tip: '',
    }
  return (
    <div id="game-map" className="game-map" data-state={view.state}>
      <i className="game-map-dot" aria-hidden="true" />
      <p id="game-map-status" role="status" title={view.tip}>{view.lead}<b>{view.strong}</b></p>
    </div>
  )
}
