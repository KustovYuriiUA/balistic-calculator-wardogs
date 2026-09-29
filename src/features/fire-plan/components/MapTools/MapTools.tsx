import type { ReactNode } from 'react'

import { t, type TextKey } from '@/shared/i18n'
import type { MapTool } from '@/shared/ipc'

import { briefFor, briefHtml } from '../../core/brief'
import { useFirePlanActions, usePreset, useSelectedTarget, useTool } from '../../stores/firePlan'

const TOOLS: {
  tool: MapTool
  icon: string
  label: TextKey
  title: TextKey
  key: string
}[] = [
  {
    tool: 'player',
    icon: 'me',
    label: 'tools.me',
    title: 'tools.meTitle',
    key: 'G',
  },
  {
    tool: 'target',
    icon: 'goal',
    label: 'tools.target',
    title: 'tools.targetTitle',
    key: 'T',
  },
  {
    tool: 'hit',
    icon: 'burst',
    label: 'tools.hit',
    title: 'tools.hitTitle',
    key: 'H',
  },
]

interface MapToolsProps {
  /** Buttons at the right end of the row: the capture area and the map's visibility. */
  actions?: ReactNode
}

/** What LMB places on the map, the next step, and the row's actions. */
export function MapTools({ actions }: MapToolsProps) {
  const tool = useTool()
  const preset = usePreset()
  const target = useSelectedTarget()
  const { setTool } = useFirePlanActions()
  const brief = briefFor(preset, target, tool)
  return (
    <div className="map-tools-row">
      <div className="map-tools" role="group" aria-label={t('tools.label')}>
        {TOOLS.map((x) => (
          <button
            key={x.tool}
            type="button"
            data-map-tool={x.tool}
            aria-pressed={tool === x.tool}
            title={t(x.title)}
            onClick={() => setTool(x.tool)}
          >
            <i className={'tool-icon ' + x.icon} aria-hidden="true" />
            <span>{t(x.label)}</span>
            <kbd>{x.key}</kbd>
          </button>
        ))}
      </div>
      <p id="map-brief" className={'map-brief' + (brief.isDone ? ' done' : '')} role="status">
        <b id="brief-step" hidden={!brief.step}>{brief.step}</b>
        <span id="map-help" dangerouslySetInnerHTML={{
          __html: briefHtml(brief),
        }} />
      </p>
      <div className="map-actions">{actions}</div>
    </div>
  )
}
