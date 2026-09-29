import { WORLDS, type WorldId } from '@/data/landmarks'

import { lumaOf, mapPyramid, type Level, type LumaImage } from '../core'

export interface LoadStats {
  decode: number
  draw: number
  pyramid: number
}

interface PyramidOptions {
  /** A coarse map is ready: hand its 1024² luminance to the map's search worker; false when there is none. */
  giveToWorker: (world: WorldId, luma: LumaImage) => boolean
  onLoaded: (key: string, stats: LoadStats) => void
}

// Offline map pyramids. Coarse: the grey 1024² maps made ahead by `pnpm zone-patches` (milliseconds to load); at
// 16 m/px they go to the map's search worker (512² is too coarse to tell the maps apart for sure), shrunk to 512² they
// stay here for tracking until the fine one is loaded. Fine (2048², 8 m/px): the map in view, shrunk from the 5120²
// map by createImageBitmap, which keeps the ~0.7 s of decoding and shrinking off this thread.
export function createPyramids({ giveToWorker, onLoaded }: PyramidOptions) {
  const loads = new Map<string, Promise<Level[] | null>>()
  /** Levels to track with, per map: the fine ones of the map in view, the coarse ones of the others. */
  const ready = new Map<WorldId, Level[]>()
  const coarseLevels = new Map<WorldId, Level[]>()
  /** 16 m/px levels of maps whose worker could not start: searched on this thread. */
  const searchLevels = new Map<WorldId, Level[]>()

  async function build(world: WorldId, size: number): Promise<Level[]> {
    const isCoarse = size === 512
    const t0 = performance.now()
    const img = new Image()
    img.src = isCoarse ? `maps/terrain-${world}.png` : `maps/${world}.webp`
    await img.decode()
    const source = isCoarse ? img : await createImageBitmap(img, {
      resizeWidth: size,
      resizeHeight: size,
      resizeQuality: 'high',
    })
    const t1 = performance.now()
    const grey = (n: number) => {
      const g = new OffscreenCanvas(n, n).getContext('2d', {
        willReadFrequently: true,
      })!
      g.imageSmoothingQuality = 'high'
      g.drawImage(source, 0, 0, n, n)
      return lumaOf(g.getImageData(0, 0, n, n))
    }
    const luma = grey(size)
    const t2 = performance.now()
    const levels = mapPyramid(luma)
    if (source instanceof ImageBitmap) source.close()
    onLoaded(world + '@' + size, {
      decode: Math.round(t1 - t0),
      draw: Math.round(t2 - t1),
      pyramid: Math.round(performance.now() - t2),
    })
    if (isCoarse) {
      coarseLevels.set(world, levels)
      if (!ready.has(world)) ready.set(world, levels)
      const search = grey(1024)
      if (!giveToWorker(world, search)) searchLevels.set(world, mapPyramid(search))
      return levels
    }
    // A fine pyramid is ~110 MB: only the map in view keeps one, the others fall back to their coarse levels.
    for (const other of WORLDS) {
      if (other === world || !loads.has(other + '@2048')) continue
      loads.delete(other + '@2048')
      const coarse = coarseLevels.get(other)
      if (coarse) ready.set(other, coarse)
      else ready.delete(other)
    }
    ready.set(world, levels)
    return levels
  }

  function load(world: WorldId, size: number) {
    const key = world + '@' + size
    let loading = loads.get(key)
    if (!loading) {
      loading = build(world, size).catch(() => null)
      loads.set(key, loading)
    }
    return loading
  }

  return {
    load,
    ready,
    searchLevels,
    hasFine: (world: WorldId) => ready.has(world) && ready.get(world) !== coarseLevels.get(world),
  }
}

export type Pyramids = ReturnType<typeof createPyramids>
