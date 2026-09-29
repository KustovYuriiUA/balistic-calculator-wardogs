import { ZONE_PATCHES } from '@/data/generated/zone-patches'
import {
  MAP_LANDMARKS, WORLD_NAMES, WORLDS, isWorld, type WorldId, type Zone,
} from '@/data/landmarks'
import { t, type TextKey } from '@/shared/i18n'
import type {
  LayerConfig, LayerMemory, LayerStatus, MapLayerApi, Scene,
} from '@/shared/ipc'

import {
  captureOf,
  decodePatch,
  discSample,
  fixToWorld,
  HUE_SPREAD,
  hueGap,
  pixelToWorld,
  recogniseZone,
  recoverFix,
  ringCandidates,
  ringTransform,
  trackFix,
  trackRing,
  worldToFix,
  worldToPixel,
  zoneAtPlace,
  type Circle,
  type Fix,
  type Point,
  type Ring,
} from '../core'
import {
  createFramePool,
  cropFor,
  findPanel,
  frameImage,
  frameOpen,
  rawSignature,
  rawUnchanged,
  signature,
  unchanged,
  type Crop,
  type FrameImage,
} from './frame-io'
import { createPyramids } from './pyramids'
import { createSearch, type SearchRecord } from './search'
import type { createView } from './view'

// Frame pacing, the poll rate (a setting, 60 by default) at most: every frame while the map is calibrated (unchanged
// frames cost nothing) and in the first 1.5 s after it opened, up to 30 a second while it is open and not found yet,
// and while it is closed only its frame is checked, up to 30 a second (about 1 ms each). Before the area is fitted to
// the map panel (open or closed unknown), 4 a second. A lost rim or terrain must stay lost for a moment; a rim counts
// once two zone checks agree.
const LOSE_MS = 500
const RECHECK_MS = 5000
const OPEN_MS = 33
const CLOSED_MS = 33
const WAIT_MS = 250
const PROBE_MS = 1000
const MEMORY_MS = 1500
// Wide terrain searches (one worker per map, ~0.3–0.5 s): soon after the map opens and then backing off while it
// stays open and unknown; rarely while its state is unknown; never while it is closed.
const OPEN_SEARCH_MS = [250, 1000, 2000, 4000, 8000]
const BACKGROUND_MS = [4000, 15000]
// A recognised rim is tracked near where it was (a tenth of a full search); a full search runs every FULL_MS all the
// same.
const FULL_MS = 2000
// The calibration moved when the frame's centre or corner lands more than this many frame pixels away.
const MOVE_PX = 1.5

export interface Calibration {
  source: 'rim' | 'terrain'
  world: WorldId
  worldName: string
  toWorld: (a: number, b: number) => Point
  toPixel: (x: number, y: number) => Point
  id: number[]
  mpp: number
}

interface ZoneEntry {
  world: WorldId
  zone: Zone
  readonly title: string
}

interface Terrain {
  world: WorldId
  fix: Fix
  score: number | null
  seen: Float32Array | null
  lostAt: number
  /** Found by a wide search: refined once the map's fine levels are loaded. */
  isFresh: boolean
  /** Tracked on the coarser levels while the map moved: not refined yet. */
  isRough?: boolean
}

interface Vote {
  key: string | null
  count: number
}

export interface LayerStats {
  frames: number
  skipped: number
  ms: number
  acquisitions: number
  workers?: number
  timeline: Record<string, number>
  loads: Record<string, unknown>
  searches: SearchRecord[]
  rim: {
    ms: number
    tracked: number
    searched: number
  }
}

/** Our own errors carry text for the overlay's status line; anything else is a capture error of the browser. */
class LayerError extends Error {}
const fail = (key: TextKey) => new LayerError(t(key))

function zoneEntries() {
  const zones = new Map<string, ZoneEntry>()
  for (const world of WORLDS) {
    const meta = MAP_LANDMARKS[world]
    for (const zone of meta.zones) {
      zones.set(`${world}/${zone.id}`, {
        world,
        zone,
        get title() {
          const region = meta.rotations.find((r) => r.id === zone.rotation)?.name || zone.rotation
          return [WORLD_NAMES[world], region, zone.name === 'Default' ? t('zone.main') : zone.name].join(' · ')
        },
      })
    }
  }
  return zones
}

export function createEngine(api: MapLayerApi, view: ReturnType<typeof createView>) {
  const zones = zoneEntries()
  const patches = Object.fromEntries(
    Object.entries(ZONE_PATCHES.patches).map(([k, text]) => [k, decodePatch(text)]),
  )
  const pool = createFramePool()
  const stats: LayerStats = {
    frames: 0,
    skipped: 0,
    ms: 0,
    acquisitions: 0,
    timeline: {},
    loads: {},
    searches: [],
    rim: {
      ms: 0,
      tracked: 0,
      searched: 0,
    },
  }
  const mark = (name: string) => {
    stats.timeline[name] ??= Math.round(performance.now())
  }

  let fps = 60
  let config: LayerConfig | null = null
  let selected: string | null = null
  let stream: MediaStream | null = null
  let isRestarting = false
  let crop: Crop | null = null
  let sent = ''
  let scene: Scene | null = null
  let isMarking = false
  // mapOpen: from the map's frame on the edges of the fitted area; null until the area is fitted.
  let mapOpen: boolean | null = null
  let openedAt = 0
  let failures = 0
  let probeAt = 0
  let misfits = 0
  let lastEdges: number[] | null = null
  let ring: Ring | null = null
  let candidate: Ring | null = null
  let lostAt = 0
  let recognised: string | null = null
  let vote: Vote = {
    key: null,
    count: 0,
  }
  let checkedAt = 0
  let lastSig: Float32Array | null = null
  let lastCandidates: unknown[] = []
  let forced = 0
  let calMovedAt = 0
  let probePoints: Point[] | null = null
  let fullAt = 0
  let ringAt = 0
  /** The ring one frame earlier: its motion predicts the next position. */
  let ringTrail: (Circle & { at: number }) | null = null
  // rimHue: hue of the rim recognised as the zone; until then no circle calibrates (marker circles look alike).
  let rimHue: number | null = null
  let isRimVerified = false
  let terrain: Terrain | null = null
  let lastWorld: WorldId | null = null
  let lastImg: FrameImage | null = null
  let acquireAt = 0
  let acquireWait = BACKGROUND_MS[0]
  // memory: the last calibration, kept by the app across sessions; tried on every frame until memoryUntil after the
  // map opens (once at start, while open or closed is not known).
  let memory: LayerMemory & { world: WorldId } | null = null
  let memoryUntil = Infinity
  let rememberedAt = 0
  // When the map is calibrated (so it is surely open) and the area not fitted yet: find the square map panel in the
  // area grown by 8 % on each side and have the app fit the area to it. Three tries in a row, then three more every
  // 8 s until it is found.
  let panelAt = 0
  let panelTries = 0

  const pyramids = createPyramids({
    giveToWorker: (world, luma) => search.giveToWorker(world, luma),
    onLoaded: (key, loadStats) => {
      stats.loads[key] = loadStats
    },
  })
  const search = createSearch(() => pyramids, {
    onFound: (world, f, seen) => {
      terrain = {
        world,
        fix: {
          x0: f.x0,
          y0: f.y0,
          s: f.s,
        },
        score: f.score,
        seen,
        lostAt: 0,
        isFresh: true,
      }
      lastWorld = world
      pyramids.load(world, 2048)
    },
    onChange: () => refresh(),
    onRecord: (record) => {
      stats.searches = [...stats.searches.slice(-9), record]
    },
    onWorkerReady: () => {
      stats.workers = (stats.workers || 0) + 1
    },
  })

  const interval = () => {
    const isTracking = ring || terrain || (mapOpen && performance.now() < memoryUntil)
    if (isTracking) return 1000 / fps
    return Math.max(mapOpen === false ? CLOSED_MS : mapOpen ? OPEN_MS : WAIT_MS, 1000 / fps)
  }
  const activeKey = () => recognised || selected
  const rimEntry = () => (
    ring && isRimVerified && recognised ? zones.get(recognised) ?? null : null
  )

  // Frame pixels ↔ game units: the rim when it is in view (and the zone known), else the terrain fix.
  function calibration(): Calibration | null {
    const entry = rimEntry()
    if (entry && ring) {
      const tr = ringTransform(ring, entry.zone)
      return {
        source: 'rim',
        world: entry.world,
        worldName: WORLD_NAMES[entry.world],
        toWorld: (a, b) => pixelToWorld(tr, a, b),
        toPixel: (x, y) => worldToPixel(tr, x, y),
        id: [tr.cx, tr.cy, tr.scale],
        mpp: 100 / tr.scale,
      }
    }
    if (terrain) {
      const f = terrain.fix
      return {
        source: 'terrain',
        world: terrain.world,
        worldName: WORLD_NAMES[terrain.world],
        toWorld: (a, b) => fixToWorld(f, a, b),
        toPixel: (x, y) => worldToFix(f, x, y),
        id: [f.x0, f.y0, f.s],
        mpp: f.s,
      }
    }
    return null
  }
  const currentCalibration = () => (crop ? calibration() : null)

  function watchMotion(now: number) {
    const cal = currentCalibration()
    if (!cal || !crop) {
      probePoints = null
      return
    }
    const at = [[crop.rect.width / 2, crop.rect.height / 2], [0, 0]]
    const isMoved = probePoints?.some((p, i) => {
      const q = cal.toPixel(p.x, p.y)
      return Math.hypot(q.x - at[i][0], q.y - at[i][1]) > MOVE_PX
    })
    if (isMoved) calMovedAt = now
    probePoints = at.map(([a, b]) => cal.toWorld(a, b))
  }

  function remember() {
    if (!terrain) return
    const key = recognised || vote.key
    memory = {
      world: terrain.world,
      key: key && zones.get(key)?.world === terrain.world ? key : null,
      fix: {
        ...terrain.fix,
      },
    }
    rememberedAt = performance.now()
    api.remember(memory)
  }

  // Opened: the last calibration is tried on the first frame, the rim is checked at once, the terrain search follows
  // shortly unless the rim locks first. Closed: the points go at once; what was found is remembered for next time.
  function opened(now: number) {
    openedAt = now
    failures = 0
    misfits = 0
    memoryUntil = now + MEMORY_MS
    checkedAt = 0
    lastSig = null
    acquireAt = now + OPEN_SEARCH_MS[0]
  }

  function closed() {
    if (terrain) remember()
    ring = null
    ringTrail = null
    candidate = null
    lostAt = 0
    terrain = null
    isRimVerified = false
    rimHue = null
    // One agreeing check re-verifies the same zone.
    const key = recognised || vote.key
    vote = {
      key,
      count: key ? 1 : 0,
    }
    search.end(null)
  }

  // The map's frame decides open or closed on each frame: waiting for a second one only made opening feel slow.
  function openState(isOpen: boolean, now: number) {
    if (isOpen === mapOpen) return
    mapOpen = isOpen
    if (isOpen) opened(now)
    else closed()
  }

  async function checkFrame(frame: VideoFrame, c: Crop, now: number) {
    const { isOpen, shares } = await frameOpen(frame, c, pool)
    lastEdges = shares.map((s) => +s.toFixed(2))
    openState(isOpen, now)
  }

  // Is this circle the zone rim, and which zone? Two agreeing checks (or one very clear one) verify it; from then on
  // its hue marks the rim. A confident disagreement drops the verification until the new zone is confirmed.
  function recognise(img: FrameImage, found: Ring) {
    const result = recogniseZone(discSample(img, found, ZONE_PATCHES.size), patches)
    if (!result?.isConfident) return
    const isClear = result.score >= .55 && result.margin >= .3
    vote = vote.key === result.key
      ? {
        key: result.key,
        count: vote.count + 1,
      }
      : {
        key: result.key,
        count: isClear ? 2 : 1,
      }
    if (vote.count >= 2) {
      recognised = result.key
      isRimVerified = true
      rimHue = found.hue
    } else if (isRimVerified && recognised !== result.key) isRimVerified = false
  }

  // While the frame says closed, once a second: is the zone rim there anyway? Three times in a row, the panel is
  // looked for around the area: found elsewhere (another UI scale in the game), the area moves to it. Found where it
  // was, or not found, the frame was only covered (a tooltip over its edge): the fitted area stays.
  async function probe(frame: VideoFrame, c: Crop) {
    if (!config) return
    const copy = await pool.copy(frame, c.rect, 'crop')
    const img = {
      width: c.rect.width,
      height: c.rect.height,
      data: copy.rgba(),
    }
    const found = ringCandidates(img)[0]
    const result = found && recogniseZone(discSample(img, found, ZONE_PATCHES.size), patches)
    misfits = result?.isConfident ? misfits + 1 : 0
    if (misfits < 3) return
    misfits = 0
    const p = await findPanel(frame, c, config, pool)
    const r = config.rect
    if (p && (['x', 'y', 'width', 'height'] as const).some((k) => Math.abs(p[k] - r[k]) > 3)) api.refit(p)
  }

  // The last calibration, on the frames after the map opened: the map usually reopens as it was left, but may still be
  // fading or zooming in on the first ones. Without the map's frame (area not fitted yet) the map may be closed: one
  // try only then, and the 3D world must not pass for the map.
  function tryMemory(img: FrameImage) {
    if (!memory) return
    if (mapOpen !== true) memoryUntil = 0
    const levels = pyramids.ready.get(memory.world)
    if (!levels) return
    const minScore = mapOpen ? .4 : .5
    const cap = captureOf(img)
    const f = trackFix(levels, cap, memory.fix, {
      minScore,
    }) || recoverFix(levels, cap, memory.fix, {
      minScore,
    })
    if (!f) return
    // Found on the coarse levels (just after start): refined once the fine ones are loaded.
    terrain = {
      world: memory.world,
      fix: {
        x0: f.x0,
        y0: f.y0,
        s: f.s,
      },
      score: f.score,
      seen: signature(img),
      lostAt: 0,
      isFresh: !pyramids.hasFine(memory.world),
    }
    lastWorld = memory.world
    pyramids.load(memory.world, 2048)
  }

  function track(img: FrameImage, now: number) {
    if (!terrain) return
    // A map found by a search (fresh) is refined once its fine levels are loaded; until then, and while the map stands
    // still, the search's fix stays (at 16 m/px it is finer than this thread's coarse levels).
    const sig = signature(img)
    const hasFine = pyramids.hasFine(terrain.world)
    const isStill = terrain.seen && unchanged(sig, terrain.seen)
    if (isStill && !(terrain.isFresh && hasFine) && !terrain.isRough) return
    const levels = pyramids.ready.get(terrain.world)
    if (!levels) return
    // Without the map's frame to say it closed, the match must stay near the scores this map gave: the 3D world behind
    // a closed map matches ~0.45–0.5 somewhere near, the map itself 0.55–0.7.
    const minScore = mapOpen === null && terrain.score ? Math.max(.3, terrain.score * .75) : .3
    // While the map moves (the calibration moved on the last frames), a quick track on the two coarser levels keeps up
    // with it; the fine level follows once the map stands still (rough: not refined yet, so that frame is not skipped).
    const isQuick = now - calMovedAt < 150 && !terrain.isFresh
    const cap = captureOf(img)
    const f = trackFix(levels, cap, terrain.fix, {
      minScore,
      isQuick,
    }) || recoverFix(levels, cap, terrain.fix, {
      minScore,
    })
    if (hasFine) terrain.isFresh = false
    if (f) {
      terrain.fix = {
        x0: f.x0,
        y0: f.y0,
        s: f.s,
      }
      terrain.score = terrain.score ? terrain.score * .8 + f.score * .2 : f.score
      terrain.seen = sig
      terrain.lostAt = 0
      terrain.isRough = isQuick
      return
    }
    if (!terrain.lostAt) terrain.lostAt = now
    else if (now - terrain.lostAt > LOSE_MS) {
      terrain = null
      acquireAt = 0
      acquireWait = BACKGROUND_MS[0]
      failures = 0
    }
  }

  // One wide search: every map at once, in the workers. The first confident map wins and the others stop.
  function startSearch(img: FrameImage) {
    acquireAt = Infinity
    stats.acquisitions++
    const likely = [lastWorld, (activeKey() || '').split('/')[0]]
    search.start(img.luma, signature(img), likely).then((ok) => {
      // null: stopped (the rim locked or the map closed), neither found nor failed.
      if (ok !== false) {
        if (ok) {
          failures = 0
          acquireWait = BACKGROUND_MS[0]
        }
        acquireAt = 0
        return
      }
      failures++
      if (mapOpen) {
        acquireAt = performance.now()
          + OPEN_SEARCH_MS[Math.min(failures, OPEN_SEARCH_MS.length - 1)]
      } else {
        acquireWait = Math.min(BACKGROUND_MS[1], acquireWait * 1.5)
        acquireAt = performance.now() + acquireWait
      }
    })
  }

  /** The rim on this frame: tracked from the last frames while recognised, else searched. */
  function findRim(img: FrameImage, now: number): Ring | null {
    const rimFrom = performance.now()
    let found: Ring | null = null
    if (ring && isRimVerified && now - fullAt < FULL_MS) {
      const isSteady = ringTrail && now - ringAt < 150 && ringAt - ringTrail.at < 150
      found = trackRing(img, ring, isSteady ? ringTrail : null)
      if (found) stats.rim.tracked++
    }
    // While the terrain holds the calibration and no circle is in sight, the whole frame is searched for the rim 4
    // times a second (it takes ~15 ms), and on every frame once a circle turned up (it must show on two in a row).
    const isSearchDue = ring || candidate || !terrain || terrain.lostAt || now - fullAt >= 250
    if (!found && isSearchDue) {
      const candidates = ringCandidates(img)
      fullAt = now
      stats.rim.searched++
      found = isRimVerified
        ? candidates.find((x) => rimHue !== null && hueGap(x.hue, rimHue) <= HUE_SPREAD) || null
        : candidates[0] || null
      lastCandidates = candidates.map((x) => ({
        cx: +x.cx.toFixed(1),
        cy: +x.cy.toFixed(1),
        r: +x.r.toFixed(1),
        hue: x.hue,
        rms: +x.rms.toFixed(2),
        coverage: +x.coverage.toFixed(2),
        continuity: +x.continuity.toFixed(2),
      }))
    }
    stats.rim.ms = stats.rim.ms * .9 + (performance.now() - rimFrom) * .1
    return found
  }

  function followRim(img: FrameImage, found: Ring | null, now: number) {
    // Locking on needs two frames with the same circle: a lucky fit on the 3D world does not repeat.
    const isSame = candidate && found
      && Math.hypot(found.cx - candidate.cx, found.cy - candidate.cy) < 4
      && Math.abs(found.r - candidate.r) < Math.max(3, found.r * .02)
    candidate = found
    if (found && (ring || isSame)) {
      ringTrail = ring && {
        cx: ring.cx,
        cy: ring.cy,
        r: ring.r,
        at: ringAt,
      }
      ring = found
      ringAt = now
      lostAt = 0
      if (!isRimVerified || now - checkedAt > RECHECK_MS) {
        checkedAt = now
        recognise(img, found)
      }
    } else if (!found) {
      if (!lostAt) lostAt = now
      if (now - lostAt > LOSE_MS) {
        ring = null
        ringTrail = null
        isRimVerified = false
        rimHue = null
        vote = {
          key: recognised,
          count: recognised ? 1 : 0,
        }
      }
    }
    // A rim the patches cannot vouch for is the zone all the same when the terrain puts it where a zone of that map
    // is, of that size (a zoomed-out map, where the disc is small and icons cover much of it).
    if (ring && !isRimVerified && terrain && !terrain.lostAt) {
      const z = zoneAtPlace(MAP_LANDMARKS[terrain.world].zones, terrain.fix, ring)
      const key = z && terrain.world + '/' + z.id
      if (key && zones.has(key)) {
        recognised = key
        isRimVerified = true
        rimHue = ring.hue
        vote = {
          key,
          count: 2,
        }
        checkedAt = now
      }
    }
  }

  /** false when the frame was skipped as unchanged. */
  async function analyse(frame: VideoFrame, now: number): Promise<boolean> {
    if (!config) return false
    const c = cropFor(frame, config)
    const { width, height } = c.rect
    if (width < 64 || height < 64) throw fail('layer.offscreen')
    // Closed: only the map's frame is checked (and a probe once a second), nothing else.
    let isEdgeChecked = false
    if (config.isSnapped && mapOpen === false) {
      await checkFrame(frame, c, now)
      isEdgeChecked = true
      if (mapOpen === false) {
        crop = c
        if (now >= probeAt) {
          probeAt = now + PROBE_MS
          await probe(frame, c)
        }
        return true
      }
    }
    const copy = await pool.copy(frame, c.rect, 'crop')
    // A static map (or a world standing still) needs no work, unless the map is about to count as open or closed, a
    // rim waits for its confirming frame or its zone check, a lost rim or terrain waits to count as gone, a terrain
    // found by a search waits to be refined, or a search is due.
    const sig = rawSignature(copy.buf, copy.layout, copy.format, width, height)
    const isPanelDue = !config.isSnapped
      && now >= panelAt
      && Boolean((ring && isRimVerified) || terrain)
    const isSettled = !isPanelDue && !terrain?.isRough
      && !(memory && !terrain && now < memoryUntil)
      && !(candidate && !ring) && !(ring && !isRimVerified) && !(ring && lostAt)
      && !terrain?.lostAt && !(terrain?.isFresh && pyramids.hasFine(terrain.world))
      && (Boolean(currentCalibration()) || now < acquireAt)
    if (forced > 0) forced--
    else if (lastSig && isSettled && rawUnchanged(sig, lastSig)) return false
    lastSig = sig
    if (config.isSnapped && !isEdgeChecked) {
      await checkFrame(frame, c, now)
      if (mapOpen === false) {
        crop = c
        return true
      }
    }
    const img = frameImage(copy, width, height, frame.colorSpace, pool)
    crop = c
    lastImg = img
    followRim(img, findRim(img, now), now)
    const entry = rimEntry()
    if (!config.isSnapped && now >= panelAt && (entry || terrain)) {
      panelTries++
      const p = await findPanel(frame, c, config, pool)
      if (p) {
        api.panel(p)
        panelAt = Infinity
      } else if (panelTries % 3 === 0) panelAt = now + 8000
    }
    if (entry && ring) {
      // The rim calibrates; the terrain tracker follows it, ready for when the rim leaves the view.
      search.end(null)
      const tr = ringTransform(ring, entry.zone)
      const corner = pixelToWorld(tr, 0, 0)
      terrain = {
        world: entry.world,
        fix: {
          x0: corner.x,
          y0: corner.y,
          s: 100 / tr.scale,
        },
        score: null,
        seen: null,
        lostAt: 0,
        isFresh: false,
      }
      lastWorld = entry.world
      acquireWait = BACKGROUND_MS[0]
      failures = 0
      pyramids.load(entry.world, 2048)
    } else if (!terrain && memory && now <= memoryUntil) tryMemory(img)
    else if (terrain) track(img, now)
    if (terrain && now - rememberedAt > 10000) remember()
    if (!entry && !terrain && !search.isRunning() && now >= acquireAt) startSearch(img)
    return true
  }

  // A small line at the top of the in-game map: opening it or Insert never looks like nothing.
  function busyText(cal: Calibration | null): string | null {
    const since = performance.now() - openedAt
    const isJustOpened = mapOpen === true && since > 250 && since < 5000
    if (cal || mapOpen === false || !(isMarking || isJustOpened)) return null
    if (search.isRunning()) {
      return t('layer.busySearch', {
        p: Math.round((search.progress() ?? 0) * 100),
      })
    }
    if (failures) return t('layer.busyFailed')
    return t(mapOpen ? 'layer.busyOpen' : 'layer.busyWait')
  }

  function draw() {
    const cal = currentCalibration()
    view.draw({
      calibration: cal,
      crop,
      ring,
      isMarking,
      zoneTitle: rimEntry()?.title ?? null,
      busy: busyText(cal),
      scene,
    })
  }

  // starting: no frame analysed yet; closed / open: the map's frame says so (fitted area); searching: open or closed
  // unknown; acquiring: a wide terrain search runs (progress 0…1); isFailed: the last search found nothing.
  function report(status?: Partial<LayerStatus>) {
    const cal = currentCalibration()
    const entry = rimEntry()
    const isRunning = search.isRunning()
    const state: LayerStatus['state'] = cal
      ? (cal.source === 'rim' && ring?.isWeak ? 'weak' : 'locked')
      : !stats.timeline.firstAnalysed ? 'starting'
        : mapOpen === false ? 'closed'
          : isRunning ? 'acquiring'
            : mapOpen ? 'open' : 'searching'
    const next: Partial<LayerStatus> = status ?? {
      state,
      key: entry ? activeKey() : null,
      isRecognised: Boolean(entry && recognised),
      isCalibrated: Boolean(cal),
      source: cal?.source ?? null,
      world: cal?.world ?? null,
      metresPerPixel: cal ? Math.round(cal.mpp * 100) / 100 : null,
      isOpen: mapOpen,
      progress: isRunning ? Math.round((search.progress() ?? 0) * 20) / 20 : null,
      isFailed: !cal && failures > 0,
    }
    const text = JSON.stringify(next)
    if (text === sent) return
    sent = text
    api.status(next as LayerStatus)
  }

  function refresh() {
    draw()
    report()
  }

  const validMemory = (m: LayerMemory | null) => {
    const isValid = m && isWorld(m.world) && ['x0', 'y0', 's'].every((k) => Number.isFinite(m.fix?.[k as 'x0']))
      && m.fix.s > 0
    if (!isValid || !isWorld(m.world)) return null
    return {
      world: m.world,
      key: m.key && zones.has(m.key) ? m.key : null,
      fix: m.fix,
    }
  }

  async function start() {
    try {
      mark('start')
      config = await api.config()
      mark('config')
      selected ??= config.selection
      fps = config.fps || fps
      memory ??= validMemory(config.memory)
      if (memory) {
        lastWorld ??= memory.world
        if (!vote.key && memory.key) {
          vote = {
            key: memory.key,
            count: 1,
          }
        }
      }
      // Coarse maps for every world right away; the remembered map's fine one and the first background search wait
      // until the first frames are shown.
      for (const world of WORLDS) pyramids.load(world, 512)
      acquireAt = Math.max(acquireAt, performance.now() + 1500)
      const remembered = memory
      if (remembered) setTimeout(() => pyramids.load(remembered.world, 2048), 1500)
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: config.sourceId,
            maxWidth: 8192,
            maxHeight: 8192,
            maxFrameRate: fps,
          },
        },
      } as unknown as MediaStreamConstraints)
      mark('stream')
      const processor = new MediaStreamTrackProcessor({
        track: stream.getVideoTracks()[0],
        maxBufferSize: 1,
      })
      const reader = processor.readable.getReader()
      for (let last = 0; ;) {
        const { value: frame, done } = await reader.read()
        if (done || !frame) throw fail('layer.captureStopped')
        mark('firstFrame')
        const now = performance.now()
        if (now - last < interval() - 2) {
          frame.close()
          continue
        }
        last = now
        let isAnalysed: boolean
        try {
          isAnalysed = await analyse(frame, now)
        } finally {
          frame.close()
        }
        if (!isAnalysed) {
          stats.skipped++
          continue
        }
        stats.ms = stats.ms * .9 + (performance.now() - now) * .1
        stats.frames++
        mark('firstAnalysed')
        watchMotion(now)
        refresh()
      }
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      // A new poll rate restarts the capture at once; any other end of the capture is an error, retried in 3 s.
      if (isRestarting) {
        isRestarting = false
        start()
        return
      }
      ring = null
      terrain = null
      search.end(null)
      draw()
      // Our own errors (and the app's, from layer:config) say what is wrong; browser errors get a plain explanation.
      const text = String((error as Error)?.message || '')
      const fromApp = /^Error invoking remote method '[^']*': (?:Error: )?/
      const message = error instanceof LayerError ? text : fromApp.test(text) ? text.replace(fromApp, '') : t('layer.captureFailed')
      report({
        state: 'error',
        message,
      })
      setTimeout(start, 3000)
    }
  }

  return {
    start,
    refresh,
    calibration: currentCalibration,
    calMovedAt: () => calMovedAt,
    isMarking: () => isMarking,
    /** Window point → game units under the current calibration. */
    toWorld(x: number, y: number) {
      const cal = currentCalibration()
      if (!cal || !crop) return null
      return cal.toWorld((x - crop.ox) * crop.k, (y - crop.oy) * crop.k)
    },
    // Insert while the map is not found yet: search now, on fresh frames (the map may have opened a moment ago).
    setMarking(isOn: boolean) {
      isMarking = isOn
      if (isOn && !currentCalibration() && mapOpen !== false) {
        forced = 2
        if (!search.isRunning()) acquireAt = 0
      }
      refresh()
    },
    setFps(next: number) {
      const f = Math.round(Number(next))
      if (!Number.isFinite(f) || f === fps) return
      fps = Math.max(5, Math.min(240, f))
      if (stream) {
        isRestarting = true
        stream.getTracks().forEach((track) => track.stop())
      }
    },
    setScene(next: Scene) {
      scene = next
      if (config) draw()
    },
    setSelection(key: string | null) {
      selected = key
      if (config) refresh()
    },
    /** The drawn area turned out to be the panel already: from now on its frame says open or closed. */
    setSnapped() {
      if (!config) return
      config.isSnapped = true
      mapOpen = true
    },
    lastImage: () => lastImg,
    snapshotInfo() {
      const cal = currentCalibration()
      return {
        time: new Date().toISOString(),
        fps,
        area: config?.rect,
        snapped: config?.isSnapped,
        crop: crop && {
          ...crop.rect,
          k: crop.k,
        },
        status: JSON.parse(sent || 'null'),
        mapOpen,
        edges: lastEdges,
        candidates: lastCandidates,
        ring: ring && {
          cx: ring.cx,
          cy: ring.cy,
          r: ring.r,
          hue: ring.hue,
          weak: ring.isWeak,
        },
        rimVerified: isRimVerified,
        rimHue,
        recognised,
        vote,
        terrain: terrain && {
          world: terrain.world,
          fix: terrain.fix,
          score: terrain.score,
        },
        memory,
        workers: search.workers(),
        calibration: cal && {
          source: cal.source,
          world: cal.world,
          metresPerPixel: cal.mpp,
        },
        loaded: [...pyramids.ready.keys()],
        stats,
      }
    },
    stats,
  }
}

export type LayerEngine = ReturnType<typeof createEngine>
