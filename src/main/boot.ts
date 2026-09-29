import path from 'node:path'

import { app } from 'electron'

import { chooseEntry } from '@/features/updates/main/update-core'

// The app's entry: the newest downloaded update, or the bundled app. Development runs (`pnpm start`) always use the
// working copy unless a test feed is set.
const root = path.join(__dirname, '..')
const entry = app.isPackaged || process.env.SHOT_UPDATE_FEED
  ? chooseEntry(app.getPath('userData'), root)
  : path.join(root, 'desktop', 'main.cjs')

// A runtime path, left to Node: the chosen app's main.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require(entry)
