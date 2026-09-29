import {
  memo,
  useCallback,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react'

import type { Spawn, WorldId, Zone } from '@/data/landmarks'
import {
  coordToMap,
  formatAzimuth,
  MAP_EXTENT,
  mapToCoord,
  type GamePoint,
} from '@/shared/geometry'
import { t } from '@/shared/i18n'

import type { Preset, Target } from '../../core/presets'
import { parseCoordinate } from '../../core/shot'
import { isValidFire } from '../../core/solution'
import { useFireFor, useLandmarkItems, rangeText } from '../../hooks/useFire'
import {
  useFirePlanActions,
  usePreset,
  useSelectedTarget,
  useSelection,
  useViewRequest,
  useWorld,
  type ViewKind,
} from '../../stores/firePlan'

interface View {
  x: number
  y: number
  size: number
}

const FULL: View = {
  x: 0,
  y: 0,
  size: 1000,
}

const FACTION_COLOURS = {
  manticore: '#57c05f',
  valkyra: '#ef5a4f',
  lonestar: '#4d9be0',
}

const clampView = (v: View): View => ({
  size: v.size,
  x: Math.max(0, Math.min(1000 - v.size, v.x)),
  y: Math.max(0, Math.min(1000 - v.size, v.y)),
})

/** The bases and the zone of the region in view, with a margin. */
function regionView(bases: Spawn[], zone: Zone | undefined): View | null {
  const pts = bases.map((b) => ({
    x: b.pos[0] * 1000,
    y: b.pos[1] * 1000,
  }))
  if (zone) {
    const r = zone.radiusM / 16384 * 1000
    pts.push({
      x: zone.pos[0] * 1000 - r,
      y: zone.pos[1] * 1000 - r,
    }, {
      x: zone.pos[0] * 1000 + r,
      y: zone.pos[1] * 1000 + r,
    })
  }
  if (!pts.length) return null
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const size = Math.min(1000, Math.max(150, span * 1.25))
  return {
    x: (Math.min(...xs) + Math.max(...xs) - size) / 2,
    y: (Math.min(...ys) + Math.max(...ys) - size) / 2,
    size,
  }
}

/** The zone's circle filling the map with a margin. */
function zoneView(zone: Zone | undefined): View | null {
  if (!zone) return null
  const r = zone.radiusM / 16384 * 1000
  const size = Math.max(40, r * 2.6)
  return {
    x: zone.pos[0] * 1000 - size / 2,
    y: zone.pos[1] * 1000 - size / 2,
    size,
  }
}

function zoomView(v: View, factor: number, anchor = {
  x: v.x + v.size / 2,
  y: v.y + v.size / 2,
}): View {
  const size = Math.max(40, Math.min(1000, v.size * factor))
  const ratio = size / v.size
  return {
    x: anchor.x - (anchor.x - v.x) * ratio,
    y: anchor.y - (anchor.y - v.y) * ratio,
    size,
  }
}

// Adapts to the zoom (10 → 1 unit = 1 km → 100 m); labels stay on the visible edges.
interface GridProps {
  view: View
  unit: number
}

/** Grid lines at every step from the first one in view, short of the map's edges. */
function gridLines(from: number, to: number, step: number) {
  const lines: number[] = []
  const end = Math.min(to, MAP_EXTENT)
  for (let c = Math.max(step, Math.ceil(from / step) * step); c < end; c += step) lines.push(c)
  return lines
}

function Grid({ view, unit }: GridProps) {
  const span = view.size / 1000 * MAP_EXTENT
  const step = span > 70 ? 10 : span > 30 ? 5 : span > 12 ? 2 : 1
  const x0 = view.x / 1000 * MAP_EXTENT
  const x1 = (view.x + view.size) / 1000 * MAP_EXTENT
  const y0 = (1 - (view.y + view.size) / 1000) * MAP_EXTENT
  const y1 = (1 - view.y / 1000) * MAP_EXTENT
  const columns = gridLines(x0, x1, step)
  const rows = gridLines(y0, y1, step)
  const label = {
    'fontSize': 10 * unit,
    'strokeWidth': 3 * unit,
  }
  return (
    <g id="terrain-grid" pointerEvents="none">
      {columns.map((c) => {
        const x = c / MAP_EXTENT * 1000
        return (
          <g key={'x' + c}>
            <line x1={x} y1={0} x2={x} y2={1000} className={c % 10 === 0 ? 'major' : ''} />
            {x - view.x > 24 * unit && (
              <text x={x + 3 * unit} y={view.y + 12 * unit} {...label}>{c}</text>
            )}
          </g>
        )
      })}
      {rows.map((c) => {
        const y = (1 - c / MAP_EXTENT) * 1000
        return (
          <g key={'y' + c}>
            <line x1={0} y1={y} x2={1000} y2={y} className={c % 10 === 0 ? 'major' : ''} />
            {y - view.y > 24 * unit && (
              <text x={view.x + 4 * unit} y={y - 3 * unit} {...label}>{c}</text>
            )}
          </g>
        )
      })}
    </g>
  )
}

interface LandmarksProps {
  bases: Spawn[]
  zone: Zone | undefined
  unit: number
}

const Landmarks = memo(function Landmarks({
  bases, zone, unit,
}: LandmarksProps) {
  return (
    <g id="terrain-landmarks" pointerEvents="none">
      {zone && (() => {
        const x = zone.pos[0] * 1000
        const y = zone.pos[1] * 1000
        const r = zone.radiusM / 16384 * 1000
        return (
          <>
            <circle
              className="control-zone"
              cx={x}
              cy={y}
              r={r}
              fill="#fff2dd14"
              stroke="#fff2dd"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={x}
              y={y - r - 6 * unit}
              textAnchor="middle"
              fontSize={12 * unit}
              strokeWidth={3 * unit}
              className="landmark-label"
            >
              {t('zone.label', {
                r: zone.radiusM,
              })}
            </text>
          </>
        )
      })()}
      {bases.map((b) => {
        const x = b.pos[0] * 1000
        const y = b.pos[1] * 1000
        const colour = FACTION_COLOURS[b.faction]
        return (
          <g key={b.town} className="spawn-base" data-town={b.town}>
            <circle cx={x} cy={y} r={11 * unit} fill="#08090a" stroke={colour} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <text
              x={x}
              y={y + 4.5 * unit}
              textAnchor="middle"
              fill={colour}
              fontSize={13 * unit}
              fontWeight="bold"
              fontFamily="Bahnschrift, sans-serif"
            >
              {b.faction[0].toUpperCase()}
            </text>
            <text
              x={x}
              y={y + 25 * unit}
              textAnchor="middle"
              fontSize={12 * unit}
              strokeWidth={3 * unit}
              className="landmark-label"
            >
              {b.town}
            </text>
          </g>
        )
      })}
    </g>
  )
})

interface PinProps {
  point: GamePoint
  label: string
  unit: number
  stroke: string
  fill?: string
  text?: string
  glyph?: number
  marker?: string
  title?: string
  ariaLabel?: string
  isInteractive?: boolean
  onClick?: () => void
}

function Pin({
  point, label, unit, stroke, fill = '#08090a', text = stroke, glyph = 11, marker, title, ariaLabel, ...rest
}: PinProps) {
  const q = coordToMap(point)
  const { isInteractive = true, onClick } = rest
  return (
    <g
      className="map-pin"
      data-marker={marker ?? label}
      role={onClick ? 'button' : undefined}
      aria-label={ariaLabel}
      style={isInteractive ? undefined : {
        pointerEvents: 'none',
      }}
      onClick={onClick && ((e) => {
        e.stopPropagation()
        onClick()
      })}
    >
      <circle cx={q.x} cy={q.y} r={11 * unit} fill={fill} stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <text x={q.x} y={q.y} textAnchor="middle" dominantBaseline="central" fill={text} fontSize={glyph * unit}>{label}</text>
      {title && <title>{title}</title>}
    </g>
  )
}

interface MarkersProps {
  preset: Preset
  target: Target | undefined
  unit: number
}

const Markers = memo(function Markers({
  preset, target, unit,
}: MarkersProps) {
  const { clickTarget, removePlayer } = useFirePlanActions()
  const f = useFireFor(preset, target)
  const player = preset.player
  let hit: GamePoint | null = null
  if (target?.hit) {
    try {
      hit = parseCoordinate(target.hit)
    } catch {
      hit = null
    }
  }
  const corrected = isValidFire(f) && f.isCorrected ? f : null
  type LineProps = Record<string, string | number>
  const line = (a: GamePoint, b: GamePoint, props: LineProps, key: string) => {
    const p = coordToMap(a)
    const q = coordToMap(b)
    return <line key={key} x1={p.x} y1={p.y} x2={q.x} y2={q.y} vectorEffect="non-scaling-stroke" pointerEvents="none" {...props} />
  }
  const selected = target && coordToMap(target.point)
  return (
    <g id="terrain-markers">
      {player && preset.targets.filter((x) => x !== target).map((x) => line(player, x.point, {
        'stroke': '#fff2dd',
        'strokeOpacity': .5,
        'strokeWidth': 1,
      }, 'ray' + x.id))}
      {player && target && line(player, target.point, {
        'stroke': '#ffd24a',
        'strokeWidth': 2,
      }, 'chosen')}
      {player && target && hit && line(target.point, hit, {
        'stroke': '#ff6a3d',
        'strokeWidth': 1.5,
        'strokeDasharray': '4 3',
      }, 'miss')}
      {player && corrected && line(player, corrected.aim, {
        'stroke': '#c9a7ff',
        'strokeWidth': 1.5,
        'strokeDasharray': '6 5',
      }, 'aim')}
      {selected && (
        <circle
          className="pin-halo"
          cx={selected.x}
          cy={selected.y}
          r={17 * unit}
          fill="none"
          stroke="#ffd24a"
          strokeWidth={1}
          strokeOpacity={.7}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      {preset.targets.map((x) => {
        const isChosen = x === target
        const hint = t(isChosen ? 'list.removeLabel' : 'pin.select', {
          id: x.id,
        })
        return (
          <Pin
            key={'pin' + x.id}
            point={x.point}
            label={String(x.id)}
            unit={unit}
            stroke={isChosen ? '#ffd24a' : '#fff2dd'}
            marker={t('fs.target', {
              id: x.id,
            })}
            title={isChosen ? hint + t('pin.again') : hint}
            ariaLabel={hint}
            onClick={() => clickTarget(x.id)}
          />
        )
      })}
      {player && (
        <Pin
          point={player}
          label={t('tools.me')}
          unit={unit}
          stroke="#08090a"
          fill="#fff2dd"
          text="#141310"
          title={t('pin.removeMeTitle')}
          ariaLabel={t('pin.removeMe')}
          onClick={removePlayer}
        />
      )}
      {corrected && <Pin point={corrected.aim} label="+" unit={unit} stroke="#c9a7ff" glyph={17} isInteractive={false} />}
      {hit && <Pin point={hit} label="×" unit={unit} stroke="#ff6a3d" glyph={17} isInteractive={false} />}
      {selected && isValidFire(f) && (
        <text
          className="pin-label"
          x={selected.x + 19 * unit}
          y={selected.y + 4 * unit}
          fill="#ffd24a"
          fontSize={12 * unit}
          strokeWidth={3 * unit}
        >
          {formatAzimuth(f.azimuth) + ' · ' + rangeText(f)}
        </text>
      )}
    </g>
  )
})

interface ZoomButtonsProps {
  hasZone: boolean
  onView: (kind: ViewKind) => void
}

function ZoomButtons({ hasZone, onView }: ZoomButtonsProps) {
  return (
    <div className="map-zoom" role="group" aria-label={t('map.zoom')}>
      <button id="fit-zone" type="button" title={t('zoom.zoneTitle')} aria-label={t('zoom.zoneLabel')} disabled={!hasZone} onClick={() => onView('zone')}>
        {t('zoom.zone')}
      </button>
      <button id="fit-region" type="button" title={t('zoom.basesTitle')} aria-label={t('zoom.basesLabel')} onClick={() => onView('region')}>
        {t('zoom.bases')}
      </button>
      <button id="reset-map" type="button" title={t('zoom.allTitle')} aria-label={t('zoom.allLabel')} onClick={() => onView('all')}>
        {t('zoom.all')}
      </button>
      <button id="zoom-out" type="button" title={t('zoom.outTitle')} aria-label={t('zoom.outLabel')} onClick={() => onView('out')}>−</button>
      <button id="zoom-in" type="button" title={t('zoom.inTitle')} aria-label={t('zoom.inLabel')} onClick={() => onView('in')}>+</button>
    </div>
  )
}

interface Drag {
  x: number
  y: number
  vx: number
  vy: number
  isMoved: boolean
}

/** The offline map: the game map's image, the grid, the region's bases and zone, and the points of the preset. */
export function OfflineMap() {
  const world: WorldId = useWorld()
  const selection = useSelection()
  const preset = usePreset()
  const target = useSelectedTarget()
  const request = useViewRequest()
  const { place } = useFirePlanActions()
  const { bases, zone } = useLandmarkItems(world, selection)
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>(FULL)
  const [width, setWidth] = useState(500)
  const [readout, setReadout] = useState('X — · Y —')
  const [isPanning, setPanning] = useState(false)
  const drag = useRef<Drag | null>(null)
  const isClickSuppressed = useRef(false)
  const unit = view.size / (width || 500)

  const applyView = useCallback((kind: ViewKind) => {
    setView((v) => {
      const next = kind === 'region' ? regionView(bases, zone)
        : kind === 'zone' ? zoneView(zone)
          : kind === 'all' ? FULL
            : kind === 'in' ? zoomView(v, .7)
              : zoomView(v, 1 / .7)
      return next ? clampView(next) : v
    })
  }, [bases, zone])

  // Requests from the store: a preset switch shows the region, the hotkeys zoom. Applied while rendering, once
  // per request. The map opens whole, as in 1.x: a request made before it mounted (the restore at start) is skipped.
  const [requestId, setRequestId] = useState(request.id)
  if (requestId !== request.id) {
    setRequestId(request.id)
    applyView(request.kind)
  }

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(() => setWidth(svg.clientWidth))
    observer.observe(svg)
    setWidth(svg.clientWidth)
    return () => observer.disconnect()
  }, [])

  const locate = (e: Pick<MouseEvent, 'clientX' | 'clientY'>) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: view.x + (e.clientX - rect.left) / rect.width * view.size,
      y: view.y + (e.clientY - rect.top) / rect.height * view.size,
    }
  }

  // Wheel zoom at the cursor; the listener must not be passive to keep the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      setView((v) => clampView(zoomView(v, e.deltaY < 0 ? .85 : 1 / .85, {
        x: v.x + (e.clientX - rect.left) / rect.width * v.size,
        y: v.y + (e.clientY - rect.top) / rect.height * v.size,
      })))
    }
    svg.addEventListener('wheel', onWheel, {
      passive: false,
    })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button > 2) return
    isClickSuppressed.current = false
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      vx: view.x,
      vy: view.y,
      isMoved: false,
    }
  }

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = mapToCoord(locate(e))
    setReadout(`X ${p.x.toFixed(2)} · Y ${p.y.toFixed(2)}`)
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.hypot(dx, dy) > 5 && !d.isMoved) {
      d.isMoved = true
      isClickSuppressed.current = true
      svgRef.current!.setPointerCapture(e.pointerId)
      setPanning(true)
    }
    if (!d.isMoved) return
    const rect = svgRef.current!.getBoundingClientRect()
    setView((v) => clampView({
      size: v.size,
      x: d.vx - dx / rect.width * v.size,
      y: d.vy - dy / rect.height * v.size,
    }))
  }

  const endDrag = (e?: PointerEvent<SVGSVGElement>) => {
    drag.current = null
    setPanning(false)
    const svg = svgRef.current
    if (e && svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId)
  }

  return (
    <div id="terrain-frame" className="hud-frame">
      <svg
        id="terrain"
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.size} ${view.size}`}
        role="img"
        aria-label={t('map.aria')}
        className={isPanning ? 'panning' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          if (!drag.current) setReadout('X — · Y —')
        }}
        onPointerUp={endDrag}
        onPointerCancel={() => endDrag()}
        onClickCapture={(e) => {
          if (!isClickSuppressed.current) return
          e.stopPropagation()
          isClickSuppressed.current = false
        }}
        onClick={(e) => {
          if (!(e.target as Element).closest('.map-pin')) place(mapToCoord(locate(e)))
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!isClickSuppressed.current) place(mapToCoord(locate(e)), 'hit')
        }}
      >
        <image id="terrain-image" width={1000} height={1000} href={`maps/${world}.webp`} />
        <Grid view={view} unit={unit} />
        <Landmarks bases={bases} zone={zone} unit={unit} />
        <Markers preset={preset} target={target} unit={unit} />
      </svg>
      <output id="cursor-coords" className="map-readout">{readout}</output>
      <ZoomButtons hasZone={Boolean(zone)} onView={applyView} />
    </div>
  )
}
