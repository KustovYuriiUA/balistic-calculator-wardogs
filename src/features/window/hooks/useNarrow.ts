import { useSyncExternalStore } from 'react'

// A window narrowed by hand turns compact by itself.
const narrow = matchMedia('(max-width: 760px)')

const subscribe = (onChange: () => void) => {
  narrow.addEventListener('change', onChange)
  return () => narrow.removeEventListener('change', onChange)
}

export const useNarrow = () => useSyncExternalStore(subscribe, () => narrow.matches)
