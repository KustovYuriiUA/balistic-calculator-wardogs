import { useMapError } from '../../stores/firePlan'

/** Why the last point was not placed: off the map, no target for an impact. */
export function MapError() {
  return <p id="map-error" className="field-error" role="alert">{useMapError()}</p>
}
