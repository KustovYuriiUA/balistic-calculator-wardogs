import type { AcquiredFix } from './terrain/fix'

// Messages between the layer and a terrain search worker (one worker per map).

export type ToWorker =
  | {
    type: 'map'
    size: number
    luma: Float32Array
  }
  | {
    type: 'acquire'
    id: number
    width: number
    height: number
    luma: Float32Array
  }
  | {
    type: 'abort'
    id: number
  }

export type FromWorker =
  | {
    type: 'ready'
  }
  | {
    type: 'progress'
    id: number
    value: number
  }
  | {
    type: 'result'
    id: number
    fix: AcquiredFix | null
  }
