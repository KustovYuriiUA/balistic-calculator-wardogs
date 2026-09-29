import { MAP_LANDMARKS, WORLDS, type WorldId } from '@/data/landmarks'

import {
  acquireSteps, integralOf, type AcquiredFix, type Capture, type LumaImage,
} from '../core'
import type { Pyramids } from './pyramids'
import type { FromWorker, ToWorker } from '../core/search-protocol'

export interface SearchRecord {
  world: WorldId
  ms: number
  score: number | null
  isConfident: boolean
}

interface Job {
  id: number
  seen: Float32Array
  left: Map<WorldId, number>
  total: number
  began: number
  cap?: Capture
  resolve: (ok: boolean | null) => void
}

interface SearchOptions {
  /** A map was found: the first confident one wins and the others stop. */
  onFound: (world: WorldId, fix: AcquiredFix, seen: Float32Array) => void
  /** Progress, a finished map, the end of a search: the view and the status follow. */
  onChange: () => void
  onRecord: (record: SearchRecord) => void
  onWorkerReady: () => void
}

interface Searcher {
  worker: Worker | null
  isReady: boolean
}

// Wide searches run in one worker per map, all maps at once, so capture and tracking go on meanwhile. A map whose
// worker cannot start is searched on this thread instead.
export function createSearch(pyramids: () => Pyramids, options: SearchOptions) {
  const {
    onFound, onChange, onRecord, onWorkerReady,
  } = options
  const searchers = new Map<WorldId, Searcher>()
  let job: Job | null = null
  let jobs = 0

  for (const world of WORLDS) {
    const s: Searcher = {
      worker: null,
      isReady: false,
    }
    searchers.set(world, s)
    try {
      s.worker = new Worker(new URL('../worker/terrain.worker.ts', import.meta.url), {
        type: 'module',
      })
      s.worker.onmessage = (e: MessageEvent<FromWorker>) => message(world, e.data)
      s.worker.onerror = () => {
        s.worker = null
        s.isReady = false
        if (job?.left.has(world)) {
          message(world, {
            type: 'result',
            id: job.id,
            fix: null,
          })
        }
      }
    } catch {
      s.worker = null
    }
  }

  const post = (world: WorldId, m: ToWorker, transfer: Transferable[] = []) => {
    searchers.get(world)?.worker?.postMessage(m, transfer)
  }

  function giveToWorker(world: WorldId, luma: LumaImage) {
    if (!searchers.get(world)?.worker) return false
    post(world, {
      type: 'map',
      size: luma.width,
      luma: luma.data,
    }, [luma.data.buffer])
    return true
  }

  // ok: true found, false nothing found, null stopped (the rim locked or the map closed).
  function end(ok: boolean | null) {
    const current = job
    if (!current) return
    job = null
    for (const world of current.left.keys()) {
      post(world, {
        type: 'abort',
        id: current.id,
      })
    }
    current.resolve(ok)
    onChange()
  }

  function message(world: WorldId, m: FromWorker) {
    if (m.type === 'ready') {
      searchers.get(world)!.isReady = true
      onWorkerReady()
      return
    }
    if (!job || m.id !== job.id || !job.left.has(world)) return
    if (m.type === 'progress') {
      job.left.set(world, m.value)
      onChange()
      return
    }
    job.left.delete(world)
    const f = m.fix
    onRecord({
      world,
      ms: Math.round(performance.now() - job.began),
      score: f ? +f.score.toFixed(3) : null,
      isConfident: Boolean(f?.isConfident),
    })
    if (f?.isConfident) {
      onFound(world, f, job.seen)
      end(true)
    } else if (!job.left.size) end(false)
    else onChange()
  }

  async function searchHere(world: WorldId, current: Job) {
    const p = pyramids()
    if (!p.searchLevels.has(world)) await p.load(world, 512)
    const levels = p.searchLevels.get(world) || p.ready.get(world)
    let result: AcquiredFix | null = null
    if (levels && current.cap) {
      const steps = acquireSteps(levels, current.cap, {
        step: 1.12,
      })
      for (;;) {
        if (job !== current) return
        const r = steps.next()
        if (r.done) {
          result = r.value
          break
        }
        message(world, {
          type: 'progress',
          id: current.id,
          value: r.value,
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    message(world, {
      type: 'result',
      id: current.id,
      fix: result,
    })
  }

  /** Every map at once, the likely ones first. Resolves true found, false nothing found, null stopped. */
  function start(
    luma: LumaImage,
    seen: Float32Array,
    likely: (string | null)[],
  ): Promise<boolean | null> {
    const worlds = [...new Set([...likely, ...WORLDS])]
      .filter((w): w is WorldId => Boolean(w && w in MAP_LANDMARKS))
    let resolve: (ok: boolean | null) => void = () => {}
    const done = new Promise<boolean | null>((r) => {
      resolve = r
    })
    const current: Job = {
      id: ++jobs,
      seen,
      left: new Map(worlds.map((w) => [w, 0])),
      total: worlds.length,
      began: performance.now(),
      resolve,
    }
    job = current
    for (const world of worlds) {
      const s = searchers.get(world)
      if (s?.worker && s.isReady) {
        post(world, {
          type: 'acquire',
          id: current.id,
          width: luma.width,
          height: luma.height,
          luma: luma.data,
        })
      } else {
        current.cap ??= {
          width: luma.width,
          height: luma.height,
          I: integralOf(luma),
        }
        searchHere(world, current)
      }
    }
    onChange()
    return done
  }

  return {
    start,
    end,
    giveToWorker,
    isRunning: () => job !== null,
    /** 0…1 over every map of the running search; null when none runs. */
    progress: () => {
      if (!job) return null
      const done = job.total - job.left.size + [...job.left.values()].reduce((a, b) => a + b, 0)
      return done / job.total
    },
    workers: () => Object.fromEntries([...searchers].map(([w, s]) => [
      w,
      s.worker ? (s.isReady ? 'ready' : 'loading') : 'this thread',
    ])),
  }
}

export type Search = ReturnType<typeof createSearch>
