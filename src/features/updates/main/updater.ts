import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { app, net, shell } from 'electron'

import { t } from '@/shared/i18n'
import type { UpdateAction, UpdateState } from '@/shared/ipc'

import {
  isNewer,
  parseVersion,
  readState,
  readZip,
  updatesDir,
  validateManifest,
  writeState,
} from './update-core'

// From GitHub releases: the latest release's update.json gives size and SHA-256 of the app bundle, which is
// downloaded, checked and unpacked into userData for the next start.

const REPO = 'KustovYuriiUA/balistic-calculator-wardogs'
const RELEASES = `https://github.com/${REPO}/releases`
const TEST_FEED = process.env.SHOT_UPDATE_FEED
const FEED = TEST_FEED || `https://api.github.com/repos/${REPO}/releases/latest`
const HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  ...(TEST_FEED ? ['127.0.0.1', 'localhost'] : []),
])
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const APP_LIMIT = 100 * 1024 * 1024

export interface UpdaterOptions {
  version: string
  userData: string
  isEnabled: boolean
  onChange: (update: UpdateState) => void
}

type TrayAction = UpdateAction | 'toggle-auto'

type StatusFields = Omit<UpdateState, 'current' | 'isAuto' | 'isEnabled'>

let options: UpdaterOptions | null = null
let status: UpdateState = {
  state: 'idle',
  current: '',
  isAuto: true,
  isEnabled: false,
}
let isBusy = false

const settingsFile = () => path.join(options!.userData, 'update-settings.json')

// The file is shared with 1.x: {auto}.
function isAutoUpdate(): boolean {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).auto !== false
  } catch {
    return true
  }
}

function saveAutoUpdate(isAuto: boolean) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({
      auto: isAuto,
    }))
  } catch {
    // Not written: the default (on) applies next time.
  }
}

function publish(next: StatusFields) {
  status = {
    ...next,
    current: options!.version,
    isAuto: isAutoUpdate(),
    isEnabled: options!.isEnabled,
  }
  options!.onChange(status)
}

function isAllowed(url: string): boolean {
  const parsed = new URL(url)
  const isSecure = parsed.protocol === 'https:' || (Boolean(TEST_FEED) && parsed.protocol === 'http:')
  return isSecure && HOSTS.has(parsed.hostname)
}

async function get(url: string, accept: string, timeout: number) {
  if (!isAllowed(url)) throw new Error(t('upd.err.url'))
  const response = await net.fetch(url, {
    headers: {
      'Accept': accept,
      'User-Agent': 'tochnyi-brosok-updater',
    },
    signal: AbortSignal.timeout(timeout),
  })
  if (response.url && !isAllowed(response.url)) throw new Error(t('upd.err.redirect'))
  if (!response.ok) {
    throw new Error(t('upd.err.http', {
      status: response.status,
    }))
  }
  return response
}

async function download(
  url: string,
  limit: number,
  onProgress?: (share: number) => void,
): Promise<Buffer> {
  const response = await get(url, 'application/octet-stream', 5 * 60 * 1000)
  const total = Number(response.headers.get('content-length')) || 0
  if (total > limit) throw new Error(t('upd.err.tooBig'))
  if (!response.body) throw new Error(t('upd.err.incomplete'))
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) throw new Error(t('upd.err.tooBig'))
    chunks.push(value)
    if (onProgress && total) onProgress(size / total)
  }
  return Buffer.concat(chunks)
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface Release {
  tag_name?: string
  html_url?: string
  assets?: ReleaseAsset[]
}

async function check(isManual: boolean) {
  if (isBusy || !options?.isEnabled) return
  isBusy = true
  try {
    publish({
      state: 'checking',
      isManual,
    })
    const release = await (await get(FEED, 'application/vnd.github+json', 20000)).json() as Release
    const version = String(release.tag_name || '').replace(/^v/, '')
    if (!isNewer(version, options.version)) {
      publish({
        state: 'latest',
        isManual,
      })
      return
    }
    const hasReleasePage = typeof release.html_url === 'string' && release.html_url.startsWith(RELEASES + '/')
    const page = hasReleasePage ? release.html_url! : RELEASES + '/latest'
    const asset = (name: string) =>
      (release.assets || []).find((item) => item.name === name)?.browser_download_url
    const manual: StatusFields = {
      state: 'manual',
      version,
      url: page,
    }
    // Releases without a manifest, or built on another Electron runtime, need the full download.
    const manifestUrl = asset('update.json')
    if (!manifestUrl) {
      publish(manual)
      return
    }
    const manifest = validateManifest(JSON.parse((await download(manifestUrl, 1e6)).toString('utf8')))
    if (manifest.version !== version) throw new Error(t('upd.err.version'))
    const staged = readState(options.userData)
    const isStaged = staged?.version === version
    if (manifest.electron !== process.versions.electron || (isStaged && staged.isBroken)) {
      publish(manual)
      return
    }
    if (isStaged && fs.existsSync(path.join(updatesDir(options.userData), version, 'desktop', 'main.cjs'))) {
      publish({
        state: 'ready',
        version,
      })
      return
    }
    const bundleUrl = asset(manifest.app.name)
    if (!bundleUrl) {
      throw new Error(t('upd.err.noFile', {
        name: manifest.app.name,
      }))
    }
    let shown = -1
    const progress = (share: number) => {
      const percent = Math.floor(share * 100)
      if (percent < shown + 5) return
      shown = percent
      publish({
        state: 'downloading',
        version,
        progress: percent,
      })
    }
    progress(0)
    const bundle = await download(bundleUrl, APP_LIMIT, progress)
    const sha256 = crypto.createHash('sha256').update(bundle).digest('hex')
    if (bundle.length !== manifest.app.size || sha256 !== manifest.app.sha256) throw new Error(t('upd.err.checksum'))
    install(version, bundle)
    publish({
      state: 'ready',
      version,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('Update check failed:', message)
    publish({
      state: 'error',
      isManual,
      message,
    })
  } finally {
    isBusy = false
  }
}

// The same checks as installed copies make, since they start this bundle's desktop/main.cjs: see update-core.
function install(version: string, bundle: Buffer) {
  const files = readZip(bundle)
  const dir = updatesDir(options!.userData)
  const target = path.join(dir, version)
  const partial = target + '.partial'
  fs.rmSync(partial, {
    recursive: true,
    force: true,
  })
  for (const file of files) {
    const destination = path.join(partial, ...file.name.split('/'))
    fs.mkdirSync(path.dirname(destination), {
      recursive: true,
    })
    fs.writeFileSync(destination, file.data)
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(partial, 'package.json'), 'utf8'))
  const isComplete = manifest.version === version
    && fs.existsSync(path.join(partial, 'desktop', 'main.cjs'))
    && fs.existsSync(path.join(partial, 'dist', 'index.html'))
  if (!isComplete) throw new Error(t('upd.err.incomplete'))
  fs.rmSync(target, {
    recursive: true,
    force: true,
  })
  fs.renameSync(partial, target)
  writeState(options!.userData, {
    version,
    attempts: 0,
    isConfirmed: false,
  })
  // Keep the new version and the running one; older downloads go.
  for (const name of fs.readdirSync(dir)) {
    const isOld = name !== version && name !== options!.version && parseVersion(name.replace(/\.partial$/, ''))
    if (isOld) {
      fs.rmSync(path.join(dir, name), {
        recursive: true,
        force: true,
      })
    }
  }
}

/** The window of a freshly installed update loaded: keep starting it. */
export function confirmStart() {
  const state = options && readState(options.userData)
  if (options && state && state.version === options.version && !state.isConfirmed) {
    writeState(options.userData, {
      ...state,
      isConfirmed: true,
    })
  }
}

export function startUpdater(config: UpdaterOptions) {
  options = config
  publish({
    state: 'idle',
  })
  if (!options.isEnabled) return
  const scheduled = () => {
    if (isAutoUpdate()) check(false)
  }
  setTimeout(scheduled, Number(process.env.SHOT_UPDATE_DELAY ?? 8000))
  setInterval(scheduled, CHECK_EVERY_MS).unref()
}

export function updateAction(name: TrayAction) {
  if (name === 'check') check(true)
  else if (name === 'restart' && status.state === 'ready') {
    app.relaunch()
    app.quit()
  } else if (name === 'open' && status.url && status.url.startsWith(RELEASES)) shell.openExternal(status.url)
  else if (name === 'toggle-auto') {
    saveAutoUpdate(!isAutoUpdate())
    publish(status)
    if (isAutoUpdate()) check(false)
  }
}

export const currentUpdate = () => status
