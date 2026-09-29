/// <reference lib="webworker" />
import {
  acquireSteps, integralOf, mapPyramid, type AcquiredFix, type Level,
} from '../core'
import type { FromWorker, ToWorker } from '../core/search-protocol'

// The wide terrain search on one offline map, off the layer's thread: the layer runs one worker per map, all at once.

declare const self: DedicatedWorkerGlobalScope

let levels: Level[] | null = null
let current = 0

// A pause that lets an abort in, cheaper than setTimeout (clamped to 4 ms in a worker).
const channel = new MessageChannel()
let wake = () => {}
channel.port1.onmessage = () => wake()
const pause = () => new Promise<void>((resolve) => {
  wake = resolve
  channel.port2.postMessage(0)
})

const post = (message: FromWorker) => self.postMessage(message)

self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  if (data.type === 'map') {
    levels = mapPyramid({
      width: data.size,
      height: data.size,
      data: data.luma,
    })
    post({
      type: 'ready',
    })
    return
  }
  if (data.type === 'abort') {
    if (current === data.id) current = 0
    return
  }
  const id = data.id
  current = id
  if (!levels) {
    post({
      type: 'result',
      id,
      fix: null,
    })
    return
  }
  const cap = {
    width: data.width,
    height: data.height,
    I: integralOf({
      width: data.width,
      height: data.height,
      data: data.luma,
    }),
  }
  const steps = acquireSteps(levels, cap, {
    step: 1.12,
  })
  let r: IteratorResult<number, AcquiredFix | null>
  for (;;) {
    r = steps.next()
    if (r.done) break
    post({
      type: 'progress',
      id,
      value: r.value,
    })
    await pause()
    if (current !== id) return
  }
  current = 0
  post({
    type: 'result',
    id,
    fix: r.value,
  })
}
