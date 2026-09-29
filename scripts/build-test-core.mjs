// Pure code of src/ for the Electron checks, bundled into .test-output/:
// - the game-map core (tests/support/core-entry.ts) for the off-screen checks (tests/zone-check.cjs, terrain-check.cjs,
//   sweep-check.cjs): a CommonJS file the checks require() in the main process, and an IIFE that sweep-check runs in a
//   hidden page, where it sets globalThis.ShotCore;
// - the overlay's and main's functions that the on-screen checks (tests/maps-check.cjs, position-check.cjs) compare the
//   app with (tests/support/app-entry.ts): CommonJS only, since main's part reads files.
import { resolve } from 'node:path'

import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')

const common = {
  bundle: true,
  target: 'es2023',
  alias: {
    '@': resolve(root, 'src'),
  },
  logLevel: 'warning',
}

const core = [resolve(root, 'tests/support/core-entry.ts')]

await Promise.all([
  build({
    ...common,
    entryPoints: core,
    outfile: resolve(root, '.test-output/core.cjs'),
    platform: 'node',
    format: 'cjs',
  }),
  build({
    ...common,
    entryPoints: core,
    outfile: resolve(root, '.test-output/core.iife.js'),
    platform: 'browser',
    format: 'iife',
    globalName: 'ShotCore',
  }),
  build({
    ...common,
    entryPoints: [resolve(root, 'tests/support/app-entry.ts')],
    outfile: resolve(root, '.test-output/app.cjs'),
    platform: 'node',
    format: 'cjs',
  }),
])
