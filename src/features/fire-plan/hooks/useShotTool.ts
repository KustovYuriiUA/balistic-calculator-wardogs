import { useEffect } from 'react'

import { calculateShot, parseCoordinate } from '../core/shot'
import { useFirePlanActions } from '../stores/firePlan'

interface ShotInput {
  player: string
  target: string
  hit: string
  distance?: number
  previousAim?: string
}

interface ModelContext {
  registerTool: (tool: object, options: {
    signal: AbortSignal
  }) => unknown
}

function checked(input: unknown): ShotInput {
  if (!input || typeof input !== 'object') throw new Error('Shot data expected.')
  const shot = input as Record<string, unknown>
  for (const key of ['player', 'target', 'hit']) {
    if (typeof shot[key] !== 'string') throw new Error('Coordinates needed: ' + key)
  }
  if (shot.previousAim !== undefined && typeof shot.previousAim !== 'string') {
    throw new Error('The aim point must be a string.')
  }
  return shot as unknown as ShotInput
}

/** The calculator as a WebMCP tool, for browsers that let an assistant use the page. */
export function useShotTool() {
  const { fill } = useFirePlanActions()
  useEffect(() => {
    const context = (document as Document & {
      modelContext?: ModelContext
    }).modelContext
    if (!context?.registerTool) return
    const lifecycle = new AbortController()
    const tool = {
      name: 'calculate_basketball_shot',
      title: 'Calculate the shot correction',
      description: 'Fill in the coordinates and calculate the aim point and the range on the page.',
      inputSchema: {
        type: 'object',
        properties: {
          player: {
            type: 'string',
          },
          target: {
            type: 'string',
          },
          hit: {
            type: 'string',
          },
          distance: {
            type: 'number',
            exclusiveMinimum: 0,
          },
          previousAim: {
            type: 'string',
          },
        },
        required: ['player', 'target', 'hit'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
      },
      execute(input: unknown) {
        const shot = checked(input)
        const target = parseCoordinate(shot.target)
        const aim = shot.previousAim ? parseCoordinate(shot.previousAim) : target
        // Throws a readable error for the assistant before the form is touched.
        calculateShot(
          parseCoordinate(shot.player),
          target,
          parseCoordinate(shot.hit),
          shot.distance ?? null,
          aim,
        )
        return fill({
          player: shot.player,
          target: shot.target,
          hit: shot.hit,
          distance: shot.distance === undefined ? '' : String(shot.distance),
          previousAim: shot.previousAim ?? '',
        })
      },
    }
    try {
      Promise.resolve(context.registerTool(tool, {
        signal: lifecycle.signal,
      })).catch(() => {})
    } catch {
      // An older draft of the API: the page works without the tool.
    }
    return () => lifecycle.abort()
  }, [fill])
}
