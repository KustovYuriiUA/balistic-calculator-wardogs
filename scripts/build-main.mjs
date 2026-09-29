// Main process and preloads with esbuild, into desktop/ where installed copies' updater expects them:
// desktop/boot.cjs (entry, package.json "main"), desktop/main.cjs and the two preloads. Each preload is one file:
// a sandboxed preload cannot require anything but electron.
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { build, context } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'desktop')
const isWatch = process.argv.includes('--watch')

const options = {
  entryPoints: {
    'boot': resolve(root, 'src/main/boot.ts'),
    'main': resolve(root, 'src/main/index.ts'),
    'preload': resolve(root, 'src/preload/overlay.ts'),
    'layer-preload': resolve(root, 'src/preload/layer.ts'),
  },
  outdir: out,
  outExtension: {
    '.js': '.cjs',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  alias: {
    '@': resolve(root, 'src'),
  },
  sourcemap: 'linked',
  logLevel: 'info',
}

// desktop/ holds build output only: files of an older layout must not ship with a package.
await rm(out, {
  recursive: true,
  force: true,
})
await mkdir(out, {
  recursive: true,
})
await copyFile(resolve(root, 'resources/icon.png'), resolve(out, 'icon.png'))

if (isWatch) {
  const ctx = await context(options)
  await ctx.watch()
} else {
  await build(options)
}
