// What the off-screen Electron checks (tests/zone-check.cjs, terrain-check.cjs, sweep-check.cjs) test: the game-map
// core and the data it runs on, bundled by scripts/build-test-core.mjs into .test-output/.
export * from '@/features/game-map/core'
export { MAP_LANDMARKS, WORLDS } from '@/data/landmarks'
export { ZONE_PATCHES } from '@/data/generated/zone-patches'
export { MAP_EXTENT, MAP_METRES } from '@/shared/geometry'
