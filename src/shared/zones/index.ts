import { MAP_LANDMARKS, WORLD_NAMES, isWorld } from '@/data/landmarks'
import { t } from '@/shared/i18n'

export const zoneName = (name: string) => (name === 'Default' ? t('zone.main') : name)

/** "North America · Detroit · Main" for a key "northamerica/zestafona-default"; the key itself when unknown. */
export function zoneTitle(key: string): string {
  const [world, id] = key.split('/')
  if (!isWorld(world)) return key
  const data = MAP_LANDMARKS[world]
  const zone = data.zones.find((z) => z.id === id)
  if (!zone) return key
  const region = data.rotations.find((r) => r.id === zone.rotation)?.name || zone.rotation
  return [WORLD_NAMES[world], region, zoneName(zone.name)].join(' · ')
}
