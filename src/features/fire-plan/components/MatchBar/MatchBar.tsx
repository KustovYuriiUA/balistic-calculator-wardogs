import { MAP_LANDMARKS, WORLD_NAMES, WORLDS, isWorld } from '@/data/landmarks'
import { t } from '@/shared/i18n'
import { zoneName } from '@/shared/zones'

import { useFirePlanActions, useSelection, useWorld } from '../../stores/firePlan'

/** The map, region and zone of the match: each has its own preset of points. */
export function MatchBar() {
  const world = useWorld()
  const selection = useSelection()
  const {
    setWorld, setRegion, setZone,
  } = useFirePlanActions()
  const data = MAP_LANDMARKS[world]
  const zones = data.zones.filter((z) => z.rotation === selection.region)
  return (
    <div className="match-bar">
      <label className="select-field">
        <span>{t('match.map')}</span>
        <select id="terrain-select" value={world} onChange={(e) => isWorld(e.target.value) && setWorld(e.target.value)}>
          {WORLDS.map((w) => <option key={w} value={w}>{WORLD_NAMES[w]}</option>)}
        </select>
      </label>
      <label className="select-field">
        <span>{t('match.region')}</span>
        <select id="region-select" value={selection.region} onChange={(e) => setRegion(e.target.value)}>
          {data.rotations.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <label className="select-field">
        <span>{t('match.zone')}</span>
        <select
          id="zone-select"
          value={selection.zone}
          disabled={!zones.length}
          onChange={(e) => setZone(e.target.value)}
        >
          {zones.length
            ? zones.map((z) => <option key={z.id} value={z.id}>{zoneName(z.name)}</option>)
            : <option value="">{t('zone.noData')}</option>}
        </select>
      </label>
    </div>
  )
}
