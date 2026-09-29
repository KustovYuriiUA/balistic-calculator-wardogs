// The overlay window's side of the feature. Two more entries keep each bundle to its own process:
// `@/features/game-map/main` (main process) and `@/features/game-map/layer` (the framework-free layer and
// picker pages, which must not pull in React and the overlay's stores).
export { GameMapRow } from './components/GameMapRow'
export { PickAreaButton } from './components/PickAreaButton'
export { worldName } from './utils/status-view'
