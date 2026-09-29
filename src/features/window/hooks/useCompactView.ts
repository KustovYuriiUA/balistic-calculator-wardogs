import { useIsCompact } from '@/store'

import { useNarrow } from './useNarrow'

/** Compact: the map on top and the targets below it, chosen by hand or forced by a narrow window. */
export function useCompactView() {
  const isCompact = useIsCompact()
  const isNarrow = useNarrow()
  return {
    isCompact,
    isNarrow,
    isCompactView: isCompact || isNarrow,
  }
}
