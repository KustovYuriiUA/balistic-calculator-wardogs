import { t, type TextKey } from '@/shared/i18n'
import type { MapTool } from '@/shared/ipc'

import { pointText } from '../../core/presets'
import { useEntry, useFirePlanActions, usePreset, useTool } from '../../stores/firePlan'

const TOOL_TEXT: Record<MapTool, [TextKey, TextKey]> = {
  player: ['entry.player', 'entry.playerButton'],
  target: ['entry.target', 'entry.targetButton'],
  hit: ['entry.hit', 'entry.hitButton'],
}

/** The player position, and a coordinate field that places the current tool's point. */
export function PositionEntry() {
  const preset = usePreset()
  const tool = useTool()
  const entry = useEntry()
  const { setEntry, placeEntry } = useFirePlanActions()
  const [what, button] = TOOL_TEXT[tool]

  // An empty field takes the coordinates from the clipboard: no need to click into it (and take the keyboard from
  // the game).
  async function placeFromField() {
    let text = entry
    if (!text.trim() && window.overlay?.pasteText) {
      text = (await window.overlay.pasteText().catch(() => '')).trim()
      setEntry(text)
    }
    placeEntry(text)
  }

  return (
    <div className="map-entry">
      <div className="entry-head">
        <h2>{t('entry.title')}</h2>
        <p id="map-player-label" className={preset.player ? '' : 'unset'}>
          {preset.player ? pointText(preset.player) : t('entry.unset')}
        </p>
      </div>
      <label htmlFor="map-coordinate" id="map-coordinate-label">
        {t('entry.label', {
          what: t(what),
        })}
      </label>
      <div className="entry-row">
        <input
          id="map-coordinate"
          placeholder="x95.90, y109.42"
          autoComplete="off"
          spellCheck={false}
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            placeFromField()
          }}
        />
        <button id="place-coordinate" type="button" className="primary" title={t('entry.placeTitle')} onClick={placeFromField}>
          {t(button)}
        </button>
      </div>
    </div>
  )
}
