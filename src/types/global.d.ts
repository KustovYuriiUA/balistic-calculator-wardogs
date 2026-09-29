import type { MapLayerApi, OverlayApi } from '@/shared/ipc'

declare global {
  interface Window {
    /** The overlay window's preload; absent on the web page. */
    overlay?: OverlayApi
    /** The layer and picker windows' preload. */
    mapLayer?: MapLayerApi
  }
}

export {}
