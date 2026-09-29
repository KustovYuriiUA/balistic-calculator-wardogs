// What the on-screen checks (tests/maps-check.cjs, position-check.cjs) test outside the app window: pure functions of
// the overlay and of main, bundled by scripts/build-test-core.mjs into .test-output/app.cjs.
export { parseCoordinate } from '@/features/fire-plan/core/shot'
export { resolvePosition } from '@/main/window-position'
export { coordToMap, mapToCoord } from '@/shared/geometry'
